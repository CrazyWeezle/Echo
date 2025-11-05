import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json, slugify } from '../utils.js';
import { getBacklog } from '../services/chat.js';

async function listChannels(spaceId) {
  const { rows } = await pool.query("SELECT id, name, COALESCE(type,'text') as type, linked_gallery_id FROM channels WHERE space_id=$1 ORDER BY name", [spaceId]);
  return rows.map(r => ({ id: r.id, name: r.name, type: r.type, linkedGalleryId: r.linked_gallery_id || null, voidId: spaceId }));
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
    const allowed = new Set(['text','voice','announcement','kanban','form','habit','gallery','notes']);
    let ctype = String(type || 'text').toLowerCase();
    if (!allowed.has(ctype)) ctype = 'text';
    const cid = `${sid}:${base}`;
    try { await pool.query('INSERT INTO channels(id, space_id, name, type) VALUES ($1,$2,$3,$4)', [cid, sid, nm, ctype]); }
    catch { return json(res, 400, { message: 'channel id taken' }), true; }
    try { io?.to(`space:${sid}`).emit('channel:list', { voidId: sid, spaceId: sid, channels: await listChannels(sid) }); } catch {}
    return json(res, 200, { id: cid, name: nm, spaceId: sid, type: ctype }), true;
  }

  // POST /api/channels/gallery-link — link a chat channel to a gallery channel in the same space
  if (req.method === 'POST' && req.url === '/api/channels/gallery-link') {
    const { spaceId, chatChannelId, galleryChannelId } = body || {};
    const sid = String(spaceId || '').trim();
    const chatId = String(chatChannelId || '').trim();
    const galId = String(galleryChannelId || '').trim();
    if (!sid || !chatId || !galId) return json(res, 400, { message: 'spaceId, chatChannelId and galleryChannelId required' }), true;
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const { rows: chatRows } = await pool.query('SELECT id, space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [chatId]);
    const { rows: galRows } = await pool.query('SELECT id, space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [galId]);
    if (chatRows.length === 0 || galRows.length === 0) return json(res, 404, { message: 'channel not found' }), true;
    if (chatRows[0].space_id !== sid || galRows[0].space_id !== sid) return json(res, 400, { message: 'channels must belong to spaceId' }), true;
    if (galRows[0].type !== 'gallery') return json(res, 400, { message: 'galleryChannelId must be a gallery channel' }), true;
    // Allow linking from any non-gallery channel
    await pool.query('UPDATE channels SET linked_gallery_id=$1 WHERE id=$2', [galId, chatId]);
    try { io?.to(`space:${sid}`).emit('channel:list', { voidId: sid, spaceId: sid, channels: await listChannels(sid) }); } catch {}
    return json(res, 200, { ok: true }), true;
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
    try { io?.to(cid).emit('channel:deleted', { voidId: sid, spaceId: sid, channelId: cid }); } catch {}
    try { io?.to(`space:${sid}`).emit('channel:list', { voidId: sid, spaceId: sid, channels: await listChannels(sid) }); } catch {}
    return json(res, 200, { ok: true }), true;
  }

  // POST /api/channels/gallery-attachment-delete — delete a single image from a gallery message
  if (req.method === 'POST' && req.url === '/api/channels/gallery-attachment-delete') {
    const { messageId, url } = body || {};
    const mid = String(messageId || '').trim();
    const u = String(url || '').trim();
    if (!mid || !u) return json(res, 400, { message: 'messageId and url required' }), true;
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    // Load message + space
    const { rows } = await pool.query('SELECT m.channel_id, m.author_id, c.space_id, COALESCE(c.type,\'text\') as type FROM messages m JOIN channels c ON c.id=m.channel_id WHERE m.id=$1', [mid]);
    const msg = rows[0]; if (!msg) return json(res, 404, { message: 'message not found' }), true;
    // Require membership
    const mem = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [msg.space_id, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const role = mem.rows[0]?.role || 'member';
    // Allow author or space owner to delete
    if (String(msg.author_id) !== String(userId) && role !== 'owner') return json(res, 403, { message: 'Forbidden' }), true;
    // Delete the attachment by URL
    await pool.query('DELETE FROM message_attachments WHERE message_id=$1 AND url=$2', [mid, u]);
    // If message is now empty, remove it
    const { rows: rem } = await pool.query('SELECT content FROM messages WHERE id=$1', [mid]);
    if (rem[0]) {
      const { rows: attsLeft } = await pool.query('SELECT 1 FROM message_attachments WHERE message_id=$1 LIMIT 1', [mid]);
      if ((rem[0].content || '') === '' && attsLeft.length === 0) {
        await pool.query('DELETE FROM messages WHERE id=$1', [mid]);
      }
    }
    // Refresh gallery/backlog for this channel to all clients in room
    try {
      const msgs = await (await import('../services/chat.js')).getBacklog(msg.channel_id, userId, 100);
      ctx?.io?.to(msg.channel_id).emit('channel:backlog', { voidId: msg.space_id, spaceId: msg.space_id, channelId: msg.channel_id, messages: msgs });
    } catch {}
    return json(res, 200, { ok: true }), true;
  }

  // POST /api/channels/gallery-attachments-delete — bulk delete images from a gallery
  if (req.method === 'POST' && req.url === '/api/channels/gallery-attachments-delete') {
    const { items } = body || {};
    if (!Array.isArray(items) || items.length === 0) return json(res, 400, { message: 'items required' }), true;
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const touched = new Map(); // channelId -> spaceId
    let deleted = 0;
    for (const it of items) {
      const mid = String(it?.messageId || '').trim();
      const u = String(it?.url || '').trim();
      if (!mid || !u) continue;
      try {
        const { rows } = await pool.query("SELECT m.channel_id, m.author_id, c.space_id FROM messages m JOIN channels c ON c.id=m.channel_id WHERE m.id=$1", [mid]);
        const msg = rows[0]; if (!msg) continue;
        const mem = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [msg.space_id, userId]);
        if (mem.rowCount === 0) continue;
        const role = mem.rows[0]?.role || 'member';
        if (String(msg.author_id) !== String(userId) && role !== 'owner') continue;
        await pool.query('DELETE FROM message_attachments WHERE message_id=$1 AND url=$2', [mid, u]);
        const { rows: rem } = await pool.query('SELECT content FROM messages WHERE id=$1', [mid]);
        if (rem[0]) {
          const { rows: attsLeft } = await pool.query('SELECT 1 FROM message_attachments WHERE message_id=$1 LIMIT 1', [mid]);
          if ((rem[0].content || '') === '' && attsLeft.length === 0) {
            await pool.query('DELETE FROM messages WHERE id=$1', [mid]);
          }
        }
        touched.set(msg.channel_id, msg.space_id);
        deleted++;
      } catch {}
    }
    // Broadcast refreshed backlog for touched channels
    try {
      for (const [cid, sid] of touched.entries()) {
        const msgs = await (await import('../services/chat.js')).getBacklog(cid, userId, 100);
        ctx?.io?.to(cid).emit('channel:backlog', { voidId: sid, spaceId: sid, channelId: cid, messages: msgs });
      }
    } catch {}
    return json(res, 200, { ok: true, deleted }), true;
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
    const { rowCount: isMember } = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (isMember === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const check = await pool.query('SELECT 1 FROM channels WHERE id=$1 AND space_id=$2', [cid, sid]);
    if (check.rowCount === 0) return json(res, 404, { message: 'channel not found' }), true;
    await pool.query('UPDATE channels SET name=$1 WHERE id=$2', [nm, cid]);
    try { io?.to(`space:${sid}`).emit('channel:list', { voidId: sid, spaceId: sid, channels: await listChannels(sid) }); } catch {}
    return json(res, 200, { id: cid, name: nm, spaceId: sid }), true;
  }

  // POST /api/dms/clear — clear history in a DM (chat channel only)
  if (req.method === 'POST' && req.url === '/api/dms/clear') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { spaceId, days } = body || {};
    const sid = String(spaceId || '').trim();
    if (!sid || !sid.startsWith('dm_')) return json(res, 400, { message: 'spaceId must be a DM' }), true;
    // Ensure requester is a member of this DM
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    // Resolve chat channel and delete all messages (+ cascades)
    const chatId = `${sid}:chat`;
    if (days && Number(days) > 0) {
      // Delete messages in the last N days
      const n = Math.max(1, Math.min(3650, Number(days)));
      await pool.query('DELETE FROM messages WHERE channel_id=$1 AND created_at >= (now() - ($2 ||\' days\')::interval)', [chatId, String(n)]);
    } else {
      // Delete all
      await pool.query('DELETE FROM messages WHERE channel_id=$1', [chatId]);
    }
    try {
      // Push fresh backlog to room so both clients refresh view
      const msgs = await (await import('../services/chat.js')).getBacklog(chatId, userId, 100);
      io?.to(chatId).emit('channel:backlog', { voidId: sid, spaceId: sid, channelId: chatId, messages: msgs });
    } catch {}
    return json(res, 200, { ok: true }), true;
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
