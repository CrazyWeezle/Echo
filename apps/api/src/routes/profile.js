import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json } from '../utils.js';

// Basic validators (lightweight to avoid extra deps at runtime)
function sanitizeText(input, max = 200) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  // Drop control chars except basic whitespace
  const cleaned = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return cleaned.slice(0, max);
}

function userIdFromReq(req) {
  try {
    const h = req.headers['authorization'] || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!tok) return null;
    const payload = jwt.verify(tok, JWT_SECRET);
    return payload && payload.sub ? String(payload.sub) : null;
  } catch { return null; }
}

export async function handleProfile(req, res, body) {
  if (!req.url) return false;
  if (req.method === 'GET' && req.url === '/api/users/me/profile') {
    // Shim: return users.* as profile for compatibility; profiles table is deprecated
    const userId = userIdFromReq(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { rows } = await pool.query('SELECT id, name, bio, avatar_url, banner_url FROM users WHERE id=$1', [userId]);
    const u = rows[0];
    if (!u) return json(res, 404, { message: 'User not found' }), true;
    return json(res, 200, {
      id: u.id,
      userId: u.id,
      displayName: u.name || '',
      bio: u.bio || '',
      avatarUrl: u.avatar_url || null,
      bannerUrl: u.banner_url || null,
      updatedAt: new Date().toISOString(),
      activity: '',
      showActivity: false,
    }), true;
  }

  if (req.method === 'PATCH' && req.url === '/api/users/me/profile') {
    // Shim: update users.* only (canonical bio lives on users table)
    const userId = userIdFromReq(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const patch = body || {};
    const name = patch.displayName !== undefined ? sanitizeText(patch.displayName, 80) : undefined;
    const bio = patch.bio !== undefined ? sanitizeText(patch.bio, 280) : undefined;
    const avatarUrl = patch.avatarUrl !== undefined ? (String(patch.avatarUrl || '').slice(0, 600) || null) : undefined;
    const bannerUrl = patch.bannerUrl !== undefined ? (String(patch.bannerUrl || '').slice(0, 600) || null) : undefined;
    const fields = []; const values = [];
    if (name !== undefined) { fields.push('name'); values.push(name); }
    if (bio !== undefined) { fields.push('bio'); values.push(bio); }
    if (avatarUrl !== undefined) { fields.push('avatar_url'); values.push(avatarUrl); }
    if (bannerUrl !== undefined) { fields.push('banner_url'); values.push(bannerUrl); }
    if (fields.length === 0) return json(res, 200, {}), true;
    const sets = fields.map((f, i) => `${f}=$${i + 1}`).join(', ');
    await pool.query(`UPDATE users SET ${sets} WHERE id=$${fields.length + 1}`, [...values, userId]);
    const { rows } = await pool.query('SELECT id, name, bio, avatar_url, banner_url FROM users WHERE id=$1', [userId]);
    const u = rows[0];
    return json(res, 200, {
      id: u.id, userId: u.id,
      displayName: u.name || '',
      bio: u.bio || '',
      avatarUrl: u.avatar_url || null,
      bannerUrl: u.banner_url || null,
      updatedAt: new Date().toISOString(),
    }), true;
  }

  return false;
}
