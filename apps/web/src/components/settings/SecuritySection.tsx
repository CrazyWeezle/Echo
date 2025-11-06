import React, { useState } from 'react';
import ChangePassword from '../ChangePassword';
import { api } from '../../lib/api';
import { askConfirm } from '../../lib/ui';

export default function SecuritySection({ token }: { token: string }) {
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [showLastOnline, setShowLastOnline] = useState<boolean>(()=>{ try { return localStorage.getItem('showLastOnline') !== '0'; } catch { return true; } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  return (
    <div className="space-y-4">
      <div className="text-emerald-300 font-semibold">Security</div>
      {err && <div className="text-sm text-red-400">{err}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-neutral-300 font-medium">Privacy</div>
          <label className="flex items-center justify-between px-2 py-2 rounded border border-neutral-800 bg-neutral-900/50">
            <span className="text-neutral-200">Show "last online" timestamp</span>
            <input type="checkbox" checked={showLastOnline} onChange={(e)=>{ setShowLastOnline(e.target.checked); try { localStorage.setItem('showLastOnline', e.target.checked ? '1' : '0'); } catch {} }} />
          </label>
        </div>
        <div className="space-y-2">
          <div className="text-neutral-300 font-medium">Change password</div>
          {!showChangePwd && (
            <button className="w-full text-left px-2 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>setShowChangePwd(true)}>Open change password</button>
          )}
          {showChangePwd && (
            <div className="p-2 rounded border border-neutral-800 bg-neutral-900">
              <ChangePassword token={token} onSuccess={() => { try { localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('me'); } catch {}; location.reload(); }} />
              <div className="mt-2 text-right">
                <button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={()=>setShowChangePwd(false)}>Close</button>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="text-neutral-300 font-medium">Sessions</div>
          <button
            className="w-full text-left px-2 py-2 rounded border border-red-900 text-red-400 hover:bg-red-900/30"
            onClick={async ()=>{
              const ok = await askConfirm({ title:'Deactivate Account', message:'Deactivate your account? You will be signed out.', confirmText:'Deactivate' });
              if(!ok) return; setBusy(true); setErr('');
              try{ await api.postAuth('/users/deactivate', {}, token); } catch(e:any){ setErr(e?.message||'Failed to deactivate'); }
              finally { setBusy(false); }
              try { localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('me'); } catch {};
              location.reload();
            }}
            disabled={busy}
          >Deactivate account</button>
        </div>
      </div>
    </div>
  );
}

