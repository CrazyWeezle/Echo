import { useEffect, useMemo, useState } from "react";
import SettingRow from "../../../components/settings/SettingRow";
import { SettingsModel } from "../../../lib/settings/schema";
import { patchMySettingsSection } from "../../../lib/settings/api";

export default function NotificationsSection({ data, bridge }: { data: SettingsModel; bridge: { setDirty: (d:boolean)=>void; setSaveHandler: (fn: (()=>Promise<void>|void)|null)=>void; setResetHandler: (fn:(()=>void)|null)=>void; } }) {
  const initial = { ...data.notifications };
  const [globalMute, setGlobalMute] = useState(initial.globalMute);
  const [perChannelDefault, setPerChannelDefault] = useState(initial.perChannelDefault);
  const [desktop, setDesktop] = useState(initial.desktop);
  const [mobile, setMobile] = useState(initial.mobile);
  const [digest, setDigest] = useState(initial.digest);

  const dirty = useMemo(() => globalMute !== initial.globalMute || perChannelDefault !== initial.perChannelDefault || desktop !== initial.desktop || mobile !== initial.mobile || digest !== initial.digest, [globalMute, perChannelDefault, desktop, mobile, digest]);
  useEffect(() => { bridge.setDirty(dirty); }, [dirty]);
  useEffect(() => {
    bridge.setSaveHandler(async () => { await patchMySettingsSection("notifications", { globalMute, perChannelDefault, desktop, mobile, digest }); });
    bridge.setResetHandler(() => { setGlobalMute(initial.globalMute); setPerChannelDefault(initial.perChannelDefault); setDesktop(initial.desktop); setMobile(initial.mobile); setDigest(initial.digest); });
    return () => { bridge.setSaveHandler(null); bridge.setResetHandler(null); };
  }, [globalMute, perChannelDefault, desktop, mobile, digest]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Notifications" description="Control alerts and digests." />
        <CardBody>
          <SettingRow label="Global mute" control={<Switch checked={globalMute} onChange={setGlobalMute} />} />
          <div className="h-2" />
          <SettingRow label="Per-channel default" control={<Select value={perChannelDefault} onChange={setPerChannelDefault} options={[{ value: 'all', label:'All' }, { value:'mentions', label:'Mentions' }, { value:'none', label:'None' }]} />} />
          <div className="h-2" />
          <SettingRow label="Desktop notifications" control={<Switch checked={desktop} onChange={setDesktop} />} />
          <div className="h-2" />
          <SettingRow label="Mobile notifications" control={<Switch checked={mobile} onChange={setMobile} />} />
          <div className="h-2" />
          <SettingRow label="Digest frequency" control={<Select value={digest} onChange={setDigest} options={[{ value: 'off', label:'Off' }, { value:'daily', label:'Daily' }, { value:'weekly', label:'Weekly' }]} />} />
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

