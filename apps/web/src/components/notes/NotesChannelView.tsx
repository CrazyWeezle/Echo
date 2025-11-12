import { useCallback, useEffect, useMemo, useState } from 'react';
import ChannelStatsBar from '../common/ChannelStatsBar';
import { askConfirm, toast } from '../../lib/ui';
import { api } from '../../lib/api';
import type { KanbanTag } from '../../types/kanban';

type NoteMessage = { id: string; content?: string | null; createdAt?: string | null };
type NoteDraft = { title: string; body: string; tags: string[] };

const TAG_COLOR_PRESETS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#a3a3a3'];
const FALLBACK_TAG_COLOR = '#475569';

const normalizeTagLabel = (label: string) => label.trim().toLowerCase();

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

const randomId = () => {
  try {
    const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
    if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  } catch {}
  return Math.random().toString(36).slice(2);
};

const parseNotes = (messages: NoteMessage[]) => {
  return messages
    .map((msg) => {
      const text = String(msg.content || '').trim();
      const [first, ...rest] = text.split(/\r?\n/);
      const title = (first || '').trim() || 'Untitled';
      let body = rest.join('\n').trim();
      let tags = Array.from(new Set((text.match(/#([\w-]{1,30})/g) || []).map((s) => s.slice(1).toLowerCase())));

      if (body) {
        const lines = body.split(/\r?\n/);
        const lastLine = lines[lines.length - 1]?.trim();
        if (lastLine && /^#[\w-]+(?:\s+#[\w-]+)*$/.test(lastLine)) {
          tags = lastLine.split(/\s+/).map((token) => token.replace(/^#/, '').toLowerCase());
          lines.pop();
          body = lines.join('\n').trim();
        }
      }
      return { id: msg.id, title, body, tags, createdAt: msg.createdAt || undefined };
    })
    .reverse();
};

const formatDate = (value?: string) => {
  if (!value) return '\u2014';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const resolveErrorMessage = (err: unknown, fallback: string) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
};

type NotesChannelViewProps = {
  fid: string;
  notes: NoteMessage[];
  channelTags: KanbanTag[];
  mutateTags: (updater: (prev: KanbanTag[]) => KanbanTag[]) => void;
  refreshTags?: () => void;
  onCreateNote: (draft: NoteDraft) => Promise<void>;
  onUpdateNote: (id: string, draft: NoteDraft) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
};

export default function NotesChannelView({ fid, notes, channelTags, mutateTags, refreshTags, onCreateNote, onUpdateNote, onDeleteNote }: NotesChannelViewProps) {
  const parsed = useMemo(() => parseNotes(notes), [notes]);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [modalDraft, setModalDraft] = useState<{ id?: string; title: string; body: string; tags: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [tagEditor, setTagEditor] = useState<{ id?: string; label: string; color: string; mode: 'new' | 'edit' } | null>(null);
  const [tagSaving, setTagSaving] = useState(false);

  useEffect(() => {
    setSearch('');
    setTagFilter(null);
    setModalDraft(null);
    setTagEditor(null);
  }, [fid]);

  const tagLibrary = useMemo(() => {
    return channelTags
      .map((tag) => ({ id: tag.id || randomId(), label: (tag.label || '').trim(), color: tag.color || FALLBACK_TAG_COLOR }))
      .filter((tag) => tag.label.length > 0)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [channelTags]);

  const normalizedTagMap = useMemo(() => {
    const map = new Map<string, { id: string; label: string; color: string }>();
    tagLibrary.forEach((tag) => map.set(normalizeTagLabel(tag.label), tag));
    return map;
  }, [tagLibrary]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    parsed.forEach((note) => {
      note.tags.forEach((tag) => {
        const key = normalizeTagLabel(tag);
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    return counts;
  }, [parsed]);

  const displayTags = useMemo(() => {
    const known: { id: string; label: string; color: string; count: number }[] = [];
    normalizedTagMap.forEach((tag, key) => {
      known.push({ ...tag, count: tagCounts.get(key) || 0 });
    });
    const extras = Array.from(tagCounts.entries())
      .filter(([label]) => !normalizedTagMap.has(label))
      .map(([label, count]) => ({ id: `orphan-${label}`, label, color: FALLBACK_TAG_COLOR, count }));
    return [...known, ...extras].sort((a, b) => a.label.localeCompare(b.label));
  }, [normalizedTagMap, tagCounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const activeFilter = tagFilter ? normalizeTagLabel(tagFilter) : null;
    return parsed.filter((note) => {
      const matchesSearch =
        !q ||
        note.title.toLowerCase().includes(q) ||
        note.body.toLowerCase().includes(q) ||
        note.tags.some((tag) => tag.includes(q));
      const matchesTag = !activeFilter || note.tags.some((tag) => normalizeTagLabel(tag) === activeFilter);
      return matchesSearch && matchesTag;
    });
  }, [parsed, search, tagFilter]);

  const totalNotes = parsed.length;
  const taggedNotes = parsed.filter((n) => n.tags.length > 0).length;
  const lastUpdated = parsed[0]?.createdAt;
  const noteStats = useMemo(
    () => [
      { label: 'Total notes', value: totalNotes },
      { label: 'Tagged', value: taggedNotes },
      { label: 'Channel tags', value: channelTags.length || '\u2014' },
      { label: 'Last updated', value: totalNotes === 0 ? '\u2014' : formatDate(lastUpdated) },
    ],
    [totalNotes, taggedNotes, channelTags.length, lastUpdated]
  );

  const addTagToDraft = (tag: string) => {
    setModalDraft((prev) => {
      if (!prev) return prev;
      if (prev.tags.includes(tag)) return prev;
      return { ...prev, tags: [...prev.tags, tag] };
    });
  };

  const removeTagFromDraft = (tag: string) => {
    setModalDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, tags: prev.tags.filter((t) => t !== tag) };
    });
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
      const tempId = randomId();
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
        toast(resolveErrorMessage(err, 'Failed to create tag'), 'error');
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
      toast(resolveErrorMessage(err, 'Failed to update tag'), 'error');
      refreshTags?.();
    } finally {
      setTagSaving(false);
    }
  };

  const deleteTag = useCallback(
    async (tag: KanbanTag) => {
      if (!tag || !tag.id) return;
      const ok = await askConfirm({ title: 'Delete tag', message: `Remove #${tag.label}?`, confirmText: 'Delete' });
      if (!ok) return;
      mutateTags((prev) => prev.filter((t) => t.id !== tag.id));
      setTagFilter((prev) => (prev && normalizeTagLabel(prev) === normalizeTagLabel(tag.label || '') ? null : prev));
      setModalDraft((prev) => {
        if (!prev) return prev;
        return { ...prev, tags: prev.tags.filter((t) => normalizeTagLabel(t) !== normalizeTagLabel(tag.label || '')) };
      });
      if (tagEditor?.id === tag.id) setTagEditor(null);
      try {
        const tok = localStorage.getItem('token') || '';
        await api.deleteAuth('/channel-tags', { tagId: tag.id }, tok);
      } catch (err) {
        toast(resolveErrorMessage(err, 'Failed to delete tag'), 'error');
        refreshTags?.();
      }
    },
    [mutateTags, refreshTags, tagEditor?.id]
  );

  const handleSave = async () => {
    if (!modalDraft) return;
    if (!modalDraft.title.trim()) {
      toast('Title is required', 'error');
      return;
    }
    setSaving(true);
    try {
      if (modalDraft.id) await onUpdateNote(modalDraft.id, { title: modalDraft.title, body: modalDraft.body, tags: modalDraft.tags });
      else await onCreateNote({ title: modalDraft.title, body: modalDraft.body, tags: modalDraft.tags });
      setModalDraft(null);
    } catch (err) {
      toast(resolveErrorMessage(err, 'Failed to save note'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!modalDraft?.id) return;
    const ok = await askConfirm({ title: 'Delete Note', message: 'Delete this note?', confirmText: 'Delete' });
    if (!ok) return;
    setSaving(true);
    try {
      await onDeleteNote(modalDraft.id);
      setModalDraft(null);
    } catch (err) {
      toast(resolveErrorMessage(err, 'Failed to delete note'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const getTagColor = useCallback((label: string) => {
    const match = normalizedTagMap.get(normalizeTagLabel(label));
    return match?.color || FALLBACK_TAG_COLOR;
  }, [normalizedTagMap]);

  const closeModal = () => {
    if (saving) return;
    setModalDraft(null);
  };

  return (
    <div className="min-h-full space-y-4">
      <ChannelStatsBar stats={noteStats} />

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
              const isActive = tagFilter && normalizeTagLabel(tagFilter) === normalizeTagLabel(tag.label);
              const canonical = channelTags.find((t) => normalizeTagLabel(t.label || '') === normalizeTagLabel(tag.label));
              return (
                <div key={tag.id} className="flex items-center gap-1">
                  <button
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition"
                    style={{
                      backgroundColor: colorWithAlpha(tag.color, isActive ? 0.4 : 0.2),
                      borderColor: tag.color,
                      color: getReadableTextColor(tag.color),
                    }}
                    onClick={() => setTagFilter((prev) => (prev && normalizeTagLabel(prev) === normalizeTagLabel(tag.label) ? null : tag.label))}
                  >
                    #{tag.label}
                    <span className="text-[10px] opacity-80">{tag.count}</span>
                  </button>
                  {canonical && (
                    <>
                      <button className="p-1 rounded text-neutral-400 hover:text-neutral-200" onClick={() => openEditTagEditor(canonical)} title="Edit tag">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                      <button className="p-1 rounded text-red-300 hover:text-red-200" onClick={() => { void deleteTag(canonical); }} title="Delete tag">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                          <path d="M18 6L6 18" />
                          <path d="M6 6l12 12" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              );
            })}
            {tagFilter && (
              <button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={() => setTagFilter(null)}>
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes"
            className="min-w-[200px] flex-1 rounded-full border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-100 focus:border-emerald-500 focus:outline-none"
          />
          <button
            className="rounded-full border border-emerald-600/60 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/30"
            onClick={() => setModalDraft({ title: '', body: '', tags: [] })}
          >
            + New note
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/50 p-6 text-center text-sm text-neutral-500">
            No notes yet. Use the New note button to add one.
          </div>
        ) : (
          filtered.map((note) => {
            const tagChips = note.tags || [];
            return (
              <div key={note.id} className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <div>{formatDate(note.createdAt)}</div>
                  <button className="text-emerald-300 hover:text-emerald-100" onClick={() => setModalDraft({ id: note.id, title: note.title, body: note.body, tags: [...note.tags] })}>
                    Edit
                  </button>
                </div>
                <div className="text-lg font-semibold text-neutral-100">{note.title}</div>
                {note.body && <p className="text-sm text-neutral-300 whitespace-pre-wrap break-words">{note.body}</p>}
                {tagChips.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {tagChips.map((tag) => {
                      const color = getTagColor(tag);
                      return (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            backgroundColor: colorWithAlpha(color, 0.25),
                            borderColor: color,
                            color: getReadableTextColor(color),
                          }}
                        >
                          #{tag}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {modalDraft && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeModal} />
          <div className="relative w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-emerald-300">{modalDraft.id ? 'Edit note' : 'New note'}</div>
              <button className="text-neutral-400 hover:text-neutral-200" onClick={closeModal} aria-label="Close">
                &times;
              </button>
            </div>
            <div className="space-y-2">
              <input
                className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-500 focus:outline-none"
                placeholder="Title"
                value={modalDraft.title}
                onChange={(e) => setModalDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
              />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {modalDraft.tags.map((tag) => {
                      const color = getTagColor(tag);
                      return (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            backgroundColor: colorWithAlpha(color, 0.25),
                            borderColor: color,
                            color: getReadableTextColor(color),
                          }}
                        >
                          #{tag}
                          <button className="text-xs opacity-70 hover:opacity-100" onClick={() => removeTagFromDraft(tag)} aria-label={`Remove ${tag}`}>
                            &times;
                          </button>
                        </span>
                      );
                    })}
                    {modalDraft.tags.length === 0 && <span className="text-xs text-neutral-500">No tags yet</span>}
                  </div>
                </div>
                {tagLibrary.length === 0 ? (
                  <p className="text-xs text-neutral-500">Use the New tag button to create shared tags for this channel.</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {tagLibrary.map((tag) => {
                      const selected = modalDraft.tags.includes(tag.label);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          className={`px-2 py-1 rounded-full border text-xs transition ${selected ? 'ring-2 ring-emerald-400/60' : 'opacity-80 hover:opacity-100'}`}
                          style={{
                            backgroundColor: colorWithAlpha(tag.color, selected ? 0.4 : 0.2),
                            borderColor: tag.color,
                            color: getReadableTextColor(tag.color),
                          }}
                          onClick={() => (selected ? removeTagFromDraft(tag.label) : addTagToDraft(tag.label))}
                        >
                          #{tag.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <textarea
              className="w-full h-40 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-500 focus:outline-none"
              placeholder="Body (supports #tags)"
              value={modalDraft.body}
              onChange={(e) => setModalDraft((prev) => (prev ? { ...prev, body: e.target.value } : prev))}
            />
            <div className="flex items-center gap-2 justify-end">
              {modalDraft.id && (
                <button className="text-sm text-red-400 hover:text-red-200" onClick={handleDelete} disabled={saving}>
                  Delete
                </button>
              )}
              <button className="px-4 py-2 rounded-full border border-neutral-700 text-sm text-neutral-200 hover:bg-neutral-900/60" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-full bg-emerald-600 text-sm text-emerald-50 hover:bg-emerald-500 disabled:opacity-50"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tagEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setTagEditor(null)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl space-y-4">
            <div className="text-lg font-semibold text-neutral-100">{tagEditor.mode === 'new' ? 'New tag' : `Edit #${tagEditor.label}`}</div>
            <label className="space-y-1 text-sm text-neutral-200">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Tag name</span>
              <input
                className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-500 focus:outline-none"
                value={tagEditor.label}
                onChange={(e) => setTagEditor((prev) => (prev ? { ...prev, label: e.target.value } : prev))}
                placeholder="e.g. wins"
                disabled={tagEditor.mode === 'edit' && !tagEditor.id}
              />
            </label>
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Color</div>
              <div className="flex flex-wrap gap-2">
                {TAG_COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    className={`h-8 w-8 rounded-full border ${tagEditor.color === color ? 'ring-2 ring-emerald-400' : 'border-white/20'}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setTagEditor((prev) => (prev ? { ...prev, color } : prev))}
                    aria-label={`Select ${color}`}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              {tagEditor.mode === 'edit' && tagEditor.id && (
                <button
                  className="mr-auto text-sm text-red-400 hover:text-red-200"
                  onClick={() => { void deleteTag({ id: tagEditor.id, label: tagEditor.label, color: tagEditor.color }); }}
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
