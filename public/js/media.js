/**
 * Media Stream Manager: Camera, Microphone, Screen Sharing, and Audio Meter
 */
class MediaManager {
  constructor() {
    this.localStream = null;
    this.screenStream = null;
    this.isAudioMuted = false;
    this.isVideoMuted = false;
    this.isScreenSharing = false;

    this.audioContext = null;
    this.analyser = null;
    this.audioMeterInterval = null;

    this.onAudioLevelChange = null; // Callback for volume detection (0 - 100)
    this.onScreenShareEnded = null;  // Callback when screen sharing stops
  }

  /**
   * Initialize local camera and microphone stream
   */
  async getLocalMedia({ video = true, audio = true, videoDeviceId = null, audioDeviceId = null } = {}) {
    if (this.localStream) {
      this.stopLocalMedia();
    }

    const constraints = {
      video: video ? {
        deviceId: videoDeviceId ? { exact: videoDeviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      } : false,
      audio: audio ? {
        deviceId: audioDeviceId ? { exact: audioDeviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } : false
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.setupAudioMeter(this.localStream);
      return this.localStream;
    } catch (err) {
      console.warn('Could not acquire both video and audio, attempting audio-only:', err);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.isVideoMuted = true;
        this.setupAudioMeter(this.localStream);
        return this.localStream;
      } catch (audioErr) {
        console.warn('Could not acquire media, creating dummy canvas stream:', audioErr);
        // Fallback: create silent canvas stream for headless/virtual environments
        this.localStream = this.createSyntheticStream();
        return this.localStream;
      }
    }
  }

  /**
   * Fallback stream if user has no webcam or mic connected
   */
  createSyntheticStream() {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#6c7086';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No Camera Detected', 320, 240);

    const stream = canvas.captureStream(15);
    this.isVideoMuted = true;
    this.isAudioMuted = true;
    return stream;
  }

  /**
   * Toggle Audio track mute/unmute
   */
  toggleAudio(enabled) {
    if (!this.localStream) return false;
    const audioTracks = this.localStream.getAudioTracks();
    if (audioTracks.length === 0) return false;

    const targetState = typeof enabled === 'boolean' ? enabled : !audioTracks[0].enabled;
    audioTracks.forEach(track => {
      track.enabled = targetState;
    });
    this.isAudioMuted = !targetState;
    return targetState;
  }

  /**
   * Toggle Video track pause/unpause
   */
  toggleVideo(enabled) {
    if (!this.localStream) return false;
    const videoTracks = this.localStream.getVideoTracks();
    if (videoTracks.length === 0) return false;

    const targetState = typeof enabled === 'boolean' ? enabled : !videoTracks[0].enabled;
    videoTracks.forEach(track => {
      track.enabled = targetState;
    });
    this.isVideoMuted = !targetState;
    return targetState;
  }

  /**
   * Start Screen Sharing using getDisplayMedia
   */
  async startScreenShare() {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor'
        },
        audio: true
      });

      const screenVideoTrack = this.screenStream.getVideoTracks()[0];
      if (screenVideoTrack) {
        screenVideoTrack.onended = () => {
          this.stopScreenShare();
        };
      }

      this.isScreenSharing = true;
      return this.screenStream;
    } catch (err) {
      console.error('Error starting screen share:', err);
      throw err;
    }
  }

  /**
   * Stop Screen Sharing and notify listeners
   */
  stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }
    this.isScreenSharing = false;
    if (this.onScreenShareEnded) {
      this.onScreenShareEnded();
    }
  }

  /**
   * Set up audio visualizer / active speaker detection
   */
  setupAudioMeter(stream) {
    try {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      this.audioContext = new AudioContextClass();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      clearInterval(this.audioMeterInterval);
      this.audioMeterInterval = setInterval(() => {
        if (!this.analyser || this.isAudioMuted) {
          if (this.onAudioLevelChange) this.onAudioLevelChange(0);
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalized = Math.min(100, Math.round((average / 128) * 100));

        if (this.onAudioLevelChange) {
          this.onAudioLevelChange(normalized);
        }
      }, 100);
    } catch (err) {
      console.warn('AudioContext not permitted or failed:', err);
    }
  }

  /**
   * List available media input/output devices
   */
  async getDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        audioInputs: devices.filter(d => d.kind === 'audioinput'),
        audioOutputs: devices.filter(d => d.kind === 'audiooutput'),
        videoInputs: devices.filter(d => d.kind === 'videoinput')
      };
    } catch (err) {
      console.warn('Failed to enumerate devices:', err);
      return { audioInputs: [], audioOutputs: [], videoInputs: [] };
    }
  }

  /**
   * Clean up and stop all local tracks
   */
  stopLocalMedia() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }
    if (this.audioMeterInterval) {
      clearInterval(this.audioMeterInterval);
      this.audioMeterInterval = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

if (typeof window !== 'undefined') {
  window.MediaManager = MediaManager;
}
