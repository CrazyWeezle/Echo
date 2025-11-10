import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { json } from '../utils.js';
import { getFormQuestions } from '../services/chat.js';

function authUserId(req) {
  const a = req.headers['authorization'] || '';
  if (!a.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(a.slice(7), JWT_SECRET);
    return payload?.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

async function getChannelMeta(channelId) {
  const { rows } = await pool.query(
    'SELECT id, space_id, COALESCE(type,\'text\') as type FROM channels WHERE id=$1',
    [channelId]
  );
  return rows[0] || null;
}

function pickId(obj, ...keys) {
  if (!obj) return undefined;
  for (const key of keys) {
    if (obj[key] != null) return obj[key];
  }
  return undefined;
}

async function getQuestionMeta(questionId) {
  const { rows } = await pool.query(
    `SELECT fq.id, fq.channel_id, c.space_id, COALESCE(c.type,'text') as type
     FROM form_questions fq
     JOIN channels c ON c.id=fq.channel_id
     WHERE fq.id=$1`,
    [questionId]
  );
  return rows[0] || null;
}

async function isSpaceMember(spaceId, userId) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2',
    [spaceId, userId]
  );
  return rowCount > 0;
}

async function listParticipants(spaceId) {
  const { rows } = await pool.query('SELECT user_id FROM space_members WHERE space_id=$1 ORDER BY user_id', [spaceId]);
  return rows.map((r) => String(r.user_id));
}

async function getAnswersByUser(questionIds) {
  const map = {};
  if (!questionIds || questionIds.length === 0) return map;
  const { rows } = await pool.query(
    'SELECT question_id, user_id, answer FROM form_answers WHERE question_id = ANY($1::uuid[])',
    [questionIds]
  );
  for (const row of rows) {
    const uid = String(row.user_id);
    if (!map[uid]) map[uid] = {};
    map[uid][row.question_id] = String(row.answer || '');
  }
  return map;
}

function computeAllSubmitted(questionIds, answersByUser, participants) {
  const roster = (participants && participants.length > 0) ? participants : Object.keys(answersByUser || {});
  const result = {};
  for (const qid of questionIds) {
    if (roster.length === 0) {
      result[qid] = true;
      continue;
    }
    result[qid] = roster.every((uid) => {
      const ans = answersByUser?.[uid]?.[qid] ?? '';
      return String(ans || '').trim().length > 0;
    });
  }
  return result;
}

function wrapAnswersMap(myAnswers) {
  const wrapped = {};
  for (const [qid, value] of Object.entries(myAnswers)) {
    wrapped[qid] = { answer: value };
  }
  return wrapped;
}

async function emitFormState(io, channelId, spaceId) {
  if (!io) return;
  try {
    const snapshot = await buildFormSnapshot(channelId, spaceId);
    const payload = {
      channelId,
      questions: snapshot.questions,
      allSubmitted: snapshot.allSubmitted,
      participants: snapshot.participants,
    };
    io.to(channelId).emit('form:state', payload);
    io.to(`space:${spaceId}`).emit('form:state', payload);
  } catch (err) {
    console.error('[forms] emitFormState failed', err);
  }
}

function emitToFormAudience(io, channelId, spaceId, event, payload) {
  if (!io) return;
  try {
    io.to(channelId).emit(event, payload);
    io.to(`space:${spaceId}`).emit(event, payload);
  } catch {}
}

async function buildFormSnapshot(channelId, spaceId) {
  const questions = await getFormQuestions(channelId);
  const questionIds = questions.map((q) => q.id);
  const answersByUser = await getAnswersByUser(questionIds);
  const participants = await listParticipants(spaceId);
  const allSubmitted = computeAllSubmitted(questionIds, answersByUser, participants);
  return { questions, answersByUser, participants, allSubmitted };
}

export async function handleForms(req, res, body, ctx = {}) {
  const io = ctx?.io;

  if (req.method === 'GET' && req.url.startsWith('/api/forms')) {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    let channelId = '';
    try {
      const u = new URL('http://x' + req.url);
      channelId = String(u.searchParams.get('channelId') || '').trim();
    } catch {}
    if (!channelId) return json(res, 400, { message: 'channelId required' }), true;
    const channel = await getChannelMeta(channelId);
    if (!channel) return json(res, 404, { message: 'channel not found' }), true;
    if (String(channel.type) !== 'form') return json(res, 400, { message: 'not a form channel' }), true;
    const member = await isSpaceMember(channel.space_id, userId);
    if (!member) return json(res, 403, { message: 'Forbidden' }), true;
    const snapshot = await buildFormSnapshot(channel.id, channel.space_id);
    const myAnswers = snapshot.answersByUser[String(userId)] || {};
    return json(res, 200, {
      questions: snapshot.questions,
      answers: wrapAnswersMap(myAnswers),
      myAnswers,
      answersByUser: snapshot.answersByUser,
      allSubmitted: snapshot.allSubmitted,
      participants: snapshot.participants,
    }), true;
  }

  if (req.method === 'POST' && req.url === '/api/forms/questions') {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const rawChannelId = pickId(body || {}, 'channelId', 'channelID', 'channel_id');
    const { prompt, kind, locked } = body || {};
    const cid = String(rawChannelId || '').trim();
    const pr = String(prompt || '').trim();
    if (!cid || !pr) return json(res, 400, { message: 'channelId and prompt required' }), true;
    const channel = await getChannelMeta(cid);
    if (!channel) return json(res, 404, { message: 'channel not found' }), true;
    if (String(channel.type) !== 'form') return json(res, 400, { message: 'not a form channel' }), true;
    const member = await isSpaceMember(channel.space_id, userId);
    if (!member) return json(res, 403, { message: 'Forbidden' }), true;
    const { rows: posr } = await pool.query('SELECT COALESCE(MAX(pos), 0) + 1 as pos FROM form_questions WHERE channel_id=$1', [cid]);
    const pos = Number(posr[0]?.pos || 0);
    const qid = randomUUID();
    const question = {
      id: qid,
      channelId: cid,
      prompt: pr,
      kind: String(kind || 'text'),
      pos,
      locked: !!locked,
    };
    await pool.query(
      'INSERT INTO form_questions(id, channel_id, prompt, kind, pos, locked) VALUES ($1,$2,$3,$4,$5,$6)',
      [qid, cid, pr, question.kind, pos, question.locked]
    );
    emitToFormAudience(io, cid, channel.space_id, 'form:question:create', { channelId: cid, question });
    await emitFormState(io, cid, channel.space_id);
    return json(res, 200, { question }), true;
  }

  if (req.method === 'PATCH' && req.url === '/api/forms/questions') {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const rawQuestionId = pickId(body || {}, 'questionId', 'questionID', 'question_id');
    const { prompt, kind, pos, locked } = body || {};
    const qid = String(rawQuestionId || '').trim();
    if (!qid) return json(res, 400, { message: 'questionId required' }), true;
    const meta = await getQuestionMeta(qid);
    if (!meta) return json(res, 404, { message: 'question not found' }), true;
    if (String(meta.type) !== 'form') return json(res, 400, { message: 'not a form question' }), true;
    const member = await isSpaceMember(meta.space_id, userId);
    if (!member) return json(res, 403, { message: 'Forbidden' }), true;
    if (typeof prompt === 'string') await pool.query('UPDATE form_questions SET prompt=$1 WHERE id=$2', [String(prompt), qid]);
    if (typeof kind === 'string') await pool.query('UPDATE form_questions SET kind=$1 WHERE id=$2', [String(kind), qid]);
    if (typeof pos === 'number' && Number.isFinite(pos)) await pool.query('UPDATE form_questions SET pos=$1 WHERE id=$2', [pos, qid]);
    if (typeof locked === 'boolean') await pool.query('UPDATE form_questions SET locked=$1 WHERE id=$2', [locked, qid]);
    const questionRows = await getFormQuestions(meta.channel_id);
    const question = questionRows.find((q) => q.id === qid) || null;
    if (question) emitToFormAudience(io, meta.channel_id, meta.space_id, 'form:question:update', { channelId: meta.channel_id, question });
    await emitFormState(io, meta.channel_id, meta.space_id);
    return json(res, 200, { question }), true;
  }

  if (req.method === 'DELETE' && req.url === '/api/forms/questions') {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const rawQuestionId = pickId(body || {}, 'questionId', 'questionID', 'question_id');
    const qid = String(rawQuestionId || '').trim();
    if (!qid) return json(res, 400, { message: 'questionId required' }), true;
    const meta = await getQuestionMeta(qid);
    if (!meta) return json(res, 404, { message: 'question not found' }), true;
    const member = await isSpaceMember(meta.space_id, userId);
    if (!member) return json(res, 403, { message: 'Forbidden' }), true;
    await pool.query('DELETE FROM form_questions WHERE id=$1', [qid]);
    emitToFormAudience(io, meta.channel_id, meta.space_id, 'form:question:delete', { channelId: meta.channel_id, questionId: qid });
    await emitFormState(io, meta.channel_id, meta.space_id);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'PATCH' && req.url === '/api/forms/answers') {
    const userId = authUserId(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;
    const rawQuestionId = pickId(body || {}, 'questionId', 'questionID', 'question_id');
    const { answer } = body || {};
    const qid = String(rawQuestionId || '').trim();
    if (!qid) return json(res, 400, { message: 'questionId required' }), true;
    const meta = await getQuestionMeta(qid);
    if (!meta) return json(res, 404, { message: 'question not found' }), true;
    if (String(meta.type) !== 'form') return json(res, 400, { message: 'not a form question' }), true;
    const member = await isSpaceMember(meta.space_id, userId);
    if (!member) return json(res, 403, { message: 'Forbidden' }), true;
    const text = String(answer ?? '');
    await pool.query(
      'INSERT INTO form_answers(question_id, user_id, answer, updated_at) VALUES ($1,$2,$3, now()) ON CONFLICT (question_id, user_id) DO UPDATE SET answer=EXCLUDED.answer, updated_at=now()',
      [qid, userId, text]
    );
    emitToFormAudience(io, meta.channel_id, meta.space_id, 'form:answer', { channelId: meta.channel_id, questionId: qid, userId, answer: text, hasAnswer: text.trim().length > 0 });
    await emitFormState(io, meta.channel_id, meta.space_id);
    return json(res, 200, { ok: true }), true;
  }

  return false;
}
