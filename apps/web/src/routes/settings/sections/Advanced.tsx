import { useEffect, useMemo, useState } from "react";
import SettingRow from "../../../components/settings/SettingRow";
import ConfirmDialog from "../../../components/settings/ConfirmDialog";
import { SettingsModel } from "../../../lib/settings/schema";
import { patchMySettingsSection } from "../../../lib/settings/api";

export default function AdvancedSection({ data, bridge }: { data: SettingsModel; bridge: { setDirty: (d:boolean)=>void; setSaveHandler: (fn: (()=>Promise<void>|void)|null)=>void; setResetHandler: (fn:(()=>void)|null)=>void; } }) {
  const initial = { ...data.advanced };
  const [developerLogs, setDeveloperLogs] = useState(initial.developerLogs);
  const [confirmExport, setConfirmExport] = useState(false);
  const [confirmCache, setConfirmCache] = useState(false);

  const dirty = useMemo(() => developerLogs !== initial.developerLogs, [developerLogs]);
  useEffect(() => { bridge.setDirty(dirty); }, [dirty]);
  useEffect(() => {
    bridge.setSaveHandler(async () => { await patchMySettingsSection("advanced", { developerLogs }); });
    bridge.setResetHandler(() => { setDeveloperLogs(initial.developerLogs); });
    return () => { bridge.setSaveHandler(null); bridge.setResetHandler(null); };
  }, [developerLogs]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Advanced" description="Power tools and data." />
        <CardBody>
          <SettingRow label="Developer logs" control={<Switch checked={developerLogs} onChange={setDeveloperLogs} />} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Data" />
        <CardBody>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg bg-white/10 hover:bg-white/15 text-white px-3 py-1.5 text-sm" onClick={()=>setConfirmExport(true)}>Export data</button>
            <button className="rounded-lg bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 text-sm" onClick={()=>setConfirmCache(true)}>Reset app cache</button>
          </div>
        </CardBody>
      </Card>

      <ConfirmDialog open={confirmExport} title="Export your data?" description="We will prepare your data for download." confirmText="Export" onConfirm={()=>{ setConfirmExport(false); patchMySettingsSection('advanced', { export: true }).catch(()=>{}); }} onCancel={()=>setConfirmExport(false)} />
      <ConfirmDialog open={confirmCache} danger title="Reset app cache?" description="Local cache will be cleared and the app will reload." confirmText="Reset" onConfirm={()=>{ setConfirmCache(false); localStorage.clear(); location.reload(); }} onCancel={()=>setConfirmCache(false)} />
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <section className="rounded-2xl border border-white/10 bg-black/30 shadow-sm">{children}</section>; }
function CardHeader({ title, description }: { title: string; description?: string }) { return <div className="px-4 pt-4 pb-2"><h2 className="text-base font-semibold text-white">{title}</h2>{description ? <p className="text-sm text-white/60">{description}</p> : null}</div>; }
function CardBody({ children }: { children: React.ReactNode }) { return <div className="px-4 pb-4">{children}</div>; }

function Switch({ checked, onChange }: { checked: boolean; onChange: (v:boolean)=>void }) { return (
  <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors focus:outline-none focus-visible:ring-2 ${checked ? "bg-emerald-500" : "bg-white/20"}`}>
    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
  </button>
); }

