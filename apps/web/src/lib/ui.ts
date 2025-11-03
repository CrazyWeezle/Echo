export type ToastType = 'info' | 'success' | 'error';

export function toast(message: string, type: ToastType = 'info') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('ui:toast', { detail: { message, type } }));
}

export type ConfirmOptions = {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
};

export function askConfirm(opts: ConfirmOptions = {}): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(new CustomEvent('ui:confirm', { detail: { opts, resolve } }));
  });
}

