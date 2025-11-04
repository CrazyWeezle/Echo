import webpush from 'web-push';
import { pool } from '../db.js';

const VAPID_PUBLIC = process.env.PUSH_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.PUSH_VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.PUSH_VAPID_SUBJECT || 'mailto:admin@example.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); } catch {}
}

export async function handlePush(req, res, body, ctx) {
  if (req.method === 'POST' && req.url === '/api/push/subscribe') {
    const userId = ctx?.userId;
    if (!userId) { res.statusCode = 401; res.end('Unauthorized'); return true; }
    try {
      const sub = body?.subscription;
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
        res.statusCode = 400; res.end('Invalid subscription'); return true;
      }
      await pool.query(
        'INSERT INTO web_push_subscriptions(endpoint, user_id, p256dh, auth) VALUES ($1,$2,$3,$4)\n         ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth',
        [String(sub.endpoint), String(userId), String(sub.keys.p256dh), String(sub.keys.auth)]
      );
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true }));
      return true;
    } catch (e) { res.statusCode = 500; res.end('Failed'); return true; }
  }
  if (req.method === 'POST' && req.url === '/api/push/unsubscribe') {
    const userId = ctx?.userId;
    if (!userId) { res.statusCode = 401; res.end('Unauthorized'); return true; }
    try {
      const endpoint = body?.endpoint;
      if (!endpoint) { res.statusCode = 400; res.end('Missing endpoint'); return true; }
      await pool.query('DELETE FROM web_push_subscriptions WHERE endpoint=$1 AND user_id=$2', [String(endpoint), String(userId)]);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true }));
      return true;
    } catch { res.statusCode = 500; res.end('Failed'); return true; }
  }
  if (req.method === 'POST' && req.url === '/api/push/test') {
    const userId = ctx?.userId;
    if (!userId) { res.statusCode = 401; res.end('Unauthorized'); return true; }
    try {
      const title = (body && body.title) || 'ECHO Test';
      const bodyText = (body && body.body) || 'This is a test notification.';
      await sendWebPushToUsers([String(userId)], { title, body: bodyText, channelId: 'home:general' });
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true }));
      return true;
    } catch { res.statusCode = 500; res.end('Failed'); return true; }
  }
  return false;
}

export async function sendWebPushToUsers(userIds, payload) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return; // disabled
  if (!Array.isArray(userIds) || userIds.length === 0) return;
  try {
    const { rows } = await pool.query('SELECT endpoint, p256dh, auth FROM web_push_subscriptions WHERE user_id = ANY($1)', [userIds]);
    const subs = rows.map(r => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
    await Promise.all(subs.map(async (sub) => {
      try { await webpush.sendNotification(sub, JSON.stringify(payload)); } catch (e) { /* ignore */ }
    }));
  } catch {}
}
