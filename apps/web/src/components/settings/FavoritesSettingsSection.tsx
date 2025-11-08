import React, { useEffect, useState } from 'react';

export default function FavoritesSettingsSection() {
  const [fit, setFit] = useState<string>(()=>{ try { return localStorage.getItem('fav.gallery.fit') || 'contain-blur'; } catch { return 'contain-blur'; } });
  const [hover, setHover] = useState<string>(()=>{ try { return localStorage.getItem('fav.gallery.hover') || 'subtle'; } catch { return 'subtle'; } });

  useEffect(()=>{ try { localStorage.setItem('fav.gallery.fit', fit); window.dispatchEvent(new CustomEvent('favorites:prefs')); } catch {} }, [fit]);
  useEffect(()=>{ try { localStorage.setItem('fav.gallery.hover', hover); window.dispatchEvent(new CustomEvent('favorites:prefs')); } catch {} }, [hover]);

  return (
    <div className="space-y-4">
      <div className="text-emerald-300 font-semibold">Landing Page</div>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
        <div className="text-neutral-300 font-medium mb-2">Favorites: Gallery widget</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-neutral-400 mb-1">Image fit</div>
            <div className="flex items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="gal-fit" checked={fit==='contain-blur'} onChange={()=>setFit('contain-blur')} />
                <span>Contain + blurred background</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="gal-fit" checked={fit==='cover'} onChange={()=>setFit('cover')} />
                <span>Cover (may crop)</span>
              </label>
            </div>
          </div>

          <div>
            <div className="text-sm text-neutral-400 mb-1">Hover animation</div>
            <div className="flex items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="gal-hover" checked={hover==='subtle'} onChange={()=>setHover('subtle')} />
                <span>Subtle</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="gal-hover" checked={hover==='none'} onChange={()=>setHover('none')} />
                <span>None</span>
              </label>
            </div>
          </div>
        </div>
        <div className="mt-2 text-xs text-neutral-500">Preferences save automatically for this device.</div>
      </div>
    </div>
  );
}
