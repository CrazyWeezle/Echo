import { useEffect, useMemo, useState } from "react";
import SettingRow from "../../../components/settings/SettingRow";
import { SettingsModel } from "../../../lib/settings/schema";
import { patchMySettingsSection } from "../../../lib/settings/api";

export default function PrivacySection({ data, bridge }: { data: SettingsModel; bridge: { setDirty: (d:boolean)=>void; setSaveHandler: (fn: (()=>Promise<void>|void)|null)=>void; setResetHandler: (fn:(()=>void)|null)=>void; } }) {
  const initial = { ...data.privacy };
  const [profileVisibility, setProfileVisibility] = useState(initial.profileVisibility);
  const [dmPermissions, setDmPermissions] = useState(initial.dmPermissions);
  const [readReceipts, setReadReceipts] = useState(initial.readReceipts);

  const dirty = useMemo(() => profileVisibility !== initial.profileVisibility || dmPermissions !== initial.dmPermissions || readReceipts !== initial.readReceipts, [profileVisibility, dmPermissions, readReceipts]);
  useEffect(() => { bridge.setDirty(dirty); }, [dirty]);
  useEffect(() => {
    bridge.setSaveHandler(async () => { await patchMySettingsSection("privacy", { profileVisibility, dmPermissions, readReceipts }); });
    bridge.setResetHandler(() => { setProfileVisibility(initial.profileVisibility); setDmPermissions(initial.dmPermissions); setReadReceipts(initial.readReceipts); });
    return () => { bridge.setSaveHandler(null); bridge.setResetHandler(null); };
  }, [profileVisibility, dmPermissions, readReceipts]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Privacy & Security" description="Visibility and messaging controls." />
        <CardBody>
          <SettingRow label="Profile visibility" control={<Select value={profileVisibility} onChange={setProfileVisibility} options={[{ value:'everyone', label:'Everyone' }, { value:'friends', label:'Friends' }, { value:'private', label:'Only me' }]} />} />
          <div className="h-2" />
          <SettingRow label="DM permissions" control={<Select value={dmPermissions} onChange={setDmPermissions} options={[{ value:'everyone', label:'Everyone' }, { value:'friends', label:'Friends' }, { value:'none', label:'No one' }]} />} />
          <div className="h-2" />
          <SettingRow label="Read receipts" control={<Switch checked={readReceipts} onChange={setReadReceipts} />} />
        </CardBody>
      </Card>
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

function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v:T)=>void; options: { value: T; label: string }[] }) {
  return (
    <select value={value} onChange={e=>onChange(e.target.value as T)} className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

