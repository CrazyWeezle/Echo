import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import CloseButton from './CloseButton';

export default function MemberProfileModal({ token, userId, open, onClose, onStartDm }: { token: string; userId: string; open: boolean; onClose: () => void; onStartDm: (userId: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [u, setU] = useState<any>(null);

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true); setErr('');
    (async () => {
      try {
        const q = new URLSearchParams({ userId });
        const res = await api.getAuth(`/users/profile?${q.toString()}`, token);
        setU(res);
      } catch (e: any) {
        setErr(e?.message || 'Failed to load');
      } finally { setLoading(false); }
    })();
  }, [open, userId, token]);

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
      <div className="relative w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-emerald-300">Profile</h2>
          <CloseButton onClick={onClose} />
        </div>
        {err && <div className="mb-2 text-sm text-red-400">{err}</div>}
        {(!u || loading) ? (
          <div className="p-3 text-neutral-400">Loading...</div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-14 w-14 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                {u.avatarUrl ? <img src={u.avatarUrl} alt={u.name || u.username} className="h-full w-full object-cover"/> : <span className="text-[10px] text-neutral-400">{(u.name?.[0]||u.username?.[0]||'?').toUpperCase()}</span>}
              </div>
              <div>
                <div className="text-lg font-semibold" style={u.nameColor?{color:u.nameColor}:undefined}>{u.name || u.username}</div>
                <div className="text-xs text-neutral-500">{u.status || ''}</div>
                {u.pronouns && <div className="text-xs text-neutral-400">{u.pronouns}</div>}
              </div>
            </div>
            {u.bio && <div className="text-neutral-200 whitespace-pre-wrap">{u.bio}</div>}
            <div className="grid grid-cols-1 gap-2 text-sm text-neutral-300">
              {u.website && <div><span className="text-neutral-500">Website:</span> <a className="text-emerald-300 hover:underline" href={u.website} target="_blank" rel="noreferrer">{u.website}</a></div>}
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-neutral-800">
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
          </div>
        )}
      </div>
    </div>
  );
}

