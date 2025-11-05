import { useEffect, useMemo, useState } from "react";
import SettingRow from "../../../components/settings/SettingRow";
import ConfirmDialog from "../../../components/settings/ConfirmDialog";
import { SettingsModel } from "../../../lib/settings/schema";
import { patchMySettingsSection } from "../../../lib/settings/api";

type Session = { id: string; device: string; lastActive: string };

export default function DevicesSection({ data, bridge }: { data: SettingsModel; bridge: { setDirty: (d:boolean)=>void; setSaveHandler: (fn: (()=>Promise<void>|void)|null)=>void; setResetHandler: (fn:(()=>void)|null)=>void; } }) {
  // In a real app, sessions would come from GET /settings/me or a sub-endpoint.
  const [sessions, setSessions] = useState<Session[]>([ { id: 'this', device: 'This Device', lastActive: 'just now' } ]);
  const [confirmAll, setConfirmAll] = useState(false);

  const dirty = useMemo(() => false, []);
  useEffect(() => { bridge.setDirty(dirty); }, [dirty]);
  useEffect(() => {
    bridge.setSaveHandler(null); // no save in this section
    bridge.setResetHandler(null);
  }, []);

  const revoke = (id: string) => {
    setSessions(s => s.filter(x => x.id !== id));
    // fire-and-forget example (server should revoke)
    patchMySettingsSection("devices", { revoke: id }).catch(()=>{});
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Devices & Sessions" description="Manage signed-in devices." />
        <CardBody>
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                <div>
                  <div className="text-sm text-white">{s.device}</div>
                  <div className="text-xs text-white/60">Last active: {s.lastActive}</div>
                </div>
                {s.id !== 'this' && <button className="rounded-lg bg-white/10 hover:bg-white/15 text-white px-3 py-1.5 text-sm" onClick={()=>revoke(s.id)}>Revoke</button>}
              </div>
            ))}
            {sessions.length === 0 && <div className="text-sm text-white/60">No active sessions.</div>}
          </div>
          <div className="mt-3 flex justify-end">
            <button className="rounded-lg bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 text-sm" onClick={()=>setConfirmAll(true)}>Sign out of all</button>
          </div>
        </CardBody>
      </Card>

      <ConfirmDialog open={confirmAll} danger title="Sign out everywhere?" description="You will be signed out from all devices except this one." confirmText="Sign out" onConfirm={()=>{ setConfirmAll(false); setSessions(s => s.filter(x => x.id === 'this')); patchMySettingsSection('devices', { signOutAll: true }).catch(()=>{}); }} onCancel={()=>setConfirmAll(false)} />
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <section className="rounded-2xl border border-white/10 bg-black/30 shadow-sm">{children}</section>; }
function CardHeader({ title, description }: { title: string; description?: string }) { return <div className="px-4 pt-4 pb-2"><h2 className="text-base font-semibold text-white">{title}</h2>{description ? <p className="text-sm text-white/60">{description}</p> : null}</div>; }
function CardBody({ children }: { children: React.ReactNode }) { return <div className="px-4 pb-4">{children}</div>; }

