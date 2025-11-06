import React from 'react';

export default function MemberProfileModal(props: {
  token: string;
  userId: string;
  open: boolean;
  onClose: () => void;
  onStartDm: (userId: string) => void;
  spaceId?: string;
}) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={props.onClose} />
      <div className="relative w-full max-w-2xl rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl overflow-hidden">
        <div className="p-4 text-neutral-200">Profile temporarily unavailable</div>
      </div>
    </div>
  );
}

