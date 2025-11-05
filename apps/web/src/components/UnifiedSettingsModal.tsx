import React, { useEffect, useRef, useState } from 'react';
import { api, signUpload } from '../lib/api';
import { askConfirm, toast } from '../lib/ui';
import ChangePassword from './ChangePassword';
import { registerWebPush, unregisterWebPush } from '../lib/webpush';

type Channel = { id: string; name: string; type?: 'text' | 'voice' | 'announcement' | string };

export default function UnifiedSettingsModal({
  token,
  spaceId,
  spaceName,
  spaceAvatarUrl,
  spaceHomeChannelId,
  channels,
  open,
  onClose,
  onRefreshSpaces,
  onRefreshChannels,
  onSwitchToChannel,
  onSpaceDeleted,
  onJoinSpace,
  onUserSaved,
}: {
  token: string;
  spaceId: string;
  spaceName?: string;
  spaceAvatarUrl?: string | null;
  spaceHomeChannelId?: string | null;
  channels: Channel[];
  open: boolean;
  onClose: () => void;
  onRefreshSpaces: () => void;
  onRefreshChannels: (spaceId: string) => void;
  onSwitchToChannel: (channelId: string) => void;
  onSpaceDeleted: () => void;
  onJoinSpace: (spaceId: string) => void;
  onUserSaved: (u: any) => void;
}) {
  const [tab, setTab] = useState<'profile'|'notifications'|'personalization'|'security'|'space-general'|'space-channels'|'space-members'|'space-invites'|'dm-info'>(() => {
    try {
      const t = localStorage.getItem('settingsTab');
      if (t === 'profile' || t === 'notifications' || t === 'personalization' || t === 'security' || t === 'space-general' || t === 'space-channels' || t === 'space-members' || t === 'space-invites' || t === 'dm-info') return t as any;
    } catch {}
    return 'profile';
  });
  useEffect(() => { try { localStorage.setItem('settingsTab', tab); } catch {} }, [tab]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [showChangePwd, setShowChangePwd] = useState(false);

  // Profile
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('online');
  const [nameColor, setNameColor] = useState<string>('');
  const [pronouns, setPronouns] = useState<string>('');
  const [website, setWebsite] = useState<string>('');
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true); setErr('');
        const u = await api.getAuth('/users/me', token);
        setName(u.name||'');
        setBio(u.bio||'');
        setAvatarUrl(u.avatarUrl||null);
        setStatus(u.status||'online');
        setNameColor(u.nameColor||'');
        setPronouns(u.pronouns||'');
        setWebsite(u.website||'');
      }
      catch (e:any) { setErr(e?.message || 'Failed to load profile'); }
      finally { setLoading(false); }
    })();
  }, [open, token]);
  async function onAvatarPick(files: FileList | null) {
    if (!files || files.length === 0) return; const f = files[0];
    try { const up = await signUpload({ filename:f.name, contentType:f.type||'application/octet-stream', size:f.size }, token); await fetch(up.url,{method:'PUT', headers:up.headers, body:f}); setAvatarUrl(up.publicUrl); }
    catch (e:any) { setErr(e?.message||'Upload failed'); }
  }
  async function saveProfile(){
    setLoading(true); setErr('');
    try{
      const payload:any = { name, bio, avatarUrl, status, pronouns, website };
      const c = String(nameColor||'').trim(); payload.nameColor = c ? c : null;
      const u=await api.patchAuth('/users/me', payload, token);
      try{
        const raw=localStorage.getItem('user'); const prev = raw?JSON.parse(raw):{};
        localStorage.setItem('user', JSON.stringify({ ...prev, name: u?.name, avatarUrl: u?.avatarUrl ?? null, status: u?.status || prev?.status, nameColor: u?.nameColor ?? null, pronouns: u?.pronouns ?? prev?.pronouns, website: u?.website ?? prev?.website }));
        if(u?.nameColor) localStorage.setItem('nameColor', u.nameColor); else localStorage.removeItem('nameColor');
      }catch{}
      onUserSaved(u);
    } catch(e:any) { setErr(e?.message||'Failed to save'); }
    finally { setLoading(false); }
  }

  // Notifications
  const [notifEnabled, setNotifEnabled] = useState<boolean>(()=>{ try { return localStorage.getItem('notifEnabled')==='1'; } catch { return false; } });
  const [soundEnabled, setSoundEnabled] = useState<boolean>(()=>{ try { return localStorage.getItem('soundEnabled')!=='0'; } catch { return true; } });
  const [toneUrl, setToneUrl] = useState<string | null>(()=>{ try { return localStorage.getItem('toneUrl')||null; } catch { return null; } });
  async function saveNotifications(){ setLoading(true); setErr(''); try{ const u=await api.patchAuth('/users/me',{ toneUrl }, token); try{ localStorage.setItem('notifEnabled', notifEnabled?'1':'0'); localStorage.setItem('soundEnabled', soundEnabled?'1':'0'); if(toneUrl) localStorage.setItem('toneUrl', toneUrl); else localStorage.removeItem('toneUrl'); }catch{} onUserSaved(u);} catch(e:any){ setErr(e?.message||'Failed to save'); } finally{ setLoading(false);} }

  // Personalization: friend indicator color + toggle
  const [friendRingColor, setFriendRingColor] = useState<string>(() => {
    try { const raw = localStorage.getItem('user'); if (raw) { const u = JSON.parse(raw); if (u?.friendRingColor) return String(u.friendRingColor); } const f = localStorage.getItem('friendRingColor'); return f || '#34d399'; } catch { return '#34d399'; }
  });
  const [friendRingEnabled, setFriendRingEnabled] = useState<boolean>(() => {
    try { const raw = localStorage.getItem('user'); if (raw) { const u = JSON.parse(raw); if (typeof u?.friendRingEnabled === 'boolean') return !!u.friendRingEnabled; } const f = localStorage.getItem('friendRingEnabled'); if (f==='0') return false; if (f==='1') return true; } catch {}
    return true;
  });
  async function savePersonalization(){
    setLoading(true); setErr('');
    try {
      const u = await api.patchAuth('/users/me', { friendRingColor: String(friendRingColor||'').trim() || null, friendRingEnabled: !!friendRingEnabled }, token);
      try {
        const raw = localStorage.getItem('user'); const prev = raw ? JSON.parse(raw) : {};
        localStorage.setItem('user', JSON.stringify({ ...prev, friendRingColor: u.friendRingColor ?? prev.friendRingColor, friendRingEnabled: typeof u.friendRingEnabled==='boolean' ? u.friendRingEnabled : (prev.friendRingEnabled ?? true) }));
        if (u.friendRingColor) localStorage.setItem('friendRingColor', u.friendRingColor);
        localStorage.setItem('friendRingEnabled', (typeof u.friendRingEnabled==='boolean' ? u.friendRingEnabled : true) ? '1' : '0');
      } catch {}
      onUserSaved(u);
    } catch (e:any) {
      setErr(e?.message || 'Failed to save');
    } finally { setLoading(false); }
  }

  // Space
  const [sName, setSName] = useState(spaceName||'');
  const [sAvatarUrl, setSAvatarUrl] = useState<string|null>(spaceAvatarUrl||null);
  const [sHome, setSHome] = useState<string>(spaceHomeChannelId || '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(()=>{ if(open){ setSName(spaceName||''); setSAvatarUrl(spaceAvatarUrl||null); setErr(''); } },[open, spaceName, spaceAvatarUrl]);
  async function saveSpaceGeneral(){ setBusy(true); setErr(''); try{ const homeChannelId = sHome || null; await api.patchAuth('/spaces',{ spaceId, name:sName, avatarUrl:sAvatarUrl, homeChannelId }, token); onRefreshSpaces(); } catch(e:any){ setErr(e?.message||'Failed to save'); } finally{ setBusy(false);} }
  async function pickSpaceImage(files: FileList|null){ if(!files||files.length===0) return; const f=files[0]; try{ const up=await signUpload({ filename:f.name, contentType:f.type||'application/octet-stream', size:f.size }, token); await fetch(up.url,{method:'PUT', headers:up.headers, body:f}); setSAvatarUrl(up.publicUrl);} catch(e:any){ setErr(e?.message||'Upload failed'); } finally{ if(fileRef.current) fileRef.current.value=''; } }
  async function deleteSpace(){ const ok = await askConfirm({ title:'Delete Space', message:'Delete this space?', confirmText:'Delete' }); if(!ok) return; setBusy(true); setErr(''); try{ await api.deleteAuth('/spaces',{ spaceId }, token); onSpaceDeleted(); onRefreshSpaces(); onClose(); } catch(e:any){ setErr(e?.message||'Failed to delete'); } finally{ setBusy(false);} }
  async function leaveSpace(){ const ok = await askConfirm({ title:'Leave Space', message:'Leave this space?', confirmText:'Leave' }); if(!ok) return; setBusy(true); setErr(''); try{ await api.postAuth('/spaces/leave',{ spaceId }, token); onSpaceDeleted(); onRefreshSpaces(); onClose(); } catch(e:any){ setErr(e?.message||'Failed to leave'); } finally{ setBusy(false);} }
  // Space Members management (owner only actions)
  type SpaceMember = { id: string; name?: string; username?: string; avatarUrl?: string | null; role?: string };
  const [spaceMembers, setSpaceMembers] = useState<SpaceMember[]>([]);
  const [selfId, setSelfId] = useState<string>('');
  const isDmSpace = String(spaceId||'').startsWith('dm_');
  const isOwner = !isDmSpace && (spaceMembers.find(m => m.id === selfId)?.role === 'owner');
  useEffect(() => { if (!open) return; (async()=>{ try{ const me=await api.getAuth('/users/me', token); if(me?.id) setSelfId(me.id); }catch{} })(); }, [open, token]);
  useEffect(() => { if (!open || isDmSpace) return; (async()=>{ try{ const res=await api.getAuth(`/spaces/members?spaceId=${encodeURIComponent(spaceId)}`, token); setSpaceMembers(res.members||[]); }catch{} })(); }, [open, token, spaceId, isDmSpace]);
  async function removeMember(uid: string){ const ok = await askConfirm({ title:'Remove Member', message:'Remove this user from this space?', confirmText:'Remove' }); if(!ok) return; setBusy(true); setErr(''); try{ await api.deleteAuth('/spaces/members', { spaceId, userId: uid }, token); setSpaceMembers(prev=>prev.filter(x=>x.id!==uid)); } catch(e:any){ setErr(e?.message||'Failed to remove member'); } finally{ setBusy(false);} }
  const [newChan, setNewChan] = useState('');
  const [newChanType, setNewChanType] = useState<'text'|'voice'|'announcement'|'kanban'|'form'|'habit'|'gallery'|'notes'>('text');
  async function addChannel(){ const nm=newChan.trim(); if(!nm) return; setBusy(true); setErr(''); try{ const res=await api.postAuth('/channels',{ spaceId, name:nm, type:newChanType }, token); setNewChan(''); setNewChanType('text'); onRefreshChannels(spaceId); onSwitchToChannel(res.id);} catch(e:any){ setErr(e?.message||'Failed to create channel'); } finally{ setBusy(false);} }
  async function removeChannel(cid:string){ const ok = await askConfirm({ title:'Delete Channel', message:'Delete this channel?', confirmText:'Delete' }); if(!ok) return; setBusy(true); setErr(''); try{ await api.postAuth('/channels/delete',{ spaceId, channelId: cid }, token); onRefreshChannels(spaceId);} catch(e:any){ setErr(e?.message||'Failed to delete'); } finally{ setBusy(false);} }
  // sleek input modal helper
  const [inOpen, setInOpen] = useState(false);
  const inResolve = useRef<((v:string|null)=>void)|null>(null);
  const [inCfg, setInCfg] = useState<{ title?: string; label?: string; initialValue?: string; placeholder?: string }>({});
  function ask(cfg:{ title?: string; label?: string; initialValue?: string; placeholder?: string }): Promise<string|null> { setInCfg(cfg); setInOpen(true); return new Promise((res)=>{ inResolve.current = res; }); }
  function closeAsk(val:string|null){ setInOpen(false); const r=inResolve.current; inResolve.current=null; if(r) r(val); }

  async function renameChannel(cid:string){ const nm=await ask({ title:'Rename channel', label:'New name' }); if(!nm) return; setBusy(true); setErr(''); try{ await api.postAuth('/channels/rename',{ spaceId, channelId: cid, name: nm }, token); onRefreshChannels(spaceId);} catch(e:any){ setErr(e?.message||'Failed to rename'); } finally{ setBusy(false);} }
  const [maxUses, setMaxUses] = useState<number>(1);
  const [expires, setExpires] = useState<string>('');
  const [inviteCode, setInviteCode] = useState<string>('');
  const [customCode, setCustomCode] = useState<string>('');
  async function createInvite(){
    setBusy(true); setErr('');
    try{
      const hours = expires.trim()===''?undefined:Number(expires)||undefined;
      const codeIn = customCode.trim();
      if (!codeIn) { setErr('Please enter an invite code'); return; }
      const { code } = await api.postAuth('/spaces/invite',{ spaceId, maxUses, expiresInHours: hours, code: codeIn }, token);
      setInviteCode(code);
      try { await navigator.clipboard.writeText(code); } catch {}
    } catch(e:any){ setErr(e?.message||'Failed to create invite'); }
    finally{ setBusy(false); }
  }
  const [joinCode, setJoinCode] = useState<string>('');
  async function acceptInvite(){ const code=joinCode.trim(); if(!code) return; setBusy(true); setErr(''); try{ const { spaceId: sid } = await api.postAuth('/invites/accept',{ code }, token); onJoinSpace(sid); setJoinCode(''); onClose(); } catch(e:any){ setErr(e?.message||'Failed to accept invite'); } finally{ setBusy(false);} }

  // close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full md:w-[calc(100%-1rem)] md:max-w-3xl h-[85vh] md:h-auto rounded-t-2xl md:rounded-2xl bg-neutral-900/90 backdrop-blur-md ring-1 ring-emerald-900/40 shadow-2xl flex flex-col md:flex-row overflow-hidden">
        <button aria-label="Close" title="Close" className="absolute top-2 right-2 text-neutral-400 hover:text-neutral-200 px-2 py-1" onClick={onClose}>✕</button>
        <div className="hidden md:flex w-56 border-r border-neutral-800 p-3 flex-col min-h-0 overflow-auto bg-gradient-to-b from-neutral-900/60 to-neutral-900/30 gap-1">
          <div className="text-xs uppercase tracking-wide text-neutral-400 px-1 pb-1">Settings</div>
          <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='profile'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('profile')}>Profile</button>
          <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='notifications'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('notifications')}>Notifications</button>
          <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='personalization'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('personalization')}>Personalization</button>
          <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='security'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('security')}>Security</button>
          <div className="text-xs uppercase tracking-wide text-neutral-500 px-1 pt-3 pb-1">Space</div>
          {String(spaceId).startsWith('dm_') ? (
            <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='dm-info'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('dm-info')}>
              DM Info
            </button>
          ) : (
            <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='space-general'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('space-general')}>
              {spaceName || 'General'}
            </button>
          )}
          {!String(spaceId).startsWith('dm_') && (
            <>
              <button className={`w-full text left px-3 py-2 rounded-md transition-colors ${tab==='space-channels'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('space-channels')}>Channels</button>
              <button className={`w-full text left px-3 py-2 rounded-md transition-colors ${tab==='space-members'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('space-members')}>Members</button>
              <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='space-invites'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('space-invites')}>Invites</button>
            </>
          )}
          <div className="mt-auto pt-2 border-t border-neutral-800"></div>
        </div>
        <div className="flex-1 p-4 md:p-6 space-y-5 overflow-auto min-h-0">
          {/* Mobile tab bar */}
          <div className="md:hidden sticky top-0 z-10 -mx-4 px-4 py-2 bg-neutral-900/90 backdrop-blur border-b border-neutral-800 flex gap-2 overflow-auto">
            {(['profile','notifications','personalization','security'] as const).map(t => (
              <button key={t} className={`px-3 py-1 rounded-full text-sm border ${tab===t ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200' : 'border-neutral-700 text-neutral-300'}`} onClick={()=>setTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
            ))}
            <span className="mx-2 text-neutral-600">|</span>
            {String(spaceId).startsWith('dm_') ? (
              <button className={`px-3 py-1 rounded-full text-sm border ${tab==='dm-info' ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200' : 'border-neutral-700 text-neutral-300'}`} onClick={()=>setTab('dm-info')}>DM</button>
            ) : (
              ['space-general','space-channels','space-members','space-invites'].map((t:any) => (
                <button key={t} className={`px-3 py-1 rounded-full text-sm border ${tab===t ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200' : 'border-neutral-700 text-neutral-300'}`} onClick={()=>setTab(t)}>{String(t).replace('space-','').replace(/^./,c=>c.toUpperCase())}</button>
              ))
            )}
          </div>
          {err && <div className="text-sm text-red-400">{err}</div>}

          {tab==='personalization' && (
            <div className="space-y-5 fade-in">
              <div>
                <div className="text-emerald-300 font-semibold">Themes</div>
                <p className="text-sm text-neutral-400 mb-2">Choose an accent theme. This updates brand gradients and accent colors across the app.</p>
                <ThemeSelector />
              </div>
              <div>
                <div className="text-emerald-300 font-semibold mb-2">Friend Indicator</div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-neutral-300">Show friend indicator ring</label>
                  <input type="checkbox" checked={friendRingEnabled} onChange={(e)=>setFriendRingEnabled(e.target.checked)} />
                </div>
                <div className="flex items-center gap-3">
                  <input type="color" value={(function(){ const c=String(friendRingColor||'').trim(); return /^#([0-9a-fA-F]{6})$/.test(c)?c:'#34d399'; })()} onChange={(e)=>setFriendRingColor(e.target.value)} className="h-9 w-12 bg-neutral-900 border border-neutral-800 rounded cursor-pointer" title="Pick a color" />
                  <input className="flex-1 p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="#34d399 or 'teal'" value={friendRingColor} onChange={(e)=>setFriendRingColor(e.target.value)} />
                  <div className="text-sm flex items-center gap-2">
                    <span className="inline-block h-6 w-6 rounded-full relative">
                      <span className="absolute -inset-0.5 rounded-full" style={{ border: `2px solid ${friendRingColor || '#34d399'}`, boxShadow: `0 0 8px ${friendRingColor || '#34d399'}` }}></span>
                      <span className="absolute inset-0 rounded-full bg-neutral-800 border border-neutral-700"></span>
                    </span>
                    Preview
                  </div>
                </div>
                <div className="mt-3">
                  <button disabled={loading} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={savePersonalization}>{loading?'Saving…':'Save personalization'}</button>
                </div>
              </div>
            </div>
          )}

          {tab==='profile' && (
            <div className="space-y-4 fade-in">
              <div className="text-emerald-300 font-semibold">Profile</div>
              {/* Avatar block */}
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 rounded-full overflow-hidden border border-neutral-700 bg-neutral-800 flex items-center justify-center">
                  {avatarUrl ? <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover"/> : <span className="text-neutral-500">No avatar</span>}
                </div>
                <label className="px-2 py-1 rounded border border-neutral-800 text-neutral-300 hover:bg-neutral-800/60 cursor-pointer text-sm">
                  <input type="file" accept="image/*" className="hidden" onChange={e=>onAvatarPick(e.target.files)} />
                  Change avatar
                </label>
                {avatarUrl && <button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={()=>setAvatarUrl(null)}>Remove</button>}
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Or paste image URL</label>
                <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="https://example.com/avatar.png" value={avatarUrl||''} onChange={e=>setAvatarUrl(e.target.value.trim()||null)} />
              </div>
              {/* Fields */}
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Display name</label>
                <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={name} onChange={e=>setName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Pronouns</label>
                <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="they/them" value={pronouns} onChange={e=>setPronouns(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Website</label>
                <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="https://example.com" value={website} onChange={e=>setWebsite(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Display name color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={(function(){ const c=String(nameColor||'').trim(); return /^#([0-9a-fA-F]{6})$/.test(c)?c:'#ffffff'; })()} onChange={(e)=>setNameColor(e.target.value)} className="h-9 w-12 bg-neutral-900 border border-neutral-800 rounded cursor-pointer" title="Pick a color" />
                  <input className="flex-1 p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="#34d399 or 'teal'" value={nameColor} onChange={(e)=>setNameColor(e.target.value)} />
                  <div className="text-sm" style={nameColor?{color:nameColor}:undefined}>{name||'Preview'}</div>
                </div>
                <p className="mt-1 text-xs text-neutral-500">Use a hex color like #34d399 or leave blank to use default.</p>
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Bio</label>
                <textarea rows={4} className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={bio} onChange={e=>setBio(e.target.value)} spellCheck={true} autoCorrect="on" autoCapitalize="sentences" />
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Status</label>
                <select className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={status} onChange={e=>setStatus(e.target.value)}>
                  <option value="online">Online</option>
                  <option value="idle">Idle</option>
                  <option value="dnd">Do Not Disturb</option>
                  <option value="invisible">Invisible</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button disabled={loading} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={saveProfile}>{loading?'Saving…':'Save changes'}</button>
              </div>
            </div>
          )}

          {tab==='notifications' && (
            <div className="space-y-3 fade-in">
              <div className="text-emerald-300 font-semibold">Notifications</div>
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
                <button disabled={loading} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={saveNotifications}>{loading?'Saving…':'Save'}</button>
              </div>
            </div>
          )}

          {tab==='security' && (
            <div className="space-y-4 fade-in">
              <div className="text-emerald-300 font-semibold">Security</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-neutral-300 font-medium">Change password</div>
                  {!showChangePwd && (
                    <button className="w-full text-left px-2 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setShowChangePwd(true)}>Open change password</button>
                  )}
                  {showChangePwd && (
                    <div className="p-2 rounded border border-neutral-800 bg-neutral-900">
                      <ChangePassword token={token} onSuccess={() => { try { localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('me'); } catch {}; location.reload(); }} />
                      <div className="mt-2 text-right">
                        <button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={()=>setShowChangePwd(false)}>Close</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="text-neutral-300 font-medium">Sessions</div>
                  <button
                    className="w-full text-left px-2 py-2 rounded border border-red-900 text-red-400 hover:bg-red-900/30"
                    onClick={async ()=>{ const ok = await askConfirm({ title:'Deactivate Account', message:'Deactivate your account? You will be signed out.', confirmText:'Deactivate' }); if(!ok) return; setBusy(true); setErr(''); try{ const tok=localStorage.getItem('token')||''; await fetch('/api/users/deactivate', { method:'POST', headers:{ Authorization: `Bearer ${tok}` } }); } catch{} finally { setBusy(false);} try { localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('me'); } catch {}; location.reload(); }}
                  >Deactivate account</button>
                </div>
              </div>
            </div>
          )}

          {tab==='space-general' && (
            <div className="space-y-4 fade-in">
              <div className="text-emerald-300 font-semibold">Space</div>
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
                <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60"
                       value={sName} onChange={e=>setSName(e.target.value)} disabled={String(spaceId).startsWith('dm_')} />
                {String(spaceId).startsWith('dm_') && (
                  <p className="mt-1 text-xs text-neutral-500">Direct Messages use a shared name; only the DM image can be changed.</p>
                )}
              </div>
              {!String(spaceId).startsWith('dm_') && (
                <div>
                  <label className="block text-sm text-neutral-400 mb-1">Home channel</label>
                  <select value={sHome} onChange={(e)=>setSHome(e.target.value)} className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60">
                    <option value="">(none — remember last opened)</option>
                    {channels.map(c => (
                      <option key={c.id} value={c.id}>#{c.name || c.id}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-neutral-500">If set, members opening this space land on the selected channel.</p>
                </div>
              )}
              <div className="flex items-center justify-between">
                <label className="text-sm text-neutral-300">Mute notifications for this space</label>
                <input type="checkbox" defaultChecked={(()=>{ try { const ms = JSON.parse(localStorage.getItem('mutedSpaces')||'{}'); return !!ms[spaceId]; } catch { return false; } })()} onChange={(e)=>{ try { const ms = JSON.parse(localStorage.getItem('mutedSpaces')||'{}'); ms[spaceId] = !!e.target.checked; localStorage.setItem('mutedSpaces', JSON.stringify(ms)); (window as any).dispatchEvent(new CustomEvent('echo:mutedSpaces', { detail: ms })); } catch {} }} />
              </div>
              <div className="flex items-center gap-2">
                <button disabled={busy} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={saveSpaceGeneral}>{busy?'Saving…':'Save changes'}</button>
                <div className="ml-auto flex items-center gap-2">
                  <button disabled={busy} className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={leaveSpace}>Leave space</button>
                  <button disabled={busy} className="px-3 py-2 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={deleteSpace}>Delete space</button>
                </div>
              </div>
            </div>
          )}

          {tab==='dm-info' && (
            <div className="space-y-4 fade-in">
              <div className="text-emerald-300 font-semibold">Direct Message</div>
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                  {sAvatarUrl ? <img src={sAvatarUrl} alt="dm" className="h-full w-full object-cover" /> : <span className="text-neutral-500">No image</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>fileRef.current?.click()}>Upload</button>
                  {sAvatarUrl && <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setSAvatarUrl(null)}>Remove</button>}
                  <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e=>pickSpaceImage(e.target.files)} />
                </div>
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">DM Name</label>
                <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={sName} onChange={e=>setSName(e.target.value)} />
                <p className="mt-1 text-xs text-neutral-500">Either participant can update this name and image.</p>
              </div>
              <DmParticipants spaceId={spaceId} token={token} />

              <div className="flex items-center justify-between">
                <label className="text-sm text-neutral-300">Mute notifications for this DM</label>
                <input type="checkbox" defaultChecked={(()=>{ try { const ms = JSON.parse(localStorage.getItem('mutedSpaces')||'{}'); return !!ms[spaceId]; } catch { return false; } })()} onChange={(e)=>{ try { const ms = JSON.parse(localStorage.getItem('mutedSpaces')||'{}'); ms[spaceId] = !!e.target.checked; localStorage.setItem('mutedSpaces', JSON.stringify(ms)); (window as any).dispatchEvent(new CustomEvent('echo:mutedSpaces', { detail: ms })); } catch {} }} />
              </div>

              {/* DM history controls */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <button className="px-3 py-2 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={async()=>{
                    const ok = await askConfirm({ title:'Clear History', message:'Delete ALL messages in this DM for both participants?', confirmText:'Clear all' });
                    if (!ok) return;
                    setBusy(true); setErr('');
                    try { await api.postAuth('/dms/clear', { spaceId }, token); onSwitchToChannel(`${spaceId}:chat`); }
                    catch(e:any){ setErr(e?.message||'Failed to clear'); }
                    finally { setBusy(false); }
                  }}>Clear all</button>
                  <p className="text-xs text-neutral-500">Removes all previous messages in this DM.</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-neutral-400">Clear last</label>
                  <input id="dmClearDays" type="number" min="1" max="3650" defaultValue={7} className="w-20 p-1 rounded bg-neutral-900 text-neutral-100 border border-neutral-700" />
                  <span className="text-sm text-neutral-400">days</span>
                  <button className="px-3 py-2 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={async()=>{
                    const el = document.getElementById('dmClearDays') as HTMLInputElement | null;
                    const n = el ? Math.max(1, Math.min(3650, parseInt(el.value||'7',10))) : 7;
                    const ok = await askConfirm({ title:'Clear Recent Messages', message:`Delete messages from the last ${n} day(s) in this DM?`, confirmText:'Clear recent' });
                    if (!ok) return;
                    setBusy(true); setErr('');
                    try { await api.postAuth('/dms/clear', { spaceId, days: n }, token); onSwitchToChannel(`${spaceId}:chat`); }
                    catch(e:any){ setErr(e?.message||'Failed to clear'); }
                    finally { setBusy(false); }
                  }}>Clear last N days</button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button disabled={busy} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={saveSpaceGeneral}>{busy?'Saving…':'Save changes'}</button>
                <div className="ml-auto flex items-center gap-2">
                  <button disabled={busy} className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={leaveSpace}>Leave DM</button>
                </div>
              </div>
              {/* Members moved to dedicated tab */}
            </div>
          )}

          {tab==='space-channels' && (
            <div className="space-y-3 fade-in">
              <div className="flex gap-2 items-center">
                <input className="flex-1 p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="New channel name" value={newChan} onChange={e=>setNewChan(e.target.value)} />
                 <select className="p-2 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800" value={newChanType} onChange={(e)=>setNewChanType((e.target.value as any)||'text')}>
                   <option value="text">Text</option>
                   <option value="voice">Voice</option>
                   <option value="announcement">Announcement</option>
                   <option value="kanban">Kanban</option>
                   <option value="form">Form</option>
                   <option value="habit">Habit Tracker</option>
                   <option value="gallery">Photo Gallery</option>
                   <option value="notes">Notes</option>
                 </select>
                <button disabled={busy} className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={addChannel}>Add</button>
              </div>
              <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">
                {channels.map(c => (
                  <li key={c.id} className="flex items-center justify-between px-3 py-2 gap-2">
                    <div className="truncate flex items-center gap-2">
                      <span className="opacity-70 text-sm">
                        {c.type==='voice' ? '🔊' : c.type==='announcement' ? '📢' : c.type==='kanban' ? '🗂️' : c.type==='form' ? '📝' : '#'}
                      </span>
                      <span> {c.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button disabled={busy} className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>renameChannel(c.id)}>Rename</button>
                      <button disabled={busy} className="px-2 py-1 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={()=>removeChannel(c.id)}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab==='space-members' && !String(spaceId).startsWith('dm_') && (
            <div className="space-y-3 fade-in">
              <div className="text-emerald-300 font-semibold">Members</div>
              <p className="text-sm text-neutral-400">Manage members of this space. Only owners can remove members.</p>
              <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">
                {spaceMembers.map(m => (
                  <li key={m.id} className="flex items-center justify-between px-3 py-2 gap-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                        {m.avatarUrl ? <img src={m.avatarUrl} alt={m.name||m.username||''} className="h-full w-full object-cover"/> : <span className="text-[10px] text-neutral-400">{(m.name?.[0]||m.username?.[0]||'?').toUpperCase()}</span>}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-neutral-200 text-sm">{m.name || m.username}</div>
                        <div className="text-[11px] text-neutral-500">{m.role || 'member'}</div>
                      </div>
                    </div>
                    {isOwner && m.id !== selfId && m.role !== 'owner' && (
                      <button className="px-2 py-1 rounded border border-red-800 text-red-300 hover:bg-red-900/30 text-sm" onClick={()=>removeMember(m.id)}>
                        Remove
                      </button>
                    )}
                  </li>
                ))}
                {spaceMembers.length === 0 && (
                  <li className="px-3 py-2 text-sm text-neutral-500">No members</li>
                )}
              </ul>
            </div>
          )}

          {tab==='space-invites' && (
            <div className="space-y-4 fade-in">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-sm text-neutral-400 mb-1">Invite code</label>
                  <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800" placeholder="e.g. TEAM-ALPHA or myspace2025" value={customCode} onChange={e=>setCustomCode(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm text-neutral-400 mb-1">Max uses</label>
                  <input className="w-32 p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800" type="number" min={1} value={maxUses} onChange={e=>setMaxUses(Number(e.target.value)||1)} />
                </div>
                <div>
                  <label className="block text-sm text-neutral-400 mb-1">Expires in hours (optional)</label>
                  <input className="w-48 p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800" type="number" min={1} placeholder="e.g. 24" value={expires} onChange={e=>setExpires(e.target.value)} />
                </div>
                <button disabled={busy} className="ml-auto px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={createInvite}>Create invite</button>
              </div>
              {inviteCode && (
                <div className="p-3 rounded border border-neutral-800 bg-neutral-900">
                  <div className="text-sm text-neutral-400 mb-1">Invite code</div>
                  <div className="font-mono text-lg">{inviteCode}</div>
                </div>
              )}
              <div className="h-px w-full bg-neutral-800" />
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-sm text-neutral-400 mb-1">Join a space by code</label>
                  <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800" placeholder="Enter invite code" value={joinCode} onChange={e=>setJoinCode(e.target.value)} />
                </div>
                <button disabled={busy} className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={acceptInvite}>Join</button>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-2 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={async()=>{
                  const ok = await askConfirm({ title:'Clear History', message:'Delete all messages in this DM for both participants?', confirmText:'Clear' });
                  if (!ok) return;
                  setBusy(true); setErr('');
                  try { await api.postAuth('/dms/clear', { spaceId }, token); onSwitchToChannel(`${spaceId}:chat`); }
                  catch(e:any){ setErr(e?.message||'Failed to clear'); }
                  finally { setBusy(false); }
                }}>Clear history</button>
                <p className="text-xs text-neutral-500">This deletes all previous messages in this DM.</p>
              </div>
            </div>
          )}
          {/* Footer: place Logout at the very bottom, away from Deactivate */}
          <div className="mt-6 pt-4 border-t border-neutral-800 flex justify-end">
            <button
              className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60"
              onClick={async ()=>{ try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}; try { localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('me'); } catch {}; location.reload(); }}
            >Log out</button>
          </div>
        </div>
      </div>
      {inOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0" onClick={()=>closeAsk(null)} />
          <div className="relative w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-4 shadow-xl">
            {inCfg.title && <div className="text-emerald-300 font-semibold mb-2">{inCfg.title}</div>}
            {inCfg.label && <div className="text-xs text-neutral-500 mb-1">{inCfg.label}</div>}
            <input className="w-full p-2.5 rounded-md bg-neutral-950 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder={inCfg.placeholder} defaultValue={inCfg.initialValue||''} onKeyDown={(e)=>{ if(e.key==='Enter' && !e.shiftKey){ closeAsk((e.target as HTMLInputElement).value.trim()); } if(e.key==='Escape'){ closeAsk(null);} }} />
            <div className="mt-3 flex justify-end gap-2">
              <button className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/70" onClick={()=>closeAsk(null)}>Cancel</button>
              <button className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={()=>{ const el=(document.activeElement as HTMLInputElement); const v=(el && 'value' in el)? (el as any).value : ''; closeAsk(String(v||'').trim()); }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type Member = { id: string; name?: string; username?: string; avatarUrl?: string | null }

function DmParticipants({ spaceId, token }: { spaceId: string; token: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await api.getAuth(`/spaces/members?spaceId=${encodeURIComponent(spaceId)}`, token);
        setMembers(res.members || []);
      } catch {}
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

function ThemeSelector() {
  const [theme, setTheme] = useState<string>(() => {
    try { return localStorage.getItem('theme') || 'emerald'; } catch { return 'emerald'; }
  });
  useEffect(() => {
    try {
      localStorage.setItem('theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
    } catch {}
  }, [theme]);

  const options = [
    { id: 'emerald', name: 'Emerald', preview: 'from-emerald-400 to-teal-400' },
    { id: 'blue',    name: 'Blue',    preview: '' },
    { id: 'purple',  name: 'Purple',  preview: '' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {options.map(opt => (
          <button key={opt.id}
                  className={`p-3 rounded-lg border ${theme===opt.id ? 'border-emerald-500' : 'border-neutral-800'} bg-neutral-900 hover:border-emerald-600 transition-colors`}
                  onClick={() => setTheme(opt.id)}
          >
            <div className="text-sm text-neutral-200 mb-2">{opt.name}</div>
            <div className="h-8 rounded bg-gradient-to-r from-neutral-700 to-neutral-600 relative overflow-hidden">
              {/* simple color stripe to hint theme */}
              {opt.id==='emerald' && <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/40 to-teal-400/40" />}
              {opt.id==='blue' && <div className="absolute inset-0 bg-gradient-to-r from-sky-500/40 to-blue-400/40" />}
              {opt.id==='purple' && <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-500/40 to-violet-400/40" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}


