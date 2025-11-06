import React from 'react';

export function AccountBannerCard({
  name,
  username,
  avatarUrl,
  onEdit,
}: {
  name: string;
  username: string;
  avatarUrl?: string | null;
  onEdit?: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 shadow bg-neutral-900/50">
      <div className="h-24 md:h-28 w-full" style={{ background: 'var(--echo-banner)' }} />
      <div className="p-4 md:p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 -mt-10">
            <div className="h-16 w-16 rounded-full border-2 border-neutral-900 overflow-hidden bg-neutral-800 flex items-center justify-center">
              {avatarUrl ? <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" /> : <span className="text-neutral-400 text-sm">No avatar</span>}
            </div>
            <div>
              <div className="text-lg font-semibold text-white">{name}</div>
              <div className="text-sm text-neutral-400">@{username}</div>
              <div className="mt-1 flex items-center gap-1">{/* role/badges area */}</div>
            </div>
          </div>
          <div>
            <button
              className="h-8 px-3 rounded-lg text-sm font-medium border border-emerald-700 bg-[var(--echo-accent)] text-[var(--echo-accent-fg)] hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              onClick={onEdit}
            >
              Edit User Profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AccountBannerCard;

