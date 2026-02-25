/**
 * Mudbrick — Service Worker (Phase 2, W5.2)
 * Caches app shell for offline use. Network-first for CDN,
 * cache-first for local assets.
 */

const CACHE_VERSION = 'mudbrick-v3.1';

/* App shell — local assets */
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles/variables.css',
  './styles/layout.css',
  './styles/components.css',
  './js/app.js',
  './js/pdf-engine.js',
  './js/utils.js',
  './js/annotations.js',
  './js/export.js',
  './js/icons.js',
  './js/forms.js',
  './js/find.js',
  './js/bates.js',
  './js/headers.js',
  './js/signatures.js',
  './js/pdf-edit.js',
  './js/history.js',
  './js/ocr.js',
  './js/text-edit.js',
  './js/security.js',
  './js/export-image.js',
  './js/form-creator.js',
  './js/comment-summary.js',
  './js/doc-compare.js',
  './js/doc-history.js',
  './js/exhibit-stamps.js',
  './js/page-labels.js',
  './js/redact-patterns.js',
];

/* CDN assets (pre-cache the critical ones) */
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js',
];

/* ── Install: pre-cache app shell + critical CDN ── */

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      // Cache local assets first (these should always succeed)
      return cache.addAll(SHELL_ASSETS)
        .then(() => {
          // CDN assets — best effort, don't fail install if CDN is down
          return Promise.allSettled(
            CDN_ASSETS.map(url =>
              fetch(url).then(resp => {
                if (resp.ok) return cache.put(url, resp);
              })
            )
          );
        });
    })
  );
  self.skipWaiting();
});

/* ── Activate: clean old caches ── */

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ── Fetch: stale-while-revalidate for local, cache-then-network for CDN ── */

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip non-http(s) requests (e.g. chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  // CDN resources: serve from cache, fetch in background to update
  if (url.hostname === 'cdn.jsdelivr.net' ||
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return resp;
        }).catch(() => cached); // fallback to cache if network fails

        return cached || fetchPromise;
      })
    );
    return;
  }

  // Local assets: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return resp;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // Everything else: network only (PDF files, external resources, etc.)
});
