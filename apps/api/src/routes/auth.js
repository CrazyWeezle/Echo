import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json, parseCookies, setRefreshCookie, sha256Hex, hashPassword, verifyPassword, signAccessToken } from '../utils.js';

export async function handleAuth(req, res, body, ctx) {
  try {
    // Health is handled in main
    if (req.method === 'POST' && req.url === '/api/auth/signup') {
      const requireVerify = String(process.env.SIGNUP_REQUIRE_VERIFY || 'false') === 'true';
      const { username, email, password } = body || {};
      const uname = String(username || '').trim();
      const mailIn = (typeof email === 'string') ? String(email).trim().toLowerCase() : '';
      const mail = mailIn === '' ? null : mailIn;
      const pass = String(password || '');
      if (!uname || !pass || (requireVerify && !mail)) return json(res, 400, { message: requireVerify ? 'username, email and password required' : 'username and password required' }), true;
      if (pass.length < 8) return json(res, 400, { message: 'password too short' }), true;
      if (requireVerify && mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(mail))) return json(res, 400, { message: 'invalid email' }), true;
      const id = randomUUID();
      const ph = await hashPassword(pass);
      try {
        await pool.query('INSERT INTO users(id, username, password_hash, name, email) VALUES ($1,$2,$3,$4,$5)', [id, uname.toLowerCase(), ph, uname, mail]);
      } catch (e) {
        let msg = 'Signup failed';
        if (e && e.code === '23505') {
          const constraint = e.constraint || '';
          if (/users_email/i.test(constraint)) msg = 'Email already in use';
          else if (/users_username/i.test(constraint)) msg = 'Username already taken';
          else msg = 'Username or email already taken';
        }
        else if (String(process.env.NODE_ENV || 'development') !== 'production') {
          msg = `Signup failed: ${e?.message || 'unknown error'}`;
        }
        return json(res, 400, { message: msg }), true;
      }
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
          const intro = `Welcome to ECHO!\n\nThis private space is just for you. Create a new space with the + button, or join other spaces using an invite code.`;
          const tips = `Quick tips:\n• Open Settings (gear) to customize your profile, notifications, and theme.\n• Invite others from Settings → Space → Invites.\n• Drag spaces/channels to reorder. Have fun!`;
          await pool.query('INSERT INTO messages(id, channel_id, author_id, content) VALUES ($1,$2,$3,$4)', [m1, `${sid}:general`, id, intro]);
          await pool.query('INSERT INTO messages(id, channel_id, author_id, content) VALUES ($1,$2,$3,$4)', [m2, `${sid}:general`, id, tips]);
        } catch {}
        return json(res, 200, { token: access, user: { id, username: uname.toLowerCase(), name: uname, avatarUrl: null } }), true;
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
      return json(res, 202, { message: 'Verification email sent' }), true;
    }

    if (req.method === 'POST' && req.url === '/api/auth/login') {
      const { username, password } = body || {};
      if (!username || !password) return json(res, 400, { message: 'username and password required' }), true;
      const uname = String(username).trim().toLowerCase();
      const { rows } = await pool.query('SELECT id, username, password_hash, name, deactivated_at, email_verified_at FROM users WHERE username=$1', [uname]);
      const user = rows[0];
      if (!user || !(await verifyPassword(String(password), user.password_hash))) return json(res, 401, { message: 'Invalid credentials' }), true;
      if (user.deactivated_at) return json(res, 403, { message: 'Account is deactivated' }), true;
      const requireVerifyLogin = String(process.env.SIGNUP_REQUIRE_VERIFY || 'false') === 'true';
      if (requireVerifyLogin && !user.email_verified_at) return json(res, 403, { message: 'Email not verified' }), true;
      const refresh = randomUUID();
      const rHash = sha256Hex(refresh);
      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      await pool.query('INSERT INTO sessions(id, user_id, refresh_token_hash, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), user.id, rHash, req.headers['user-agent'] || '', expiresAt.toISOString()]);
      setRefreshCookie(res, refresh, 30 * 24 * 3600);
      const access = signAccessToken({ id: user.id, name: user.name });
      const { rows: u2 } = await pool.query('SELECT avatar_url FROM users WHERE id=$1', [user.id]);
      return json(res, 200, { token: access, user: { id: user.id, username: user.username, name: user.name, avatarUrl: u2[0]?.avatar_url || null } }), true;
    }

    if (req.method === 'POST' && req.url === '/api/auth/refresh') {
      const cookies = parseCookies(req);
      const rt = cookies['rt'];
      if (!rt) return json(res, 401, { message: 'No refresh' }), true;
      const rHash = sha256Hex(rt);
      const { rows } = await pool.query('SELECT s.user_id, u.name, u.deactivated_at, u.email_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.refresh_token_hash=$1 AND s.expires_at > now()', [rHash]);
      const row = rows[0];
      if (!row) return json(res, 401, { message: 'Invalid refresh' }), true;
      if (row.deactivated_at) return json(res, 403, { message: 'Account is deactivated' }), true;
      const requireVerifyRefresh = String(process.env.SIGNUP_REQUIRE_VERIFY || 'false') === 'true';
      if (requireVerifyRefresh && !row.email_verified_at) return json(res, 403, { message: 'Email not verified' }), true;
      await pool.query('DELETE FROM sessions WHERE refresh_token_hash=$1', [rHash]);
      const newRt = randomUUID();
      const newHash = sha256Hex(newRt);
      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      await pool.query('INSERT INTO sessions(id, user_id, refresh_token_hash, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), row.user_id, newHash, req.headers['user-agent'] || '', expiresAt.toISOString()]);
      setRefreshCookie(res, newRt, 30 * 24 * 3600);
      const access = signAccessToken({ id: row.user_id, name: row.name });
      return json(res, 200, { token: access }), true;
    }

    if (req.method === 'POST' && req.url === '/api/auth/logout') {
      const cookies = parseCookies(req);
      const rt = cookies['rt'];
      if (rt) {
        await pool.query('DELETE FROM sessions WHERE refresh_token_hash=$1', [sha256Hex(rt)]);
      }
      setRefreshCookie(res, '', 0);
      res.statusCode = 204; res.end();
      return true;
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
      res.statusCode = 204; res.end();
      return true;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/auth/verify')) {
      try {
        const u = new URL('http://x' + req.url);
        const code = String(u.searchParams.get('code') || '').trim();
        if (!code) { res.statusCode = 400; res.end('Missing code'); return true; }
        const got = await pool.query('SELECT id, verify_expires FROM users WHERE verify_code=$1', [code]);
        const row = got.rows[0];
        if (!row) { res.statusCode = 400; res.end('Invalid code'); return true; }
        if (row.verify_expires && new Date(row.verify_expires).getTime() < Date.now()) { res.statusCode = 400; res.end('Code expired'); return true; }
        await pool.query('UPDATE users SET email_verified_at=now(), verify_code=NULL, verify_expires=NULL WHERE id=$1', [row.id]);
        res.statusCode = 200; res.setHeader('Content-Type','text/html');
        res.end('<html><body style="font-family:sans-serif;background:#0b2a2f;color:#e5f4ef"><div style="margin:3rem auto;max-width:560px;padding:2rem;border:1px solid #155e75;border-radius:12px;background:#0f172a"><h2 style="color:#34d399">Email verified</h2><p>You can close this tab and return to the app.</p></div></body></html>');
        return true;
      } catch { res.statusCode = 500; res.end('Server error'); return true; }
    }

    return false;
  } catch (e) {
    try { json(res, 500, { message: 'Internal error' }); } catch {}
    return true;
  }
}

async function ensureMember(userId, spaceId, role) {
  try { await pool.query('INSERT INTO space_members(space_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [spaceId, userId, role || 'member']); } catch {}
}

