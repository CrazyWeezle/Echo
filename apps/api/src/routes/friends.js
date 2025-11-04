import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json } from '../utils.js';

function sortPair(a, b) {
  return String(a) < String(b) ? [String(a), String(b)] : [String(b), String(a)];
}
async function friendshipExists(a, b) {
  const [x, y] = sortPair(a, b);
  const r = await pool.query('SELECT 1 FROM friendships WHERE user_id_a=$1 AND user_id_b=$2', [x, y]);
  return r.rowCount > 0;
}
async function createFriendship(a, b) {
  const [x, y] = sortPair(a, b);
  await pool.query('INSERT INTO friendships(user_id_a, user_id_b) VALUES ($1,$2) ON CONFLICT DO NOTHING', [x, y]);
}
async function ensureMember(userId, spaceId, role = 'member') {
  try { await pool.query('INSERT INTO space_members(space_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [spaceId, userId, role]); } catch {}
}

export async function handleFriends(req, res, body, ctx) {
  const io = ctx?.io;

  if (req.method === 'GET' && req.url === '/api/friends/list') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.name, u.avatar_url as "avatarUrl", COALESCE(u.status,'') as status, u.name_color as "nameColor"
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_id_a=$1 THEN f.user_id_b ELSE f.user_id_a END
       WHERE f.user_id_a=$1 OR f.user_id_b=$1
       ORDER BY lower(u.name)`,
      [userId]
    );
    return json(res, 200, { friends: rows }), true;
  }

  if (req.method === 'GET' && req.url === '/api/friends/requests') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const incoming = await pool.query(
      `SELECT r.id, r.from_user as "fromUserId", u.username as "fromUsername", u.name as "fromName", u.avatar_url as "fromAvatarUrl", r.created_at as "createdAt", COALESCE(u.status,'') as "fromStatus"
       FROM friend_requests r
       JOIN users u ON u.id = r.from_user
       WHERE r.to_user=$1
       ORDER BY r.created_at DESC`,
      [userId]
    );
    const outgoing = await pool.query(
      `SELECT r.id, r.to_user as "toUserId", u.username as "toUsername", u.name as "toName", u.avatar_url as "toAvatarUrl", r.created_at as "createdAt", COALESCE(u.status,'') as "toStatus"
       FROM friend_requests r
       JOIN users u ON u.id = r.to_user
       WHERE r.from_user=$1
       ORDER BY r.created_at DESC`,
      [userId]
    );
    return json(res, 200, { incoming: incoming.rows, outgoing: outgoing.rows }), true;
  }

  if (req.method === 'POST' && req.url === '/api/friends/request') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { toUsername, toUserId, message } = body || {};
    let targetId = String(toUserId || '').trim();
    if (!targetId) {
      const uname = String(toUsername || '').trim().toLowerCase();
      if (!uname) return json(res, 400, { message: 'toUsername or toUserId required' }), true;
      const q = await pool.query('SELECT id FROM users WHERE username=$1', [uname]);
      if (q.rowCount === 0) return json(res, 404, { message: 'User not found' }), true;
      targetId = q.rows[0].id;
    }
    if (targetId === userId) return json(res, 400, { message: 'Cannot friend yourself' }), true;
    if (await friendshipExists(userId, targetId)) return json(res, 200, { ok: true, already: true }), true;
    const opp = await pool.query('SELECT id FROM friend_requests WHERE from_user=$1 AND to_user=$2', [targetId, userId]);
    if (opp.rowCount > 0) {
      const rid = opp.rows[0].id;
      await createFriendship(userId, targetId);
      try { await pool.query('DELETE FROM friend_requests WHERE id=$1', [rid]); } catch {}
      try { io?.to(`user:${targetId}`).emit('friends:update', { type: 'accepted', userId }); } catch {}
      return json(res, 200, { ok: true, autoAccepted: true }), true;
    }
    const ex = await pool.query('SELECT 1 FROM friend_requests WHERE from_user=$1 AND to_user=$2', [userId, targetId]);
    if (ex.rowCount > 0) return json(res, 200, { ok: true, pending: true }), true;
    await pool.query('INSERT INTO friend_requests(id, from_user, to_user, message) VALUES ($1,$2,$3,$4)', [randomUUID(), userId, targetId, message ? String(message).slice(0, 200) : null]);
    try { io?.to(`user:${targetId}`).emit('friends:update', { type: 'request', fromUserId: userId }); } catch {}
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'POST' && req.url === '/api/friends/respond') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { requestId, action } = body || {};
    const rid = String(requestId || '').trim();
    const act = String(action || '').trim();
    if (!rid || !act) return json(res, 400, { message: 'requestId and action required' }), true;
    const rq = await pool.query('SELECT id, from_user, to_user FROM friend_requests WHERE id=$1', [rid]);
    const r = rq.rows[0];
    if (!r || r.to_user !== userId) return json(res, 404, { message: 'Request not found' }), true;
    if (act === 'accept') {
      await createFriendship(r.from_user, r.to_user);
      try { await pool.query('DELETE FROM friend_requests WHERE id=$1', [rid]); } catch {}
      try { io?.to(`user:${r.from_user}`).emit('friends:update', { type: 'accepted', userId }); } catch {}
      return json(res, 200, { ok: true }), true;
    } else if (act === 'decline') {
      try { await pool.query('DELETE FROM friend_requests WHERE id=$1', [rid]); } catch {}
      return json(res, 200, { ok: true }), true;
    } else {
      return json(res, 400, { message: 'Invalid action' }), true;
    }
  }

  if (req.method === 'DELETE' && req.url === '/api/friends') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { userId: otherId } = body || {};
    const targetId = String(otherId || '').trim();
    if (!targetId) return json(res, 400, { message: 'userId required' }), true;
    const [x, y] = sortPair(userId, targetId);
    await pool.query('DELETE FROM friendships WHERE user_id_a=$1 AND user_id_b=$2', [x, y]);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'POST' && req.url === '/api/dms/start') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { userId: otherId, username } = body || {};
    let targetId = String(otherId || '').trim();
    if (!targetId) {
      const uname = String(username || '').trim().toLowerCase();
      if (!uname) return json(res, 400, { message: 'userId or username required' }), true;
      const q = await pool.query('SELECT id FROM users WHERE username=$1', [uname]);
      if (q.rowCount === 0) return json(res, 404, { message: 'User not found' }), true;
      targetId = q.rows[0].id;
    }
    if (targetId === userId) return json(res, 400, { message: 'Cannot DM yourself' }), true;
    if (!(await friendshipExists(userId, targetId))) return json(res, 403, { message: 'Not friends' }), true;
    const [x, y] = sortPair(userId, targetId);
    const spaceId = `dm_${x}_${y}`;
    try {
      const a1 = await pool.query('SELECT name FROM users WHERE id=$1', [x]);
      const b1 = await pool.query('SELECT name FROM users WHERE id=$1', [y]);
      const n1 = a1.rows[0]?.name || 'User';
      const n2 = b1.rows[0]?.name || 'User';
      const nm = `${n1} + ${n2}`;
      await pool.query('INSERT INTO spaces(id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [spaceId, nm]);
    } catch {}
    await ensureMember(x, spaceId, 'member');
    await ensureMember(y, spaceId, 'member');
    const channelId = `${spaceId}:chat`;
    try { await pool.query('INSERT INTO channels(id, space_id, name, type) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [channelId, spaceId, 'chat', 'dm']); } catch {}
    try { io?.to(`user:${x}`).emit('dm:created', { spaceId, channelId }); } catch {}
    try { io?.to(`user:${y}`).emit('dm:created', { spaceId, channelId }); } catch {}
    return json(res, 200, { spaceId, channelId }), true;
  }

  // POST /api/dms/clear — clear all or last N days in a DM chat
  if (req.method === 'POST' && req.url === '/api/dms/clear') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { spaceId, days } = body || {};
    const sid = String(spaceId || '').trim();
    if (!sid || !sid.startsWith('dm_')) return json(res, 400, { message: 'spaceId must be a DM' }), true;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const chatId = `${sid}:chat`;
    if (days && Number(days) > 0) {
      const n = Math.max(1, Math.min(3650, Number(days)));
      await pool.query("DELETE FROM messages WHERE channel_id=$1 AND created_at >= (now() - ($2 || ' days')::interval)", [chatId, String(n)]);
    } else {
      await pool.query('DELETE FROM messages WHERE channel_id=$1', [chatId]);
    }
    try { io?.to(chatId).emit('channel:backlog', { voidId: sid, channelId: chatId, messages: [] }); } catch {}
    return json(res, 200, { ok: true }), true;
  }

  return false;
}
