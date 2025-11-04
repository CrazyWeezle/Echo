import React from 'react';
import data from '@emoji-mart/data';
// @ts-ignore
import Picker from '@emoji-mart/react';

export default function EmojiPanel({ onSelect, onClose }: { onSelect: (native: string) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="absolute right-4 bottom-20" onClick={(e)=>e.stopPropagation()}>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl">
          <Picker data={data} onEmojiSelect={(e: any)=>{ try { onSelect(e?.native || ''); } finally { onClose(); } }} theme="dark" previewPosition="none" perLine={8} />
        </div>
      </div>
    </div>
  );
}

