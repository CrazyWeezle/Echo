import React from 'react';

export default function BottomNav({
  onSpaces,
  onChannels,
  onFriends,
  onSearch,
  onSettings,
  unreadCount,
}: {
  onSpaces: () => void;
  onChannels: () => void;
  onFriends: () => void;
  onSearch: () => void;
  onSettings: () => void;
  unreadCount?: number;
}) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-neutral-950/90 backdrop-blur border-t border-neutral-800">
      <div className="safe-bottom px-2 py-2 grid grid-cols-5 gap-2">
        <button aria-label="Spaces" onClick={onSpaces} className="flex flex-col items-center gap-1 py-2 rounded hover:bg-neutral-800/60">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-neutral-300"><path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>
          <span className="text-[11px] text-neutral-400">Spaces</span>
        </button>
        <button aria-label="Channels" onClick={onChannels} className="flex flex-col items-center gap-1 py-2 rounded hover:bg-neutral-800/60">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-neutral-300"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>
          <span className="text-[11px] text-neutral-400">Channels</span>
        </button>
        <button aria-label="Friends" onClick={onFriends} className="relative flex flex-col items-center gap-1 py-2 rounded hover:bg-neutral-800/60">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-neutral-300"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          {unreadCount && unreadCount>0 && (
            <span className="absolute top-0 right-4 min-w-5 h-5 px-1 rounded-full bg-emerald-600 text-white text-[10px] flex items-center justify-center">{unreadCount>99?'99+':unreadCount}</span>
          )}
          <span className="text-[11px] text-neutral-400">Friends</span>
        </button>
        <button aria-label="Search" onClick={onSearch} className="flex flex-col items-center gap-1 py-2 rounded hover:bg-neutral-800/60">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-neutral-300"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <span className="text-[11px] text-neutral-400">Search</span>
        </button>
        <button aria-label="Settings" onClick={onSettings} className="flex flex-col items-center gap-1 py-2 rounded hover:bg-neutral-800/60">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-neutral-300"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.26 1.3.73 1.77.47.47 1.1.73 1.77.73H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span className="text-[11px] text-neutral-400">Settings</span>
        </button>
      </div>
    </nav>
  );
}

