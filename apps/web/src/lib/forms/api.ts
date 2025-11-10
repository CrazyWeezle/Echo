import { api } from '../api';
import type { FormPayload, FormQuestion } from './types';

function token() {
  try { return localStorage.getItem('token') || ''; } catch { return ''; }
}

function normalizeMyAnswers(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [qid, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && 'answer' in (value as any)) {
      out[qid] = String((value as any).answer ?? '');
    } else {
      out[qid] = String(value ?? '');
    }
  }
  return out;
}

function normalizeAnswersByUser(raw: any): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [uid, answers] of Object.entries(raw)) {
    if (!answers || typeof answers !== 'object') continue;
    const inner: Record<string, string> = {};
    for (const [qid, value] of Object.entries(answers as Record<string, unknown>)) {
      if (value && typeof value === 'object' && 'answer' in (value as any)) {
        inner[qid] = String((value as any).answer ?? '');
      } else {
        inner[qid] = String(value ?? '');
      }
    }
    out[String(uid)] = inner;
  }
  return out;
}

export async function getForm(channelFqId: string): Promise<FormPayload> {
  const res = await api.getAuth(`/forms?channelId=${encodeURIComponent(channelFqId)}`, token());
  const questions: FormQuestion[] = Array.isArray(res?.questions)
    ? (res.questions as FormQuestion[]).map((q) => ({ ...q, locked: !!q.locked }))
    : [];
  const myAnswers = normalizeMyAnswers(res?.myAnswers || res?.answers);
  const answersByUser = normalizeAnswersByUser(res?.answersByUser);
  const allSubmitted: Record<string, boolean> = {};
  if (res?.allSubmitted && typeof res.allSubmitted === 'object') {
    for (const [qid, val] of Object.entries(res.allSubmitted as Record<string, unknown>)) {
      allSubmitted[qid] = !!val;
    }
  }
  const participants = Array.isArray(res?.participants) ? (res.participants as any[]).map((id) => String(id)) : [];
  return { questions, myAnswers, answersByUser, allSubmitted, participants };
}

export async function answerQuestion(questionId: string, answer: string): Promise<void> {
  await api.patchAuth('/forms/answers', { questionId, question_id: questionId, answer }, token());
}

export async function createQuestion(channelFqId: string, prompt: string, locked?: boolean, kind = 'text'): Promise<FormQuestion> {
  const res = await api.postAuth('/forms/questions', { channelId: channelFqId, channel_id: channelFqId, prompt, kind, locked: !!locked }, token());
  return (res?.question || res) as FormQuestion;
}

export async function updateQuestion(questionId: string, data: Partial<Pick<FormQuestion, 'prompt' | 'locked' | 'pos'>>): Promise<FormQuestion> {
  const res = await api.patchAuth('/forms/questions', { questionId, question_id: questionId, ...data }, token());
  return (res?.question || res) as FormQuestion;
}

export async function deleteQuestion(questionId: string): Promise<void> {
  await api.deleteAuth('/forms/questions', { questionId, question_id: questionId }, token());
}
