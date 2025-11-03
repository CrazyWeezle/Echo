import { useEffect, useState } from 'react';
import ConfirmModal from './ConfirmModal';

type Pending = {
  opts: { title?: string; message?: string; confirmText?: string; cancelText?: string };
  resolve: (v: boolean) => void;
} | null;

export default function ConfirmHost() {
  const [pending, setPending] = useState<Pending>(null);
  useEffect(() => {
    function onConfirm(e: Event) {
      const ce = e as CustomEvent;
      const { opts, resolve } = ce.detail || {};
      if (!resolve) return;
      setPending({ opts: opts || {}, resolve });
    }
    window.addEventListener('ui:confirm', onConfirm as any);
    return () => window.removeEventListener('ui:confirm', onConfirm as any);
  }, []);
  if (!pending) return null;
  return (
    <ConfirmModal
      open={true}
      title={pending.opts.title}
      message={pending.opts.message}
      confirmText={pending.opts.confirmText}
      cancelText={pending.opts.cancelText}
      onConfirm={() => { pending.resolve(true); setPending(null); }}
      onCancel={() => { pending.resolve(false); setPending(null); }}
    />
  );
}

