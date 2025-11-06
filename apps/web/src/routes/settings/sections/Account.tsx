import { useEffect, useState } from "react";
import SettingRow from "../../../components/settings/SettingRow";
import ConfirmDialog from "../../../components/settings/ConfirmDialog";
import { SettingsModel } from "../../../lib/settings/schema";
import { patchMySettingsSection } from "../../../lib/settings/api";
import { api } from "../../../lib/api";

export default function AccountSection({ data, bridge }: { data: SettingsModel; bridge: { setDirty: (d:boolean)=>void; setSaveHandler: (fn: (()=>Promise<void>|void)|null)=>void; setResetHandler: (fn:(()=>void)|null)=>void; } }) {
  const initial = { email: data.account.email ?? "", twoFactorEnabled: !!data.account.twoFactorEnabled };
  const [email, setEmail] = useState(initial.email);
  const [twoFA, setTwoFA] = useState(initial.twoFactorEnabled);
  const [showChangePass, setShowChangePass] = useState(false);
  const [memberSince, setMemberSince] = useState<string>("");

  const dirty = email !== initial.email || twoFA !== initial.twoFactorEnabled;

  useEffect(() => {
    bridge.setDirty(dirty);
  }, [dirty]);

  useEffect(() => {
    bridge.setSaveHandler(async () => {
      await patchMySettingsSection("account", { email, twoFactorEnabled: twoFA });
    });
    bridge.setResetHandler(() => {
      setEmail(initial.email); setTwoFA(initial.twoFactorEnabled);
    });
    return () => { bridge.setSaveHandler(null); bridge.setResetHandler(null); };
  }, [email, twoFA]);

  // Load Member since (account creation date) from server
  useEffect(() => {
    let mounted = true;
    const tok = (() => { try { return localStorage.getItem('token'); } catch { return null; } })();
    if (!tok) return;
    (async () => {
      try {
        const u = await api.getAuth('/users/me', tok);
        if (!mounted) return;
        if (u && u.createdAt) {
          const d = new Date(u.createdAt);
          setMemberSince(isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
        }
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Account" description="Manage your email and security." />
        <CardBody>
          <SettingRow
            label="Member since"
            control={<div className="text-white/80">{memberSince || '—'}</div>}
          />
          <div className="h-2" />
          <SettingRow
            label="Email"
            htmlFor="acc-email"
            control={
              <div className="flex items-center gap-2">
                <input id="acc-email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@example.com" className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />
                <button className="shrink-0 rounded-lg bg-white/10 hover:bg-white/15 text-white px-3 py-2 text-sm" onClick={()=>alert("Verification email sent (stub)")}>Verify</button>
              </div>
            }
          />
          <div className="h-2" />
          <SettingRow
            label="Password"
            hint="Change your password"
            control={<button className="rounded-lg bg-white/10 hover:bg-white/15 text-white px-3 py-2 text-sm" onClick={()=>setShowChangePass(true)}>Change password…</button>}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Two-Factor" description="Add an extra layer of security." />
        <CardBody>
          <SettingRow
            label="Two-factor authentication"
            tooltip="Use an authenticator app to protect your account"
            control={<Switch checked={twoFA} onChange={setTwoFA} />}
          />
        </CardBody>
      </Card>

      <ConfirmDialog
        open={showChangePass}
        title="Change password"
        description="A reset link will be sent to your email."
        confirmText="Send link"
        onConfirm={()=>{ setShowChangePass(false); alert("Password reset email sent (stub)"); }}
        onCancel={()=>setShowChangePass(false)}
      />
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-white/10 bg-black/30 shadow-sm">{children}</section>;
}
function CardHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="px-4 pt-4 pb-2">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {description ? <p className="text-sm text-white/60">{description}</p> : null}
    </div>
  );
}
function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pb-4">{children}</div>;
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v:boolean)=>void }) {
  return (
    <button
      role="switch" aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors focus:outline-none focus-visible:ring-2 ${checked ? "bg-emerald-500" : "bg-white/20"}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}
