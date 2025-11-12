import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormChannel } from '../../hooks/useFormChannel';
import { askConfirm, toast } from '../../lib/ui';
import { api } from '../../lib/api';
import ChannelStatsBar from '../common/ChannelStatsBar';
import type { KanbanTag } from '../../types/kanban';

type Member = { id: string; name?: string; username?: string };
const TAG_COLOR_PRESETS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#a3a3a3'];
const FALLBACK_TAG_COLOR = '#475569';

const hexToRgb = (hex?: string | null) => {
  if (!hex) return null;
  let value = hex.trim();
  if (!value.startsWith('#')) value = `#${value}`;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return null;
  if (value.length === 4) value = `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  const num = parseInt(value.slice(1), 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
};

const colorWithAlpha = (hex: string, alpha: number) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
};

const getReadableTextColor = (hex?: string | null) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#e5e7eb';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.6 ? '#0f172a' : '#f8fafc';
};

const normalizeTagLabel = (label: string) => label.trim().toLowerCase();
const getErrorMessage = (err: unknown, fallback: string) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
};

type FormChannelViewProps = {
  fid: string;
  members: Member[];
  meId?: string | null;
  channelTags: KanbanTag[];
  mutateTags: (updater: (prev: KanbanTag[]) => KanbanTag[]) => void;
  refreshTags?: () => void;
};

export default function FormChannelView({ fid, members, meId, channelTags, mutateTags, refreshTags }: FormChannelViewProps) {
  const { data, allSubmitted, actions } = useFormChannel(fid, members, meId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingSubmit, setPendingSubmit] = useState<Record<string, boolean>>({});
  const [newPrompt, setNewPrompt] = useState('');
  const [newLocked, setNewLocked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const tagLibrary = useMemo(
    () =>
      channelTags
        .map((tag) => ({ id: tag.id || `${tag.label}`, label: (tag.label || '').trim(), color: tag.color || FALLBACK_TAG_COLOR }))
        .filter((tag) => tag.label.length > 0)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [channelTags]
  );
  const channelTagMap = useMemo(() => {
    const map = new Map<string, KanbanTag>();
    channelTags.forEach((tag) => map.set(normalizeTagLabel(tag.label || ''), tag));
    return map;
  }, [channelTags]);
  const normalizedTagMap = useMemo(() => {
    const map = new Map<string, { id?: string; label: string; color: string }>();
    tagLibrary.forEach((tag) => map.set(normalizeTagLabel(tag.label), tag));
    return map;
  }, [tagLibrary]);
  const [tagEditor, setTagEditor] = useState<{ id?: string; label: string; color: string; mode: 'new' | 'edit' } | null>(null);
  const [tagSaving, setTagSaving] = useState(false);

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
  useEffect(() => {
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const q of data.questions) {
        if (!(q.id in next)) next[q.id] = false;
      }
      for (const key of Object.keys(next)) {
        if (!data.questions.some((q) => q.id === key)) delete next[key];
      }
      return next;
    });
  }, [data.questions]);

  const handleCreateQuestion = async () => {
    const prompt = newPrompt.trim();
    if (!prompt) return;
    setCreating(true);
    try {
      await actions.create(prompt, newLocked);
      setNewPrompt('');
      setNewLocked(false);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add question'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleSubmitAnswer = async (qid: string) => {
    if (!qid) {
      toast('Question reference missing.', 'error');
      return;
    }
    const value = drafts[qid] ?? data.myAnswers[qid] ?? '';
    setPendingSubmit((prev) => ({ ...prev, [qid]: true }));
    try {
      await actions.submit(qid, value);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[qid];
        return next;
      });
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save answer'), 'error');
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
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to rename question'), 'error');
    } finally {
      setRenaming(false);
    }
  };

  const openNewTagEditor = useCallback(() => {
    setTagEditor({ label: '', color: TAG_COLOR_PRESETS[3], mode: 'new' });
  }, []);

  const openEditTagEditor = useCallback((tag: KanbanTag) => {
    setTagEditor({ id: tag.id, label: tag.label || '', color: tag.color || TAG_COLOR_PRESETS[3], mode: 'edit' });
  }, []);

  const saveChannelTag = async () => {
    if (!tagEditor) return;
    const label = tagEditor.label.trim();
    if (!label) {
      toast('Tag name required', 'error');
      return;
    }
    const color = tagEditor.color || TAG_COLOR_PRESETS[0];
    setTagSaving(true);
    const tok = localStorage.getItem('token') || '';
    if (tagEditor.mode === 'new') {
      const tempId = `${label}:${Date.now()}`;
      mutateTags((prev) => {
        if (prev.some((tag) => normalizeTagLabel(tag.label || '') === normalizeTagLabel(label))) return prev;
        return [...prev, { id: tempId, label, color }];
      });
      try {
        const res = await api.postAuth('/channel-tags', { channelId: fid, label, color }, tok);
        const tag = (res?.tag as KanbanTag) || null;
        if (tag) mutateTags((prev) => prev.map((t) => (t.id === tempId ? tag : t)));
        else refreshTags?.();
        setTagEditor(null);
      } catch (err) {
        mutateTags((prev) => prev.filter((tag) => tag.id !== tempId));
        toast(getErrorMessage(err, 'Failed to save tag'), 'error');
      } finally {
        setTagSaving(false);
      }
      return;
    }
    if (!tagEditor.id) {
      setTagSaving(false);
      return;
    }
    mutateTags((prev) => prev.map((tag) => (tag.id === tagEditor.id ? { ...tag, label, color } : tag)));
    try {
      await api.patchAuth('/channel-tags', { tagId: tagEditor.id, label, color }, tok);
      setTagEditor(null);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save tag'), 'error');
      refreshTags?.();
    } finally {
      setTagSaving(false);
    }
  };

  const deleteTag = useCallback(
    async (tag: KanbanTag) => {
      if (!tag?.id) return;
      const ok = await askConfirm({ title: 'Delete tag', message: `Remove #${tag.label}?`, confirmText: 'Delete' });
      if (!ok) return;
      mutateTags((prev) => prev.filter((t) => t.id !== tag.id));
      if (tagEditor?.id === tag.id) setTagEditor(null);
      try {
        const tok = localStorage.getItem('token') || '';
        await api.deleteAuth('/channel-tags', { tagId: tag.id }, tok);
      } catch (err) {
        toast(getErrorMessage(err, 'Failed to delete tag'), 'error');
        refreshTags?.();
      }
    },
    [mutateTags, refreshTags, tagEditor?.id]
  );
  const deleteTagFromEditor = useCallback(() => {
    if (!tagEditor?.id) return;
    void deleteTag({ id: tagEditor.id, label: tagEditor.label, color: tagEditor.color });
  }, [deleteTag, tagEditor]);

  const displayTags = useMemo(() => tagLibrary, [tagLibrary]);

  const stats = useMemo(
    () => [
      { label: 'Questions', value: totalQuestions },
      { label: 'Your answers', value: totalQuestions ? `${myAnsweredCount}/${totalQuestions}` : '0' },
      { label: 'Ready to reveal', value: totalQuestions ? `${everyoneReadyCount}/${totalQuestions}` : '0' },
    ],
    [totalQuestions, myAnsweredCount, everyoneReadyCount]
  );

  return (
    <div className="min-h-full space-y-4">
      <ChannelStatsBar stats={stats} />

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 px-3 py-2 flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-neutral-500">Channel tags</span>
        <button
          className="inline-flex items-center gap-1 rounded-full border border-emerald-600/50 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-900/30"
          onClick={openNewTagEditor}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New tag
        </button>
        {displayTags.length === 0 ? (
          <span className="text-xs text-neutral-500">No channel tags yet.</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {displayTags.map((tag) => {
              const canonical = channelTagMap.get(normalizeTagLabel(tag.label));
              return (
                <span
                  key={canonical?.id || tag.label}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: colorWithAlpha(tag.color, 0.2),
                    borderColor: tag.color,
                    color: getReadableTextColor(tag.color),
                  }}
                >
                  #{tag.label}
                  {canonical && (
                    <>
                      <button className="p-0.5 rounded-full bg-black/20 hover:bg-black/40" title="Edit tag" onClick={() => openEditTagEditor(canonical)}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                      <button
                        className="p-0.5 rounded-full text-red-200 hover:bg-red-900/40"
                        title="Delete tag"
                        onClick={() => { void deleteTag(canonical); }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                          <path d="M18 6L6 18" />
                          <path d="M6 6l12 12" />
                        </svg>
                      </button>
                    </>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-inner shadow-black/40">
        <h3 className="text-sm font-semibold text-neutral-200 mb-2">New question</h3>
        <label className="text-xs uppercase tracking-wide text-neutral-400 block">Prompt</label>
        <div className="flex items-start gap-3">
          <textarea
            className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-50 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
            rows={2}
            placeholder="ex. What is one thing you like about yourself?"
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
          />
          <button
            className="rounded-full bg-emerald-500/90 h-12 w-12 flex items-center justify-center text-2xl text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-60 shrink-0"
            disabled={!newPrompt.trim() || creating}
            onClick={handleCreateQuestion}
            aria-label="Add question"
          >
            {creating ? '…' : '+'}
          </button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-neutral-300">
          <input type="checkbox" checked={newLocked} onChange={(e) => setNewLocked(e.target.checked)} className="accent-emerald-500" />
          Hide answers until everyone submits
        </label>
      </div>

      <div className="space-y-4">
        {data.questions.map((q, idx) => {
          const everyoneDone = allSubmitted(q.id);
          const isCollapsed = !!collapsed[q.id];
          return (
            <div key={q.id} className="rounded-2xl border border-neutral-800/80 bg-neutral-950/70 p-4 shadow shadow-black/40">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs uppercase tracking-wide text-neutral-500">Question {idx + 1}</span>
                    <div className="flex items-start gap-2">
                      <button
                        className="mt-1 shrink-0 rounded-full border border-neutral-700 p-1 text-neutral-300 hover:bg-neutral-900/70"
                        onClick={() => setCollapsed((prev) => ({ ...prev, [q.id]: !isCollapsed }))}
                        aria-label={isCollapsed ? 'Expand question' : 'Collapse question'}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {editingId === q.id ? (
                        <div className="flex flex-col gap-2 md:flex-row md:items-center flex-1">
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
                        <div className="flex-1 text-lg font-medium text-neutral-50 break-words">
                          {q.prompt}
                        </div>
                      )}
                    </div>
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
                    className="text-xs text-red-400 hover:text-red-200"
                    title="Delete question"
                    onClick={async () => {
                      const ok = await askConfirm({ title: 'Delete Question', message: 'Delete this question?', confirmText: 'Delete' });
                      if (!ok) return;
                      try {
                        await actions.remove(q.id);
                      } catch (err) {
                        toast(getErrorMessage(err, 'Failed to delete'), 'error');
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {!isCollapsed && (
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
                            className="w-10 h-10 rounded-full bg-emerald-500/90 text-emerald-950 flex items-center justify-center text-xl font-semibold transition hover:bg-emerald-400 disabled:opacity-50 md:w-10 md:h-10"
                            disabled={!dirty || pending || !q.id}
                            onClick={() => handleSubmitAnswer(q.id)}
                            aria-label="Save answer"
                          >
                            {pending ? '…' : '✓'}
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
              )}
            </div>
          );
        })}
        {data.questions.length === 0 && (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/60 p-6 text-center text-sm text-neutral-400">
            No questions yet. Start by adding one above.
          </div>
        )}
      </div>
      {tagEditor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setTagEditor(null)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl space-y-4">
            <div className="text-lg font-semibold text-neutral-100">{tagEditor.mode === 'new' ? 'New tag' : `Edit #${tagEditor.label}`}</div>
            {tagEditor.mode === 'new' && (
              <label className="space-y-1 text-sm text-neutral-200 w-full">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Tag name</span>
                <input
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-500 focus:outline-none"
                  value={tagEditor.label}
                  onChange={(e) => setTagEditor((prev) => (prev ? { ...prev, label: e.target.value } : prev))}
                />
              </label>
            )}
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Color</div>
              <div className="flex flex-wrap gap-2">
                {TAG_COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    className={`h-8 w-8 rounded-full border ${tagEditor.color === color ? 'ring-2 ring-emerald-400' : 'border-white/20'}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setTagEditor((prev) => (prev ? { ...prev, color } : prev))}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              {tagEditor.mode === 'edit' && tagEditor.id && (
                <button
                  className="mr-auto text-sm text-red-400 hover:text-red-200"
                  onClick={deleteTagFromEditor}
                  disabled={tagSaving}
                >
                  Delete
                </button>
              )}
              <button className="px-4 py-2 rounded-full border border-neutral-700 text-sm text-neutral-200 hover:bg-neutral-900/60" onClick={() => setTagEditor(null)} disabled={tagSaving}>
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-full bg-emerald-600 text-sm text-emerald-50 hover:bg-emerald-500 disabled:opacity-50"
                onClick={saveChannelTag}
                disabled={tagSaving || (tagEditor.mode === 'new' && !tagEditor.label.trim())}
              >
                {tagSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
