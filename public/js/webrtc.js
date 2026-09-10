/**
 * WebRTC Full-Mesh PeerConnection and DataChannel Manager
 */
class WebRTCManager {
  constructor(socket, localStream, options = {}) {
    this.socket = socket;
    this.localStream = localStream;
    this.peers = new Map(); // socketId -> { pc, dataChannel, remoteStream, pendingCandidates }
    this.iceServers = options.iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];

    // Callbacks
    this.onRemoteStream = null;         // (socketId, stream)
    this.onPeerDisconnected = null;    // (socketId)
    this.onDataMessage = null;          // (socketId, messageData)
    this.onDataChannelOpen = null;      // (socketId)
  }

  /**
   * Set or update local media stream
   */
  setLocalStream(stream) {
    this.localStream = stream;
  }

  /**
   * Seamlessly replace tracks across all active peer connections
   * (Used for Screen Sharing toggle without renegotiation drops)
   */
  async replaceVideoTrack(newTrack) {
    for (const [socketId, peer] of this.peers.entries()) {
      if (!peer.pc) continue;
      const senders = peer.pc.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(newTrack);
      } else if (newTrack) {
        peer.pc.addTrack(newTrack, this.localStream);
      }
    }
  }

  /**
   * Create RTCPeerConnection for a peer
   */
  createPeerConnection(targetSocketId, isInitiator) {
    if (this.peers.has(targetSocketId)) {
      return this.peers.get(targetSocketId);
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    const peerObj = {
      socketId: targetSocketId,
      pc,
      dataChannel: null,
      remoteStream: new MediaStream(),
      pendingCandidates: []
    };

    // Attach local stream tracks to connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // ICE candidate discovery
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('peer-signal', {
          targetSocketId,
          signalData: {
            type: 'candidate',
            candidate: event.candidate
          }
        });
      }
    };

    // Remote track received
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        peerObj.remoteStream = event.streams[0];
      } else {
        peerObj.remoteStream.addTrack(event.track);
      }
      if (this.onRemoteStream) {
        this.onRemoteStream(targetSocketId, peerObj.remoteStream);
      }
    };

    // Connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.closePeer(targetSocketId);
      }
    };

    // DataChannel setup
    if (isInitiator) {
      try {
        const dc = pc.createDataChannel('collab-channel', { ordered: true });
        this.setupDataChannel(targetSocketId, peerObj, dc);
      } catch (e) {
        console.warn('Failed to create data channel:', e);
      }
    } else {
      pc.ondatachannel = (event) => {
        this.setupDataChannel(targetSocketId, peerObj, event.channel);
      };
    }

    this.peers.set(targetSocketId, peerObj);
    return peerObj;
  }

  /**
   * Configure WebRTC DataChannel listeners
   */
  setupDataChannel(socketId, peerObj, dc) {
    peerObj.dataChannel = dc;
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      if (this.onDataChannelOpen) {
        this.onDataChannelOpen(socketId);
      }
    };

    dc.onmessage = (event) => {
      if (this.onDataMessage) {
        this.onDataMessage(socketId, event.data);
      }
    };

    dc.onerror = (err) => {
      console.warn(`DataChannel error with ${socketId}:`, err);
    };
  }

  /**
   * Initiate call to a new peer by sending an SDP Offer
   */
  async callPeer(targetSocketId) {
    const peer = this.createPeerConnection(targetSocketId, true);
    try {
      const offer = await peer.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await peer.pc.setLocalDescription(offer);

      this.socket.emit('peer-signal', {
        targetSocketId,
        signalData: {
          type: 'offer',
          sdp: peer.pc.localDescription
        }
      });
    } catch (err) {
      console.error(`Error creating offer for ${targetSocketId}:`, err);
    }
  }

  /**
   * Process incoming signaling message (Offer / Answer / ICE Candidate)
   */
  async handleSignal(senderSocketId, signalData) {
    let peer = this.peers.get(senderSocketId);

    if (signalData.type === 'offer') {
      if (!peer) {
        peer = this.createPeerConnection(senderSocketId, false);
      }
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));

        // Process any buffered ICE candidates
        while (peer.pendingCandidates.length > 0) {
          const candidate = peer.pendingCandidates.shift();
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        }

        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);

        this.socket.emit('peer-signal', {
          targetSocketId: senderSocketId,
          signalData: {
            type: 'answer',
            sdp: peer.pc.localDescription
          }
        });
      } catch (err) {
        console.error(`Error handling offer from ${senderSocketId}:`, err);
      }
    } else if (signalData.type === 'answer') {
      if (peer) {
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
          while (peer.pendingCandidates.length > 0) {
            const candidate = peer.pendingCandidates.shift();
            await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch (err) {
          console.error(`Error handling answer from ${senderSocketId}:`, err);
        }
      }
    } else if (signalData.type === 'candidate') {
      if (!peer) {
        peer = this.createPeerConnection(senderSocketId, false);
      }

      if (peer.pc.remoteDescription && peer.pc.remoteDescription.type) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
        } catch (err) {
          console.warn(`Error adding ice candidate for ${senderSocketId}:`, err);
        }
      } else {
        peer.pendingCandidates.push(signalData.candidate);
      }
    }
  }

  /**
   * Send binary or text data to specific peer via DataChannel
   */
  sendDataToPeer(socketId, data) {
    const peer = this.peers.get(socketId);
    if (peer && peer.dataChannel && peer.dataChannel.readyState === 'open') {
      peer.dataChannel.send(data);
      return true;
    }
    return false;
  }

  /**
   * Broadcast binary or text data to all connected peers via DataChannels
   */
  broadcastData(data) {
    let sentCount = 0;
    for (const [socketId, peer] of this.peers.entries()) {
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        try {
          peer.dataChannel.send(data);
          sentCount++;
        } catch (e) {
          console.warn(`Failed to broadcast to ${socketId}:`, e);
        }
      }
    }
    return sentCount;
  }

  /**
   * Close and cleanup a specific peer
   */
  closePeer(socketId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      if (peer.dataChannel) {
        peer.dataChannel.close();
      }
      if (peer.pc) {
        peer.pc.close();
      }
      this.peers.delete(socketId);
      if (this.onPeerDisconnected) {
        this.onPeerDisconnected(socketId);
      }
    }
  }

  /**
   * Close all active peer connections
   */
  closeAll() {
    for (const socketId of Array.from(this.peers.keys())) {
      this.closePeer(socketId);
    }
  }
}

if (typeof window !== 'undefined') {
  window.WebRTCManager = WebRTCManager;
}
