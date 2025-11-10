import React, { useEffect, useMemo, useState } from 'react';
import { useFormChannel } from '../../hooks/useFormChannel';
import { askConfirm, toast } from '../../lib/ui';

type Member = { id: string; name?: string; username?: string };

export default function FormChannelView({ fid, members, meId }: { fid: string; members: Member[]; meId?: string | null }) {
  const { data, mySubmitted, allSubmitted, actions } = useFormChannel(fid, members, meId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingSubmit, setPendingSubmit] = useState<Record<string, boolean>>({});
  const [newPrompt, setNewPrompt] = useState('');
  const [newLocked, setNewLocked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);

  const roster = useMemo(() => {
    if (data.participants && data.participants.length > 0) {
      const byId = new Map(members.map((m) => [m.id, m]));
      return data.participants.map((id) => byId.get(id) || { id, username: id.slice(0, 8) });
    }
    return members;
  }, [data.participants, members]);

  const totalQuestions = data.questions.length;
  const everyoneReadyCount = data.questions.filter((q) => allSubmitted(q.id)).length;
  const myAnsweredCount = data.questions.filter((q) => !!String(data.myAnswers[q.id] || '').trim()).length;

  useEffect(() => {
    if (!editingId) return;
    const q = data.questions.find((question) => question.id === editingId);
    if (!q) {
      setEditingId(null);
      setRenameDraft('');
    }
  }, [data.questions, editingId]);

  const handleCreateQuestion = async () => {
    const prompt = newPrompt.trim();
    if (!prompt) return;
    setCreating(true);
    try {
      await actions.create(prompt, newLocked);
      setNewPrompt('');
      setNewLocked(false);
    } catch (e: any) {
      toast(e?.message || 'Failed to add question', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleSubmitAnswer = async (qid: string) => {
    const value = drafts[qid] ?? data.myAnswers[qid] ?? '';
    setPendingSubmit((prev) => ({ ...prev, [qid]: true }));
    try {
      await actions.submit(qid, value);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[qid];
        return next;
      });
    } catch (e: any) {
      toast(e?.message || 'Failed to save answer', 'error');
    } finally {
      setPendingSubmit((prev) => {
        const next = { ...prev };
        delete next[qid];
        return next;
      });
    }
  };

  const startRename = (qid: string, current: string) => {
    setEditingId(qid);
    setRenameDraft(current);
  };

  const submitRename = async () => {
    if (!editingId) return;
    const next = renameDraft.trim();
    if (!next) {
      setEditingId(null);
      setRenameDraft('');
      return;
    }
    setRenaming(true);
    try {
      await actions.rename(editingId, next);
      setEditingId(null);
      setRenameDraft('');
    } catch (e: any) {
      toast(e?.message || 'Failed to rename question', 'error');
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div className="min-h-full space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label="Questions" value={totalQuestions} hint="In this form" />
        <StatCard label="Your answers" value={totalQuestions ? `${myAnsweredCount}/${totalQuestions}` : '0'} hint="Saved responses" />
        <StatCard label="Ready to reveal" value={totalQuestions ? `${everyoneReadyCount}/${totalQuestions}` : '0'} hint="All participants submitted" />
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-inner shadow-black/40">
        <h3 className="text-sm font-semibold text-neutral-200 mb-2">New question</h3>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 space-y-2">
            <label className="text-xs uppercase tracking-wide text-neutral-400 block">Prompt</label>
            <textarea
              className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-50 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
              rows={2}
              placeholder="What would you like everyone to answer?"
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-neutral-300">
              <input type="checkbox" checked={newLocked} onChange={(e) => setNewLocked(e.target.checked)} className="accent-emerald-500" />
              Hide answers until everyone submits
            </label>
          </div>
          <button
            className="md:w-40 rounded-xl bg-emerald-500/90 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-60"
            disabled={!newPrompt.trim() || creating}
            onClick={handleCreateQuestion}
          >
            {creating ? 'Adding…' : 'Add Question'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {data.questions.map((q, idx) => {
          const everyoneDone = allSubmitted(q.id);
          return (
            <div key={q.id} className="rounded-2xl border border-neutral-800/80 bg-neutral-950/70 p-4 shadow shadow-black/40">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs uppercase tracking-wide text-neutral-500">Question {idx + 1}</span>
                    {editingId === q.id ? (
                      <div className="flex flex-col gap-2 md:flex-row md:items-center">
                        <input
                          className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-50 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            className="rounded-lg bg-emerald-500/90 px-3 py-1 text-sm font-semibold text-emerald-950 disabled:opacity-50"
                            disabled={!renameDraft.trim() || renaming}
                            onClick={submitRename}
                          >
                            Save
                          </button>
                          <button
                            className="rounded-lg border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-800/70"
                            onClick={() => { setEditingId(null); setRenameDraft(''); }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-lg font-medium text-neutral-50 break-words">
                        {q.prompt}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {q.locked ? (
                      <span className="rounded-full border border-amber-600/60 bg-amber-500/10 px-2 py-0.5 text-amber-200">Locked</span>
                    ) : (
                      <span className="rounded-full border border-emerald-600/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">Live</span>
                    )}
                    <span className={`rounded-full border px-2 py-0.5 ${everyoneDone ? 'border-emerald-700/70 bg-emerald-500/10 text-emerald-200' : 'border-neutral-700 bg-neutral-800 text-neutral-300'}`}>
                      {everyoneDone ? 'Everyone submitted' : 'Waiting on responses'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="text-xs text-neutral-400 hover:text-neutral-100" title="Rename" onClick={() => startRename(q.id, q.prompt)}>
                    ✎
                  </button>
                  <button
                    className="text-xs text-neutral-400 hover:text-neutral-100"
                    title={q.locked ? 'Unlock responses' : 'Lock responses'}
                    onClick={async () => {
                      try { await actions.setLocked(q.id, !q.locked); } catch (e: any) { toast(e?.message || 'Failed to toggle lock', 'error'); }
                    }}
                  >
                    {q.locked ? '🔒' : '🔓'}
                  </button>
                  <button
                    className="text-xs text-red-400 hover:text-red-200"
                    title="Delete question"
                    onClick={async () => {
                      const ok = await askConfirm({ title: 'Delete Question', message: 'Delete this question?', confirmText: 'Delete' });
                      if (!ok) return;
                      try { await actions.remove(q.id); } catch (e: any) { toast(e?.message || 'Failed to delete', 'error'); }
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {roster.map((m) => {
                  const isMe = meId && m.id === meId;
                  const baseVal = isMe ? (data.myAnswers[q.id] ?? '') : (data.answersByUser?.[m.id]?.[q.id] ?? '');
                  const currentDraft = drafts[q.id] ?? baseVal;
                  const dirty = isMe && currentDraft !== (data.myAnswers[q.id] ?? '');
                  const pending = !!pendingSubmit[q.id];

                  return (
                    <div key={m.id} className="flex flex-col gap-2 rounded-xl border border-neutral-900/70 bg-neutral-900/50 p-3 md:flex-row md:items-center">
                      <div className="w-full text-sm font-medium text-neutral-300 md:w-40">
                        {isMe ? 'You' : (m.name || m.username || 'Member')}
                      </div>
                      {isMe ? (
                        <div className="flex w-full flex-col gap-2 md:flex-row md:items-center">
                          <textarea
                            className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-50 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
                            rows={2}
                            value={currentDraft}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                            placeholder="Type your answer"
                          />
                          <button
                            className="w-full rounded-xl bg-emerald-500/90 px-3 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50 md:w-auto"
                            disabled={!dirty || pending}
                            onClick={() => handleSubmitAnswer(q.id)}
                          >
                            {pending ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      ) : (
                        <div className="flex w-full items-center gap-3">
                          <div className="flex-1 rounded-xl border border-neutral-800/60 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-100 min-h-[42px]">
                            {(q.locked && !everyoneDone) ? (
                              <span className="text-neutral-500">Hidden until everyone submits</span>
                            ) : (
                              (baseVal && String(baseVal).trim().length > 0) ? baseVal : <span className="text-neutral-500">No answer yet</span>
                            )}
                          </div>
                          {(String(baseVal || '').trim().length > 0 && (!q.locked || everyoneDone)) ? (
                            <span className="text-emerald-400" title="Submitted">✓</span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
                {roster.length === 0 && (
                  <div className="rounded-xl border border-dashed border-neutral-800 px-3 py-2 text-sm text-neutral-500">No participants yet.</div>
                )}
              </div>
            </div>
          );
        })}
        {data.questions.length === 0 && (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/60 p-6 text-center text-sm text-neutral-400">
            No questions yet. Start by adding one above.
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 shadow-inner shadow-black/30">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-2xl font-semibold text-neutral-50">{value}</div>
      {hint && <div className="text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}
