import React from 'react';
import StatusWidget from './StatusWidget';

export type UserRowData = {
  id: string;
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  nameColor?: string | null;
  status?: string | null; // mini status text (from bio first line)
  rawStatus?: string | null; // user's presence mode: 'online' | 'mobile' | 'idle' | 'dnd' | 'invisible' | 'offline'
  online?: boolean;
  onMobile?: boolean;
  activityText?: string | null; // e.g., "Active 5m ago"
};

export function UserRow({ data, onClick }: { data: UserRowData; onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void }) {
  const { name, username, avatarUrl, nameColor, status, rawStatus, online, onMobile, activityText } = data;
  const presence: 'online'|'mobile'|'idle'|'dnd'|'offline' = (rawStatus === 'invisible' || rawStatus === 'offline')
    ? 'offline'
    : (rawStatus === 'dnd')
      ? 'dnd'
      : (rawStatus === 'idle')
        ? 'idle'
        : (online ? (onMobile ? 'mobile' : 'online') : 'offline');
  // Prefer the user's own local "What I'm up to" message if this row is for me
  const displayStatus = (() => {
    try {
      const raw = localStorage.getItem('user');
      const me = raw ? JSON.parse(raw) : null;
      if (me && me.id && data?.id && String(me.id) === String(data.id)) {
        const act = localStorage.getItem('profile.activity') || '';
        if (act && String(act).trim()) return String(act).trim();
      }
    } catch {}
    return status || null;
  })();
  return (
    <div className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-neutral-800/40">
      <button className="flex-1 text-left flex items-center gap-2" onClick={onClick} aria-label={`Open profile for ${name || username}`}>
        <div className="relative h-8 w-8">
          {(() => {
            // No presence ring for offline or invisible
            // Teal for mobile-online, Emerald for desktop-online
            const ring = (presence==='mobile') ? '#14b8a6' : (presence==='online') ? '#10b981' : (presence==='idle') ? '#f59e0b' : (presence==='dnd') ? '#ef4444' : null;
            return ring ? (<span className="pointer-events-none absolute -inset-0.5 rounded-full" style={{ border: `2px solid ${ring}`, boxShadow: `0 0 10px ${ring}` }}></span>) : null;
          })()}
          <div className="h-8 w-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
            {avatarUrl ? <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover"/> : <span className="text-[10px] text-neutral-400">{(name?.[0]||username?.[0]||'?').toUpperCase()}</span>}
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-neutral-200 text-sm" style={nameColor ? { color: String(nameColor) } : undefined}>
            <span className="font-semibold">{name || username}</span>
            {/* presence dot removed; glowing ring indicates online */}
          </div>
          <StatusWidget statusText={displayStatus} presence={presence} activity={activityText || null} />
        </div>
      </button>
    </div>
  );
}

export default UserRow;
