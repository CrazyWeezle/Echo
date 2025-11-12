import type { ReactNode } from 'react';

export type ChannelStat = {
  label: string;
  value: string | number;
  hint?: string;
  action?: ReactNode;
};

type ChannelStatsBarProps = {
  stats: ChannelStat[];
};

export default function ChannelStatsBar({ stats }: ChannelStatsBarProps) {
  if (!stats || stats.length === 0) return null;
  return (
    <div className="rounded-2xl border border-neutral-800/70 bg-neutral-950/80 px-3 py-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-400">
        {stats.map((stat) => (
          <div key={stat.label} className="inline-flex items-center gap-2">
            <span className="uppercase tracking-wide">{stat.label}</span>
            <span className="text-sm text-neutral-100 font-semibold">{stat.value}</span>
            {stat.action}
            {stat.hint && <span className="text-[10px] text-neutral-500">{stat.hint}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
