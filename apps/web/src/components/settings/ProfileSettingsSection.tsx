import React, { useEffect, useState } from 'react';
import { api, signUpload } from '../../lib/api';

export default function ProfileSettingsSection({ token, onSaved, spaceId }: { token: string; onSaved: (u: any) => void; spaceId?: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [presence, setPresence] = useState<'online'|'idle'|'dnd'|'invisible'>('online');
  const [statusText, setStatusText] = useState<string>(()=>{ try { return localStorage.getItem('profile.activity') || ''; } catch { return ''; } });
  const [pronouns, setPronouns] = useState('');
  const [skills, setSkills] = useState<string[]>(()=>{ try { return JSON.parse(localStorage.getItem('profile.skills')||'[]'); } catch { return []; } });
  const [socials, setSocials] = useState<{ github?: string; discord?: string; google?: string; notion?: string }>(()=>{ try { return JSON.parse(localStorage.getItem('profile.socials')||'{}')||{}; } catch { return {}; } });
  const [nickname, setNickname] = useState<string>(()=>{ try { return spaceId ? (localStorage.getItem(`nick:${spaceId}`)||'') : ''; } catch { return ''; } });
  const [memberSince, setMemberSince] = useState<string>('');
  const [lastSeen, setLastSeen] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerPositionY, setBannerPositionY] = useState<number>(50);

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
        try {
          setBannerUrl(u.bannerUrl || null);
          const p = localStorage.getItem('profile.bannerPositionY');
          setBannerPositionY(p!=null ? Math.max(0, Math.min(100, Number(p))) : 50);
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
      const payload:any = { name, bio, avatarUrl, bannerUrl, bannerPositionY, status: presence, pronouns, activity: statusText, skills, socials };
      const u=await api.patchAuth('/users/me', payload, token);
      try{
        const raw=localStorage.getItem('user'); const prev = raw?JSON.parse(raw):{};
        localStorage.setItem('user', JSON.stringify({ ...prev, name: u?.name, avatarUrl: u?.avatarUrl ?? null, bannerUrl: u?.bannerUrl ?? bannerUrl, status: u?.status ?? prev?.status, pronouns: u?.pronouns ?? pronouns, activity: u?.activity ?? statusText }));
        localStorage.setItem('profile.bannerPositionY', String(bannerPositionY));
        localStorage.setItem('profile.skills', JSON.stringify(skills));
        localStorage.setItem('profile.socials', JSON.stringify(socials));
        if (spaceId) localStorage.setItem(`nick:${spaceId}`, nickname||'');
        localStorage.setItem('profile.activity', (u?.activity ?? statusText) || '');
      }catch{}
      onSaved(u);
    } catch(e:any) { setErr(e?.message||'Failed to save'); }
    finally { setLoading(false); }
  }

  const bannerStyle = (() => {
    const u = (bannerUrl || '').trim();
    if (!u) return undefined as React.CSSProperties | undefined;
    const isGradient = /^(linear-gradient|radial-gradient|conic-gradient)\(/i.test(u);
    const backgroundImage = isGradient ? u : `url("${u}")`;
    return {
      backgroundImage,
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: `center ${bannerPositionY}%`,
    } as React.CSSProperties;
  })();

  return (
    <div className="space-y-4">
      {err && <div className="text-sm text-red-400">{err}</div>}
      {/* Identity */}
      <div>
        <div className="text-sm text-neutral-400 mb-1">Username</div>
        <div className="px-2 py-1 rounded border border-neutral-800 bg-neutral-900/50 text-neutral-300 text-sm select-text">{(typeof window!=='undefined' ? (JSON.parse(localStorage.getItem('user')||'{}')?.username || '') : '')}</div>
      </div>
      {/* Banner */}
      <div className="rounded-lg border border-neutral-800 overflow-hidden">
        <div className="relative h-32 md:h-40 bg-neutral-800" style={bannerStyle} />
        <div className="p-2 flex flex-wrap items-center gap-2 border-t border-neutral-800 bg-neutral-900/70">
          <input type="file" accept="image/*" className="hidden" id="pf-banner-file" onChange={e=>onBannerPick(e.target.files)} />
          <label htmlFor="pf-banner-file" className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60 cursor-pointer">Upload banner</label>
          <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setBannerUrl(null)}>Remove</button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-neutral-400">Position</span>
            <input type="range" min={0} max={100} value={bannerPositionY} onChange={e=>setBannerPositionY(parseInt(e.target.value,10))} />
          </div>
        </div>
      </div>

      {/* Avatar */}
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

      {/* Fields */}
      <div>
        <label className="block text-sm text-neutral-400 mb-1">Display name</label>
        <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={name} onChange={e=>setName(e.target.value)} />
      </div>
      <div>
        <label className="block text-sm text-neutral-400 mb-1">Presence</label>
        <select className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={presence} onChange={e=>setPresence(e.target.value as any)}>
          <option value="online">Online</option>
          <option value="idle">Idle</option>
          <option value="dnd">Do Not Disturb</option>
          <option value="invisible">Invisible</option>
        </select>
      </div>
      <div>
        <label className="block text-sm text-neutral-400 mb-1">Status message</label>
        <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="How are you feeling?" value={statusText} onChange={e=>setStatusText(e.target.value)} />
      </div>
      <div>
        <label className="block text-sm text-neutral-400 mb-1">Pronouns</label>
        <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="they/them" value={pronouns} onChange={e=>setPronouns(e.target.value)} />
      </div>
      <div>
        <label className="block text-sm text-neutral-400 mb-1">Bio</label>
        <textarea rows={3} className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={bio} onChange={e=>setBio(e.target.value)} />
      </div>
      {spaceId && (
        <div>
          <label className="block text-sm text-neutral-400 mb-1">Nickname in this space</label>
          <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="Optional nickname" value={nickname} onChange={e=>setNickname(e.target.value)} />
        </div>
      )}
      {/* Skills */}
      <div>
        <div className="text-sm text-neutral-400 mb-1">Skills</div>
        <TagEditor value={skills} onChange={setSkills} placeholder="#designer #developer" />
      </div>
      {/* Linked accounts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <SocialField label="GitHub" placeholder="https://github.com/username" value={socials.github||''} onChange={v=>setSocials(s=>({ ...s, github:v }))} />
        <SocialField label="Discord" placeholder="https://discord.com/users/123..." value={socials.discord||''} onChange={v=>setSocials(s=>({ ...s, discord:v }))} />
        <SocialField label="Google" placeholder="https://profiles.google.com/..." value={socials.google||''} onChange={v=>setSocials(s=>({ ...s, google:v }))} />
        <SocialField label="Notion" placeholder="https://notion.so/your-page" value={socials.notion||''} onChange={v=>setSocials(s=>({ ...s, notion:v }))} />
      </div>

      {/* Meta */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-neutral-400">
        <div>Last seen: <span className="text-neutral-300">{lastSeen||'�'}</span></div>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={loading} className="px-3 py-2 rounded text-white accent-gradient shadow-soft hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 disabled:opacity-60" onClick={saveProfile}>{loading?'Saving...':'Save changes'}</button>
      </div>
    </div>
  );
}

function TagEditor({ value, onChange, placeholder }: { value: string[]; onChange: (v:string[])=>void; placeholder?: string }) {
  const [input, setInput] = useState('');
  function addTags(raw: string){
    const parts = raw.split(/[ ,]+/).map(s=>s.replace(/^#*/,'').toLowerCase()).filter(Boolean);
    const merged = Array.from(new Set([...value, ...parts]));
    onChange(merged);
    setInput('');
  }
  return (
    <div>
      <div className="flex items-center gap-2">
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); addTags(input); } }} placeholder={placeholder||'#tags'} className="flex-1 p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" />
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
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" />
    </label>
  );
}

