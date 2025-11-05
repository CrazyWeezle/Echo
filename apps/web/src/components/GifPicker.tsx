import { useEffect, useMemo, useRef, useState } from 'react';

type Gif = { id: string; url: string; preview: string };

declare global { namespace JSX { interface IntrinsicElements { 'giphy-gif-picker': any; } } }

export default function GifPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (gif: Gif) => void }) {
  const apiKey = useMemo(() => (import.meta.env.VITE_GIPHY_KEY || 'dc6zaTOxFJmzC'), []);
  const ref = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const forceFallback = String(import.meta.env.VITE_GIPHY_FORCE_FALLBACK || '') === '1';
  const [fallback, setFallback] = useState(forceFallback);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Gif[]>([]);

  // Lazy-load GIPHY web component from CDN to avoid bundling dependency
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as any).GIPHY_COMPONENTS_LOADED || (customElements && customElements.get && customElements.get('giphy-gif-picker'))) {
      setReady(true); return;
    }
    const tagId = 'giphy-components-loader';
    if (document.getElementById(tagId)) {
      // already loading
      const t = setInterval(() => {
        if (customElements.get && customElements.get('giphy-gif-picker')) { clearInterval(t); (window as any).GIPHY_COMPONENTS_LOADED = true; setReady(true); }
      }, 100);
      return () => clearInterval(t);
    }
    const s = document.createElement('script');
    s.id = tagId;
    s.type = 'module';
    s.src = 'https://unpkg.com/@giphy/js-components@9/dist/web-components.es.js';
    s.onload = () => { (window as any).GIPHY_COMPONENTS_LOADED = true; setReady(true); };
    s.onerror = () => {
      console.error('Failed to load GIPHY components');
      setFallback(true);
    };
    document.head.appendChild(s);
  }, []);

  // Fallback: simple GIPHY search via REST API
  async function runSearch(reset = true) {
    try {
      setLoading(true);
      const limit = 24;
      const offset = reset ? 0 : page * limit;
      const endpoint = q.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&rating=pg-13&lang=en`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(apiKey)}&limit=${limit}&offset=${offset}&rating=pg-13`;
      const res = await fetch(endpoint);
      const data = await res.json();
      const list: Gif[] = (data?.data || []).map((d: any) => {
        const img = d?.images || {};
        return {
          id: String(d?.id || Math.random()),
          url: String(img?.original?.url || img?.downsized?.url || ''),
          preview: String(img?.preview_gif?.url || img?.fixed_height_small?.url || '')
        } as Gif;
      }).filter((g: Gif) => !!g.url);
      if (reset) setResults(list); else setResults(prev => prev.concat(list));
    } catch (e) {
      console.error('GIPHY search failed', e);
    } finally { setLoading(false); }
  }
  useEffect(() => { if (fallback && open) { runSearch(true); } }, [fallback, open]);
  const [tab, setTab] = useState<'gifs'|'fav'>('gifs');
  const [autoFav, setAutoFav] = useState<boolean>(() => {
    try { return localStorage.getItem('gifAutoFav') !== '0'; } catch { return true; }
  });
  const [favs, setFavs] = useState<Gif[]>(() => {
    try { const raw = localStorage.getItem('gifFavorites'); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });

  function saveFavs(next: Gif[]) {
    setFavs(next);
    try { localStorage.setItem('gifFavorites', JSON.stringify(next.slice(-50))); } catch {}
  }
  function addFav(g: Gif) {
    const arr = favs.slice();
    if (!arr.find(x => x.id === g.id)) arr.push(g);
    saveFavs(arr.slice(-50));
  }
  function removeFav(id: string) {
    const arr = favs.filter(x => x.id !== id);
    saveFavs(arr);
  }
  useEffect(() => { try { localStorage.setItem('gifAutoFav', autoFav ? '1' : '0'); } catch {} }, [autoFav]);

  useEffect(() => {
    const el = ref.current as HTMLElement | null;
    if (!el) return;
    const onClick = (e: any) => {
      const d = e?.detail;
      if (!d) return;
      const img = d?.images || {};
      const url = String(img?.original?.url || img?.downsized?.url || '');
      const preview = String(img?.preview_gif?.url || img?.fixed_height_small?.url || url);
      if (url) {
        const g = { id: String(d?.id || Date.now()), url, preview };
        onPick(g);
        if (autoFav) addFav(g);
      }
      onClose();
    };
    el.addEventListener('gif-click', onClick as any);
    return () => { el.removeEventListener('gif-click', onClick as any); };
  }, [onPick, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl rounded-xl border border-neutral-800 bg-neutral-900 p-2 shadow-xl">
        <button aria-label="Close" className="absolute top-1 right-1 text-neutral-400 hover:text-neutral-200" onClick={onClose}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="h-4 w-4">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="mb-2 flex items-center gap-3">
          <div className="flex items-center gap-1 rounded border border-neutral-800">
            <button className={`px-3 py-1 ${tab==='gifs'?'bg-neutral-800 text-emerald-300':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('gifs')}>GIFs</button>
            <button className={`px-3 py-1 ${tab==='fav'?'bg-neutral-800 text-emerald-300':'text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=>setTab('fav')}>Favorites</button>
          </div>
          {tab==='gifs' && (
            <label className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={autoFav} onChange={e=>setAutoFav(e.target.checked)} />
              Add picked GIFs to Favorites
            </label>
          )}
        </div>
        {tab==='gifs' ? (
          ready && !fallback ? (
            // @ts-ignore custom element provided by GIPHY web components
            <giphy-gif-picker ref={ref} api-key={apiKey} theme="dark" gifs-per-page="25" width="100%" height="65vh"></giphy-gif-picker>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input className="flex-1 px-2 py-1 rounded bg-neutral-900 text-neutral-100 border border-neutral-800" placeholder="Search GIFs" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter' && !e.shiftKey) { setPage(0); runSearch(true); } }} />
                <button className="px-3 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>{ setPage(0); runSearch(true); }}>Search</button>
                <button className="px-3 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>{ setQ(''); setPage(0); runSearch(true); }}>Trending</button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-[65vh] overflow-auto p-1">
                {results.map(g => (
                  <button key={g.id} className="rounded overflow-hidden border border-neutral-800 hover:border-emerald-600" onClick={()=>{ onPick(g); if (autoFav) addFav(g); onClose(); }}>
                    <img src={g.preview || g.url} alt="gif" className="w-full h-28 object-cover" />
                  </button>
                ))}
                {loading && <div className="col-span-full text-center text-neutral-400 py-4">Loading...</div>}
                {!loading && results.length===0 && <div className="col-span-full text-center text-neutral-400 py-4">No results</div>}
              </div>
              <div className="flex justify-center">
                <button className="px-3 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" disabled={loading} onClick={()=>{ setPage(p=>p+1); runSearch(false); }}>Load more</button>
              </div>
            </div>
          )
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-[65vh] overflow-auto p-1">
            {favs.length === 0 && (<div className="text-neutral-400 text-sm col-span-full p-4">No favorites yet. Pick GIFs with “Add picked GIFs to Favorites” enabled.</div>)}
            {favs.map(g => (
              <div key={g.id} className="relative rounded overflow-hidden border border-neutral-800 hover:border-emerald-600 group">
                <button className="block w-full" onClick={()=>{ onPick(g); onClose(); }}>
                  <img src={g.preview} alt="gif" className="w-full h-24 object-cover" />
                </button>
                <button className="absolute top-1 right-1 text-xs px-1.5 py-0.5 rounded bg-neutral-900/80 border border-neutral-700 text-neutral-300 opacity-0 group-hover:opacity-100" onClick={()=>removeFav(g.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
