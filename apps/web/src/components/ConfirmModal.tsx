type Props = {
  open: boolean;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal({ open, title='Confirm', message='', confirmText='Confirm', cancelText='Cancel', onConfirm, onCancel }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-2xl">
        {title && <div className="text-emerald-300 font-semibold mb-2">{title}</div>}
        {message && <div className="text-neutral-200 text-sm whitespace-pre-wrap">{message}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/70" onClick={onCancel}>{cancelText}</button>
          <button className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
