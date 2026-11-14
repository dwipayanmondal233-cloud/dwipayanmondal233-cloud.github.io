const CACHE = 'vector-studio-v1';
const CORE = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png'
];
const PAPER = 'https://cdnjs.cloudflare.com/ajax/libs/paper.js/0.12.17/paper-full.min.js';

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(CORE).then(function () {
        return fetch(PAPER, { mode: 'cors' }).then(function (r) {
          if (r.ok) return cache.put(PAPER, r);
        });
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Paper.js from the CDN: cache first
  if (req.url === PAPER) {
    e.respondWith(caches.match(PAPER).then(function (hit) {
      return hit || fetch(req);
    }));
    return;
  }

  // Your own files: network first (so edits show up), cache when offline
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('index.html');
        });
      })
    );
  }
});