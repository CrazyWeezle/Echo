import React from 'react';
import { User, Shield, KeyRound, Trash2 } from 'lucide-react';

type Item = { id: string; label: string; icon: React.ReactNode };

const ITEMS: Item[] = [
  { id: 'account', label: 'My Account', icon: <User className="h-4 w-4" /> },
  { id: 'security', label: 'Security', icon: <Shield className="h-4 w-4" /> },
  { id: 'keys', label: 'Security Keys', icon: <KeyRound className="h-4 w-4" /> },
  { id: 'danger', label: 'Account Removal', icon: <Trash2 className="h-4 w-4" /> },
];

export function Sidebar({ current, onSelect }: { current: string; onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Settings sections" className="sticky top-0 h-full py-4 pr-3 border-r border-neutral-800/60">
      <ul className="space-y-1">
        {ITEMS.map(it => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onSelect(it.id)}
              className={
                `w-full flex items-center gap-2 px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 ` +
                (current === it.id
                  ? 'bg-neutral-800/70 text-emerald-300'
                  : 'hover:bg-neutral-800/50 text-neutral-300')
              }
              aria-current={current === it.id ? 'true' : undefined}
            >
              <span aria-hidden>{it.icon}</span>
              <span className="text-sm">{it.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default Sidebar;

