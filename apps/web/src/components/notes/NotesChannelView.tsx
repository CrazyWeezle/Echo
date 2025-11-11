import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { askConfirm, toast } from '../../lib/ui';

type NoteMessage = { id: string; content?: string | null; createdAt?: string | null };
type NoteDraft = { title: string; body: string; tags: string[] };

type NotesChannelViewProps = {
  fid: string;
  notes: NoteMessage[];
  onCreateNote: (draft: NoteDraft) => Promise<void>;
  onUpdateNote: (id: string, draft: NoteDraft) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
};

type ParsedNote = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  createdAt?: string;
};

const parseNotes = (messages: NoteMessage[]): ParsedNote[] => {
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
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const resolveErrorMessage = (err: unknown, fallback: string) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
};

export default function NotesChannelView({ fid, notes, onCreateNote, onUpdateNote, onDeleteNote }: NotesChannelViewProps) {
  const parsed = useMemo(() => parseNotes(notes), [notes]);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [modalDraft, setModalDraft] = useState<{ id?: string; title: string; body: string; tags: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [tagLibrary, setTagLibrary] = useState<string[]>([]);

  useEffect(() => {
    setSearch('');
    setTagFilter(null);
    setModalDraft(null);
    try {
      const stored = localStorage.getItem(`notes.tags:${fid}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setTagLibrary(parsed as string[]);
        else setTagLibrary([]);
      } else setTagLibrary([]);
    } catch {
      setTagLibrary([]);
    }
  }, [fid]);

  useEffect(() => {
    try {
      localStorage.setItem(`notes.tags:${fid}`, JSON.stringify(tagLibrary));
    } catch {
      /* ignore */
    }
  }, [tagLibrary, fid]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    parsed.forEach((note) => {
      note.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [parsed]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parsed.filter((note) => {
      const matchesSearch =
        !q ||
        note.title.toLowerCase().includes(q) ||
        note.body.toLowerCase().includes(q) ||
        note.tags.some((tag) => tag.includes(q));
      const matchesTag = !tagFilter || note.tags.includes(tagFilter);
      return matchesSearch && matchesTag;
    });
  }, [parsed, search, tagFilter]);

  const totalNotes = parsed.length;
  const taggedNotes = parsed.filter((n) => n.tags.length > 0).length;
  const uniqueTags = new Set([...tagLibrary, ...parsed.flatMap((n) => n.tags)]).size;
  const lastUpdated = parsed[0]?.createdAt;

  const openCreateModal = () => setModalDraft({ title: '', body: '', tags: [] });
  const openEditModal = (note: ParsedNote) => setModalDraft({ id: note.id, title: note.title, body: note.body, tags: [...note.tags] });
  const closeModal = () => {
    if (saving) return;
    setModalDraft(null);
  };

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

  const handleAddLibraryTag = () => {
    const value = prompt('New tag name')?.trim().toLowerCase();
    if (!value) return;
    if (tagLibrary.includes(value)) return;
    setTagLibrary((prev) => [...prev, value]);
  };

  const displayTags = useMemo(() => {
    const map = new Map<string, number>();
    tagLibrary.forEach((tag) => map.set(tag, map.get(tag) || 0));
    tagCounts.forEach(([tag, count]) => map.set(tag, count));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [tagCounts, tagLibrary]);

  const addTagToDraft = (tag: string) => {
    setModalDraft((prev) => {
      if (!prev) return prev;
      if (prev.tags.includes(tag)) return prev;
      return { ...prev, tags: [...prev.tags, tag] };
    });
    if (!tagLibrary.includes(tag)) setTagLibrary((prev) => [...prev, tag]);
  };

  const removeTagFromDraft = (tag: string) => {
    setModalDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, tags: prev.tags.filter((t) => t !== tag) };
    });
  };

  return (
    <div className="min-h-full space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <StatCard label="Total notes" value={totalNotes} />
        <StatCard label="Tagged notes" value={taggedNotes} />
        <StatCard
          label="Unique tags"
          value={uniqueTags}
          action={
            <button className="ml-auto rounded-full border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800/60" onClick={handleAddLibraryTag}>
              + Tag
            </button>
          }
        />
        <StatCard label="Last updated" value={totalNotes === 0 ? '—' : formatDate(lastUpdated)} />
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
            onClick={openCreateModal}
          >
            + New note
          </button>
        </div>
        {displayTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-neutral-500">Tags:</span>
            {displayTags.slice(0, 12).map(([tag, count]) => {
              const active = tag === tagFilter;
              return (
                <button
                  key={tag}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    active ? 'border-emerald-500 bg-emerald-900/30 text-emerald-200' : 'border-neutral-800 text-neutral-300 hover:bg-neutral-900/60'
                  }`}
                  onClick={() => setTagFilter((prev) => (prev === tag ? null : tag))}
                >
                  #{tag} <span className="ml-1 opacity-70">{count}</span>
                </button>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/40 p-6 text-center text-sm text-neutral-500">
            No notes match the current filters.
          </div>
        ) : (
          filtered.map((note) => (
            <button
              key={note.id}
              onClick={() => openEditModal(note)}
              className="text-left rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 shadow hover:border-emerald-700/60 hover:bg-neutral-900 transition"
            >
              <div className="text-sm text-neutral-500 mb-1">{formatDate(note.createdAt)}</div>
              <div className="text-lg font-semibold text-neutral-100 truncate mb-2">{note.title}</div>
              <div className="text-sm text-neutral-300 line-clamp-4 whitespace-pre-wrap">{note.body || '—'}</div>
              {note.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {note.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))
        )}
      </div>

      {modalDraft && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeModal} />
          <div className="relative w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-emerald-300">{modalDraft.id ? 'Edit note' : 'New note'}</div>
              <button className="text-neutral-400 hover:text-neutral-200" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="space-y-2">
              <input
                className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-500 focus:outline-none"
                placeholder="Title"
                value={modalDraft.title}
                onChange={(e) => setModalDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
              />
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs uppercase tracking-wide text-neutral-500">Tags</div>
                <div className="flex flex-wrap gap-1">
                  {modalDraft.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-200">
                      #{tag}
                      <button className="text-neutral-500 hover:text-red-300" onClick={() => removeTagFromDraft(tag)} aria-label={`Remove ${tag}`}>
                        ×
                      </button>
                    </span>
                  ))}
                  {modalDraft.tags.length === 0 && <span className="text-xs text-neutral-500">No tags yet</span>}
                </div>
                {tagLibrary.length === 0 ? (
                  <p className="text-xs text-neutral-500">Use the + Tag button above to create shared tags.</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {tagLibrary.map((tag) => {
                      const selected = modalDraft.tags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          className={`px-2 py-1 rounded-full border text-xs transition ${
                            selected ? 'border-emerald-500 bg-emerald-900/30 text-emerald-200' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800/60'
                          }`}
                          onClick={() => (selected ? removeTagFromDraft(tag) : addTagToDraft(tag))}
                        >
                          #{tag}
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
    </div>
  );
}

type StatCardProps = { label: string; value: number | string; action?: ReactNode };

function StatCard({ label, value, action }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 shadow-inner shadow-black/30 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-500">
        <span>{label}</span>
        {action}
      </div>
      <div className="text-2xl font-semibold text-neutral-50">{value}</div>
    </div>
  );
}
