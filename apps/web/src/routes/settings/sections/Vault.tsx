import { useEffect, useMemo, useState } from "react";
import { SettingsModel } from "../../../lib/settings/schema";
import { api } from "../../../lib/api";

export default function VaultSection({ data, bridge }: { data: SettingsModel; bridge: { setDirty: (d:boolean)=>void; setSaveHandler: (fn: (()=>Promise<void>|void)|null)=>void; setResetHandler: (fn:(()=>void)|null)=>void; } }) {
  const [unlocking, setUnlocking] = useState(false);
  const [err, setErr] = useState("");
  const [pwd, setPwd] = useState("");
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    try { const t = Number(sessionStorage.getItem('vault.unlockedUntil')||'0'); return Date.now() < t; } catch { return false; }
  });
  const [hidden, setHidden] = useState<Record<string, boolean>>(()=>{ try { return JSON.parse(localStorage.getItem('hiddenSpaces')||'{}')||{}; } catch { return {}; } });
  const [muted, setMuted] = useState<Record<string, boolean>>(()=>{ try { return JSON.parse(localStorage.getItem('mutedSpaces')||'{}')||{}; } catch { return {}; } });
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>(()=>{ try { return JSON.parse(localStorage.getItem('__echo_spaces_cache__')||'[]')||[]; } catch { return []; } });

  // Capture spaces list opportunistically from window.App if present
  useEffect(() => {
    try {
      const list = (window as any).__echoVoids as any[] | undefined;
      if (Array.isArray(list)) {
        const map = list.filter(v=>!String(v.id).startsWith('dm_')).map(v=>({ id: String(v.id), name: String(v.name||v.id) }));
        setSpaces(map);
        localStorage.setItem('__echo_spaces_cache__', JSON.stringify(map));
      }
    } catch {}
  }, []);

  const vaultIds = useMemo(()=>Object.keys(hidden).filter(k=>hidden[k]), [hidden]);
  const hiddenList = useMemo(()=>{
    const byId: Record<string,string> = Object.fromEntries(spaces.map(s=>[s.id,s.name]));
    return vaultIds.map(id => ({ id, name: byId[id] || id, muted: !!muted[id] }));
  }, [vaultIds, spaces, muted]);

  useEffect(() => { bridge.setDirty(false); }, []);
  useEffect(() => { bridge.setSaveHandler(null); bridge.setResetHandler(null); return () => { bridge.setSaveHandler(null); bridge.setResetHandler(null); }; }, []);

  async function unlock() {
    try {
      setErr(""); setUnlocking(true);
      // Resolve username from local cache; fallback to /users/me
      let username = "";
      try { const raw = localStorage.getItem('user'); if (raw) username = JSON.parse(raw)?.username || ""; } catch {}
      if (!username) {
        try { const tok = localStorage.getItem('token')||''; const me = await api.getAuth('/users/me', tok); username = me?.username || ""; } catch {}
      }
      if (!username) { setErr("Unable to determine username"); setUnlocking(false); return; }
      // Verify credentials via login; do not change UI on error
      await api.post('/auth/login', { username, password: pwd });
      try { sessionStorage.setItem('vault.unlockedUntil', String(Date.now() + 10*60*1000)); } catch {}
      setUnlocked(true);
      setPwd("");
    } catch (e:any) {
      setErr(e?.message || 'Invalid password');
    } finally { setUnlocking(false); }
  }

  function unhide(id: string) {
    const next = { ...hidden }; delete next[id]; setHidden(next);
    try { localStorage.setItem('hiddenSpaces', JSON.stringify(next)); (window as any).dispatchEvent(new CustomEvent('echo:hiddenSpaces', { detail: next })); } catch {}
  }
  function toggleMute(id: string) {
    const next = { ...muted, [id]: !muted[id] };
    setMuted(next);
    try { localStorage.setItem('mutedSpaces', JSON.stringify(next)); (window as any).dispatchEvent(new CustomEvent('echo:mutedSpaces', { detail: next })); } catch {}
  }

  if (!unlocked) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader title="Unlock Vault" description="Enter your account password to view and manage vaulted spaces." />
          <CardBody>
            {err && <div className="mb-2 text-sm text-red-400">{err}</div>}
            <div className="flex items-center gap-2">
              <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} placeholder="Account password" className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />
              <button disabled={unlocking||!pwd} className="shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 text-sm" onClick={unlock}>{unlocking? 'Verifying…':'Unlock'}</button>
            </div>
            <p className="mt-2 text-xs text-white/60">Vault remains unlocked for 10 minutes.</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Spaces Vault" description="Hidden spaces stay quiet and out of your sidebar. Unhide or mute them here." />
        <CardBody>
          {hiddenList.length === 0 ? (
            <div className="text-sm text-neutral-400">No spaces in your vault.</div>
          ) : (
            <ul className="divide-y divide-neutral-800">
              {hiddenList.map(s => (
                <li key={s.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <div className="truncate text-neutral-200">{s.name}</div>
                    <div className="text-xs text-neutral-500 truncate">{s.id}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-neutral-300 flex items-center gap-2">
                      <input type="checkbox" checked={s.muted} onChange={() => toggleMute(s.id)} /> Mute
                    </label>
                    <button className="px-2 py-1 rounded border border-emerald-700 text-emerald-200 hover:bg-emerald-900/30" onClick={() => unhide(s.id)}>Unhide</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <section className="rounded-2xl border border-white/10 bg-black/30 shadow-sm">{children}</section>; }
function CardHeader({ title, description }: { title: string; description?: string }) { return <div className="px-4 pt-4 pb-2"><h2 className="text-base font-semibold text-white">{title}</h2>{description ? <p className="text-sm text-white/60">{description}</p> : null}</div>; }
function CardBody({ children }: { children: React.ReactNode }) { return <div className="px-4 pb-4">{children}</div>; }
