import { createHash, randomUUID, scrypt as _scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config.js';

const scrypt = promisify(_scrypt);

export function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function guessImageContentType(nameOrUrl) {
  try {
    const s = String(nameOrUrl || '').toLowerCase();
    if (/\.(png)(\?.*)?$/.test(s)) return 'image/png';
    if (/\.(jpe?g|jfif)(\?.*)?$/.test(s)) return 'image/jpeg';
    if (/\.(gif)(\?.*)?$/.test(s)) return 'image/gif';
    if (/\.(webp)(\?.*)?$/.test(s)) return 'image/webp';
    if (/\.(svg)(\?.*)?$/.test(s)) return 'image/svg+xml';
    if (/\.(avif)(\?.*)?$/.test(s)) return 'image/avif';
    if (/\.(heic)(\?.*)?$/.test(s)) return 'image/heic';
    if (/\.(bmp)(\?.*)?$/.test(s)) return 'image/bmp';
    if (/\.(tiff?)(\?.*)?$/.test(s)) return 'image/tiff';
  } catch {}
  return null;
}

export function parseCookies(req) {
  const h = req.headers['cookie'] || '';
  const out = {};
  h.split(';').forEach(kv => {
    const i = kv.indexOf('=');
    if (i > -1) out[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1));
  });
  return out;
}

export function setRefreshCookie(res, token, maxAgeSec) {
  const parts = [
    `rt=${encodeURIComponent(token)}`,
    `HttpOnly`,
    `Path=/`,
    `SameSite=Lax`,
    `Max-Age=${maxAgeSec}`
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function sha256Hex(s) { return createHash('sha256').update(String(s)).digest('hex'); }

export async function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const keyLen = 64;
  const dk = await scrypt(String(password), salt, keyLen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${Buffer.from(dk).toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    if (!stored || typeof stored !== 'string') return false;
    if (!stored.startsWith('scrypt$')) {
      const legacy = sha256Hex(String(password));
      return timingSafeEqual(Buffer.from(legacy), Buffer.from(String(stored)));
    }
    const parts = stored.split('$');
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64');
    const hash = Buffer.from(parts[5], 'base64');
    const keyLen = hash.length;
    const dk = await scrypt(String(password), salt, keyLen, { N, r, p });
    return timingSafeEqual(Buffer.from(dk), hash);
  } catch { return false; }
}

export function slugify(s) {
  const out = String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return out || `id-${randomUUID().toString().slice(2,8)}`;
}

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, name: user.name }, JWT_SECRET, { expiresIn: '15m' });
}

