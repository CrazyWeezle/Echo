import React, { type CSSProperties } from 'react';

export function AccountBannerCard({
  name,
  username,
  avatarUrl,
  bannerUrl,
  bannerPositionY = 50,
  bannerScale = 100,
  statusText,
  skills,
  showEditButton = true,
  presence,
  pronouns,
  memberSince,
  lastSeen,
  nameColor,
  onEdit,
}: {
  name: string;
  username: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bannerPositionY?: number;
  bannerScale?: number;
  statusText?: string;
  skills?: string[];
  showEditButton?: boolean;
  presence?: 'online'|'idle'|'dnd'|'invisible'|string;
  pronouns?: string;
  memberSince?: string;
  lastSeen?: string;
  nameColor?: string | null;
  onEdit?: () => void;
}) {
  const bannerStyle: CSSProperties | undefined = (() => {
    const u = (bannerUrl || '').trim();
    if (!u) return { background: 'var(--echo-banner)' } as CSSProperties;
    const isGradient = /^(linear-gradient|radial-gradient|conic-gradient)\(/i.test(u);
    const backgroundImage = isGradient ? u : `url("${u}")`;
    return {
      backgroundImage,
      backgroundSize: isGradient ? 'cover' : `${bannerScale}%`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: `center ${bannerPositionY}%`,
    } as CSSProperties;
  })();

  const presenceHex = (() => {
    switch ((presence||'').toLowerCase()) {
      case 'online': return '#10b981'; // emerald-500
      case 'idle': return '#f59e0b';   // amber-500
      case 'dnd': return '#f43f5e';    // rose-500
      case 'invisible': return '#9ca3af'; // neutral-400
      default: return '#9ca3af';
    }
  })();
  const ringShadow = `0 0 0 2px rgba(23,23,23,0.95), 0 0 0 3px ${presenceHex}, 0 0 14px 3px ${presenceHex}66` as const;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-800/60 shadow bg-neutral-900/50">
      <div className="relative h-24 md:h-28 w-full overflow-hidden">
        <div className="absolute inset-0" style={bannerStyle} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/10 to-transparent" />
      </div>
      <div className="p-4 md:p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 mt-3 md:mt-4">
            <div className="relative h-16 w-16 rounded-full overflow-hidden bg-neutral-800 flex items-center justify-center" style={{ boxShadow: ringShadow }}>
              {avatarUrl ? <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" /> : <span className="text-neutral-400 text-sm">No avatar</span>}
            </div>
            <div>
              <div className="text-lg font-semibold text-white" style={nameColor ? { color: nameColor } : undefined}>{name}</div>
              <div className="text-sm text-neutral-400">@{username}</div>
              <div className="mt-1 flex items-center gap-2">
                {pronouns && <span className="px-2 py-0.5 rounded-full text-xs text-neutral-300 bg-neutral-800/60 border border-neutral-700">{pronouns}</span>}
                {/* role/badges area */}
              </div>
              {statusText && (
                <div className="mt-1 text-sm text-neutral-300 line-clamp-2">{statusText}</div>
              )}
              {!!skills?.length && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {skills.slice(0, 8).map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-full border border-neutral-700 text-xs text-neutral-300 bg-neutral-800/60">
                      #{t}
                    </span>
                  ))}
                  {skills.length > 8 && (
                    <span className="text-xs text-neutral-500">+{skills.length - 8} more</span>
                  )}
                </div>
              )}
              {(memberSince || lastSeen) && (
                <div className="mt-2 text-xs text-neutral-400">
                  {memberSince && <span>Member since {memberSince}</span>}
                  {memberSince && lastSeen && <span> • </span>}
                  {lastSeen && <span>Last seen {lastSeen}</span>}
                </div>
              )}
            </div>
          </div>
          <div>
            {showEditButton && onEdit && (
              <button
                className="h-8 px-3 rounded-lg text-sm font-medium border border-[var(--echo-accent)] bg-[var(--echo-accent)] text-[var(--echo-accent-fg)] hover:opacity-95 focus:outline-none accent-ring focus:ring-2"
                onClick={onEdit}
              >
                Edit User Profile
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AccountBannerCard;
