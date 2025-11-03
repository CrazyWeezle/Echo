import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json } from '../utils.js';

export async function handlePush(req, res, body) {
  if (req.method === 'POST' && req.url === '/api/push/register') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { token, platform } = body || {};
    const dtok = String(token || '').trim();
    const plat = String(platform || '').trim();
    if (!dtok) return json(res, 400, { message: 'token required' }), true;
    try {
      await pool.query('INSERT INTO push_devices(token, user_id, platform) VALUES ($1,$2,$3) ON CONFLICT (token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform', [dtok, userId, plat]);
      return json(res, 200, { ok: true }), true;
    } catch (e) {
      return json(res, 400, { ok: false, message: 'failed to register' }), true;
    }
  }

  if (req.method === 'POST' && req.url === '/api/push/unregister') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { token } = body || {};
    const dtok = String(token || '').trim();
    if (!dtok) return json(res, 400, { message: 'token required' }), true;
    try {
      await pool.query('DELETE FROM push_devices WHERE token=$1 AND user_id=$2', [dtok, userId]);
      return json(res, 200, { ok: true }), true;
    } catch (e) {
      return json(res, 400, { ok: false, message: 'failed to unregister' }), true;
    }
  }

  return false;
}

