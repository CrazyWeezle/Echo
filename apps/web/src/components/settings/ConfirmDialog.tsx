import { ReactNode, useEffect } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

export default function ConfirmDialog({ open, title, description, confirmText = "Confirm", cancelText = "Cancel", danger, onConfirm, onCancel, children }: ConfirmDialogProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} aria-hidden />
      <div role="dialog" aria-modal className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900 p-4 shadow-2xl mx-4">
        <h2 className="text-lg font-semibold text-white/95">{title}</h2>
        {description ? <p className="mt-1 text-sm text-white/70">{description}</p> : null}
        {children ? <div className="mt-3">{children}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-lg bg-white/10 hover:bg-white/15 text-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" onClick={onCancel}>{cancelText}</button>
          <button className={`rounded-lg ${danger ? "bg-red-500 hover:bg-red-600 focus-visible:ring-red-300" : "bg-emerald-500 hover:bg-emerald-600 focus-visible:ring-emerald-300"} text-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2`} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

