import React from 'react';

type NavKey = 'spaces' | 'channels' | 'people' | 'settings';

interface BottomNavProps {
  onSpaces: () => void;
  onChannels: () => void;
  onPeople: () => void;
  onSettings: () => void;
  active?: NavKey | null;
  peopleUnread?: number;
  disableChannels?: boolean;
  disablePeople?: boolean;
}

export default function BottomNav({
  onSpaces,
  onChannels,
  onPeople,
  onSettings,
  active = null,
  peopleUnread = 0,
  disableChannels = false,
  disablePeople = false,
}: BottomNavProps) {
  const baseBtn =
    'group relative flex flex-col items-center gap-1 rounded-2xl py-2 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40';
  const labelCls = 'text-[11px] font-medium tracking-wide';

  const makeClasses = (key: NavKey, disabled?: boolean) => {
    if (disabled) {
      return `${baseBtn} text-neutral-500/50 border border-white/5 cursor-not-allowed`;
    }
    const isActive = active === key;
    return [
      baseBtn,
      'border border-white/5',
      isActive
        ? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
        : 'text-neutral-300 hover:text-white hover:bg-white/5',
    ].join(' ');
  };

  return (
    <nav className="md:hidden fixed inset-x-0 bottom-0 z-40">
      <div className="safe-bottom px-3 pb-3">
        <div className="mx-auto max-w-3xl rounded-[30px] border border-white/10 bg-neutral-950/85 px-3 py-2 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
          <div className="grid grid-cols-4 gap-2">
            <button type="button" aria-label="Spaces" onClick={onSpaces} className={makeClasses('spaces')}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <path d="M9 22V12h6v10" />
              </svg>
              <span className={labelCls}>Spaces</span>
            </button>
            <button
              type="button"
              aria-label="Channels"
              onClick={disableChannels ? undefined : onChannels}
              className={makeClasses('channels', disableChannels)}
              disabled={disableChannels}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M4 6h16" />
                <path d="M4 12h16" />
                <path d="M4 18h16" />
              </svg>
              <span className={labelCls}>Channels</span>
            </button>
            <button
              type="button"
              aria-label="People"
              onClick={disablePeople ? undefined : onPeople}
              className={makeClasses('people', disablePeople)}
              disabled={disablePeople}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {peopleUnread > 0 && (
                <span className="absolute -top-1 right-3 min-w-[18px] rounded-full bg-emerald-600 px-1 text-[10px] font-semibold leading-5 text-white">
                  {peopleUnread > 99 ? '99+' : peopleUnread}
                </span>
              )}
              <span className={labelCls}>People</span>
            </button>
            <button type="button" aria-label="Settings" onClick={onSettings} className={makeClasses('settings')}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V22a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3 15.4 1.65 1.65 0 0 0 1.5 14H1.41a2 2 0 1 1 0-4H1.5A1.65 1.65 0 0 0 3 8.6 1.65 1.65 0 0 0 2.17 6.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 3.83 1.65 1.65 0 0 0 9.5 2.5V2.41a2 2 0 1 1 4 0V2.5A1.65 1.65 0 0 0 15.4 3a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21 8.6c.36.5.57 1.11.5 1.77H21.5a2 2 0 1 1 0 4H21.5A1.65 1.65 0 0 0 19.4 15z" />
              </svg>
              <span className={labelCls}>Settings</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
