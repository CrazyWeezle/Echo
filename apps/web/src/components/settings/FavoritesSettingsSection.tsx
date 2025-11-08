import React, { useEffect, useState } from 'react';

export default function FavoritesSettingsSection() {
  // Landing general prefs
  const [showFav, setShowFav] = useState<boolean>(()=>{ try { return localStorage.getItem('landing.showFavorites') !== '0'; } catch { return true; } });
  const [maxFav, setMaxFav] = useState<number>(()=>{ try { const v=parseInt(localStorage.getItem('landing.maxFavorites')||'4',10); return Math.max(1, Math.min(8, isNaN(v)?4:v)); } catch { return 4; } });
  const [quickComposer, setQuickComposer] = useState<boolean>(()=>{ try { return localStorage.getItem('landing.quickComposer') !== '0'; } catch { return true; } });
  // Gallery widget prefs
  const [fit, setFit] = useState<string>(()=>{ try { return localStorage.getItem('fav.gallery.fit') || 'contain-blur'; } catch { return 'contain-blur'; } });
  const [hover, setHover] = useState<string>(()=>{ try { return localStorage.getItem('fav.gallery.hover') || 'subtle'; } catch { return 'subtle'; } });
  const [rotate, setRotate] = useState<boolean>(()=>{ try { return localStorage.getItem('fav.gallery.rotate') !== '0'; } catch { return true; } });
  const [rotateSeconds, setRotateSeconds] = useState<number>(()=>{ try { const v=parseInt(localStorage.getItem('fav.gallery.rotateSeconds')||'8',10); return Math.max(3, Math.min(60, isNaN(v)?8:v)); } catch { return 8; } });
  const [rotateCount, setRotateCount] = useState<number>(()=>{ try { const v=parseInt(localStorage.getItem('fav.gallery.rotateCount')||'5',10); return Math.max(1, Math.min(12, isNaN(v)?5:v)); } catch { return 5; } });
  const [rotatePause, setRotatePause] = useState<boolean>(()=>{ try { return localStorage.getItem('fav.gallery.rotatePause') !== '0'; } catch { return true; } });

  useEffect(()=>{ try { localStorage.setItem('landing.showFavorites', showFav ? '1':'0'); window.dispatchEvent(new CustomEvent('landing:prefs')); } catch {} }, [showFav]);
  useEffect(()=>{ try { localStorage.setItem('landing.maxFavorites', String(maxFav)); window.dispatchEvent(new CustomEvent('landing:prefs')); } catch {} }, [maxFav]);
  useEffect(()=>{ try { localStorage.setItem('landing.quickComposer', quickComposer ? '1':'0'); window.dispatchEvent(new CustomEvent('landing:prefs')); } catch {} }, [quickComposer]);
  useEffect(()=>{ try { localStorage.setItem('fav.gallery.fit', fit); window.dispatchEvent(new CustomEvent('favorites:prefs')); } catch {} }, [fit]);
  useEffect(()=>{ try { localStorage.setItem('fav.gallery.hover', hover); window.dispatchEvent(new CustomEvent('favorites:prefs')); } catch {} }, [hover]);
  useEffect(()=>{ try { localStorage.setItem('fav.gallery.rotate', rotate ? '1':'0'); window.dispatchEvent(new CustomEvent('favorites:prefs')); } catch {} }, [rotate]);
  useEffect(()=>{ try { localStorage.setItem('fav.gallery.rotateSeconds', String(rotateSeconds)); window.dispatchEvent(new CustomEvent('favorites:prefs')); } catch {} }, [rotateSeconds]);
  useEffect(()=>{ try { localStorage.setItem('fav.gallery.rotateCount', String(rotateCount)); window.dispatchEvent(new CustomEvent('favorites:prefs')); } catch {} }, [rotateCount]);
  useEffect(()=>{ try { localStorage.setItem('fav.gallery.rotatePause', rotatePause ? '1':'0'); window.dispatchEvent(new CustomEvent('favorites:prefs')); } catch {} }, [rotatePause]);

  return (
    <div className="space-y-4">
      <div className="text-emerald-300 font-semibold">Landing Page</div>

      {/* Manage Sections */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
        <div className="text-neutral-300 font-medium mb-2">Manage sections</div>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" checked={showFav} onChange={(e)=>setShowFav(e.target.checked)} />
            Show Favorites Dashboard
          </label>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-neutral-400">Max favorites</div>
            <input type="range" min={1} max={8} value={maxFav} onChange={(e)=>setMaxFav(parseInt(e.target.value,10))} />
            <div className="w-6 text-neutral-300 text-right">{maxFav}</div>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" checked={quickComposer} onChange={(e)=>setQuickComposer(e.target.checked)} />
            Enable quick composer in chat widgets
          </label>
        </div>
        <div className="mt-2 text-xs text-neutral-500">These preferences apply to the landing page on this device.</div>
      </div>

      {/* Favorites: Gallery widget */}
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
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-neutral-400 mb-1">Rotation</div>
            <div className="space-y-2 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={rotate} onChange={(e)=>setRotate(e.target.checked)} />
                Enable rotation
              </label>
              <div className="flex items-center gap-3">
                <div className="text-neutral-400">Every</div>
                <input type="range" min={3} max={60} value={rotateSeconds} onChange={(e)=>setRotateSeconds(parseInt(e.target.value,10))} />
                <div className="w-10 text-neutral-300">{rotateSeconds}s</div>
              </div>
            </div>
          </div>
          <div>
            <div className="text-sm text-neutral-400 mb-1">Rotation window</div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <div className="text-neutral-400">Show last</div>
                <input type="range" min={1} max={12} value={rotateCount} onChange={(e)=>setRotateCount(parseInt(e.target.value,10))} />
                <div className="w-8 text-neutral-300">{rotateCount}</div>
                <div className="text-neutral-400">photos</div>
              </div>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={rotatePause} onChange={(e)=>setRotatePause(e.target.checked)} />
                Pause on hover
              </label>
            </div>
          </div>
        </div>
        <div className="mt-2 text-xs text-neutral-500">Preferences save automatically for this device.</div>
      </div>
    </div>
  );
}

