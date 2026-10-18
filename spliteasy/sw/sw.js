// SplitEasy service worker. Template: vite.config.js fills in this build's version and the list
// of files to precache at build time and emits it as /spliteasy/sw.js (production only).
//
// It caches only the app's own files so the app opens instantly and still launches offline.
// API responses are never cached: balances always come from the server.

const VERSION = '__VERSION__';
const CACHE = `spliteasy-${VERSION}`;
const PRECACHE = __PRECACHE__; // paths relative to this file's scope
const INDEX = new URL('./', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([INDEX, ...PRECACHE.map((p) => new URL(p, self.registration.scope).href)])),
  );
  // Don't take over until the page says so (it shows a "New version available" bar first).
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('spliteasy-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return; // never cache API calls

  // Page navigations: try the network so deploys show up, fall back to the cached app shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(INDEX)),
    );
    return;
  }

  // Hashed build assets and icons never change under the same name: cache first.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
