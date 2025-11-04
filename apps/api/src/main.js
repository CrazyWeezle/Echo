// ECHO API entrypoint
// - Sets up HTTP server with CORS and a small router that delegates to feature modules in ./routes
// - Initializes Socket.IO for realtime chat, presence, typing, reactions and simple voice signalling
// - Performs DB bootstrap with retries so the container waits for Postgres
// - Optionally initializes Firebase Admin for push notifications
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool, initDb } from './db.js';
import { JWT_SECRET, ALLOWED_ORIGINS, PORT } from './config.js';
import { json, guessImageContentType } from './utils.js';

import { handleAuth } from './routes/auth.js';
import { handleUsers } from './routes/users.js';
import { handleSpaces } from './routes/spaces.js';
import { handleChannels } from './routes/channels.js';
import { handleFriends } from './routes/friends.js';
import { handleFiles } from './routes/files.js';
import { handleKanban } from './routes/kanban.js';
import { handleForms } from './routes/forms.js';
import { handleHabits } from './routes/habits.js';
import { handlePush, sendWebPushToUsers } from './routes/push.js';

import { listSpaces, listChannels, getBacklog } from './services/chat.js';

import { Server as IOServer } from 'socket.io';

// Global error traps keep the process alive and surface diagnostics in logs

process.on('unhandledRejection', (err) => { try { console.error('[api] Unhandled promise rejection', err); } catch {} });
process.on('uncaughtException', (err) => { try { console.error('[api] Uncaught exception', err); } catch {} });

// --- DB bootstrap with retries -------------------------------------------------
{
  let attempts = 0;
  const maxAttempts = Number(process.env.DB_INIT_MAX_ATTEMPTS || 60);
  const delayMs = Number(process.env.DB_INIT_RETRY_MS || 2000);
  while (true) {
    try { await initDb(); break; }
    catch (e) {
      attempts++;
      console.error(`[api] initDb failed (attempt ${attempts}/${maxAttempts}): ${e?.message || e}`);
      if (attempts >= maxAttempts) { console.error('[api] FATAL: DB not reachable; giving up'); process.exit(1); }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// --- HTTP server + router ------------------------------------------------------
function userIdFromAuth(req) {
  try {
    const h = req.headers['authorization'] || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!tok) return null;
    const payload = jwt.verify(tok, JWT_SECRET);
    return payload && payload.sub ? String(payload.sub) : null;
  } catch { return null; }
}

const server = http.createServer(async (req, res) => {
  try {
    // CORS
    const reqOrigin = req.headers['origin'] || '';
    const allowAny = ALLOWED_ORIGINS.length === 0;
    const originAllowed = allowAny || (reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin));
    res.setHeader('Access-Control-Allow-Origin', originAllowed ? (reqOrigin || '*') : 'null');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (!originAllowed && reqOrigin) return json(res, 403, { message: 'CORS origin not allowed' });

    // Guard: only serve /api/*
    if (!req.url) return json(res, 404, { message: 'Not found' });
    if (!req.url.startsWith('/api/')) return json(res, 404, { message: 'Not found' });

    // Parse JSON body (tiny, no streaming)
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}

    // Delegate to feature modules (return true when a handler fully responded)
    if (req.url.startsWith('/api/auth/')) { const handled = await handleAuth(req, res, body, { io }); if (handled) return; }
    if (req.url.startsWith('/api/users/')) { const handled = await handleUsers(req, res, body, { io }); if (handled) return; }
    if (req.url.startsWith('/api/friends') || req.url.startsWith('/api/dms/')) { const handled = await handleFriends(req, res, body, { io }); if (handled) return; }
    if (req.url.startsWith('/api/spaces') || req.url.startsWith('/api/invites/')) { const handled = await handleSpaces(req, res, body, { io }); if (handled) return; }
    if (req.url.startsWith('/api/channels')) { const handled = await handleChannels(req, res, body, { io }); if (handled) return; }
    if (req.url.startsWith('/api/files')) { const handled = await handleFiles(req, res, body, { io }); if (handled) return; }
    if (req.url.startsWith('/api/kanban')) { const handled = await handleKanban(req, res, body, { io }); if (handled) return; }
    if (req.url.startsWith('/api/forms')) { const handled = await handleForms(req, res, body, { io }); if (handled) return; }
    if (req.url.startsWith('/api/habits')) { const handled = await handleHabits(req, res, body, { io }); if (handled) return; }
    if (req.url.startsWith('/api/push')) { const handled = await handlePush(req, res, body, { userId: userIdFromAuth(req) }); if (handled) return; }

    // Health check for container/platform readiness
    if (req.method === 'GET' && req.url === '/api/health') return json(res, 200, { status: 'ok' });

    // Fallthrough: unknown route
    return json(res, 404, { message: 'Not found' });
  } catch (err) {
    try { console.error('[api] Unhandled error', err); json(res, 500, { message: 'Internal error' }); } catch {}
  }
});

// --- Push notifications (optional Firebase Admin) -----------------------------
let adminMessaging = null;
try {
  const fb = await import('firebase-admin');
  const svcJson = process.env.FCM_SERVICE_ACCOUNT_JSON || '';
  if (svcJson) {
    const creds = JSON.parse(svcJson);
    if (!fb.getApps || fb.getApps().length === 0) fb.initializeApp({ credential: fb.credential.cert(creds) });
    adminMessaging = fb.messaging();
    console.log('[api] FCM initialized');
  }
} catch {}

async function sendPushToUsers(userIds, payload) {
  if (!adminMessaging) return;
  try {
    const ids = Array.from(new Set((userIds || []).map(String))).filter(Boolean);
    if (ids.length === 0) return;
    const { rows } = await pool.query('SELECT token FROM push_devices WHERE user_id = ANY($1)', [ids]);
    const tokens = rows.map(r => r.token).filter(Boolean);
    if (tokens.length === 0) return;
    const message = { tokens, notification: payload.notification || undefined, data: payload.data || undefined, android: { priority: 'high' } };
    await adminMessaging.sendEachForMulticast(message);
  } catch (e) { console.warn('sendPush failed', e?.message || e); }
}

// --- Socket.IO: realtime transport -------------------------------------------
const io = new IOServer(server, {
  path: '/socket.io',
  cors: {
    origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  perMessageDeflate: true,
  pingInterval: Number(process.env.SIO_PING_INTERVAL_MS || 25000),
  pingTimeout: Number(process.env.SIO_PING_TIMEOUT_MS || 60000),
});

// Presence/typing state in-memory (single-instance). For multi-instance,
// back with a shared adapter (e.g., Redis) and shared presence store.
const roomPresence = new Map();      // room -> Set<userId>
const typingState = new Map();       // room -> Map<userId, boolean>
function presenceJoin(room, userId) {
  if (!roomPresence.has(room)) roomPresence.set(room, new Set());
  roomPresence.get(room).add(userId);
}
function presenceLeave(room, userId) {
  if (!roomPresence.has(room)) return;
  roomPresence.get(room).delete(userId);
}
function emitPresence(room) {
  const userIds = Array.from(roomPresence.get(room) || []);
  io.to(room).emit('presence:room', { room, userIds });
}
function emitSpacePresence(room, spaceId) {
  const userIds = Array.from(roomPresence.get(room) || []);
  io.to(room).emit('presence:space', { spaceId, userIds });
}
function emitGlobalPresence() {
  const room = 'global';
  const userIds = Array.from(roomPresence.get(room) || []);
  io.to(room).emit('presence:global', { userIds });
}

// Authenticate socket using the access token provided in the handshake
io.use(async (socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Missing token'));
  try {
    const payload = jwt.verify(String(token), JWT_SECRET);
    socket.data.userId = payload.sub;
    const { rows } = await pool.query('SELECT name FROM users WHERE id=$1', [socket.data.userId]);
    socket.data.name = rows[0]?.name || '';
    return next();
  } catch (e) {
    return next(new Error('Invalid token'));
  }
});

// Per-socket lifecycle and events
io.on('connection', async (socket) => {
  const userId = socket.data.userId;
  const { rows } = await pool.query('SELECT name, avatar_url, name_color FROM users WHERE id=$1', [userId]);
  const displayName = rows[0]?.name || '';
  const avatarUrl = rows[0]?.avatar_url || null;
  const nameColor = rows[0]?.name_color || null;
  socket.data.name = displayName;
  socket.data.nameColor = nameColor;
  socket.emit('auth:accepted', { userId, name: displayName, avatarUrl });
  try { socket.join(`user:${userId}`); } catch {}

  let curVoid = '';
  let curChan = '';
  const room = () => curChan;
  const spaceRoom = () => `space:${curVoid}`;

  // Bootstrap: list spaces and channels (emit legacy and new names)
  const spaces = await listSpaces(userId);
  socket.emit('void:list', { voids: spaces });
  try { socket.emit('space:list', { spaces }); } catch {}
  if (spaces[0]) {
    curVoid = spaces[0].id;
    socket.emit('channel:list', { voidId: curVoid, spaceId: curVoid, channels: await listChannels(curVoid) });
    socket.join(spaceRoom());
    presenceJoin(spaceRoom(), userId);
    emitSpacePresence(spaceRoom(), curVoid);
  }
  try { socket.join('global'); } catch {}
  presenceJoin('global', userId);
  emitGlobalPresence();

  socket.on('void:list', async () => {
    const list = await listSpaces(userId);
    socket.emit('void:list', { voids: list });
    try { socket.emit('space:list', { spaces: list }); } catch {}
  });
  socket.on('space:list', async () => {
    const list = await listSpaces(userId);
    socket.emit('space:list', { spaces: list });
    try { socket.emit('void:list', { voids: list }); } catch {}
  });

  // Switch current space
  socket.on('void:switch', async ({ voidId }) => {
    if (!voidId) return;
    const { rows } = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [voidId, userId]);
    if (rows.length === 0) return;
    if (room()) { presenceLeave(room(), userId); socket.leave(room()); }
    if (curVoid) { presenceLeave(spaceRoom(), userId); socket.leave(spaceRoom()); }
    curVoid = voidId;
    curChan = '';
    socket.join(spaceRoom());
    presenceJoin(spaceRoom(), userId);
    emitSpacePresence(spaceRoom(), curVoid);
    const ch = await listChannels(voidId);
    socket.emit('channel:list', { voidId, spaceId: voidId, channels: ch });
  });
  socket.on('space:switch', async ({ spaceId }) => {
    const sid = String(spaceId || '');
    if (!sid) return;
    const { rows } = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (rows.length === 0) return;
    if (room()) { presenceLeave(room(), userId); socket.leave(room()); }
    if (curVoid) { presenceLeave(spaceRoom(), userId); socket.leave(spaceRoom()); }
    curVoid = sid;
    curChan = '';
    socket.join(spaceRoom());
    presenceJoin(spaceRoom(), userId);
    emitSpacePresence(spaceRoom(), curVoid);
    const ch = await listChannels(sid);
    socket.emit('channel:list', { voidId: sid, spaceId: sid, channels: ch });
  });

  // List channels for a space
  socket.on('channel:list', async ({ voidId, spaceId }) => {
    const sid = String(spaceId || voidId || '');
    if (!sid) return;
    const { rows } = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (rows.length === 0) return;
    const ch = await listChannels(sid);
    socket.emit('channel:list', { voidId: sid, spaceId: sid, channels: ch });
  });

  // Enter a channel and send its backlog
  socket.on('channel:switch', async ({ voidId, spaceId, channelId }) => {
    if (!channelId) return;
    const found = await pool.query('SELECT space_id FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return;
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return;
    if (room()) { presenceLeave(room(), userId); socket.leave(room()); }
    curVoid = sid;
    curChan = channelId;
    socket.join(room());
    presenceJoin(room(), userId);
    emitPresence(room());
    socket.emit('channel:backlog', { voidId: sid, spaceId: sid, channelId, messages: await getBacklog(channelId, userId) });
  });

  // Simple voice signalling (room membership + peer relays)
  let curVoiceRid = '';
  socket.on('voice:join', async ({ channelId }) => {
    try {
      const rid = String(channelId || '');
      if (!rid) return;
      const found = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [rid]);
      if (found.rowCount === 0) return;
      const sid = found.rows[0].space_id;
      const ctype = String(found.rows[0].type || 'text');
      if (ctype !== 'voice') return;
      const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
      if (mem.rowCount === 0) return;
      const vroom = `voice:${rid}`;
      curVoiceRid = vroom;
      socket.join(vroom);
      const set = (socket.adapter.rooms.get(vroom) || new Set());
      const peerIds = Array.from(set).filter(id => id !== socket.id);
      const peers = peerIds.map(id => {
        const s = io.sockets.sockets.get(id);
        return { peerId: id, userId: s?.data?.userId || null, name: s?.data?.name || '' };
      });
      socket.emit('voice:peers', { peers });
      socket.to(vroom).emit('voice:peer-joined', { peerId: socket.id, userId, name: socket.data.name || '' });
    } catch {}
  });

  socket.on('voice:leave', () => {
    try {
      const vroom = curVoiceRid;
      if (vroom) {
        socket.leave(vroom);
        socket.to(vroom).emit('voice:peer-left', { peerId: socket.id });
      }
      curVoiceRid = '';
    } catch {}
  });

  socket.on('voice:signal', ({ targetId, payload }) => {
    try {
      if (!targetId || !payload) return;
      const to = io.sockets.sockets.get(String(targetId));
      if (!to) return;
      to.emit('voice:signal', { from: socket.id, payload });
    } catch {}
  });

  // Send a message (with optional attachments)
  socket.on('message:send', async ({ voidId, spaceId, channelId, content, tempId, attachments, replyToId, spoiler }) => {
    if (!channelId) return;
    const rid = channelId;
    const found = await pool.query('SELECT space_id FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return;
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return;
    const id = randomUUID();
    const text = String(content || '');
    if (!text && (!attachments || attachments.length === 0)) return;
    let replyTo = String(replyToId || '').trim() || null;
    if (replyTo) {
      try {
        const { rows } = await pool.query('SELECT channel_id FROM messages WHERE id=$1', [replyTo]);
        if (!rows[0] || rows[0].channel_id !== channelId) replyTo = null;
      } catch { replyTo = null; }
    }
    await pool.query('INSERT INTO messages(id, channel_id, author_id, content, is_spoiler, reply_to) VALUES ($1,$2,$3,$4,$5,$6)', [id, channelId, userId, text, !!spoiler, replyTo]);
    if (Array.isArray(attachments)) {
      for (const a of attachments) {
        const url = String(a?.url || ''); if (!url) continue;
        const name = String(a?.name || 'file').slice(0, 255);
        const rawType = String(a?.contentType || '').trim().toLowerCase();
        let ctype = rawType;
        if (!ctype || ctype === 'application/octet-stream') {
          ctype = guessImageContentType(name) || guessImageContentType(url) || 'application/octet-stream';
        }
        const size = Number(a?.size || 0) || null;
        await pool.query('INSERT INTO message_attachments(id, message_id, url, content_type, name, size_bytes) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, url, ctype, name, size]);
      }
    }
    const attsRows = await pool.query('SELECT url, content_type as "contentType", name, size_bytes as size FROM message_attachments WHERE message_id=$1', [id]);
    let replyToObj = null;
    if (replyTo) {
      try {
        const { rows } = await pool.query('SELECT m.id, m.content, m.author_id, u.name as author_name, u.name_color as author_color FROM messages m JOIN users u ON u.id=m.author_id WHERE m.id=$1', [replyTo]);
        const r = rows[0]; if (r) replyToObj = { id: r.id, authorId: r.author_id, authorName: r.author_name, authorColor: r.author_color, content: r.content };
      } catch {}
    }
    const message = { id, content: text, spoiler: !!spoiler, createdAt: new Date().toISOString(), authorId: userId, authorName: socket.data.name, authorColor: socket.data.nameColor || null, reactions: {}, attachments: attsRows.rows, replyTo: replyToObj };
    io.to(rid).emit('message:new', { voidId: sid, spaceId: sid, channelId, message, tempId });
    // Emit lightweight notify events to each member's personal room so
    // clients can update unread counts and play sounds when the channel
    // isn't currently focused. Clients de-dup and ignore self notifications.
    try {
      const { rows: members } = await pool.query('SELECT user_id FROM space_members WHERE space_id=$1', [sid]);
      const set = io.sockets.adapter.rooms.get(rid) || new Set();
      const online = new Set(Array.from(set).map(s => io.sockets.sockets.get(s)?.data?.userId).filter(Boolean));
      const targets = [];
      for (const m of members) {
        const targetId = m.user_id;
        const payload = { voidId: sid, spaceId: sid, channelId, authorId: userId, authorName: displayName, content: text, messageId: id };
        io.to(`user:${targetId}`).emit('user:notify', payload);
        if (targetId !== userId && !online.has(targetId)) targets.push(targetId);
      }
      if (targets.length > 0) {
        const title = String(sid).startsWith('dm_') ? `DM from ${displayName}` : `#${channelId.split(':')[1] || 'channel'}`;
        await sendWebPushToUsers(targets, { title, body: text.slice(0, 120), channelId });
      }
    } catch {}
  });

  // Mark messages read up to a cutoff
  socket.on('read:up_to', async ({ channelId, lastMessageId }) => {
    const rid = String(channelId || '');
    const mid = String(lastMessageId || '');
    if (!rid || !mid) return;
    const found = await pool.query('SELECT space_id FROM channels WHERE id=$1', [rid]);
    if (found.rowCount === 0) return;
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return;
    await pool.query(`
      INSERT INTO message_reads(message_id, user_id)
      SELECT m.id, $2 FROM messages m
      WHERE m.channel_id=$1 AND m.created_at <= (SELECT created_at FROM messages WHERE id=$3)
      ON CONFLICT DO NOTHING
    `, [rid, userId, mid]);
    io.to(rid).emit('message:seen', { channelId: rid, messageId: mid, userId, name: socket.data.name });
  });

  // Edit a message (author only)
  socket.on('message:edit', async ({ messageId, content }) => {
    const { rows } = await pool.query('SELECT channel_id, author_id FROM messages WHERE id=$1', [String(messageId)]);
    const msg = rows[0]; if (!msg) return;
    if (msg.author_id !== userId) return;
    const mem = await pool.query('SELECT 1 FROM channels c JOIN space_members m ON m.space_id=c.space_id WHERE c.id=$1 AND m.user_id=$2', [msg.channel_id, userId]);
    if (mem.rowCount === 0) return;
    await pool.query('UPDATE messages SET content=$1, updated_at=now() WHERE id=$2', [String(content || ''), String(messageId)]);
    io.to(msg.channel_id).emit('message:edited', { channelId: msg.channel_id, messageId: String(messageId), content: String(content || ''), updatedAt: new Date().toISOString() });
  });

  // Delete a message (author only)
  socket.on('message:delete', async ({ messageId }) => {
    const { rows } = await pool.query('SELECT channel_id, author_id FROM messages WHERE id=$1', [String(messageId)]);
    const msg = rows[0]; if (!msg) return;
    if (msg.author_id !== userId) return;
    const mem = await pool.query('SELECT 1 FROM channels c JOIN space_members m ON m.space_id=c.space_id WHERE c.id=$1 AND m.user_id=$2', [msg.channel_id, userId]);
    if (mem.rowCount === 0) return;
    await pool.query('DELETE FROM messages WHERE id=$1', [String(messageId)]);
    io.to(msg.channel_id).emit('message:deleted', { channelId: msg.channel_id, messageId: String(messageId) });
  });

  // Add a reaction
  socket.on('reaction:add', async ({ messageId, emoji }) => {
    const mid = String(messageId);
    const e = String(emoji || '').slice(0, 32); if (!e) return;
    const { rows } = await pool.query('SELECT channel_id FROM messages WHERE id=$1', [mid]);
    const msg = rows[0]; if (!msg) return;
    const mem = await pool.query('SELECT 1 FROM channels c JOIN space_members m ON m.space_id=c.space_id WHERE c.id=$1 AND m.user_id=$2', [msg.channel_id, userId]);
    if (mem.rowCount === 0) return;
    await pool.query('INSERT INTO message_reactions(message_id, user_id, reaction) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [mid, userId, e]);
    const { rows: counts } = await pool.query('SELECT reaction, COUNT(*)::int as count FROM message_reactions WHERE message_id=$1 GROUP BY reaction', [mid]);
    const reactions = {}; for (const r of counts) reactions[r.reaction] = { count: Number(r.count) };
    io.to(msg.channel_id).emit('message:reactions', { channelId: msg.channel_id, messageId: mid, reactions });
  });

  // Remove a reaction
  socket.on('reaction:remove', async ({ messageId, emoji }) => {
    const mid = String(messageId);
    const e = String(emoji || '').slice(0, 32); if (!e) return;
    const { rows } = await pool.query('SELECT channel_id FROM messages WHERE id=$1', [mid]);
    const msg = rows[0]; if (!msg) return;
    const mem = await pool.query('SELECT 1 FROM channels c JOIN space_members m ON m.space_id=c.space_id WHERE c.id=$1 AND m.user_id=$2', [msg.channel_id, userId]);
    if (mem.rowCount === 0) return;
    await pool.query('DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND reaction=$3', [mid, userId, e]);
    const { rows: counts } = await pool.query('SELECT reaction, COUNT(*)::int as count FROM message_reactions WHERE message_id=$1 GROUP BY reaction', [mid]);
    const reactions = {}; for (const r of counts) reactions[r.reaction] = { count: Number(r.count) };
    io.to(msg.channel_id).emit('message:reactions', { channelId: msg.channel_id, messageId: mid, reactions });
  });

  // Typing indicators (start/stop)
  socket.on('typing:set', async ({ voidId, spaceId, channelId, isTyping }) => {
    const rid = channelId; if (!rid) return;
    if (!typingState.has(rid)) typingState.set(rid, new Map());
    const roomMap = typingState.get(rid);
    const prev = !!roomMap.get(userId);
    const next = !!isTyping;
    if (prev === next) return; // no transition, suppress duplicate events
    roomMap.set(userId, next);
    const found = await pool.query('SELECT space_id FROM channels WHERE id=$1', [channelId]);
    const sid = found.rows[0]?.space_id || spaceId || voidId;
    if (next) socket.to(rid).emit('typing:start', { voidId: sid, spaceId: sid, channelId, userId, name: socket.data.name || '' });
    else socket.to(rid).emit('typing:stop', { voidId: sid, spaceId: sid, channelId, userId });
  });

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    presenceLeave(room(), userId); emitPresence(room());
    if (curVoid) { presenceLeave(spaceRoom(), userId); emitSpacePresence(spaceRoom(), curVoid); }
    presenceLeave('global', userId); emitGlobalPresence();
  });
});

// Listen
server.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});
