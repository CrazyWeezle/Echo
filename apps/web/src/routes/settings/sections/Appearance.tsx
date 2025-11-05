import { useEffect, useMemo, useState } from "react";
import SettingRow from "../../../components/settings/SettingRow";
import { SettingsModel } from "../../../lib/settings/schema";
import { patchMySettingsSection } from "../../../lib/settings/api";

const themes = ["system","light","dark"] as const;
const accents = ["emerald","blue","purple","rose","amber","indigo","cyan","orange"] as const;
const densities = ["compact","comfortable"] as const;

export default function AppearanceSection({ data, bridge }: { data: SettingsModel; bridge: { setDirty: (d:boolean)=>void; setSaveHandler: (fn: (()=>Promise<void>|void)|null)=>void; setResetHandler: (fn:(()=>void)|null)=>void; } }) {
  const initial = { ...data.appearance };
  const [theme, setTheme] = useState<typeof themes[number]>(initial.theme);
  const [accent, setAccent] = useState<typeof accents[number]>(initial.accent);
  const [density, setDensity] = useState<typeof densities[number]>(initial.density);

  // Instant apply for safe prefs
  useEffect(() => {
    if (theme === "light") document.documentElement.classList.remove("dark");
    if (theme === "dark") document.documentElement.classList.add("dark");
    if (theme === "system") document.documentElement.classList.toggle("dark", window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, [theme]);
  useEffect(() => {
    try { document.documentElement.setAttribute('data-theme', accent); } catch {}
  }, [accent]);

  const dirty = useMemo(() => theme !== initial.theme || accent !== initial.accent || density !== initial.density, [theme, accent, density]);
  useEffect(() => { bridge.setDirty(dirty); }, [dirty]);

  useEffect(() => {
    bridge.setSaveHandler(async () => {
      await patchMySettingsSection("appearance", { theme, accent, density });
    });
    bridge.setResetHandler(() => { setTheme(initial.theme); setAccent(initial.accent); setDensity(initial.density); });
    return () => { bridge.setSaveHandler(null); bridge.setResetHandler(null); };
  }, [theme, accent, density]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Appearance" description="Theme, accent color and density." />
        <CardBody>
          <SettingRow
            label="Theme"
            control={
              <Segmented value={theme} onChange={setTheme} options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]} />
            }
          />
          <div className="h-2" />
          <SettingRow
            label="Accent color"
            control={<ColorDots value={accent} onChange={setAccent} />}
          />
          <div className="h-2" />
          <SettingRow
            label="Density"
            control={<Segmented value={density} onChange={setDensity} options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }]} />}
          />
        </CardBody>
      </Card>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <section className="rounded-2xl border border-white/10 bg-black/30 shadow-sm">{children}</section>; }
function CardHeader({ title, description }: { title: string; description?: string }) { return <div className="px-4 pt-4 pb-2"><h2 className="text-base font-semibold text-white">{title}</h2>{description ? <p className="text-sm text-white/60">{description}</p> : null}</div>; }
function CardBody({ children }: { children: React.ReactNode }) { return <div className="px-4 pb-4">{children}</div>; }

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v:T)=>void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-0.5">
      {options.map(opt => (
        <button key={opt.value} onClick={()=>onChange(opt.value)} className={`px-3 py-1.5 text-sm rounded-lg ${value === opt.value ? 'bg-emerald-500 text-white' : 'text-white/80 hover:bg-white/10'}`}>{opt.label}</button>
      ))}
    </div>
  );
}

function ColorDots({ value, onChange }: { value: string; onChange: (v:any)=>void }) {
  const colors: { key: string; class: string }[] = [
    { key: 'emerald', class: 'bg-emerald-500' },
    { key: 'blue', class: 'bg-blue-500' },
    { key: 'purple', class: 'bg-purple-500' },
    { key: 'rose', class: 'bg-rose-500' },
    { key: 'amber', class: 'bg-amber-500' },
    { key: 'indigo', class: 'bg-indigo-500' },
    { key: 'cyan', class: 'bg-cyan-500' },
    { key: 'orange', class: 'bg-orange-500' },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map(c => (
        <button key={c.key} aria-label={c.key} onClick={()=>onChange(c.key)} className={`h-7 w-7 rounded-full ring-2 ${value === c.key ? 'ring-white' : 'ring-transparent'} ${c.class}`} />
      ))}
    </div>
  );
}

