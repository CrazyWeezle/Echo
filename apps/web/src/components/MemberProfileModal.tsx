import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

type Profile = {
  id: string;
  username?: string;
  name?: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  status?: string | null; // presence
  activity?: string | null; // mini status
  bio?: string | null;
  pronouns?: string | null;
  skills?: string[] | null;
  socials?: Record<string, string> | null;
  incomingRequestId?: string | null;
  outgoingRequestId?: string | null;
  isFriend?: boolean;
};

export default function MemberProfileModal({ token, userId, open, onClose, onStartDm }: {
  token: string;
  userId: string;
  open: boolean;
  onClose: () => void;
  onStartDm: (userId: string) => void;
}) {
  const [u, setU] = useState<Profile | null>(null);
  const [mutuals, setMutuals] = useState<{ id: string; name?: string; username?: string; avatarUrl?: string | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || !userId) return;
      setLoading(true); setErr('');
      try {
        const q = new URLSearchParams({ userId });
        const res = await api.getAuth('/users/profile?' + q.toString(), token);
        if (!cancelled) setU(res as Profile);
        try {
          const m = await api.getAuth(`/friends/mutual?userId=${encodeURIComponent(userId)}`, token);
          if (!cancelled && m && Array.isArray(m.mutuals)) setMutuals(m.mutuals);
        } catch {}
      } catch (e: any) { if (!cancelled) { setU(null); setErr(e?.message || 'Failed to load profile'); } }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, userId, token]);

  const miniStatus = useMemo(() => {
    if (!u) return '';
    try {
      const raw = localStorage.getItem('user');
      const me = raw ? JSON.parse(raw) : null;
      if (me && me.id && u.id && me.id === u.id) {
        const act = localStorage.getItem('profile.activity') || '';
        if (act.trim()) return act.trim().slice(0, 160);
      }
    } catch {}
    const a = String(u.activity || '').trim();
    if (a) return a.slice(0, 160);
    const b = String(u.bio || '').trim();
    return b ? b.split(/\r?\n/)[0].slice(0, 160) : '';
  }, [u?.id, u?.activity, u?.bio]);

  async function addFriend() {
    if (!u || busy) return;
    setBusy(true); setErr('');
    try { await api.postAuth('/friends/request', { toUserId: u.id }, token); setU({ ...(u as any), outgoingRequestId: 'pending' }); }
    catch (e: any) { setErr(e?.message || 'Failed to send request'); }
    finally { setBusy(false); }
  }
  async function accept() {
    if (!u || !u.incomingRequestId || busy) return;
    setBusy(true); setErr('');
    try { await api.postAuth('/friends/respond', { requestId: u.incomingRequestId, action: 'accept' }, token); setU({ ...(u as any), isFriend: true, incomingRequestId: null, outgoingRequestId: null }); }
    catch (e: any) { setErr(e?.message || 'Failed to accept'); }
    finally { setBusy(false); }
  }
  async function decline() {
    if (!u || !u.incomingRequestId || busy) return;
    setBusy(true); setErr('');
    try { await api.postAuth('/friends/respond', { requestId: u.incomingRequestId, action: 'decline' }, token); setU({ ...(u as any), incomingRequestId: null }); }
    catch (e: any) { setErr(e?.message || 'Failed to decline'); }
    finally { setBusy(false); }
  }
  async function sendQuick() {
    if (!u || !u.isFriend) return;
    const content = msg.trim(); if (!content) return;
    setBusy(true);
    try {
      const r = await api.postAuth('/dms/start', { userId: u.id }, token);
      onStartDm(u.id);
      try {
        const { socket } = await import('../lib/socket');
        const tempId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? (crypto as any).randomUUID() : String(Date.now());
        const channelId = (r as any)?.channelId || `${(r as any)?.spaceId || ''}:chat`;
        const voidId = (r as any)?.spaceId || '';
        socket.emit('message:send', { voidId, channelId, content, tempId, attachments: [] });
      } catch {}
      setMsg('');
    } catch (e: any) { setErr(e?.message || 'Failed to send'); }
    finally { setBusy(false); }
  }

  function onEmojiPick(native: string) { setMsg(m => (m || '') + native); setPickerOpen(false); }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl overflow-hidden">
        {/* Banner */}
        <div className="relative h-40 w-full bg-neutral-800">
          {u?.bannerUrl ? (<img src={String(u.bannerUrl)} alt="banner" className="h-full w-full object-cover" />) : (<div className="h-full w-full brand-login-bg opacity-80" />)}
          <button
            className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/40 text-neutral-200 border border-neutral-700 hover:bg-black/60 flex items-center justify-center"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div className="absolute -bottom-10 left-6 h-20 w-20 rounded-full overflow-hidden border-4 border-neutral-900 bg-neutral-800 flex items-center justify-center">
            {u?.avatarUrl ? (<img src={String(u.avatarUrl)} alt="avatar" className="h-full w-full object-cover" />) : (<span className="text-sm text-neutral-400">{(u?.name||u?.username||'?')[0]?.toUpperCase?.()}</span>)}
          </div>
        </div>
        {/* Body */}
        <div className="pt-14 px-6 pb-6 grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6">
          <div className="min-w-0">
            {loading && <div className="text-neutral-400 text-sm">Loading…</div>}
            {!loading && err && <div className="text-red-400 text-sm">{err}</div>}
            {!!u && (
              <>
                <div className="text-2xl font-semibold text-white">{u.name || u.username || 'User'} {u?.pronouns ? <span className="ml-2 text-base text-neutral-400">({String(u.pronouns)})</span> : null}</div>
                <div className="text-neutral-400">{u.username ? `@${u.username}` : ''}</div>
                {!!miniStatus && (<div className="mt-2 inline-block px-2 py-1 rounded bg-neutral-800 text-neutral-200 text-sm">{miniStatus}</div>)}
                {u.bio && (<div className="mt-4 whitespace-pre-wrap text-neutral-200">{u.bio}</div>)}
                {Array.isArray(u.skills) && u.skills.length>0 && (
                  <div className="mt-4">
                    <div className="text-sm text-neutral-400 mb-2">Skills</div>
                    <div className="flex flex-wrap gap-2">
                      {u.skills.map(s => (<span key={s} className="px-2 py-1 rounded-full border border-neutral-700 text-xs text-neutral-300">#{s}</span>))}
                    </div>
                  </div>
                )}
                {u.socials && Object.keys(u.socials||{}).length>0 && (
                  <div className="mt-4">
                    <div className="text-sm text-neutral-400 mb-2">Links</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(u.socials||{}).map(([k,v]) => v ? (<a key={k} href={String(v)} target="_blank" rel="noreferrer" className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60 text-xs">{k}</a>) : null)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          {/* Sidebar */}
          <div className="min-w-0">
            {!!u && (
              <div className="space-y-4">
                {/* Mutuals */}
                <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-900/60">
                  <div className="text-sm text-neutral-400 mb-2">Mutual friends</div>
                  {mutuals.length === 0 ? (
                    <div className="text-xs text-neutral-500">No mutual friends</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {mutuals.slice(0,12).map(m => (
                        <div key={m.id} className="flex items-center gap-2 p-1 rounded border border-neutral-800 bg-neutral-900/40">
                          <div className="h-6 w-6 rounded-full overflow-hidden bg-neutral-800">
                            {m.avatarUrl ? <img src={m.avatarUrl} alt="mf" className="h-full w-full object-cover"/> : null}
                          </div>
                          <div className="text-xs text-neutral-300 max-w-[8rem] truncate">{m.name || m.username}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="space-y-2">
                  {u.isFriend ? (
                    <div className="flex items-center gap-2 w-full rounded-full bg-neutral-900 border border-neutral-800 shadow-inner px-5 py-2.5">
                      <input
                        value={msg}
                        onChange={(e)=>setMsg(e.target.value)}
                        onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendQuick(); } }}
                        placeholder="Write a quick message…"
                        className="flex-1 px-3 py-2 bg-transparent text-neutral-100 placeholder-neutral-500 outline-none ring-0 border-0 text-base"
                      />
                      <button
                        className="h-10 w-10 rounded-full text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800/60 flex items-center justify-center"
                        title="Emoji" aria-label="Emoji"
                        onClick={()=>setPickerOpen(true)}
                      >
                        <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className='h-6 w-6'>
                          <circle cx='12' cy='12' r='9'/>
                          <path d='M8 14s1.5 2 4 2 4-2 4-2'/>
                          <path d='M9 9h.01M15 9h.01'/>
                        </svg>
                      </button>
                      <button
                        className="h-10 w-10 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white flex items-center justify-center"
                        onClick={sendQuick}
                        title="Send" aria-label="Send"
                        disabled={busy || !msg.trim()}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                          <path d="M22 2L11 13"/>
                          <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
                        </svg>
                      </button>
                    </div>
                  ) : u.incomingRequestId ? (
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 rounded border border-emerald-700 text-emerald-200 hover:bg-emerald-900/20 text-sm" onClick={accept} disabled={busy}>Accept</button>
                      <button className="px-3 py-1.5 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/40 text-sm" onClick={decline} disabled={busy}>Decline</button>
                    </div>
                  ) : u.outgoingRequestId ? (
                    <div className="text-xs text-neutral-400">Friend request sent</div>
                  ) : (
                    <button className="px-3 py-1.5 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/70 text-sm w-full" onClick={addFriend} disabled={busy}>Add Friend</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Minimal emoji picker overlay (fallback) */}
      {pickerOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center" onClick={()=>setPickerOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl p-2" onClick={(e)=>e.stopPropagation()}>
            <div className="flex gap-1">
              {['🙂','😂','🔥','❤️','👍','🎉','😎','🤝'].map(e => (
                <button key={e} className="px-2 py-1 text-neutral-200 hover:bg-neutral-800 rounded" onClick={()=>onEmojiPick(e)}>{e}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

