import { useEffect, useMemo, useState } from "react";
import SettingRow from "../../../components/settings/SettingRow";
import { SettingsModel } from "../../../lib/settings/schema";
import { patchMySettingsSection } from "../../../lib/settings/api";

export default function IntegrationsSection({ data, bridge }: { data: SettingsModel; bridge: { setDirty: (d:boolean)=>void; setSaveHandler: (fn: (()=>Promise<void>|void)|null)=>void; setResetHandler: (fn:(()=>void)|null)=>void; } }) {
  const initial = { ...data.integrations };
  const [githubConnected, setGithubConnected] = useState(!!initial.githubConnected);
  const [notionConnected, setNotionConnected] = useState(!!initial.notionConnected);
  const dirty = useMemo(() => githubConnected !== !!initial.githubConnected || notionConnected !== !!initial.notionConnected, [githubConnected, notionConnected]);
  useEffect(() => { bridge.setDirty(dirty); }, [dirty]);
  useEffect(() => {
    bridge.setSaveHandler(async () => { await patchMySettingsSection("integrations", { githubConnected, notionConnected }); });
    bridge.setResetHandler(() => { setGithubConnected(!!initial.githubConnected); setNotionConnected(!!initial.notionConnected); });
    return () => { bridge.setSaveHandler(null); bridge.setResetHandler(null); };
  }, [githubConnected, notionConnected]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Integrations" description="Connect your tools." />
        <CardBody>
          <SettingRow label="GitHub" control={<ConnectRow connected={githubConnected} onConnect={()=>setGithubConnected(true)} onDisconnect={()=>setGithubConnected(false)} />} />
          <div className="h-2" />
          <SettingRow label="Notion" control={<ConnectRow connected={notionConnected} onConnect={()=>setNotionConnected(true)} onDisconnect={()=>setNotionConnected(false)} />} />
        </CardBody>
      </Card>
    </div>
  );
}

function ConnectRow({ connected, onConnect, onDisconnect }: { connected: boolean; onConnect: ()=>void; onDisconnect: ()=>void }) {
  return connected ? (
    <div className="flex items-center gap-3">
      <span className="inline-flex items-center rounded-full bg-emerald-500/20 text-emerald-300 px-2 py-1 text-xs">Connected</span>
      <button className="rounded-lg bg-white/10 hover:bg-white/15 text-white px-3 py-1.5 text-sm" onClick={onDisconnect}>Disconnect</button>
    </div>
  ) : (
    <button className="rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 text-sm" onClick={onConnect}>Connect</button>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <section className="rounded-2xl border border-white/10 bg-black/30 shadow-sm">{children}</section>; }
function CardHeader({ title, description }: { title: string; description?: string }) { return <div className="px-4 pt-4 pb-2"><h2 className="text-base font-semibold text-white">{title}</h2>{description ? <p className="text-sm text-white/60">{description}</p> : null}</div>; }
function CardBody({ children }: { children: React.ReactNode }) { return <div className="px-4 pb-4">{children}</div>; }

