// Bump VERSION whenever you change any cached file so users get the update.
const VERSION = 'v1';
const CACHE = 'weight-tracker-' + VERSION;
const ASSETS = ['./', 'index.html', 'style.css', 'script.js', 'favicon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Cache-first, refresh in background (works offline; updates appear on next load).
self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
    e.respondWith(
        caches.open(CACHE).then(async (cache) => {
            const cached = await cache.match(req, { ignoreSearch: true });
            const refresh = fetch(req).then((res) => {
                if (res && res.ok) cache.put(req, res.clone());
                return res;
            });
            if (cached) { refresh.catch(() => { }); return cached; }
            try { return await refresh; }
            catch (err) {
                if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
                return Response.error();
            }
        })
    );
});
