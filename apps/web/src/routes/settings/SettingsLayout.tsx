import React, { useState } from 'react';
import Sidebar from '../../components/settings/Sidebar';

export default function SettingsLayout({ children }: { children?: React.ReactNode }) {
  const [current, setCurrent] = useState('account');
  return (
    <div className="h-full grid grid-cols-[260px_1fr] gap-0 text-sm">
      <Sidebar current={current} onSelect={setCurrent} />
      <div className="min-h-0 overflow-auto p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold text-white">Settings</h1>
          <button
            className="h-8 px-3 rounded-lg border border-neutral-700 hover:bg-neutral-800/60"
            onClick={() => history.back()}
            aria-label="Close settings (ESC)"
          >ESC</button>
        </div>
        <div className="space-y-5">
          {children}
        </div>
      </div>
    </div>
  );
}

