import { ReactNode } from "react";

type SettingRowProps = {
  label: string;
  htmlFor?: string;
  hint?: string;
  tooltip?: string;
  control: ReactNode;
};

export default function SettingRow({ label, htmlFor, hint, tooltip, control }: SettingRowProps) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="min-w-44 max-w-60 pr-2">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-white/90">
          {label}
          {tooltip ? (
            <span className="ml-2 text-xs text-white/50" aria-label={tooltip} title={tooltip}>ⓘ</span>
          ) : null}
        </label>
        {hint ? <p className="mt-0.5 text-xs text-white/55">{hint}</p> : null}
      </div>
      <div className="flex-1 min-w-0">
        {control}
      </div>
    </div>
  );
}

