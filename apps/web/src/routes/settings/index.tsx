import { useEffect, useMemo, useRef, useState } from "react";
import { SETTINGS_SECTIONS, SectionId, findSection } from "../../lib/settings/registry";
import { defaultSettings, SettingsModel } from "../../lib/settings/schema";
import { fetchMySettings } from "../../lib/settings/api";
import UnsavedBar from "../../components/settings/UnsavedBar";

// Local inline icon set (teal accents)
const Icons: Record<string, JSX.Element> = {
  user: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21a8 8 0 1 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>
  ),
  id: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h4M15 12h4M7 16h10"/></svg>
  ),
  paint: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19.5 11a7.5 7.5 0 1 0-15 0 3.5 3.5 0 0 0 3.5 3.5H12a3.5 3.5 0 1 1 0 7h-2"/></svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 22h4"/></svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>
  ),
  laptop: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>
  ),
  plug: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22v-6"/><path d="M9 7V2"/><path d="M15 7V2"/><rect x="7" y="7" width="10" height="7" rx="2"/></svg>
  ),
  wrench: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a4 4 0 1 0-5.4 5.4l7 7a2 2 0 1 0 2.8-2.8l-7-7z"/></svg>
  ),
};

type SectionBridge = {
  setDirty: (d: boolean) => void;
  setSaveHandler: (fn: (() => Promise<void> | void) | null) => void;
  setResetHandler: (fn: (() => void) | null) => void;
};

// Section components
import AccountSection from "./sections/Account";
import ProfileSection from "./sections/Profile";
import AppearanceSection from "./sections/Appearance";
import NotificationsSection from "./sections/Notifications";
import PrivacySection from "./sections/Privacy";
import DevicesSection from "./sections/Devices";
import IntegrationsSection from "./sections/Integrations";
import AdvancedSection from "./sections/Advanced";

const SectionMap: Record<SectionId, (p: { data: SettingsModel; bridge: SectionBridge }) => JSX.Element> = {
  account: ({ data, bridge }) => <AccountSection data={data} bridge={bridge} />,
  profile: ({ data, bridge }) => <ProfileSection data={data} bridge={bridge} />,
  appearance: ({ data, bridge }) => <AppearanceSection data={data} bridge={bridge} />,
  notifications: ({ data, bridge }) => <NotificationsSection data={data} bridge={bridge} />,
  privacy: ({ data, bridge }) => <PrivacySection data={data} bridge={bridge} />,
  devices: ({ data, bridge }) => <DevicesSection data={data} bridge={bridge} />,
  integrations: ({ data, bridge }) => <IntegrationsSection data={data} bridge={bridge} />,
  advanced: ({ data, bridge }) => <AdvancedSection data={data} bridge={bridge} />,
};

function usePathSection(): [SectionId, (s: SectionId) => void] {
  const get = () => {
    const seg = (location.pathname.split("/").filter(Boolean)[1] ?? "account") as SectionId;
    return (findSection(seg)?.id ?? "account") as SectionId;
  };
  const [sec, setSec] = useState<SectionId>(get());
  useEffect(() => {
    const onPop = () => setSec(get());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const nav = (s: SectionId) => {
    // confirm if dirty
    if ((window as any).__settingsDirty__ && !confirm("You have unsaved changes. Leave without saving?")) return;
    const base = "/settings/" + s;
    if (location.pathname !== base) history.pushState({}, "", base);
    setSec(s);
  };
  return [sec, nav];
}

export default function SettingsRoute() {
  const [section, navigate] = usePathSection();
  const [query, setQuery] = useState("");
  const [openCmd, setOpenCmd] = useState(false);
  const [settings, setSettings] = useState<SettingsModel>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const saveRef = useRef<null | (() => Promise<void> | void)>(null);
  const resetRef = useRef<null | (() => void)>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load settings once
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const s = await fetchMySettings();
        if (!mounted) return;
        setSettings({ ...defaultSettings, ...s });
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load settings");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Command palette hotkey
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpenCmd(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SETTINGS_SECTIONS;
    return SETTINGS_SECTIONS.filter(s =>
      s.label.toLowerCase().includes(q) ||
      (s.keywords?.some(k => k.toLowerCase().includes(q)) ?? false)
    );
  }, [query]);

  const bridge = useMemo<SectionBridge>(() => ({
    setDirty: (d) => { dirtyRef.current = d; (window as any).__settingsDirty__ = d; setDirty(d); },
    setSaveHandler: (fn) => { saveRef.current = fn; },
    setResetHandler: (fn) => { resetRef.current = fn; },
  }), []);

  const doSave = async () => {
    if (!saveRef.current) return;
    setSaving(true);
    try {
      await Promise.resolve(saveRef.current());
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 1200);
    } finally {
      setSaving(false);
    }
  };

  const doReset = () => {
    resetRef.current?.();
    setDirty(false);
  };

  // Block accidental navigation if dirty
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);

  const SectionEl = SectionMap[section];

  return (
    <div className="h-app brand-app-bg text-white/90">
      <div className="mx-auto max-w-6xl h-full flex">
        {/* Sidebar */}
        <aside className="hidden sm:block w-60 shrink-0 p-3">
          <div className="sticky top-3 space-y-3">
            <SearchBox value={query} onChange={setQuery} onFocus={() => setOpenCmd(true)} />
            <nav className="rounded-2xl border border-white/10 bg-black/40 p-1">
              {SETTINGS_SECTIONS.map(s => (
                <button
                  key={s.id}
                  className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/10 ${section === s.id ? "bg-white/10" : ""}`}
                  onClick={() => navigate(s.id)}
                >
                  <span className="text-emerald-400">{Icons[s.icon]}</span>
                  <span className="text-sm">{s.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 p-3 sm:p-4 md:p-6 overflow-y-auto">
          <header className="sm:hidden mb-3 flex items-center gap-2">
            <SearchBox value={query} onChange={setQuery} onFocus={() => setOpenCmd(true)} />
          </header>

          <div className="mb-4">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Settings</h1>
            <p className="text-sm text-white/60">Manage your account, preferences and privacy.</p>
          </div>

          {loading ? (
            <div className="fade-in rounded-2xl border border-white/10 bg-black/30 p-6">Loading…</div>
          ) : error ? (
            <div className="fade-in rounded-2xl border border-white/10 bg-black/30 p-6 text-red-300">{error}</div>
          ) : (
            <div className="fade-in">
              <SectionEl data={settings} bridge={bridge} />
            </div>
          )}
        </main>
      </div>

      <UnsavedBar visible={dirty} onSave={doSave} onReset={doReset} saving={saving} saved={saved} />

      {openCmd && (
        <div className="fixed inset-0 z-40" onClick={() => setOpenCmd(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative z-10 mx-auto mt-24 w-full max-w-xl">
            <div className="rounded-2xl border border-white/10 bg-neutral-900 shadow-xl overflow-hidden mx-3">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search settings…"
                className="w-full bg-transparent px-4 py-3 outline-none text-white placeholder:text-white/50"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpenCmd(false);
                  if (e.key === "Enter") {
                    const first = filtered[0];
                    if (first) { navigate(first.id as SectionId); setOpenCmd(false); }
                  }
                }}
              />
              <div className="max-h-72 overflow-auto">
                {filtered.map(s => (
                  <button key={s.id} className="w-full text-left flex items-center gap-2 px-4 py-2.5 hover:bg-white/5" onClick={() => { navigate(s.id as SectionId); setOpenCmd(false); }}>
                    <span className="text-emerald-400">{Icons[s.icon]}</span>
                    <div>
                      <div className="text-sm text-white">{s.label}</div>
                      {s.description ? <div className="text-xs text-white/60">{s.description}</div> : null}
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && <div className="px-4 py-3 text-sm text-white/60">No results</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchBox({ value, onChange, onFocus }: { value: string; onChange: (v: string) => void; onFocus?: () => void }) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/80">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-white/60" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          placeholder="Search settings (⌘/Ctrl K)"
          className="flex-1 bg-transparent outline-none placeholder:text-white/50"
        />
      </div>
    </div>
  );
}
