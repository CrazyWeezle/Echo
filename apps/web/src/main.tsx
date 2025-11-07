import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// PWA SW registration is auto-injected by vite-plugin-pwa
// Safety: allow disabling SW at runtime and auto-reload on updates
(function manageSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('no-sw') === '1') localStorage.setItem('disablePwa', '1');
    const disabled = localStorage.getItem('disablePwa') === '1';
    if (disabled) {
      // Unregister all service workers and reload once
      navigator.serviceWorker.getRegistrations().then((regs) => {
        Promise.all(regs.map(r => r.unregister())).finally(() => {
          if (!(window as any).__sw_disabled__) {
            (window as any).__sw_disabled__ = true;
            location.replace(location.pathname + location.search.replace(/([?&])no-sw=1/,'$1').replace(/\?$/,''));
          }
        });
      });
      return;
    }
    // Force reload when a new SW takes control to avoid mixed old/new chunks
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if ((window as any).__sw_reloading__) return;
      (window as any).__sw_reloading__ = true;
      location.reload();
    });
  } catch {}
})();

// Keep --vh CSS variable in sync with actual viewport height on mobile
function setViewportUnit() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}
setViewportUnit();
window.addEventListener('resize', setViewportUnit);
window.addEventListener('orientationchange', setViewportUnit);

// Apply saved theme early (accent colors / backgrounds)
try {
  const saved = localStorage.getItem('theme') || 'emerald';
  document.documentElement.setAttribute('data-theme', saved);
} catch {}


const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
