import { useEffect, useMemo, useRef, useState } from "react";
import SettingRow from "../../../components/settings/SettingRow";
import { SettingsModel } from "../../../lib/settings/schema";
import { api } from "../../../lib/api";

export default function ProfileSection({ data, bridge }: { data: SettingsModel; bridge: { setDirty: (d:boolean)=>void; setSaveHandler: (fn: (()=>Promise<void>|void)|null)=>void; setResetHandler: (fn:(()=>void)|null)=>void; } }) {
  const [initial, setInitial] = useState({ name: "", bio: "", avatarUrl: "", bannerUrl: "" });
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>("");
  const [bannerUrl, setBannerUrl] = useState<string | null>("");

  // Load from users endpoint
  useEffect(() => {
    let mounted = true;
    const token = (() => { try { return localStorage.getItem('token'); } catch { return null; } })();
    if (!token) return;
    (async () => {
      try {
        const u = await api.getAuth('/users/me', token);
        if (!mounted) return;
        const init = { name: u.name || "", bio: u.bio || "", avatarUrl: u.avatarUrl || "", bannerUrl: u.bannerUrl || "" };
        setInitial(init);
        setDisplayName(init.name);
        setBio(init.bio);
        setAvatarUrl(init.avatarUrl);
        setBannerUrl(init.bannerUrl);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  const dirty = useMemo(() => (
    displayName !== initial.name || bio !== initial.bio || (avatarUrl||"") !== (initial.avatarUrl||"") || (bannerUrl||"") !== (initial.bannerUrl||"")
  ), [displayName, bio, avatarUrl, bannerUrl, initial]);
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  useEffect(() => { bridge.setDirty(dirty); }, [dirty]);

  useEffect(() => {
    bridge.setSaveHandler(async () => {
      const token = (() => { try { return localStorage.getItem('token'); } catch { return null; } })();
      if (!token) return;
      await api.patchAuth('/users/me', { name: displayName, bio, avatarUrl, bannerUrl }, token);
    });
    bridge.setResetHandler(() => { setDisplayName(initial.name); setBio(initial.bio); setAvatarUrl(initial.avatarUrl||""); setBannerUrl(initial.bannerUrl||""); });
    return () => { bridge.setSaveHandler(null); bridge.setResetHandler(null); };
  }, [displayName, bio, avatarUrl, bannerUrl, initial]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Profile" description="How others see you in ECHO." />
        <CardBody>
          <SettingRow label="Display name" htmlFor="pf-name" control={<input id="pf-name" value={displayName} onChange={e=>setDisplayName(e.target.value)} className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />} />
          <div className="h-2" />
          <SettingRow label="Avatar URL" htmlFor="pf-ava" control={<input id="pf-ava" value={avatarUrl||""} onChange={e=>setAvatarUrl(e.target.value)} placeholder="https://…" className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />} />
          <div className="h-2" />
          <SettingRow label="Banner URL" htmlFor="pf-ban" control={<input id="pf-ban" value={bannerUrl||""} onChange={e=>setBannerUrl(e.target.value)} placeholder="https://…" className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />} />
          <div className="h-2" />
          <SettingRow label="Bio" htmlFor="pf-bio" hint="Up to 160 characters" control={<textarea id="pf-bio" maxLength={160} value={bio} onChange={e=>setBio(e.target.value)} className="w-full h-24 rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />} />
          <p className="text-xs text-white/50 text-right mt-1">{bio.length}/160</p>
        </CardBody>
      </Card>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <section className="rounded-2xl border border-white/10 bg-black/30 shadow-sm">{children}</section>; }
function CardHeader({ title, description }: { title: string; description?: string }) { return <div className="px-4 pt-4 pb-2"><h2 className="text-base font-semibold text-white">{title}</h2>{description ? <p className="text-sm text-white/60">{description}</p> : null}</div>; }
function CardBody({ children }: { children: React.ReactNode }) { return <div className="px-4 pb-4">{children}</div>; }
