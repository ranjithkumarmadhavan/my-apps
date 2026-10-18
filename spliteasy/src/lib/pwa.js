// Installable-app plumbing: service worker registration + updates, the install prompt,
// and online/offline status. Everything here is a no-op in browsers that don't support it.
import { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL;

// ---------- service worker & updates ----------

let waitingWorker = null;
const emit = (name) => window.dispatchEvent(new Event(name));

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE });
      const track = (worker) => {
        if (!worker) return;
        const check = () => {
          // A new version finished installing while an older one controls the page.
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = worker;
            emit('spliteasy:update-ready');
          }
        };
        worker.addEventListener('statechange', check);
        check();
      };
      track(reg.waiting);
      reg.addEventListener('updatefound', () => track(reg.installing));
      // Look for a new deploy whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
    } catch {
      // Registration failure just means no offline shell; the app still works.
    }
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

export function useUpdateReady() {
  const [ready, setReady] = useState(() => waitingWorker !== null);
  useEffect(() => {
    const on = () => setReady(true);
    window.addEventListener('spliteasy:update-ready', on);
    return () => window.removeEventListener('spliteasy:update-ready', on);
  }, []);
  return ready;
}

export function applyUpdate() {
  if (waitingWorker) waitingWorker.postMessage('SKIP_WAITING');
  else window.location.reload();
}

// ---------- install prompt ----------

let deferredPrompt = null;
let installed = false;

if (typeof window !== 'undefined') {
  // Chrome fires this when the app is installable; keep it so we can show our own button.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    emit('spliteasy:install-change');
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    emit('spliteasy:install-change');
  });
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * mode: 'installed' (running as the app, or just installed), 'prompt' (we can show Chrome's install
 * dialog), 'ios' (Safari: show Add to Home Screen steps) or 'unavailable'.
 */
export function useInstall() {
  const compute = () =>
    installed || isStandalone() ? 'installed' : deferredPrompt ? 'prompt' : isIOS() ? 'ios' : 'unavailable';
  const [mode, setMode] = useState(compute);
  useEffect(() => {
    const on = () => setMode(compute());
    window.addEventListener('spliteasy:install-change', on);
    return () => window.removeEventListener('spliteasy:install-change', on);
  }, []);
  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null;
    emit('spliteasy:install-change');
  };
  return { mode, install };
}

// ---------- online status ----------

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
