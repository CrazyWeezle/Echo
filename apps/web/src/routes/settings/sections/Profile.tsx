import { useEffect, useMemo, useRef, useState } from "react";
import SettingRow from "../../../components/settings/SettingRow";
import { SettingsModel } from "../../../lib/settings/schema";
import { api, signUpload } from "../../../lib/api";

export default function ProfileSection({ data, bridge }: { data: SettingsModel; bridge: { setDirty: (d:boolean)=>void; setSaveHandler: (fn: (()=>Promise<void>|void)|null)=>void; setResetHandler: (fn:(()=>void)|null)=>void; } }) {
  const [initial, setInitial] = useState({ name: "", bio: "", avatarUrl: "", bannerUrl: "", pronouns: "" });
  const [displayName, setDisplayName] = useState("");
  // Status is the first line of bio for display in the People column
  const [statusText, setStatusText] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>("");
  const [bannerUrl, setBannerUrl] = useState<string | null>("");
  const [pronouns, setPronouns] = useState("");

  // Load from users endpoint
  useEffect(() => {
    let mounted = true;
    const token = (() => { try { return localStorage.getItem('token'); } catch { return null; } })();
    if (!token) return;
    (async () => {
      try {
        const u = await api.getAuth('/users/me', token);
        if (!mounted) return;
        const init = { name: u.name || "", bio: u.bio || "", avatarUrl: u.avatarUrl || "", bannerUrl: u.bannerUrl || "", pronouns: u.pronouns || "" };
        setInitial(init);
        setDisplayName(init.name);
        // Split bio into status (first line) and remaining bio
        const fullBio = String(init.bio || "");
        const [first, ...rest] = fullBio.split(/\r?\n/);
        setStatusText(first || "");
        setBio(rest.join("\n"));
        setAvatarUrl(init.avatarUrl);
        setBannerUrl(init.bannerUrl);
        setPronouns(init.pronouns);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  const dirty = useMemo(() => (
    displayName !== initial.name ||
    // Recombine status+bio to compare
    (statusText + (bio ? "\n" + bio : "")) !== (initial.bio || "") ||
    (avatarUrl||"") !== (initial.avatarUrl||"") ||
    (bannerUrl||"") !== (initial.bannerUrl||"") ||
    pronouns !== (initial.pronouns||"")
  ), [displayName, statusText, bio, avatarUrl, bannerUrl, pronouns, initial]);
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  useEffect(() => { bridge.setDirty(dirty); }, [dirty]);

  useEffect(() => {
    bridge.setSaveHandler(async () => {
      const token = (() => { try { return localStorage.getItem('token'); } catch { return null; } })();
      if (!token) return;
      const combinedBio = (statusText || bio) ? [statusText, bio].filter(Boolean).join('\n') : '';
      await api.patchAuth('/users/me', { name: displayName, bio: combinedBio, avatarUrl, bannerUrl, pronouns }, token);
    });
    bridge.setResetHandler(() => {
      setDisplayName(initial.name);
      const [first, ...rest] = String(initial.bio||"").split(/\r?\n/);
      setStatusText(first||"");
      setBio(rest.join("\n"));
      setAvatarUrl(initial.avatarUrl||"");
      setBannerUrl(initial.bannerUrl||"");
      setPronouns(initial.pronouns||"");
    });
    return () => { bridge.setSaveHandler(null); bridge.setResetHandler(null); };
  }, [displayName, statusText, bio, avatarUrl, bannerUrl, pronouns, initial]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Profile" description="How others see you in ECHO." />
        <CardBody>
          <SettingRow label="Display name" htmlFor="pf-name" control={<input id="pf-name" value={displayName} onChange={e=>setDisplayName(e.target.value)} className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs text-neutral-400 mb-1">Avatar image</label>
              <div className="flex items-center gap-2">
                <div className="h-12 w-12 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                  {avatarUrl ? <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" /> : <span className="text-xs text-neutral-500">No avatar</span>}
                </div>
                <label className="px-2 py-1 rounded border border-neutral-700 bg-neutral-900/60 text-neutral-200 hover:bg-neutral-900/80 cursor-pointer text-xs">
                  <input type="file" accept="image/*" className="hidden" onChange={async (e)=>{ const f=e.target.files?.[0]; if(!f) return; try{ const tok=localStorage.getItem('token')||''; const up=await signUpload({ filename:f.name, contentType:f.type||'application/octet-stream', size:f.size }, tok); await fetch(up.url,{method:'PUT', headers:up.headers, body:f}); setAvatarUrl(up.publicUrl);} finally { (e.target as HTMLInputElement).value=''; } }} />
                  Upload
                </label>
              </div>
              <input id="pf-ava" value={avatarUrl||""} onChange={e=>setAvatarUrl(e.target.value)} placeholder="https://…" className="mt-2 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">Banner image</label>
              <div className="flex items-center gap-2">
                <div className="h-12 w-full rounded overflow-hidden bg-neutral-800 border border-neutral-700">
                  {bannerUrl ? <img src={bannerUrl} alt="banner" className="h-12 w-full object-cover" /> : <div className="h-12 w-full flex items-center justify-center text-xs text-neutral-500">No banner</div>}
                </div>
                <label className="px-2 py-1 rounded border border-neutral-700 bg-neutral-900/60 text-neutral-200 hover:bg-neutral-900/80 cursor-pointer text-xs shrink-0">
                  <input type="file" accept="image/*" className="hidden" onChange={async (e)=>{ const f=e.target.files?.[0]; if(!f) return; try{ const tok=localStorage.getItem('token')||''; const up=await signUpload({ filename:f.name, contentType:f.type||'application/octet-stream', size:f.size }, tok); await fetch(up.url,{method:'PUT', headers:up.headers, body:f}); setBannerUrl(up.publicUrl);} finally { (e.target as HTMLInputElement).value=''; } }} />
                  Upload
                </label>
              </div>
              <input id="pf-ban" value={bannerUrl||""} onChange={e=>setBannerUrl(e.target.value)} placeholder="https://…" className="mt-2 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
          </div>

          <div className="h-2" />
          <SettingRow label="Status" htmlFor="pf-status" hint="Shown under your name in People list" control={<input id="pf-status" value={statusText} onChange={e=>setStatusText(e.target.value.slice(0,80))} placeholder="e.g. Building cool stuff" className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />} />
          <div className="h-2" />
          <SettingRow label="Pronouns" htmlFor="pf-pronouns" control={<input id="pf-pronouns" value={pronouns} onChange={e=>setPronouns(e.target.value)} placeholder="they/them" className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />} />
          <div className="h-2" />
          <SettingRow label="Bio" htmlFor="pf-bio" hint="Up to 160 characters (excludes Status line)" control={<textarea id="pf-bio" maxLength={160} value={bio} onChange={e=>setBio(e.target.value)} className="w-full h-24 rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-400" />} />
          <p className="text-xs text-white/50 text-right mt-1">{bio.length}/160</p>
        </CardBody>
      </Card>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <section className="rounded-2xl border border-white/10 bg-black/30 shadow-sm">{children}</section>; }
function CardHeader({ title, description }: { title: string; description?: string }) { return <div className="px-4 pt-4 pb-2"><h2 className="text-base font-semibold text-white">{title}</h2>{description ? <p className="text-sm text-white/60">{description}</p> : null}</div>; }
function CardBody({ children }: { children: React.ReactNode }) { return <div className="px-4 pb-4">{children}</div>; }
