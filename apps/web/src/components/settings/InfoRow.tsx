import React, { useEffect, useRef, useState } from 'react';

export function InfoRow({
  label,
  value,
  type = 'text',
  mask = false,
  onSave,
}: {
  label: string;
  value?: string | null;
  type?: 'text' | 'email' | 'tel';
  mask?: boolean;
  onSave?: (v: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value || ''));
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const timerRef = useRef<number | null>(null);

  useEffect(() => { setVal(String(value || '')); }, [value]);
  useEffect(() => () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } }, []);

  async function handleSave() {
    try {
      setBusy(true); setErr('');
      await onSave?.(val);
      setEditing(false);
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally { setBusy(false); }
  }

  const masked = mask && !revealed ? maskValue(val || value || '') : val || value || '';

  return (
    <div className="flex items-center justify-between rounded-xl border border-border/60 bg-black/30 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        {!editing ? (
          <div className="text-sm text-white truncate">
            {masked || <span className="text-neutral-500">Not set</span>}
            {mask && (
              <button
                type="button"
                className="ml-2 text-xs text-emerald-400 hover:text-emerald-300 underline"
                onClick={() => {
                  setRevealed(true);
                  if (timerRef.current) clearTimeout(timerRef.current);
                  timerRef.current = window.setTimeout(() => setRevealed(false), 5000) as unknown as number;
                }}
                aria-pressed={revealed}
                aria-label={revealed ? 'Hide value' : 'Reveal value'}
              >
                {revealed ? 'Hide' : 'Reveal'}
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 mt-1">
            <input
              className="w-64 max-w-full h-8 px-2 rounded-lg bg-neutral-900 text-white border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              value={val}
              onChange={(e)=>setVal(e.target.value)}
              type={type}
              aria-label={`${label} input`}
            />
            <button disabled={busy} onClick={handleSave} className="h-8 px-3 rounded-lg bg-[var(--echo-accent)] text-[var(--echo-accent-fg)] hover:opacity-95 disabled:opacity-60">Save</button>
            <button disabled={busy} onClick={()=>{ setEditing(false); setVal(String(value||'')); }} className="h-8 px-3 rounded-lg border border-neutral-700 hover:bg-neutral-800/60">Cancel</button>
          </div>
        )}
        {err && <div className="text-xs text-red-400 mt-1">{err}</div>}
      </div>
      {!editing && (
        <button
          type="button"
          className="h-8 px-3 rounded-lg border border-neutral-700 hover:bg-neutral-800/60 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label}`}
        >Edit</button>
      )}
    </div>
  );
}

function maskValue(s: string) {
  if (!s) return '';
  if (s.includes('@')) {
    const [u, d] = s.split('@');
    return `${u.slice(0, 2)}***@${d}`;
  }
  return s.length <= 4 ? '****' : `${s.slice(0, 2)}***${s.slice(-2)}`;
}

export default InfoRow;

