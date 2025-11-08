import React, { useState } from 'react';
import { api, signUpload } from '../../lib/api';
import SectionCard from './SectionCard';
import { registerWebPush, unregisterWebPush } from '../../lib/webpush';
import { initPush as initMobilePush, unregisterPush as unregisterMobilePush } from '../../lib/push';
import { toast } from '../../lib/ui';

export default function NotificationsSection({ token, onSaved }: { token: string; onSaved: (u:any)=>void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [notifEnabled, setNotifEnabled] = useState<boolean>(()=>{ try { return localStorage.getItem('notifEnabled')==='1'; } catch { return false; } });
  const [soundEnabled, setSoundEnabled] = useState<boolean>(()=>{ try { return localStorage.getItem('soundEnabled')!=='0'; } catch { return true; } });
  const [toneUrl, setToneUrl] = useState<string | null>(()=>{ try { return localStorage.getItem('toneUrl')||null; } catch { return null; } });
  const [pushEnabled, setPushEnabled] = useState<boolean>(()=>{ try { return !!localStorage.getItem('webpushEndpoint'); } catch { return false; } });
  const [mobilePushEnabled, setMobilePushEnabled] = useState<boolean>(()=>{ try { return !!localStorage.getItem('pushToken'); } catch { return false; } });
  const isNativeCapacitor = (() => { try { return !!(window as any)?.Capacitor?.Plugins?.PushNotifications; } catch { return false; } })();

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

  // Autosave when settings modal backdrop is clicked
  React.useEffect(() => {
    const onAuto = () => { if (!loading) saveNotifications(); };
    window.addEventListener('settings:autosave' as any, onAuto as any);
    return () => window.removeEventListener('settings:autosave' as any, onAuto as any);
  }, [loading, notifEnabled, soundEnabled, toneUrl]);

  return (
    <div className="space-y-4 fade-in">
      {err && <div className="text-sm text-red-400">{err}</div>}

      <SectionCard title="Desktop Notifications" description="Control in-browser alerts and sounds." noBorder>
        <div className="grid grid-cols-1 gap-3">
          <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-black/20 border border-neutral-800/60">
            <div className="text-sm text-neutral-300">Desktop notifications</div>
            <input type="checkbox" checked={notifEnabled} onChange={async(e)=>{ const on=e.target.checked; setNotifEnabled(on); if(on && 'Notification' in window && Notification.permission!=='granted'){ try{ await Notification.requestPermission(); }catch{} } }} />
          </div>
          <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-black/20 border border-neutral-800/60">
            <div className="text-sm text-neutral-300">Play sound on new message</div>
            <input type="checkbox" checked={soundEnabled} onChange={(e)=>setSoundEnabled(e.target.checked)} />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60"
            onClick={async()=>{
              try {
                if (!('Notification' in window)) { toast('Desktop notifications not supported','error'); return; }
                if (Notification.permission !== 'granted') {
                  const p = await Notification.requestPermission();
                  if (p !== 'granted') { toast('Permission denied','error'); return; }
                }
                new Notification('ECHO', { body: 'Test desktop notification' });
              } catch { toast('Failed to show desktop notification','error'); }
            }}
          >
            Send test desktop
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Web Push (Desktop)" description="Enable OS‑level toasts for this browser, even when the tab is closed." noBorder>
        <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-black/20 border border-neutral-800/60">
          <div className="text-sm text-neutral-300">Web push (this browser)</div>
          <input
            type="checkbox"
            checked={pushEnabled}
            onChange={async(e)=>{
              const targetOn = e.target.checked;
              try {
                if (targetOn) {
                  const vapid = (import.meta as any).env.VITE_VAPID_PUBLIC_KEY as string | undefined;
                  if (!vapid) {
                    setPushEnabled(false);
                    toast('Push not configured: set VITE_VAPID_PUBLIC_KEY','error');
                    return;
                  }
                  // Optimistically reflect the toggle, then confirm
                  setPushEnabled(true);
                  const ok = await registerWebPush(token);
                  if (!ok || !localStorage.getItem('webpushEndpoint')) {
                    setPushEnabled(false);
                    toast('Push permission denied or not supported','error');
                  } else {
                    toast('Push enabled','success');
                  }
                } else {
                  setPushEnabled(false);
                  await unregisterWebPush(token);
                  try { localStorage.removeItem('webpushEndpoint'); } catch {}
                  toast('Push disabled','success');
                }
              } catch {
                // Revert to previous state on unexpected error
                setPushEnabled(!targetOn);
                toast('Push change failed','error');
              }
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={async()=>{ try { await api.postAuth('/push/test', { title:'ECHO', body:'Test push notification', tag:'echo:test', renotify:true, requireInteraction:true, icon:'/brand/ECHO_logo.png', badge:'/brand/ECHO_logo.png', image:'/brand/stacked_72x-01.png', actions:[{ action:'open', title:'Open' }, { action:'mute', title:'Mute' }] }, token); toast('Test push sent','success'); } catch { toast('Test push failed','error'); } }}>Send test push</button>
        </div>
      </SectionCard>

      <SectionCard title="Mobile Notifications" description="Native push for the mobile app (Capacitor builds)." noBorder>
        <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-black/20 border border-neutral-800/60">
          <div className="text-sm text-neutral-300">Enable native push (this device)</div>
          <input
            type="checkbox"
            checked={mobilePushEnabled}
            disabled={!isNativeCapacitor}
            onChange={async(e)=>{
              const on = e.target.checked;
              try {
                if (on) {
                  setMobilePushEnabled(true);
                  await initMobilePush(token);
                  const ok = !!localStorage.getItem('pushToken');
                  if (!ok) { setMobilePushEnabled(false); toast('Mobile push permission denied','error'); }
                  else { toast('Mobile push enabled','success'); }
                } else {
                  setMobilePushEnabled(false);
                  await unregisterMobilePush(token);
                  try { localStorage.removeItem('pushToken'); } catch {}
                  toast('Mobile push disabled','success');
                }
              } catch { setMobilePushEnabled(!on); toast('Mobile push change failed','error'); }
            }}
          />
        </div>
        {!isNativeCapacitor && (
          <div className="mt-2 text-xs text-neutral-500">Install the mobile app to enable native push. This toggle is disabled in the browser.</div>
        )}
      </SectionCard>

      <SectionCard title="Custom Sound" description="Upload an audio file to use for in‑app alerts." noBorder>
        <div className="flex items-center flex-wrap gap-2">
          <input type="file" accept="audio/*" onChange={async (e)=>{ const files=e.target.files; if(!files||files.length===0) return; const f=files[0]; try{ const up=await signUpload({ filename:f.name, contentType:f.type||'audio/mpeg', size:f.size }, token); await fetch(up.url,{ method:'PUT', headers:up.headers, body:f }); setToneUrl(up.publicUrl);} catch{} }} />
          {toneUrl && <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setToneUrl(null)}>Remove</button>}
          <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={async()=>{ try{ const url=toneUrl||''; if(url){ const a=new Audio(url); await a.play(); } else { const ctx=new (window.AudioContext||(window as any).webkitAudioContext)(); const o=ctx.createOscillator(); const g=ctx.createGain(); o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime+0.01); o.start(); o.stop(ctx.currentTime+0.15);} } catch{} }}>Test</button>
        </div>
      </SectionCard>

      <div className="flex items-center justify-end">
        <button disabled={loading} className="px-3 py-2 rounded-lg bg-[var(--echo-accent)] text-[var(--echo-accent-fg)] opacity-90 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-white/10 disabled:opacity-50" onClick={saveNotifications}>{loading?'Saving...':'Save changes'}</button>
      </div>

      <div className="mt-2 text-xs text-neutral-500 leading-5">
        <div>When to use which:</div>
        <div>• Desktop notifications: alerts while the site is open.</div>
        <div>• Web Push: alerts when the tab/app is closed (desktop PWA).</div>
        <div>• Mobile push: alerts from the native app, even when closed.</div>
        <div>• Many enable both Desktop + Web Push; mobile push applies to the mobile app.</div>
      </div>
    </div>
  );
}
