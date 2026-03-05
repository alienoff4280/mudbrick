/**
 * Mudbrick — Service Worker (Phase 2, W7)
 * App shell: stale-while-revalidate
 * CDN assets: cache-first with versioned key
 * Graceful offline fallback, cache quota handling,
 * update notification to clients.
 */

const CACHE_VERSION = 'mudbrick-v4.1';

/* App shell — local assets (28 JS modules + HTML/CSS/manifest) */
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles/variables.css',
  './styles/layout.css',
  './styles/components.css',
  './styles/print.css',
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
  './js/error-handler.js',
  './js/menu-actions.js',
  './js/a11y.js',
  './js/onboarding.js',
  './manifest.json',
];

/* CDN assets (pre-cache the critical ones) */
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js',
];

/* Offline fallback page (inline HTML returned when nothing is cached) */
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mudbrick — Offline</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
min-height:100vh;margin:0;background:#f5f5f5;color:#333;text-align:center}
.box{max-width:360px;padding:2rem}.icon{font-size:3rem;margin-bottom:1rem}
h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#666;font-size:.9rem}</style></head>
<body><div class="box"><div class="icon">&#x1f9f1;</div>
<h1>You're offline</h1><p>Mudbrick needs a network connection to load for the first time.
Once cached, it works offline.</p></div></body></html>`;

/* ── Helpers ── */

/** Safe cache.put that catches quota errors */
async function safeCachePut(cache, request, response) {
  try {
    await cache.put(request, response);
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      console.warn('SW: Cache quota exceeded, skipping cache for', request.url || request);
      // Notify clients about quota issue
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'CACHE_QUOTA_EXCEEDED' });
      }
    } else {
      console.warn('SW: cache.put failed:', err);
    }
  }
}

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

/* ── Activate: clean old caches, notify clients ── */

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => {
            console.log('SW: Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => {
      // Notify all clients that a new version activated
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        for (const client of clients) {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        }
      });
    })
  );
  self.clients.claim();
});

/* ── Fetch strategies ── */

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip non-http(s) requests (e.g. chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  // CDN resources: cache-first, update in background
  if (url.hostname === 'cdn.jsdelivr.net' ||
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          // Serve from cache immediately; refresh in background
          const bgFetch = fetch(event.request).then(async resp => {
            if (resp.ok) {
              const cache = await caches.open(CACHE_VERSION);
              await safeCachePut(cache, event.request, resp);
            }
          }).catch(() => { /* offline — cached copy is fine */ });
          // Fire and forget the background update
          event.waitUntil(bgFetch);
          return cached;
        }
        // Not cached yet — go to network
        return fetch(event.request).then(async resp => {
          if (resp.ok) {
            const clone = resp.clone();
            const cache = await caches.open(CACHE_VERSION);
            await safeCachePut(cache, event.request, clone);
          }
          return resp;
        }).catch(() => new Response('', { status: 503, statusText: 'Offline' }));
      })
    );
    return;
  }

  // Local assets: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(async resp => {
          if (resp.ok) {
            const clone = resp.clone();
            const cache = await caches.open(CACHE_VERSION);
            await safeCachePut(cache, event.request, clone);
          }
          return resp;
        }).catch(() => {
          // Network failed — return cached version or offline fallback
          if (cached) return cached;
          // For navigation requests, return offline page
          if (event.request.mode === 'navigate') {
            return new Response(OFFLINE_HTML, {
              headers: { 'Content-Type': 'text/html' },
            });
          }
          return new Response('', { status: 503, statusText: 'Offline' });
        });

        // Return cached immediately if available, update in background
        if (cached) {
          event.waitUntil(networkFetch);
          return cached;
        }
        return networkFetch;
      })
    );
    return;
  }

  // Everything else: network only (PDF files, external resources, etc.)
});
