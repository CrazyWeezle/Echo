import { useState } from 'react';
import { api } from '../lib/api';

export default function ChangePassword({ token, onSuccess }: { token: string; onSuccess?: () => void }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  async function submit() {
    setErr(''); setOk(false);
    if (newPw.length < 8) { setErr('Password must be at least 8 characters'); return; }
    if (newPw !== confirmPw) { setErr('Passwords do not match'); return; }
    setBusy(true);
    try {
      await api.postAuth('/users/password', { oldPassword: oldPw, newPassword: newPw }, token);
      setOk(true);
      setOldPw(''); setNewPw(''); setConfirmPw('');
      onSuccess?.();
    } catch (e:any) {
      setErr(e?.message || 'Failed to change password');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      {err && <div className="text-sm text-red-400">{err}</div>}
      {ok && <div className="text-sm text-emerald-400">Password changed. You may need to sign in again.</div>}
      <input type="password" placeholder="Current password" className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={oldPw} onChange={e=>setOldPw(e.target.value)} />
      <input type="password" placeholder="New password" className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={newPw} onChange={e=>setNewPw(e.target.value)} />
      <input type="password" placeholder="Confirm new password" className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={confirmPw} onChange={e=>setConfirmPw(e.target.value)} />
      <div className="flex justify-end">
        <button disabled={busy} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={submit}>{busy?'Saving…':'Change password'}</button>
      </div>
    </div>
  );
}

