import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json } from '../utils.js';

async function getHabitState(channelId, viewerId) {
  const defs = (await pool.query('SELECT id, name, pos FROM habit_defs WHERE channel_id=$1 ORDER BY pos ASC, created_at ASC', [channelId])).rows;
  const { rows: myT } = await pool.query('SELECT t.id, t.habit_id, t.is_public FROM habit_trackers t WHERE t.habit_id = ANY($1::uuid[]) AND t.user_id=$2', [defs.map(d=>d.id), viewerId]);
  const trackerIds = myT.map(r=>r.id);
  const since = new Date(); since.setDate(since.getDate()-30);
  const { rows: entries } = trackerIds.length>0 ? await pool.query('SELECT tracker_id, day FROM habit_entries WHERE tracker_id = ANY($1::uuid[]) AND day >= $2 AND done=true', [trackerIds, since]) : { rows: [] };
  const my = {}; for (const t of myT) my[t.habit_id] = { public: t.is_public, days: [] };
  for (const e of entries) { for (const t of myT) { if (e.tracker_id === t.id) { my[t.habit_id].days.push(String(e.day)); break; } } }
  return { defs: defs.map(d=>({ id: d.id, name: d.name, pos: d.pos })), my };
}

export async function handleHabits(req, res, body) {
  if (req.method === 'GET' && req.url.startsWith('/api/habits')) {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    let channelId = '';
    try { const u = new URL('http://x' + req.url); channelId = String(u.searchParams.get('channelId') || '').trim(); } catch {}
    if (!channelId) return json(res, 400, { message: 'channelId required' }), true;
    const found = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return json(res, 404, { message: 'channel not found' }), true;
    if (String(found.rows[0].type) !== 'habit') return json(res, 400, { message: 'not a habit channel' }), true;
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    return json(res, 200, await getHabitState(channelId, userId)), true;
  }

  if (req.method === 'POST' && req.url === '/api/habits/defs') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { channelId, name } = body || {};
    const cid = String(channelId || '').trim();
    const nm = String(name || '').trim();
    if (!cid || !nm) return json(res, 400, { message: 'channelId and name required' }), true;
    await pool.query('INSERT INTO habit_defs(id, channel_id, name, pos) VALUES ($1, $2, $3, COALESCE((SELECT MAX(pos)+1 FROM habit_defs WHERE channel_id=$2),0))', [randomUUID(), cid, nm]);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'PATCH' && req.url === '/api/habits/defs') {
    const { habitId, name, pos } = body || {};
    const hid = String(habitId || '').trim();
    if (!hid) return json(res, 400, { message: 'habitId required' }), true;
    if (typeof name === 'string') await pool.query('UPDATE habit_defs SET name=$1 WHERE id=$2', [String(name), hid]);
    if (typeof pos === 'number') await pool.query('UPDATE habit_defs SET pos=$1 WHERE id=$2', [Number(pos), hid]);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'DELETE' && req.url === '/api/habits/defs') {
    const { habitId } = body || {};
    const hid = String(habitId || '').trim();
    if (!hid) return json(res, 400, { message: 'habitId required' }), true;
    await pool.query('DELETE FROM habit_defs WHERE id=$1', [hid]);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'POST' && req.url === '/api/habits/opt') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { habitId, isPublic } = body || {};
    const hid = String(habitId || '').trim();
    const pub = typeof isPublic === 'boolean' ? !!isPublic : true;
    if (!hid) return json(res, 400, { message: 'habitId required' }), true;
    await pool.query('INSERT INTO habit_trackers(id, habit_id, user_id, is_public) VALUES ($1, $2, $3, $4) ON CONFLICT (habit_id, user_id) DO UPDATE SET is_public=EXCLUDED.is_public', [randomUUID(), hid, userId, pub]);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'DELETE' && req.url === '/api/habits/opt') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { habitId } = body || {};
    const hid = String(habitId || '').trim();
    if (!hid) return json(res, 400, { message: 'habitId required' }), true;
    await pool.query('DELETE FROM habit_trackers WHERE habit_id=$1 AND user_id=$2', [hid, userId]);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'POST' && req.url === '/api/habits/entry') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { trackerId, day, done } = body || {};
    const tid = String(trackerId || '').trim();
    if (!tid) return json(res, 400, { message: 'trackerId required' }), true;
    if (typeof done === 'boolean') {
      await pool.query('INSERT INTO habit_entries(id, tracker_id, day, done) VALUES ($1, $2, $3, $4) ON CONFLICT (tracker_id, day) DO UPDATE SET done=EXCLUDED.done', [randomUUID(), tid, day, !!done]);
    }
    return json(res, 200, { ok: true }), true;
  }

  return false;
}
