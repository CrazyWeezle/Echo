import React from 'react';

export function SectionCard({ title, description, children, destructive, noBorder }: { title: string; description?: string; children?: React.ReactNode; destructive?: boolean; noBorder?: boolean }) {
  const colorClasses = destructive
    ? (noBorder ? 'bg-red-950/30' : 'border border-red-800/60 bg-red-950/30')
    : (noBorder ? 'bg-black/30' : 'border border-neutral-800/60 bg-black/30');
  return (
    <section className={`rounded-2xl shadow ${colorClasses} p-4 md:p-5 fade-in`}>
      <header className="mb-3">
        <h3 className={`text-sm font-semibold ${destructive ? 'text-red-300' : 'text-white'}`}>{title}</h3>
        {description && <p className={`text-xs mt-0.5 ${destructive ? 'text-red-200/80' : 'text-muted-foreground'}`}>{description}</p>}
      </header>
      <div>{children}</div>
    </section>
  );
}

export default SectionCard;
