import React, { useEffect, useRef, useState } from 'react';
import { api, signUpload } from '../../lib/api';
import { askConfirm } from '../../lib/ui';

type Channel = { id: string; name: string; type?: string };

export default function SpaceGeneralSection({
  token,
  spaceId,
  spaceName,
  spaceAvatarUrl,
  spaceHomeChannelId,
  channels,
  onRefreshSpaces,
  onRefreshChannels,
  onSwitchToChannel,
  onSpaceDeleted,
}: {
  token: string;
  spaceId: string;
  spaceName?: string;
  spaceAvatarUrl?: string | null;
  spaceHomeChannelId?: string | null;
  channels: Channel[];
  onRefreshSpaces: () => void;
  onRefreshChannels: (spaceId: string) => void;
  onSwitchToChannel: (channelId: string) => void;
  onSpaceDeleted: () => void;
}) {
  const isDmSpace = String(spaceId||'').startsWith('dm_');
  const [sName, setSName] = useState(spaceName||'');
  const [sAvatarUrl, setSAvatarUrl] = useState<string|null>(spaceAvatarUrl||null);
  const [sHome, setSHome] = useState<string>(spaceHomeChannelId || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(()=>{ setSName(spaceName||''); setSAvatarUrl(spaceAvatarUrl||null); },[spaceName, spaceAvatarUrl]);

  async function saveSpaceGeneral(){ setBusy(true); setErr(''); try{ const homeChannelId = sHome || null; await api.patchAuth('/spaces',{ spaceId, name:sName, avatarUrl:sAvatarUrl, homeChannelId }, token); onRefreshSpaces(); } catch(e:any){ setErr(e?.message||'Failed to save'); } finally{ setBusy(false);} }
  async function pickSpaceImage(files: FileList|null){ if(!files||files.length===0) return; const f=files[0]; try{ const up=await signUpload({ filename:f.name, contentType:f.type||'application/octet-stream', size:f.size }, token); await fetch(up.url,{method:'PUT', headers:up.headers, body:f}); setSAvatarUrl(up.publicUrl);} catch(e:any){ setErr(e?.message||'Upload failed'); } finally{ if(fileRef.current) fileRef.current.value=''; } }
  async function deleteSpace(){ const ok = await askConfirm({ title:'Delete Space', message:'Delete this space?', confirmText:'Delete' }); if(!ok) return; setBusy(true); setErr(''); try{ await api.deleteAuth('/spaces',{ spaceId }, token); onSpaceDeleted(); onRefreshSpaces(); } catch(e:any){ setErr(e?.message||'Failed to delete'); } finally{ setBusy(false);} }

  return (
    <div className="space-y-4">
      <div className="text-emerald-300 font-semibold">Space</div>
      {err && <div className="text-sm text-red-400">{err}</div>}

      {!isDmSpace && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 shadow-sm space-y-3">
          <div className="text-neutral-300 font-semibold">Owner Settings</div>
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
              {sAvatarUrl ? <img src={sAvatarUrl} alt="space" className="h-full w-full object-cover" /> : <span className="text-neutral-500">No image</span>}
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>fileRef.current?.click()}>Upload</button>
              {sAvatarUrl && <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setSAvatarUrl(null)}>Remove</button>}
              <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e=>pickSpaceImage(e.target.files)} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Name</label>
            <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={sName} onChange={e=>setSName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Home channel</label>
            <select value={sHome} onChange={(e)=>setSHome(e.target.value)} className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60">
              <option value="">(none ? remember last opened)</option>
              {channels.map(c => (<option key={c.id} value={c.id}>#{c.name || c.id}</option>))}
            </select>
            <p className="mt-1 text-xs text-neutral-500">If set, members opening this space land on the selected channel.</p>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={busy} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={saveSpaceGeneral}>{busy?'Saving...':'Save changes'}</button>
            <div className="ml-auto flex items-center gap-2">
              <button disabled={busy} className="px-3 py-2 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={deleteSpace}>Delete space</button>
            </div>
          </div>
        </section>
      )}

      {/* My preferences (auto-saved via localStorage) */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 shadow-sm space-y-3">
        <div className="text-neutral-300 font-semibold">My Preferences</div>
        <div className="flex items-center justify-between">
          <label className="text-sm text-neutral-300">Mute notifications for this space</label>
          <input type="checkbox" defaultChecked={(()=>{ try { const ms = JSON.parse(localStorage.getItem('mutedSpaces')||'{}'); return !!ms[spaceId]; } catch { return false; } })()} onChange={(e)=>{ try { const ms = JSON.parse(localStorage.getItem('mutedSpaces')||'{}'); ms[spaceId] = !!e.target.checked; localStorage.setItem('mutedSpaces', JSON.stringify(ms)); (window as any).dispatchEvent(new CustomEvent('echo:mutedSpaces', { detail: ms })); } catch {} }} />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-sm text-neutral-300">Hide this space (move to Vault)</label>
          <input type="checkbox" defaultChecked={(()=>{ try { const hs = JSON.parse(localStorage.getItem('hiddenSpaces')||'{}'); return !!hs[spaceId]; } catch { return false; } })()} onChange={(e)=>{ try { const hs = JSON.parse(localStorage.getItem('hiddenSpaces')||'{}'); if (e.target.checked) hs[spaceId] = true; else delete hs[spaceId]; localStorage.setItem('hiddenSpaces', JSON.stringify(hs)); (window as any).dispatchEvent(new CustomEvent('echo:hiddenSpaces', { detail: hs })); } catch {} }} />
        </div>
      </section>
    </div>
  );
}

