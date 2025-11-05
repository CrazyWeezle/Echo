import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json, setRefreshCookie, verifyPassword, hashPassword } from '../utils.js';

export async function handleUsers(req, res, body, ctx) {
  const io = ctx?.io;
  // GET /api/users/me
  if (req.method === 'GET' && req.url === '/api/users/me') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { rows } = await pool.query('SELECT id, username, name, avatar_url as "avatarUrl", bio, COALESCE(status, \'\') as status, tone_url as "toneUrl", name_color as "nameColor", friend_ring_color as "friendRingColor", COALESCE(friend_ring_enabled, true) as "friendRingEnabled", COALESCE(pronouns, \'\') as pronouns, COALESCE(location, \'\') as location, COALESCE(website, \'\') as website, COALESCE(banner_url, \'\') as "bannerUrl" FROM users WHERE id=$1', [userId]);
    const u = rows[0];
    if (!u) return json(res, 404, { message: 'User not found' }), true;
    return json(res, 200, u), true;
  }

  // PATCH /api/users/me
  if (req.method === 'PATCH' && req.url === '/api/users/me') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { name, bio, avatarUrl, status, toneUrl, nameColor, friendRingColor, friendRingEnabled, pronouns, location, website, bannerUrl } = body || {};
    const fields = []; const values = [];
    if (typeof name === 'string') { fields.push('name'); values.push(String(name).trim().slice(0, 64)); }
    if (typeof bio === 'string' || bio === null) { fields.push('bio'); values.push(bio ? String(bio).trim().slice(0, 2048) : null); }
    if (typeof avatarUrl === 'string' || avatarUrl === null) { fields.push('avatar_url'); values.push(avatarUrl ? String(avatarUrl).trim().slice(0, 2048) : null); }
    if (typeof status === 'string') { fields.push('status'); values.push(String(status).trim().slice(0, 20)); }
    if (typeof toneUrl === 'string' || toneUrl === null) { fields.push('tone_url'); values.push(toneUrl ? String(toneUrl).trim().slice(0, 2048) : null); }
    if (typeof nameColor === 'string' || nameColor === null) {
      let c = nameColor;
      if (typeof c === 'string') {
        c = String(c).trim();
        const hexOk = /^#?[0-9a-fA-F]{3,8}$/.test(c);
        if (!hexOk && !/^[a-zA-Z]{1,15}$/.test(c)) c = null;
      }
      fields.push('name_color'); values.push(c ?? null);
    }
    if (typeof friendRingColor === 'string' || friendRingColor === null) {
      let c = friendRingColor;
      if (typeof c === 'string') {
        c = String(c).trim();
        const hexOk = /^#?[0-9a-fA-F]{3,8}$/.test(c);
        if (!hexOk && !/^[a-zA-Z]{1,15}$/.test(c)) c = null;
      }
      fields.push('friend_ring_color'); values.push(c ?? null);
    }
    if (typeof friendRingEnabled === 'boolean') { fields.push('friend_ring_enabled'); values.push(!!friendRingEnabled); }
    if (typeof pronouns === 'string') { fields.push('pronouns'); values.push(String(pronouns).trim().slice(0, 32)); }
    if (typeof location === 'string') { fields.push('location'); values.push(String(location).trim().slice(0, 80)); }
    if (typeof bannerUrl === 'string' || bannerUrl === null) { fields.push('banner_url'); values.push(bannerUrl ? String(bannerUrl).trim().slice(0, 2048) : null); }
    if (typeof website === 'string' || website === null) {
      let w = website;
      if (typeof w === 'string') {
        w = String(w).trim().slice(0, 2048);
        if (w && !/^https?:\/\//i.test(w)) w = `https://${w}`;
        try { const u = new URL(w); if (!/^https?:$/i.test(u.protocol)) w = null; } catch { w = null; }
      }
      fields.push('website'); values.push(w ?? null);
    }
    if (fields.length === 0) return json(res, 400, { message: 'No updatable fields' }), true;
    const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    await pool.query(`UPDATE users SET ${sets} WHERE id = $${fields.length + 1}`, [...values, userId]);
    const { rows } = await pool.query('SELECT id, username, name, avatar_url as "avatarUrl", bio, COALESCE(status, \'\') as status, tone_url as "toneUrl", name_color as "nameColor", friend_ring_color as "friendRingColor", COALESCE(friend_ring_enabled, true) as "friendRingEnabled", COALESCE(pronouns, \'\') as pronouns, COALESCE(location, \'\') as location, COALESCE(website, \'\') as website, COALESCE(banner_url, \'\') as "bannerUrl" FROM users WHERE id=$1', [userId]);
    if (typeof status === 'string' && io) {
      try {
        const s = String(status).trim().slice(0, 20);
        const { rows: spaces } = await pool.query('SELECT space_id FROM space_members WHERE user_id=$1', [userId]);
        for (const r of spaces) {
          try { io.to(`space:${r.space_id}`).emit('user:status', { userId, status: s }); } catch {}
        }
        try { io.to('global').emit('user:status', { userId, status: s }); } catch {}
      } catch {}
    }
    return json(res, 200, rows[0]), true;
  }

  // POST /api/users/deactivate
  if (req.method === 'POST' && req.url === '/api/users/deactivate') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    await pool.query('UPDATE users SET deactivated_at = now() WHERE id=$1', [userId]);
    await pool.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
    setRefreshCookie(res, '', 0);
    return json(res, 200, { ok: true }), true;
  }

  // GET /api/users/profile?userId=... or ?username=...
  if (req.method === 'GET' && req.url.startsWith('/api/users/profile')) {
    let viewer = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); viewer = p.sub; } catch {} }
    if (!viewer) return json(res, 401, { message: 'Unauthorized' }), true;
    let uid = null, uname = null;
    try {
      const u = new URL('http://x' + req.url);
      uid = String(u.searchParams.get('userId') || '').trim();
      uname = String(u.searchParams.get('username') || '').trim().toLowerCase();
    } catch {}
    if (!uid && !uname) return json(res, 400, { message: 'userId or username required' }), true;
    const q = uid
      ? await pool.query(
          `SELECT u.id, u.username, u.name, u.avatar_url as "avatarUrl", u.bio, COALESCE(u.status,'') as status,
                  u.tone_url as "toneUrl", u.name_color as "nameColor", u.friend_ring_color as "friendRingColor",
                  COALESCE(u.friend_ring_enabled, true) as "friendRingEnabled", COALESCE(u.pronouns,'') as pronouns,
                  COALESCE(u.location,'') as location, COALESCE(u.website,'') as website, COALESCE(u.banner_url,'') as "bannerUrl"
           FROM users u WHERE u.id=$1`,
          [uid]
        )
      : await pool.query(
          `SELECT u.id, u.username, u.name, u.avatar_url as "avatarUrl", u.bio, COALESCE(u.status,'') as status,
                  u.tone_url as "toneUrl", u.name_color as "nameColor", u.friend_ring_color as "friendRingColor",
                  COALESCE(u.friend_ring_enabled, true) as "friendRingEnabled", COALESCE(u.pronouns,'') as pronouns,
                  COALESCE(u.location,'') as location, COALESCE(u.website,'') as website, COALESCE(u.banner_url,'') as "bannerUrl"
           FROM users u WHERE u.username=$1`,
          [uname]
        );
    const row = q.rows[0];
    if (!row) return json(res, 404, { message: 'User not found' }), true;
    // Enrich with friendship metadata relative to the viewer so the
    // client can switch between "Add Friend" and "Message" states.
    try {
      if (row.id !== viewer) {
        const a = String(row.id) < String(viewer) ? String(row.id) : String(viewer);
        const b = String(row.id) < String(viewer) ? String(viewer) : String(row.id);
        const fr = await pool.query('SELECT 1 FROM friendships WHERE user_id_a=$1 AND user_id_b=$2', [a, b]);
        const isFriend = fr.rowCount > 0;
        let incomingRequestId = null;
        let outgoingRequestId = null;
        if (!isFriend) {
          const inc = await pool.query('SELECT id FROM friend_requests WHERE from_user=$1 AND to_user=$2', [row.id, viewer]);
          if (inc.rowCount > 0) incomingRequestId = inc.rows[0].id;
          const out = await pool.query('SELECT id FROM friend_requests WHERE from_user=$1 AND to_user=$2', [viewer, row.id]);
          if (out.rowCount > 0) outgoingRequestId = out.rows[0].id;
        }
        return json(res, 200, { ...row, isFriend, incomingRequestId, outgoingRequestId }), true;
      }
    } catch {}
    return json(res, 200, row), true;
  }

  // --- Favorites (channels/lists) -------------------------------------------------
  // GET /api/users/me/favorites
  if (req.method === 'GET' && req.url === '/api/users/me/favorites') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { rows } = await pool.query('SELECT target_id FROM favorites WHERE user_id=$1 ORDER BY created_at DESC', [userId]);
    return json(res, 200, { favorites: rows.map(r => r.target_id) }), true;
  }

  // POST /api/users/me/favorites  { id } OR { favorites: string[] } (replace all)
  if (req.method === 'POST' && req.url === '/api/users/me/favorites') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { id, favorites } = body || {};
    if (Array.isArray(favorites)) {
      // Replace all (cap at 16 for safety)
      const uniq = Array.from(new Set(favorites.map((s) => String(s).slice(0, 256)))).slice(0, 16);
      await pool.query('DELETE FROM favorites WHERE user_id=$1', [userId]);
      for (const t of uniq) {
        try { await pool.query('INSERT INTO favorites(user_id, target_id) VALUES ($1,$2)', [userId, t]); } catch {}
      }
      return json(res, 200, { favorites: uniq }), true;
    }
    const t = String(id || '').slice(0, 256);
    if (!t) return json(res, 400, { message: 'id required' }), true;
    try { await pool.query('INSERT INTO favorites(user_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, t]); } catch {}
    return json(res, 200, { ok: true }), true;
  }

  // DELETE /api/users/me/favorites  { id }
  if (req.method === 'DELETE' && req.url === '/api/users/me/favorites') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { id } = body || {};
    const t = String(id || '').slice(0, 256);
    if (!t) return json(res, 400, { message: 'id required' }), true;
    await pool.query('DELETE FROM favorites WHERE user_id=$1 AND target_id=$2', [userId, t]);
    return json(res, 200, { ok: true }), true;
  }

  // PATCH /api/users/me (continued): also support activity + showActivity in profiles
  if (req.method === 'PATCH' && req.url === '/api/users/me') {
    // handled above for core fields; now add-on for mini status
    try {
      let userId = null;
      const auth = req.headers['authorization'] || '';
      if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
      if (!userId) ; else {
        const { activity, showActivity } = body || {};
        const updates = [];
        const vals = [];
        let i = 1;
        if (typeof activity === 'string' || activity === null) { updates.push(`mini_status=$${i++}`); vals.push(activity ? String(activity).slice(0, 160) : null); }
        if (typeof showActivity === 'boolean') { updates.push(`mini_status_show=$${i++}`); vals.push(!!showActivity); }
        if (updates.length > 0) {
          await pool.query('INSERT INTO profiles(id, user_id, display_name) VALUES (gen_random_uuid(), $1, \'\') ON CONFLICT (user_id) DO NOTHING', [userId]).catch(async () => {
            // Fallback: if gen_random_uuid is unavailable, ensure existence via a SELECT/INSERT from Node
            const got = await pool.query('SELECT 1 FROM profiles WHERE user_id=$1', [userId]);
            if (got.rowCount === 0) {
              const { randomUUID } = await import('node:crypto');
              await pool.query('INSERT INTO profiles(id, user_id, display_name) VALUES ($1,$2,$3)', [randomUUID(), userId, '']);
            }
          });
          const sql = `UPDATE profiles SET ${updates.join(', ')}, updated_at=now() WHERE user_id=$${i}`;
          await pool.query(sql, [...vals, userId]);
        }
      }
    } catch {}
    // fall through to original return already handled above
  }

  // POST /api/users/password
  if (req.method === 'POST' && req.url === '/api/users/password') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { oldPassword, newPassword } = body || {};
    const oldPw = String(oldPassword || '');
    const newPw = String(newPassword || '');
    if (newPw.length < 8) return json(res, 400, { message: 'New password must be at least 8 characters' }), true;
    const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE id=$1', [userId]);
    const user = rows[0];
    if (!user) return json(res, 404, { message: 'User not found' }), true;
    if (!(await verifyPassword(oldPw, user.password_hash))) return json(res, 400, { message: 'Old password is incorrect' }), true;
    const ph = await hashPassword(newPw);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [ph, userId]);
    return json(res, 200, { ok: true }), true;
  }

  return false;
}
