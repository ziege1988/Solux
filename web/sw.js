/* Solux mobil – Service Worker: App-Dateien offline verfügbar, Daten immer frisch aus dem Netz. */
const VERSION = 'solux-__BUILD__';
const SHELL = ['./', 'index.html', 'base.css', 'widget.css', 'mobile.css', 'common.js', 'widget.js', 'api-web.js', 'pwa.js', 'manifest.webmanifest',
  'shared/astro.js', 'shared/seeing.js', 'shared/mcintosh.js', 'shared/spaceweather.js', 'icons/apple-touch-icon.png', 'icons/icon-192.png'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL))));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Sonnen- und Wetterdaten nicht zwischenspeichern
  // Netz zuerst (immer aktuelle Version), bei fehlendem Netz aus dem Speicher
  e.respondWith(
    fetch(e.request).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
