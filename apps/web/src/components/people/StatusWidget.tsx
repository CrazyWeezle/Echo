import React from 'react';

export function StatusWidget({
  statusText,
  presence,
  activity,
}: {
  statusText?: string | null;
  presence: 'online' | 'idle' | 'dnd' | 'offline' | 'mobile';
  activity?: string | null;
}) {
  const hasText = !!(statusText && statusText.trim().length);
  // Always show explicit status text if provided, even when offline.
  if (!hasText && presence === 'offline') return null;
  const label = (() => {
    if (hasText) return statusText!.trim();
    if (activity && activity.trim()) return activity.trim();
    if (presence === 'online' || presence === 'mobile') return 'Available';
    if (presence === 'idle') return 'Idle';
    return 'Offline';
  })();
  const color = presence === 'dnd'
    ? 'text-red-400'
    : presence === 'idle'
    ? 'text-amber-400'
    : presence === 'mobile'
    ? 'text-teal-400'
    : presence === 'online'
    ? 'text-emerald-400'
    : 'text-neutral-400';
  return (
    <div
      className={`text-[11px] leading-4 ${color} truncate`}
      title={label}
      role="status"
      aria-label={`Status: ${label}`}
      tabIndex={0}
    >
      {label}
    </div>
  );
}

export default StatusWidget;
