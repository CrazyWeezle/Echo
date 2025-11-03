import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json, slugify } from '../utils.js';
import { getBacklog } from '../services/chat.js';

async function listChannels(spaceId) {
  const { rows } = await pool.query('SELECT id, name, COALESCE(type,\'text\') as type FROM channels WHERE space_id=$1 ORDER BY name', [spaceId]);
  return rows.map(r => ({ id: r.id, name: r.name, type: r.type, voidId: spaceId }));
}

export async function handleChannels(req, res, body, ctx) {
  const io = ctx?.io;

  // POST /api/channels
  if (req.method === 'POST' && req.url === '/api/channels') {
    const { spaceId, name, id, type } = body || {};
    const sid = String(spaceId || '').trim();
    const nm = String(name || '').trim();
    if (!sid || !nm) return json(res, 400, { message: 'spaceId and name required' }), true;
    if (sid.startsWith('dm_')) return json(res, 403, { message: 'Cannot create channels in a DM' }), true;
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Not a member of this space' }), true;
    const { rows: srows } = await pool.query('SELECT 1 FROM spaces WHERE id=$1', [sid]);
    if (srows.length === 0) return json(res, 404, { message: 'space not found' }), true;
    const base = id ? slugify(id) : slugify(nm);
    const allowed = new Set(['text','voice','announcement','kanban','form','habit']);
    let ctype = String(type || 'text').toLowerCase();
    if (!allowed.has(ctype)) ctype = 'text';
    const cid = `${sid}:${base}`;
    try { await pool.query('INSERT INTO channels(id, space_id, name, type) VALUES ($1,$2,$3,$4)', [cid, sid, nm, ctype]); }
    catch { return json(res, 400, { message: 'channel id taken' }), true; }
    try { io?.to(`space:${sid}`).emit('channel:list', { voidId: sid, channels: await listChannels(sid) }); } catch {}
    return json(res, 200, { id: cid, name: nm, spaceId: sid, type: ctype }), true;
  }

  // POST /api/channels/delete
  if (req.method === 'POST' && req.url === '/api/channels/delete') {
    const { spaceId, channelId } = body || {};
    const sid = String(spaceId || '').trim();
    const cid = String(channelId || '').trim();
    if (!sid || !cid) return json(res, 400, { message: 'spaceId and channelId required' }), true;
    if (sid.startsWith('dm_')) return json(res, 403, { message: 'Cannot delete channels in a DM' }), true;
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { rows: roles } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (!roles[0] || roles[0].role !== 'owner') return json(res, 403, { message: 'Only owners can delete channels' }), true;
    const { rows } = await pool.query('SELECT 1 FROM channels WHERE id=$1 AND space_id=$2', [cid, sid]);
    if (rows.length === 0) return json(res, 404, { message: 'channel not found' }), true;
    await pool.query('DELETE FROM channels WHERE id=$1', [cid]);
    try { io?.to(cid).emit('channel:deleted', { voidId: sid, channelId: cid }); } catch {}
    try { io?.to(`space:${sid}`).emit('channel:list', { voidId: sid, channels: await listChannels(sid) }); } catch {}
    return json(res, 200, { ok: true }), true;
  }

  // POST /api/channels/rename
  if (req.method === 'POST' && req.url === '/api/channels/rename') {
    const { spaceId, channelId, name } = body || {};
    const sid = String(spaceId || '').trim();
    const cid = String(channelId || '').trim();
    const nm = String(name || '').trim();
    if (!sid || !cid || !nm) return json(res, 400, { message: 'spaceId, channelId and name required' }), true;
    if (sid.startsWith('dm_')) return json(res, 403, { message: 'Cannot rename channels in a DM' }), true;
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { rows: roles } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (!roles[0] || roles[0].role !== 'owner') return json(res, 403, { message: 'Only owners can rename channels' }), true;
    const check = await pool.query('SELECT 1 FROM channels WHERE id=$1 AND space_id=$2', [cid, sid]);
    if (check.rowCount === 0) return json(res, 404, { message: 'channel not found' }), true;
    await pool.query('UPDATE channels SET name=$1 WHERE id=$2', [nm, cid]);
    try { io?.to(`space:${sid}`).emit('channel:list', { voidId: sid, channels: await listChannels(sid) }); } catch {}
    return json(res, 200, { id: cid, name: nm, spaceId: sid }), true;
  }

  // GET /api/channels/preview?channelId=...&limit=5
  if (req.method === 'GET' && req.url.startsWith('/api/channels/preview')) {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    let channelId = '';
    let limit = 5;
    try {
      const u = new URL('http://x' + req.url);
      channelId = String(u.searchParams.get('channelId') || '').trim();
      limit = Math.max(1, Math.min(20, Number(u.searchParams.get('limit') || '5')));
    } catch {}
    if (!channelId) return json(res, 400, { message: 'channelId required' }), true;
    const found = await pool.query('SELECT space_id FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return json(res, 404, { message: 'channel not found' }), true;
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const messages = await getBacklog(channelId, userId, limit);
    return json(res, 200, { messages }), true;
  }

  return false;
}
