import React, { useState } from 'react';
import ChangePassword from '../ChangePassword';
import { api } from '../../lib/api';
import { askConfirm } from '../../lib/ui';
import SectionCard from './SectionCard';

export default function SecuritySection({ token }: { token: string }) {
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [showLastOnline, setShowLastOnline] = useState<boolean>(()=>{ try { return localStorage.getItem('showLastOnline') !== '0'; } catch { return true; } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  return (
    <div className="space-y-4">
      {err && <div className="text-sm text-red-400">{err}</div>}

      <SectionCard title="Privacy" description="Control what friends can see about your status." noBorder>
        <label className="flex items-center justify-between px-3 py-2 rounded-lg bg-black/20 border border-neutral-800/60">
          <span className="text-neutral-200">Let friends see your last online status</span>
          <input
            type="checkbox"
            checked={showLastOnline}
            onChange={async (e)=>{
              const on = e.target.checked;
              setShowLastOnline(on);
              try { localStorage.setItem('showLastOnline', on ? '1' : '0'); } catch {}
              // Attempt to persist to the server so others can respect it
              try { await api.patchAuth('/users/me', { shareLastOnline: on }, token); } catch {}
            }}
          />
        </label>
      </SectionCard>

      <SectionCard title="Password" description="Update your password to secure your account." noBorder>
        {!showChangePwd ? (
          <button className="px-3 py-2 rounded-lg border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setShowChangePwd(true)}>Change password</button>
        ) : (
          <div className="p-2 rounded-lg border border-neutral-800 bg-neutral-900">
            <ChangePassword token={token} onSuccess={() => { try { localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('me'); } catch {}; location.reload(); }} />
            <div className="mt-2 text-right">
              <button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={()=>setShowChangePwd(false)}>Close</button>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Danger Zone" description="This action is permanent and cannot be undone." destructive>
        <button
          className="px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-60"
          onClick={async ()=>{
            const ok = await askConfirm({ title:'Delete Account', message:'This will permanently delete your account and all associated data. This cannot be undone.', confirmText:'Delete' });
            if(!ok) return; setBusy(true); setErr('');
            try { await api.request('/users/me', { method: 'DELETE', token }); } catch(e:any){ setErr(e?.message||'Failed to delete account'); }
            finally { setBusy(false); }
            try { localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('me'); } catch {};
            location.reload();
          }}
          disabled={busy}
        >Delete account</button>
      </SectionCard>
    </div>
  );
}
