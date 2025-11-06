import React, { useEffect, useState } from 'react';
import { api, signUpload } from '../../lib/api';

export default function ProfileSettingsSection({ token, onSaved }: { token: string; onSaved: (u: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerPositionY, setBannerPositionY] = useState<number>(50);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true); setErr('');
        const u = await api.getAuth('/users/me', token);
        if (cancelled) return;
        setName(u.name || '');
        setBio(u.bio || '');
        try {
          setBannerUrl(u.bannerUrl || null);
          const p = localStorage.getItem('profile.bannerPositionY');
          setBannerPositionY(p!=null ? Math.max(0, Math.min(100, Number(p))) : 50);
        } catch {}
        setAvatarUrl(u.avatarUrl || null);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

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
      const payload:any = { name, bio, avatarUrl, bannerUrl, bannerPositionY };
      const u=await api.patchAuth('/users/me', payload, token);
      try{
        const raw=localStorage.getItem('user'); const prev = raw?JSON.parse(raw):{};
        localStorage.setItem('user', JSON.stringify({ ...prev, name: u?.name, avatarUrl: u?.avatarUrl ?? null, bannerUrl: u?.bannerUrl ?? bannerUrl }));
        localStorage.setItem('profile.bannerPositionY', String(bannerPositionY));
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
        <label className="block text-sm text-neutral-400 mb-1">Bio</label>
        <textarea rows={3} className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={bio} onChange={e=>setBio(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <button disabled={loading} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={saveProfile}>{loading?'Saving...':'Save changes'}</button>
      </div>
    </div>
  );
}

