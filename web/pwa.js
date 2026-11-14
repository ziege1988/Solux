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

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Neue Version gefunden: still aktivieren, beim nächsten Öffnen ist sie da
      reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) w.postMessage('skipWaiting'); }); });
    }).catch(() => {});
  }
})();
