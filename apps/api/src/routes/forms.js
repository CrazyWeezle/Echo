import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json } from '../utils.js';
import { getFormQuestions } from '../services/chat.js';

export async function handleForms(req, res, body) {
  if (req.method === 'GET' && req.url.startsWith('/api/forms')) {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    let channelId = '';
    try { const u = new URL('http://x' + req.url); channelId = String(u.searchParams.get('channelId') || '').trim(); } catch {}
    if (!channelId) return json(res, 400, { message: 'channelId required' }), true;
    const found = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [channelId]);
    if (found.rowCount === 0) return json(res, 404, { message: 'channel not found' }), true;
    if (String(found.rows[0].type) !== 'form') return json(res, 400, { message: 'not a form channel' }), true;
    const sid = found.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const questions = await getFormQuestions(channelId);
    const { rows: myAns } = await pool.query('SELECT question_id, answer FROM form_answers WHERE question_id = ANY($1::uuid[]) AND user_id=$2', [questions.map(q=>q.id), userId]);
    const answers = {}; for (const r of myAns) answers[r.question_id] = r.answer || '';
    return json(res, 200, { questions, answers }), true;
  }

  if (req.method === 'POST' && req.url === '/api/forms/questions') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { channelId, prompt, kind } = body || {};
    const cid = String(channelId || '').trim();
    const pr = String(prompt || '').trim();
    if (!cid || !pr) return json(res, 400, { message: 'channelId and prompt required' }), true;
    const ch = await pool.query('SELECT space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1', [cid]);
    if (ch.rowCount === 0) return json(res, 404, { message: 'channel not found' }), true;
    if (String(ch.rows[0].type) !== 'form') return json(res, 400, { message: 'not a form channel' }), true;
    const sid = ch.rows[0].space_id;
    const mem = await pool.query('SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2', [sid, userId]);
    if (mem.rowCount === 0) return json(res, 403, { message: 'Forbidden' }), true;
    const { rows: posr } = await pool.query('SELECT COALESCE(MAX(pos), 0) + 1 as pos FROM form_questions WHERE channel_id=$1', [cid]);
    const pos = Number(posr[0]?.pos || 0);
    await pool.query('INSERT INTO form_questions(id, channel_id, prompt, kind, pos) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), cid, pr, String(kind || 'text'), pos]);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'PATCH' && req.url === '/api/forms/questions') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { questionId, prompt, kind } = body || {};
    const qid = String(questionId || '').trim();
    if (!qid) return json(res, 400, { message: 'questionId required' }), true;
    if (typeof prompt === 'string') await pool.query('UPDATE form_questions SET prompt=$1 WHERE id=$2', [String(prompt), qid]);
    if (typeof kind === 'string') await pool.query('UPDATE form_questions SET kind=$1 WHERE id=$2', [String(kind), qid]);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'DELETE' && req.url === '/api/forms/questions') {
    const { questionId } = body || {};
    const qid = String(questionId || '').trim();
    if (!qid) return json(res, 400, { message: 'questionId required' }), true;
    await pool.query('DELETE FROM form_questions WHERE id=$1', [qid]);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'PATCH' && req.url === '/api/forms/answers') {
    let userId = null;
    const a = req.headers['authorization'] || '';
    if (a.startsWith('Bearer ')) { try { const p = jwt.verify(a.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const { questionId, answer } = body || {};
    const qid = String(questionId || '').trim();
    if (!qid) return json(res, 400, { message: 'questionId required' }), true;
    await pool.query('INSERT INTO form_answers(question_id, user_id, answer, updated_at) VALUES ($1,$2,$3, now()) ON CONFLICT (question_id, user_id) DO UPDATE SET answer=EXCLUDED.answer, updated_at=now()', [qid, userId, String(answer || '')]);
    return json(res, 200, { ok: true }), true;
  }

  return false;
}
