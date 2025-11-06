import React, { useEffect, useState } from 'react';
import AccountBannerCard from '../../components/settings/AccountBannerCard';
import SectionCard from '../../components/settings/SectionCard';
import InfoRow from '../../components/settings/InfoRow';
import { getMe, updateMe, disableAccount, deleteAccount } from '../../lib/settings/api';

export default function Account() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [me, setMe] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try { setErr(''); setLoading(true); const tok = token(); if (!tok) throw new Error('Not authenticated'); const u = await getMe(tok); setMe(u); }
      catch (e: any) { setErr(e?.message || 'Failed to load'); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-neutral-400">Loading…</div>;
  if (err) return <div className="text-red-400">{err}</div>;
  if (!me) return null;

  const tok = token();

  return (
    <div className="space-y-6 fade-in">
      <div>
        <h2 className="text-xl font-semibold text-white mb-2">My Account</h2>
        <div className="text-sm text-neutral-400">Manage your profile, login and contact info.</div>
      </div>
      <AccountBannerCard
        name={me.name || ''}
        username={me.username || ''}
        avatarUrl={me.avatarUrl}
        onEdit={() => { /* optional: scroll to profile section */ }}
      />

      <SectionCard title="Account Info">
        <div className="space-y-2">
          <InfoRow label="Display Name" value={me.name} onSave={async (v)=>{ await updateMe({ name: v }, tok!); setMe((m:any)=>({ ...m, name: v })); }} />
          <InfoRow label="Username" value={me.username} onSave={async (v)=>{ await updateMe({ username: v }, tok!); setMe((m:any)=>({ ...m, username: v })); }} />
          <InfoRow label="Email" value={me.email} type="email" mask onSave={async (v)=>{ await updateMe({ email: v }, tok!); setMe((m:any)=>({ ...m, email: v })); }} />
          <InfoRow label="Phone" value={me.phone} type="tel" mask onSave={async (v)=>{ await updateMe({ phone: v }, tok!); setMe((m:any)=>({ ...m, phone: v })); }} />
        </div>
      </SectionCard>

      <SectionCard title="Password & Authentication" description="Secure your account by updating your password and enabling multi-factor authentication.">
        <div className="flex items-center gap-2">
          <button className="h-8 px-3 rounded-lg border border-neutral-700 hover:bg-neutral-800/60">Change Password</button>
          <button className="h-8 px-3 rounded-lg border border-neutral-700 hover:bg-neutral-800/60">Enable Authenticator App</button>
          <button className="h-8 px-3 rounded-lg border border-neutral-700 hover:bg-neutral-800/60">Register Security Key</button>
        </div>
      </SectionCard>

      <SectionCard title="Account Removal" description="Disable or permanently delete your account." destructive>
        <div className="flex items-center gap-2">
          <button className="h-8 px-3 rounded-lg border border-red-800 hover:bg-red-900/40 text-red-200" onClick={async()=>{ await disableAccount(tok!); }}>Disable Account</button>
          <button className="h-8 px-3 rounded-lg bg-red-600 text-white hover:bg-red-500" onClick={async()=>{ if (confirm('Delete your account? This cannot be undone.')) { await deleteAccount(tok!); } }}>Delete Account</button>
        </div>
      </SectionCard>
    </div>
  );
}

function token() { try { return localStorage.getItem('token'); } catch { return null; } }

