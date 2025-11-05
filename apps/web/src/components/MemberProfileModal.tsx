import { useEffect, useState } from 'react';
import { api, signUpload } from '../lib/api';
import CloseButton from './CloseButton';

export default function MemberProfileModal({ token, userId, open, onClose, onStartDm }: { token: string; userId: string; open: boolean; onClose: () => void; onStartDm: (userId: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [u, setU] = useState<any>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerPositionY, setBannerPositionY] = useState<number>(50);
  const [adjustOpen, setAdjustOpen] = useState<boolean>(false);
  const [isSelf, setIsSelf] = useState<boolean>(false);
  const [skills, setSkills] = useState<string[]>([]);
  const [pinned, setPinned] = useState<{ title: string; url: string; kind?: string }[]>([]);
  const [socials, setSocials] = useState<{ github?: string; linkedin?: string; notion?: string; twitter?: string; instagram?: string; portfolio?: string }>({});
  const [stats, setStats] = useState<{ channels?: number; posts?: number; checkins?: number } | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true); setErr('');
    (async () => {
      try {
        // Determine if viewing self before applying any local fallbacks
        let self = false;
        try {
          const raw = localStorage.getItem('user') || localStorage.getItem('me');
          if (raw) { const me = JSON.parse(raw); const myId = me?.id || me?.userId; self = !!myId && String(myId) === String(userId); }
        } catch { self = false; }
        setIsSelf(self);

        const q = new URLSearchParams({ userId });
        const res = await api.getAuth(`/users/profile?${q.toString()}`, token);
        setU(res);

        // Banner (use local fallback only for self)
        if (self) {
          const localBanner = (()=>{ try { return localStorage.getItem('profile.bannerUrl') || null; } catch { return null; } })();
          setBannerUrl((res as any).bannerUrl || localBanner);
          try { const p = localStorage.getItem('profile.bannerPositionY'); const n = (res as any).bannerPositionY ?? (p!=null ? Number(p) : 50); setBannerPositionY(Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50); } catch { setBannerPositionY(50); }
        } else {
          setBannerUrl((res as any).bannerUrl || null);
          setBannerPositionY((res as any).bannerPositionY ?? 50);
        }

        // Skills / Pinned / Socials (do not use local fallbacks for others)
        try { const s = (res as any).skills; if (Array.isArray(s)) setSkills(s.filter((x:any)=>typeof x==='string')); else if (self) { const ls = JSON.parse(localStorage.getItem('profile.skills')||'[]'); if (Array.isArray(ls)) setSkills(ls); } } catch {}
        try { const pr = (res as any).pinned; if (Array.isArray(pr)) setPinned(pr.filter((it:any)=>it && typeof it.title==='string' && typeof it.url==='string')); else if (self) { const lp = JSON.parse(localStorage.getItem('profile.pinned')||'[]'); if (Array.isArray(lp)) setPinned(lp); } } catch {}
        try { const so = (res as any).socials; if (so && typeof so==='object') setSocials(so); else if (self) { const lso = JSON.parse(localStorage.getItem('profile.socials')||'{}'); if (lso && typeof lso==='object') setSocials(lso); } } catch {}
      } catch (e: any) {
        setErr(e?.message || 'Failed to load');
      } finally { setLoading(false); }
    })();
  }, [open, userId, token]);

  useEffect(() => {
    if (!open || !userId) return;
    (async()=>{
      try {
        const q = new URLSearchParams({ userId });
        const res = await api.getAuth(`/users/stats?${q.toString()}`, token);
        if (res && typeof res==='object') setStats(res as any);
      } catch { setStats(null); }
    })();
  }, [open, userId, token]);

  function escapeHtml(s: string) {
    return s.replace(/[&<>\"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] as string));
  }
  function renderMarkdownSafe(md: string) {
    const esc = escapeHtml(md);
    const withCode = esc.replace(/`([^`]+)`/g, '<code class="px-1 rounded bg-neutral-800 text-neutral-200">$1</code>');
    const withBold = withCode.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const withItalic = withBold.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    const withLinks = withItalic
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a class="text-emerald-300 hover:underline" href="$2" target="_blank" rel="noreferrer">$1<\/a>')
      .replace(/(^|\s)(https?:\/\/[^\s]+)(?=$|\s)/g, '$1<a class="text-emerald-300 hover:underline" href="$2" target="_blank" rel="noreferrer">$2<\/a>');
    return withLinks.replace(/\n/g, '<br/>');
  }

  async function onBannerPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0];
    try {
      const { url, headers, publicUrl } = await signUpload({ filename: f.name, contentType: f.type || 'application/octet-stream', size: f.size }, token);
      await fetch(url, { method: 'PUT', headers, body: f });
      setBannerUrl(publicUrl);
      if (isSelf) {
        try { await api.patchAuth('/users/me', { bannerUrl: publicUrl }, token); localStorage.setItem('profile.bannerUrl', publicUrl); } catch {}
      }
    } catch (e) {
      console.error(e);
      setErr('Upload failed');
    }
  }

  async function saveBannerPosition() {
    if (!isSelf) { setAdjustOpen(false); return; }
    try {
      await api.patchAuth('/users/me', { bannerPositionY }, token);
      localStorage.setItem('profile.bannerPositionY', String(bannerPositionY));
      setAdjustOpen(false);
    } catch (e: any) {
      setErr(e?.message || 'Failed to save position');
    }
  }

  async function addFriend() {
    if (!u) return;
    setLoading(true); setErr('');
    try { await api.postAuth('/friends/request', { toUserId: u.id }, token); setU({ ...u, outgoingRequestId: 'pending' }); }
    catch (e: any) { setErr(e?.message || 'Failed to send request'); }
    finally { setLoading(false); }
  }
  async function accept(id?: string) {
    if (!u) return; const rid = id || u.incomingRequestId; if (!rid) return;
    setLoading(true); setErr('');
    try { await api.postAuth('/friends/respond', { requestId: rid, action: 'accept' }, token); setU({ ...u, isFriend: true, incomingRequestId: null, outgoingRequestId: null }); }
    catch (e: any) { setErr(e?.message || 'Failed to accept'); }
    finally { setLoading(false); }
  }
  async function decline(id?: string) {
    if (!u) return; const rid = id || u.incomingRequestId; if (!rid) return;
    setLoading(true); setErr('');
    try { await api.postAuth('/friends/respond', { requestId: rid, action: 'decline' }, token); setU({ ...u, incomingRequestId: null }); }
    catch (e: any) { setErr(e?.message || 'Failed to decline'); }
    finally { setLoading(false); }
  }

  if (!open || !userId) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl overflow-hidden">
        {/* Banner */}
        <div className="relative h-32 sm:h-40 w-full border-b border-neutral-800">
          {bannerUrl ? (
            <img src={bannerUrl} alt="banner" className="h-full w-full object-cover" style={{ objectPosition: `center ${bannerPositionY}%` }} />
          ) : (
            <div className="h-full w-full brand-login-bg opacity-80" />
          )}
          <div className="absolute top-2 right-2 flex items-center gap-2">
            {isSelf && (
              <>
                <label className="px-2 py-1 rounded border border-neutral-700 bg-neutral-900/60 text-neutral-200 hover:bg-neutral-900/80 cursor-pointer text-xs">
                  <input type="file" accept="image/*" className="hidden" onChange={e=>onBannerPick(e.target.files)} />
                  Change banner
                </label>
                <button className="px-2 py-1 rounded border border-neutral-700 bg-neutral-900/60 text-neutral-200 hover:bg-neutral-900/80 text-xs" onClick={()=>setAdjustOpen(v=>!v)}>
                  Adjust
                </button>
              </>
            )}
            <CloseButton onClick={onClose} />
          </div>
          {/* Avatar overlay */}
          <div className="absolute -bottom-6 left-4 flex items-end gap-3">
            <div className="h-16 w-16 rounded-full overflow-hidden bg-neutral-800 border-4 border-neutral-900 shadow">
              {u?.avatarUrl ? <img src={u.avatarUrl} alt={u?.name || u?.username} className="h-full w-full object-cover"/> : <span className="h-full w-full flex items-center justify-center text-[12px] text-neutral-400">{(u?.name?.[0]||u?.username?.[0]||'?').toUpperCase()}</span>}
            </div>
            <div className="pb-1">
              <div className="text-xl font-semibold" style={u?.nameColor?{color:u.nameColor}:undefined}>{u?.name || u?.username}</div>
              <div className="text-xs text-neutral-400 capitalize">{u?.status || ''}</div>
            </div>
          </div>
        </div>

        {/* Adjust bar */}
        {isSelf && adjustOpen && (
          <div className="px-4 py-2 border-b border-neutral-800 bg-neutral-900/80 flex items-center gap-3">
            <div className="text-xs text-neutral-400">Banner position</div>
            <input type="range" min={0} max={100} step={1} value={bannerPositionY} onChange={e=>setBannerPositionY(Number(e.target.value))} className="flex-1" />
            <button className="px-2 py-1 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 text-xs" onClick={saveBannerPosition}>Save</button>
          </div>
        )}

        {/* Body */}
        <div className="p-4 pt-8">
          {err && <div className="mb-2 text-sm text-red-400">{err}</div>}
          {(!u || loading) ? (
            <div className="p-3 text-neutral-400">Loading...</div>
          ) : (
            <>
              {/* Mini status widget */}
              {(() => {
                const show = (typeof u.showActivity === 'boolean' ? !!u.showActivity : true);
                const text = String(u.activity || '').trim();
                if (!show || !text) return null;
                return (
                  <div className="mb-4 px-3 py-2 rounded-md bg-neutral-900/60 border border-neutral-800 text-sm text-neutral-200 flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="truncate" title={text}>{text}</span>
                  </div>
                );
              })()}

              {/* Card grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 shadow-sm">
                  <div className="text-neutral-300 font-semibold mb-2 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M20 21v-2a4 4 0 0 0-3-3.87M4 21v-2a4 4 0 0 1 3-3.87"/><circle cx="12" cy="7" r="4"/></svg>
                    About
                  </div>
                  <div className="text-neutral-200 min-h-[2rem]" dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(String(u.bio || 'No bio yet.')) }} />
                  {skills.length>0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {skills.map(t => (<span key={t} className="px-2 py-1 rounded-full border border-neutral-700 text-xs text-neutral-300">#{t}</span>))}
                    </div>
                  )}
                  <div className="mt-2 pt-2 border-t border-neutral-800 text-sm text-neutral-400 flex flex-wrap gap-x-6 gap-y-1">
                    {u.pronouns && <div><span className="text-neutral-500">Pronouns:</span> {u.pronouns}</div>}
                    {u.website && <div><span className="text-neutral-500">Website:</span> <a className="text-emerald-300 hover:underline" href={u.website} target="_blank" rel="noreferrer">{u.website}</a></div>}
                  </div>
                </div>
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 shadow-sm">
                  <div className="text-neutral-300 font-semibold mb-2 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 3v18h18"/><path d="M19 9l-5 5-4-4-3 3"/></svg>
                    Stats
                  </div>
                  <ul className="text-sm text-neutral-300 space-y-1">
                    <li>Status: <span className="capitalize text-neutral-200">{u.status || 'unknown'}</span></li>
                    {u.lastSeen && <li>Last online: <span className="text-neutral-200">{(()=>{ try{ const d=new Date(u.lastSeen); const s=Math.floor((Date.now()-d.getTime())/1000); if(s<60) return s+'s ago'; const m=Math.floor(s/60); if(m<60) return m+'m ago'; const h=Math.floor(m/60); if(h<24) return h+'h ago'; const dd=Math.floor(h/24); if(dd<7) return dd+'d ago'; return d.toLocaleString(); }catch{return ''} })()}</span></li>}
                    <li>Channels joined: <span className="text-neutral-200">{stats?.channels ?? '—'}</span></li>
                    <li>Posts made: <span className="text-neutral-200">{stats?.posts ?? '—'}</span></li>
                    <li>Check-ins: <span className="text-neutral-200">{stats?.checkins ?? '—'}</span></li>
                  </ul>
                </div>
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 shadow-sm">
                  <div className="text-neutral-300 font-semibold mb-2 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 7h18"/><path d="M3 7l2 12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2l2-12"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    Projects
                  </div>
                  {pinned.length === 0 ? (
                    <div className="text-sm text-neutral-400">No projects pinned.</div>
                  ) : (
                    <ul className="space-y-2">
                      {pinned.map((p, i) => (
                        <li key={i} className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-neutral-200">{p.title}</div>
                            <div className="truncate text-xs text-neutral-500">{(p.kind || 'link')} — {p.url}</div>
                          </div>
                          <a className="shrink-0 px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/60 text-xs" href={p.url} target="_blank" rel="noreferrer">Open</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 shadow-sm">
                  <div className="text-neutral-300 font-semibold mb-2 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 12h18"/><path d="M7 12v8"/><path d="M17 4v16"/></svg>
                    Channels
                  </div>
                  <div className="text-sm text-neutral-400">Shared channels coming soon.</div>
                </div>
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 shadow-sm">
                  <div className="text-neutral-300 font-semibold mb-2 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M8 21l4-2 4 2V5a4 4 0 1 0-8 0v16z"/></svg>
                    Achievements
                  </div>
                  <div className="text-sm text-neutral-400">No achievements yet.</div>
                </div>
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 shadow-sm md:col-span-3">
                  <div className="text-neutral-300 font-semibold mb-2 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 2h-3a2 2 0 0 0-2 2v3h5V2z"/><path d="M13 7H8a2 2 0 0 0-2 2v5h7V7z"/><path d="M8 12H3v5a2 2 0 0 0 2 2h3v-7z"/><path d="M13 12h8v5a2 2 0 0 1-2 2h-6v-7z"/></svg>
                    Social
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {socials.github && <a className="px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/60 inline-flex items-center gap-1" href={socials.github} target="_blank" rel="noreferrer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.09 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.27 2.75 1.05a9.2 9.2 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.4.21 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.96-2.34 4.82-4.57 5.08.36.32.68.96.68 1.94 0 1.4-.01 2.54-.01 2.89 0 .27.18.6.69.49A10.06 10.06 0 0 0 22 12.26C22 6.58 17.52 2 12 2z"/></svg>GitHub</a>}
                    {socials.linkedin && <a className="px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/60 inline-flex items-center gap-1" href={socials.linkedin} target="_blank" rel="noreferrer"><svg xmlns="http://www.w3.org/200/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8.5h4V23h-4V8.5zM8 8.5h3.8v2h.05c.53-1 1.82-2 3.75-2 4.01 0 4.75 2.64 4.75 6.07V23h-4v-6.62c0-1.58-.03-3.62-2.2-3.62-2.2 0-2.5 1.72-2.5 3.5V23H8V8.5z"/></svg>LinkedIn</a>}
                    {socials.notion && <a className="px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/60 inline-flex items-center gap-1" href={socials.notion} target="_blank" rel="noreferrer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M4 3h16a1 1 0 0 1 1 1v16.5a1 1 0 0 1-1.3.95L12 19l-7.7 2.45A1 1 0 0 1 3 20.5V4a1 1 0 0 1 1-1z"/></svg>Notion</a>}
                    {socials.portfolio && <a className="px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/60 inline-flex items-center gap-1" href={socials.portfolio} target="_blank" rel="noreferrer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M3 7h18v10H3z"/><path d="M8 7V5h8v2"/></svg>Portfolio</a>}
                    {socials.twitter && <a className="px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/60 inline-flex items-center gap-1" href={socials.twitter} target="_blank" rel="noreferrer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M23 3a10.9 10.9 0 0 1-3.14 1.53A4.48 4.48 0 0 0 12 7v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/></svg>Twitter</a>}
                    {socials.instagram && <a className="px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/60 inline-flex items-center gap-1" href={socials.instagram} target="_blank" rel="noreferrer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z"/><circle cx="12" cy="12" r="3.5"/><circle cx="18" cy="6" r="1.2"/></svg>Instagram</a>}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-3">
                {u.isFriend ? (
                  <button className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={()=>onStartDm(u.id)}>Message</button>
                ) : u.incomingRequestId ? (
                  <>
                    <button className="px-3 py-2 rounded border border-emerald-700 text-emerald-200 hover:bg-emerald-900/20" onClick={()=>accept()}>Accept</button>
                    <button className="px-3 py-2 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/40" onClick={()=>decline()}>Decline</button>
                  </>
                ) : u.outgoingRequestId ? (
                  <button className="px-3 py-2 rounded border border-neutral-700 text-neutral-300" disabled>Request sent</button>
                ) : (
                  <button className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/70" onClick={addFriend} disabled={loading}>Add Friend</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

