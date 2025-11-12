import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json } from '../utils.js';
import { getKanbanState } from '../services/chat.js';

export async function handleKanban(req, res, body, ctx) {
  const io = ctx?.io;

  if (req.method === 'GET' && req.url.startsWith('/api/kanban')) {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    let channelId = '';
    try { const u = new URL('http://x' + req.url); channelId = String(u.searchParams.get('channelId') || '').trim(); } catch {}
    if (!channelId) return json(res, 400, { message: 'channelId required' }), true;
    const found = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return json(res, 404, { message: 'channel not found' }), true;
    if (String(found.rows[0].type) !== 'kanban') return json(res, 400, { message: 'not a kanban channel' }), true;
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const state = await getKanbanState(channelId);
    return json(res, 200, state), true;
  }

  if (req.method === 'POST' && req.url === '/api/kanban/lists') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { channelId, name } = body || {};
    const cid = String(channelId || '').trim();
    const nm = String(name || '').trim();
    if (!cid || !nm) return json(res, 400, { message: 'channelId and name required' }), true;
    const ch = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [cid]);
    if (ch.rowCount === 0) return json(res, 404, { message: 'channel not found' }), true;
    if (String(ch.rows[0].type) !== 'kanban') return json(res, 400, { message: 'not a kanban channel' }), true;
    const sid = ch.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const { rows: posr } = await pool.query('SELECT COALESCE(MAX(pos), 0) + 1 as pos FROM kanban_lists WHERE channel_id=$1', [cid]);
    const pos = Number(posr[0]?.pos || 0);
    const newId = randomUUID();
    const { rows } = await pool.query('INSERT INTO kanban_lists(id, channel_id, name, pos) VALUES ($1, $2, $3, $4) RETURNING id, name, pos', [newId, cid, nm, pos]);
    try {
      const state = await getKanbanState(cid);
      io?.to(cid).emit('kanban:state', { channelId: cid, ...state });
    } catch {}
    return json(res, 200, { list: rows[0] }), true;
  }

  if (req.method === 'PATCH' && req.url === '/api/kanban/lists') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { listId, name } = body || {};
    const lid = String(listId || '').trim();
    const nm = String(name || '').trim();
    if (!lid || !nm) return json(res, 400, { message: 'listId and name required' }), true;
    await pool.query('UPDATE kanban_lists SET name=$1 WHERE id=$2', [nm, lid]);
    const { rows } = await pool.query('SELECT channel_id FROM kanban_lists WHERE id=$1', [lid]);
    const cid = rows[0]?.channel_id;
    try {
      const state = await getKanbanState(cid);
      io?.to(cid).emit('kanban:state', { channelId: cid, ...state });
    } catch {}
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'DELETE' && req.url === '/api/kanban/lists') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { listId } = body || {};
    const lid = String(listId || '').trim();
    if (!lid) return json(res, 400, { message: 'listId required' }), true;
    const { rows } = await pool.query('SELECT channel_id FROM kanban_lists WHERE id=$1', [lid]);
    const cid = rows[0]?.channel_id;
    await pool.query('DELETE FROM kanban_lists WHERE id=$1', [lid]);
    try {
      const state = await getKanbanState(cid);
      io?.to(cid).emit('kanban:state', { channelId: cid, ...state });
    } catch {}
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'POST' && req.url === '/api/kanban/items') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { listId, content, tagLabel, tagColor } = body || {};
    const lid = String(listId || '').trim();
    const text = String(content || '').trim();
    if (!lid || !text) return json(res, 400, { message: 'listId and content required' }), true;
    const { rows } = await pool.query('SELECT channel_id FROM kanban_lists WHERE id=$1', [lid]);
    const cid = rows[0]?.channel_id;
    const { rows: posr } = await pool.query('SELECT COALESCE(MAX(pos), 0) + 1 as pos FROM kanban_items WHERE list_id=$1', [lid]);
    const pos = Number(posr[0]?.pos || 0);
    const label = typeof tagLabel === 'string' ? tagLabel.trim() : null;
    const color = typeof tagColor === 'string' ? tagColor.trim() : null;
    await pool.query(
      'INSERT INTO kanban_items(id, list_id, content, pos, done, tag_label, tag_color, created_by) VALUES ($1, $2, $3, $4, false, $5, $6, $7)',
      [randomUUID(), lid, text, pos, label || null, color || null, userId]
    );
    try {
      const state = await getKanbanState(cid);
      io?.to(cid).emit('kanban:state', { channelId: cid, ...state });
    } catch {}
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'POST' && req.url === '/api/kanban/items/reorder') {
    const { listId, orderedIds } = body || {};
    const lid = String(listId || '').trim();
    const ids = Array.isArray(orderedIds) ? orderedIds : [];
    if (!lid || ids.length === 0) return json(res, 400, { message: 'listId and orderedIds required' }), true;
    let pos = 0;
    for (const id of ids) {
      pos += 1;
      await pool.query('UPDATE kanban_items SET pos=$1 WHERE id=$2 AND list_id=$3', [pos, id, lid]);
    }
    const { rows } = await pool.query('SELECT channel_id FROM kanban_lists WHERE id=$1', [lid]);
    const cid = rows[0]?.channel_id;
    try {
      const state = await getKanbanState(cid);
      io?.to(cid).emit('kanban:state', { channelId: cid, ...state });
    } catch {}
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'POST' && req.url === '/api/kanban/lists/reorder') {
    const { channelId, orderedIds } = body || {};
    const cid = String(channelId || '').trim();
    const ids = Array.isArray(orderedIds) ? orderedIds : [];
    if (!cid || ids.length === 0) return json(res, 400, { message: 'channelId and orderedIds required' }), true;
    let pos = 0;
    for (const id of ids) {
      pos += 1;
      await pool.query('UPDATE kanban_lists SET pos=$1 WHERE id=$2 AND channel_id=$3', [pos, id, cid]);
    }
    try {
      const state = await getKanbanState(cid);
      io?.to(cid).emit('kanban:state', { channelId: cid, ...state });
    } catch {}
    return json(res, 200, { ok: true }), true;
  }
  if (req.method === 'PATCH' && req.url === '/api/kanban/items') {
    const { itemId, content, done, tagLabel, tagColor } = body || {};
    const iid = String(itemId || '').trim();
    if (!iid) return json(res, 400, { message: 'itemId required' }), true;
    if (typeof content === 'string') await pool.query('UPDATE kanban_items SET content=$1 WHERE id=$2', [String(content), iid]);
    if (typeof done === 'boolean') await pool.query('UPDATE kanban_items SET done=$1 WHERE id=$2', [!!done, iid]);
    if (tagLabel !== undefined) {
      const label = typeof tagLabel === 'string' ? tagLabel.trim() : null;
      await pool.query('UPDATE kanban_items SET tag_label=$1 WHERE id=$2', [label, iid]);
    }
    if (tagColor !== undefined) {
      const color = typeof tagColor === 'string' ? tagColor.trim() : null;
      await pool.query('UPDATE kanban_items SET tag_color=$1 WHERE id=$2', [color, iid]);
    }
    const { rows } = await pool.query('SELECT list_id FROM kanban_items WHERE id=$1', [iid]);
    const lid = rows[0]?.list_id;
    const { rows: ch } = await pool.query('SELECT channel_id FROM kanban_lists WHERE id=$1', [lid]);
    const cid = ch[0]?.channel_id;
    try {
      const state = await getKanbanState(cid);
      io?.to(cid).emit('kanban:state', { channelId: cid, ...state });
    } catch {}
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'DELETE' && req.url === '/api/kanban/items') {
    const { itemId } = body || {};
    const iid = String(itemId || '').trim();
    if (!iid) return json(res, 400, { message: 'itemId required' }), true;
    const { rows } = await pool.query('SELECT list_id FROM kanban_items WHERE id=$1', [iid]);
    const lid = rows[0]?.list_id;
    const { rows: ch } = await pool.query('SELECT channel_id FROM kanban_lists WHERE id=$1', [lid]);
    const cid = ch[0]?.channel_id;
    await pool.query('DELETE FROM kanban_items WHERE id=$1', [iid]);
    try {
      const state = await getKanbanState(cid);
      io?.to(cid).emit('kanban:state', { channelId: cid, ...state });
    } catch {}
    return json(res, 200, { ok: true }), true;
  }

  return false;
}
