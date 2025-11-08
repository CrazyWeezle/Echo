import React, { useEffect, useRef } from 'react';

type Presence = 'online' | 'idle' | 'dnd' | 'invisible';

export default function UserQuickSettings({
  open,
  name,
  username,
  avatarUrl,
  presence,
  onClose,
  onOpenSettings,
  onChangePresence,
}: {
  open: boolean;
  name: string;
  username?: string;
  avatarUrl?: string | null;
  presence: Presence;
  onClose: () => void;
  onOpenSettings: () => void;
  onChangePresence: (p: Presence) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Node | null;
      if (!ref.current || !t) return;
      if (!ref.current.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const Item = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick} className="w-full text-left px-3 py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 flex items-center justify-between">
      {children}
    </button>
  );

  const Dot = ({ color }: { color: string }) => (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
  );

  return (
    <div ref={ref} className="fixed bottom-24 left-4 md:left-20 z-50 w-72 max-w-[92vw] select-none">
      <div className="rounded-xl overflow-hidden border border-neutral-800 bg-neutral-950 shadow-2xl">
        <div className="p-3 bg-neutral-900 border-b border-neutral-800 flex items-center gap-3">
          <img src={avatarUrl || undefined} alt={name || 'me'} className="h-10 w-10 rounded-full object-cover bg-neutral-800 border border-neutral-700" />
          <div className="min-w-0">
            <div className="text-neutral-100 font-medium truncate">{name || 'Me'}</div>
            {username ? <div className="text-xs text-neutral-400 truncate">{username}</div> : null}
          </div>
          <button aria-label="Open settings" onClick={onOpenSettings} className="ml-auto text-neutral-300 hover:text-neutral-100">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V22a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 20.17a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3 15.4 1.65 1.65 0 0 0 1.5 14H1.41a2 2 0 1 1 0-4H1.5A1.65 1.65 0 0 0 3 8.6 1.65 1.65 0 0 0 2.17 6.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 3.83 1.65 1.65 0 0 0 9.5 2.5V2.41a2 2 0 1 1 4 0V2.5A1.65 1.65 0 0 0 15.4 3a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21 8.6c.36.5.57 1.11.5 1.77H21.5a2 2 0 1 1 0 4H21.5A1.65 1.65 0 0 0 19.4 15z"/>
            </svg>
          </button>
        </div>
        <div className="p-2 space-y-2">
          <Item onClick={() => onOpenSettings()}>
            <span className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M4 21v-7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v7"/><circle cx="12" cy="7" r="4"/></svg>
              Edit Profile
            </span>
          </Item>
          <div className="rounded-md border border-neutral-800 p-1 bg-neutral-950">
            <div className="px-2 py-1 text-xs text-neutral-400">Status</div>
            <div className="space-y-1">
              <Item onClick={() => onChangePresence('online')}>
                <span className="flex items-center gap-2"><Dot color="bg-emerald-500" /> Online</span>
                {presence==='online' && <span className="text-emerald-400">•</span>}
              </Item>
              <Item onClick={() => onChangePresence('idle')}>
                <span className="flex items-center gap-2"><Dot color="bg-amber-500" /> Idle</span>
                {presence==='idle' && <span className="text-emerald-400">•</span>}
              </Item>
              <Item onClick={() => onChangePresence('dnd')}>
                <span className="flex items-center gap-2"><Dot color="bg-red-500" /> Do not disturb</span>
                {presence==='dnd' && <span className="text-emerald-400">•</span>}
              </Item>
              <Item onClick={() => onChangePresence('invisible')}>
                <span className="flex items-center gap-2"><Dot color="bg-neutral-500" /> Invisible</span>
                {presence==='invisible' && <span className="text-emerald-400">•</span>}
              </Item>
            </div>
          </div>
          {/* Switch Accounts removed */}
          <div className="pt-1 border-t border-neutral-800" />
          <button
            className="w-full text-left px-3 py-2 rounded-md text-red-400 hover:text-red-300"
            onClick={async () => {
              try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
              try { localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('me'); } catch {}
              location.reload();
            }}
          >Log out</button>
        </div>
      </div>
    </div>
  );
}
