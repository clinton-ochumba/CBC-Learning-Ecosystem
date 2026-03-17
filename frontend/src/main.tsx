import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// ── Service Worker (PWA offline support) ──────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((reg) => {
        console.log('[SW] Registered, scope:', reg.scope);

        // Prompt user when new SW version is waiting
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available — show update banner via custom event
              window.dispatchEvent(new CustomEvent('sw:update-available'));
            }
          });
        });
      })
      .catch((err) => console.warn('[SW] Registration failed:', err));
  });
}

// ── Render ────────────────────────────────────────────────────────────────────
const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
