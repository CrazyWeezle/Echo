import { useCallback, useEffect, useRef, useState } from 'react';
import { getForm, answerQuestion as apiAnswer, createQuestion as apiCreate, updateQuestion as apiUpdate, deleteQuestion as apiDelete } from '../lib/forms/api';
import { subscribeFormChannel } from '../lib/forms/socket';
import type { FormPayload, FormQuestion } from '../lib/forms/types';

function sanitizeQuestion(input?: FormQuestion | null): FormQuestion | null {
  if (!input || typeof input.id !== 'string') return null;
  const id = input.id.trim();
  if (!id) return null;
  return {
    id,
    channelId: input.channelId,
    prompt: input.prompt ?? '',
    kind: input.kind || 'text',
    pos: Number.isFinite(input.pos) ? Number(input.pos) : 0,
    locked: !!input.locked,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function normalizeQuestions(list?: FormQuestion[]): FormQuestion[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: FormQuestion[] = [];
  for (const item of list) {
    const q = sanitizeQuestion(item);
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  out.sort((a, b) => {
    const apos = Number.isFinite(a.pos) ? Number(a.pos) : 0;
    const bpos = Number.isFinite(b.pos) ? Number(b.pos) : 0;
    if (apos !== bpos) return apos - bpos;
    if (a.createdAt && b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    return 0;
  });
  return out;
}

export function useFormChannel(fid: string, members: { id: string; name?: string; username?: string }[], meId?: string | null) {
  const [data, setData] = useState<FormPayload>({ questions: [], myAnswers: {}, answersByUser: {}, allSubmitted: {}, participants: [] });
  const [mySubmitted, setMySubmitted] = useState<Record<string, boolean>>({});
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (!fid || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const res = await getForm(fid);
      setData({
        ...res,
        questions: normalizeQuestions(res.questions),
      });
      setMySubmitted(() => {
        const map: Record<string, boolean> = {};
        for (const [qid, value] of Object.entries(res.myAnswers || {})) {
          map[qid] = !!String(value || '').trim();
        }
        return map;
      });
    } finally {
      loadingRef.current = false;
    }
  }, [fid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!fid) return;
    const unsub = subscribeFormChannel(fid, {
      onState: ({ questions, allSubmitted, participants }) => {
        setData(prev => ({
          ...prev,
          questions: normalizeQuestions(questions),
          allSubmitted: allSubmitted || prev.allSubmitted || {},
          participants: Array.isArray(participants) ? participants : prev.participants,
        }));
      },
      onAnswer: ({ questionId, userId, answer, hasAnswer }) => {
        const qid = String(questionId || '').trim();
        if (!qid) return;
        setData(prev => {
          const byUser = { ...(prev.answersByUser || {}) };
          const row = { ...(byUser[userId] || {}) };
          if (answer != null) row[qid] = String(answer || '');
          else if (hasAnswer) row[qid] = row[qid] || '';
          else delete row[qid];
          byUser[userId] = row;
          const mine = { ...prev.myAnswers };
          if (meId && userId === meId) {
            if (answer != null) mine[qid] = String(answer || '');
            else if (!hasAnswer) delete mine[qid];
          }
          return { ...prev, answersByUser: byUser, myAnswers: mine };
        });
        if (meId && userId === meId) setMySubmitted(prev => ({ ...prev, [qid]: !!String(answer || '').trim() }));
      },
      onCreate: ({ question }) => setData(prev => {
        const q = sanitizeQuestion(question);
        if (!q) return prev;
        if (prev.questions.some(existing => existing.id === q.id)) return prev;
        return { ...prev, questions: normalizeQuestions([...prev.questions, q]) };
      }),
      onUpdate: ({ question }) => setData(prev => {
        const q = sanitizeQuestion(question);
        if (!q) return prev;
        return { ...prev, questions: normalizeQuestions(prev.questions.map(qq => qq.id === q.id ? q : qq)) };
      }),
      onDelete: ({ questionId }) => {
        const qid = String(questionId || '').trim();
        setData(prev => ({ ...prev, questions: prev.questions.filter(q => q.id !== qid) }));
      },
    });
    return unsub;
  }, [fid, meId]);

  const allSubmitted = useCallback((qid: string) => {
    if (data.allSubmitted && qid in (data.allSubmitted || {})) {
      return !!data.allSubmitted?.[qid];
    }
    const participants = (data.participants && data.participants.length > 0) ? data.participants : members.map(m => m.id);
    return participants.every(uid => {
      const isMe = meId && uid === meId;
      const val = isMe ? (data.myAnswers[qid] ?? '') : (data.answersByUser?.[uid]?.[qid] ?? '');
      return String(val || '').trim().length > 0;
    });
  }, [data.allSubmitted, data.participants, data.myAnswers, data.answersByUser, members, meId]);

  const submit = useCallback(async (qid: string, text: string) => {
    const id = String(qid || '').trim();
    if (!id) throw new Error('questionId missing');
    await apiAnswer(id, text);
    setData(prev => ({ ...prev, myAnswers: { ...prev.myAnswers, [id]: text } }));
    setMySubmitted(prev => ({ ...prev, [id]: !!String(text || '').trim() }));
  }, []);

  const create = useCallback(async (prompt: string, locked?: boolean): Promise<FormQuestion> => {
    const raw = await apiCreate(fid, prompt, locked);
    const q = sanitizeQuestion(raw);
    if (!q) throw new Error('Invalid question response');
    setData(prev => {
      if (prev.questions.some(existing => existing.id === q.id)) return prev;
      return { ...prev, questions: normalizeQuestions([...prev.questions, q]) };
    });
    return q;
  }, [fid]);

  const rename = useCallback(async (qid: string, prompt: string) => {
    const q = sanitizeQuestion(await apiUpdate(qid, { prompt }));
    if (!q) return;
    setData(prev => ({ ...prev, questions: normalizeQuestions(prev.questions.map(qq => qq.id === qid ? q : qq)) }));
  }, []);

  const setLocked = useCallback(async (qid: string, locked: boolean) => {
    const q = sanitizeQuestion(await apiUpdate(qid, { locked }));
    if (!q) return;
    setData(prev => ({ ...prev, questions: normalizeQuestions(prev.questions.map(qq => qq.id === qid ? q : qq)) }));
  }, []);

  const remove = useCallback(async (qid: string) => {
    await apiDelete(qid);
    const id = String(qid || '').trim();
    setData(prev => ({ ...prev, questions: prev.questions.filter(q => q.id !== id) }));
  }, []);

  return {
    data,
    mySubmitted,
    allSubmitted,
    actions: { submit, create, rename, setLocked, remove, reload: load },
  } as const;
}
