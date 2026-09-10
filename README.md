# CollabSync - Real-Time Communication & Collaboration App

A production-grade, full-stack video conferencing and collaboration platform featuring multi-user WebRTC video/audio streaming, screen sharing, collaborative drawing whiteboard, end-to-end encrypted peer-to-peer file sharing, and secure JWT user authentication.

Built to fulfill **TASK 4: Real-Time Communication App**.

---

## 🌟 Key Features

### 1. Multi-User Video & Audio Conferencing (WebRTC Mesh)
- **Zero-Latency Peer-to-Peer Streaming**: Implements full-mesh WebRTC (`RTCPeerConnection`) with Google STUN servers.
- **Adaptive Responsive Video Grid**: Auto-arranges video tiles dynamically for 1-on-1, 3-way, and large groups.
- **Dynamic Active Speaker Detection**: Web Audio API volume analyzers detect active speakers in real time and illuminate video card borders.
- **Device Management**: Switch between cameras and microphones dynamically from the pre-call lobby or in-call settings.

### 2. High-Definition Screen Sharing
- Native browser screen capture via `navigator.mediaDevices.getDisplayMedia`.
- Seamless track negotiation: Swaps video tracks on active peer connections without disconnecting peers or dropping calls.
- High-resolution presentation view mode.

### 3. Collaborative Real-Time Whiteboard
- **Multi-user Drawing Engine**: Synchronized via low-latency WebRTC DataChannels with Socket.io fallback.
- **Rich Toolkit**: Freehand pen, highlighter, eraser, shapes (lines, arrows, rectangles, circles), and text notes.
- **History & Canvas Control**: 100-step Undo/Redo history, clear canvas with confirmation, and one-click **PNG image export**.
- **Multiplayer Live Cursors**: See collaborator cursor locations and name tags hovering over the canvas in real time.

### 4. End-to-End Encrypted File Sharing
- **Direct P2P DataChannel Transfer**: Chunks binary file data into 16 KB packets streamed directly between peers without server storage.
- **Client-Side AES-256-GCM Encryption**: Uses the W3C Web Crypto API with PBKDF2 room key derivation. Files are encrypted on the sender's device before sending.
- **SHA-256 Integrity Verification**: Calculates and verifies cryptographic hash digests upon reassembly.
- **Transfer Progress**: Visual percentage progress bars, drag-and-drop file dropzone, and safe download triggers.

### 5. Authentication & Meeting Security
- **Salted Password Hashing**: Passwords stored using `bcryptjs` (salt rounds: 10).
- **JSON Web Tokens (JWT)**: Cryptographically signed tokens with 7-day expiration for REST API and Socket.io handshakes.
- **Room Passcodes & Host Controls**: Private room locks, room passcodes, host ability to mute all participants and kick unruly members.
- **Guest Quick-Join**: Guests can join directly via invite links with custom display names without forced registration.
- **DTLS-SRTP Encryption**: Standard hardware-accelerated WebRTC media encryption protects all voice and video packets in transit.

---

## 📁 Project Architecture

```
realtime-collab-app/
├── package.json              # Node.js dependencies & scripts
├── start.bat                 # One-click Windows startup script
├── README.md                 # Complete documentation
├── server/
│   ├── server.js             # HTTP/Express server & Socket.io initialization
│   ├── auth.js               # User auth routes, JWT token issuance & verification
│   ├── db.js                 # File-backed JSON persistence layer (data/db.json)
│   └── signaling.js          # WebRTC room management & SDP/ICE signaling relay
├── public/
│   ├── index.html            # Single Page Application shell
│   ├── css/
│   │   └── style.css         # Dark glassmorphic design system & responsive layout
│   └── js/
│       ├── app.js            # Main frontend coordinator & UI lifecycle
│       ├── crypto-util.js    # Web Crypto API (AES-256-GCM & SHA-256)
│       ├── media.js          # MediaDevices manager, screen share & audio visualizer
│       ├── webrtc.js         # RTCPeerConnection mesh & DataChannel manager
│       ├── whiteboard.js     # Collaborative HTML5 canvas drawing engine
│       ├── fileshare.js      # Chunked binary streaming & E2EE file assembler
│       └── chat.js           # In-call messaging & Web Audio sound synthesizer
└── scripts/
    └── test_server.js        # Automated test suite (Auth, JWT, Signaling, Whiteboard)
```

---

## 🚀 Quick Start Instructions

### Option 1: Double-Click Startup (Windows)
Double-click [`start.bat`](file:///C:/Users/balaj/.gemini/antigravity/scratch/realtime-collab-app/start.bat) in File Explorer. It automatically launches the server and opens `http://localhost:3000` in your default browser.

### Option 2: Terminal / PowerShell
From the project directory:
```powershell
# Run backend server
node server/server.js
```
Then open your browser to:
```
http://localhost:3000
```

---

## 🧪 Testing Multi-User Video & Collaboration

To test multi-user calling and collaboration locally on a single machine:
1. Open `http://localhost:3000` in **Tab 1** (e.g. Chrome).
2. Enter your name (e.g., "Alice"), enter room `general-room`, and click **Join Meeting Now**.
3. Open `http://localhost:3000` in **Tab 2** (e.g. Edge, or an Incognito window).
4. Enter a different name (e.g., "Bob"), enter room `general-room`, and click **Join Meeting Now**.
5. Both tabs will instantly establish WebRTC peer connections, rendering live video feeds for both participants.
6. Click **Collaborative Whiteboard** on Tab 1, draw a diagram, and observe it appearing synchronously in real-time on Tab 2.
7. Open the **Files** tab on Tab 1, drag and drop any file (image/pdf/document), and watch Tab 2 decrypt and verify the file with a one-click download button.

---

## 🛡️ Running Automated Tests

Run the automated test suite to verify the REST API, JWT auth, database persistence, and Socket.io signaling:
```powershell
node scripts/test_server.js
```
Test Coverage:
- `POST /api/auth/register` (Account creation with password hash verification)
- Duplicate registration collision prevention (HTTP 409)
- `POST /api/auth/login` (Credential validation and JWT generation)
- Protected route authentication (`GET /api/auth/me`)
- Room status verification API
- Socket.io signaling handshake and WebRTC room join cycle
- Whiteboard stroke and chat broadcast validation
