import React, { useEffect, useRef, useState } from 'react';
import CloseButton from './CloseButton';
import { api, signUpload } from '../lib/api';
import { askConfirm, toast } from '../lib/ui';

type Channel = { id: string; name: string };

export default function SpaceSettingsModal({
  token,
  spaceId,
  spaceName,
  spaceAvatarUrl,
  channels,
  open,
  onClose,
  onRefreshSpaces,
  onRefreshChannels,
  onSwitchToChannel,
  onSpaceDeleted,
  onJoinSpace,
}: {
  token: string;
  spaceId: string;
  spaceName?: string;
  spaceAvatarUrl?: string | null;
  channels: Channel[];
  open: boolean;
  onClose: () => void;
  onRefreshSpaces: () => void;
  onRefreshChannels: (spaceId: string) => void;
  onSwitchToChannel: (channelId: string) => void;
  onSpaceDeleted: () => void;
  onJoinSpace: (spaceId: string) => void;
}) {
  const [tab, setTab] = useState<'general'|'channels'|'invites'>('general');
  const [name, setName] = useState(spaceName || '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(spaceAvatarUrl || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setName(spaceName || ''); setAvatarUrl(spaceAvatarUrl || null); setErr(''); setTab('general'); } }, [open, spaceName, spaceAvatarUrl]);

  async function saveGeneral() {
    setBusy(true); setErr('');
    try {
      await api.patchAuth('/spaces', { spaceId, name, avatarUrl }, token);
      onRefreshSpaces();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save');
    } finally { setBusy(false); }
  }

  async function pickImage(files: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0];
    try {
      const up = await signUpload({ filename: f.name, contentType: f.type || 'application/octet-stream', size: f.size }, token);
      await fetch(up.url, { method: 'PUT', headers: up.headers, body: f });
      setAvatarUrl(up.publicUrl);
    } catch (e: any) {
      setErr(e?.message || 'Upload failed');
    } finally { if (fileRef.current) fileRef.current.value = ''; }
  }

  async function deleteSpace() {
    const ok = await askConfirm({ title: 'Delete Space', message: 'Delete this space? This cannot be undone.', confirmText: 'Delete' });
    if (!ok) return;
    setBusy(true); setErr('');
    try {
      await api.deleteAuth('/spaces', { spaceId }, token);
      onSpaceDeleted();
      onRefreshSpaces();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Failed to delete space');
    } finally { setBusy(false); }
  }

  async function leaveSpace() {
    const ok = await askConfirm({ title: 'Leave Space', message: 'Leave this space? You will lose access until re-invited.', confirmText: 'Leave' });
    if (!ok) return;
    setBusy(true); setErr('');
    try {
      await api.postAuth('/spaces/leave', { spaceId }, token);
      onSpaceDeleted();
      onRefreshSpaces();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Failed to leave space');
    } finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    try {
      await fetch(`/api/auth/logout`, { method: 'POST' });
    } catch {}
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('me');
    } catch {}
    window.location.reload();
  }

  const [newChan, setNewChan] = useState('');
  async function addChannel() {
    const nm = newChan.trim();
    if (!nm) return;
    setBusy(true); setErr('');
    try {
      const res = await api.postAuth('/channels', { spaceId, name: nm }, token);
      setNewChan('');
      onRefreshChannels(spaceId);
      onSwitchToChannel(res.id);
    } catch (e: any) {
      setErr(e?.message || 'Failed to create channel');
    } finally { setBusy(false); }
  }

  async function removeChannel(cid: string) {
    const ok = await askConfirm({ title: 'Delete Channel', message: 'Delete this channel?', confirmText: 'Delete' });
    if (!ok) return;
    setBusy(true); setErr('');
    try {
      await api.postAuth('/channels/delete', { spaceId, channelId: cid }, token);
      onRefreshChannels(spaceId);
    } catch (e: any) {
      setErr(e?.message || 'Failed to delete channel');
    } finally { setBusy(false); }
  }

  async function renameChannel(cid: string) {
    const nm = prompt('New channel name');
    if (!nm) return;
    setBusy(true); setErr('');
    try {
      await api.postAuth('/channels/rename', { spaceId, channelId: cid, name: nm }, token);
      onRefreshChannels(spaceId);
    } catch (e: any) {
      setErr(e?.message || 'Failed to rename channel');
    } finally { setBusy(false); }
  }

  // Invites
  const [maxUses, setMaxUses] = useState<number>(1);
  const [expires, setExpires] = useState<string>('');
  const [inviteCode, setInviteCode] = useState<string>('');
  const [customCode, setCustomCode] = useState<string>('');
  async function createInvite() {
    setBusy(true); setErr(''); setInviteCode('');
    try {
      const hours = expires.trim() === '' ? undefined : (Number(expires) || undefined);
      const c = customCode.trim();
      if (!c) { setErr('Please enter an invite code'); return; }
      const { code } = await api.postAuth('/spaces/invite', { spaceId, maxUses, expiresInHours: hours, code: c }, token);
      setInviteCode(code);
      try { await navigator.clipboard.writeText(code); } catch {}
      toast('Invite created and copied', 'success');
    } catch (e: any) {
      setErr(e?.message || 'Failed to create invite');
    } finally { setBusy(false); }
  }

  const [joinCode, setJoinCode] = useState('');
  async function joinByCode() {
    const c = joinCode.trim(); if (!c) return;
    setBusy(true); setErr('');
    try {
      const { spaceId: sid } = await api.postAuth('/invites/accept', { code: c }, token);
      onRefreshSpaces();
      onJoinSpace(sid);
    } catch (e: any) {
      setErr(e?.message || 'Failed to join');
    } finally { setBusy(false); }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-2xl rounded-xl border border-neutral-800 bg-neutral-900 p-0 shadow-xl">
        <div className="flex items-center justify-between px-4 h-12 border-b border-neutral-800">
          <div className="font-semibold text-emerald-300">Space Settings</div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="flex">
          <div className="w-40 border-r border-neutral-800 p-2 space-y-1 flex flex-col">
            <button className={`w-full text-left px-2 py-1 rounded ${tab==='general'?'bg-neutral-800':''}`} onClick={()=>setTab('general')}>
              {name || spaceName || 'General'}
            </button>
            <button className={`w-full text-left px-2 py-1 rounded ${tab==='channels'?'bg-neutral-800':''}`} onClick={()=>setTab('channels')}>Channels</button>
            <button className={`w-full text-left px-2 py-1 rounded ${tab==='invites'?'bg-neutral-800':''}`} onClick={()=>setTab('invites')}>Invites</button>
            <div className="mt-auto pt-2 border-t border-neutral-800"></div>
            <button className="w-full text-left px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={logout}>Log out</button>
          </div>
          <div className="flex-1 p-4 space-y-4">
            {err && <div className="text-sm text-red-400">{err}</div>}

            {tab === 'general' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                    {avatarUrl ? <img src={avatarUrl} alt="space" className="h-full w-full object-cover" /> : <span className="text-neutral-500">No image</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>fileRef.current?.click()}>Upload</button>
                    {avatarUrl && <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setAvatarUrl(null)}>Remove</button>}
                    <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e=>pickImage(e.target.files)} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-neutral-400 mb-1">Name</label>
                  <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={name} onChange={e=>setName(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <button disabled={busy} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={saveGeneral}>{busy? 'Saving…' : 'Save changes'}</button>
                  <div className="ml-auto flex items-center gap-2">
                    <button disabled={busy} className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={leaveSpace}>Leave space</button>
                    <button disabled={busy} className="px-3 py-2 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={deleteSpace}>Delete space</button>
                  </div>
                </div>
              </div>
            )}

            {tab === 'channels' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input className="flex-1 p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="New channel name" value={newChan} onChange={e=>setNewChan(e.target.value)} />
                  <button disabled={busy} className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={addChannel}>Add</button>
                </div>
                <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">
                  {channels.map(c => (
                    <li key={c.id} className="flex items-center justify-between px-3 py-2 gap-2">
                      <div className="truncate">#{c.name}</div>
                      <div className="flex items-center gap-2">
                        <button disabled={busy} className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>renameChannel(c.id)}>Rename</button>
                        <button disabled={busy} className="px-2 py-1 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={()=>removeChannel(c.id)}>Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'invites' && (
              <div className="space-y-4">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-sm text-neutral-400 mb-1">Invite code</label>
                    <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800"
                           placeholder="e.g. TEAM-ALPHA or myspace2025"
                           value={customCode}
                           onChange={e=>setCustomCode(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-sm text-neutral-400 mb-1">Max uses</label>
                    <input className="w-32 p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800" type="number" min={1} value={maxUses} onChange={e=>setMaxUses(Number(e.target.value)||1)} />
                  </div>
                  <div>
                    <label className="block text-sm text-neutral-400 mb-1">Expires in hours (optional)</label>
                    <input className="w-48 p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800" type="number" min={1} placeholder="e.g. 24" value={expires} onChange={e=>setExpires(e.target.value)} />
                  </div>
                  <button disabled={busy} className="ml-auto px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={createInvite}>Create invite</button>
                </div>
                {inviteCode && (
                  <div className="p-3 rounded border border-neutral-800 bg-neutral-900">
                    <div className="text-sm text-neutral-400 mb-1">Invite code</div>
                    <div className="font-mono text-lg">{inviteCode}</div>
                  </div>
                )}
                <div className="h-px w-full bg-neutral-800" />
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-sm text-neutral-400 mb-1">Join a space by code</label>
                    <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800" placeholder="Enter invite code" value={joinCode} onChange={e=>setJoinCode(e.target.value)} />
                  </div>
                  <button disabled={busy} className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={joinByCode}>Join</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


