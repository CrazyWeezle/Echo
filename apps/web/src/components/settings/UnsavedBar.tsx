import { ReactNode } from "react";

type UnsavedBarProps = {
  visible: boolean;
  onSave: () => void;
  onReset: () => void;
  saving?: boolean;
  saved?: boolean;
  children?: ReactNode;
};

export default function UnsavedBar({ visible, onSave, onReset, saving, saved, children }: UnsavedBarProps) {
  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed bottom-0 left-0 right-0 z-30 flex justify-center px-3 pb-3 safe-bottom ${visible ? "" : "opacity-0 translate-y-2"}`}
      style={{ transition: "opacity 150ms ease, transform 150ms ease" }}
    >
      <div className="pointer-events-auto rounded-2xl border border-white/10 bg-black/70 backdrop-blur px-3 sm:px-4 py-2.5 shadow-xl flex items-center gap-2">
        <span className="text-sm text-white/90">{saved ? "Saved" : saving ? "Saving…" : "You have unsaved changes"}</span>
        {children}
        <div className="ml-2 flex items-center gap-2">
          <button
            className="rounded-lg bg-white/10 hover:bg-white/15 text-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            onClick={onReset}
          >Reset</button>
          <button
            className="rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            onClick={onSave}
          >Save</button>
        </div>
      </div>
    </div>
  );
}

