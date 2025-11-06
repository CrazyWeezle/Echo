import React, { useState } from 'react';
import { api } from '../../lib/api';

type Channel = { id: string; name: string; type?: string };

export default function SpaceChannelsSection({ token, spaceId, channels, onRefreshChannels, onSwitchToChannel }: {
  token: string;
  spaceId: string;
  channels: Channel[];
  onRefreshChannels: (spaceId: string) => void;
  onSwitchToChannel: (channelId: string) => void;
}) {
  const [newChan, setNewChan] = useState('');
  const [newChanType, setNewChanType] = useState<'text'|'voice'|'announcement'|'kanban'|'form'|'habit'|'gallery'|'notes'>('text');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function addChannel(){ const nm=newChan.trim(); if(!nm) return; setBusy(true); setErr(''); try{ const res=await api.postAuth('/channels',{ spaceId, name:nm, type:newChanType }, token); setNewChan(''); setNewChanType('text'); onRefreshChannels(spaceId); onSwitchToChannel(res.id);} catch(e:any){ setErr(e?.message||'Failed to create channel'); } finally{ setBusy(false);} }
  async function removeChannel(cid:string){ setBusy(true); setErr(''); try{ await api.postAuth('/channels/delete',{ spaceId, channelId: cid }, token); onRefreshChannels(spaceId);} catch(e:any){ setErr(e?.message||'Failed to delete'); } finally{ setBusy(false);} }
  async function renameChannel(cid:string){ const nm=prompt('New name')?.trim(); if(!nm) return; setBusy(true); setErr(''); try{ await api.postAuth('/channels/rename',{ spaceId, channelId: cid, name: nm }, token); onRefreshChannels(spaceId);} catch(e:any){ setErr(e?.message||'Failed to rename'); } finally{ setBusy(false);} }

  return (
    <div className="space-y-3">
      <div className="text-emerald-300 font-semibold">Channels</div>
      {err && <div className="text-sm text-red-400">{err}</div>}
      <div className="flex gap-2 items-center">
        <input className="flex-1 p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="New channel name" value={newChan} onChange={e=>setNewChan(e.target.value)} />
        <select className="p-2 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800" value={newChanType} onChange={(e)=>setNewChanType((e.target.value as any)||'text')}>
          <option value="text">Text</option>
          <option value="voice">Voice</option>
          <option value="announcement">Announcement</option>
          <option value="kanban">Kanban</option>
          <option value="form">Form</option>
          <option value="habit">Habit Tracker</option>
          <option value="gallery">Photo Gallery</option>
          <option value="notes">Notes</option>
        </select>
        <button disabled={busy} className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={addChannel}>Add</button>
      </div>
      <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">
        {channels.map(c => (
          <li key={c.id} className="flex items-center justify-between px-3 py-2 gap-2">
            <div className="truncate flex items-center gap-2">
              <span className="opacity-70 text-sm">{c.type==='voice' ? '🔊' : c.type==='announcement' ? '📣' : c.type==='kanban' ? '🗂️' : c.type==='form' ? '📝' : '#'}</span>
              <span> {c.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <button disabled={busy} className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>renameChannel(c.id)}>Rename</button>
              <button disabled={busy} className="px-2 py-1 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={()=>removeChannel(c.id)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

