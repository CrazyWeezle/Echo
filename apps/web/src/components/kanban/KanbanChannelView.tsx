import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { askConfirm, toast } from '../../lib/ui';
import type { KanbanItem, KanbanList, KanbanTag } from '../../types/kanban';

type AskInputFn = (cfg: { title?: string; label?: string; placeholder?: string; initialValue?: string; textarea?: boolean; okText?: string }) => Promise<string | null>;

type KanbanChannelViewProps = {
  fid: string;
  lists: KanbanList[];
  mutateLists: (updater: (prev: KanbanList[]) => KanbanList[]) => void;
  channelTags: KanbanTag[];
  mutateTags: (updater: (prev: KanbanTag[]) => KanbanTag[]) => void;
  askInput: AskInputFn;
  currentVoidId: string;
  currentChannelId: string;
  isListFav: (voidId: string, channelId: string, listId: string) => boolean;
  toggleListFav: (voidId: string, channelId: string, listId: string) => void;
};

const TAG_COLOR_PRESETS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#a3a3a3'];

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
};

const showError = (err: unknown, fallback: string) => {
  toast(getErrorMessage(err) || fallback, 'error');
};

function makeRandomId() {
  try {
    const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  } catch {
    /* ignore random UUID errors */
  }
  return Math.random().toString(36).slice(2);
}

function hexToRgb(hex?: string | null) {
  if (!hex) return null;
  let value = hex.trim();
  if (!value.startsWith('#')) value = `#${value}`;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return null;
  if (value.length === 4) {
    value = `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  const num = parseInt(value.slice(1), 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function colorWithAlpha(hex: string, alpha: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return undefined;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

function getReadableTextColor(hex?: string | null) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#111827';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.6 ? '#111827' : '#f9fafb';
}

export default function KanbanChannelView({
  fid,
  lists,
  mutateLists,
  channelTags,
  mutateTags,
  askInput,
  currentVoidId,
  currentChannelId,
  isListFav,
  toggleListFav,
}: KanbanChannelViewProps) {
  const [showAllCompleted, setShowAllCompleted] = useState<Record<string, boolean>>({});
  const [listDrag, setListDrag] = useState<{ dragId?: string; overId?: string; pos?: 'before' | 'after' }>({});
  const [itemDrag, setItemDrag] = useState<{ dragId?: string; overId?: string; pos?: 'before' | 'after'; listId?: string }>({});
  const [tagFilter, setTagFilter] = useState<string>('');
  const [sortByTag, setSortByTag] = useState(false);
  const [tagEditor, setTagEditor] = useState<{ itemId: string; label: string; color: string | null } | null>(null);
  const [channelTagEditor, setChannelTagEditor] = useState<{ id?: string; label: string; color: string } | null>(null);
  const [channelTagSaving, setChannelTagSaving] = useState(false);

  useEffect(() => {
    setShowAllCompleted({});
    setListDrag({});
    setItemDrag({});
    setTagFilter('');
    setSortByTag(false);
    setTagEditor(null);
  }, [fid]);

  useEffect(() => {
    if (!tagEditor) return;
    const exists = lists.some((list) => list.items?.some((item) => item.id === tagEditor.itemId));
    if (!exists) setTagEditor(null);
  }, [tagEditor, lists]);

  const totalCards = useMemo(() => lists.reduce((sum, list) => sum + (list.items?.length || 0), 0), [lists]);
  const completedCards = useMemo(() => lists.reduce((sum, list) => sum + (list.items?.filter((it) => it.done).length || 0), 0), [lists]);
  const activeCards = totalCards - completedCards;
  const uniqueTags = useMemo(
    () =>
      Array.from(
        new Set(
          lists.flatMap((list) =>
            (list.items || [])
              .map((item) => item.tagLabel?.trim() || '')
              .filter(Boolean)
          )
        )
      ).sort((a, b) => a.localeCompare(b)),
    [lists]
  );
  const sortedChannelTags = useMemo(() => {
    return [...channelTags].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }, [channelTags]);
  const dragDisabled = sortByTag || !!tagFilter;

  const handleAddList = async () => {
    const name = await askInput({ title: 'New List', label: 'List name', placeholder: 'To do' });
    if (!name) return;
    try {
      const tok = localStorage.getItem('token') || '';
      await api.postAuth('/kanban/lists', { channelId: fid, name }, tok);
    } catch (err) {
      showError(err, 'Failed to create list');
    }
  };

  const handleAddCard = async (listId: string) => {
    const text = await askInput({ title: 'New Card', label: 'Text', placeholder: 'Do the thing...' });
    if (!text) return;
    try {
      const tok = localStorage.getItem('token') || '';
      await api.postAuth('/kanban/items', { listId, content: text }, tok);
    } catch (err) {
      showError(err, 'Failed to add card');
    }
  };

  const reorderLists = async (orderedIds: string[]) => {
    try {
      const tok = localStorage.getItem('token') || '';
      await api.postAuth('/kanban/lists/reorder', { channelId: fid, listIds: orderedIds }, tok);
    } catch {
      /* best effort */
    }
  };

  const reorderItems = async (listId: string, orderedIds: string[]) => {
    try {
      const tok = localStorage.getItem('token') || '';
      await api.postAuth('/kanban/items/reorder', { listId, itemIds: orderedIds }, tok);
    } catch {
      /* best effort */
    }
  };

  const moveListLocally = (dragListId: string, targetListId: string, position: 'before' | 'after') => {
    let newOrder: string[] = [];
    mutateLists((prev) => {
      const order = prev.map((l) => l.id).filter((id) => id !== dragListId);
      const targetIdx = order.indexOf(targetListId);
      const insertIndex = position === 'after' ? targetIdx + 1 : targetIdx;
      order.splice(insertIndex, 0, dragListId);
      newOrder = order;
      const map = new Map(prev.map((l) => [l.id, l]));
      return order.map((id) => map.get(id)!).filter(Boolean);
    });
    if (newOrder.length) reorderLists(newOrder);
  };

  const moveItemLocally = (itemId: string, targetListId: string, targetItemId?: string, position: 'before' | 'after' = 'before') => {
    mutateLists((prev) => {
      const clone = prev.map((list) => ({ ...list, items: [...(list.items || [])] }));
      let moving: KanbanItem | null = null;
      let fromListId: string | null = null;
      for (const list of clone) {
        const idx = list.items.findIndex((item) => item.id === itemId);
        if (idx !== -1) {
          moving = list.items.splice(idx, 1)[0];
          fromListId = list.id;
          break;
        }
      }
      if (!moving) return prev;
      const targetList = clone.find((list) => list.id === targetListId);
      if (!targetList) return prev;
      if (!targetItemId) {
        targetList.items.push(moving);
      } else {
        let insertIdx = targetList.items.findIndex((item) => item.id === targetItemId);
        if (insertIdx === -1) insertIdx = targetList.items.length;
        if (position === 'after') insertIdx += 1;
        targetList.items.splice(insertIdx, 0, moving);
      }
      (async () => {
        try {
          if (fromListId && fromListId !== targetListId) {
            const source = clone.find((list) => list.id === fromListId);
            if (source) await reorderItems(fromListId, source.items.map((item) => item.id));
          }
          await reorderItems(targetListId, targetList.items.map((item) => item.id));
        } catch {
          /* best effort while syncing order */
        }
      })();
      return clone;
    });
  };

  const updateItemLocal = (itemId: string, updater: (item: KanbanItem) => KanbanItem) => {
    mutateLists((prev) =>
      prev.map((list) => ({
        ...list,
        items: list.items.map((item) => (item.id === itemId ? updater(item) : item)),
      }))
    );
  };

  const handleRenameList = async (listId: string, currentName: string) => {
    const name = await askInput({ title: 'Rename List', initialValue: currentName, label: 'List name' });
    if (!name || name === currentName) return;
    try {
      const tok = localStorage.getItem('token') || '';
      await api.patchAuth('/kanban/lists', { listId, name }, tok);
    } catch (err) {
      showError(err, 'Failed to rename list');
    }
  };

  const handleDeleteList = async (listId: string) => {
    const ok = await askConfirm({ title: 'Delete List', message: 'Delete this list?', confirmText: 'Delete' });
    if (!ok) return;
    try {
      const tok = localStorage.getItem('token') || '';
      await api.deleteAuth('/kanban/lists', { listId }, tok);
    } catch (err) {
      showError(err, 'Failed to delete list');
    }
  };

  const handleToggleDone = async (itemId: string, done: boolean) => {
    updateItemLocal(itemId, (item) => ({ ...item, done }));
    try {
      const tok = localStorage.getItem('token') || '';
      await api.patchAuth('/kanban/items', { itemId, done }, tok);
    } catch (err) {
      showError(err, 'Failed to update card');
    }
  };

  const handleEditCard = async (itemId: string, currentContent: string) => {
    const next = await askInput({ title: 'Edit Card', initialValue: currentContent, label: 'Text' });
    if (!next || next === currentContent) return;
    updateItemLocal(itemId, (item) => ({ ...item, content: next }));
    try {
      const tok = localStorage.getItem('token') || '';
      await api.patchAuth('/kanban/items', { itemId, content: next }, tok);
    } catch (err) {
      showError(err, 'Failed to update card');
    }
  };

  const handleDeleteCard = async (itemId: string) => {
    const ok = await askConfirm({ title: 'Delete Card', message: 'Delete this card?', confirmText: 'Delete' });
    if (!ok) return;
    mutateLists((prev) =>
      prev.map((list) => ({
        ...list,
        items: list.items.filter((item) => item.id !== itemId),
      }))
    );
    try {
      const tok = localStorage.getItem('token') || '';
      await api.deleteAuth('/kanban/items', { itemId }, tok);
    } catch {
      /* best effort */
    }
  };

  const openChannelTagEditor = (tag?: KanbanTag | null) => {
    if (tag) {
      setChannelTagEditor({ id: tag.id, label: tag.label || '', color: tag.color || TAG_COLOR_PRESETS[0] });
    } else {
      setChannelTagEditor({ label: '', color: TAG_COLOR_PRESETS[0] });
    }
  };

  const saveChannelTag = async () => {
    if (!channelTagEditor) return;
    const label = channelTagEditor.label.trim();
    if (!label) {
      toast('Tag name is required', 'error');
      return;
    }
    setChannelTagSaving(true);
    try {
      const tok = localStorage.getItem('token') || '';
      if (channelTagEditor.id) {
        const res = await api.patchAuth('/kanban/tags', { tagId: channelTagEditor.id, label, color: channelTagEditor.color }, tok);
        const tag = (res?.tag as KanbanTag) || { id: channelTagEditor.id, label, color: channelTagEditor.color };
        mutateTags((prev) => prev.map((t) => (t.id === tag.id ? tag : t)));
      } else {
        const res = await api.postAuth('/kanban/tags', { channelId: fid, label, color: channelTagEditor.color }, tok);
        const fallbackId = makeRandomId();
        const tag = (res?.tag as KanbanTag) || { id: fallbackId, label, color: channelTagEditor.color };
        mutateTags((prev) => {
          if (prev.some((t) => t.id === tag.id)) return prev;
          return [...prev, tag];
        });
      }
      setChannelTagEditor(null);
    } catch (err) {
      showError(err, 'Failed to save tag');
    } finally {
      setChannelTagSaving(false);
    }
  };

  const removeChannelTag = async (tagId: string) => {
    const ok = await askConfirm({ title: 'Delete Tag', message: 'Remove this channel tag?', confirmText: 'Delete' });
    if (!ok) return;
    mutateTags((prev) => prev.filter((tag) => tag.id !== tagId));
    try {
      const tok = localStorage.getItem('token') || '';
      await api.deleteAuth('/kanban/tags', { tagId }, tok);
    } catch (err) {
      showError(err, 'Failed to delete tag');
    } finally {
      setChannelTagEditor(null);
    }
  };

  const applyTag = async (itemId: string, label: string, color: string | null) => {
    const trimmed = label.trim();
    updateItemLocal(itemId, (item) => ({ ...item, tagLabel: trimmed || null, tagColor: color }));
    try {
      const tok = localStorage.getItem('token') || '';
      await api.patchAuth('/kanban/items', { itemId, tagLabel: trimmed || null, tagColor: color || null }, tok);
    } catch (err) {
      showError(err, 'Failed to update tag');
    }
  };

  const compareByTag = (a: KanbanItem, b: KanbanItem) => {
    const la = (a.tagLabel || '').toLowerCase();
    const lb = (b.tagLabel || '').toLowerCase();
    if (la === lb) return a.content.localeCompare(b.content);
    if (!la) return 1;
    if (!lb) return -1;
    return la.localeCompare(lb);
  };

  const pendingTagId = channelTagEditor?.id ?? null;
  const openTagEditorForItem = (item: KanbanItem) => {
    const matched = channelTags.find((tag) => tag.label === (item.tagLabel || ''));
    setTagEditor({
      itemId: item.id,
      label: item.tagLabel || '',
      color: matched?.color || item.tagColor || null,
    });
  };

  return (
    <>
      <div className="min-h-full space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard label="Lists" value={lists.length} />
          <StatCard label="Active tasks" value={activeCards} />
          <StatCard label="Completed" value={completedCards} />
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-neutral-100">Channel tags</div>
              <p className="text-xs text-neutral-500">Create shared tags once and reuse them on cards.</p>
            </div>
            <button
              className="inline-flex items-center gap-1 rounded-full border border-emerald-600/50 px-3 py-1 text-sm text-emerald-200 hover:bg-emerald-900/30"
              onClick={() => openChannelTagEditor(null)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New tag
            </button>
          </div>
          {sortedChannelTags.length === 0 ? (
            <p className="text-sm text-neutral-500">No channel tags yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sortedChannelTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: colorWithAlpha(tag.color || '#475569', 0.2),
                    borderColor: tag.color || '#475569',
                    color: getReadableTextColor(tag.color || '#475569'),
                  }}
                >
                  {tag.label}
                  <button
                    className="p-0.5 rounded-full bg-black/20 hover:bg-black/40"
                    title="Edit tag"
                    onClick={() => openChannelTagEditor(tag)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={handleAddList}>+ Add List</button>
          {uniqueTags.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <span>Filter:</span>
              <select
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              >
                <option value="">All tags</option>
                {uniqueTags.map((tag) => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            </label>
          )}
          <button
            className={`rounded-full border px-3 py-1 text-sm transition ${sortByTag ? 'border-emerald-600 text-emerald-200 bg-emerald-500/10' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800/60'}`}
            onClick={() => setSortByTag((prev) => !prev)}
          >
            {sortByTag ? 'Tag sort: On' : 'Tag sort: Off'}
          </button>
          {dragDisabled && <span className="text-xs text-neutral-500">Dragging disabled while filtering or sorting.</span>}
        </div>

        <div className="flex gap-3 overflow-auto pb-2">
        {lists.map((list) => {
          let actives = list.items?.filter((it) => !it.done) ?? [];
          let dones = list.items?.filter((it) => it.done) ?? [];
          if (tagFilter) {
            actives = actives.filter((item) => (item.tagLabel || '') === tagFilter);
            dones = dones.filter((item) => (item.tagLabel || '') === tagFilter);
          }
          if (sortByTag) {
            actives = [...actives].sort(compareByTag);
            dones = [...dones].sort(compareByTag);
          }

          const activeCount = actives.length;
          const doneCount = dones.length;

          return (
            <div
              key={list.id}
              className="relative min-w-[240px] max-w-[280px] bg-neutral-900/60 border border-neutral-800 rounded p-2"
              draggable={!dragDisabled}
              onDragStart={dragDisabled ? undefined : (e) => { e.dataTransfer.setData('text/kan-list', list.id); setListDrag({ dragId: list.id, overId: list.id, pos: 'before' }); }}
              onDragEnd={dragDisabled ? undefined : () => setListDrag({})}
              onDragOver={dragDisabled ? undefined : (e) => e.preventDefault()}
              onDrop={dragDisabled ? undefined : (e) => {
                const dragListId = e.dataTransfer.getData('text/kan-list');
                if (dragListId) {
                  moveListLocally(dragListId, list.id, listDrag.pos === 'after' ? 'after' : 'before');
                  return;
                }
                const itemId = e.dataTransfer.getData('text/kan-item');
                if (!itemId) return;
                moveItemLocally(itemId, list.id);
              }}
              onDragOverCapture={dragDisabled ? undefined : (e) => {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                const before = e.clientX < rect.left + rect.width / 2;
                setListDrag((prev) => ({ ...prev, overId: list.id, pos: before ? 'before' : 'after' }));
              }}
            >
              {listDrag.dragId && listDrag.overId === list.id && (
                <div className="absolute top-0 bottom-0 w-1 bg-sky-500" style={{ pointerEvents: 'none', left: listDrag.pos === 'before' ? -6 : undefined, right: listDrag.pos === 'after' ? -6 : undefined }} />
              )}
              <div className="mb-3 space-y-2">
                <div className="text-center space-y-1">
                  <div className="text-sm font-semibold text-neutral-100 truncate" title={list.name}>{list.name}</div>
                  <div className="text-[11px] uppercase tracking-wide text-neutral-500">
                    {activeCount} active · {doneCount} done
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-neutral-400">
                  <button className="p-1 rounded hover:bg-neutral-800" title="Favorite list" onClick={() => toggleListFav(currentVoidId, currentChannelId, list.id)}>
                    {isListFav(currentVoidId, currentChannelId, list.id) ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-amber-400"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-neutral-400"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                    )}
                  </button>
                  <div className="flex items-center gap-1 text-neutral-300">
                    <button className="px-2 py-0.5 rounded-full hover:bg-neutral-800/60" title="Add Card" onClick={() => handleAddCard(list.id)}>+ Add</button>
                    <button className="p-1 rounded hover:bg-neutral-800" title="Rename" onClick={() => handleRenameList(list.id, list.name)}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>
                    </button>
                    <button className="p-1 rounded text-red-400 hover:bg-red-900/30" title="Delete" onClick={() => handleDeleteList(list.id)}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {actives.map((item) => {
                  const cardStyle = item.tagColor ? { backgroundColor: colorWithAlpha(item.tagColor, 0.15), borderColor: colorWithAlpha(item.tagColor, 0.35) } : undefined;
                  const chipStyle = item.tagColor ? { backgroundColor: item.tagColor, color: getReadableTextColor(item.tagColor) } : undefined;
                  return (
                    <div
                      key={item.id}
                      className="relative p-2 rounded border border-neutral-800 bg-neutral-950/70"
                      style={cardStyle}
                      draggable={!dragDisabled}
                      onDragStart={dragDisabled ? undefined : (e) => { e.dataTransfer.setData('text/kan-item', item.id); setItemDrag({ dragId: item.id, overId: item.id, pos: 'before', listId: list.id }); }}
                      onDragEnd={dragDisabled ? undefined : () => setItemDrag({})}
                      onDragOver={dragDisabled ? undefined : (e) => e.preventDefault()}
                      onDragOverCapture={dragDisabled ? undefined : (e) => {
                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const before = e.clientY < rect.top + rect.height / 2;
                        setItemDrag((prev) => ({ ...prev, overId: item.id, pos: before ? 'before' : 'after', listId: list.id }));
                      }}
                      onDrop={dragDisabled ? undefined : (e) => {
                        const dragItemId = e.dataTransfer.getData('text/kan-item');
                        if (!dragItemId || dragItemId === item.id) return;
                        moveItemLocally(dragItemId, list.id, item.id, itemDrag.pos === 'after' ? 'after' : 'before');
                      }}
                    >
                      {itemDrag.dragId && itemDrag.overId === item.id && (
                        <div className="absolute left-1 right-1 h-1 bg-sky-500" style={{ pointerEvents: 'none', top: itemDrag.pos === 'before' ? -4 : undefined, bottom: itemDrag.pos === 'after' ? -4 : undefined }} />
                      )}
                      <div className="flex items-start gap-2">
                        <input type="checkbox" className="accent-emerald-500" checked={!!item.done} onChange={(e) => handleToggleDone(item.id, e.target.checked)} />
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="text-sm text-neutral-200 whitespace-pre-wrap break-words">{item.content}</div>
                          {item.tagLabel && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={chipStyle}>
                              {item.tagLabel}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-1">
                          <button className="text-xs text-neutral-400 hover:text-neutral-200" title="Edit" onClick={() => handleEditCard(item.id, item.content)}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>
                          </button>
                          <button className="text-xs text-neutral-400 hover:text-emerald-300" title="Tag card" onClick={() => openTagEditorForItem(item)}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21"/><path d="M4.6 9A1.65 1.65 0 0 1 4.27 7.18l-.06-.06a2 2 0 1 0-2.83 2.83l.06.06A1.65 1.65 0 0 1 1.67 11H3"/></svg>
                          </button>
                          <button className="text-xs text-red-400 hover:text-red-300" title="Delete" onClick={() => handleDeleteCard(item.id)}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                          </button>
                        </div>
                      </div>
                      {tagEditor?.itemId === item.id && (
                        <TagEditor
                          editor={tagEditor}
                          channelTags={sortedChannelTags}
                          onChange={(next) => setTagEditor((prev) => (prev?.itemId === item.id ? next : prev))}
                          onCancel={() => setTagEditor(null)}
                          onSave={(label, color) => { applyTag(item.id, label, color); setTagEditor(null); }}
                          onClear={() => { applyTag(item.id, '', null); setTagEditor(null); }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {dones.length > 0 && (
                <div className="mt-3 pt-2 border-t border-neutral-800">
                  <div className="text-xs text-neutral-500 mb-1">Completed</div>
                  <div className="space-y-2">
                    {(showAllCompleted[list.id] ? dones : dones.slice(0, 3)).map((item) => {
                      const cardStyle = item.tagColor ? { backgroundColor: colorWithAlpha(item.tagColor, 0.1), borderColor: colorWithAlpha(item.tagColor, 0.25) } : undefined;
                      const chipStyle = item.tagColor ? { backgroundColor: item.tagColor, color: getReadableTextColor(item.tagColor) } : undefined;
                      return (
                        <div key={item.id} className="p-2 rounded border border-neutral-800 bg-neutral-950/40" style={cardStyle}>
                          <div className="flex items-start gap-2">
                            <input type="checkbox" className="accent-emerald-500" checked onChange={(e) => handleToggleDone(item.id, e.target.checked)} />
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="text-sm text-neutral-400 line-through whitespace-pre-wrap break-words">{item.content}</div>
                              {item.tagLabel && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={chipStyle}>
                                  {item.tagLabel}
                                </span>
                              )}
                            </div>
                            <button className="text-xs text-red-400 hover:text-red-300" title="Delete" onClick={() => handleDeleteCard(item.id)}>
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {dones.length > 3 && (
                      <button className="mt-2 w-full text-xs text-neutral-400 hover:text-neutral-200" onClick={() => setShowAllCompleted((prev) => ({ ...prev, [list.id]: !prev[list.id] }))}>
                        {showAllCompleted[list.id] ? 'Show less' : `View more (${dones.length - 3} more)`}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        </div>
      </div>
      {channelTagEditor && (
        <ChannelTagModal
          draft={channelTagEditor}
          saving={channelTagSaving}
          onChange={setChannelTagEditor}
          onClose={() => setChannelTagEditor(null)}
          onSave={saveChannelTag}
          onDelete={pendingTagId ? () => removeChannelTag(pendingTagId) : undefined}
        />
      )}
    </>
  );
}

function TagEditor({
  editor,
  channelTags = [],
  onChange,
  onCancel,
  onSave,
  onClear,
}: {
  editor: { itemId: string; label: string; color: string | null };
  channelTags?: KanbanTag[];
  onChange: (next: { itemId: string; label: string; color: string | null }) => void;
  onCancel: () => void;
  onSave: (label: string, color: string | null) => void;
  onClear: () => void;
}) {
  const hasTags = channelTags.length > 0;
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-neutral-700 bg-neutral-900/80 p-2">
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Choose a tag</div>
        {hasTags ? (
          <div className="flex flex-wrap gap-2">
            {channelTags.map((tag) => {
              const selected = editor.label === tag.label;
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={`px-3 py-1.5 rounded-full border text-xs font-medium transition ${
                    selected ? 'ring-2 ring-emerald-400/60' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: colorWithAlpha(tag.color || '#475569', selected ? 0.35 : 0.2),
                    borderColor: tag.color || '#475569',
                    color: getReadableTextColor(tag.color || '#475569'),
                  }}
                  onClick={() => onChange({ ...editor, label: tag.label, color: tag.color || null })}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-neutral-500">No channel tags yet. Create one from the Channel tags section.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          className="px-3 py-1 rounded-full bg-emerald-600 text-emerald-50 hover:bg-emerald-500 disabled:opacity-50"
          onClick={() => onSave(editor.label, editor.color)}
          disabled={!hasTags || !editor.label}
        >
          Save
        </button>
        <button className="px-3 py-1 rounded-full border border-neutral-700 text-neutral-200 hover:bg-neutral-800" onClick={onClear}>
          Clear
        </button>
        <button className="px-3 py-1 rounded-full border border-neutral-700 text-neutral-200 hover:bg-neutral-800" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ChannelTagModal({
  draft,
  saving,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: { id?: string; label: string; color: string };
  saving: boolean;
  onChange: (next: { id?: string; label: string; color: string }) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[6000] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={() => { if (!saving) onClose(); }} />
      <div className="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950/90 p-5 shadow-2xl space-y-4">
        <div>
          <div className="text-lg font-semibold text-neutral-100">{draft.id ? 'Edit channel tag' : 'New channel tag'}</div>
          <p className="text-sm text-neutral-500">Give teammates a shared tag to reuse across cards.</p>
        </div>
        <label className="space-y-1 text-sm text-neutral-300">
          <span className="text-xs uppercase tracking-wide text-neutral-500">Label</span>
          <input
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-500 focus:outline-none"
            value={draft.label}
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            placeholder="e.g. High Priority"
            disabled={saving}
          />
        </label>
        <label className="space-y-1 text-sm text-neutral-300">
          <span className="text-xs uppercase tracking-wide text-neutral-500">Color</span>
          <div className="flex items-center gap-3">
            <input
              type="color"
              className="h-10 w-10 rounded border border-neutral-700 bg-transparent"
              value={draft.color}
              onChange={(e) => onChange({ ...draft, color: e.target.value })}
              disabled={saving}
            />
            <div className="flex flex-wrap gap-2">
              {TAG_COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`h-6 w-6 rounded-full border ${draft.color === color ? 'border-white/80' : 'border-white/20'}`}
                  style={{ backgroundColor: color }}
                  onClick={() => onChange({ ...draft, color })}
                  disabled={saving}
                />
              ))}
            </div>
          </div>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          {onDelete && draft.id ? (
            <button
              className="text-sm text-red-400 hover:text-red-200"
              onClick={() => { if (!saving) onDelete(); }}
              disabled={saving}
            >
              Delete tag
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button className="rounded-full border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800" onClick={() => { if (!saving) onClose(); }}>
              Cancel
            </button>
            <button className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm text-emerald-50 hover:bg-emerald-500 disabled:opacity-60" onClick={onSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 shadow-inner shadow-black/30">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-2xl font-semibold text-neutral-50">{value}</div>
    </div>
  );
}
