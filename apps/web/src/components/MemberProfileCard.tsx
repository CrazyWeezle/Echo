import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

type Profile = {};

export default function MemberProfileCard({
  token,
  userId,
  open,
  anchor,
  onClose,
  onStartDm,
  onOpenFull,
}: {
  token: string;
  userId: string;
  open: boolean;
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  onStartDm: (userId: string) => void;
  onOpenFull?: () => void;
}) {
  const [u, setU] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [quickMsg, setQuickMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!open || !userId) return;
      setLoading(true); setErr('');
      try {
        const q = new URLSearchParams({ userId });
        const res = await api.getAuth(`/users/profile?` + q.toString(), token);
        if (!cancelled) setU(res as Profile);
      } catch (e: any) { if (!cancelled) { setU(null); setErr(e?.message || 'Failed to load profile'); } }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [open, userId, token]);

  if (!open || !anchor) return null;

  const name = (u?.name || u?.username || '') as string;
  const miniStatus = useMemo(() => {
    try {
      const raw = localStorage.getItem('user');
      const me = raw ? JSON.parse(raw) : null;
      if (me && me.id && u?.id && me.id === u.id) {
        const act = localStorage.getItem('profile.activity') || '';
        if (act.trim()) return act.trim().slice(0, 140);
      }
    } catch {}
    const b = String(u?.bio || '').trim();
    return b ? b.split(/\r?\n/)[0].slice(0, 120) : '';
  }, [u?.id, u?.bio]);

  const width = 320; // px
  const height = 280; // approximate; we also clamp after render via CSS overflow
  const pad = 8;
  const left = Math.max(pad, Math.min(anchor.x, (typeof window !== 'undefined' ? window.innerWidth : 1000) - width - pad));
  const top = Math.max(pad, Math.min(anchor.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - height - pad));

  async function addFriend() {
    if (!u || busy) return;
    setBusy(true); setErr('');
    try {
      await api.postAuth('/friends/request', { toUserId: u.id }, token);
      setU({ ...(u as any), outgoingRequestId: 'pending' });
    } catch (e: any) { setErr(e?.message || 'Failed to send request'); }
    finally { setBusy(false); }
  }
  async function accept(id?: string) {
    if (!u || busy) return; const rid = id || u.incomingRequestId; if (!rid) return;
    setBusy(true); setErr('');
    try {
      await api.postAuth('/friends/respond', { requestId: rid, action: 'accept' }, token);
      setU({ ...(u as any), isFriend: true, incomingRequestId: null, outgoingRequestId: null });
    } catch (e: any) { setErr(e?.message || 'Failed to accept'); }
    finally { setBusy(false); }
  }
  async function decline(id?: string) {
    if (!u || busy) return; const rid = id || u.incomingRequestId; if (!rid) return;
    setBusy(true); setErr('');
    try {
      await api.postAuth('/friends/respond', { requestId: rid, action: 'decline' }, token);
      setU({ ...(u as any), incomingRequestId: null });
    } catch (e: any) { setErr(e?.message || 'Failed to decline'); }
    finally { setBusy(false); }
  }

  async function sendQuickMessage() {
    if (!u || !u.isFriend) return;
    const content = quickMsg.trim();
    if (!content) return;
    setBusy(true);
    try {
      const r = await api.postAuth('/dms/start', { userId: u.id }, token);
      onStartDm(u.id);
      try {
        const m = await import('../lib/socket');
        const tempId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? (crypto as any).randomUUID() : String(Date.now());
        const channelId = (r as any)?.channelId || `${(r as any)?.spaceId || ''}:chat`;
        const voidId = (r as any)?.spaceId || '';
        m.socket.emit('message:send', { voidId, channelId, content, tempId, attachments: [] });
      } catch {}
      setQuickMsg('');
    } catch (e: any) { setErr(e?.message || 'Failed to send'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* Card */}
      <div
        className="absolute w-[320px] rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl overflow-hidden"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Banner */}
        <div className="relative h-20 w-full bg-neutral-800">
          {u?.bannerUrl ? (
            <img src={String(u.bannerUrl)} alt="banner" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full brand-login-bg opacity-80" />
          )}
          <div className="absolute -bottom-6 left-4 h-14 w-14 rounded-full overflow-hidden border-2 border-neutral-900 bg-neutral-800 flex items-center justify-center">
            {u?.avatarUrl ? (
              <img src={String(u.avatarUrl)} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-neutral-400">{(name||'?')[0].toUpperCase()}</span>
            )}
          </div>
        </div>
        {/* Body */}
        <div className="pt-7 px-4 pb-3">
          {loading && <div className="text-neutral-400 text-sm">Loading…</div>}
          {!loading && err && <div className="text-red-400 text-xs mb-2">{err}</div>}
          {!!u && (
            <>
              <div className="text-neutral-100 font-semibold leading-tight">{u.name || u.username || 'User'} {u?.pronouns ? <span className="ml-2 text-xs text-neutral-400">({String(u.pronouns)})</span> : null}</div>
              <div className="text-xs text-neutral-400">{u.username ? `@${u.username}` : ''}</div>
              {!!miniStatus && (
                <div className="mt-2 inline-block px-2 py-1 rounded-lg bg-neutral-800/80 text-xs text-neutral-300">
                  {miniStatus}
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                {u.isFriend ? (
                  <div className="flex items-center gap-2 w-full rounded-full bg-neutral-900 border border-neutral-800 px-2 py-1.5">
                    <input
                      value={quickMsg}
                      onChange={(e)=>setQuickMsg(e.target.value)}
                      onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendQuickMessage(); } }}
                      placeholder="Write a quick message…"
                      className="flex-1 px-2 py-2 bg-transparent text-neutral-100 placeholder-neutral-500 outline-none ring-0 border-0 text-sm"
                    />
                    <button
                      type="button"
                      className="shrink-0 h-8 w-8 rounded-full text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800/60 flex items-center justify-center"
                      title="Emoji" aria-label="Emoji"
                      onClick={()=>setQuickMsg(m=> (m||'') + '🙂')}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <circle cx="12" cy="12" r="9"/>
                        <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                        <path d="M9 9h.01M15 9h.01"/>
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 h-8 w-8 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white flex items-center justify-center"
                      title="Send" aria-label="Send"
                      onClick={sendQuickMessage}
                      disabled={busy || !quickMsg.trim()}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <path d="M22 2L11 13"/>
                        <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
                      </svg>
                    </button>
                  </div>
                ) : u.incomingRequestId ? (
                  <>
                    <button className="px-3 py-1.5 rounded border border-emerald-700 text-emerald-200 hover:bg-emerald-900/20 text-sm" onClick={() => accept()} disabled={busy}>Accept</button>
                    <button className="px-3 py-1.5 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/40 text-sm" onClick={() => decline()} disabled={busy}>Decline</button>
                  </>
                ) : u.outgoingRequestId ? (
                  <button className="px-3 py-1.5 rounded border border-neutral-700 text-neutral-300 text-sm" disabled>Request sent</button>
                ) : (
                  <button className="px-3 py-1.5 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/70 text-sm" onClick={addFriend} disabled={busy}>Add Friend</button>
                )}
              </div>
              {!!onOpenFull && (
                <div className="mt-2 pt-2 border-t border-neutral-800 flex justify-center">
                  <button
                    className="px-2 py-1 rounded text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800/50 text-xs"
                    onClick={onOpenFull}
                    aria-label="View full profile"
                  >
                    View full profile
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}



