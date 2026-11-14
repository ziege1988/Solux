/* Solux mobil – Startbild und Offline-Unterstützung */
(() => {
  'use strict';
  const splash = document.getElementById('splash');
  let show = true;
  try { const c = JSON.parse(localStorage.getItem('solux.config') || '{}'); if (c.widget && c.widget.showSplash === false) show = false; } catch { /* egal */ }
  if (show) {
    window.SoluxUI.drawSplash(document.getElementById('splashCv'));
    setTimeout(() => { splash.classList.add('hide'); setTimeout(() => splash.remove(), 600); }, 1900);
  } else splash.remove();

  // Neue Version? Beim Öffnen und beim Zurückholen aus dem Hintergrund prüfen und dann selbst neu laden
  // (iPhone-Web-Apps bleiben sonst mit dem alten Stand im Speicher).
  const BUILD = '__BUILD__';
  let lastCheck = 0;
  const checkVersion = async () => {
    if (BUILD.startsWith('__') || Date.now() - lastCheck < 60000) return;
    lastCheck = Date.now();
    try {
      const v = await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json();
      if (v.build && v.build !== BUILD) {
        // höchstens einmal je neuer Version neu laden (falls der Server kurz noch alte Dateien liefert: keine Schleife)
        let done = null; try { done = sessionStorage.getItem('solux.reloadFor'); sessionStorage.setItem('solux.reloadFor', v.build); } catch { /* egal */ }
        if (done === v.build) return;
        const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
        if (reg) await reg.update().catch(() => {});
        location.reload();
      }
    } catch { /* offline */ }
  };
  checkVersion();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Neue Version gefunden: still aktivieren, beim nächsten Öffnen ist sie da
      reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) w.postMessage('skipWaiting'); }); });
    }).catch(() => {});
  }
})();
