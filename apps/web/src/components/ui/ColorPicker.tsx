import React, { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  value: string; // hex #rrggbb
  onChange: (hex: string) => void;
  onChangeComplete?: (hex: string) => void;
  swatches?: string[];
  className?: string;
};

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').trim();
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return { r, g, b };
}
function rgbToHex(r: number, g: number, b: number) {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) { rp = c; gp = x; bp = 0; }
  else if (h < 120) { rp = x; gp = c; bp = 0; }
  else if (h < 180) { rp = 0; gp = c; bp = x; }
  else if (h < 240) { rp = 0; gp = x; bp = c; }
  else if (h < 300) { rp = x; gp = 0; bp = c; }
  else { rp = c; gp = 0; bp = x; }
  const r = Math.round((rp + m) * 255);
  const g = Math.round((gp + m) * 255);
  const b = Math.round((bp + m) * 255);
  return { r, g, b };
}

export default function ColorPicker({ value, onChange, onChangeComplete, swatches }: Props) {
  const { r, g, b } = useMemo(() => hexToRgb(value || '#22c55e'), [value]);
  const initial = useMemo(() => rgbToHsv(r, g, b), [r, g, b]);
  const [h, setH] = useState(initial.h);
  const [s, setS] = useState(initial.s);
  const [v, setV] = useState(initial.v);
  const svRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);
  const latestHSV = useRef({ h: initial.h, s: initial.s, v: initial.v });

  useEffect(() => {
    const rgb = hsvToRgb(h, s, v);
    onChange(rgbToHex(rgb.r, rgb.g, rgb.b));
  }, [h, s, v]);

  useEffect(() => {
    // external value change sync
    const { r, g, b } = hexToRgb(value || '#22c55e');
    const hsv = rgbToHsv(r, g, b);
    setH(hsv.h);
    setS(hsv.s);
    setV(hsv.v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    latestHSV.current = { h, s, v };
  }, [h, s, v]);

  const commitChange = () => {
    const { h: hh, s: ss, v: vv } = latestHSV.current;
    const rgb = hsvToRgb(hh, ss, vv);
    onChangeComplete?.(rgbToHex(rgb.r, rgb.g, rgb.b));
  };

  function updateSVFromPoint(clientX: number, clientY: number) {
    if (!svRef.current) return;
    const rect = svRef.current.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);
    const nextS = clamp(x / rect.width, 0, 1);
    const nextV = clamp(1 - y / rect.height, 0, 1);
    setS(nextS);
    setV(nextV);
    latestHSV.current = { h: latestHSV.current.h, s: nextS, v: nextV };
  }

  function startDragSVMouse(e: React.MouseEvent) {
    e.preventDefault();
    updateSVFromPoint(e.clientX, e.clientY);
    const move = (ev: MouseEvent) => {
      ev.preventDefault();
      updateSVFromPoint(ev.clientX, ev.clientY);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      commitChange();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function startDragSVTouch(e: React.TouchEvent) {
    if (!e.touches[0]) return;
    e.preventDefault();
    updateSVFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    const move = (ev: TouchEvent) => {
      if (!ev.touches[0]) return;
      ev.preventDefault();
      updateSVFromPoint(ev.touches[0].clientX, ev.touches[0].clientY);
    };
    const up = () => {
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      commitChange();
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up, { once: true });
  }

  function updateHueFromPoint(clientX: number) {
    if (!hueRef.current) return;
    const rect = hueRef.current.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const nextH = clamp((x / rect.width) * 360, 0, 360);
    setH(nextH);
    latestHSV.current = { h: nextH, s: latestHSV.current.s, v: latestHSV.current.v };
  }

  function startDragHueMouse(e: React.MouseEvent) {
    e.preventDefault();
    updateHueFromPoint(e.clientX);
    const move = (ev: MouseEvent) => {
      ev.preventDefault();
      updateHueFromPoint(ev.clientX);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      commitChange();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function startDragHueTouch(e: React.TouchEvent) {
    if (!e.touches[0]) return;
    e.preventDefault();
    updateHueFromPoint(e.touches[0].clientX);
    const move = (ev: TouchEvent) => {
      if (!ev.touches[0]) return;
      ev.preventDefault();
      updateHueFromPoint(ev.touches[0].clientX);
    };
    const up = () => {
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      commitChange();
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up, { once: true });
  }

  return (
    <div className="p-3 rounded-xl border border-neutral-800 bg-neutral-900/95 shadow-xl w-[240px] space-y-3">
      <div ref={svRef}
           className="relative h-36 rounded-md cursor-crosshair select-none"
           style={{ background: `hsl(${Math.round(h)}, 100%, 50%)` }}
           onMouseDown={startDragSVMouse}
           onTouchStart={startDragSVTouch}
      >
        <div className="absolute inset-0 rounded-md" style={{ background: 'linear-gradient(to right, #fff, rgba(255,255,255,0))' }} />
        <div className="absolute inset-0 rounded-md" style={{ background: 'linear-gradient(to top, #000, rgba(0,0,0,0))' }} />
        <div className="absolute h-3 w-3 -mt-1.5 -ml-1.5 rounded-full border border-white shadow"
             style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
      </div>
      <div
        ref={hueRef}
        className="h-3 rounded-md cursor-pointer border border-neutral-800"
        style={{ background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' }}
        onMouseDown={startDragHueMouse}
        onTouchStart={startDragHueTouch}
      />
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded border border-neutral-700" style={{ background: value }} />
        <input className="flex-1 h-8 px-2 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-700 focus:outline-none"
               value={value.toLowerCase()}
               onChange={(e)=>{
                 const v = e.target.value.trim();
                 if (/^#([0-9a-fA-F]{6})$/.test(v)) onChange(v);
               }}
               placeholder="#22c55e"
        />
      </div>
      {swatches && swatches.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {swatches.map((c) => (
            <button key={c} className="h-5 w-5 rounded border border-neutral-700" style={{ background: c }} onClick={()=>{ onChange(c); onChangeComplete?.(c); }} aria-label={`Use ${c}`} />
          ))}
        </div>
      )}
    </div>
  );
}
