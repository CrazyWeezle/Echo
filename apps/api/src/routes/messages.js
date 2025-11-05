import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json } from '../utils.js';

export async function handleMessages(req, res, body, ctx) {
  // GET /api/messages/reactions?messageId=...
  if (req.method === 'GET' && req.url.startsWith('/api/messages/reactions')) {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    let mid = '';
    try { const u = new URL('http://x' + req.url); mid = String(u.searchParams.get('messageId') || '').trim(); } catch {}
    if (!mid) return json(res, 400, { message: 'messageId required' }), true;
    const chk = await pool.query('SELECT m.channel_id, c.space_id FROM messages m JOIN channels c ON c.id=m.channel_id WHERE m.id=$1', [mid]);
    if (chk.rowCount === 0) return json(res, 404, { message: 'message not found' }), true;
    const sid = chk.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const q = await pool.query(
      `SELECT r.reaction,
              r.user_id as "userId",
              COALESCE(u.name,'User') as name,
              u.username as "username",
              r.created_at as "createdAt"
       FROM message_reactions r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.message_id=$1
       ORDER BY r.reaction ASC, r.created_at DESC`,
      [mid]
    );
    const by = {};
    for (const row of q.rows) {
      const key = row.reaction;
      if (!by[key]) by[key] = [];
      by[key].push({ userId: row.userId, name: row.name, username: row.username, createdAt: row.createdAt });
    }
    return json(res, 200, { reactions: by }), true;
  }
  return false;
}
