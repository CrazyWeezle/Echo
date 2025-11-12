import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json } from '../utils.js';
import { getKanbanState } from '../services/chat.js';

async function getChannelMeta(channelId) {
  const ch = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [channelId]);
  if (ch.rowCount === 0) return null;
  return ch.rows[0];
}

async function ensureMember(spaceId, userId) {
  const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [spaceId, userId]);
  return mem.rowCount > 0;
}

async function fetchChannelTags(channelId) {
  const { rows } = await pool.query(
    'SELECT id, label, color, pos FROM kanban_channel_tags WHERE channel_id=$1 ORDER BY pos ASC, created_at ASC',
    [channelId]
  );
  return rows.map((r) => ({ id: r.id, label: r.label, color: r.color, pos: r.pos }));
}

async function broadcastTags(io, channelId, channelType) {
  try {
    const tags = await fetchChannelTags(channelId);
    io?.to(channelId).emit('channel:tags', { channelId, tags });
    if (channelType === 'kanban') {
      const state = await getKanbanState(channelId);
      io?.to(channelId).emit('kanban:state', { channelId, ...state });
    }
  } catch {
    // ignore broadcast errors
  }
}

async function handleGet(req, res, userId) {
  let channelId = '';
  try {
    const url = new URL('http://x' + req.url);
    channelId = String(url.searchParams.get('channelId') || '').trim();
  } catch {}
  if (!channelId) return json(res, 400, { message: 'channelId required' }), true;
  const meta = await getChannelMeta(channelId);
  if (!meta) return json(res, 404, { message: 'channel not found' }), true;
  const allowed = await ensureMember(meta.space_id, userId);
  if (!allowed) return json(res, 403, { message: 'Forbidden' }), true;
  const tags = await fetchChannelTags(channelId);
  return json(res, 200, { tags }), true;
}

export async function handleChannelTags(req, res, body, ctx) {
  if (!req.url.startsWith('/api/channel-tags')) return false;
  let userId = null;
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET);
      userId = payload.sub;
    } catch {}
  }
  if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;

  if (req.method === 'GET') {
    return handleGet(req, res, userId);
  }

  const io = ctx?.io;

  if (req.method === 'POST') {
    const { channelId, label, color } = body || {};
    const cid = String(channelId || '').trim();
    const lbl = String(label || '').trim();
    if (!cid || !lbl) return json(res, 400, { message: 'channelId and label required' }), true;
    const meta = await getChannelMeta(cid);
    if (!meta) return json(res, 404, { message: 'channel not found' }), true;
    const allowed = await ensureMember(meta.space_id, userId);
    if (!allowed) return json(res, 403, { message: 'Forbidden' }), true;
    const { rows: posRows } = await pool.query('SELECT COALESCE(MAX(pos), 0) + 1 as pos FROM kanban_channel_tags WHERE channel_id=$1', [cid]);
    const pos = Number(posRows[0]?.pos || 0);
    const hex = typeof color === 'string' ? color.trim() : null;
    const newId = randomUUID();
    const { rows } = await pool.query(
      'INSERT INTO kanban_channel_tags(id, channel_id, label, color, pos) VALUES ($1, $2, $3, $4, $5) RETURNING id, label, color, pos',
      [newId, cid, lbl, hex || null, pos]
    );
    await broadcastTags(io, cid, meta.type);
    return json(res, 200, { tag: rows[0], channelId: cid }), true;
  }

  if (req.method === 'PATCH') {
    const { tagId, label, color } = body || {};
    const tid = String(tagId || '').trim();
    if (!tid) return json(res, 400, { message: 'tagId required' }), true;
    const meta = await pool.query('SELECT t.channel_id, c.space_id, COALESCE(c.type,\'text\') as type FROM kanban_channel_tags t JOIN channels c ON c.id=t.channel_id WHERE t.id=$1', [tid]);
    if (meta.rowCount === 0) return json(res, 404, { message: 'tag not found' }), true;
    const cid = meta.rows[0].channel_id;
    const sid = meta.rows[0].space_id;
    const channelType = meta.rows[0].type;
    const allowed = await ensureMember(sid, userId);
    if (!allowed) return json(res, 403, { message: 'Forbidden' }), true;
    const updates = [];
    const params = [];
    let idx = 1;
    if (label !== undefined) {
      const lbl = String(label || '').trim();
      if (!lbl) return json(res, 400, { message: 'label cannot be empty' }), true;
      updates.push(`label=$${idx++}`);
      params.push(lbl);
    }
    if (color !== undefined) {
      const hex = typeof color === 'string' ? color.trim() : null;
      updates.push(`color=$${idx++}`);
      params.push(hex || null);
    }
    if (updates.length === 0) return json(res, 400, { message: 'No changes provided' }), true;
    params.push(tid);
    await pool.query(`UPDATE kanban_channel_tags SET ${updates.join(', ')} WHERE id=$${idx}`, params);
    const { rows } = await pool.query('SELECT id, label, color, pos FROM kanban_channel_tags WHERE id=$1', [tid]);
    await broadcastTags(io, cid, channelType);
    return json(res, 200, { tag: rows[0], channelId: cid }), true;
  }

  if (req.method === 'DELETE') {
    const { tagId } = body || {};
    const tid = String(tagId || '').trim();
    if (!tid) return json(res, 400, { message: 'tagId required' }), true;
    const meta = await pool.query('SELECT t.channel_id, c.space_id, COALESCE(c.type,\'text\') as type FROM kanban_channel_tags t JOIN channels c ON c.id=t.channel_id WHERE t.id=$1', [tid]);
    if (meta.rowCount === 0) return json(res, 404, { message: 'tag not found' }), true;
    const cid = meta.rows[0].channel_id;
    const sid = meta.rows[0].space_id;
    const channelType = meta.rows[0].type;
    const allowed = await ensureMember(sid, userId);
    if (!allowed) return json(res, 403, { message: 'Forbidden' }), true;
    await pool.query('DELETE FROM kanban_channel_tags WHERE id=$1', [tid]);
    await broadcastTags(io, cid, channelType);
    return json(res, 200, { ok: true, channelId: cid }), true;
  }

  return json(res, 405, { message: 'Method not allowed' }), true;
}
