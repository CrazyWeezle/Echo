import { useEffect, useState } from 'react';

type Toast = { id: number; message: string; type: 'info'|'success'|'error' };

export default function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    function onToast(e: Event) {
      const ce = e as CustomEvent;
      const { message, type } = (ce.detail || {}) as { message: string; type: 'info'|'success'|'error' };
      if (!message) return;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, message, type: type || 'info' }]);
      setTimeout(() => setToasts((t) => t.filter(x => x.id !== id)), 3000);
    }
    window.addEventListener('ui:toast', onToast as any);
    return () => window.removeEventListener('ui:toast', onToast as any);
  }, []);
  return (
    <div className="fixed top-3 right-3 z-[100] space-y-2">
      {toasts.map(t => (
        <div key={t.id} className={`px-3 py-2 rounded border shadow-lg ${
          t.type==='error' ? 'border-red-800 bg-red-900/70 text-red-50' :
          t.type==='success' ? 'border-emerald-800 bg-emerald-900/70 text-emerald-50' :
          'border-neutral-700 bg-neutral-900/80 text-neutral-100'}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

