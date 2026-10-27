// Hand-written service worker (docs/adr/0008, PLT-018).
//
// What it caches: the offline fallback page, the manifest, icons and hashed build assets under
// /_next/static/. That is the app shell only.
// What it NEVER caches: anything under /v1/ (API responses carry tenant data), navigations (HTML
// for signed-in pages), or any non-GET / cross-origin request. Offline drafts and queued writes
// live in IndexedDB inside the app (src/lib/offline), not here.
//
// Updates: a new worker waits until the page asks it to take over (SKIP_WAITING from the update
// prompt), so a form in progress is never swapped out underneath the person using it.
'use strict';

const SW_VERSION = '0.2.0';
const SHELL_CACHE = `fieldline-shell-${SW_VERSION}`;
const STATIC_CACHE = `fieldline-static-${SW_VERSION}`;
const OFFLINE_URL = '/offline';
const SHELL_ASSETS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // `reload` bypasses the HTTP cache so a new version never precaches stale files.
      cache.addAll(SHELL_ASSETS.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  );
  // First install: nothing to replace, activate immediately. Updates wait for SKIP_WAITING.
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith('fieldline-') && key !== SHELL_CACHE && key !== STATIC_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  return url.pathname === '/v1' || url.pathname.startsWith('/v1/');
}

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/');
}

function isShellAsset(url) {
  return url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest';
}

function cacheable(response) {
  return (
    response && response.ok && response.type === 'basic' && !response.headers.has('Set-Cookie')
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (cacheable(response)) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit);
  return hit || network;
}

async function navigation(request) {
  try {
    return await fetch(request);
  } catch {
    const fallback = await caches.match(OFFLINE_URL);
    return (
      fallback ||
      new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Tenant data: always straight to the network, never stored.
  if (isApiRequest(url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (isShellAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'CLEAR_CACHES') {
    // Sign-out or lost access: drop everything this worker stored for the previous session.
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((k) => k.startsWith('fieldline-')).map((k) => caches.delete(k))),
        )
        // Restore the tenant-free offline fallback so the next offline navigation still works.
        .then(() => caches.open(SHELL_CACHE))
        .then((cache) => cache.addAll(SHELL_ASSETS))
        .catch(() => undefined),
    );
  } else if (data.type === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: SW_VERSION });
  }
});
