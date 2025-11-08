import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, signUpload } from '../../lib/api';
import ColorPicker from '../ui/ColorPicker';
import AccountBannerCard from './AccountBannerCard';
import SectionCard from './SectionCard';

export default function ProfileSettingsSection({ token, onSaved, spaceId }: { token: string; onSaved: (u: any) => void; spaceId?: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [presence, setPresence] = useState<'online'|'idle'|'dnd'|'invisible'>('online');
  const [statusText, setStatusText] = useState<string>(()=>{ try { return localStorage.getItem('profile.activity') || ''; } catch { return ''; } });
  const [pronouns, setPronouns] = useState('');
  const [nameColor, setNameColor] = useState<string>(()=>{ try { return localStorage.getItem('nameColor') || ''; } catch { return ''; } });
  const [showNamePicker, setShowNamePicker] = useState(false);
  const namePickerWrapRef = useRef<HTMLDivElement|null>(null);
  const namePickerToggleRef = useRef<HTMLButtonElement|null>(null);
  const [skills, setSkills] = useState<string[]>(()=>{ try { return JSON.parse(localStorage.getItem('profile.skills')||'[]'); } catch { return []; } });
  const [socials, setSocials] = useState<{ github?: string; discord?: string; google?: string; notion?: string }>(()=>{ try { return JSON.parse(localStorage.getItem('profile.socials')||'{}')||{}; } catch { return {}; } });
  const [nickname, setNickname] = useState<string>(()=>{ try { return spaceId ? (localStorage.getItem(`nick:${spaceId}`)||'') : ''; } catch { return ''; } });
  const [memberSince, setMemberSince] = useState<string>('');
  const [lastSeen, setLastSeen] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerPositionY, setBannerPositionY] = useState<number>(50);
  const [bannerScale, setBannerScale] = useState<number>(()=>{ try { return Number(localStorage.getItem('profile.bannerScale')||'100')||100; } catch { return 100; } });

  // Format dates as "Month Day, Year" without time
  const formatDateDisplay = (s?: string) => {
    if (!s) return '—';
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return '—'; }
  };
  const memberSinceFmt = formatDateDisplay(memberSince);
  const lastSeenFmt = formatDateDisplay(lastSeen);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true); setErr('');
        const u = await api.getAuth('/users/me', token);
        if (cancelled) return;
        setName(u.name || '');
        setBio(u.bio || '');
        setPresence((u.status || 'online').trim() as any);
        try {
          if (typeof u.activity === 'string') setStatusText(u.activity || '');
          if (u.skills) setSkills(Array.isArray(u.skills) ? u.skills as string[] : JSON.parse(u.skills || '[]'));
          if (u.socials) setSocials(typeof u.socials === 'object' ? u.socials : JSON.parse(u.socials || '{}'));
        } catch {}
        setPronouns((u.pronouns || '').trim());
        try { if (u.nameColor) setNameColor(String(u.nameColor)); } catch {}
        try {
          setBannerUrl(u.bannerUrl || null);
          const p = localStorage.getItem('profile.bannerPositionY');
          setBannerPositionY(p!=null ? Math.max(0, Math.min(100, Number(p))) : 50);
          const s = localStorage.getItem('profile.bannerScale');
          setBannerScale(s!=null ? Math.max(100, Math.min(300, Number(s))) : 100);
        } catch {}
        setAvatarUrl(u.avatarUrl || null);
        try {
          // Optional profile metadata
          const p = await api.getAuth('/users/me/profile', token).catch(()=>null as any);
          if (p && typeof p==='object') {
            if (p.createdAt) setMemberSince(formatDateDisplay(String(p.createdAt)));
            if (p.lastSeen) setLastSeen(formatDateDisplay(String(p.lastSeen)));
          }
          // Prefer direct fields if API provides them
          if (u.createdAt) setMemberSince(formatDateDisplay(String(u.createdAt)));
          if (u.lastSeen) setLastSeen(formatDateDisplay(String(u.lastSeen)));
        } catch {}
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Autosave when the modal backdrop is clicked
  useEffect(() => {
    const onAuto = () => { if (!loading) saveProfile(); };
    try { window.addEventListener('settings:autosave' as any, onAuto as any); } catch {}
    return () => { try { window.removeEventListener('settings:autosave' as any, onAuto as any); } catch {} };
  }, [loading, name, bio, avatarUrl, bannerUrl, bannerPositionY, presence, pronouns, statusText, JSON.stringify(skills), JSON.stringify(socials), nickname, spaceId]);

  // External focus helpers from My Account list
  useEffect(() => {
    function onFocusEvt(e: any){
      try{
        const field = e?.detail?.field;
        if (field === 'displayName') {
          const el = document.getElementById('pf-display-name') as HTMLInputElement | null;
          if (el) { el.focus({ preventScroll: false }); el.scrollIntoView({ behavior:'smooth', block:'center' }); }
        }
      }catch{}
    }
    try { window.addEventListener('settings:focus' as any, onFocusEvt as any); } catch {}
    return () => { try { window.removeEventListener('settings:focus' as any, onFocusEvt as any); } catch {} };
  }, []);

  async function onAvatarPick(files: FileList | null) {
    if (!files || files.length === 0) return; const f = files[0];
    try { const up = await signUpload({ filename:f.name, contentType:f.type||'application/octet-stream', size:f.size }, token); await fetch(up.url,{method:'PUT', headers:up.headers, body:f}); setAvatarUrl(up.publicUrl); }
    catch { setErr('Upload failed'); }
  }
  async function onBannerPick(files: FileList | null) {
    if (!files || files.length === 0) return; const f = files[0];
    try { const up = await signUpload({ filename:f.name, contentType:f.type||'application/octet-stream', size:f.size }, token); await fetch(up.url,{method:'PUT', headers:up.headers, body:f}); setBannerUrl(up.publicUrl); }
    catch { try { const blobUrl = URL.createObjectURL(f); setBannerUrl(blobUrl); } catch {} }
  }

  async function saveProfile(){
    setLoading(true); setErr('');
    try{
      const payload:any = { name, bio, avatarUrl, bannerUrl, bannerPositionY, status: presence, pronouns, activity: statusText, skills, socials, nameColor: (nameColor||null) };
      const u=await api.patchAuth('/users/me', payload, token);
      try{
        const raw=localStorage.getItem('user'); const prev = raw?JSON.parse(raw):{};
        localStorage.setItem('user', JSON.stringify({ ...prev, name: u?.name, avatarUrl: u?.avatarUrl ?? null, bannerUrl: u?.bannerUrl ?? bannerUrl, status: u?.status ?? prev?.status, pronouns: u?.pronouns ?? pronouns, activity: u?.activity ?? statusText, nameColor: (u?.nameColor ?? nameColor) || null }));
        localStorage.setItem('profile.bannerPositionY', String(bannerPositionY));
        localStorage.setItem('profile.skills', JSON.stringify(skills));
        localStorage.setItem('profile.socials', JSON.stringify(socials));
        if (spaceId) localStorage.setItem(`nick:${spaceId}`, nickname||'');
        localStorage.setItem('profile.activity', (u?.activity ?? statusText) || '');
        localStorage.setItem('profile.bannerScale', String(bannerScale));
        if (nameColor) localStorage.setItem('nameColor', nameColor); else try { localStorage.removeItem('nameColor'); } catch {}
      }catch{}
      onSaved(u);
    } catch(e:any) { setErr(e?.message||'Failed to save'); }
    finally { setLoading(false); }
  }

  const bannerStyle = (() => {
    const u = (bannerUrl || '').trim();
    if (!u) return undefined as CSSProperties | undefined;
    const isGradient = /^(linear-gradient|radial-gradient|conic-gradient)\(/i.test(u);
    const backgroundImage = isGradient ? u : `url("${u}")`;
    return {
      backgroundImage,
      backgroundSize: isGradient ? 'cover' : `${bannerScale}%`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: `center ${bannerPositionY}%`,
    } as CSSProperties;
  })();

  const username = (typeof window !== 'undefined' ? (JSON.parse(localStorage.getItem('user') || '{}')?.username || '') : '');

  return (
    <div className="space-y-4">
      {err && <div className="text-sm text-red-400">{err}</div>}

      <AccountBannerCard
        name={name || (typeof window!=='undefined' ? (JSON.parse(localStorage.getItem('user')||'{}')?.name || '') : '')}
        username={username}
        avatarUrl={avatarUrl}
        bannerUrl={bannerUrl || undefined}
        bannerPositionY={bannerPositionY}
        bannerScale={bannerScale}
        statusText={statusText}
        skills={skills}
        presence={presence}
        pronouns={pronouns}
        memberSince={memberSinceFmt}
        lastSeen={lastSeenFmt}
        nameColor={nameColor||null}
        showEditButton={false}
        onEdit={() => { /* already on edit screen */ }}
      />

      {/* Activity status (moved out of Identity) */}
      <SectionCard title="Activity Status" description="Let others know what you're up to." noBorder>
        <label className="block">
          <span className="block text-sm text-neutral-400 mb-1">Activity status</span>
          <input
            className="w-full h-10 px-3 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60"
            placeholder="What are you working on?"
            value={statusText}
            onChange={e=>setStatusText(e.target.value)}
            maxLength={160}
            aria-label="Activity status"
          />
          <div className="mt-1 text-xs text-neutral-500">{statusText.length}/160</div>
        </label>
      </SectionCard>

      <SectionCard title="Identity" description="Basic details visible to others." noBorder>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-sm text-neutral-400 mb-1">Display name</span>
            <input id="pf-display-name" className="w-full h-10 px-3 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none accent-ring focus:ring-2" value={name} onChange={e=>setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="block text-sm text-neutral-400 mb-1">Name color</span>
            <div className="flex items-center gap-2">
              <button ref={namePickerToggleRef} type="button" className="h-8 w-8 rounded border border-neutral-700" style={{ background: nameColor || '#ffffff' }} onClick={()=>setShowNamePicker(p=>!p)} aria-label="Pick name color" />
              <input aria-label="Name color hex" className="h-9 w-28 px-2 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-700 focus:outline-none accent-ring focus:ring-2" value={nameColor||''} onChange={(e)=>setNameColor(e.target.value)} onBlur={()=>{ const v=(nameColor||'').trim(); if(!v){return;} if(/^#([0-9a-fA-F]{6})$/.test(v)) setNameColor(v); }} placeholder="#ffffff" />
              <button type="button" className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setNameColor('')}>Reset</button>
            </div>
            {showNamePicker && (
              <div ref={namePickerWrapRef} className="mt-2">
                <ColorPicker value={nameColor || '#ffffff'} onChange={(hex)=>setNameColor(hex)} onChangeComplete={(hex)=>setNameColor(hex)} swatches={["#ffffff","#22c55e","#3b82f6","#a855f7","#f43f5e","#f59e0b","#06b6d4","#f97316","#10b981","#e5e7eb","#93c5fd"]} />
              </div>
            )}
          </label>
          <label className="block">
            <span className="block text-sm text-neutral-400 mb-1">Pronouns</span>
            <input className="w-full h-10 px-3 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none accent-ring focus:ring-2" placeholder="they/them" value={pronouns} onChange={e=>setPronouns(e.target.value)} />
          </label>
          <label className="block">
            <span className="block text-sm text-neutral-400 mb-1">Presence</span>
            <select className="w-full h-10 px-3 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800 focus:outline-none accent-ring focus:ring-2" value={presence} onChange={e=>setPresence(e.target.value as any)}>
              <option value="online">Online</option>
              <option value="idle">Idle</option>
              <option value="dnd">Do Not Disturb</option>
              <option value="invisible">Invisible</option>
            </select>
          </label>
          {/* Activity status moved to its own card above */}
          <label className="block md:col-span-2">
            <span className="block text-sm text-neutral-400 mb-1">Bio</span>
            <textarea rows={3} className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none accent-ring focus:ring-2" value={bio} onChange={e=>setBio(e.target.value)} />
            <div className="mt-1 text-xs text-neutral-500">{bio.length}/2048</div>
          </label>
          {spaceId && (
            <label className="block md:col-span-2">
              <span className="block text-sm text-neutral-400 mb-1">Nickname in this space</span>
              <input className="w-full h-10 px-3 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none accent-ring focus:ring-2" placeholder="Optional nickname" value={nickname} onChange={e=>setNickname(e.target.value)} />
            </label>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Appearance" description="Customize your banner and avatar." noBorder>
        <div className="space-y-4">
          <div className="rounded-lg border border-neutral-800 overflow-hidden">
            <div className="relative h-32 md:h-40 bg-neutral-800" style={bannerStyle} />
            <div className="p-2 flex flex-wrap items-center gap-2 border-t border-neutral-800 bg-neutral-900/70">
              <input type="file" accept="image/*" className="hidden" id="pf-banner-file" onChange={e=>onBannerPick(e.target.files)} />
              <label htmlFor="pf-banner-file" className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60 cursor-pointer">Upload banner</label>
              <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setBannerUrl(null)}>Remove</button>
              <div className="ml-auto flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400">Position</span>
                  <input type="range" min={0} max={100} value={bannerPositionY} onChange={e=>setBannerPositionY(parseInt(e.target.value,10))} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400">Scale</span>
                  <input type="range" min={100} max={300} step={1} value={bannerScale} onChange={e=>setBannerScale(parseInt(e.target.value,10))} />
                </div>
              </div>
            </div>
          </div>

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
        </div>
      </SectionCard>

      <SectionCard title="Skills" noBorder>
        <TagEditor value={skills} onChange={setSkills} placeholder="#designer #developer" />
      </SectionCard>

      <SectionCard title="Linked Accounts" noBorder>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <SocialField label="GitHub" placeholder="https://github.com/username" value={socials.github||''} onChange={v=>setSocials(s=>({ ...s, github:v }))} />
          <SocialField label="Discord" placeholder="https://discord.com/users/123..." value={socials.discord||''} onChange={v=>setSocials(s=>({ ...s, discord:v }))} />
          <SocialField label="Google" placeholder="https://profiles.google.com/..." value={socials.google||''} onChange={v=>setSocials(s=>({ ...s, google:v }))} />
          <SocialField label="Notion" placeholder="https://notion.so/your-page" value={socials.notion||''} onChange={v=>setSocials(s=>({ ...s, notion:v }))} />
        </div>
      </SectionCard>

      <div className="text-sm text-neutral-400">Last seen: <span className="text-neutral-300">{lastSeen||'—'}</span></div>
      <div className="sticky bottom-2 px-0 pointer-events-none z-10">
        <div className="flex items-center justify-end">
          <button disabled={loading} className="pointer-events-auto px-3 py-2 rounded-lg bg-[var(--echo-accent)] text-[var(--echo-accent-fg)] opacity-90 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-white/10 disabled:opacity-50 shadow-[0_4px_8px_rgba(0,0,0,0.25)]" onClick={saveProfile}>{loading?'Saving...':'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}

function TagEditor({ value, onChange, placeholder }: { value: string[]; onChange: (v:string[])=>void; placeholder?: string }) {
  const [input, setInput] = useState('');
  function stripHashes(s: string){ let i = 0; while (i < s.length && s[i] === '#') i++; return s.slice(i); }
  function addTags(raw: string){
    const parts = raw.split(/[ ,]+/).map(s=>stripHashes(s).toLowerCase()).filter(Boolean);
    const merged = Array.from(new Set([...value, ...parts]));
    onChange(merged);
    setInput('');
  }

  
  
  return (
    <div>
      <div className="flex items-center gap-2">
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); addTags(input); } }} placeholder={placeholder||'#tags'} className="flex-1 p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none accent-ring focus:ring-2" />
        <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>addTags(input)}>Add</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {value.map(t => (
          <span key={t} className="px-2 py-1 rounded-full border border-neutral-700 text-xs text-neutral-300 inline-flex items-center">
            #{t}
            <button className="ml-2 text-neutral-500 hover:text-red-300" onClick={()=>onChange(value.filter(x=>x!==t))} aria-label="Remove tag" title="Remove">×</button>
          </span>
        ))}
        {value.length===0 && <span className="text-xs text-neutral-500">No tags yet</span>}
      </div>
    </div>
  );
}

function SocialField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v:string)=>void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-sm text-neutral-400 mb-1">{label}</span>
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="w-full h-10 px-3 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none accent-ring focus:ring-2" />
    </label>
  );
}

