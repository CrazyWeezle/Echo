import React, { useEffect, useRef, useState } from 'react';
import { api, signUpload } from '../../lib/api';
import { askConfirm } from '../../lib/ui';

export default function DmInfoSection({ token, spaceId, spaceName, spaceAvatarUrl, onSwitchToChannel }: {
  token: string;
  spaceId: string;
  spaceName?: string;
  spaceAvatarUrl?: string | null;
  onSwitchToChannel: (channelId: string) => void;
}) {
  const [sName, setSName] = useState(spaceName||'');
  const [sAvatarUrl, setSAvatarUrl] = useState<string|null>(spaceAvatarUrl||null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickImage(files: FileList|null){ if(!files||files.length===0) return; const f=files[0]; try{ const up=await signUpload({ filename:f.name, contentType:f.type||'application/octet-stream', size:f.size }, token); await fetch(up.url,{method:'PUT', headers:up.headers, body:f}); setSAvatarUrl(up.publicUrl);} catch(e:any){ setErr(e?.message||'Upload failed'); } finally{ if(fileRef.current) fileRef.current.value=''; } }

  async function save(){ setBusy(true); setErr(''); try{ await api.patchAuth('/spaces',{ spaceId, name:sName, avatarUrl:sAvatarUrl }, token); } catch(e:any){ setErr(e?.message||'Failed to save'); } finally{ setBusy(false);} }

  return (
    <div className="space-y-4">
      {err && <div className="text-sm text-red-400">{err}</div>}
      <div className="text-emerald-300 font-semibold">Direct Message</div>
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
          {sAvatarUrl ? <img src={sAvatarUrl} alt="dm" className="h-full w-full object-cover" /> : <span className="text-neutral-500">No image</span>}
        </div>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>fileRef.current?.click()}>Upload</button>
          {sAvatarUrl && <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setSAvatarUrl(null)}>Remove</button>}
          <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e=>pickImage(e.target.files)} />
        </div>
      </div>
      <div>
        <label className="block text-sm text-neutral-400 mb-1">DM Name</label>
        <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={sName} onChange={e=>setSName(e.target.value)} />
        <p className="mt-1 text-xs text-neutral-500">Either participant can update this name and image.</p>
      </div>
      <DmParticipants spaceId={spaceId} token={token} />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-neutral-300">Mute notifications for this DM</label>
          <input type="checkbox" defaultChecked={(()=>{ try { const ms = JSON.parse(localStorage.getItem('mutedSpaces')||'{}'); return !!ms[spaceId]; } catch { return false; } })()} onChange={(e)=>{ try { const ms = JSON.parse(localStorage.getItem('mutedSpaces')||'{}'); ms[spaceId] = !!e.target.checked; localStorage.setItem('mutedSpaces', JSON.stringify(ms)); (window as any).dispatchEvent(new CustomEvent('echo:mutedSpaces', { detail: ms })); } catch {} }} />
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-2 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={async()=>{
            const ok = await askConfirm({ title:'Clear History', message:'Delete ALL messages in this DM for both participants?', confirmText:'Clear all' });
            if (!ok) return; setBusy(true); setErr('');
            try { await api.postAuth('/dms/clear', { spaceId }, token); onSwitchToChannel(`${spaceId}:chat`); }
            catch(e:any){ setErr(e?.message||'Failed to clear'); }
            finally { setBusy(false); }
          }}>Clear all</button>
          <div className="flex items-center gap-2 ml-4">
            <label className="text-sm text-neutral-400">Clear last</label>
            <input id="dmClearDays" type="number" min={1} max={3650} defaultValue={7} className="w-20 p-1 rounded bg-neutral-900 text-neutral-100 border border-neutral-700" />
            <span className="text-sm text-neutral-400">days</span>
            <button className="px-3 py-2 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={async()=>{
              const el = document.getElementById('dmClearDays') as HTMLInputElement | null;
              const n = el ? Math.max(1, Math.min(3650, parseInt(el.value||'7',10))) : 7;
              const ok = await askConfirm({ title:'Clear Recent Messages', message:`Delete messages from the last ${n} day(s) in this DM?`, confirmText:'Clear recent' });
              if (!ok) return; setBusy(true); setErr('');
              try { await api.postAuth('/dms/clear', { spaceId, days: n }, token); onSwitchToChannel(`${spaceId}:chat`); }
              catch(e:any){ setErr(e?.message||'Failed to clear'); }
              finally { setBusy(false); }
            }}>Clear last N days</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={busy} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={save}>{busy?'Saving...':'Save changes'}</button>
          <div className="ml-auto flex items-center gap-2">
            <button disabled={busy} className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={async()=>{ const ok=await askConfirm({ title:'Leave DM', message:'Leave this DM?', confirmText:'Leave' }); if(!ok) return; setBusy(true); setErr(''); try{ await api.postAuth('/spaces/leave',{ spaceId }, token); } catch(e:any){ setErr(e?.message||'Failed to leave'); } finally{ setBusy(false);} }}>Leave DM</button>
          </div>
        </div>
      </div>
    </div>
  );
}

type Member = { id: string; name?: string; username?: string; avatarUrl?: string | null }
function DmParticipants({ spaceId, token }: { spaceId: string; token: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    (async () => {
      try { const res = await api.getAuth(`/spaces/members?spaceId=${encodeURIComponent(spaceId)}`, token); setMembers(res.members || []); } catch {}
    })();
  }, [spaceId, token]);
  return (
    <div>
      <div className="text-sm text-neutral-400 mb-1">Participants</div>
      <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
        {members.map(m => (
          <li key={m.id} className="flex items-center gap-2 px-3 py-2">
            <div className="h-7 w-7 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
              {m.avatarUrl ? <img src={m.avatarUrl} alt={m.name||m.username} className="h-full w-full object-cover"/> : <span className="text-[10px] text-neutral-400">{(m.name?.[0]||m.username?.[0]||'?').toUpperCase()}</span>}
            </div>
            <div className="truncate">{m.name || m.username}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

