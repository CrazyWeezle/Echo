import { api } from '../api';
import type { FormPayload, FormQuestion } from './types';

function token() {
  try { return localStorage.getItem('token') || ''; } catch { return ''; }
}

export async function getForm(channelFqId: string): Promise<FormPayload> {
  const res = await api.getAuth(`/forms?channelId=${encodeURIComponent(channelFqId)}`, token());
  const questions: FormQuestion[] = Array.isArray(res?.questions) ? res.questions : [];
  const myAnswers: Record<string, string> = {};
  if (res?.answers && typeof res.answers === 'object') {
    for (const [qid, v] of Object.entries(res.answers as any)) myAnswers[qid] = String((v as any)?.answer || '');
  }
  const answersByUser: Record<string, Record<string, string>> = {};
  if (res?.answersByUser && typeof res.answersByUser === 'object') {
    for (const [uid, amap] of Object.entries(res.answersByUser as any)) {
      const inner: Record<string, string> = {};
      for (const [qid, a] of Object.entries(amap as any)) inner[qid] = String(a || '');
      answersByUser[String(uid)] = inner;
    }
  }
  return { questions, myAnswers, answersByUser, allSubmitted: res?.allSubmitted || {}, participants: res?.participants || [] };
}

export async function answerQuestion(questionId: string, answer: string): Promise<void> {
  await api.patchAuth('/forms/answers', { questionId, answer }, token());
}

export async function createQuestion(channelFqId: string, prompt: string, locked?: boolean, kind = 'text'): Promise<FormQuestion> {
  const res = await api.postAuth('/forms/questions', { channelId: channelFqId, prompt, kind, locked: !!locked }, token());
  return (res?.question || res) as FormQuestion;
}

export async function updateQuestion(questionId: string, data: Partial<Pick<FormQuestion, 'prompt' | 'locked' | 'pos'>>): Promise<FormQuestion> {
  const res = await api.patchAuth('/forms/questions', { questionId, ...data }, token());
  return (res?.question || res) as FormQuestion;
}

export async function deleteQuestion(questionId: string): Promise<void> {
  await api.deleteAuth('/forms/questions', { questionId }, token());
}

