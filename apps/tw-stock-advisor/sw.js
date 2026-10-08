// Service Worker：快取 App 外殼（離線可開啟）；GitHub API 一律走網路。
const VERSION = 'twsa-shell-v1';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/parse.js',
  './js/github.js',
  './js/store.js',
  './js/render.js',
  './js/chart.js',
  './vendor/marked.esm.js',
  './vendor/purify.es.mjs',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub API 與外部連結不經快取

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        network.catch(() => {});
        return cached;
      }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return cache.match('./index.html');
      return new Response('離線中', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }),
  );
});
