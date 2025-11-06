import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Member = { id: string; name?: string; username?: string; avatarUrl?: string | null; role?: string };

export default function SpaceMembersSection({ token, spaceId }: { token: string; spaceId: string }) {
  const [spaceMembers, setSpaceMembers] = useState<Member[]>([]);
  const [selfId, setSelfId] = useState<string>('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const isDmSpace = String(spaceId||'').startsWith('dm_');
  const isOwner = !isDmSpace && (spaceMembers.find(m => m.id === selfId)?.role === 'owner');

  useEffect(() => { (async()=>{ try{ const me=await api.getAuth('/users/me', token); if(me?.id) setSelfId(me.id); }catch{} })(); }, [token]);
  useEffect(() => { if (isDmSpace) return; (async()=>{ try{ const res=await api.getAuth(`/spaces/members?spaceId=${encodeURIComponent(spaceId)}`, token); setSpaceMembers(res.members||[]); }catch{} })(); }, [token, spaceId, isDmSpace]);

  async function removeMember(uid: string){ setBusy(true); setErr(''); try{ await api.deleteAuth('/spaces/members', { spaceId, userId: uid }, token); setSpaceMembers(prev=>prev.filter(x=>x.id!==uid)); } catch(e:any){ setErr(e?.message||'Failed to remove member'); } finally{ setBusy(false);} }

  return (
    <div className="space-y-3">
      <div className="text-emerald-300 font-semibold">Members</div>
      {err && <div className="text-sm text-red-400">{err}</div>}
      <p className="text-sm text-neutral-400">Manage members of this space. Only owners can remove members.</p>
      <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">
        {spaceMembers.map(m => (
          <li key={m.id} className="flex items-center justify-between px-3 py-2 gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <div className="h-7 w-7 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                {m.avatarUrl ? <img src={m.avatarUrl} alt={m.name||m.username||''} className="h-full w-full object-cover"/> : <span className="text-[10px] text-neutral-400">{(m.name?.[0]||m.username?.[0]||'?').toUpperCase()}</span>}
              </div>
              <div className="min-w-0">
                <div className="truncate text-neutral-200 text-sm">{m.name || m.username}</div>
                <div className="text-[11px] text-neutral-500">{m.role || 'member'}</div>
              </div>
            </div>
            {isOwner && m.id !== selfId && m.role !== 'owner' && (
              <button className="px-2 py-1 rounded border border-red-800 text-red-300 hover:bg-red-900/30 text-sm" onClick={()=>removeMember(m.id)}>Remove</button>
            )}
          </li>
        ))}
        {spaceMembers.length === 0 && (
          <li className="px-3 py-2 text-sm text-neutral-500">No members</li>
        )}
      </ul>
    </div>
  );
}

