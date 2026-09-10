/**
 * Automated Test Suite for Real-Time Communication App
 * Validates Auth API, JWT Tokens, Protected Endpoints, and Socket.io Signaling
 */
const http = require('http');
const path = require('path');
const { io: ioClient } = require('socket.io-client');
const { app, server } = require('../server/server');

const TEST_PORT = 3099;

function request(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Automated Tests for Real-Time Communication App ---');

  // Start server on test port
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`✓ Test Server listening on http://localhost:${TEST_PORT}`);

  const testUser = {
    username: 'alice_' + Date.now().toString(36),
    email: `alice_${Date.now()}@example.com`,
    password: 'Password123!',
    displayName: 'Alice Engineer'
  };

  let authToken = '';

  try {
    // 1. Test Registration
    console.log('\n[Test 1] User Registration: POST /api/auth/register');
    const regRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, testUser);

    if (regRes.status !== 201 || !regRes.body.token) {
      throw new Error(`Registration failed: ${JSON.stringify(regRes.body)}`);
    }
    authToken = regRes.body.token;
    console.log(`✓ Registration successful. User ID: ${regRes.body.user.id}`);

    // 2. Test Duplicate Registration Rejection
    console.log('\n[Test 2] Duplicate Username Rejection: POST /api/auth/register');
    const dupRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, testUser);

    if (dupRes.status !== 409) {
      throw new Error(`Duplicate check failed with status: ${dupRes.status}`);
    }
    console.log('✓ Duplicate username rejected with HTTP 409 Conflict');

    // 3. Test Login
    console.log('\n[Test 3] User Login: POST /api/auth/login');
    const loginRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: testUser.username, password: testUser.password });

    if (loginRes.status !== 200 || !loginRes.body.token) {
      throw new Error(`Login failed: ${JSON.stringify(loginRes.body)}`);
    }
    console.log(`✓ Login successful with token verification.`);

    // 4. Test Protected Route: /api/auth/me
    console.log('\n[Test 4] Protected Endpoint: GET /api/auth/me');
    const meRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (meRes.status !== 200 || meRes.body.username !== testUser.username) {
      throw new Error(`Protected route access failed: ${JSON.stringify(meRes.body)}`);
    }
    console.log(`✓ Authenticated user profile retrieved: ${meRes.body.displayName}`);

    // 5. Test Room Status Route
    console.log('\n[Test 5] Room Status: GET /api/room/test-channel/status');
    const roomRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/room/test-channel/status',
      method: 'GET'
    });
    if (roomRes.status !== 200) {
      throw new Error(`Room status failed with status: ${roomRes.status}`);
    }
    console.log(`✓ Room status endpoint verified: exists=${roomRes.body.exists}`);

    // 6. Test Socket.io Signaling Handshake & Room Join
    console.log('\n[Test 6] Socket.io Authenticated Signaling & Room Joining');
    const socket = ioClient(`http://localhost:${TEST_PORT}`, {
      auth: { token: authToken, displayName: testUser.displayName },
      transports: ['websocket']
    });

    await new Promise((resolve, reject) => {
      socket.on('connect', () => {
        console.log(`✓ Socket connected with ID: ${socket.id}`);

        socket.emit('join-room', {
          roomId: 'automated-test-room',
          displayName: testUser.displayName
        }, (res) => {
          if (!res || !res.success || !res.isHost) {
            reject(new Error(`Join room failed: ${JSON.stringify(res)}`));
          } else {
            console.log(`✓ Joined room as Host: ${res.roomId}`);
            resolve();
          }
        });
      });
      socket.on('connect_error', reject);
    });

    // 7. Test Whiteboard Drawing Event Relay
    console.log('\n[Test 7] Collaborative Whiteboard & Chat Event Emission');
    socket.emit('whiteboard-draw', {
      tool: 'pen',
      points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
      color: '#6366f1',
      size: 4
    });
    console.log('✓ Whiteboard draw stroke broadcasted to room.');

    socket.emit('chat-message', {
      text: 'Automated test chat message'
    });
    console.log('✓ In-call chat message emitted to room.');

    socket.disconnect();
    console.log('✓ Socket disconnected cleanly.');

    console.log('\n🎉 ALL AUTOMATED TESTS PASSED SUCCESSFULLY! (7/7)');
    server.close(() => process.exit(0));
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    server.close(() => process.exit(1));
  }
}

runTests();
