const bcrypt = require('bcryptjs');
const db = require('./db');

// In-memory active room runtime tracking
// roomsMap: roomId -> { hostSocketId, passcodeHash, isLocked, participants: Map(socketId -> peerInfo), strokesHistory: [] }
const roomsMap = new Map();

function initSignaling(io) {
  io.on('connection', (socket) => {
    const user = socket.user || {
      id: 'guest_' + socket.id.substring(0, 8),
      displayName: 'Guest',
      isGuest: true
    };

    let currentRoomId = null;

    // --- Join Room ---
    socket.on('join-room', async ({ roomId, passcode, displayName }, callback) => {
      try {
        if (!roomId || typeof roomId !== 'string') {
          return callback && callback({ error: 'Valid Room ID required' });
        }

        const cleanRoomId = roomId.trim().toLowerCase();
        const peerDisplayName = displayName || user.displayName || 'Participant';

        let room = roomsMap.get(cleanRoomId);

        // If room exists in DB or memory
        if (!room) {
          const dbRoom = db.getRoom(cleanRoomId);
          let hash = null;
          if (passcode) {
            hash = await bcrypt.hash(passcode, 8);
          } else if (dbRoom && dbRoom.passcodeHash) {
            hash = dbRoom.passcodeHash;
          }

          room = {
            roomId: cleanRoomId,
            hostSocketId: socket.id,
            hostUserId: user.id,
            passcodeHash: hash,
            isLocked: dbRoom ? dbRoom.isLocked : false,
            participants: new Map(),
            strokesHistory: []
          };
          roomsMap.set(cleanRoomId, room);

          if (!dbRoom) {
            db.createRoom(cleanRoomId, {
              name: cleanRoomId,
              hostId: user.id,
              passcodeHash: hash
            });
          }
        } else {
          // Check room lock
          if (room.isLocked && room.hostSocketId !== socket.id) {
            return callback && callback({ error: 'This room is currently locked by the host' });
          }

          // Check passcode
          if (room.passcodeHash && room.hostSocketId !== socket.id) {
            if (!passcode) {
              return callback && callback({ error: 'Passcode required to enter this room', needsPasscode: true });
            }
            const isMatch = await bcrypt.compare(passcode, room.passcodeHash);
            if (!isMatch) {
              return callback && callback({ error: 'Incorrect room passcode', needsPasscode: true });
            }
          }
        }

        currentRoomId = cleanRoomId;
        socket.join(cleanRoomId);

        const peerInfo = {
          socketId: socket.id,
          userId: user.id,
          displayName: peerDisplayName,
          isHost: room.hostSocketId === socket.id,
          isGuest: !!user.isGuest,
          audioMuted: false,
          videoMuted: false,
          isScreenSharing: false,
          handRaised: false
        };

        // Gather other peers in room
        const existingPeers = [];
        for (const [sId, pInfo] of room.participants.entries()) {
          if (sId !== socket.id) {
            existingPeers.push(pInfo);
          }
        }

        // Add this peer to the room
        room.participants.set(socket.id, peerInfo);

        // Notify existing peers that a new peer has joined
        socket.to(cleanRoomId).emit('peer-joined', peerInfo);

        // Acknowledge back to caller with room state and peers
        if (callback) {
          callback({
            success: true,
            roomId: cleanRoomId,
            myPeerInfo: peerInfo,
            peers: existingPeers,
            isHost: peerInfo.isHost,
            isLocked: room.isLocked,
            strokesHistory: room.strokesHistory
          });
        }
      } catch (err) {
        console.error('Error joining room:', err);
        if (callback) callback({ error: 'Internal server error while joining room' });
      }
    });

    // --- WebRTC Signaling (Offer / Answer / ICE Candidate) ---
    socket.on('peer-signal', ({ targetSocketId, signalData }) => {
      if (!targetSocketId || !signalData) return;
      io.to(targetSocketId).emit('peer-signal', {
        senderSocketId: socket.id,
        signalData
      });
    });

    // --- Media State Update (Mic / Cam / Screen) ---
    socket.on('media-state-change', ({ audioMuted, videoMuted, isScreenSharing }) => {
      if (!currentRoomId) return;
      const room = roomsMap.get(currentRoomId);
      if (!room) return;

      const peerInfo = room.participants.get(socket.id);
      if (peerInfo) {
        if (typeof audioMuted === 'boolean') peerInfo.audioMuted = audioMuted;
        if (typeof videoMuted === 'boolean') peerInfo.videoMuted = videoMuted;
        if (typeof isScreenSharing === 'boolean') peerInfo.isScreenSharing = isScreenSharing;

        socket.to(currentRoomId).emit('peer-media-state', {
          socketId: socket.id,
          audioMuted: peerInfo.audioMuted,
          videoMuted: peerInfo.videoMuted,
          isScreenSharing: peerInfo.isScreenSharing
        });
      }
    });

    // --- Collaborative Whiteboard Events ---
    socket.on('whiteboard-draw', (drawData) => {
      if (!currentRoomId) return;
      const room = roomsMap.get(currentRoomId);
      if (room) {
        // Keep strokes history (limit to 2000 items to conserve memory)
        if (room.strokesHistory.length > 2000) {
          room.strokesHistory.splice(0, 500);
        }
        room.strokesHistory.push(drawData);
      }
      socket.to(currentRoomId).emit('whiteboard-draw', drawData);
    });

    socket.on('whiteboard-clear', () => {
      if (!currentRoomId) return;
      const room = roomsMap.get(currentRoomId);
      if (room) {
        room.strokesHistory = [];
      }
      io.to(currentRoomId).emit('whiteboard-clear');
    });

    socket.on('whiteboard-cursor', (cursorData) => {
      if (!currentRoomId) return;
      socket.to(currentRoomId).emit('whiteboard-cursor', {
        socketId: socket.id,
        ...cursorData
      });
    });

    // --- Chat & Hand Raise ---
    socket.on('chat-message', ({ text, toSocketId }) => {
      if (!currentRoomId || !text || !text.trim()) return;
      const room = roomsMap.get(currentRoomId);
      const sender = room ? room.participants.get(socket.id) : null;
      const senderName = sender ? sender.displayName : 'Anonymous';

      const msg = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        senderSocketId: socket.id,
        senderName,
        text: text.trim(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isPrivate: !!toSocketId
      };

      if (toSocketId) {
        // Direct private message
        io.to(toSocketId).emit('chat-message', msg);
        socket.emit('chat-message', msg); // Echo to sender
      } else {
        // Public room message
        io.to(currentRoomId).emit('chat-message', msg);
      }
    });

    socket.on('raise-hand', ({ raised }) => {
      if (!currentRoomId) return;
      const room = roomsMap.get(currentRoomId);
      if (!room) return;

      const peerInfo = room.participants.get(socket.id);
      if (peerInfo) {
        peerInfo.handRaised = raised;
        io.to(currentRoomId).emit('peer-hand-raised', {
          socketId: socket.id,
          displayName: peerInfo.displayName,
          raised
        });
      }
    });

    // --- Floating Emoji Reactions ---
    socket.on('send-reaction', ({ emoji }) => {
      if (!currentRoomId || !emoji) return;
      const room = roomsMap.get(currentRoomId);
      const sender = room ? room.participants.get(socket.id) : null;
      io.to(currentRoomId).emit('peer-reaction', {
        socketId: socket.id,
        displayName: sender ? sender.displayName : 'Participant',
        emoji
      });
    });

    // --- Host Controls ---
    socket.on('host-lock-room', ({ locked }, callback) => {
      if (!currentRoomId) return;
      const room = roomsMap.get(currentRoomId);
      if (!room || room.hostSocketId !== socket.id) {
        return callback && callback({ error: 'Only the host can lock/unlock the room' });
      }
      room.isLocked = locked;
      db.updateRoom(currentRoomId, { isLocked: locked });
      io.to(currentRoomId).emit('room-lock-changed', { isLocked: locked });
      if (callback) callback({ success: true, isLocked: locked });
    });

    socket.on('host-kick-peer', ({ targetSocketId }) => {
      if (!currentRoomId) return;
      const room = roomsMap.get(currentRoomId);
      if (!room || room.hostSocketId !== socket.id) return;

      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('kicked-by-host');
        targetSocket.leave(currentRoomId);
      }
    });

    socket.on('host-mute-all', () => {
      if (!currentRoomId) return;
      const room = roomsMap.get(currentRoomId);
      if (!room || room.hostSocketId !== socket.id) return;

      socket.to(currentRoomId).emit('request-mute-mic');
    });

    // --- Leave / Disconnect ---
    const handleLeave = () => {
      if (!currentRoomId) return;
      const room = roomsMap.get(currentRoomId);
      if (!room) return;

      room.participants.delete(socket.id);
      socket.leave(currentRoomId);

      socket.to(currentRoomId).emit('peer-left', { socketId: socket.id });

      // If room is empty, cleanup after delay
      if (room.participants.size === 0) {
        roomsMap.delete(currentRoomId);
      } else if (room.hostSocketId === socket.id) {
        // Elect next host
        const nextHostSocketId = room.participants.keys().next().value;
        const newHost = room.participants.get(nextHostSocketId);
        if (newHost) {
          room.hostSocketId = nextHostSocketId;
          newHost.isHost = true;
          io.to(currentRoomId).emit('host-changed', {
            newHostSocketId: nextHostSocketId,
            displayName: newHost.displayName
          });
        }
      }
      currentRoomId = null;
    };

    socket.on('leave-room', handleLeave);
    socket.on('disconnect', handleLeave);
  });
}

module.exports = { initSignaling };
