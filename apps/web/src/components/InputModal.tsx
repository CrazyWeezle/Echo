import { useEffect, useRef, useState } from 'react';

export type InputModalProps = {
  open: boolean;
  title?: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  okText?: string;
  cancelText?: string;
  textarea?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

export default function InputModal({ open, title = 'Input', label, placeholder, initialValue = '', okText = 'Save', cancelText = 'Cancel', textarea = false, onSubmit, onCancel }: InputModalProps) {
  const [val, setVal] = useState(initialValue);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setVal(initialValue || '');
      setTimeout(() => ref.current?.focus(), 10);
    }
  }, [open, initialValue]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-2xl">
        {title && <div className="text-emerald-300 font-semibold mb-2">{title}</div>}
        {label && <label className="block text-xs text-neutral-500 mb-1">{label}</label>}
        {textarea ? (
          <textarea ref={ref as any} rows={4} className="w-full p-2.5 rounded-md bg-neutral-950 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder={placeholder} value={val} onChange={(e)=>setVal(e.target.value)} />
        ) : (
          <input ref={ref as any} className="w-full p-2.5 rounded-md bg-neutral-950 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder={placeholder} value={val} onChange={(e)=>setVal(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); onSubmit(val.trim()); } if(e.key==='Escape'){ e.preventDefault(); onCancel(); } }} />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/70" onClick={onCancel}>{cancelText}</button>
          <button className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={()=>onSubmit(val.trim())}>{okText}</button>
        </div>
      </div>
    </div>
  );
}

