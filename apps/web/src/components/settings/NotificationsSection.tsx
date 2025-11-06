import React, { useState } from 'react';
import { api, signUpload } from '../../lib/api';
import { registerWebPush, unregisterWebPush } from '../../lib/webpush';
import { toast } from '../../lib/ui';

export default function NotificationsSection({ token, onSaved }: { token: string; onSaved: (u:any)=>void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [notifEnabled, setNotifEnabled] = useState<boolean>(()=>{ try { return localStorage.getItem('notifEnabled')==='1'; } catch { return false; } });
  const [soundEnabled, setSoundEnabled] = useState<boolean>(()=>{ try { return localStorage.getItem('soundEnabled')!=='0'; } catch { return true; } });
  const [toneUrl, setToneUrl] = useState<string | null>(()=>{ try { return localStorage.getItem('toneUrl')||null; } catch { return null; } });

  async function saveNotifications(){
    setLoading(true); setErr('');
    try {
      const u = await api.patchAuth('/users/me', { toneUrl }, token);
      try{
        localStorage.setItem('notifEnabled', notifEnabled?'1':'0');
        localStorage.setItem('soundEnabled', soundEnabled?'1':'0');
        if(toneUrl) localStorage.setItem('toneUrl', toneUrl); else localStorage.removeItem('toneUrl');
      } catch {}
      onSaved(u);
    } catch(e:any) { setErr(e?.message||'Failed to save'); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-3">
      <div className="text-emerald-300 font-semibold">Notifications</div>
      {err && <div className="text-sm text-red-400">{err}</div>}
      <div className="flex items-center justify-between">
        <label className="text-sm text-neutral-300">Desktop notifications</label>
        <input type="checkbox" checked={notifEnabled} onChange={async(e)=>{ const on=e.target.checked; setNotifEnabled(on); if(on && 'Notification' in window && Notification.permission!=='granted'){ try{ await Notification.requestPermission(); }catch{} } }} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-sm text-neutral-300">Push notifications (this device)</label>
        <input
          type="checkbox"
          defaultChecked={(() => { try { return !!localStorage.getItem('webpushEndpoint'); } catch { return false; } })()}
          onChange={async(e)=>{
            try {
              if (e.target.checked) { await registerWebPush(token); toast('Push enabled','success'); }
              else { await unregisterWebPush(token); try { localStorage.removeItem('webpushEndpoint'); } catch {}; toast('Push disabled','success'); }
            } catch { toast('Push change failed','error'); }
          }}
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-sm text-neutral-300">Play sound on new message</label>
        <input type="checkbox" checked={soundEnabled} onChange={(e)=>setSoundEnabled(e.target.checked)} />
      </div>
      <div className="flex items-center gap-2">
        <label className="block text-sm text-neutral-400">Custom tone</label>
        <input type="file" accept="audio/*" onChange={async (e)=>{ const files=e.target.files; if(!files||files.length===0) return; const f=files[0]; try{ const up=await signUpload({ filename:f.name, contentType:f.type||'audio/mpeg', size:f.size }, token); await fetch(up.url,{ method:'PUT', headers:up.headers, body:f }); setToneUrl(up.publicUrl);} catch{} }} />
        {toneUrl && <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setToneUrl(null)}>Remove</button>}
        <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={async()=>{ try{ const url=toneUrl||''; if(url){ const a=new Audio(url); await a.play(); } else { const ctx=new (window.AudioContext||(window as any).webkitAudioContext)(); const o=ctx.createOscillator(); const g=ctx.createGain(); o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime+0.01); o.start(); o.stop(ctx.currentTime+0.15);} } catch{} }}>Test</button>
        <button className="ml-2 px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={async()=>{ try { await api.postAuth('/push/test', { title:'ECHO', body:'Test notification' }, token); toast('Test push sent','success'); } catch { toast('Test push failed','error'); } }}>Send test push</button>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={loading} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={saveNotifications}>{loading?'Saving...':'Save'}</button>
      </div>
    </div>
  );
}

