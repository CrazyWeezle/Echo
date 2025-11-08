import React, { useEffect, useRef, useState } from 'react';
import ColorPicker from './ui/ColorPicker';
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
  const [tab, setTab] = useState<'account'|'profile'|'notifications'|'personalization'|'security'|'spaces'|'space-general'|'space-channels'|'space-members'|'space-invites'|'vault'|'dm-info'>(() => {
    try {
      const t = localStorage.getItem('settingsTab');
      if (t === 'account' || t === 'profile' || t === 'notifications' || t === 'personalization' || t === 'security' || t === 'spaces' || t === 'space-general' || t === 'space-channels' || t === 'space-members' || t === 'space-invites' || t === 'vault' || t === 'dm-info') return t as any;
    } catch {}
    return 'account';
  });
  useEffect(() => { try { localStorage.setItem('settingsTab', tab); } catch {} }, [tab]);

  // Spaces hub local state (must be inside component, not at module scope)
  const [spacesHubSelected, setSpacesHubSelected] = useState<string>(() => {
    try {
      return localStorage.getItem('spacesHubSelected') || spaceId || (spaces && spaces[0]?.id) || '';
    } catch { return spaceId || ''; }
  });
  const [spacesHubTab, setSpacesHubTab] = useState<'general'|'channels'|'members'|'invites'|'vault'>(() => {
    try { return (localStorage.getItem('spacesHubTab') as any) || 'general'; } catch { return 'general'; }
  });
  useEffect(() => { try { localStorage.setItem('spacesHubSelected', spacesHubSelected || ''); } catch {} }, [spacesHubSelected]);
  useEffect(() => { try { localStorage.setItem('spacesHubTab', spacesHubTab); } catch {} }, [spacesHubTab]);

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
          <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='account'?'accent-bg-soft accent-text ring-1 ring-[var(--echo-accent)]':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('account')}>Account</button>
          <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='notifications'?'accent-bg-soft accent-text ring-1 ring-[var(--echo-accent)]':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('notifications')}>Notifications</button>
            <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='personalization'?'accent-bg-soft accent-text ring-1 ring-[var(--echo-accent)]':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('personalization')}>Personalization</button>
            <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='security'?'accent-bg-soft accent-text ring-1 ring-[var(--echo-accent)]':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('security')}>Security</button>
          <div className="text-xs uppercase tracking-wide text-neutral-500 px-1 pt-3 pb-1">Spaces</div>
          <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='spaces'?'accent-bg-soft accent-text ring-1 ring-[var(--echo-accent)]':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('spaces')}>Spaces</button>
          {String(spaceId).startsWith('dm_') && (
            <button className={`w-full text-left px-3 py-2 rounded-md transition-colors ${tab==='dm-info'?'accent-bg-soft accent-text ring-1 ring-[var(--echo-accent)]':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('dm-info')}>DM Info</button>
          )}
          <div className="mt-auto pt-2 border-t border-neutral-800"></div>
          <button
            className="mt-2 w-full text-left px-3 py-2 rounded-md text-red-400 hover:text-red-300"
            onClick={async ()=>{ try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}; try { localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('me'); } catch {}; location.reload(); }}
          >Log out</button>
        </div>
        <div className="flex-1 p-4 md:p-6 space-y-5 overflow-auto min-h-0">
          {/* Mobile tab bar */}
          <div className="md:hidden sticky top-0 z-10 -mx-4 px-4 py-2 bg-neutral-900/90 backdrop-blur border-b border-neutral-800 flex gap-2 overflow-auto">
            {(['account','notifications','personalization','security','spaces'] as const).map(t => (
              <button key={t} className={`px-3 py-1 rounded-full text-sm border ${tab===t ? 'accent-border accent-bg-soft accent-text' : 'border-neutral-700 text-neutral-300'}`} onClick={()=>setTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
            ))}
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

          {(tab==='profile' || tab==='account') && (
            <div className="space-y-4 fade-in">
              <div className="text-emerald-300 font-semibold">Account</div>
              <ProfileSettingsSection token={token} spaceId={spaceId} onSaved={(u:any)=>{ try { if (u?.name!==undefined) setName(u.name||''); if (u?.avatarUrl!==undefined) setAvatarUrl(u.avatarUrl||null); } catch {}; onUserSaved(u); onClose(); }} />
            </div>
          )}

          {tab==='notifications' && (
            <NotificationsSection token={token} onSaved={(u:any)=>{ onUserSaved(u); onClose(); }} />
          )}

          {tab==='spaces' && (
            <div className="space-y-4 fade-in">
              <div className="text-emerald-300 font-semibold">Spaces</div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-neutral-400">Select a space</label>
                <select className="h-9 px-3 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800 focus:outline-none accent-ring focus:ring-2"
                        value={spacesHubSelected}
                        onChange={(e)=>setSpacesHubSelected(e.target.value)}>
                  {spaces && spaces.length>0 ? spaces.map(s => (
                    <option key={s.id} value={s.id}>{s.name || s.id}</option>
                  )) : (
                    <option value="">No spaces</option>
                  )}
                </select>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {(['general','channels','members','invites','vault'] as const).map(st => (
                  <button key={st}
                          className={`px-3 py-1 rounded-full text-sm border ${spacesHubTab===st ? 'accent-border accent-bg-soft accent-text' : 'border-neutral-700 text-neutral-300'}`}
                          onClick={()=>setSpacesHubTab(st)}>
                    {st.charAt(0).toUpperCase()+st.slice(1)}
                  </button>
                ))}
              </div>

              <div>
                {spacesHubTab==='general' && (
                  <SpaceGeneralSection
                    token={token}
                    spaceId={spacesHubSelected}
                    spaceName={spaces?.find(s=>s.id===spacesHubSelected)?.name}
                    spaceAvatarUrl={undefined}
                    spaceHomeChannelId={spaceHomeChannelId||undefined}
                    channels={channels}
                    onRefreshSpaces={onRefreshSpaces}
                    onRefreshChannels={onRefreshChannels}
                    onSwitchToChannel={onSwitchToChannel}
                    onSpaceDeleted={onSpaceDeleted}
                  />
                )}
                {spacesHubTab==='channels' && (
                  <SpaceChannelsSection token={token} spaceId={spacesHubSelected} channels={channels} onRefreshChannels={onRefreshChannels} onSwitchToChannel={onSwitchToChannel} />
                )}
                {spacesHubTab==='members' && (
                  <SpaceMembersSection token={token} spaceId={spacesHubSelected} />
                )}
                {spacesHubTab==='invites' && (
                  <SpaceInvitesSection token={token} spaceId={spacesHubSelected} />
                )}
                {spacesHubTab==='vault' && (
                  <VaultSection spaces={spaces||[]} />
                )}
              </div>
            </div>
          )}

          {tab==='security' && (
            <SecuritySection token={token} />
          )}

          {tab==='dm-info' && (
            <DmInfoSection token={token} spaceId={spaceId} spaceName={spaceName} spaceAvatarUrl={spaceAvatarUrl||undefined} onSwitchToChannel={onSwitchToChannel} />
          )}
          {false && tab==='legacy-space' && (<div />)}
          {/* Logout moved to UserQuickSettings menu */}
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
  const [accentHex, setAccentHex] = useState<string>(() => {
    try { return localStorage.getItem('accent') || getComputedStyle(document.documentElement).getPropertyValue('--echo-accent').trim() || '#22c55e'; } catch { return '#22c55e'; }
  });
  const [showPicker, setShowPicker] = useState(false);
  const pickerWrapRef = useRef<HTMLDivElement|null>(null);
  const pickerToggleRef = useRef<HTMLButtonElement|null>(null);
  useEffect(() => {
    try {
      localStorage.setItem('theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
    } catch {}
  }, [theme]);
  function applyAccent(hex: string){
    try {
      setAccentHex(hex);
      localStorage.setItem('accent', hex);
      document.documentElement.style.setProperty('--echo-accent', hex);
      document.documentElement.style.setProperty('--accent', hex);
      const rgb = hex.replace('#','');
      const r=parseInt(rgb.slice(0,2),16), g=parseInt(rgb.slice(2,4),16), b=parseInt(rgb.slice(4,6),16);
      const lighten=(v:number)=>Math.min(255, Math.round(v*1.15));
      const h=(n:number)=>n.toString(16).padStart(2,'0');
      const lite = `#${h(lighten(r))}${h(lighten(g))}${h(lighten(b))}`;
      document.documentElement.style.setProperty('--accent-2', lite);
      const l = 0.299*r + 0.587*g + 0.114*b;
      const fg = l > 150 ? '#061a13' : '#ffffff';
      document.documentElement.style.setProperty('--echo-accent-fg', fg);
    } catch {}
  }

  // Close accent picker on outside click
  useEffect(() => {
    if (!showPicker) return;
    function onDocDown(e: MouseEvent){
      const t = e.target as Node | null;
      if (!t) return;
      if (pickerWrapRef.current && pickerWrapRef.current.contains(t)) return;
      if (pickerToggleRef.current && pickerToggleRef.current.contains(t)) return;
      setShowPicker(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [showPicker]);

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

      {/* Accent color override */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-3 rounded-xl border border-neutral-800 bg-neutral-900/50 relative">
          <div className="text-sm text-neutral-300 mb-2">Accent color</div>
          <div className="flex items-center gap-3">
            <button ref={pickerToggleRef} className="h-8 w-8 rounded border border-neutral-700" style={{ background: accentHex }} onClick={()=>setShowPicker(p=>!p)} aria-label="Pick accent color" />
            <input aria-label="Accent hex" className="h-9 w-28 px-2 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-700 focus:outline-none accent-ring focus:ring-2" value={accentHex} onChange={(e)=>setAccentHex(e.target.value)} onBlur={()=>{ const v=accentHex.trim().toLowerCase(); if(/^#([0-9a-fA-F]{6})$/.test(v)) applyAccent(v); }} placeholder="#22c55e" />
            <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>{ try { localStorage.removeItem('accent'); } catch {} const saved = (()=>{ try { return localStorage.getItem('theme') || 'emerald'; } catch { return 'emerald'; } })(); document.documentElement.style.removeProperty('--echo-accent'); document.documentElement.style.removeProperty('--echo-accent-fg'); document.documentElement.style.removeProperty('--accent'); document.documentElement.style.removeProperty('--accent-2'); document.documentElement.setAttribute('data-theme', saved); const resetHex = getComputedStyle(document.documentElement).getPropertyValue('--echo-accent').trim()||'#22c55e'; setAccentHex(resetHex); }}>Reset</button>
          </div>
          {showPicker && (
            <div ref={pickerWrapRef} className="absolute z-20 mt-2" style={{ top: '100%', left: 0 }}>
              <ColorPicker value={accentHex} onChange={applyAccent} onChangeComplete={applyAccent} swatches={["#22c55e","#3b82f6","#a855f7","#f43f5e","#f59e0b","#06b6d4","#f97316","#10b981","#ffffff"]} />
            </div>
          )}
          <div className="mt-2 text-xs text-neutral-500">Overrides the theme’s accent for buttons and highlights.</div>
        </div>

        {/* UI scale */}
        <div className="p-3 rounded-xl border border-neutral-800 bg-neutral-900/50">
          <div className="text-sm text-neutral-300 mb-2">Interface scale</div>
          <div className="flex items-center gap-3">
            <input
              type="range" min={90} max={120} step={1}
              defaultValue={(():number=>{ try { return Math.round((parseFloat(localStorage.getItem('uiScale')||'1')||1)*100); } catch { return 100; } })()}
              onChange={(e)=>{
                const pct = parseInt(e.target.value,10);
                const scale = Math.max(0.8, Math.min(1.5, pct/100));
                try { localStorage.setItem('uiScale', String(scale)); } catch {}
                try { document.documentElement.style.fontSize = `${Math.round(16*scale)}px`; } catch {}
              }}
            />
            <span className="text-xs text-neutral-400">{`\u00D7${(parseInt(((():any=>{ try { return (localStorage.getItem('uiScale')||'1'); } catch { return '1'; } })())*100||100,10)/100).toFixed(2)}`}</span>
          </div>
          <div className="mt-2 text-xs text-neutral-500">Scales most UI elements for readability.</div>
        </div>
      </div>
    </div>
  );
}








