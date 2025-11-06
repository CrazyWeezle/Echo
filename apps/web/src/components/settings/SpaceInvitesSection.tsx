import React, { useState } from 'react';
import { api } from '../../lib/api';

export default function SpaceInvitesSection({ token, spaceId }: { token: string; spaceId: string }) {
  const [maxUses, setMaxUses] = useState<number>(1);
  const [expires, setExpires] = useState<string>('');
  const [inviteCode, setInviteCode] = useState<string>('');
  const [customCode, setCustomCode] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function createInvite(){
    setBusy(true); setErr('');
    try{
      const hours = expires.trim()===''?undefined:Number(expires)||undefined;
      const codeIn = customCode.trim();
      if (!codeIn) { setErr('Please enter an invite code'); return; }
      const { code } = await api.postAuth('/spaces/invite',{ spaceId, maxUses, expiresInHours: hours, code: codeIn }, token);
      setInviteCode(code);
      try { await navigator.clipboard.writeText(code); } catch {}
    } catch(e:any){ setErr(e?.message||'Failed to create invite'); }
    finally{ setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="text-emerald-300 font-semibold">Invites</div>
      {err && <div className="text-sm text-red-400">{err}</div>}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-sm text-neutral-400 mb-1">Invite code</label>
          <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800" placeholder="e.g. TEAM-ALPHA or myspace2025" value={customCode} onChange={e=>setCustomCode(e.target.value)} />
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
    </div>
  );
}

