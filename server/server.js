const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

const { authRouter, socketAuthMiddleware } = require('./auth');
const { initSignaling } = require('./signaling');
const db = require('./db');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io with CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e8 // 100 MB for chunk transfers if fallback needed
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// API Routes
app.use('/api/auth', authRouter);

// Verify room status endpoint
app.get('/api/room/:roomId/status', (req, res) => {
  const { roomId } = req.params;
  const cleanId = roomId.trim().toLowerCase();
  const room = db.getRoom(cleanId);
  if (!room) {
    return res.json({ exists: false, isLocked: false, requiresPasscode: false });
  }
  res.json({
    exists: true,
    isLocked: room.isLocked,
    requiresPasscode: !!room.passcodeHash
  });
});

// Fallback SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Attach Socket.io Authentication Middleware & Signaling Handlers
io.use(socketAuthMiddleware);
initSignaling(io);

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log('====================================================');
    console.log(`🚀 Real-Time Collaboration Server running on port ${PORT}`);
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
    console.log(`🔒 DTLS-SRTP WebRTC Media & Client AES-256 E2EE Enabled`);
    console.log('====================================================');
  });
}

module.exports = { app, server, io };
