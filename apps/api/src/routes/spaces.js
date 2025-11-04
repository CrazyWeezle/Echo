import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json, slugify } from '../utils.js';

async function ensureMember(userId, spaceId, role = 'member') {
  try { await pool.query('INSERT INTO space_members(space_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [spaceId, userId, role]); } catch {}
}

async function listSpaces(userId) {
  const { rows } = await pool.query(
    'SELECT s.id, s.name, s.avatar_url as "avatarUrl", s.home_channel_id as "homeChannelId" FROM spaces s JOIN space_members m ON m.space_id=s.id WHERE m.user_id=$1 ORDER BY s.name',
    [userId]
  );
  return rows;
}

export async function handleSpaces(req, res, body, ctx) {
  const io = ctx?.io;

  // GET /api/spaces/members?spaceId=...
  if (req.method === 'GET' && req.url.startsWith('/api/spaces/members')) {
    let viewer = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); viewer = p.sub; } catch {} }
    if (!viewer) return json(res, 401, { message: 'Unauthorized' }), true;
    let sid = '';
    try { const u = new URL('http://x' + req.url); sid = String(u.searchParams.get('spaceId') || '').trim(); } catch {}
    if (!sid) return json(res, 400, { message: 'spaceId required' }), true;
    const ok = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, viewer]);
    if (ok.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const { rows } = await pool.query(
      'SELECT u.id, u.username, u.name, u.avatar_url as "avatarUrl", COALESCE(u.status, \'\') as status, u.name_color as "nameColor", m.role as "role" FROM users u JOIN space_members m ON m.user_id=u.id WHERE m.space_id=$1 ORDER BY lower(u.name)'
    , [sid]);
    return json(res, 200, { members: rows }), true;
  }

  // DELETE /api/spaces/members
  if (req.method === 'DELETE' && req.url === '/api/spaces/members') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const sid = String((body && body.spaceId) || '').trim();
    const targetId = String((body && body.userId) || '').trim();
    if (!sid || !targetId) return json(res, 400, { message: 'spaceId and userId required' }), true;
    if (sid.startsWith('dm_')) return json(res, 400, { message: 'Cannot remove members from a DM' }), true;
    const { rows: myRole } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (!myRole[0] || myRole[0].role !== 'owner') return json(res, 403, { message: 'Only owners can remove members' }), true;
    const { rows: theirRole } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, targetId]);
    if (!theirRole[0]) return json(res, 404, { message: 'User is not a member' }), true;
    if (theirRole[0].role === 'owner') return json(res, 403, { message: 'Cannot remove an owner' }), true;
    await pool.query('DELETE FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, targetId]);
    try { io?.to(`space:${sid}`).emit('spaces:members:changed', { spaceId: sid, userId: targetId, action: 'removed' }); } catch {}
    try { const spaces = await listSpaces(targetId); io?.to(`user:${targetId}`).emit('void:list', { voids: spaces }); } catch {}
    return json(res, 200, { ok: true }), true;
  }

  // POST /api/spaces
  if (req.method === 'POST' && req.url === '/api/spaces') {
    const { name, id } = body || {};
    const nm = String(name || '').trim();
    if (!nm) return json(res, 400, { message: 'name required' }), true;
    // Allow duplicate names by ensuring the space id is unique even when
    // generated from the name. If a conflict occurs, append a short suffix.
    let sid = id ? slugify(id) : slugify(nm);
    const maxAttempts = 5;
    let ok = false; let attempt = 0; let lastErr = null;
    while (!ok && attempt < maxAttempts) {
      try {
        await pool.query('INSERT INTO spaces(id, name) VALUES ($1,$2)', [sid, nm]);
        ok = true;
      } catch (e) {
        lastErr = e;
        // Conflict on primary key id — try a new suffix only when id was generated
        if (id) break; // custom id chosen by caller; surface conflict
        const rand = randomUUID().replace(/-/g, '').slice(0, 6);
        sid = `${slugify(nm)}-${rand}`;
        attempt++;
      }
    }
    if (!ok) return json(res, 400, { message: 'space id taken' }), true;
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    await ensureMember(userId, sid, 'owner');
    try { await pool.query('INSERT INTO channels(id, space_id, name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [`${sid}:general`, sid, 'general']); } catch {}
    return json(res, 200, { id: sid, name: nm }), true;
  }

  // PATCH /api/spaces
  if (req.method === 'PATCH' && req.url === '/api/spaces') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { spaceId, name, avatarUrl, homeChannelId } = body || {};
    const sid = String(spaceId || '').trim();
    if (!sid) return json(res, 400, { message: 'spaceId required' }), true;
    const isDm = sid.startsWith('dm_');
    if (isDm) {
      const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
      if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
      const fields = []; const values = [];
      if (typeof avatarUrl === 'string' || avatarUrl === null) { fields.push('avatar_url'); values.push(avatarUrl); }
      if (typeof name === 'string') { fields.push('name'); values.push(String(name)); }
      if (typeof homeChannelId === 'string' || homeChannelId === null) {
        let hcid = homeChannelId;
        if (hcid && !String(hcid).includes(':')) hcid = `${sid}:${hcid}`;
        if (hcid) {
          const okHC = await pool.query('SELECT 1 FROM channels WHERE id=$1 AND space_id=$2', [hcid, sid]);
          if (okHC.rowCount === 0) return json(res, 400, { message: 'homeChannelId must be a channel in this space' }), true;
        }
        fields.push('home_channel_id'); values.push(hcid || null);
      }
      if (fields.length === 0) return json(res, 400, { message: 'No changes' }), true;
      const sets = fields.map((f, i) => `${f}=$${i+1}`).join(', ');
      await pool.query(`UPDATE spaces SET ${sets} WHERE id=$${fields.length+1}`, [...values, sid]);
      const { rows } = await pool.query('SELECT id, name, avatar_url as "avatarUrl", home_channel_id as "homeChannelId" FROM spaces WHERE id=$1', [sid]);
      return json(res, 200, rows[0] || { id: sid, name, avatarUrl }), true;
    } else {
      const { rows: roles } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
      if (!roles[0] || roles[0].role !== 'owner') return json(res, 403, { message: 'Only owners can update a space' }), true;
      const fields = []; const values = [];
      if (typeof name === 'string') { fields.push('name'); values.push(String(name)); }
      if (typeof avatarUrl === 'string' || avatarUrl === null) { fields.push('avatar_url'); values.push(avatarUrl); }
      if (typeof homeChannelId === 'string' || homeChannelId === null) {
        let hcid = homeChannelId;
        if (hcid && !String(hcid).includes(':')) hcid = `${sid}:${hcid}`;
        if (hcid) {
          const okHC = await pool.query('SELECT 1 FROM channels WHERE id=$1 AND space_id=$2', [hcid, sid]);
          if (okHC.rowCount === 0) return json(res, 400, { message: 'homeChannelId must be a channel in this space' }), true;
        }
        fields.push('home_channel_id'); values.push(hcid || null);
      }
      if (fields.length === 0) return json(res, 400, { message: 'No changes' }), true;
      const sets = fields.map((f, i) => `${f}=$${i+1}`).join(', ');
      await pool.query(`UPDATE spaces SET ${sets} WHERE id=$${fields.length+1}`, [...values, sid]);
      const { rows } = await pool.query('SELECT id, name, avatar_url as "avatarUrl", home_channel_id as "homeChannelId" FROM spaces WHERE id=$1', [sid]);
      return json(res, 200, rows[0] || { id: sid, name, avatarUrl }), true;
    }
  }

  // DELETE /api/spaces
  if (req.method === 'DELETE' && req.url === '/api/spaces') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const sid = String((body && body.spaceId) || '').trim();
    if (!sid) return json(res, 400, { message: 'spaceId required' }), true;
    const { rows: roles } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (!roles[0] || roles[0].role !== 'owner') return json(res, 403, { message: 'Only owners can delete a space' }), true;
    const { rowCount } = await pool.query('DELETE FROM spaces WHERE id=$1', [sid]);
    if (rowCount === 0) return json(res, 404, { message: 'Space not found' }), true;
    try { io?.to(`space:${sid}`).emit('space:deleted', { spaceId: sid }); } catch {}
    return json(res, 200, { ok: true }), true;
  }

  // POST /api/spaces/leave
  if (req.method === 'POST' && req.url === '/api/spaces/leave') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { spaceId } = body || {};
    const sid = String(spaceId || '').trim();
    if (!sid) return json(res, 400, { message: 'spaceId required' }), true;
    const roleRes = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (roleRes.rowCount === 0) return json(res, 404, { message: 'Not a member' }), true;
    if (roleRes.rows[0].role === 'owner') return json(res, 403, { message: 'Owners cannot leave. Delete or transfer.' }), true;
    await pool.query('DELETE FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    return json(res, 200, { ok: true }), true;
  }

  // POST /api/spaces/invite
  if (req.method === 'POST' && req.url === '/api/spaces/invite') {
    const { spaceId, maxUses = 1, expiresInHours, code: desiredCode } = body || {};
    const sid = String(spaceId || '').trim();
    if (!sid) return json(res, 400, { message: 'spaceId required' }), true;
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Not a member' }), true;
    let code = String(desiredCode || '').trim();
    if (code) {
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) return json(res, 400, { message: 'Invalid code. Use 4-64 letters, numbers, _ or -' }), true;
    } else {
      code = randomUUID().replace(/-/g, '').slice(0, 10);
    }
    const expires_at = expiresInHours ? new Date(Date.now() + Number(expiresInHours) * 3600 * 1000).toISOString() : null;
    try {
      await pool.query('INSERT INTO invites(code, space_id, inviter_id, max_uses, expires_at) VALUES ($1,$2,$3,$4,$5)', [code, sid, userId, Number(maxUses) || 1, expires_at]);
    } catch (e) {
      if (e && e.code === '23505') return json(res, 400, { message: 'Invite code already in use' }), true;
      return json(res, 400, { message: 'Failed to create invite' }), true;
    }
    return json(res, 200, { code, spaceId: sid }), true;
  }

  // POST /api/invites/accept
  if (req.method === 'POST' && req.url === '/api/invites/accept') {
    const { code } = body || {};
    const c = String(code || '').trim();
    if (!c) return json(res, 400, { message: 'code required' }), true;
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { rows } = await pool.query('SELECT space_id, max_uses, uses, expires_at FROM invites WHERE code=$1', [c]);
    const inv = rows[0];
    if (!inv) return json(res, 404, { message: 'Invalid code' }), true;
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) return json(res, 400, { message: 'Invite expired' }), true;
    if (inv.uses >= inv.max_uses) return json(res, 400, { message: 'Invite exhausted' }), true;
    await ensureMember(userId, inv.space_id, 'member');
    await pool.query('UPDATE invites SET uses = uses + 1 WHERE code=$1', [c]);
    return json(res, 200, { spaceId: inv.space_id }), true;
  }

  return false;
}
