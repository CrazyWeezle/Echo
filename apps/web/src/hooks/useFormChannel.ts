import { useCallback, useEffect, useRef, useState } from 'react';
import { getForm, answerQuestion as apiAnswer, createQuestion as apiCreate, updateQuestion as apiUpdate, deleteQuestion as apiDelete } from '../lib/forms/api';
import { subscribeFormChannel } from '../lib/forms/socket';
import type { FormPayload, FormQuestion } from '../lib/forms/types';

export function useFormChannel(fid: string, members: { id: string; name?: string; username?: string }[], meId?: string | null) {
  const [data, setData] = useState<FormPayload>({ questions: [], myAnswers: {}, answersByUser: {}, allSubmitted: {}, participants: [] });
  const [mySubmitted, setMySubmitted] = useState<Record<string, boolean>>({});
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (!fid || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const res = await getForm(fid);
      setData(res);
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
          questions: questions || [],
          allSubmitted: allSubmitted || prev.allSubmitted || {},
          participants: Array.isArray(participants) ? participants : prev.participants,
        }));
      },
      onAnswer: ({ questionId, userId, answer, hasAnswer }) => {
        setData(prev => {
          const byUser = { ...(prev.answersByUser || {}) };
          const row = { ...(byUser[userId] || {}) };
          if (answer != null) row[questionId] = String(answer || '');
          else if (hasAnswer) row[questionId] = row[questionId] || '';
          else delete row[questionId];
          byUser[userId] = row;
          const mine = { ...prev.myAnswers };
          if (meId && userId === meId) {
            if (answer != null) mine[questionId] = String(answer || '');
            else if (!hasAnswer) delete mine[questionId];
          }
          return { ...prev, answersByUser: byUser, myAnswers: mine };
        });
        if (meId && userId === meId) setMySubmitted(prev => ({ ...prev, [questionId]: !!String(answer || '').trim() }));
      },
      onCreate: ({ question }) => setData(prev => {
        if (!question) return prev;
        if (prev.questions.some(q => q.id === question.id)) return prev;
        return { ...prev, questions: [...prev.questions, question] };
      }),
      onUpdate: ({ question }) => setData(prev => ({ ...prev, questions: prev.questions.map(q => q.id === question.id ? question : q) })),
      onDelete: ({ questionId }) => setData(prev => ({ ...prev, questions: prev.questions.filter(q => q.id !== questionId) })),
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
    await apiAnswer(qid, text);
    setData(prev => ({ ...prev, myAnswers: { ...prev.myAnswers, [qid]: text } }));
    setMySubmitted(prev => ({ ...prev, [qid]: !!String(text || '').trim() }));
  }, []);

  const create = useCallback(async (prompt: string, locked?: boolean): Promise<FormQuestion> => {
    const q = await apiCreate(fid, prompt, locked);
    setData(prev => {
      if (prev.questions.some(existing => existing.id === q.id)) return prev;
      return { ...prev, questions: [...prev.questions, q] };
    });
    return q;
  }, [fid]);

  const rename = useCallback(async (qid: string, prompt: string) => {
    const q = await apiUpdate(qid, { prompt });
    setData(prev => ({ ...prev, questions: prev.questions.map(qq => qq.id === qid ? q : qq) }));
  }, []);

  const setLocked = useCallback(async (qid: string, locked: boolean) => {
    const q = await apiUpdate(qid, { locked });
    setData(prev => ({ ...prev, questions: prev.questions.map(qq => qq.id === qid ? q : qq) }));
  }, []);

  const remove = useCallback(async (qid: string) => {
    await apiDelete(qid);
    setData(prev => ({ ...prev, questions: prev.questions.filter(q => q.id !== qid) }));
  }, []);

  return {
    data,
    mySubmitted,
    allSubmitted,
    actions: { submit, create, rename, setLocked, remove, reload: load },
  } as const;
}
