import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';

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


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

