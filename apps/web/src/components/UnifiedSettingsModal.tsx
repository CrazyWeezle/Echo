import React, { useEffect, useRef, useState } from 'react';
import CloseButton from './CloseButton';
import { api } from '../lib/api';
import ProfileSettingsSection from './settings/ProfileSettingsSection';
import NotificationsSection from './settings/NotificationsSection';
import SecuritySection from './settings/SecuritySection';
import SpaceGeneralSection from './settings/SpaceGeneralSection';
import { askConfirm } from '../lib/ui';
import DmInfoSection from './settings/DmInfoSection';
import SpaceChannelsSection from './settings/SpaceChannelsSection';
import SpaceMembersSection from './settings/SpaceMembersSection';
import SpaceInvitesSection from './settings/SpaceInvitesSection';
import VaultSection from './settings/VaultSection';

type Channel = { id: string; name: string; type?: 'text' | 'voice' | 'announcement' | string };

export default function UnifiedSettingsModal({
  token,
  spaceId,
  spaceName,
  spaceAvatarUrl,
  spaceHomeChannelId,
  channels,
  spaces,
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
  spaces?: { id: string; name: string }[];
  open: boolean;
  onClose: () => void;
  onRefreshSpaces: () => void;
  onRefreshChannels: (spaceId: string) => void;
  onSwitchToChannel: (channelId: string) => void;
  onSpaceDeleted: () => void;
  onJoinSpace: (spaceId: string) => void;
  onUserSaved: (u: any) => void;
}) {
  function maskEmail(e: string): string {
    try {
      const [user, dom] = String(e).split('@');
      if (!dom) return '********';
      const u = user.length <= 2 ? '*'.repeat(user.length) : `${user[0]}${'*'.repeat(Math.max(1, user.length-2))}${user[user.length-1]}`;
      const parts = dom.split('.');
      const obf = parts.map((p, i) => i===parts.length-1 ? p : (p.length<=2? '*'.repeat(p.length) : `${p[0]}${'*'.repeat(Math.max(1,p.length-2))}${p[p.length-1]}`)).join('.');
      return `${u}@${obf}`;
    } catch { return '********'; }
  }

  function normalizeUrl(val: string): string {
    const v = (val || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    return `https://${v}`;
  }
  function normalizeSocials(obj: { [k:string]: string|undefined }) {
    const out: any = {};
    for (const [k, v] of Object.entries(obj||{})) {
      const s = String(v||'').trim();
      if (!s) continue;
      out[k] = normalizeUrl(s);
    }
    return out;
  }
  const [tab, setTab] = useState<'account'|'profile'|'notifications'|'personalization'|'security'|'space-general'|'space-channels'|'space-members'|'space-invites'|'vault'|'dm-info'>(() => {
    try {
      const t = localStorage.getItem('settingsTab');
      if (t === 'account' || t === 'profile' || t === 'notifications' || t === 'personalization' || t === 'security' || t === 'space-general' || t === 'space-channels' || t === 'space-members' || t === 'space-invites' || t === 'vault' || t === 'dm-info') return t as any;
    } catch {}
    return 'account';
  });
  useEffect(() => { try { localStorage.setItem('settingsTab', tab); } catch {} }, [tab]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  // Change password handled in SecuritySection
  // Privacy/Security toggles
  // Security privacy toggle moved to SecuritySection

  // Profile
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [memberSince, setMemberSince] = useState<string>('');
  const [lastSeen, setLastSeen] = useState<string>('');
  // removed legacy skills/tags
  // removed legacy profile extras (projects, featured channels, achievements)
  // removed legacy mini status
  // profile extras handled in ProfileSettingsSection
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // removed presence and name color
  // removed legacy profile fields (pronouns, website)
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true); setErr('');
        const u = await api.getAuth('/users/me', token);
        setName(u.name||'');
        setUsername(u.username||'');
        setEmail(typeof u.email === 'string' ? u.email : null);
        // profile extras loaded in ProfileSettingsSection
        setAvatarUrl(u.avatarUrl||null);
        // removed pronouns/website
        try { if (u.createdAt) setMemberSince(new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })); if (u.lastSeen) setLastSeen(new Date(u.lastSeen).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })); } catch {}
      }
      catch (e:any) { setErr(e?.message || 'Failed to load profile'); }
      finally { setLoading(false); }
    })();
  }, [open, token]);
  // profile save handled in ProfileSettingsSection
  // Profile preview styling moved to ProfileSettingsSection

  // Notifications
  const [notifEnabled, setNotifEnabled] = useState<boolean>(()=>{ try { return localStorage.getItem('notifEnabled')==='1'; } catch { return false; } });
  const [soundEnabled, setSoundEnabled] = useState<boolean>(()=>{ try { return localStorage.getItem('soundEnabled')!=='0'; } catch { return true; } });
  const [toneUrl, setToneUrl] = useState<string | null>(()=>{ try { return localStorage.getItem('toneUrl')||null; } catch { return null; } });
  async function saveNotifications(){ setLoading(true); setErr(''); try{ const u=await api.patchAuth('/users/me',{ toneUrl }, token); try{ localStorage.setItem('notifEnabled', notifEnabled?'1':'0'); localStorage.setItem('soundEnabled', soundEnabled?'1':'0'); if(toneUrl) localStorage.setItem('toneUrl', toneUrl); else localStorage.removeItem('toneUrl'); }catch{} onUserSaved(u);} catch(e:any){ setErr(e?.message||'Failed to save'); } finally{ setLoading(false);} }

  // Personalization: friend indicator removed

  // Space settings moved to SpaceGeneralSection
  // Legacy inline state for channels/members/invites moved to modular sections

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
      <div className="absolute inset-0 bg-black/50 z-0" onClick={() => { try { window.dispatchEvent(new CustomEvent('settings:autosave')); } catch {} onClose(); }} />
      <div className="relative z-10 w-[calc(100%-2rem)] md:w-[calc(100%-3rem)] max-w-4xl h-[78vh] md:h-[76vh] rounded-2xl bg-neutral-900/95 backdrop-blur-md ring-1 ring-neutral-800 shadow-2xl grid grid-rows-[auto,1fr] md:grid-rows-1 md:grid-cols-[240px,1fr] overflow-hidden">
        <CloseButton onClick={onClose} className="absolute top-2 right-2 px-2 py-1" />
        <div className="absolute top-3 right-10 hidden md:block text-[10px] uppercase tracking-wider text-neutral-500 pointer-events-none">ESC</div>
          <div className="hidden md:flex border-r border-neutral-800 p-3 flex-col min-h-0 overflow-auto bg-gradient-to-b from-neutral-900/70 to-neutral-900/40 gap-1">
            <div className="text-xs uppercase tracking-wide text-neutral-400 px-1 pb-1">User Settings</div>
          <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='account'?'bg-white/5 text-white ring-1 ring-white/10':'text-neutral-300 hover:bg-white/5'}`} onClick={()=>setTab('account')}>My Account</button>
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
            <button
              className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='space-general' ? 'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800' : 'text-neutral-300 hover:bg-neutral-800/60'}`}
              onClick={()=>setTab('space-general')}
            >
              {spaceName || 'General'}
            </button>
          )}
          {!String(spaceId).startsWith('dm_') && (
            <>
              <button className={`w-full text left px-3 py-2 rounded-md transition-colors ${tab==='space-channels'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('space-channels')}>Channels</button>
              <button className={`w-full text left px-3 py-2 rounded-md transition-colors ${tab==='space-members'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('space-members')}>Members</button>
              <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='space-invites'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('space-invites')}>Invites</button>
              <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='vault'?'bg-emerald-900/30 text-emerald-200 ring-1 ring-emerald-800':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('vault')}>Vault</button>
            </>
          )}
          <div className="mt-auto pt-2 border-t border-neutral-800"></div>
        </div>
        <div className="flex-1 p-4 md:p-6 space-y-5 overflow-auto min-h-0">
          {/* Mobile tab bar */}
          <div className="md:hidden sticky top-0 z-10 -mx-4 px-4 py-2 bg-neutral-900/90 backdrop-blur border-b border-neutral-800 flex gap-2 overflow-auto">
            {(['account','profile','notifications','personalization','security'] as const).map(t => (
              <button key={t} className={`px-3 py-1 rounded-full text-sm border ${tab===t ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200' : 'border-neutral-700 text-neutral-300'}`} onClick={()=>setTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
            ))}
            <span className="mx-2 text-neutral-600">|</span>
            {String(spaceId).startsWith('dm_') ? (
              <button className={`px-3 py-1 rounded-full text-sm border ${tab==='dm-info' ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200' : 'border-neutral-700 text-neutral-300'}`} onClick={()=>setTab('dm-info')}>DM</button>
            ) : (
              ['space-general','space-channels','space-members','space-invites','vault'].map((t:any) => (
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
            </div>
          )}

          {tab==='profile' && (
            <div className="space-y-4 fade-in">
              <div className="text-emerald-300 font-semibold">Profile</div>
              <ProfileSettingsSection token={token} spaceId={spaceId} onSaved={(u:any)=>{ try { if (u?.name!==undefined) setName(u.name||''); if (u?.avatarUrl!==undefined) setAvatarUrl(u.avatarUrl||null); } catch {}; onUserSaved(u); onClose(); }} />
            </div>
          )}

          {tab==='notifications' && (
            <NotificationsSection token={token} onSaved={(u:any)=>{ onUserSaved(u); onClose(); }} />
          )}

          {tab==='security' && (
            <SecuritySection token={token} />
          )}

          {tab==='space-general' && (
            <SpaceGeneralSection
              token={token}
              spaceId={spaceId}
              spaceName={spaceName}
              spaceAvatarUrl={spaceAvatarUrl}
              spaceHomeChannelId={spaceHomeChannelId||undefined}
              channels={channels}
              onRefreshSpaces={onRefreshSpaces}
              onRefreshChannels={onRefreshChannels}
              onSwitchToChannel={onSwitchToChannel}
              onSpaceDeleted={onSpaceDeleted}
            />
          )}

          {tab==='dm-info' && (
            <DmInfoSection token={token} spaceId={spaceId} spaceName={spaceName} spaceAvatarUrl={spaceAvatarUrl||undefined} onSwitchToChannel={onSwitchToChannel} />
          )}

          {tab==='account' && (
            <div className="space-y-6 fade-in">
              <div>
                <div className="text-2xl font-semibold text-white">My Account</div>
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-16 w-16 rounded-full ring-2 ring-neutral-900 overflow-hidden bg-neutral-800 border border-neutral-700">
                        {avatarUrl ? <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" /> : null}
                      </div>
                      <div>
                        <div className="text-white font-semibold text-lg">{name || 'User'}</div>
                        <div className="text-neutral-400 text-sm">@{username || 'unknown'}</div>
                      </div>
                    </div>
                    <button className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm" onClick={()=>setTab('profile')}>Edit User Profile</button>
                  </div>
                  <div className="mt-4">
                    {[
                      { label: 'Display Name', value: name || '—', onClick: ()=>{} },
                      { label: 'Username', value: username || '—', onClick: ()=>{} },
                      { label: 'Email', value: email ? maskEmail(email) : 'Add an email', onClick: ()=>{} },
                      { label: 'Member since', value: memberSince || '-', onClick: ()=>{} },
                      { label: 'Last seen', value: lastSeen || '-', onClick: ()=>{} },
                    ].map((row, i) => (
                      <div key={i} className={`flex items-center justify-between px-3 py-3 ${i>0?'border-t border-neutral-800':''}`}>
                        <div>
                          <div className="text-xs uppercase text-neutral-500">{row.label}</div>
                          <div className="text-neutral-200">{row.value}</div>
                        </div>
                        <button className="text-emerald-300 hover:underline text-sm" onClick={row.onClick}>Edit</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Security actions */}
              <div className="mt-4 flex items-center gap-4 flex-wrap">
                <button className="text-emerald-300 hover:underline text-sm" onClick={()=>setTab("security")}>
                  Change password
                </button>
                <button
                  className="text-red-400 hover:underline text-sm"
                  onClick={async ()=>{
                    const ok = await askConfirm({ title:"Delete Account", message:"This will permanently delete your account and all associated data. This cannot be undone.", confirmText:"Delete" });
                    if (!ok) return;
                    try { await api.request("/users/me", { method: "DELETE", token }); } finally { try { localStorage.removeItem("token"); localStorage.removeItem("user"); localStorage.removeItem("me"); } catch {}; location.reload(); }
                  }}
                >Delete account</button>
              </div>
              {/* Security actions moved to SecuritySection */}
            </div>
          )}
          
          {tab==='space-channels' && (
            <SpaceChannelsSection token={token} spaceId={spaceId} channels={channels} onRefreshChannels={onRefreshChannels} onSwitchToChannel={onSwitchToChannel} />
          )}

          {tab==='space-members' && !String(spaceId).startsWith('dm_') && (
            <SpaceMembersSection token={token} spaceId={spaceId} />
          )}

          {tab==='space-invites' && (
            <SpaceInvitesSection token={token} spaceId={spaceId} />
          )}
          

          {tab==='vault' && (
            <VaultSection spaces={spaces||[]} />
          )}

          {false && tab==='vault' && (<div />)}
          {/* Footer: place Logout at the very bottom, away from Deactivate */}
          <div className="mt-6 pt-4 border-t border-border flex justify-end">
            <button
              className="px-3 py-2 rounded glass-border hover:bg-elevated/60 text-neutral-200"
              onClick={async ()=>{ try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}; try { localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('me'); } catch {}; location.reload(); }}
            >Log out</button>
          </div>
        </div>
      </div>
      {/* legacy input modal removed */}
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
    { id: 'emerald', name: 'Emerald' },
    { id: 'blue',    name: 'Blue' },
    { id: 'purple',  name: 'Purple' },
    { id: 'rose',    name: 'Rose' },
    { id: 'amber',   name: 'Amber' },
    { id: 'indigo',  name: 'Indigo' },
    { id: 'cyan',    name: 'Cyan' },
    { id: 'orange',  name: 'Orange' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
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
              {opt.id==='rose' && <div className="absolute inset-0 bg-gradient-to-r from-rose-500/40 to-pink-400/40" />}
              {opt.id==='amber' && <div className="absolute inset-0 bg-gradient-to-r from-amber-500/40 to-yellow-400/40" />}
              {opt.id==='indigo' && <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/40 to-sky-400/40" />}
              {opt.id==='cyan' && <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/40 to-teal-400/40" />}
              {opt.id==='orange' && <div className="absolute inset-0 bg-gradient-to-r from-orange-500/40 to-amber-400/40" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}









