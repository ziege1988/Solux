/* Solux mobil – Service Worker: App-Dateien offline verfügbar, Daten immer frisch aus dem Netz. */
const VERSION = 'solux-__BUILD__';
const SHELL = ['./', 'index.html', 'push-config.js', 'base.css', 'widget.css', 'mobile.css', 'common.js', 'widget.js', 'api-web.js', 'pwa.js', 'manifest.webmanifest',
  'shared/astro.js', 'shared/seeing.js', 'shared/mcintosh.js', 'shared/spaceweather.js', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'assets/splash-sun.jpg'];

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

/* ---------- Push-Mitteilungen (gesendet vom GitHub-Workflow „Solux Push“) ---------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Solux', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Solux', { body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || undefined, data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  }));
});
