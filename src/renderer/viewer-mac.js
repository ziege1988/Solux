/* Solux – Großansicht als eigenes Fenster am Mac: Sonnenbild in 2048 px, eingefärbt wie im Widget */
(async () => {
  'use strict';
  const api = window.solux, U = window.SoluxUI;
  const LABEL = { wl: 'Weißlicht', ca: 'Kalzium', ha: 'H-Alpha' };
  const kind = new URLSearchParams(location.search).get('kind') || 'wl';
  const v = window.SoluxViewer.open({ title: `Sonne · ${LABEL[kind] || kind}`, sub: 'Lade …', onClose: () => window.close() });
  try {
    const sun = await api.sunImage(kind, null, 2048);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = sun.dataUrl; });
    const cv = U.colorizeSun(img, kind, sun.size, (sun.radiusPx * 1024) / sun.size);
    v.setImage(cv);
    v.setSub(`${U.fmt.utcDate(sun.date)} ${U.fmt.utcHM(sun.date)} · ${sun.label}`);
  } catch (e) { v.fail('Bild nicht verfügbar: ' + e.message); }
})();
