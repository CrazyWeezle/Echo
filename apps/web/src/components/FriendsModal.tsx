import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import CloseButton from './CloseButton';

type Friend = { id: string; username?: string; name?: string; avatarUrl?: string | null; status?: string; nameColor?: string | null; lastSeen?: string };
type IncomingReq = { id: string; fromUserId: string; fromUsername?: string; fromName?: string; fromAvatarUrl?: string | null; fromStatus?: string; createdAt?: string };
type OutgoingReq = { id: string; toUserId: string; toUsername?: string; toName?: string; toAvatarUrl?: string | null; toStatus?: string; createdAt?: string };

export default function FriendsModal({ token, open, onClose, onStartDm, onlineIds }: { token: string; open: boolean; onClose: () => void; onStartDm: (userId: string) => void; onlineIds?: string[] }) {
  const [tab, setTab] = useState<'friends' | 'requests' | 'add'>('friends');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<IncomingReq[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingReq[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [newName, setNewName] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const f = await api.getAuth('/friends/list', token);
      setFriends(f.friends || []);
      const r = await api.getAuth('/friends/requests', token);
      setIncoming(r.incoming || []);
      setOutgoing(r.outgoing || []);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (open) { load(); setTab('friends'); } }, [open]);

  async function addFriend() {
    const uname = newName.trim();
    if (!uname) return;
    setLoading(true); setErr('');
    try {
      await api.postAuth('/friends/request', { toUsername: uname }, token);
      setNewName('');
      await load();
      setTab('requests');
    } catch (e: any) {
      setErr(e?.message || 'Failed to send request');
    } finally { setLoading(false); }
  }

  async function respond(id: string, action: 'accept'|'decline') {
    setLoading(true); setErr('');
    try { await api.postAuth('/friends/respond', { requestId: id, action }, token); await load(); }
    catch (e: any) { setErr(e?.message || 'Failed to respond'); }
    finally { setLoading(false); }
  }

  async function removeFriend(uid: string) {
    setLoading(true); setErr('');
    try { await api.deleteAuth('/friends', { userId: uid }, token); await load(); }
    catch (e: any) { setErr(e?.message || 'Failed to remove'); }
    finally { setLoading(false); }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-emerald-300">Friends</h2>
          <CloseButton onClick={onClose} />
        </div>
        {err && <div className="mb-2 text-sm text-red-400">{err}</div>}
        <div className="flex items-center gap-2 mb-3">
          <button className={`px-3 py-1 rounded border ${tab==='friends'?'border-emerald-700 bg-emerald-900/30 text-emerald-200':'border-neutral-800 text-neutral-300'}`} onClick={()=>setTab('friends')}>Friends</button>
          <button className={`px-3 py-1 rounded border ${tab==='requests'?'border-emerald-700 bg-emerald-900/30 text-emerald-200':'border-neutral-800 text-neutral-300'}`} onClick={()=>setTab('requests')}>Requests</button>
          <button className={`px-3 py-1 rounded border ${tab==='add'?'border-emerald-700 bg-emerald-900/30 text-emerald-200':'border-neutral-800 text-neutral-300'}`} onClick={()=>setTab('add')}>Add</button>
        </div>
        {tab === 'friends' && (
          <div className="max-h-[60vh] overflow-auto divide-y divide-neutral-800">
            {loading && friends.length===0 ? <div className="p-3 text-neutral-400">Loading...</div> : null}
            {friends.map(f => {
              const isOnline = !!(onlineIds && onlineIds.includes(f.id));
              const st = String(f.status || '').toLowerCase();
              let label = 'Offline';
              let dot = 'bg-neutral-600';
              if (isOnline) {
                if (st === 'dnd') { label = 'Do Not Disturb'; dot = 'bg-red-500'; }
                else if (st === 'idle') { label = 'Idle'; dot = 'bg-amber-500'; }
                else { label = 'Online'; dot = 'bg-emerald-500'; }
              } else {
                // treat invisible as offline
                label = 'Offline'; dot = 'bg-neutral-600';
              }
              // Respect the other user's preference if provided by the API (`shareLastOnline`),
              // otherwise default to showing last seen for others (viewer preference does not hide it).
              const subjectAllowsLast = (f as any)?.shareLastOnline !== false;
              const _ago = (subjectAllowsLast && !isOnline && (f as any).lastSeen) ? (function(ts){ try { const d=new Date(ts); const s=Math.floor((Date.now()-d.getTime())/1000); if(s<60) return s+'s ago'; const m=Math.floor(s/60); if(m<60) return m+'m ago'; const h=Math.floor(m/60); if(h<24) return h+'h ago'; const dd=Math.floor(h/24); if(dd<7) return dd+'d ago'; return d.toLocaleString(); } catch { return ''; } })(f.lastSeen) : '';
              return (
              <div key={f.id} className="flex items-center justify-between p-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                    {f.avatarUrl ? <img src={f.avatarUrl} alt={f.name||f.username} className="h-full w-full object-cover"/> : <span className="text-[10px] text-neutral-400">{(f.name?.[0]||f.username?.[0]||'?').toUpperCase()}</span>}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate" style={f.nameColor?{color:f.nameColor}:undefined}>{f.name || f.username}</div>
                    <div className="flex items-center gap-1 text-xs text-neutral-500">
                      <span className={`inline-block h-2 w-2 rounded-full ${dot}`}></span>
                      <span>{label}{!isOnline && _ago ? ` - last online ${_ago}` : ""}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-2 py-1 text-sm rounded border border-emerald-700 text-emerald-200 hover:bg-emerald-900/20" onClick={()=>onStartDm(f.id)}>Message</button>
                  <button className="px-2 py-1 text-sm rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/40" onClick={()=>removeFriend(f.id)}>Remove</button>
                </div>
              </div>
            )})}
            {friends.length===0 && !loading && <div className="p-3 text-neutral-500">No friends yet.</div>}
          </div>
        )}
        {tab === 'requests' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded border border-neutral-800">
              <div className="px-3 py-2 border-b border-neutral-800 text-neutral-300">Incoming</div>
              <div className="max-h-[50vh] overflow-auto">
                {incoming.map(r => (
                  <div key={r.id} className="flex items-center justify-between p-2 border-b border-neutral-900/60 last:border-b-0">
                    <div className="min-w-0">
                      <div className="truncate text-neutral-200">{r.fromName || r.fromUsername || r.fromUserId}</div>
                      <div className="text-xs text-neutral-500">{r.fromStatus || ''}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-2 py-1 text-sm rounded border border-emerald-700 text-emerald-200 hover:bg-emerald-900/20" onClick={()=>respond(r.id, 'accept')}>Accept</button>
                      <button className="px-2 py-1 text-sm rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/40" onClick={()=>respond(r.id, 'decline')}>Decline</button>
                    </div>
                  </div>
                ))}
                {incoming.length===0 && <div className="p-3 text-neutral-500">No incoming requests.</div>}
              </div>
            </div>
            <div className="rounded border border-neutral-800">
              <div className="px-3 py-2 border-b border-neutral-800 text-neutral-300">Outgoing</div>
              <div className="max-h-[50vh] overflow-auto">
                {outgoing.map(r => (
                  <div key={r.id} className="p-2 border-b border-neutral-900/60 last:border-b-0">
                    <div className="truncate text-neutral-200">{r.toName || r.toUsername || r.toUserId}</div>
                    <div className="text-xs text-neutral-500">Pending</div>
                  </div>
                ))}
                {outgoing.length===0 && <div className="p-3 text-neutral-500">No outgoing requests.</div>}
              </div>
            </div>
          </div>
        )}
        {tab === 'add' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-neutral-400 mb-1">Add by username</label>
              <div className="flex items-center gap-2">
                <input className="flex-1 p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="username" value={newName} onChange={e=>setNewName(e.target.value)} />
                <button className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" disabled={loading} onClick={addFriend}>{loading ? 'Sending...' : 'Send'}</button>
              </div>
            </div>
            <p className="text-xs text-neutral-500">They'll see your request and can accept or decline.</p>
          </div>
        )}
      </div>
    </div>
  );
}








