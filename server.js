// ═══════════════════════════════════════════════════
//  FDeveloper Indonesia — Chat Server
//  server.js — Node.js + Express + Socket.IO
//  Jalankan: node server.js
// ═══════════════════════════════════════════════════

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const crypto  = require('crypto');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: '*',          // Untuk dev. Di production, ganti dengan domain kamu
    methods: ['GET','POST']
  }
});

const PORT = process.env.PORT || 3000;

// ── Simpan data sesi di memory ──────────────────────
// Di production, gunakan database (MongoDB / Redis)
const sessions = new Map();
// sessions = Map<sessionId, { socketId, messages: [] }>

// ── Simpan koneksi admin ────────────────────────────
const adminSockets = new Set();

// ── Middleware ──────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// CORS header manual (kalau dibutuhkan)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── Routes HTTP ─────────────────────────────────────
// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin.html
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// API: daftar sesi aktif (untuk admin)
app.get('/api/sessions', (req, res) => {
  const list = [];
  sessions.forEach((val, key) => {
    list.push({
      sessionId: key,
      messages:  val.messages,
      lastMsg:   val.messages.at(-1) || null,
      online:    !!val.socketId
    });
  });
  res.json(list);
});

// ── Socket.IO Events ─────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 Koneksi baru:', socket.id);

  // ── Pengguna bergabung ──
  socket.on('join', ({ sessionId }) => {
    if (!sessionId) return;

    socket.join('user_' + sessionId);
    socket.sessionId = sessionId;
    socket.role = 'user';

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { socketId: socket.id, messages: [] });
    } else {
      sessions.get(sessionId).socketId = socket.id;
    }

    console.log(`👤 User bergabung: ${sessionId}`);

    // Kirim riwayat pesan ke user
    const hist = sessions.get(sessionId).messages;
    if (hist.length) socket.emit('history', hist);

    // Beritahu semua admin ada user baru/aktif
    io.to('admin_room').emit('sessions_update', buildSessionList());
  });

  // ── Admin bergabung ──
  socket.on('admin_join', ({ password }) => {
    // Ganti password di bawah sesuai keinginan kamu
    const ADMIN_PASS = process.env.ADMIN_PASS || 'fdeveloper2026';

    if (password !== ADMIN_PASS) {
      socket.emit('auth_error', 'Password salah!');
      return;
    }

    socket.join('admin_room');
    socket.role = 'admin';
    adminSockets.add(socket.id);
    console.log('🛡️  Admin terhubung:', socket.id);

    socket.emit('auth_ok');
    socket.emit('sessions_update', buildSessionList());
  });

  // ── Pesan dari User ──
  socket.on('message', ({ text, sessionId }) => {
    if (!text || !sessionId) return;

    const msg = {
      id:        crypto.randomUUID(),
      from:      'user',
      text:      text.trim(),
      sessionId,
      time:      new Date().toISOString()
    };

    // Simpan pesan
    if (sessions.has(sessionId)) {
      sessions.get(sessionId).messages.push(msg);
    }

    // Kirim ke admin
    io.to('admin_room').emit('new_message', { sessionId, msg });
    io.to('admin_room').emit('sessions_update', buildSessionList());

    console.log(`💬 [${sessionId}] User: ${text}`);
  });

  // ── Pesan dari Admin ke User tertentu ──
  socket.on('admin_reply', ({ sessionId, text }) => {
    if (socket.role !== 'admin') return;
    if (!text || !sessionId) return;

    const msg = {
      id:        crypto.randomUUID(),
      from:      'admin',
      text:      text.trim(),
      sessionId,
      time:      new Date().toISOString()
    };

    // Simpan pesan
    if (sessions.has(sessionId)) {
      sessions.get(sessionId).messages.push(msg);
    }

    // Kirim ke user
    io.to('user_' + sessionId).emit('message', { from: 'admin', text: text.trim() });

    // Update daftar sesi admin
    io.to('admin_room').emit('new_message', { sessionId, msg });
    io.to('admin_room').emit('sessions_update', buildSessionList());

    console.log(`📨 [${sessionId}] Admin: ${text}`);
  });

  // ── Admin mengetik (typing indicator ke user) ──
  socket.on('admin_typing', ({ sessionId }) => {
    if (socket.role !== 'admin') return;
    io.to('user_' + sessionId).emit('typing');
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    console.log('❌ Terputus:', socket.id);

    if (socket.role === 'admin') {
      adminSockets.delete(socket.id);
    } else if (socket.sessionId && sessions.has(socket.sessionId)) {
      sessions.get(socket.sessionId).socketId = null;
      io.to('admin_room').emit('sessions_update', buildSessionList());
    }
  });
});

// ── Helper: Bangun daftar sesi untuk admin ──────────
function buildSessionList() {
  const list = [];
  sessions.forEach((val, key) => {
    list.push({
      sessionId: key,
      messages:  val.messages,
      lastMsg:   val.messages.at(-1) || null,
      online:    !!val.socketId,
      unread:    val.messages.filter(m => m.from === 'user' && !m.read).length
    });
  });
  // Urutkan: terbaru dulu
  return list.sort((a, b) => {
    const ta = a.lastMsg ? new Date(a.lastMsg.time) : 0;
    const tb = b.lastMsg ? new Date(b.lastMsg.time) : 0;
    return tb - ta;
  });
}

// ── Mulai server ─────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   FDeveloper Chat Server — Running!    ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  Website : http://localhost:${PORT}        ║`);
  console.log(`║  Admin   : http://localhost:${PORT}/admin  ║`);
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log('Tekan Ctrl+C untuk berhenti.\n');
});