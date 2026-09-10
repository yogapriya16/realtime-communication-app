const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Initial schema
const defaultData = {
  users: [],
  rooms: {}
};

class Database {
  constructor() {
    this.data = { ...defaultData };
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(raw);
      } else {
        this.persist();
      }
    } catch (err) {
      console.error('Error initializing database:', err);
      this.data = { ...defaultData };
    }
  }

  persist() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to write to db.json:', err);
    }
  }

  // --- User Operations ---
  findUserByUsername(username) {
    if (!username) return null;
    return this.data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  }

  findUserByEmail(email) {
    if (!email) return null;
    return this.data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  findUserById(id) {
    return this.data.users.find(u => u.id === id);
  }

  createUser(userData) {
    const user = {
      id: 'usr_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
      username: userData.username,
      email: userData.email,
      passwordHash: userData.passwordHash,
      displayName: userData.displayName || userData.username,
      createdAt: new Date().toISOString()
    };
    this.data.users.push(user);
    this.persist();
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt
    };
  }

  // --- Room Operations ---
  getRoom(roomId) {
    return this.data.rooms[roomId] || null;
  }

  createRoom(roomId, roomData) {
    this.data.rooms[roomId] = {
      id: roomId,
      name: roomData.name || roomId,
      hostId: roomData.hostId || null,
      passcodeHash: roomData.passcodeHash || null,
      isLocked: false,
      createdAt: new Date().toISOString(),
      activeParticipants: []
    };
    this.persist();
    return this.data.rooms[roomId];
  }

  updateRoom(roomId, updates) {
    if (!this.data.rooms[roomId]) return null;
    this.data.rooms[roomId] = { ...this.data.rooms[roomId], ...updates };
    this.persist();
    return this.data.rooms[roomId];
  }
}

const db = new Database();
module.exports = db;
