// Service worker for Classic.
// Network-first for HTML/JS/CSS (fersk kode), cache-first for statiske ressurser.
// API-kall (/api) og Spotify caches aldri.
const CACHE = 'classic-v1';
const ASSETS = ['/', '/index.html', '/css/style.css', '/icons/icon.svg', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Aldri cache API eller eksterne (Spotify o.l.)
  if (url.pathname.startsWith('/api') || url.origin !== location.origin) return;

  const isCode = /\.(js|css|html)$/.test(url.pathname) || url.pathname === '/';
  if (isCode) {
    // Network-first
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
  } else {
    // Cache-first for bilder/ikoner
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
      return res;
    })));
  }
});
