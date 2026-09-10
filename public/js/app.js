/**
 * CollabSync Main Frontend Application Controller
 */
(function () {
  'use strict';

  // --- Global Application State ---
  const state = {
    token: localStorage.getItem('collab_jwt_token') || null,
    user: null,
    roomId: null,
    roomPasscode: '',
    roomKey: null,
    isHost: false,
    socket: null,
    mediaManager: null,
    webrtcManager: null,
    whiteboard: null,
    fileShareManager: null,
    chatManager: null,
    peers: new Map(), // socketId -> { info, cardEl, videoEl }
    isHandRaised: false,
    activeSidebarTab: 'chat',
    previewStream: null
  };

  // --- DOM Element References ---
  const els = {
    // Views
    lobbyView: document.getElementById('lobby-view'),
    meetingView: document.getElementById('meeting-view'),

    // Lobby Elements
    previewVideo: document.getElementById('preview-video'),
    lobbyToggleMic: document.getElementById('lobby-toggle-mic'),
    lobbyToggleCam: document.getElementById('lobby-toggle-cam'),
    lobbyAudioMeter: document.getElementById('lobby-audio-meter'),
    lobbySelectAudio: document.getElementById('lobby-select-audio'),
    lobbySelectVideo: document.getElementById('lobby-select-video'),
    tabJoin: document.getElementById('tab-join'),
    tabLogin: document.getElementById('tab-login'),
    tabRegister: document.getElementById('tab-register'),
    formJoinSection: document.getElementById('form-join-section'),
    formLoginSection: document.getElementById('form-login-section'),
    formRegisterSection: document.getElementById('form-register-section'),
    joinDisplayName: document.getElementById('join-display-name'),
    joinRoomId: document.getElementById('join-room-id'),
    joinRoomPasscode: document.getElementById('join-room-passcode'),
    btnJoinMeeting: document.getElementById('btn-join-meeting'),
    loginUsername: document.getElementById('login-username'),
    loginPassword: document.getElementById('login-password'),
    btnSubmitLogin: document.getElementById('btn-submit-login'),
    regUsername: document.getElementById('reg-username'),
    regEmail: document.getElementById('reg-email'),
    regDisplayName: document.getElementById('reg-display-name'),
    regPassword: document.getElementById('reg-password'),
    btnSubmitRegister: document.getElementById('btn-submit-register'),
    userSessionLabel: document.getElementById('user-session-label'),
    btnLogout: document.getElementById('btn-logout'),

    // Meeting View Elements
    activeRoomTitle: document.getElementById('active-room-title'),
    btnCopyInvite: document.getElementById('btn-copy-invite'),
    btnHostLock: document.getElementById('btn-host-lock'),
    videoGrid: document.getElementById('video-grid'),
    presentationStage: document.getElementById('presentation-stage'),
    presentationVideo: document.getElementById('presentation-video'),
    whiteboardContainer: document.getElementById('whiteboard-container'),
    wbCanvas: document.getElementById('wb-canvas'),
    wbCursorOverlay: document.getElementById('wb-cursor-overlay'),
    wbUndoBtn: document.getElementById('wb-undo-btn'),
    wbRedoBtn: document.getElementById('wb-redo-btn'),
    wbClearBtn: document.getElementById('wb-clear-btn'),
    wbExportBtn: document.getElementById('wb-export-btn'),
    wbCloseBtn: document.getElementById('wb-close-btn'),
    wbSizeSlider: document.getElementById('wb-size-slider'),

    // Sidebar Elements
    meetingSidebar: document.getElementById('meeting-sidebar'),
    btnCloseSidebar: document.getElementById('btn-close-sidebar'),
    sidebarTabBtns: document.querySelectorAll('.sidebar-tab-btn'),
    tabContentChat: document.getElementById('tab-content-chat'),
    tabContentFiles: document.getElementById('tab-content-files'),
    tabContentRoster: document.getElementById('tab-content-roster'),
    chatMessages: document.getElementById('chat-messages'),
    chatInputText: document.getElementById('chat-input-text'),
    btnSendChat: document.getElementById('btn-send-chat'),
    chatUnreadBadge: document.getElementById('chat-unread-badge'),
    fileDropzone: document.getElementById('file-dropzone'),
    fileInput: document.getElementById('file-input'),
    fileTransfersList: document.getElementById('file-transfers-list'),
    rosterCount: document.getElementById('roster-count'),
    rosterList: document.getElementById('roster-list'),
    btnHostMuteAll: document.getElementById('btn-host-mute-all'),

    wbImgBtn: document.getElementById('wb-img-btn'),
    wbImgInput: document.getElementById('wb-img-input'),

    // Dock Buttons
    dockBtnMic: document.getElementById('dock-btn-mic'),
    dockBtnCam: document.getElementById('dock-btn-cam'),
    dockBtnScreen: document.getElementById('dock-btn-screen'),
    dockBtnWb: document.getElementById('dock-btn-wb'),
    dockBtnHand: document.getElementById('dock-btn-hand'),
    dockBtnChat: document.getElementById('dock-btn-chat'),
    dockBtnFiles: document.getElementById('dock-btn-files'),
    dockBtnRoster: document.getElementById('dock-btn-roster'),
    dockBtnRecord: document.getElementById('dock-btn-record'),
    recordIndicator: document.getElementById('record-indicator'),
    dockBtnReact: document.getElementById('dock-btn-react'),
    reactionPicker: document.getElementById('reaction-picker'),
    dockBtnLeave: document.getElementById('dock-btn-leave'),

    reactionStage: document.getElementById('reaction-stage'),
    securityPill: document.querySelector('.security-pill'),
    modalSecurity: document.getElementById('modal-security'),
    btnCloseSecurityModal: document.getElementById('btn-close-security-modal'),
    securityFingerprint: document.getElementById('security-fingerprint'),
    btnCopyFingerprint: document.getElementById('btn-copy-fingerprint'),

    toastContainer: document.getElementById('toast-container')
  };

  // --- Toast Notification Helper ---
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';
    if (type === 'hand') icon = '✋';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    els.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // --- Initialization ---
  async function init() {
    state.mediaManager = new MediaManager();

    // Parse URL room parameter if provided (e.g. ?room=design-sync)
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
      els.joinRoomId.value = roomFromUrl;
    }

    // Check existing authentication token
    await checkAuthSession();

    // Start Lobby Media Preview
    await startLobbyPreview();

    // Populate Device selectors
    await populateDevices();

    // Bind Event Listeners
    bindLobbyEvents();
    bindMeetingEvents();
    bindWhiteboardTools();
  }

  // --- Authentication Helpers ---
  async function checkAuthSession() {
    if (!state.token) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${state.token}` }
      });
      if (res.ok) {
        state.user = await res.json();
        setAuthenticatedState(state.user);
      } else {
        logout();
      }
    } catch (e) {
      logout();
    }
  }

  function setAuthenticatedState(user) {
    els.userSessionLabel.textContent = `Signed in as: ${user.displayName} (@${user.username})`;
    els.joinDisplayName.value = user.displayName;
    els.btnLogout.classList.remove('hidden');
    switchLobbyTab('join');
  }

  function logout() {
    state.token = null;
    state.user = null;
    localStorage.removeItem('collab_jwt_token');
    els.userSessionLabel.textContent = 'Connecting as Guest';
    els.btnLogout.classList.add('hidden');
    els.joinDisplayName.value = 'Guest User';
  }

  // --- Lobby Preview & Devices ---
  async function startLobbyPreview() {
    try {
      const stream = await state.mediaManager.getLocalMedia({ video: true, audio: true });
      state.previewStream = stream;
      els.previewVideo.srcObject = stream;

      state.mediaManager.onAudioLevelChange = (level) => {
        if (els.lobbyAudioMeter) {
          els.lobbyAudioMeter.style.width = `${level}%`;
        }
      };
    } catch (err) {
      console.warn('Lobby preview initialization warning:', err);
    }
  }

  async function populateDevices() {
    const devices = await state.mediaManager.getDevices();

    els.lobbySelectAudio.innerHTML = '';
    devices.audioInputs.forEach((dev, i) => {
      const opt = document.createElement('option');
      opt.value = dev.deviceId;
      opt.textContent = dev.label || `Microphone ${i + 1}`;
      els.lobbySelectAudio.appendChild(opt);
    });

    els.lobbySelectVideo.innerHTML = '';
    devices.videoInputs.forEach((dev, i) => {
      const opt = document.createElement('option');
      opt.value = dev.deviceId;
      opt.textContent = dev.label || `Camera ${i + 1}`;
      els.lobbySelectVideo.appendChild(opt);
    });
  }

  // --- Lobby Event Listeners ---
  function switchLobbyTab(tabName) {
    els.tabJoin.classList.toggle('active', tabName === 'join');
    els.tabLogin.classList.toggle('active', tabName === 'login');
    els.tabRegister.classList.toggle('active', tabName === 'register');

    els.formJoinSection.classList.toggle('hidden', tabName !== 'join');
    els.formLoginSection.classList.toggle('hidden', tabName !== 'login');
    els.formRegisterSection.classList.toggle('hidden', tabName !== 'register');
  }

  function bindLobbyEvents() {
    els.tabJoin.addEventListener('click', () => switchLobbyTab('join'));
    els.tabLogin.addEventListener('click', () => switchLobbyTab('login'));
    els.tabRegister.addEventListener('click', () => switchLobbyTab('register'));

    // Lobby media preview toggles
    els.lobbyToggleMic.addEventListener('click', () => {
      const active = state.mediaManager.toggleAudio();
      els.lobbyToggleMic.classList.toggle('muted', !active);
    });

    els.lobbyToggleCam.addEventListener('click', () => {
      const active = state.mediaManager.toggleVideo();
      els.lobbyToggleCam.classList.toggle('muted', !active);
    });

    els.lobbySelectAudio.addEventListener('change', async () => {
      await state.mediaManager.getLocalMedia({
        video: !state.mediaManager.isVideoMuted,
        audio: true,
        audioDeviceId: els.lobbySelectAudio.value,
        videoDeviceId: els.lobbySelectVideo.value
      });
      els.previewVideo.srcObject = state.mediaManager.localStream;
    });

    els.lobbySelectVideo.addEventListener('change', async () => {
      await state.mediaManager.getLocalMedia({
        video: true,
        audio: !state.mediaManager.isAudioMuted,
        audioDeviceId: els.lobbySelectAudio.value,
        videoDeviceId: els.lobbySelectVideo.value
      });
      els.previewVideo.srcObject = state.mediaManager.localStream;
    });

    // Login Form Submit
    els.btnSubmitLogin.addEventListener('click', async () => {
      const username = els.loginUsername.value.trim();
      const password = els.loginPassword.value;
      if (!username || !password) {
        return showToast('Please enter username and password', 'error');
      }

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
          state.token = data.token;
          state.user = data.user;
          localStorage.setItem('collab_jwt_token', data.token);
          setAuthenticatedState(data.user);
          showToast(`Welcome back, ${data.user.displayName}!`, 'success');
        } else {
          showToast(data.error || 'Login failed', 'error');
        }
      } catch (e) {
        showToast('Network error during login', 'error');
      }
    });

    // Register Form Submit
    els.btnSubmitRegister.addEventListener('click', async () => {
      const username = els.regUsername.value.trim();
      const email = els.regEmail.value.trim();
      const displayName = els.regDisplayName.value.trim();
      const password = els.regPassword.value;

      if (!username || !email || !password) {
        return showToast('Please complete all registration fields', 'error');
      }

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, displayName, password })
        });
        const data = await res.json();
        if (res.ok) {
          state.token = data.token;
          state.user = data.user;
          localStorage.setItem('collab_jwt_token', data.token);
          setAuthenticatedState(data.user);
          showToast('Account created successfully!', 'success');
        } else {
          showToast(data.error || 'Registration failed', 'error');
        }
      } catch (e) {
        showToast('Network error during registration', 'error');
      }
    });

    els.btnLogout.addEventListener('click', logout);

    // Join Meeting Button
    els.btnJoinMeeting.addEventListener('click', joinMeetingRoom);
  }

  // --- Join Meeting Room Execution ---
  async function joinMeetingRoom() {
    const roomId = els.joinRoomId.value.trim().toLowerCase();
    const displayName = els.joinDisplayName.value.trim() || 'Guest';
    const passcode = els.joinRoomPasscode.value;

    if (!roomId) {
      return showToast('Please enter a valid Room Name', 'error');
    }

    state.roomId = roomId;
    state.roomPasscode = passcode;

    // Derive AES-256-GCM room key for client-side encryption
    state.roomKey = await CryptoUtil.deriveRoomKey(roomId, passcode);

    // Initialize Socket.io connection with auth token
    const socketOptions = {
      auth: {
        token: state.token,
        displayName: displayName
      },
      transports: ['websocket', 'polling']
    };

    state.socket = io(socketOptions);

    // Initialize Managers
    state.webrtcManager = new WebRTCManager(state.socket, state.mediaManager.localStream);
    state.chatManager = new ChatManager(state.socket, els.chatMessages, els.chatUnreadBadge);
    state.fileShareManager = new FileShareManager(state.webrtcManager, async () => state.roomKey, {
      onFileSendStart: (meta) => renderFileTransferCard(meta, true),
      onFileSendProgress: ({ fileId, progress }) => updateTransferProgress(fileId, progress),
      onFileSendComplete: ({ fileId }) => completeTransferCard(fileId),
      onFileReceiveStart: (meta) => renderFileTransferCard(meta, false),
      onFileReceiveProgress: ({ fileId, progress }) => updateTransferProgress(fileId, progress),
      onFileReceiveComplete: (fileInfo) => renderCompletedReceivedFile(fileInfo),
      onError: (err) => showToast(err, 'error')
    });

    // Initialize Collaborative Whiteboard
    state.whiteboard = new Whiteboard(els.wbCanvas, els.wbCursorOverlay, state.socket, state.webrtcManager);

    // Bind WebRTC manager callbacks
    state.webrtcManager.onRemoteStream = (socketId, stream) => {
      attachRemoteStream(socketId, stream);
    };

    state.webrtcManager.onPeerDisconnected = (socketId) => {
      removePeer(socketId);
    };

    state.webrtcManager.onDataMessage = (socketId, rawData) => {
      state.whiteboard.handleDataChannelMessage(rawData);
      state.fileShareManager.handleDataChannelMessage(socketId, rawData);
    };

    // Socket.io Signaling Handlers
    bindSocketSignaling();

    // Perform Room Join handshake
    state.socket.emit('join-room', {
      roomId,
      passcode,
      displayName
    }, (response) => {
      if (!response || response.error) {
        showToast(response?.error || 'Failed to join room', 'error');
        state.socket.disconnect();
        return;
      }

      state.isHost = response.isHost;

      // Transition to Meeting View
      els.lobbyView.classList.add('hidden');
      els.meetingView.classList.remove('hidden');
      els.activeRoomTitle.textContent = `Room: ${roomId}`;

      if (state.isHost) {
        els.btnHostLock.classList.remove('hidden');
        els.btnHostMuteAll.classList.remove('hidden');
      }

      // Add local video tile
      createLocalVideoTile(displayName);

      // Render existing whiteboard strokes
      if (response.strokesHistory && response.strokesHistory.length > 0) {
        response.strokesHistory.forEach(item => {
          state.whiteboard.history.push(item);
          state.whiteboard.executeItem(item);
        });
      }

      // Connect to existing peers in room via WebRTC Offer
      if (response.peers && response.peers.length > 0) {
        response.peers.forEach(peer => {
          addPeerTile(peer);
          state.webrtcManager.callPeer(peer.socketId);
        });
      }

      updateRosterUI();
      showToast(`Connected to ${roomId}`, 'success');
      state.chatManager.playSound('join');
    });
  }

  // --- Socket Signaling Handlers ---
  function bindSocketSignaling() {
    state.socket.on('peer-signal', async ({ senderSocketId, signalData }) => {
      await state.webrtcManager.handleSignal(senderSocketId, signalData);
    });

    state.socket.on('peer-joined', (peerInfo) => {
      showToast(`${peerInfo.displayName} joined`, 'info');
      state.chatManager.playSound('join');
      addPeerTile(peerInfo);
      updateRosterUI();
    });

    state.socket.on('peer-left', ({ socketId }) => {
      const peer = state.peers.get(socketId);
      if (peer) {
        showToast(`${peer.info.displayName} left the call`, 'info');
        state.chatManager.playSound('leave');
        removePeer(socketId);
        updateRosterUI();
      }
    });

    state.socket.on('peer-media-state', ({ socketId, audioMuted, videoMuted, isScreenSharing }) => {
      const peer = state.peers.get(socketId);
      if (peer) {
        if (typeof audioMuted === 'boolean') {
          peer.info.audioMuted = audioMuted;
          const micBadge = peer.cardEl.querySelector('.mic-status');
          if (micBadge) micBadge.classList.toggle('danger', audioMuted);
        }
        if (typeof videoMuted === 'boolean') {
          peer.info.videoMuted = videoMuted;
          const avatar = peer.cardEl.querySelector('.avatar-placeholder');
          if (avatar) avatar.style.display = videoMuted ? 'flex' : 'none';
        }
      }
    });

    state.socket.on('chat-message', (msg) => {
      const isLocal = msg.senderSocketId === state.socket.id;
      state.chatManager.addMessage(msg, isLocal);
    });

    state.socket.on('peer-hand-raised', ({ socketId, displayName, raised }) => {
      if (raised) {
        showToast(`${displayName} raised their hand`, 'hand');
        state.chatManager.playSound('hand');
      }
      const peer = state.peers.get(socketId);
      if (peer) {
        const handEl = peer.cardEl.querySelector('.hand-badge');
        if (handEl) handEl.classList.toggle('hidden', !raised);
      }
    });

    state.socket.on('request-mute-mic', () => {
      state.mediaManager.toggleAudio(false);
      updateMicButtonUI(false);
      showToast('Host muted everyone', 'info');
      state.socket.emit('media-state-change', { audioMuted: true });
    });

    state.socket.on('kicked-by-host', () => {
      alert('You have been removed from the meeting by the host.');
      leaveMeeting();
    });

    state.socket.on('room-lock-changed', ({ isLocked }) => {
      showToast(`Room was ${isLocked ? 'locked' : 'unlocked'} by host`, 'info');
    });

    state.socket.on('peer-reaction', ({ emoji }) => {
      spawnFlyingEmoji(emoji);
    });

    state.socket.on('host-changed', ({ newHostSocketId, displayName }) => {
      showToast(`${displayName} is now the host`, 'info');
      if (newHostSocketId === state.socket.id) {
        state.isHost = true;
        els.btnHostLock.classList.remove('hidden');
        els.btnHostMuteAll.classList.remove('hidden');
      }
    });
  }

  function spawnFlyingEmoji(emoji) {
    if (!els.reactionStage) return;
    const el = document.createElement('div');
    el.className = 'flying-emoji';
    el.textContent = emoji;
    const randLeft = Math.floor(Math.random() * 70) + 15;
    el.style.left = `${randLeft}%`;
    els.reactionStage.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3200);
  }

  // --- Video Grid Tiles Management ---
  function createLocalVideoTile(displayName) {
    const card = document.createElement('div');
    card.id = 'video-card-local';
    card.className = 'video-card is-local';

    card.innerHTML = `
      <video autoplay playsinline muted></video>
      <div class="avatar-placeholder hidden">${displayName.charAt(0)}</div>
      <div class="video-overlay-info">
        <span class="participant-tag">
          ${displayName} (You)
          ${state.isHost ? '<span style="color: #f59e0b;">★ Host</span>' : ''}
          <span class="hand-badge hidden">✋</span>
        </span>
        <div class="video-status-icons">
          <button class="pin-btn" title="Pin / Spotlight">📌</button>
          <span class="status-icon-badge mic-status">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
          </span>
        </div>
      </div>
    `;

    card.querySelector('.pin-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.toggle('is-pinned');
    });
    card.addEventListener('dblclick', () => {
      card.classList.toggle('is-pinned');
    });

    const video = card.querySelector('video');
    video.srcObject = state.mediaManager.localStream;
    els.videoGrid.appendChild(card);
  }

  function addPeerTile(peerInfo) {
    if (state.peers.has(peerInfo.socketId)) return;

    const card = document.createElement('div');
    card.id = `video-card-${peerInfo.socketId}`;
    card.className = 'video-card';

    card.innerHTML = `
      <video autoplay playsinline></video>
      <div class="avatar-placeholder">${peerInfo.displayName.charAt(0)}</div>
      <div class="video-overlay-info">
        <span class="participant-tag">
          ${peerInfo.displayName}
          ${peerInfo.isHost ? '<span style="color: #f59e0b;">★ Host</span>' : ''}
          <span class="hand-badge ${peerInfo.handRaised ? '' : 'hidden'}">✋</span>
        </span>
        <div class="video-status-icons">
          <button class="pin-btn" title="Pin / Spotlight">📌</button>
          <span class="status-icon-badge mic-status ${peerInfo.audioMuted ? 'danger' : ''}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
          </span>
        </div>
      </div>
    `;

    card.querySelector('.pin-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.toggle('is-pinned');
    });
    card.addEventListener('dblclick', () => {
      card.classList.toggle('is-pinned');
    });

    const video = card.querySelector('video');
    els.videoGrid.appendChild(card);

    state.peers.set(peerInfo.socketId, {
      info: peerInfo,
      cardEl: card,
      videoEl: video
    });
  }

  function attachRemoteStream(socketId, stream) {
    const peer = state.peers.get(socketId);
    if (peer && peer.videoEl) {
      peer.videoEl.srcObject = stream;
      const avatar = peer.cardEl.querySelector('.avatar-placeholder');
      if (avatar) avatar.style.display = 'none';
    }
  }

  function removePeer(socketId) {
    const peer = state.peers.get(socketId);
    if (peer) {
      if (peer.cardEl && peer.cardEl.parentNode) {
        peer.cardEl.parentNode.removeChild(peer.cardEl);
      }
      state.peers.delete(socketId);
      state.webrtcManager.closePeer(socketId);
    }
    updateRosterUI();
  }

  function updateRosterUI() {
    els.rosterCount.textContent = state.peers.size + 1;
    els.rosterList.innerHTML = '';

    // Local user
    const localItem = document.createElement('div');
    localItem.className = 'participant-item';
    localItem.innerHTML = `
      <span>${els.joinDisplayName.value} (You) ${state.isHost ? '★' : ''}</span>
      <span style="font-size: 11px; color: var(--accent);">Connected</span>
    `;
    els.rosterList.appendChild(localItem);

    // Remote peers
    for (const [sId, peer] of state.peers.entries()) {
      const item = document.createElement('div');
      item.className = 'participant-item';
      item.innerHTML = `
        <span>${peer.info.displayName} ${peer.info.isHost ? '★' : ''}</span>
        ${state.isHost ? `<button class="btn-secondary" style="font-size: 11px; padding: 2px 6px;" onclick="window._kickPeer('${sId}')">Remove</button>` : ''}
      `;
      els.rosterList.appendChild(item);
    }
  }

  window._kickPeer = (socketId) => {
    if (state.isHost && state.socket) {
      state.socket.emit('host-kick-peer', { targetSocketId: socketId });
    }
  };

  // --- Meeting Controls & Sidebar Toggles ---
  function updateMicButtonUI(enabled) {
    els.dockBtnMic.classList.toggle('active', enabled);
    els.dockBtnMic.style.background = enabled ? 'var(--primary)' : 'var(--bg-tertiary)';
  }

  function bindMeetingEvents() {
    // Microphone Toggle
    els.dockBtnMic.addEventListener('click', () => {
      const active = state.mediaManager.toggleAudio();
      updateMicButtonUI(active);
      const localMicBadge = document.querySelector('#video-card-local .mic-status');
      if (localMicBadge) localMicBadge.classList.toggle('danger', !active);
      state.socket.emit('media-state-change', { audioMuted: !active });
    });

    // Camera Toggle
    els.dockBtnCam.addEventListener('click', () => {
      const active = state.mediaManager.toggleVideo();
      els.dockBtnCam.classList.toggle('active', active);
      const avatar = document.querySelector('#video-card-local .avatar-placeholder');
      if (avatar) avatar.style.display = active ? 'none' : 'flex';
      state.socket.emit('media-state-change', { videoMuted: !active });
    });

    // Screen Sharing Toggle
    els.dockBtnScreen.addEventListener('click', async () => {
      if (state.mediaManager.isScreenSharing) {
        state.mediaManager.stopScreenShare();
      } else {
        try {
          const screenStream = await state.mediaManager.startScreenShare();
          els.dockBtnScreen.classList.add('active');
          els.presentationStage.classList.remove('hidden');
          els.presentationVideo.srcObject = screenStream;

          const screenTrack = screenStream.getVideoTracks()[0];
          await state.webrtcManager.replaceVideoTrack(screenTrack);
          state.socket.emit('media-state-change', { isScreenSharing: true });

          state.mediaManager.onScreenShareEnded = async () => {
            els.dockBtnScreen.classList.remove('active');
            els.presentationStage.classList.add('hidden');
            const camTrack = state.mediaManager.localStream?.getVideoTracks()[0];
            if (camTrack) {
              await state.webrtcManager.replaceVideoTrack(camTrack);
            }
            state.socket.emit('media-state-change', { isScreenSharing: false });
          };
        } catch (err) {
          showToast('Screen share canceled or denied', 'info');
        }
      }
    });

    // Whiteboard Toggle
    els.dockBtnWb.addEventListener('click', () => {
      const isHidden = els.whiteboardContainer.classList.contains('hidden');
      els.whiteboardContainer.classList.toggle('hidden', !isHidden);
      els.dockBtnWb.classList.toggle('active', isHidden);
      if (isHidden) {
        state.whiteboard.initCanvasSize();
      }
    });

    els.wbCloseBtn.addEventListener('click', () => {
      els.whiteboardContainer.classList.add('hidden');
      els.dockBtnWb.classList.remove('active');
    });

    // Hand Raise Toggle
    els.dockBtnHand.addEventListener('click', () => {
      state.isHandRaised = !state.isHandRaised;
      els.dockBtnHand.classList.toggle('active', state.isHandRaised);
      const handBadge = document.querySelector('#video-card-local .hand-badge');
      if (handBadge) handBadge.classList.toggle('hidden', !state.isHandRaised);
      state.socket.emit('raise-hand', { raised: state.isHandRaised });
    });

    // Sidebar Toggles
    const toggleSidebar = (tabName) => {
      const isAlreadyOpen = !els.meetingSidebar.classList.contains('hidden');
      if (isAlreadyOpen && state.activeSidebarTab === tabName) {
        els.meetingSidebar.classList.add('hidden');
        state.chatManager.setChatOpen(false);
        return;
      }

      state.activeSidebarTab = tabName;
      els.meetingSidebar.classList.remove('hidden');

      els.sidebarTabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      });

      els.tabContentChat.classList.toggle('hidden', tabName !== 'chat');
      els.tabContentFiles.classList.toggle('hidden', tabName !== 'files');
      els.tabContentRoster.classList.toggle('hidden', tabName !== 'roster');

      if (tabName === 'chat') {
        state.chatManager.setChatOpen(true);
      } else {
        state.chatManager.setChatOpen(false);
      }
    };

    els.dockBtnChat.addEventListener('click', () => toggleSidebar('chat'));
    els.dockBtnFiles.addEventListener('click', () => toggleSidebar('files'));
    els.dockBtnRoster.addEventListener('click', () => toggleSidebar('roster'));

    els.sidebarTabBtns.forEach(btn => {
      btn.addEventListener('click', () => toggleSidebar(btn.dataset.tab));
    });

    els.btnCloseSidebar.addEventListener('click', () => {
      els.meetingSidebar.classList.add('hidden');
      state.chatManager.setChatOpen(false);
    });

    // Chat Message Sending
    const sendChat = () => {
      const text = els.chatInputText.value;
      if (text && text.trim()) {
        state.chatManager.sendMessage(text);
        els.chatInputText.value = '';
      }
    };
    els.btnSendChat.addEventListener('click', sendChat);
    els.chatInputText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat();
    });

    // File Sharing Upload
    els.fileDropzone.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      if (els.fileInput.files.length > 0) {
        state.fileShareManager.sendFile(els.fileInput.files[0], els.joinDisplayName.value);
        els.fileInput.value = '';
      }
    });

    els.fileDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.fileDropzone.classList.add('dragover');
    });

    els.fileDropzone.addEventListener('dragleave', () => {
      els.fileDropzone.classList.remove('dragover');
    });

    els.fileDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.fileDropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        state.fileShareManager.sendFile(e.dataTransfer.files[0], els.joinDisplayName.value);
      }
    });

    // Room Link Copy
    els.btnCopyInvite.addEventListener('click', () => {
      const url = `${window.location.origin}/?room=${state.roomId}`;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Invite link copied to clipboard!', 'success');
      });
    });

    // Host Controls
    els.btnHostLock.addEventListener('click', () => {
      if (!state.isHost) return;
      const willLock = els.btnHostLock.textContent.includes('Lock');
      state.socket.emit('host-lock-room', { locked: willLock }, (res) => {
        if (res && res.success) {
          els.btnHostLock.textContent = willLock ? '🔓 Unlock Room' : '🔒 Lock Room';
        }
      });
    });

    els.btnHostMuteAll.addEventListener('click', () => {
      if (state.isHost && state.socket) {
        state.socket.emit('host-mute-all');
        showToast('Muted all participants', 'info');
      }
    });

    // Meeting Recording Toggle
    let mediaRecorder = null;
    let recordedChunks = [];

    els.dockBtnRecord.addEventListener('click', () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        els.recordIndicator.classList.remove('recording');
        els.dockBtnRecord.classList.remove('active');
        showToast('Meeting recording saved and downloaded', 'success');
        return;
      }

      try {
        const streamToRecord = state.mediaManager.screenStream || state.mediaManager.localStream;
        if (!streamToRecord) {
          return showToast('No active stream to record', 'error');
        }

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(streamToRecord, { mimeType: 'video/webm' });
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `collabsync-meeting-${Date.now()}.webm`;
          a.click();
          URL.revokeObjectURL(url);
        };

        mediaRecorder.start(1000);
        els.recordIndicator.classList.add('recording');
        els.dockBtnRecord.classList.add('active');
        showToast('Recording meeting started...', 'info');
      } catch (err) {
        console.error('Recording error:', err);
        showToast('Recording failed: ' + err.message, 'error');
      }
    });

    // Emoji Reactions Trigger
    els.dockBtnReact.addEventListener('click', (e) => {
      e.stopPropagation();
      els.reactionPicker.classList.toggle('hidden');
    });

    document.querySelectorAll('.reaction-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        if (emoji && state.socket) {
          state.socket.emit('send-reaction', { emoji });
          spawnFlyingEmoji(emoji);
        }
        els.reactionPicker.classList.add('hidden');
      });
    });

    document.addEventListener('click', () => {
      if (els.reactionPicker && !els.reactionPicker.classList.contains('hidden')) {
        els.reactionPicker.classList.add('hidden');
      }
    });

    // Security Modal Opening & Fingerprint Copy
    els.securityPill.addEventListener('click', async () => {
      els.modalSecurity.classList.remove('hidden');
      const fingerprint = await CryptoUtil.getRoomFingerprint(state.roomId, state.roomPasscode);
      els.securityFingerprint.textContent = fingerprint;
    });

    els.btnCloseSecurityModal.addEventListener('click', () => {
      els.modalSecurity.classList.add('hidden');
    });

    els.btnCopyFingerprint.addEventListener('click', () => {
      navigator.clipboard.writeText(els.securityFingerprint.textContent).then(() => {
        showToast('Safety fingerprint copied to clipboard!', 'success');
      });
    });

    // Leave Meeting Button
    els.dockBtnLeave.addEventListener('click', leaveMeeting);
  }

  // --- Whiteboard Controls Binding ---
  function bindWhiteboardTools() {
    // Whiteboard Image Upload
    if (els.wbImgBtn && els.wbImgInput) {
      els.wbImgBtn.addEventListener('click', () => {
        els.wbImgInput.click();
      });
      els.wbImgInput.addEventListener('change', () => {
        if (els.wbImgInput.files && els.wbImgInput.files.length > 0) {
          state.whiteboard.addImageFromFile(els.wbImgInput.files[0]);
          els.wbImgInput.value = '';
        }
      });
    }
    const toolBtns = document.querySelectorAll('.wb-tool-btn[data-tool]');
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.whiteboard.currentTool = btn.dataset.tool;
      });
    });

    const colorDots = document.querySelectorAll('.color-dot');
    colorDots.forEach(dot => {
      dot.addEventListener('click', () => {
        colorDots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        state.whiteboard.currentColor = dot.dataset.color;
      });
    });

    els.wbSizeSlider.addEventListener('input', (e) => {
      state.whiteboard.currentSize = parseInt(e.target.value, 10);
    });

    els.wbUndoBtn.addEventListener('click', () => state.whiteboard.undo());
    els.wbRedoBtn.addEventListener('click', () => state.whiteboard.redo());
    els.wbClearBtn.addEventListener('click', () => {
      if (confirm('Clear the entire collaborative whiteboard?')) {
        state.whiteboard.clear(true);
      }
    });
    els.wbExportBtn.addEventListener('click', () => state.whiteboard.exportImage());
  }

  // --- File Transfer Card UI Helpers ---
  function renderFileTransferCard(meta, isSender) {
    const card = document.createElement('div');
    card.id = `transfer-${meta.fileId}`;
    card.className = 'file-item-card';

    const formattedSize = (meta.fileSize / 1024).toFixed(1) + ' KB';

    card.innerHTML = `
      <div class="file-meta-row">
        <span class="file-name" title="${meta.fileName}">${meta.fileName}</span>
        <span class="file-security-badge">AES-256 E2EE</span>
      </div>
      <div style="font-size: 11px; color: var(--text-muted);">
        ${isSender ? 'Sending to peers' : 'Receiving from ' + meta.senderName} • ${formattedSize}
      </div>
      <div class="transfer-progress-bar">
        <div class="transfer-progress-fill" style="width: 0%;"></div>
      </div>
    `;

    els.fileTransfersList.prepend(card);
  }

  function updateTransferProgress(fileId, progress) {
    const card = document.getElementById(`transfer-${fileId}`);
    if (card) {
      const bar = card.querySelector('.transfer-progress-fill');
      if (bar) bar.style.width = `${progress}%`;
    }
  }

  function completeTransferCard(fileId) {
    const card = document.getElementById(`transfer-${fileId}`);
    if (card) {
      const bar = card.querySelector('.transfer-progress-bar');
      if (bar) bar.remove();
      const status = document.createElement('span');
      status.style.fontSize = '11px';
      status.style.color = 'var(--accent)';
      status.textContent = '✓ Sent encrypted via WebRTC';
      card.appendChild(status);
    }
  }

  function renderCompletedReceivedFile(fileInfo) {
    let card = document.getElementById(`transfer-${fileInfo.fileId}`);
    if (!card) {
      card = document.createElement('div');
      card.id = `transfer-${fileInfo.fileId}`;
      card.className = 'file-item-card';
      els.fileTransfersList.prepend(card);
    }

    const formattedSize = (fileInfo.fileSize / 1024).toFixed(1) + ' KB';

    card.innerHTML = `
      <div class="file-meta-row">
        <span class="file-name" title="${fileInfo.fileName}">${fileInfo.fileName}</span>
        <span class="file-security-badge">Verified SHA-256</span>
      </div>
      <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">
        From ${fileInfo.senderName} • ${formattedSize}
      </div>
      <a href="${fileInfo.downloadUrl}" download="${fileInfo.fileName}" class="btn-primary" style="padding: 6px 12px; font-size: 12px; text-decoration: none;">
        ⬇ Download File
      </a>
    `;

    showToast(`Received encrypted file: ${fileInfo.fileName}`, 'success');
  }

  // --- Leave Meeting Cleanup ---
  function leaveMeeting() {
    if (state.socket) {
      state.socket.emit('leave-room');
      state.socket.disconnect();
      state.socket = null;
    }

    if (state.webrtcManager) {
      state.webrtcManager.closeAll();
      state.webrtcManager = null;
    }

    // Clean up DOM video cards
    els.videoGrid.innerHTML = '';
    els.chatMessages.innerHTML = '';
    els.fileTransfersList.innerHTML = '';
    els.rosterList.innerHTML = '';
    state.peers.clear();

    // Hide meeting view & restore lobby
    els.meetingView.classList.add('hidden');
    els.whiteboardContainer.classList.add('hidden');
    els.presentationStage.classList.add('hidden');
    els.meetingSidebar.classList.add('hidden');
    els.lobbyView.classList.remove('hidden');

    // Restart lobby preview
    startLobbyPreview();
    showToast('Left meeting', 'info');
  }

  // Start app on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', init);
})();
