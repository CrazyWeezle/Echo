import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json } from '../utils.js';

function authUserId(req) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    return payload?.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

async function getChannelMeta(channelId) {
  const { rows } = await pool.query(
    'SELECT id, space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1',
    [channelId]
  );
  return rows[0] || null;
}

async function getHabitMeta(habitId) {
  const { rows } = await pool.query(
    `SELECT hd.id, hd.channel_id, c.space_id, COALESCE(c.type,'text') as type
     FROM habit_defs hd
     JOIN channels c ON c.id = hd.channel_id
     WHERE hd.id=$1`,
    [habitId]
  );
  return rows[0] || null;
}

async function isSpaceMember(spaceId, userId) {
  if (!spaceId || !userId) return false;
  const { rowCount } = await pool.query(
    'SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2',
    [spaceId, userId]
  );
  return rowCount > 0;
}

async function listParticipants(spaceId) {
  if (!spaceId) return [];
  const { rows } = await pool.query(
    `SELECT sm.user_id as "userId", COALESCE(u.name, u.username, 'Member') as name
     FROM space_members sm
     LEFT JOIN users u ON u.id = sm.user_id
     WHERE sm.space_id=$1
     ORDER BY name ASC`,
    [spaceId]
  );
  return rows;
}

function formatDayUTC(value) {
  const d = new Date(value);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getHabitState(channelId, viewerId, spaceId) {
  let sid = spaceId;
  if (!sid) {
    const meta = await getChannelMeta(channelId);
    sid = meta?.space_id || null;
  }
  const defs = (await pool.query(
    'SELECT id, name, pos FROM habit_defs WHERE channel_id=$1 ORDER BY pos ASC, created_at ASC',
    [channelId]
  )).rows;
  const defIds = defs.map((d) => d.id);
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const trackers = defIds.length
    ? (await pool.query(
        `SELECT t.id, t.habit_id, t.user_id, t.is_public, COALESCE(u.name,'Member') as name
         FROM habit_trackers t
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.habit_id = ANY($1::uuid[])`,
        [defIds]
      )).rows
    : [];
  const trackerIds = trackers.map((t) => t.id);
  const entries = trackerIds.length
    ? (await pool.query(
        'SELECT tracker_id, day FROM habit_entries WHERE tracker_id = ANY($1::uuid[]) AND day >= $2 AND done = true',
        [trackerIds, since]
      )).rows
    : [];
  const entriesByTracker = new Map();
  for (const row of entries) {
    if (!entriesByTracker.has(row.tracker_id)) entriesByTracker.set(row.tracker_id, []);
    entriesByTracker.get(row.tracker_id).push(String(row.day));
  }

  const my = {};
  const publicByHabit = {};
  const optedByHabit = {};
  for (const t of trackers) {
    const days = (entriesByTracker.get(t.id) || []).map((day) => formatDayUTC(day));
    optedByHabit[t.habit_id] = Array.from(
      new Set([...(optedByHabit[t.habit_id] || []), String(t.user_id)])
    );
    if (String(t.user_id) === String(viewerId)) {
      my[t.habit_id] = { trackerId: t.id, public: !!t.is_public, days: [...days] };
    }
    if (t.is_public) {
      const arr = publicByHabit[t.habit_id] || [];
      arr.push({
        userId: String(t.user_id),
        name: t.name,
        public: true,
        days: [...days],
      });
      publicByHabit[t.habit_id] = arr;
    }
  }
  for (const def of defs) {
    if (!publicByHabit[def.id]) publicByHabit[def.id] = [];
    if (!optedByHabit[def.id]) optedByHabit[def.id] = [];
  }

  let leaderboard = [];
  try {
    const seven = new Date();
    seven.setDate(seven.getDate() - 7);
    leaderboard = defIds.length
      ? (await pool.query(
          `SELECT ht.user_id as "userId", COALESCE(u.name,'User') as name, COUNT(he.id)::int as count
           FROM habit_entries he
           JOIN habit_trackers ht ON ht.id = he.tracker_id AND ht.is_public = true
           LEFT JOIN users u ON u.id = ht.user_id
           WHERE ht.habit_id = ANY($1::uuid[]) AND he.day >= $2 AND he.done = true
           GROUP BY ht.user_id, u.name
           ORDER BY count DESC, name ASC
           LIMIT 10`,
          [defIds, seven]
        )).rows || []
      : [];
  } catch {}

  const participants = sid ? await listParticipants(sid) : [];
  return {
    defs: defs.map((d) => ({ id: d.id, name: d.name, pos: d.pos })),
    my,
    publicByHabit,
    optedByHabit,
    leaderboard,
    participants,
  };
}

async function emitHabitState(io, channelId, spaceId) {
  if (!io) return;
  try {
    let sid = spaceId;
    if (!sid) {
      const meta = await getChannelMeta(channelId);
      sid = meta?.space_id || null;
    }
    let socketIds = Array.from(io.sockets.adapter.rooms.get(channelId) || []);
    socketIds = socketIds.length ? socketIds : Array.from(io.sockets.adapter.rooms.get(`space:${sid}`) || []);
    await Promise.all(
      socketIds.map(async (id) => {
        const socket = io.sockets.sockets.get(id);
        if (!socket?.data?.userId) return;
        const snapshot = await getHabitState(channelId, socket.data.userId, sid);
        socket.emit('habit:state', { channelId, ...snapshot });
      })
    );
  } catch (err) {
    console.error('[habit] emitHabitState failed', err);
  }
}

function pickId(obj, ...keys) {
  if (!obj) return '';
  for (const key of keys) {
    if (obj[key] != null) return obj[key];
  }
  return '';
}

export async function handleHabits(req, res, body, ctx) {
  const io = ctx?.io;

  if (req.method === 'GET' && req.url.startsWith('/api/habits')) {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    let channelId = '';
    try {
      const u = new URL('http://x' + req.url);
      channelId = String(u.searchParams.get('channelId') || '').trim();
    } catch {}
    if (!channelId) return json(res, 400, { message: 'channelId required' }), true;
    const channel = await getChannelMeta(channelId);
    if (!channel) return json(res, 404, { message: 'channel not found' }), true;
    if (String(channel.type) !== 'habit') return json(res, 400, { message: 'not a habit channel' }), true;
    const member = await isSpaceMember(channel.space_id, userId);
    if (!member) return json(res, 403, { message: 'Forbidden' }), true;
    return json(res, 200, await getHabitState(channelId, userId, channel.space_id)), true;
  }

  if (req.method === 'POST' && req.url === '/api/habits/defs') {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const rawChannelId = pickId(body || {}, 'channelId', 'channel_id');
    const cid = String(rawChannelId || '').trim();
    const nm = String(body?.name || '').trim();
    if (!cid || !nm) return json(res, 400, { message: 'channelId and name required' }), true;
    const channel = await getChannelMeta(cid);
    if (!channel) return json(res, 404, { message: 'channel not found' }), true;
    if (String(channel.type) !== 'habit') return json(res, 400, { message: 'not a habit channel' }), true;
    const member = await isSpaceMember(channel.space_id, userId);
    if (!member) return json(res, 403, { message: 'Forbidden' }), true;
    await pool.query(
      'INSERT INTO habit_defs(id, channel_id, name, pos) VALUES ($1, $2, $3, COALESCE((SELECT MAX(pos)+1 FROM habit_defs WHERE channel_id=$2),0))',
      [randomUUID(), cid, nm]
    );
    await emitHabitState(io, cid, channel.space_id);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'PATCH' && req.url === '/api/habits/defs') {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const rawHabitId = pickId(body || {}, 'habitId', 'habit_id');
    const hid = String(rawHabitId || '').trim();
    if (!hid) return json(res, 400, { message: 'habitId required' }), true;
    const meta = await getHabitMeta(hid);
    if (!meta) return json(res, 404, { message: 'habit not found' }), true;
    if (String(meta.type) !== 'habit') return json(res, 400, { message: 'not a habit channel' }), true;
    const member = await isSpaceMember(meta.space_id, userId);
    if (!member) return json(res, 403, { message: 'Forbidden' }), true;
    const updates = [];
    if (typeof body?.name === 'string') {
      updates.push(pool.query('UPDATE habit_defs SET name=$1 WHERE id=$2', [String(body.name), hid]));
    }
    if (typeof body?.pos === 'number' && Number.isFinite(body.pos)) {
      updates.push(pool.query('UPDATE habit_defs SET pos=$1 WHERE id=$2', [Number(body.pos), hid]));
    }
    await Promise.all(updates);
    await emitHabitState(io, meta.channel_id, meta.space_id);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'DELETE' && req.url === '/api/habits/defs') {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const rawHabitId = pickId(body || {}, 'habitId', 'habit_id');
    const hid = String(rawHabitId || '').trim();
    if (!hid) return json(res, 400, { message: 'habitId required' }), true;
    const meta = await getHabitMeta(hid);
    if (!meta) return json(res, 404, { message: 'habit not found' }), true;
    const member = await isSpaceMember(meta.space_id, userId);
    if (!member) return json(res, 403, { message: 'Forbidden' }), true;
    await pool.query('DELETE FROM habit_defs WHERE id=$1', [hid]);
    await emitHabitState(io, meta.channel_id, meta.space_id);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'POST' && req.url === '/api/habits/opt') {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const rawHabitId = pickId(body || {}, 'habitId', 'habit_id', 'defId', 'def_id');
    const hid = String(rawHabitId || '').trim();
    if (!hid) return json(res, 400, { message: 'habitId required' }), true;
    const meta = await getHabitMeta(hid);
    if (!meta) return json(res, 404, { message: 'habit not found' }), true;
    const member = await isSpaceMember(meta.space_id, userId);
    if (!member) return json(res, 403, { message: 'Forbidden' }), true;
    const isPublic = body?.isPublic === undefined ? true : !!body.isPublic;
    await pool.query(
      'INSERT INTO habit_trackers(id, habit_id, user_id, is_public) VALUES ($1, $2, $3, $4) ON CONFLICT (habit_id, user_id) DO UPDATE SET is_public=EXCLUDED.is_public',
      [randomUUID(), hid, userId, isPublic]
    );
    await emitHabitState(io, meta.channel_id, meta.space_id);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'DELETE' && req.url === '/api/habits/opt') {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const rawHabitId = pickId(body || {}, 'habitId', 'habit_id', 'defId', 'def_id');
    const hid = String(rawHabitId || '').trim();
    if (!hid) return json(res, 400, { message: 'habitId required' }), true;
    const meta = await getHabitMeta(hid);
    if (!meta) return json(res, 404, { message: 'habit not found' }), true;
    const member = await isSpaceMember(meta.space_id, userId);
    if (!member) return json(res, 403, { message: 'Forbidden' }), true;
    await pool.query('DELETE FROM habit_trackers WHERE habit_id=$1 AND user_id=$2', [hid, userId]);
    await emitHabitState(io, meta.channel_id, meta.space_id);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'POST' && req.url === '/api/habits/entry') {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { trackerId, defId, day, done } = body || {};
    let tid = String(trackerId || '').trim();
    let habitId = '';
    let meta = null;
    if (!tid) {
      habitId = String(defId || '').trim();
      if (!habitId) return json(res, 400, { message: 'trackerId or defId required' }), true;
      meta = await getHabitMeta(habitId);
      if (!meta) return json(res, 404, { message: 'habit not found' }), true;
      const member = await isSpaceMember(meta.space_id, userId);
      if (!member) return json(res, 403, { message: 'Forbidden' }), true;
      const insert = await pool.query(
        'INSERT INTO habit_trackers(id, habit_id, user_id, is_public) VALUES ($1,$2,$3,true) ON CONFLICT (habit_id, user_id) DO NOTHING RETURNING id',
        [randomUUID(), habitId, userId]
      );
      if (insert.rowCount > 0) tid = insert.rows[0].id;
      if (!tid) {
        const existing = await pool.query('SELECT id FROM habit_trackers WHERE habit_id=$1 AND user_id=$2', [habitId, userId]);
        tid = existing.rows[0]?.id || '';
      }
      if (!tid) return json(res, 400, { message: 'tracker not found' }), true;
    } else {
      const { rows } = await pool.query(
        `SELECT t.habit_id, t.user_id, c.id as channel_id, c.space_id
         FROM habit_trackers t
         JOIN habit_defs d ON d.id = t.habit_id
         JOIN channels c ON c.id = d.channel_id
         WHERE t.id=$1`,
        [tid]
      );
      if (rows.length === 0) return json(res, 404, { message: 'tracker not found' }), true;
      if (String(rows[0].user_id) !== String(userId)) return json(res, 403, { message: 'Forbidden' }), true;
      habitId = rows[0].habit_id;
      meta = await getHabitMeta(habitId);
    }

    let dayStr = String(day || '').trim();
    if (!dayStr) {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      dayStr = `${y}-${m}-${d}`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) return json(res, 400, { message: 'invalid day' }), true;
    if (typeof done === 'boolean') {
      await pool.query(
        'INSERT INTO habit_entries(id, tracker_id, day, done) VALUES ($1, $2, $3, $4) ON CONFLICT (tracker_id, day) DO UPDATE SET done=EXCLUDED.done',
        [randomUUID(), tid, dayStr, !!done]
      );
    }
    const habitMeta = meta || (await getHabitMeta(habitId));
    if (habitMeta) await emitHabitState(io, habitMeta.channel_id, habitMeta.space_id);
    return json(res, 200, { ok: true }), true;
  }

  return false;
}
