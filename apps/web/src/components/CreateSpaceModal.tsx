import React, { useEffect, useMemo, useState } from 'react';

export type CreateSpacePayload = {
  name: string;
  channels: { key: string; name: string; type: 'text' | 'voice' | 'announcement' | string }[];
  homeKey: string; // key of the default/home channel
};

export default function CreateSpaceModal({
  open,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (payload: CreateSpacePayload) => void | Promise<void>;
}) {
  const [spaceName, setSpaceName] = useState('');
  const [busy, setBusy] = useState(false);

  // initial templates
  const templates = useMemo(() => (
    [
      // One template per type
      { key: 'general',       label: 'General',        type: 'text' as const,         defaultOn: true },
      { key: 'announcements', label: 'Announcements',  type: 'announcement' as const, defaultOn: true },
      { key: 'voice',         label: 'Voice',          type: 'voice' as const,        defaultOn: false },
      // Additional types
      { key: 'tasks',         label: 'Tasks',          type: 'kanban' as any,         defaultOn: false },
      { key: 'forms',         label: 'Forms',          type: 'form' as any,           defaultOn: false },
      { key: 'habits',        label: 'Habits',         type: 'habit' as any,          defaultOn: false },
      { key: 'gallery',       label: 'Gallery',        type: 'gallery' as any,        defaultOn: false },
      { key: 'notes',         label: 'Notes',          type: 'notes' as any,          defaultOn: false },
    ]
  ), []);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [homeKey, setHomeKey] = useState<string>('general');

  useEffect(() => {
    if (open) {
      // reset form when opened
      setSpaceName('');
      const init: Record<string, boolean> = {};
      for (const t of templates) init[t.key] = !!t.defaultOn;
      setSelected(init);
      setHomeKey('general');
      setBusy(false);
    }
  }, [open, templates]);

  if (!open) return null;

  const selectedList = templates.filter(t => selected[t.key]);
  const canSubmit = spaceName.trim().length > 0 && selectedList.length > 0 && selected[homeKey];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && onCancel()} />
      <div className="relative w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-4 md:p-5 shadow-2xl">
        <div className="text-neutral-100 text-lg font-semibold mb-3">Create Space</div>

        <div className="mb-4">
          <div className="text-xs text-neutral-400 mb-1">Space name</div>
          <input
            className="w-full h-10 px-3 rounded-md bg-neutral-950 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none accent-ring focus:ring-2"
            placeholder="My Team"
            value={spaceName}
            onChange={(e)=>setSpaceName(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="mb-4">
          <div className="text-xs text-neutral-400 mb-2">Start with these channels</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {templates.map(t => (
              <label key={t.key} className="flex items-center gap-2 p-2 rounded-md border border-neutral-800 bg-neutral-900/60 hover:bg-neutral-900/80">
                <input
                  type="checkbox"
                  className="accent-ring"
                  checked={!!selected[t.key]}
                  onChange={(e)=>{
                    const next = { ...selected, [t.key]: e.target.checked };
                    // ensure at least one channel remains selected
                    if (Object.values(next).some(Boolean)) {
                      setSelected(next);
                      // if we just turned off the current home, move home to first selected
                      if (!next[homeKey]) {
                        const first = templates.find(x => next[x.key]);
                        if (first) setHomeKey(first.key);
                      }
                    }
                  }}
                  disabled={busy}
                />
                <div className="flex-1">
                  <div className="text-neutral-200 text-sm">{t.label}</div>
                  <div className="text-[11px] text-neutral-500">{t.type}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="mb-2">
          <div className="text-xs text-neutral-400 mb-1">Default (Home) channel</div>
          <select
            className="w-full h-10 px-3 rounded-md bg-neutral-950 text-neutral-100 border border-neutral-800 focus:outline-none accent-ring focus:ring-2"
            value={homeKey}
            onChange={(e)=> setHomeKey(e.target.value)}
            disabled={busy}
          >
            {selectedList.map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-neutral-500">Members land here when they open the space.</div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/70" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={async()=>{
              if (!canSubmit || busy) return;
              setBusy(true);
              try {
                const payload: CreateSpacePayload = {
                  name: spaceName.trim(),
                  channels: selectedList.map(t => ({ key: t.key, name: t.label.toLowerCase(), type: t.type })),
                  homeKey,
                };
                await Promise.resolve(onSubmit(payload));
              } finally {
                setBusy(false);
              }
            }}
            disabled={!canSubmit}
          >
            Create Space
          </button>
        </div>
      </div>
    </div>
  );
}
