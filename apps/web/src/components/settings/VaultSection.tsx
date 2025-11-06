import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function VaultSection({ spaces }: { spaces: { id: string; name: string }[] }) {
  return (
    <VaultGate>
      <div className="space-y-4 fade-in">
        <div className="text-emerald-300 font-semibold">Spaces Vault</div>
        <VaultInline spaces={spaces||[]} onUnhide={(id)=>{ try{ const hs=JSON.parse(localStorage.getItem('hiddenSpaces')||'{}')||{}; delete hs[id]; localStorage.setItem('hiddenSpaces', JSON.stringify(hs)); (window as any).dispatchEvent(new CustomEvent('echo:hiddenSpaces', { detail: hs })); } catch{} }} onToggleMute={(id)=>{ try{ const ms=JSON.parse(localStorage.getItem('mutedSpaces')||'{}')||{}; ms[id]=!ms[id]; localStorage.setItem('mutedSpaces', JSON.stringify(ms)); (window as any).dispatchEvent(new CustomEvent('echo:mutedSpaces', { detail: ms })); } catch{} }} />
      </div>
    </VaultGate>
  );
}

function VaultInline({ spaces, onUnhide, onToggleMute }: { spaces: { id: string; name: string }[]; onUnhide: (id:string)=>void; onToggleMute: (id:string)=>void }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>(()=>{ try { return JSON.parse(localStorage.getItem('hiddenSpaces')||'{}')||{}; } catch { return {}; } });
  const [muted, setMuted] = useState<Record<string, boolean>>(()=>{ try { return JSON.parse(localStorage.getItem('mutedSpaces')||'{}')||{}; } catch { return {}; } });
  useEffect(()=>{ const onH=(e:any)=>{ setHidden(e?.detail||{}); }; (window as any).addEventListener('echo:hiddenSpaces', onH); return ()=> (window as any).removeEventListener('echo:hiddenSpaces', onH); },[]);
  useEffect(()=>{ const onM=(e:any)=>{ setMuted(e?.detail||{}); }; (window as any).addEventListener('echo:mutedSpaces', onM); return ()=> (window as any).removeEventListener('echo:mutedSpaces', onM); },[]);
  const list = spaces.filter(s=>hidden[s.id]);
  if (list.length===0) return <div className="text-sm text-neutral-400">No spaces in your vault.</div>;
  return (
    <ul className="space-y-2">
      {list.map(s => (
        <li key={s.id} className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-900/60 p-2">
          <div className="min-w-0">
            <div className="truncate text-neutral-200">{s.name}</div>
            <div className="text-xs text-neutral-500 truncate">{s.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-neutral-300 flex items-center gap-2"><input type="checkbox" checked={!!muted[s.id]} onChange={()=>onToggleMute(s.id)} /> Mute</label>
            <button className="px-2 py-1 rounded border border-emerald-700 text-emerald-200 hover:bg-emerald-900/30" onClick={()=>onUnhide(s.id)}>Unhide</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function VaultGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState<boolean>(()=>{ try { return Date.now() < Number(sessionStorage.getItem('vault.unlockedUntil')||'0'); } catch { return false; } });
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function unlock() {
    try {
      setErr(''); setBusy(true);
      let username = '';
      try { const raw = localStorage.getItem('user'); if (raw) username = JSON.parse(raw)?.username || ''; } catch {}
      if (!username) {
        try { const tok = localStorage.getItem('token')||''; const me = await api.getAuth('/users/me', tok); username = me?.username || ''; } catch {}
      }
      if (!username) { setErr('Unable to determine username'); setBusy(false); return; }
      await api.post('/auth/login', { username, password: pwd });
      try { sessionStorage.setItem('vault.unlockedUntil', String(Date.now() + 10*60*1000)); } catch {}
      setUnlocked(true); setPwd('');
    } catch (e:any) { setErr(e?.message || 'Invalid password'); }
    finally { setBusy(false); }
  }
  if (unlocked) return <>{children}</>;
  return (
    <div className="space-y-4 fade-in">
      <div className="rounded-2xl border border-white/10 bg-black/30 shadow-sm">
        <div className="px-4 pt-4 pb-2"><h2 className="text-base font-semibold text-white">Unlock Vault</h2><p className="text-sm text-white/60">Enter your account password to view Vault. Stays unlocked for 10 minutes.</p></div>
        <div className="px-4 pb-4">
          {err && <div className="mb-2 text-sm text-red-400">{err}</div>}
          <div className="flex items-center gap-2">
            <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} placeholder="Account password" className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />
            <button disabled={busy||!pwd} onClick={unlock} className="shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 text-sm">{busy?'Verifying…':'Unlock'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

