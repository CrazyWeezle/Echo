import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json } from '../utils.js';

function authUser(req) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    return payload?.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

export async function handleVoice(req, res, body, ctx = {}) {
  if (req.method === 'POST' && req.url === '/api/voice/ping') {
    const userId = authUser(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { spaceId, channelId, memberIds, message } = body || {};
    const sid = String(spaceId || '').trim();
    const cid = String(channelId || '').trim();
    if (!sid || !cid) return json(res, 400, { message: 'spaceId and channelId required' }), true;
    const chan = await pool.query('SELECT id, space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [cid]);
    if (chan.rowCount === 0) return json(res, 404, { message: 'Channel not found' }), true;
    if (chan.rows[0].space_id !== sid) return json(res, 400, { message: 'Channel not in space' }), true;
    if (String(chan.rows[0].type) !== 'voice') return json(res, 400, { message: 'Channel is not voice' }), true;
    const member = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (member.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const display = await pool.query('SELECT name FROM users WHERE id=$1', [userId]);
    const displayName = display.rows[0]?.name || 'Someone';
    const targets = Array.isArray(memberIds) && memberIds.length > 0
      ? memberIds.map((m) => String(m)).filter(Boolean)
      : (await pool.query('SELECT user_id FROM space_members WHERE space_id=$1', [sid])).rows.map(r => String(r.user_id));
    const io = ctx?.io;
    const content = String(message || `${displayName} is in a call`).slice(0, 140);
    for (const target of targets) {
      try {
        io?.to(`user:${target}`).emit('user:notify', {
          kind: 'voice:ping',
          voidId: sid,
          channelId: cid,
          authorId: userId,
          authorName: displayName,
          content,
        });
      } catch {}
    }
    return json(res, 200, { ok: true, sent: targets.length }), true;
  }
  return false;
}
