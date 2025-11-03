// Minimal ECHO API: auth + socket events
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool, initDb } from './db.js';
import { JWT_SECRET, ALLOWED_ORIGINS, PORT } from './config.js';
import { json, guessImageContentType, parseCookies, setRefreshCookie, sha256Hex, hashPassword, verifyPassword, slugify, signAccessToken } from './utils.js';
import { handleAuth } from './routes/auth.js';
import { handleUsers } from './routes/users.js';
import { handleSpaces } from './routes/spaces.js';
import { handleChannels } from './routes/channels.js';
import { handleFriends } from './routes/friends.js';
import { handleFiles } from './routes/files.js';
import { handleKanban } from './routes/kanban.js';
import { handleForms } from './routes/forms.js';
import { handleHabits } from './routes/habits.js';
import { handlePush } from './routes/push.js';
import { listSpaces, listChannels, getBacklog } from './services/chat.js';

// Global safety nets to avoid process crashes on unexpected errors
process.on('unhandledRejection', (err) => {
  try { console.error('[api] Unhandled promise rejection', err); } catch {}
});
process.on('uncaughtException', (err) => {
  try { console.error('[api] Uncaught exception', err); } catch {}
});

// JSON helper provided by utils

// Content-type inference moved to utils

// Very small router for POST /auth/login and /auth/signup

// Database config and init moved to ./db.js

// Helper functions moved to utils

// Legacy in-memory sessions for dev-only (will not be used when DB available)
const sessions = new Map(); // accessToken -> { userId } (fallback)

// --- Friends helpers ---
function sortPair(a, b) {
  return String(a) < String(b) ? [String(a), String(b)] : [String(b), String(a)];
}
async function friendshipExists(a, b) {
  const [x, y] = sortPair(a, b);
  const r = await pool.query('SELECT 1 FROM friendships WHERE user_id_a=$1 AND user_id_b=$2', [x, y]);
  return r.rowCount > 0;
}
async function createFriendship(a, b) {
  const [x, y] = sortPair(a, b);
  await pool.query('INSERT INTO friendships(user_id_a, user_id_b) VALUES ($1,$2) ON CONFLICT DO NOTHING', [x, y]);
}

// Initialize DB with simple retries so the API doesn't crash if Postgres isn't ready yet
{
  let attempts = 0;
  const maxAttempts = Number(process.env.DB_INIT_MAX_ATTEMPTS || 60); // ~2 minutes at 2s each
  const delayMs = Number(process.env.DB_INIT_RETRY_MS || 2000);
  while (true) {
    try {
      await initDb();
      break;
    } catch (e) {
      attempts++;
      console.error(`[api] initDb failed (attempt ${attempts}/${maxAttempts}): ${e?.message || e}`);
      if (attempts >= maxAttempts) {
        console.error('[api] FATAL: DB not reachable; giving up');
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// Allowed origins provided by config

const server = http.createServer(async (req, res) => {
  try {
  // CORS (restrict when ALLOWED_ORIGINS is set; otherwise reflect in dev)
  const reqOrigin = req.headers['origin'] || '';
  const allowAny = ALLOWED_ORIGINS.length === 0;
  const originAllowed = allowAny || (reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin));
  res.setHeader('Access-Control-Allow-Origin', originAllowed ? (reqOrigin || '*') : 'null');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (!originAllowed && reqOrigin) {
    return json(res, 403, { message: 'CORS origin not allowed' });
  }

  if (!req.url) return json(res, 404, { message: 'Not found' });
  if (!req.url.startsWith('/api/')) return json(res, 404, { message: 'Not found' });

  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}

  // Phase 2 modular routes: auth and users
  if (req.url.startsWith('/api/auth/')) {
    const handled = await handleAuth(req, res, body, { io });
    if (handled) return;
  }
  if (req.url.startsWith('/api/users/')) {
    const handled = await handleUsers(req, res, body, { io });
    if (handled) return;
  }
  if (req.url.startsWith('/api/friends') || req.url.startsWith('/api/dms/')) {
    const handled = await handleFriends(req, res, body, { io });
    if (handled) return;
  }
  if (req.url.startsWith('/api/spaces') || req.url.startsWith('/api/invites/')) {
    const handled = await handleSpaces(req, res, body, { io });
    if (handled) return;
  }
  if (req.url.startsWith('/api/channels')) {
    const handled = await handleChannels(req, res, body, { io });
    if (handled) return;
  }
  if (req.url.startsWith('/api/files')) {
    const handled = await handleFiles(req, res, body, { io });
    if (handled) return;
  }
  if (req.url.startsWith('/api/kanban')) {
    const handled = await handleKanban(req, res, body, { io });
    if (handled) return;
  }
  if (req.url.startsWith('/api/forms')) {
    const handled = await handleForms(req, res, body, { io });
    if (handled) return;
  }
  if (req.url.startsWith('/api/habits')) {
    const handled = await handleHabits(req, res, body, { io });
    if (handled) return;
  }
  if (req.url.startsWith('/api/push')) {
    const handled = await handlePush(req, res, body, { io });
    if (handled) return;
  }

  // Health endpoint for readiness/liveness checks
  if (req.method === 'GET' && req.url === '/api/health') {
    return json(res, 200, { status: 'ok' });
  }

  if (req.method === 'POST' && req.url === '/api/auth/signup') {
    const requireVerify = String(process.env.SIGNUP_REQUIRE_VERIFY || 'false') === 'true';
    const { username, email, password } = body || {};
    const uname = String(username || '').trim();
    const mailIn = (typeof email === 'string') ? String(email).trim().toLowerCase() : '';
    const mail = mailIn === '' ? null : mailIn; // store NULL when email not provided
    const pass = String(password || '');
    if (!uname || !pass || (requireVerify && !mail)) return json(res, 400, { message: requireVerify ? 'username, email and password required' : 'username and password required' });
    if (pass.length < 8) return json(res, 400, { message: 'password too short' });
    if (requireVerify && mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(mail))) return json(res, 400, { message: 'invalid email' });
    const id = randomUUID();
    const ph = await hashPassword(pass);
    try {
      await pool.query('INSERT INTO users(id, username, password_hash, name, email) VALUES ($1,$2,$3,$4,$5)', [id, uname.toLowerCase(), ph, uname, mail]);
    } catch (e) {
      let msg = 'Signup failed';
      if (e && e.code === '23505') {
        // unique_violation
        const constraint = e.constraint || '';
        if (/users_email/i.test(constraint)) msg = 'Email already in use';
        else if (/users_username/i.test(constraint)) msg = 'Username already taken';
        else msg = 'Username or email already taken';
      }
      else if (String(process.env.NODE_ENV || 'development') !== 'production') {
        msg = `Signup failed: ${e?.message || 'unknown error'}`;
      }
      return json(res, 400, { message: msg });
    }
    // If verification is disabled, issue session + token and return immediately
    if (!requireVerify) {
      const refresh = randomUUID();
      const rHash = sha256Hex(refresh);
      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      await pool.query('INSERT INTO sessions(id, user_id, refresh_token_hash, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), id, rHash, req.headers['user-agent'] || '', expiresAt.toISOString()]);
      setRefreshCookie(res, refresh, 30 * 24 * 3600);
      const access = signAccessToken({ id, name: uname });
      try {
        const sid = `welcome-${id.slice(0,8)}`;
        const logoUrl = '/brand/ECHO_logo.png';
        await pool.query('INSERT INTO spaces(id, name, avatar_url) VALUES ($1,$2,$3)', [sid, 'Welcome', logoUrl]);
        await pool.query('INSERT INTO channels(id, space_id, name) VALUES ($1,$2,$3)', [`${sid}:general`, sid, 'general']);
        await ensureMember(id, sid, 'owner');
        const m1 = randomUUID();
        const m2 = randomUUID();
        const intro = `Welcome to ECHO! 👋\n\nThis private space is just for you. Create a new space with the + button, or join other spaces using an invite code.`;
        const tips = `Quick tips:\n• Open Settings (gear) to customize your profile, notifications, and theme.\n• Invite others from Settings → Space → Invites.\n• Drag spaces/channels to reorder. Have fun!`;
        await pool.query('INSERT INTO messages(id, channel_id, author_id, content) VALUES ($1,$2,$3,$4)', [m1, `${sid}:general`, id, intro]);
        await pool.query('INSERT INTO messages(id, channel_id, author_id, content) VALUES ($1,$2,$3,$4)', [m2, `${sid}:general`, id, tips]);
      } catch {}
      return json(res, 200, { token: access, user: { id, username: uname.toLowerCase(), name: uname, avatarUrl: null } });
    }
    const code = randomUUID().replace(/-/g, '') + randomUUID().slice(0,8);
    const exp = new Date(Date.now() + 24*3600*1000);
    await pool.query('UPDATE users SET verify_code=$1, verify_expires=$2 WHERE id=$3', [code, exp.toISOString(), id]);
    try {
      const host = process.env.SMTP_HOST || '';
      const port = Number(process.env.SMTP_PORT || '0') || 0;
      const secure = String(process.env.SMTP_SECURE || 'false') === 'true';
      const user = process.env.SMTP_USER || '';
      const passw = process.env.SMTP_PASS || '';
      const from = process.env.FROM_EMAIL || 'no-reply@echo.local';
      const base = process.env.PUBLIC_WEB_URL || 'http://localhost:3000';
      const verifyUrl = `${base.replace(/\/$/,'')}/api/auth/verify?code=${encodeURIComponent(code)}`;
      let transporter;
      try { const nodemailer = (await import('nodemailer')).default; transporter = nodemailer.createTransport({ host, port, secure, auth: (user||passw) ? { user, pass: passw } : undefined }); } catch {}
      if (transporter) await transporter.sendMail({ from, to: mail, subject: 'Verify your Echo account', text: `Welcome to Echo! Click to verify: ${verifyUrl}`, html: `<p>Welcome to Echo!</p><p><a href="${verifyUrl}">Click here to verify your account</a></p>` });
    } catch {}
    return json(res, 202, { message: 'Verification email sent' });
  }

  if (req.method === 'POST' && req.url === '/api/auth/login') {
    const { username, password } = body || {};
    if (!username || !password) return json(res, 400, { message: 'username and password required' });
    const uname = String(username).trim().toLowerCase();
    const { rows } = await pool.query('SELECT id, username, password_hash, name, deactivated_at, email_verified_at FROM users WHERE username=$1', [uname]);
    const user = rows[0];
    if (!user || !(await verifyPassword(String(password), user.password_hash))) return json(res, 401, { message: 'Invalid credentials' });
    if (user.deactivated_at) return json(res, 403, { message: 'Account is deactivated' });
    const requireVerifyLogin = String(process.env.SIGNUP_REQUIRE_VERIFY || 'false') === 'true';
    if (requireVerifyLogin && !user.email_verified_at) return json(res, 403, { message: 'Email not verified' });
    const refresh = randomUUID();
    const rHash = sha256Hex(refresh);
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await pool.query('INSERT INTO sessions(id, user_id, refresh_token_hash, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), user.id, rHash, req.headers['user-agent'] || '', expiresAt.toISOString()]);
    setRefreshCookie(res, refresh, 30 * 24 * 3600);
    const access = signAccessToken({ id: user.id, name: user.name });
    // Do not auto-join a global space; users will create/join spaces via invites
    // include avatar in client bootstrap
    const { rows: u2 } = await pool.query('SELECT avatar_url FROM users WHERE id=$1', [user.id]);
    return json(res, 200, { token: access, user: { id: user.id, username: user.username, name: user.name, avatarUrl: u2[0]?.avatar_url || null } });
  }

  if (req.method === 'POST' && req.url === '/api/auth/refresh') {
    const cookies = parseCookies(req);
    const rt = cookies['rt'];
    if (!rt) return json(res, 401, { message: 'No refresh' });
    const rHash = sha256Hex(rt);
    const { rows } = await pool.query('SELECT s.user_id, u.name, u.deactivated_at, u.email_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.refresh_token_hash=$1 AND s.expires_at > now()', [rHash]);
    const row = rows[0];
    if (!row) return json(res, 401, { message: 'Invalid refresh' });
    if (row.deactivated_at) return json(res, 403, { message: 'Account is deactivated' });
    const requireVerifyRefresh = String(process.env.SIGNUP_REQUIRE_VERIFY || 'false') === 'true';
    if (requireVerifyRefresh && !row.email_verified_at) return json(res, 403, { message: 'Email not verified' });
    // rotate session
    await pool.query('DELETE FROM sessions WHERE refresh_token_hash=$1', [rHash]);
    const newRt = randomUUID();
    const newHash = sha256Hex(newRt);
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await pool.query('INSERT INTO sessions(id, user_id, refresh_token_hash, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), row.user_id, newHash, req.headers['user-agent'] || '', expiresAt.toISOString()]);
    setRefreshCookie(res, newRt, 30 * 24 * 3600);
    const access = signAccessToken({ id: row.user_id, name: row.name });
    return json(res, 200, { token: access });
  }

  if (req.method === 'POST' && req.url === '/api/auth/logout') {
    const cookies = parseCookies(req);
    const rt = cookies['rt'];
    if (rt) {
      await pool.query('DELETE FROM sessions WHERE refresh_token_hash=$1', [sha256Hex(rt)]);
    }
    setRefreshCookie(res, '', 0);
    res.statusCode = 204; return res.end();
  }

  if (req.method === 'POST' && req.url === '/api/auth/logout-all') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) {
      const cookies = parseCookies(req);
      const rt = cookies['rt'];
      if (rt) {
        const { rows } = await pool.query('SELECT user_id FROM sessions WHERE refresh_token_hash=$1', [sha256Hex(rt)]);
        userId = rows[0]?.user_id;
      }
    }
    if (userId) await pool.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
    setRefreshCookie(res, '', 0);
    res.statusCode = 204; return res.end();
  }

  // Verify email link
  if (req.method === 'GET' && req.url.startsWith('/api/auth/verify')) {
    try {
      const u = new URL('http://x' + req.url);
      const code = String(u.searchParams.get('code') || '').trim();
      if (!code) { res.statusCode = 400; return res.end('Missing code'); }
      const got = await pool.query('SELECT id, verify_expires FROM users WHERE verify_code=$1', [code]);
      const row = got.rows[0];
      if (!row) { res.statusCode = 400; return res.end('Invalid code'); }
      if (row.verify_expires && new Date(row.verify_expires).getTime() < Date.now()) { res.statusCode = 400; return res.end('Code expired'); }
      await pool.query('UPDATE users SET email_verified_at=now(), verify_code=NULL, verify_expires=NULL WHERE id=$1', [row.id]);
      res.statusCode = 200; res.setHeader('Content-Type','text/html');
      return res.end('<html><body style="font-family:sans-serif;background:#0b2a2f;color:#e5f4ef"><div style="margin:3rem auto;max-width:560px;padding:2rem;border:1px solid #155e75;border-radius:12px;background:#0f172a"><h2 style="color:#34d399">Email verified</h2><p>You can close this tab and return to the app.</p></div></body></html>');
    } catch { res.statusCode = 500; return res.end('Server error'); }
  }

  // --- Spaces & Channels CRUD (minimal) ---
  // --- Profile endpoints ---
  if (req.method === 'GET' && req.url === '/api/users/me') {
    // auth by bearer
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { rows } = await pool.query('SELECT id, username, name, avatar_url as "avatarUrl", bio, COALESCE(status, \'\') as status, tone_url as "toneUrl", name_color as "nameColor", friend_ring_color as "friendRingColor", COALESCE(friend_ring_enabled, true) as "friendRingEnabled", COALESCE(pronouns, \'\') as pronouns, COALESCE(location, \'\') as location, COALESCE(website, \'\') as website, COALESCE(banner_url, \'\') as "bannerUrl" FROM users WHERE id=$1', [userId]);
    const u = rows[0];
    if (!u) return json(res, 404, { message: 'User not found' });
    return json(res, 200, u);
  }

  if (req.method === 'PATCH' && req.url === '/api/users/me') {
    // auth by bearer
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { name, bio, avatarUrl, status, toneUrl, nameColor, friendRingColor, friendRingEnabled, pronouns, location, website, bannerUrl } = body || {};
    const fields = [];
    const values = [];
    if (typeof name === 'string') { fields.push('name'); values.push(String(name).trim().slice(0, 80)); }
    if (typeof bio === 'string') { fields.push('bio'); values.push(String(bio).trim().slice(0, 1000)); }
    if (typeof avatarUrl === 'string' || avatarUrl === null) { fields.push('avatar_url'); values.push(avatarUrl ? String(avatarUrl).trim().slice(0, 2048) : null); }
    if (typeof status === 'string') { fields.push('status'); values.push(String(status).trim().slice(0, 20)); }
    if (typeof toneUrl === 'string' || toneUrl === null) { fields.push('tone_url'); values.push(toneUrl ? String(toneUrl).trim().slice(0, 2048) : null); }
    if (typeof nameColor === 'string' || nameColor === null) {
      let c = nameColor;
      if (typeof c === 'string') {
        c = String(c).trim().slice(0, 16);
        // very light validation: allow #RGB, #RRGGBB, or CSS color words (kept short)
        const hexOk = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c);
        if (!hexOk && !/^[a-zA-Z]{1,15}$/.test(c)) c = null;
      }
      fields.push('name_color'); values.push(c ?? null);
    }
    if (typeof friendRingColor === 'string' || friendRingColor === null) {
      let c = friendRingColor;
      if (typeof c === 'string') {
        c = String(c).trim().slice(0, 16);
        const hexOk = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c);
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
        if (w && !/^https?:\/\//i.test(w)) w = `https://${w}`; // prefix
        try { const u = new URL(w); if (!/^https?:$/i.test(u.protocol)) w = null; } catch { w = null; }
      }
      fields.push('website'); values.push(w ?? null);
    }
    if (fields.length === 0) return json(res, 400, { message: 'No updatable fields' });
    const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    await pool.query(`UPDATE users SET ${sets} WHERE id = $${fields.length + 1}`, [...values, userId]);
    const { rows } = await pool.query('SELECT id, username, name, avatar_url as "avatarUrl", bio, COALESCE(status, \'\') as status, tone_url as "toneUrl", name_color as "nameColor", friend_ring_color as "friendRingColor", COALESCE(friend_ring_enabled, true) as "friendRingEnabled", COALESCE(pronouns, \'\') as pronouns, COALESCE(location, \'\') as location, COALESCE(website, \'\') as website, COALESCE(banner_url, \'\') as "bannerUrl" FROM users WHERE id=$1', [userId]);
    // If status changed, broadcast to listeners so People lists refresh immediately
    if (typeof status === 'string') {
      try {
        const s = String(status).trim().slice(0, 20);
        const { rows: spaces } = await pool.query('SELECT space_id FROM space_members WHERE user_id=$1', [userId]);
        for (const r of spaces) {
          try { io.to(`space:${r.space_id}`).emit('user:status', { userId, status: s }); } catch {}
        }
        try { io.to('global').emit('user:status', { userId, status: s }); } catch {}
      } catch {}
    }
    return json(res, 200, rows[0]);
  }

  // Deactivate own account (auth required)
  if (req.method === 'POST' && req.url === '/api/users/deactivate') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    await pool.query('UPDATE users SET deactivated_at = now() WHERE id=$1', [userId]);
    await pool.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
    setRefreshCookie(res, '', 0);
    return json(res, 200, { ok: true });
  }

  // Members list for a space (for presence sidebar)
  if (req.method === 'GET' && req.url.startsWith('/api/spaces/members')) {
    // auth by bearer
    let viewer = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) {
      try { const p = jwt.verify(a.slice(7), JWT_SECRET); viewer = p.sub; } catch {}
    }
    if (!viewer) return json(res, 401, { message: 'Unauthorized' });
    let sid = '';
    try { const u = new URL('http://x' + req.url); sid = String(u.searchParams.get('spaceId') || '').trim(); } catch {}
    if (!sid) return json(res, 400, { message: 'spaceId required' });
    const ok = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, viewer]);
    if (ok.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    const { rows } = await pool.query(
      'SELECT u.id, u.username, u.name, u.avatar_url as "avatarUrl", COALESCE(u.status, \'\') as status, u.name_color as "nameColor", m.role as "role" FROM users u JOIN space_members m ON m.user_id=u.id WHERE m.space_id=$1 ORDER BY lower(u.name)',
      [sid]
    );
    return json(res, 200, { members: rows });
  }

  // Remove a member from a space (owner only, non-DM spaces)
  if (req.method === 'DELETE' && req.url === '/api/spaces/members') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) {
      try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const sid = String((body && body.spaceId) || '').trim();
    const targetId = String((body && body.userId) || '').trim();
    if (!sid || !targetId) return json(res, 400, { message: 'spaceId and userId required' });
    if (sid.startsWith('dm_')) return json(res, 400, { message: 'Cannot remove members from a DM' });
    // Only owners can remove; and cannot remove other owners
    const { rows: myRole } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (!myRole[0] || myRole[0].role !== 'owner') return json(res, 403, { message: 'Only owners can remove members' });
    const { rows: theirRole } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, targetId]);
    if (!theirRole[0]) return json(res, 404, { message: 'User is not a member' });
    if (theirRole[0].role === 'owner') return json(res, 403, { message: 'Cannot remove an owner' });
    await pool.query('DELETE FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, targetId]);
    // Emit updated members list to viewers in the space
    try { io.to(`space:${sid}`).emit('spaces:members:changed', { spaceId: sid, userId: targetId, action: 'removed' }); } catch {}
    // Update the target user's space list so the space disappears for them
    try { const spaces = await listSpaces(targetId); io.to(`user:${targetId}`).emit('void:list', { voids: spaces }); } catch {}
    return json(res, 200, { ok: true });
  }

  // Public user profile (auth required): lookup by userId or username
  if (req.method === 'GET' && req.url.startsWith('/api/users/profile')) {
    let viewer = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) {
      try { const p = jwt.verify(a.slice(7), JWT_SECRET); viewer = p.sub; } catch {}
    }
    if (!viewer) return json(res, 401, { message: 'Unauthorized' });
    let uid = '';
    let uname = '';
    try {
      const u = new URL('http://x' + req.url);
      uid = String(u.searchParams.get('userId') || '').trim();
      uname = String(u.searchParams.get('username') || '').trim().toLowerCase();
    } catch {}
    if (!uid && !uname) return json(res, 400, { message: 'userId or username required' });
    let row;
    if (uid) {
      const r = await pool.query('SELECT id, username, name, avatar_url as "avatarUrl", bio, COALESCE(status, \'\') as status, tone_url as "toneUrl", name_color as "nameColor", COALESCE(pronouns, \'\') as pronouns, COALESCE(location, \'\') as location, COALESCE(website, \'\') as website, COALESCE(banner_url, \'\') as "bannerUrl" FROM users WHERE id=$1', [uid]);
      row = r.rows[0];
    } else {
      const r = await pool.query('SELECT id, username, name, avatar_url as "avatarUrl", bio, COALESCE(status, \'\') as status, tone_url as "toneUrl", name_color as "nameColor", COALESCE(pronouns, \'\') as pronouns, COALESCE(location, \'\') as location, COALESCE(website, \'\') as website, COALESCE(banner_url, \'\') as "bannerUrl" FROM users WHERE lower(username)=$1', [uname]);
      row = r.rows[0];
    }
    if (!row) return json(res, 404, { message: 'User not found' });
    const targetId = row.id;
    // Friend flags
    let isFriend = false; let incomingId = null; let outgoingId = null;
    try {
      const [x, y] = sortPair(viewer, targetId);
      const fr = await pool.query('SELECT 1 FROM friendships WHERE user_id_a=$1 AND user_id_b=$2', [x, y]);
      isFriend = fr.rowCount > 0;
      if (!isFriend) {
        const inc = await pool.query('SELECT id FROM friend_requests WHERE from_user=$1 AND to_user=$2', [targetId, viewer]);
        if (inc.rowCount > 0) incomingId = inc.rows[0].id;
        const out = await pool.query('SELECT id FROM friend_requests WHERE from_user=$1 AND to_user=$2', [viewer, targetId]);
        if (out.rowCount > 0) outgoingId = out.rows[0].id;
      }
    } catch {}
    return json(res, 200, { ...row, isFriend, incomingRequestId: incomingId, outgoingRequestId: outgoingId });
  }

  // Change password for current user
  if (req.method === 'POST' && req.url === '/api/users/password') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { oldPassword, newPassword } = body || {};
    const oldPw = String(oldPassword || '');
    const newPw = String(newPassword || '');
    if (newPw.length < 8) return json(res, 400, { message: 'New password must be at least 8 characters' });
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [userId]);
    const user = rows[0];
    if (!user) return json(res, 404, { message: 'User not found' });
    if (!(await verifyPassword(oldPw, user.password_hash))) return json(res, 400, { message: 'Old password is incorrect' });
    const newHash = await hashPassword(newPw);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [newHash, userId]);
    // Invalidate all refresh sessions
    try { await pool.query('DELETE FROM sessions WHERE user_id=$1', [userId]); } catch {}
    setRefreshCookie(res, '', 0);
    return json(res, 200, { ok: true });
  }

  // --- Friends endpoints ---
  if (req.method === 'GET' && req.url === '/api/friends/list') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.name, u.avatar_url as "avatarUrl", COALESCE(u.status,'') as status, u.name_color as "nameColor"
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_id_a=$1 THEN f.user_id_b ELSE f.user_id_a END
       WHERE f.user_id_a=$1 OR f.user_id_b=$1
       ORDER BY lower(u.name)`,
      [userId]
    );
    return json(res, 200, { friends: rows });
  }

  if (req.method === 'GET' && req.url === '/api/friends/requests') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const incoming = await pool.query(
      `SELECT r.id, r.from_user as "fromUserId", u.username as "fromUsername", u.name as "fromName", u.avatar_url as "fromAvatarUrl", r.created_at as "createdAt", COALESCE(u.status,'') as "fromStatus"
       FROM friend_requests r
       JOIN users u ON u.id = r.from_user
       WHERE r.to_user=$1
       ORDER BY r.created_at DESC`,
      [userId]
    );
    const outgoing = await pool.query(
      `SELECT r.id, r.to_user as "toUserId", u.username as "toUsername", u.name as "toName", u.avatar_url as "toAvatarUrl", r.created_at as "createdAt", COALESCE(u.status,'') as "toStatus"
       FROM friend_requests r
       JOIN users u ON u.id = r.to_user
       WHERE r.from_user=$1
       ORDER BY r.created_at DESC`,
      [userId]
    );
    return json(res, 200, { incoming: incoming.rows, outgoing: outgoing.rows });
  }

  if (req.method === 'POST' && req.url === '/api/friends/request') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { toUsername, toUserId, message } = body || {};
    let targetId = String(toUserId || '').trim();
    if (!targetId) {
      const uname = String(toUsername || '').trim().toLowerCase();
      if (!uname) return json(res, 400, { message: 'toUsername or toUserId required' });
      const q = await pool.query('SELECT id FROM users WHERE username=$1', [uname]);
      if (q.rowCount === 0) return json(res, 404, { message: 'User not found' });
      targetId = q.rows[0].id;
    }
    if (targetId === userId) return json(res, 400, { message: 'Cannot friend yourself' });
    if (await friendshipExists(userId, targetId)) return json(res, 200, { ok: true, already: true });
    // If there is a pending opposite request, auto-accept
    const opp = await pool.query('SELECT id FROM friend_requests WHERE from_user=$1 AND to_user=$2', [targetId, userId]);
    if (opp.rowCount > 0) {
      const rid = opp.rows[0].id;
      await createFriendship(userId, targetId);
      try { await pool.query('DELETE FROM friend_requests WHERE id=$1', [rid]); } catch {}
      try { io.to(`user:${targetId}`).emit('friends:update', { type: 'accepted', userId }); } catch {}
      return json(res, 200, { ok: true, autoAccepted: true });
    }
    // Prevent duplicate outgoing
    const ex = await pool.query('SELECT 1 FROM friend_requests WHERE from_user=$1 AND to_user=$2', [userId, targetId]);
    if (ex.rowCount > 0) return json(res, 200, { ok: true, pending: true });
    await pool.query('INSERT INTO friend_requests(id, from_user, to_user, message) VALUES ($1,$2,$3,$4)', [randomUUID(), userId, targetId, message ? String(message).slice(0, 200) : null]);
    try { io.to(`user:${targetId}`).emit('friends:update', { type: 'request', fromUserId: userId }); } catch {}
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && req.url === '/api/friends/respond') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { requestId, action } = body || {};
    const rid = String(requestId || '').trim();
    const act = String(action || '').trim();
    if (!rid || !act) return json(res, 400, { message: 'requestId and action required' });
    const rq = await pool.query('SELECT id, from_user, to_user FROM friend_requests WHERE id=$1', [rid]);
    const r = rq.rows[0];
    if (!r || r.to_user !== userId) return json(res, 404, { message: 'Request not found' });
    if (act === 'accept') {
      await createFriendship(r.from_user, r.to_user);
      try { await pool.query('DELETE FROM friend_requests WHERE id=$1', [rid]); } catch {}
      try { io.to(`user:${r.from_user}`).emit('friends:update', { type: 'accepted', userId }); } catch {}
      return json(res, 200, { ok: true });
    } else if (act === 'decline') {
      try { await pool.query('DELETE FROM friend_requests WHERE id=$1', [rid]); } catch {}
      return json(res, 200, { ok: true });
    } else {
      return json(res, 400, { message: 'Invalid action' });
    }
  }

  if (req.method === 'DELETE' && req.url === '/api/friends') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { userId: otherId } = body || {};
    const targetId = String(otherId || '').trim();
    if (!targetId) return json(res, 400, { message: 'userId required' });
    const [x, y] = sortPair(userId, targetId);
    await pool.query('DELETE FROM friendships WHERE user_id_a=$1 AND user_id_b=$2', [x, y]);
    return json(res, 200, { ok: true });
  }

  // --- Direct Messages ---
  if (req.method === 'POST' && req.url === '/api/dms/start') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { userId: otherId, username } = body || {};
    let targetId = String(otherId || '').trim();
    if (!targetId) {
      const uname = String(username || '').trim().toLowerCase();
      if (!uname) return json(res, 400, { message: 'userId or username required' });
      const q = await pool.query('SELECT id FROM users WHERE username=$1', [uname]);
      if (q.rowCount === 0) return json(res, 404, { message: 'User not found' });
      targetId = q.rows[0].id;
    }
    if (targetId === userId) return json(res, 400, { message: 'Cannot DM yourself' });
    // Require friendship for now
    if (!(await friendshipExists(userId, targetId))) return json(res, 403, { message: 'Not friends' });
    // Compose stable space id per pair
    const [x, y] = sortPair(userId, targetId);
    const spaceId = `dm_${x}_${y}`;
    // Create space if needed with a friendly name
    try {
      const a1 = await pool.query('SELECT name FROM users WHERE id=$1', [x]);
      const b1 = await pool.query('SELECT name FROM users WHERE id=$1', [y]);
      const n1 = a1.rows[0]?.name || 'User';
      const n2 = b1.rows[0]?.name || 'User';
      const nm = `${n1} ↔ ${n2}`;
      await pool.query('INSERT INTO spaces(id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [spaceId, nm]);
    } catch {}
    // Ensure both users are members
    await ensureMember(x, spaceId, 'member');
    await ensureMember(y, spaceId, 'member');
    // Ensure chat channel exists
    const channelId = `${spaceId}:chat`;
    try {
      await pool.query('INSERT INTO channels(id, space_id, name, type) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [channelId, spaceId, 'chat', 'dm']);
    } catch {}
    try { io.to(`user:${x}`).emit('dm:created', { spaceId, channelId }); } catch {}
    try { io.to(`user:${y}`).emit('dm:created', { spaceId, channelId }); } catch {}
    return json(res, 200, { spaceId, channelId });
  }
  if (req.method === 'POST' && req.url === '/api/spaces') {
    const { name, id } = body || {};
    const nm = String(name || '').trim();
    if (!nm) return json(res, 400, { message: 'name required' });
    const sid = id ? slugify(id) : slugify(nm);
    try {
      await pool.query('INSERT INTO spaces(id, name) VALUES ($1,$2)', [sid, nm]);
    } catch (e) {
      return json(res, 400, { message: 'space id taken' });
    }
    // Auth required: creator becomes owner
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    await ensureMember(userId, sid, 'owner');
    // Create a default channel so the space is usable immediately
    try {
      await pool.query('INSERT INTO channels(id, space_id, name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [`${sid}:general`, sid, 'general']);
    } catch {}
    // Client will refresh its own space list after creation
    return json(res, 200, { id: sid, name: nm });
  }

  // Update a space (owner only): name, avatarUrl
  if (req.method === 'PATCH' && req.url === '/api/spaces') {
    // auth by bearer
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });

    const { spaceId, name, avatarUrl } = body || {};
    const sid = String(spaceId || '').trim();
    if (!sid) return json(res, 400, { message: 'spaceId required' });
    const isDm = sid.startsWith('dm_');
    if (isDm) {
      // For DM spaces, allow any member to update image and name
      const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
      if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
      const fields = [];
      const values = [];
      if (typeof avatarUrl === 'string' || avatarUrl === null) { fields.push('avatar_url'); values.push(avatarUrl); }
      if (typeof name === 'string') { fields.push('name'); values.push(String(name)); }
      if (fields.length === 0) return json(res, 400, { message: 'No changes' });
      const sets = fields.map((f, i) => `${f}=$${i+1}`).join(', ');
      await pool.query(`UPDATE spaces SET ${sets} WHERE id=$${fields.length+1}`, [...values, sid]);
      const { rows } = await pool.query('SELECT id, name, avatar_url as "avatarUrl" FROM spaces WHERE id=$1', [sid]);
      return json(res, 200, rows[0] || { id: sid, name, avatarUrl });
    } else {
      // Non-DM spaces remain owner-only
      const { rows: roles } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
      if (!roles[0] || roles[0].role !== 'owner') return json(res, 403, { message: 'Only owners can update a space' });

      const fields = [];
      const values = [];
      if (typeof name === 'string') { fields.push('name'); values.push(String(name)); }
      if (typeof avatarUrl === 'string' || avatarUrl === null) { fields.push('avatar_url'); values.push(avatarUrl); }
      if (fields.length === 0) return json(res, 400, { message: 'No changes' });

      const sets = fields.map((f, i) => `${f}=$${i+1}`).join(', ');
      await pool.query(`UPDATE spaces SET ${sets} WHERE id=$${fields.length+1}`, [...values, sid]);
      const { rows } = await pool.query('SELECT id, name, avatar_url as "avatarUrl" FROM spaces WHERE id=$1', [sid]);
      return json(res, 200, rows[0] || { id: sid, name, avatarUrl });
    }
  }

  // Delete a space (owner only)
  if (req.method === 'DELETE' && req.url === '/api/spaces') {
    // auth by bearer
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });

    const sid = String((body && body.spaceId) || '').trim();
    if (!sid) return json(res, 400, { message: 'spaceId required' });

    const { rows: roles } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (!roles[0] || roles[0].role !== 'owner') return json(res, 403, { message: 'Only owners can delete a space' });

    // Deleting the space cascades to channels, messages, attachments, invites, and memberships
    const { rowCount } = await pool.query('DELETE FROM spaces WHERE id=$1', [sid]);
    if (rowCount === 0) return json(res, 404, { message: 'Space not found' });
    try { io.to(`space:${sid}`).emit('space:deleted', { spaceId: sid }); } catch {}
    return json(res, 200, { ok: true });
  }

  // Leave a space (member can leave; owners must delete/transfer)
  if (req.method === 'POST' && req.url === '/api/spaces/leave') {
    // auth by bearer
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });

    const { spaceId } = body || {};
    const sid = String(spaceId || '').trim();
    if (!sid) return json(res, 400, { message: 'spaceId required' });

    const roleRes = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (roleRes.rowCount === 0) return json(res, 404, { message: 'Not a member' });
    if (roleRes.rows[0].role === 'owner') {
      return json(res, 403, { message: 'Owners cannot leave. Delete the space or transfer ownership.' });
    }
    await pool.query('DELETE FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && req.url === '/api/channels') {
    const { spaceId, name, id, type } = body || {};
    const sid = String(spaceId || '').trim();
    const nm = String(name || '').trim();
    if (!sid || !nm) return json(res, 400, { message: 'spaceId and name required' });
    if (sid.startsWith('dm_')) return json(res, 403, { message: 'Cannot create channels in a DM' });
    // auth: only members of the space can create channels
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Not a member of this space' });
    const { rows: srows } = await pool.query('SELECT 1 FROM spaces WHERE id=$1', [sid]);
    if (srows.length === 0) return json(res, 404, { message: 'space not found' });
    const base = id ? slugify(id) : slugify(nm);
    const allowed = new Set(['text','voice','announcement','kanban','form','habit']);
    let ctype = String(type || 'text').toLowerCase();
    if (!allowed.has(ctype)) ctype = 'text';
    const cid = `${sid}:${base}`;
    try {
      await pool.query('INSERT INTO channels(id, space_id, name, type) VALUES ($1,$2,$3,$4)', [cid, sid, nm, ctype]);
    } catch (e) {
      return json(res, 400, { message: 'channel id taken' });
    }
    // Broadcast channel list to users in that space only
    try { io.to(`space:${sid}`).emit('channel:list', { voidId: sid, channels: await listChannels(sid) }); } catch {}
    return json(res, 200, { id: cid, name: nm, spaceId: sid, type: ctype });
  }

  // --- Kanban REST endpoints ---
  if (req.method === 'GET' && req.url.startsWith('/api/kanban')) {
    // auth bearer
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) {
      try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    let channelId = '';
    try { const u = new URL('http://x' + req.url); channelId = String(u.searchParams.get('channelId') || '').trim(); } catch {}
    if (!channelId) return json(res, 400, { message: 'channelId required' });
    const found = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return json(res, 404, { message: 'channel not found' });
    if (String(found.rows[0].type) !== 'kanban') return json(res, 400, { message: 'not a kanban channel' });
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    return json(res, 200, { lists: await getKanbanState(channelId) });
  }

  // --- Channel preview (recent messages without switching) ---
  if (req.method === 'GET' && req.url.startsWith('/api/channels/preview')) {
    // auth bearer
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) {
      try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    let channelId = '';
    let limit = 5;
    try {
      const u = new URL('http://x' + req.url);
      channelId = String(u.searchParams.get('channelId') || '').trim();
      limit = Math.max(1, Math.min(20, Number(u.searchParams.get('limit') || '5')));
    } catch {}
    if (!channelId) return json(res, 400, { message: 'channelId required' });
    const found = await pool.query('SELECT space_id FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return json(res, 404, { message: 'channel not found' });
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    const messages = await getBacklog(channelId, userId, limit);
    return json(res, 200, { messages });
  }

  // --- Habit Tracker REST endpoints ---
  async function getHabitState(channelId, viewerId) {
    const defs = (await pool.query('SELECT id, name, pos FROM habit_defs WHERE channel_id=$1 ORDER BY pos ASC, created_at ASC', [channelId])).rows;
    // My trackers and recent entries (last 30 days)
    const { rows: myT } = await pool.query('SELECT t.id, t.habit_id, t.is_public FROM habit_trackers t WHERE t.habit_id = ANY($1::uuid[]) AND t.user_id=$2', [defs.map(d=>d.id), viewerId]);
    const trackerIds = myT.map(r=>r.id);
    const since = new Date(); since.setDate(since.getDate()-30);
    const { rows: entries } = trackerIds.length>0 ? await pool.query('SELECT tracker_id, day FROM habit_entries WHERE tracker_id = ANY($1::uuid[]) AND day >= $2 AND done=true', [trackerIds, since]) : { rows: [] };
    const my = {};
    for (const t of myT) my[t.habit_id] = { public: t.is_public, days: [] };
    for (const e of entries) {
      const t = myT.find(x=>x.id===e.tracker_id); if (!t) continue; my[t.habit_id].days.push(String(e.day));
    }
    // Leaderboard: last 7 days counts for public trackers
    const lbSince = new Date(); lbSince.setDate(lbSince.getDate()-7);
    const { rows: lb } = await pool.query(
      `SELECT u.id as "userId", COALESCE(u.name,u.username) as name, COUNT(e.id) as count
       FROM habit_entries e
       JOIN habit_trackers t ON t.id=e.tracker_id AND t.is_public=true
       JOIN habit_defs d ON d.id=t.habit_id AND d.channel_id=$1
       JOIN users u ON u.id=t.user_id
       WHERE e.done=true AND e.day >= $2
       GROUP BY u.id, COALESCE(u.name,u.username)
       ORDER BY count DESC, COALESCE(u.name,u.username) ASC
       LIMIT 10`, [channelId, lbSince]
    );
    return { defs, my, leaderboard: lb };
  }

  if (req.method === 'GET' && req.url.startsWith('/api/habits')) {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    let channelId = '';
    try { const u = new URL('http://x' + req.url); channelId = String(u.searchParams.get('channelId') || '').trim(); } catch {}
    if (!channelId) return json(res, 400, { message: 'channelId required' });
    const found = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return json(res, 404, { message: 'channel not found' });
    if (String(found.rows[0].type) !== 'habit') return json(res, 400, { message: 'not a habit channel' });
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    return json(res, 200, await getHabitState(channelId, userId));
  }

  if (req.method === 'POST' && req.url === '/api/habits/defs') {
    let userId = null; const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { channelId, name } = body || {}; const cid = String(channelId||'').trim(); const nm = String(name||'').trim();
    if (!cid || !nm) return json(res, 400, { message: 'channelId and name required' });
    const chk = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [cid]);
    if (chk.rowCount===0) return json(res, 404, { message: 'channel not found' });
    if (chk.rows[0].type !== 'habit') return json(res, 400, { message: 'not a habit channel' });
    const sid = chk.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount===0) return json(res, 403, { message: 'Forbidden' });
    const id = randomUUID();
    const { rows: mx } = await pool.query('SELECT COALESCE(MAX(pos), -1) as max FROM habit_defs WHERE channel_id=$1', [cid]);
    const pos = Number(mx[0]?.max||-1) + 1;
    await pool.query('INSERT INTO habit_defs(id, channel_id, name, pos) VALUES ($1,$2,$3,$4)', [id, cid, nm, pos]);
    try { io.to(cid).emit('habit:state', { channelId: cid, ...(await getHabitState(cid, userId)) }); } catch {}
    return json(res, 200, { id, name: nm, pos });
  }

  if (req.method === 'PATCH' && req.url === '/api/habits/defs') {
    let userId = null; const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { defId, name } = body || {}; const lid = String(defId||'').trim();
    if (!lid) return json(res, 400, { message: 'defId required' });
    const row = await pool.query('SELECT channel_id FROM habit_defs WHERE id=$1', [lid]);
    if (row.rowCount===0) return json(res, 404, { message: 'not found' });
    const cid = row.rows[0].channel_id;
    if (typeof name === 'string') await pool.query('UPDATE habit_defs SET name=$1 WHERE id=$2', [String(name), lid]);
    try { io.to(cid).emit('habit:state', { channelId: cid, ...(await getHabitState(cid, userId)) }); } catch {}
    return json(res, 200, { ok:true });
  }

  if (req.method === 'DELETE' && req.url === '/api/habits/defs') {
    let userId = null; const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { defId } = body || {}; const lid = String(defId||'').trim();
    if (!lid) return json(res, 400, { message: 'defId required' });
    const row = await pool.query('SELECT channel_id FROM habit_defs WHERE id=$1', [lid]);
    if (row.rowCount===0) return json(res, 404, { message: 'not found' });
    const cid = row.rows[0].channel_id;
    await pool.query('DELETE FROM habit_defs WHERE id=$1', [lid]);
    try { io.to(cid).emit('habit:state', { channelId: cid, ...(await getHabitState(cid, userId)) }); } catch {}
    return json(res, 200, { ok:true });
  }

  if (req.method === 'POST' && req.url === '/api/habits/opt') {
    let userId = null; const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { defId, isPublic } = body || {}; const lid = String(defId||'').trim();
    if (!lid) return json(res, 400, { message: 'defId required' });
    const row = await pool.query('SELECT channel_id FROM habit_defs WHERE id=$1', [lid]);
    if (row.rowCount===0) return json(res, 404, { message: 'not found' });
    const cid = row.rows[0].channel_id;
    const sid = (await pool.query('SELECT space_id FROM channels WHERE id=$1', [cid])).rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount===0) return json(res, 403, { message: 'Forbidden' });
    const tid = randomUUID();
    await pool.query('INSERT INTO habit_trackers(id, habit_id, user_id, is_public) VALUES ($1,$2,$3,$4) ON CONFLICT (habit_id, user_id) DO UPDATE SET is_public=EXCLUDED.is_public', [tid, lid, userId, isPublic!==false]);
    try { io.to(cid).emit('habit:state', { channelId: cid, ...(await getHabitState(cid, userId)) }); } catch {}
    return json(res, 200, { ok:true });
  }

  if (req.method === 'DELETE' && req.url === '/api/habits/opt') {
    let userId = null; const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { defId } = body || {}; const lid = String(defId||'').trim();
    if (!lid) return json(res, 400, { message: 'defId required' });
    const row = await pool.query('SELECT channel_id FROM habit_defs WHERE id=$1', [lid]);
    if (row.rowCount===0) return json(res, 404, { message: 'not found' });
    const cid = row.rows[0].channel_id;
    await pool.query('DELETE FROM habit_trackers WHERE habit_id=$1 AND user_id=$2', [lid, userId]);
    try { io.to(cid).emit('habit:state', { channelId: cid, ...(await getHabitState(cid, userId)) }); } catch {}
    return json(res, 200, { ok:true });
  }

  if (req.method === 'POST' && req.url === '/api/habits/entry') {
    let userId = null; const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { defId, day, done, isPublic } = body || {}; const lid = String(defId||'').trim();
    if (!lid) return json(res, 400, { message: 'defId required' });
    const row = await pool.query('SELECT channel_id FROM habit_defs WHERE id=$1', [lid]);
    if (row.rowCount===0) return json(res, 404, { message: 'not found' });
    const cid = row.rows[0].channel_id;
    // Ensure tracker exists
    const existing = await pool.query('SELECT id FROM habit_trackers WHERE habit_id=$1 AND user_id=$2', [lid, userId]);
    let trackerId;
    if (existing.rowCount===0) {
      trackerId = randomUUID();
      await pool.query('INSERT INTO habit_trackers(id, habit_id, user_id, is_public) VALUES ($1,$2,$3,$4)', [trackerId, lid, userId, isPublic!==false]);
    } else {
      trackerId = existing.rows[0].id;
      if (typeof isPublic === 'boolean') await pool.query('UPDATE habit_trackers SET is_public=$1 WHERE id=$2', [isPublic, trackerId]);
    }
    const d = new Date(day || new Date()); const iso = d.toISOString().slice(0,10);
    if (done===false) {
      await pool.query('DELETE FROM habit_entries WHERE tracker_id=$1 AND day=$2', [trackerId, iso]);
    } else {
      await pool.query('INSERT INTO habit_entries(id, tracker_id, day, done) VALUES ($1,$2,$3,true) ON CONFLICT (tracker_id, day) DO UPDATE SET done=EXCLUDED.done', [randomUUID(), trackerId, iso]);
    }
    try { io.to(cid).emit('habit:state', { channelId: cid, ...(await getHabitState(cid, userId)) }); } catch {}
    return json(res, 200, { ok:true });
  }

  // --- Form REST endpoints ---
  if (req.method === 'GET' && req.url.startsWith('/api/forms')) {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    let channelId = '';
    try { const u = new URL('http://x' + req.url); channelId = String(u.searchParams.get('channelId') || '').trim(); } catch {}
    if (!channelId) return json(res, 400, { message: 'channelId required' });
    const found = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return json(res, 404, { message: 'channel not found' });
    if (String(found.rows[0].type) !== 'form') return json(res, 400, { message: 'not a form channel' });
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    const qs = await getFormQuestions(channelId);
    const qids = qs.map(q => q.id);
    const answersByUser = {};
    if (qids.length > 0) {
      const ax = await pool.query('SELECT user_id, question_id, answer FROM form_answers WHERE question_id = ANY($1::uuid[])', [qids]);
      for (const r of ax.rows) {
        const uid = r.user_id;
        if (!answersByUser[uid]) answersByUser[uid] = {};
        answersByUser[uid][r.question_id] = r.answer || '';
      }
    }
    // Back-compat self answers field
    const selfAnswers = {};
    for (const qid of qids) {
      if (answersByUser[userId] && typeof answersByUser[userId][qid] === 'string') {
        selfAnswers[qid] = { answer: answersByUser[userId][qid] };
      }
    }
    return json(res, 200, { questions: qs, answersByUser, answers: selfAnswers });
  }

  if (req.method === 'POST' && req.url === '/api/forms/questions') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { channelId, prompt, kind } = body || {};
    const cid = String(channelId || '').trim(); const pr = String(prompt || '').trim();
    const kd = (String(kind || 'text').trim().toLowerCase());
    if (!cid || !pr) return json(res, 400, { message: 'channelId and prompt required' });
    const found = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [cid]);
    if (found.rowCount === 0) return json(res, 404, { message: 'channel not found' });
    if (String(found.rows[0].type) !== 'form') return json(res, 400, { message: 'not a form channel' });
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    const { rows: mx } = await pool.query('SELECT COALESCE(MAX(pos), -1) as max FROM form_questions WHERE channel_id=$1', [cid]);
    const pos = Number(mx[0].max) + 1;
    const id = randomUUID();
    await pool.query('INSERT INTO form_questions(id, channel_id, prompt, kind, pos) VALUES ($1,$2,$3,$4,$5)', [id, cid, pr, kd, pos]);
    try { io.to(cid).emit('form:state', { channelId: cid, questions: await getFormQuestions(cid) }); } catch {}
    return json(res, 200, { id, prompt: pr, kind: kd, pos });
  }

  if (req.method === 'PATCH' && req.url === '/api/forms/questions') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { questionId, prompt, kind } = body || {};
    const qid = String(questionId || '').trim();
    if (!qid) return json(res, 400, { message: 'questionId required' });
    const qrow = await pool.query('SELECT channel_id FROM form_questions WHERE id=$1', [qid]);
    if (qrow.rowCount === 0) return json(res, 404, { message: 'question not found' });
    const cid = qrow.rows[0].channel_id;
    const sidrow = await pool.query('SELECT space_id FROM channels WHERE id=$1', [cid]);
    const sid = sidrow.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    const fields = []; const values = [];
    if (typeof prompt === 'string') { fields.push('prompt'); values.push(String(prompt).trim().slice(0, 2000)); }
    if (typeof kind === 'string') { fields.push('kind'); values.push(String(kind).trim().slice(0, 40)); }
    if (fields.length === 0) return json(res, 400, { message: 'No changes' });
    const sets = fields.map((f,i)=>`${f}=$${i+1}`).join(', ');
    await pool.query(`UPDATE form_questions SET ${sets} WHERE id=$${fields.length+1}`, [...values, qid]);
    try { io.to(cid).emit('form:state', { channelId: cid, questions: await getFormQuestions(cid) }); } catch {}
    return json(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && req.url === '/api/forms/questions') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { questionId } = body || {};
    const qid = String(questionId || '').trim();
    if (!qid) return json(res, 400, { message: 'questionId required' });
    const qrow = await pool.query('SELECT channel_id FROM form_questions WHERE id=$1', [qid]);
    if (qrow.rowCount === 0) return json(res, 404, { message: 'question not found' });
    const cid = qrow.rows[0].channel_id;
    const sidrow = await pool.query('SELECT space_id FROM channels WHERE id=$1', [cid]);
    const sid = sidrow.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    await pool.query('DELETE FROM form_questions WHERE id=$1', [qid]);
    try { io.to(cid).emit('form:state', { channelId: cid, questions: await getFormQuestions(cid) }); } catch {}
    return json(res, 200, { ok: true });
  }

  if (req.method === 'PATCH' && req.url === '/api/forms/answers') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { questionId, answer } = body || {};
    const qid = String(questionId || '').trim();
    if (!qid) return json(res, 400, { message: 'questionId required' });
    // Ensure question exists under a form channel and membership holds
    const qrow = await pool.query('SELECT q.channel_id, c.space_id FROM form_questions q JOIN channels c ON c.id=q.channel_id WHERE q.id=$1', [qid]);
    if (qrow.rowCount === 0) return json(res, 404, { message: 'question not found' });
    const sid = qrow.rows[0].space_id; const cid = qrow.rows[0].channel_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    await pool.query(`
      INSERT INTO form_answers(question_id, user_id, answer, updated_at)
      VALUES ($1,$2,$3,now())
      ON CONFLICT (question_id,user_id) DO UPDATE SET answer=EXCLUDED.answer, updated_at=now()
    `, [qid, userId, typeof answer === 'string' ? String(answer) : null]);
    try { io.to(cid).emit('form:answer', { channelId: cid, questionId: qid, userId, answer: typeof answer === 'string' ? String(answer) : '' }); } catch {}
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && req.url === '/api/kanban/lists') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { channelId, name } = body || {};
    const cid = String(channelId || '').trim(); const nm = String(name || '').trim();
    if (!cid || !nm) return json(res, 400, { message: 'channelId and name required' });
    const found = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [cid]);
    if (found.rowCount === 0) return json(res, 404, { message: 'channel not found' });
    if (String(found.rows[0].type) !== 'kanban') return json(res, 400, { message: 'not a kanban channel' });
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    const { rows: mx } = await pool.query('SELECT COALESCE(MAX(pos), -1) as max FROM kanban_lists WHERE channel_id=$1', [cid]);
    const pos = Number(mx[0].max) + 1;
    const id = randomUUID();
    await pool.query('INSERT INTO kanban_lists(id, channel_id, name, pos) VALUES ($1,$2,$3,$4)', [id, cid, nm, pos]);
    try { io.to(cid).emit('kanban:state', { channelId: cid, lists: await getKanbanState(cid) }); } catch {}
    return json(res, 200, { id, name: nm, pos });
  }

  if (req.method === 'PATCH' && req.url === '/api/kanban/lists') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { listId, name } = body || {};
    const lid = String(listId || '').trim();
    if (!lid) return json(res, 400, { message: 'listId required' });
    const lst = await pool.query('SELECT l.channel_id, c.space_id FROM kanban_lists l JOIN channels c ON c.id=l.channel_id WHERE l.id=$1', [lid]);
    if (lst.rowCount === 0) return json(res, 404, { message: 'list not found' });
    const cid = lst.rows[0].channel_id; const sid = lst.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    const fields = []; const values = [];
    if (typeof name === 'string') { fields.push('name'); values.push(String(name).trim().slice(0, 200)); }
    if (fields.length === 0) return json(res, 400, { message: 'No changes' });
    const sets = fields.map((f,i)=>`${f}=$${i+1}`).join(', ');
    await pool.query(`UPDATE kanban_lists SET ${sets} WHERE id=$${fields.length+1}`, [...values, lid]);
    try { io.to(cid).emit('kanban:state', { channelId: cid, lists: await getKanbanState(cid) }); } catch {}
    return json(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && req.url === '/api/kanban/lists') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { listId } = body || {};
    const lid = String(listId || '').trim();
    if (!lid) return json(res, 400, { message: 'listId required' });
    const lst = await pool.query('SELECT l.channel_id, c.space_id FROM kanban_lists l JOIN channels c ON c.id=l.channel_id WHERE l.id=$1', [lid]);
    if (lst.rowCount === 0) return json(res, 404, { message: 'list not found' });
    const cid = lst.rows[0].channel_id; const sid = lst.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    await pool.query('DELETE FROM kanban_lists WHERE id=$1', [lid]);
    try { io.to(cid).emit('kanban:state', { channelId: cid, lists: await getKanbanState(cid) }); } catch {}
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && req.url === '/api/kanban/items') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { listId, content } = body || {};
    const lid = String(listId || '').trim(); const ct = String(content || '').trim();
    if (!lid || !ct) return json(res, 400, { message: 'listId and content required' });
    const lst = await pool.query('SELECT l.channel_id, c.space_id FROM kanban_lists l JOIN channels c ON c.id=l.channel_id WHERE l.id=$1', [lid]);
    if (lst.rowCount === 0) return json(res, 404, { message: 'list not found' });
    const cid = lst.rows[0].channel_id; const sid = lst.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    const { rows: mx } = await pool.query('SELECT COALESCE(MAX(pos), -1) as max FROM kanban_items WHERE list_id=$1', [lid]);
    const pos = Number(mx[0].max) + 1;
    const id = randomUUID();
    await pool.query('INSERT INTO kanban_items(id, list_id, content, pos, done, created_by) VALUES ($1,$2,$3,$4,false,$5)', [id, lid, ct, pos, userId]);
    try { io.to(cid).emit('kanban:state', { channelId: cid, lists: await getKanbanState(cid) }); } catch {}
    return json(res, 200, { id, listId: lid, content: ct, pos, done: false });
  }

  // Reorder/move items within or across lists of the same channel
  if (req.method === 'POST' && req.url === '/api/kanban/items/reorder') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { listId, itemIds } = body || {};
    const lid = String(listId || '').trim();
    const ids = Array.isArray(itemIds) ? itemIds.map((x)=>String(x)) : [];
    if (!lid || ids.length === 0) return json(res, 400, { message: 'listId and itemIds required' });
    // Validate list and membership
    const lst = await pool.query('SELECT l.id, c.id as channel_id, c.space_id FROM kanban_lists l JOIN channels c ON c.id=l.channel_id WHERE l.id=$1', [lid]);
    if (lst.rowCount === 0) return json(res, 404, { message: 'list not found' });
    const cid = lst.rows[0].channel_id; const sid = lst.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    // Ensure all items belong to same channel
    const chk = await pool.query('SELECT i.id FROM kanban_items i JOIN kanban_lists l ON l.id=i.list_id WHERE i.id = ANY($1::uuid[]) AND l.channel_id=$2', [ids, cid]);
    if (chk.rowCount !== ids.length) return json(res, 400, { message: 'items not in channel' });
    // Apply order and target list
    for (let i = 0; i < ids.length; i++) {
      await pool.query('UPDATE kanban_items SET list_id=$1, pos=$2 WHERE id=$3', [lid, i, ids[i]]);
    }
    try { io.to(cid).emit('kanban:state', { channelId: cid, lists: await getKanbanState(cid) }); } catch {}
    return json(res, 200, { ok: true });
  }

  // Reorder lists within a channel
  if (req.method === 'POST' && req.url === '/api/kanban/lists/reorder') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { channelId, listIds } = body || {};
    const cid = String(channelId || '').trim();
    const ids = Array.isArray(listIds) ? listIds.map((x)=>String(x)) : [];
    if (!cid || ids.length === 0) return json(res, 400, { message: 'channelId and listIds required' });
    const ch = await pool.query('SELECT space_id FROM channels WHERE id=$1', [cid]);
    if (ch.rowCount === 0) return json(res, 404, { message: 'channel not found' });
    const sid = ch.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    // Ensure lists belong to channel
    const chk = await pool.query('SELECT id FROM kanban_lists WHERE id = ANY($1::uuid[]) AND channel_id=$2', [ids, cid]);
    if (chk.rowCount !== ids.length) return json(res, 400, { message: 'lists not in channel' });
    for (let i = 0; i < ids.length; i++) {
      await pool.query('UPDATE kanban_lists SET pos=$1 WHERE id=$2', [i, ids[i]]);
    }
    try { io.to(cid).emit('kanban:state', { channelId: cid, lists: await getKanbanState(cid) }); } catch {}
    return json(res, 200, { ok: true });
  }

  if (req.method === 'PATCH' && req.url === '/api/kanban/items') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { itemId, content, done } = body || {};
    const iid = String(itemId || '').trim();
    if (!iid) return json(res, 400, { message: 'itemId required' });
    const it = await pool.query('SELECT i.list_id, l.channel_id, c.space_id FROM kanban_items i JOIN kanban_lists l ON l.id=i.list_id JOIN channels c ON c.id=l.channel_id WHERE i.id=$1', [iid]);
    if (it.rowCount === 0) return json(res, 404, { message: 'item not found' });
    const cid = it.rows[0].channel_id; const sid = it.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    const fields = []; const values = [];
    if (typeof content === 'string') { fields.push('content'); values.push(String(content).trim().slice(0, 2000)); }
    if (typeof done === 'boolean') { fields.push('done'); values.push(!!done); }
    if (fields.length === 0) return json(res, 400, { message: 'No changes' });
    const sets = fields.map((f,i)=>`${f}=$${i+1}`).join(', ');
    await pool.query(`UPDATE kanban_items SET ${sets} WHERE id=$${fields.length+1}`, [...values, iid]);
    try { io.to(cid).emit('kanban:state', { channelId: cid, lists: await getKanbanState(cid) }); } catch {}
    return json(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && req.url === '/api/kanban/items') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { itemId } = body || {};
    const iid = String(itemId || '').trim();
    if (!iid) return json(res, 400, { message: 'itemId required' });
    const it = await pool.query('SELECT i.list_id, l.channel_id, c.space_id FROM kanban_items i JOIN kanban_lists l ON l.id=i.list_id JOIN channels c ON c.id=l.channel_id WHERE i.id=$1', [iid]);
    if (it.rowCount === 0) return json(res, 404, { message: 'item not found' });
    const cid = it.rows[0].channel_id; const sid = it.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' });
    await pool.query('DELETE FROM kanban_items WHERE id=$1', [iid]);
    try { io.to(cid).emit('kanban:state', { channelId: cid, lists: await getKanbanState(cid) }); } catch {}
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && req.url === '/api/channels/delete') {
    const { spaceId, channelId } = body || {};
    const sid = String(spaceId || '').trim();
    const cid = String(channelId || '').trim();
    if (!sid || !cid) return json(res, 400, { message: 'spaceId and channelId required' });
    if (sid.startsWith('dm_')) return json(res, 403, { message: 'Cannot delete channels in a DM' });
    // auth: only owners can delete channels (adjust policy as needed)
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { rows: roles } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (!roles[0] || roles[0].role !== 'owner') return json(res, 403, { message: 'Only owners can delete channels' });
    // Ensure channel exists under space
    const { rows } = await pool.query('SELECT 1 FROM channels WHERE id=$1 AND space_id=$2', [cid, sid]);
    if (rows.length === 0) return json(res, 404, { message: 'channel not found' });
    // Delete channel (messages will cascade)
    await pool.query('DELETE FROM channels WHERE id=$1', [cid]);
    // Notify users currently in that channel
    try { io.to(cid).emit('channel:deleted', { voidId: sid, channelId: cid }); } catch {}
    // Broadcast updated channel list within the space
    try { io.to(`space:${sid}`).emit('channel:list', { voidId: sid, channels: await listChannels(sid) }); } catch {}
    return json(res, 200, { ok: true });
  }

  // Rename a channel (owner only). Only updates the display name, not the channel id.
  if (req.method === 'POST' && req.url === '/api/channels/rename') {
    const { spaceId, channelId, name } = body || {};
    const sid = String(spaceId || '').trim();
    const cid = String(channelId || '').trim();
    const nm = String(name || '').trim();
    if (!sid || !cid || !nm) return json(res, 400, { message: 'spaceId, channelId and name required' });
    if (sid.startsWith('dm_')) return json(res, 403, { message: 'Cannot rename channels in a DM' });
    // auth: owner only
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { rows: roles } = await pool.query('SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (!roles[0] || roles[0].role !== 'owner') return json(res, 403, { message: 'Only owners can rename channels' });
    // Ensure channel belongs to space
    const check = await pool.query('SELECT 1 FROM channels WHERE id=$1 AND space_id=$2', [cid, sid]);
    if (check.rowCount === 0) return json(res, 404, { message: 'channel not found' });
    await pool.query('UPDATE channels SET name=$1 WHERE id=$2', [nm, cid]);
    try { io.to(`space:${sid}`).emit('channel:list', { voidId: sid, channels: await listChannels(sid) }); } catch {}
    return json(res, 200, { id: cid, name: nm, spaceId: sid });
  }

  if (req.method === 'POST' && req.url === '/api/spaces/invite') {
    const { spaceId, maxUses = 1, expiresInHours, code: desiredCode } = body || {};
    const sid = String(spaceId || '').trim();
    if (!sid) return json(res, 400, { message: 'spaceId required' });
    // auth
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    // must be a member to invite
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Not a member' });
    // Allow user-specified codes; validate and ensure uniqueness
    let code = String(desiredCode || '').trim();
    if (code) {
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) {
        return json(res, 400, { message: 'Invalid code. Use 4-64 letters, numbers, _ or -' });
      }
    } else {
      code = randomUUID().replace(/-/g, '').slice(0, 10);
    }
    const expires_at = expiresInHours ? new Date(Date.now() + Number(expiresInHours) * 3600 * 1000).toISOString() : null;
    try {
      await pool.query('INSERT INTO invites(code, space_id, inviter_id, max_uses, expires_at) VALUES ($1,$2,$3,$4,$5)', [code, sid, userId, Number(maxUses) || 1, expires_at]);
    } catch (e) {
      if (e && e.code === '23505') {
        return json(res, 400, { message: 'Invite code already in use' });
      }
      return json(res, 400, { message: 'Failed to create invite' });
    }
    return json(res, 200, { code, spaceId: sid });
  }

  if (req.method === 'POST' && req.url === '/api/invites/accept') {
    const { code } = body || {};
    const c = String(code || '').trim();
    if (!c) return json(res, 400, { message: 'code required' });
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { rows } = await pool.query('SELECT space_id, max_uses, uses, expires_at FROM invites WHERE code=$1', [c]);
    const inv = rows[0];
    if (!inv) return json(res, 404, { message: 'Invalid code' });
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) return json(res, 400, { message: 'Invite expired' });
    if (inv.uses >= inv.max_uses) return json(res, 400, { message: 'Invite exhausted' });
    // add membership
    await ensureMember(userId, inv.space_id, 'member');
    await pool.query('UPDATE invites SET uses = uses + 1 WHERE code=$1', [c]);
    return json(res, 200, { spaceId: inv.space_id });
  }

  // --- Push device registration endpoints ---
  if (req.method === 'POST' && req.url === '/api/push/register') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { token, platform } = body || {};
    const dtok = String(token || '').trim();
    const plat = String(platform || 'android').slice(0, 16);
    if (!dtok) return json(res, 400, { message: 'token required' });
    try {
      await pool.query(
        'INSERT INTO push_devices(token, user_id, platform) VALUES ($1,$2,$3)\n         ON CONFLICT (token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform',
        [dtok, userId, plat]
      );
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, message: 'failed to register' });
    }
  }
  if (req.method === 'POST' && req.url === '/api/push/unregister') {
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { token } = body || {};
    const dtok = String(token || '').trim();
    if (!dtok) return json(res, 400, { message: 'token required' });
    try {
      await pool.query('DELETE FROM push_devices WHERE token=$1 AND user_id=$2', [dtok, userId]);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, message: 'failed to unregister' });
    }
  }

  // Presigned S3 upload
  if (req.method === 'POST' && req.url === '/api/files/sign') {
    if (!S3Client || !getSignedUrl) return json(res, 501, { message: 'S3 not configured' });
    // auth
    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {}
    }
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const { filename, contentType, size } = body || {};
    const name = String(filename || 'file').slice(0, 180);
    const ctype = String(contentType || 'application/octet-stream');
    const sizeBytes = Number(size || 0);
    const MAX = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
    if (sizeBytes > MAX) return json(res, 400, { message: `File too large (max ${MAX} bytes)` });
    const BUCKET = process.env.STORAGE_S3_BUCKET || 'echo-app';
    const ENDPOINT = process.env.STORAGE_S3_ENDPOINT || 'http://localhost:9000';
    const REGION = process.env.STORAGE_S3_REGION || 'us-east-1';
    const ACCESS_KEY = process.env.STORAGE_S3_ACCESS_KEY || process.env.MINIO_ROOT_USER || '';
    const SECRET_KEY = process.env.STORAGE_S3_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
    const FORCE_PATH = String(process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true') === 'true';
    const PUBLIC_BASE = process.env.STORAGE_PUBLIC_BASE || `${ENDPOINT.replace(/\/$/, '')}/${BUCKET}`;
    const s3 = new S3Client({
      region: REGION,
      endpoint: ENDPOINT,
      forcePathStyle: FORCE_PATH,
      credentials: ACCESS_KEY && SECRET_KEY ? { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY } : undefined,
    });
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    const safe = slugify(name);
    const key = `uploads/${userId}/${Date.now()}-${randomUUID().slice(0,8)}-${safe}${ext ? '.'+ext : ''}`;
    const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: ctype, ACL: undefined });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 });
    const publicUrl = `${PUBLIC_BASE.replace(/\/$/, '')}/${key}`;
    let uploadUrl = url;
    // Gate rewriting to /files behind an env flag (default true for compatibility)
    const USE_FILES_PROXY = String(process.env.STORAGE_USE_FILES_PROXY || 'true') === 'true';
    if (USE_FILES_PROXY) {
      try {
        const u = new URL(url);
        uploadUrl = `/files${u.pathname}${u.search}`;
      } catch {}
    }
    return json(res, 200, { url: uploadUrl, method: 'PUT', headers: { 'Content-Type': ctype }, key, publicUrl });
  }

  json(res, 404, { message: 'Not found' });
  } catch (err) {
    try {
      console.error('[api] Unhandled error', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: 'Internal error' }));
    } catch {}
  }
});

// Socket.IO without dependency: we will import socket.io from node_modules if present
import { Server as IOServer } from 'socket.io';
// Optional S3 (MinIO) client for presigned uploads
let S3Client, PutObjectCommand;
try {
  const s3mod = await import('@aws-sdk/client-s3');
  S3Client = s3mod.S3Client;
  PutObjectCommand = s3mod.PutObjectCommand;
} catch {}
let getSignedUrl;
try {
  const presign = await import('@aws-sdk/s3-request-presigner');
  getSignedUrl = presign.getSignedUrl;
} catch {}

// Optional Firebase Admin for FCM push; initialize only when credentials provided
let adminMessaging = null;
try {
  const fb = await import('firebase-admin');
  const svcJson = process.env.FCM_SERVICE_ACCOUNT_JSON || '';
  if (svcJson) {
    const creds = JSON.parse(svcJson);
    if (!fb.getApps || fb.getApps().length === 0) {
      fb.initializeApp({ credential: fb.credential.cert(creds) });
    }
    adminMessaging = fb.messaging();
    console.log('[api] FCM initialized');
  }
} catch {}

async function sendPushToUsers(userIds, payload) {
  if (!adminMessaging) return;
  try {
    const ids = Array.from(new Set((userIds || []).map(String))).filter(Boolean);
    if (ids.length === 0) return;
    const { rows } = await pool.query('SELECT token FROM push_devices WHERE user_id = ANY($1)', [ids]);
    const tokens = rows.map(r => r.token).filter(Boolean);
    if (tokens.length === 0) return;
    const message = {
      tokens,
      notification: payload.notification || undefined,
      data: payload.data || undefined,
      android: { priority: 'high' },
    };
    await adminMessaging.sendEachForMulticast(message);
  } catch (e) {
    console.warn('sendPush failed', e?.message || e);
  }
}
const io = new IOServer(server, {
  path: '/socket.io',
  cors: {
    origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  perMessageDeflate: true,
  pingInterval: Number(process.env.SIO_PING_INTERVAL_MS || 25000),
  pingTimeout: Number(process.env.SIO_PING_TIMEOUT_MS || 60000),
});

// Helper queries moved to services/chat.js

async function ensureMember(userId, spaceId, role = 'member') {
  await pool.query('INSERT INTO space_members(space_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [spaceId, userId, role]);
}

// presence state (can track both channels and spaces by room name)
const roomPresence = new Map(); // room -> Set<userId>
const typingState = new Map(); // room -> Map<userId, boolean>

function presenceJoin(room, userId) {
  if (!roomPresence.has(room)) roomPresence.set(room, new Set());
  roomPresence.get(room).add(userId);
}
function presenceLeave(room, userId) {
  if (!roomPresence.has(room)) return;
  roomPresence.get(room).delete(userId);
}
function emitPresence(room) {
  const userIds = Array.from(roomPresence.get(room) || []);
  io.to(room).emit('presence:room', { room, userIds });
}
function emitSpacePresence(room, spaceId) {
  const userIds = Array.from(roomPresence.get(room) || []);
  io.to(room).emit('presence:space', { spaceId, userIds });
}
function emitGlobalPresence() {
  const room = 'global';
  const userIds = Array.from(roomPresence.get(room) || []);
  io.to(room).emit('presence:global', { userIds });
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Missing token'));
  try {
    const payload = jwt.verify(String(token), JWT_SECRET);
    socket.data.userId = payload.sub;
    const { rows } = await pool.query('SELECT name FROM users WHERE id=$1', [socket.data.userId]);
    socket.data.name = rows[0]?.name || '';
    return next();
  } catch (e) {
    return next(new Error('Invalid token'));
  }
});

io.on('connection', async (socket) => {
  const userId = socket.data.userId;
  const { rows } = await pool.query('SELECT name, avatar_url, name_color FROM users WHERE id=$1', [userId]);
  const displayName = rows[0]?.name || '';
  const avatarUrl = rows[0]?.avatar_url || null;
  const nameColor = rows[0]?.name_color || null;
  socket.data.name = displayName;
  socket.data.nameColor = nameColor;
  socket.emit('auth:accepted', { userId, name: displayName, avatarUrl });
  // Join personal notification room
  try { socket.join(`user:${userId}`); } catch {}

  // current selection (no default space: choose first if available)
  let curVoid = '';
  let curChan = '';
  const room = () => curChan;
  const spaceRoom = () => `space:${curVoid}`;

  // initial lists
  const spaces = await listSpaces(userId);
  socket.emit('void:list', { voids: spaces });
  if (spaces[0]) {
    curVoid = spaces[0].id;
    socket.emit('channel:list', { voidId: curVoid, channels: await listChannels(curVoid) });
    socket.join(spaceRoom());
    // Track space-level presence so users appear online across channels
    presenceJoin(spaceRoom(), userId);
    emitSpacePresence(spaceRoom(), curVoid);
  }
  // Global presence (any logged-in session across all spaces)
  try { socket.join('global'); } catch {}
  presenceJoin('global', userId);
  emitGlobalPresence();

  socket.on('void:list', async () => {
    socket.emit('void:list', { voids: await listSpaces(userId) });
  });

  socket.on('void:switch', async ({ voidId }) => {
    if (!voidId) return;
    const { rows } = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [voidId, userId]);
    if (rows.length === 0) return;
    if (room()) { presenceLeave(room(), userId); socket.leave(room()); }
    // Leave previous space room + presence
    if (curVoid) { presenceLeave(spaceRoom(), userId); socket.leave(spaceRoom()); }
    curVoid = voidId;
    curChan = '';
    socket.join(spaceRoom());
    presenceJoin(spaceRoom(), userId);
    emitSpacePresence(spaceRoom(), curVoid);
    socket.emit('channel:list', { voidId, channels: await listChannels(voidId) });
  });

  socket.on('channel:list', async ({ voidId }) => {
    if (!voidId) return;
    const { rows } = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [voidId, userId]);
    if (rows.length === 0) return;
    socket.emit('channel:list', { voidId, channels: await listChannels(voidId) });
  });

  socket.on('channel:switch', async ({ voidId, channelId }) => {
    if (!channelId) return;
    // Derive authoritative space from channel, ignore mismatched voidId
    const found = await pool.query('SELECT space_id FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return;
    const sid = found.rows[0].space_id;
    // Ensure user is a member of that space
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return;
    if (room()) { presenceLeave(room(), userId); socket.leave(room()); }
    curVoid = sid;
    curChan = channelId; // fully-qualified (e.g., "home:general") or legacy id
    socket.join(room());
    presenceJoin(room(), userId);
    emitPresence(room());
    socket.emit('channel:backlog', { voidId: sid, channelId, messages: await getBacklog(channelId, userId) });
  });

  // --- Voice rooms (WebRTC signaling) ---
  let curVoiceRid = '';
  socket.on('voice:join', async ({ channelId }) => {
    try {
      const rid = String(channelId || '');
      if (!rid) return;
      const found = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [rid]);
      if (found.rowCount === 0) return;
      const sid = found.rows[0].space_id;
      const ctype = String(found.rows[0].type || 'text');
      if (ctype !== 'voice') return; // only voice channels allowed
      const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
      if (mem.rowCount === 0) return;
      const room = `voice:${rid}`;
      curVoiceRid = room;
      socket.join(room);
      // list existing peers in room (exclude self)
      const set = (socket.adapter.rooms.get(room) || new Set());
      const peerIds = Array.from(set).filter(id => id !== socket.id);
      const peers = peerIds.map(id => {
        const s = io.sockets.sockets.get(id);
        return { peerId: id, userId: s?.data?.userId || null, name: s?.data?.name || '' };
      });
      socket.emit('voice:peers', { peers });
      socket.to(room).emit('voice:peer-joined', { peerId: socket.id, userId, name: socket.data.name || '' });
    } catch {}
  });

  socket.on('voice:leave', () => {
    try {
      const room = curVoiceRid;
      if (room) {
        socket.leave(room);
        socket.to(room).emit('voice:peer-left', { peerId: socket.id });
      }
      curVoiceRid = '';
    } catch {}
  });

  socket.on('voice:signal', ({ targetId, payload }) => {
    try {
      if (!targetId || !payload) return;
      const to = io.sockets.sockets.get(String(targetId));
      if (!to) return;
      to.emit('voice:signal', { from: socket.id, payload });
    } catch {}
  });

  socket.on('disconnect', () => {
    try {
      if (curVoiceRid) {
        socket.to(curVoiceRid).emit('voice:peer-left', { peerId: socket.id });
      }
    } catch {}
  });

  socket.on('message:send', async ({ voidId, channelId, content, tempId, attachments }) => {
    if (!channelId) return;
    const rid = channelId; // fully-qualified room id
    // Ensure channel exists and user is a member of its space
    const found = await pool.query('SELECT space_id FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return;
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return;
    const id = randomUUID();
    const text = String(content || '');
    if (!text && (!attachments || attachments.length === 0)) return;
    await pool.query('INSERT INTO messages(id, channel_id, author_id, content) VALUES ($1,$2,$3,$4)', [id, channelId, userId, text]);
    if (Array.isArray(attachments)) {
      for (const a of attachments) {
        const url = String(a?.url || '');
        if (!url) continue;
        const name = String(a?.name || 'file').slice(0, 255);
        const rawType = String(a?.contentType || '').trim().toLowerCase();
        let ctype = rawType;
        if (!ctype || ctype === 'application/octet-stream') {
          ctype = guessImageContentType(name) || guessImageContentType(url) || 'application/octet-stream';
        }
        const size = Number(a?.size || 0) || null;
        await pool.query('INSERT INTO message_attachments(id, message_id, url, content_type, name, size_bytes) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, url, ctype, name, size]);
      }
    }
    const attsRows = await pool.query('SELECT url, content_type as "contentType", name, size_bytes as size FROM message_attachments WHERE message_id=$1', [id]);
    const message = { id, content: text, createdAt: new Date().toISOString(), authorId: userId, authorName: socket.data.name, authorColor: socket.data.nameColor || null, reactions: {}, attachments: attsRows.rows };
    io.to(rid).emit('message:new', { voidId: sid, channelId, message, tempId });
    try {
      const notifyRows = await pool.query('SELECT user_id FROM space_members WHERE space_id=$1 AND user_id<>$2', [sid, userId]);
      const notifyIds = [];
      for (const r of notifyRows.rows) {
        io.to(`user:${r.user_id}`).emit('user:notify', { voidId: sid, channelId, authorId: userId, authorName: socket.data.name, content: text, messageId: id });
        notifyIds.push(r.user_id);
      }
      // Fire a best-effort push (mentions/DMs could be smarter later)
      sendPushToUsers(notifyIds, {
        notification: { title: `New message`, body: `${socket.data.name || 'Someone'}: ${String(text).slice(0, 80)}` },
        data: { voidId: String(sid), channelId: String(channelId), t: 'msg' },
      }).catch(() => {});
    } catch {}
  });

  // Mark messages as read up to a given message in a channel
  socket.on('read:up_to', async ({ channelId, lastMessageId }) => {
    const rid = String(channelId || '');
    const mid = String(lastMessageId || '');
    if (!rid || !mid) return;
    // Validate channel and membership
    const found = await pool.query('SELECT space_id FROM channels WHERE id=$1', [rid]);
    if (found.rowCount === 0) return;
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return;
    // Insert reads for all messages up to the cutoff
    await pool.query(`
      INSERT INTO message_reads(message_id, user_id)
      SELECT m.id, $2
      FROM messages m
      WHERE m.channel_id=$1 AND m.created_at <= (SELECT created_at FROM messages WHERE id=$3)
      ON CONFLICT DO NOTHING
    `, [rid, userId, mid]);
    // Broadcast a simple receipt on the cutoff message only (lightweight UI signal)
    io.to(rid).emit('message:seen', { channelId: rid, messageId: mid, userId, name: socket.data.name });
  });

  // Message edit (author only)
  socket.on('message:edit', async ({ messageId, content }) => {
    const { rows } = await pool.query('SELECT channel_id, author_id FROM messages WHERE id=$1', [String(messageId)]);
    const msg = rows[0];
    if (!msg) return;
    if (msg.author_id !== userId) return; // only author can edit
    // Ensure membership
    const mem = await pool.query('SELECT 1 FROM channels c JOIN space_members m ON m.space_id=c.space_id WHERE c.id=$1 AND m.user_id=$2', [msg.channel_id, userId]);
    if (mem.rowCount === 0) return;
    await pool.query('UPDATE messages SET content=$1, updated_at=now() WHERE id=$2', [String(content || ''), String(messageId)]);
    io.to(msg.channel_id).emit('message:edited', { channelId: msg.channel_id, messageId: String(messageId), content: String(content || ''), updatedAt: new Date().toISOString() });
  });

  // Message delete (author only)
  socket.on('message:delete', async ({ messageId }) => {
    const { rows } = await pool.query('SELECT channel_id, author_id FROM messages WHERE id=$1', [String(messageId)]);
    const msg = rows[0];
    if (!msg) return;
    if (msg.author_id !== userId) return;
    const mem = await pool.query('SELECT 1 FROM channels c JOIN space_members m ON m.space_id=c.space_id WHERE c.id=$1 AND m.user_id=$2', [msg.channel_id, userId]);
    if (mem.rowCount === 0) return;
    await pool.query('DELETE FROM messages WHERE id=$1', [String(messageId)]);
    io.to(msg.channel_id).emit('message:deleted', { channelId: msg.channel_id, messageId: String(messageId) });
  });

  // Reactions: add/remove
  socket.on('reaction:add', async ({ messageId, emoji }) => {
    const mid = String(messageId);
    const e = String(emoji || '').slice(0, 32);
    if (!e) return;
    const { rows } = await pool.query('SELECT channel_id FROM messages WHERE id=$1', [mid]);
    const msg = rows[0];
    if (!msg) return;
    // Ensure membership
    const mem = await pool.query('SELECT 1 FROM channels c JOIN space_members m ON m.space_id=c.space_id WHERE c.id=$1 AND m.user_id=$2', [msg.channel_id, userId]);
    if (mem.rowCount === 0) return;
    await pool.query('INSERT INTO message_reactions(message_id, user_id, reaction) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [mid, userId, e]);
    // Return fresh counts
    const { rows: counts } = await pool.query('SELECT reaction, COUNT(*)::int as count FROM message_reactions WHERE message_id=$1 GROUP BY reaction', [mid]);
    const reactions = {};
    for (const r of counts) reactions[r.reaction] = { count: Number(r.count) };
    io.to(msg.channel_id).emit('message:reactions', { channelId: msg.channel_id, messageId: mid, reactions });
  });

  socket.on('reaction:remove', async ({ messageId, emoji }) => {
    const mid = String(messageId);
    const e = String(emoji || '').slice(0, 32);
    if (!e) return;
    const { rows } = await pool.query('SELECT channel_id FROM messages WHERE id=$1', [mid]);
    const msg = rows[0];
    if (!msg) return;
    const mem = await pool.query('SELECT 1 FROM channels c JOIN space_members m ON m.space_id=c.space_id WHERE c.id=$1 AND m.user_id=$2', [msg.channel_id, userId]);
    if (mem.rowCount === 0) return;
    await pool.query('DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND reaction=$3', [mid, userId, e]);
    const { rows: counts } = await pool.query('SELECT reaction, COUNT(*)::int as count FROM message_reactions WHERE message_id=$1 GROUP BY reaction', [mid]);
    const reactions = {};
    for (const r of counts) reactions[r.reaction] = { count: Number(r.count) };
    io.to(msg.channel_id).emit('message:reactions', { channelId: msg.channel_id, messageId: mid, reactions });
  });

  socket.on('typing:set', async ({ voidId, channelId, isTyping }) => {
    const rid = channelId; // fully-qualified room id
    if (!rid) return;
    if (!typingState.has(rid)) typingState.set(rid, new Map());
    typingState.get(rid).set(userId, !!isTyping);
    // Broadcast to others in the room, exclude the sender
    // Derive voidId for payload consistency
    const found = await pool.query('SELECT space_id FROM channels WHERE id=$1', [channelId]);
    const sid = found.rows[0]?.space_id || voidId;
    if (isTyping) socket.to(rid).emit('typing:start', { voidId: sid, channelId, userId, name: socket.data.name });
    else socket.to(rid).emit('typing:stop', { voidId: sid, channelId, userId });
  });

  socket.on('disconnect', () => {
    presenceLeave(room(), userId);
    emitPresence(room());
    if (curVoid) { presenceLeave(spaceRoom(), userId); emitSpacePresence(spaceRoom(), curVoid); }
    presenceLeave('global', userId);
    emitGlobalPresence();
  });
});

// Port provided by config
server.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});

