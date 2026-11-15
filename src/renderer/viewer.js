/*
 * Solux – Großansicht der Sonne (Handy und Mac)
 *  - Handy: zwei Finger zoomen, ein Finger verschieben, Doppeltipp = Zoom an/aus
 *  - Mac:   Mausrad zoomt an der Mausposition, gedrückte linke Maustaste verschiebt, Doppelklick = Zoom an/aus
 *  - × oben rechts oder Esc schließt
 */
(function (root) {
  'use strict';

  function open({ title = 'Sonne', sub = '', canvas = null, onClose = null, hint = null } = {}) {
    const ov = document.createElement('div');
    ov.className = 'viewer';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Großansicht der Sonne');
    const touch = matchMedia('(pointer: coarse)').matches;
    ov.innerHTML = `<div class="vstage"><canvas></canvas></div>
      <div class="vbar"><div class="vt"><b></b><span></span></div><button class="vx" aria-label="Großansicht schließen" title="Schließen (Esc)">×</button></div>
      <div class="vload">Lade hochaufgelöstes Bild …</div>
      <div class="vhint">${hint || (touch ? 'Mit zwei Fingern zoomen · mit einem Finger verschieben · Doppeltipp' : 'Mausrad = Zoom · gedrückt halten = verschieben · Doppelklick')}</div>`;
    document.body.appendChild(ov);
    const stage = ov.querySelector('.vstage'), el = ov.querySelector('canvas');
    ov.querySelector('.vt b').textContent = title;
    ov.querySelector('.vt span').textContent = sub;

    let w = 0, h = 0, s = 1, tx = 0, ty = 0, fit = 1;
    const box = () => stage.getBoundingClientRect();
    const apply = () => { el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; };
    function clamp() {
      const r = box(), W = w * s, H = h * s;
      tx = W <= r.width ? (r.width - W) / 2 : Math.min(0, Math.max(r.width - W, tx));
      ty = H <= r.height ? (r.height - H) / 2 : Math.min(0, Math.max(r.height - H, ty));
    }
    function fitView() { const r = box(); fit = Math.min(r.width / w, r.height / h); s = fit; clamp(); apply(); }
    function zoomAt(px, py, f) {
      const ns = Math.max(fit, Math.min(fit * 12, s * f));
      tx = px - ((px - tx) * ns) / s; ty = py - ((py - ty) * ns) / s; s = ns;
      clamp(); apply();
    }

    /** Bild setzen; beim Nachladen einer höheren Auflösung bleibt der Ausschnitt erhalten. */
    function setImage(c, done = true) {
      const first = !w, k = first ? 1 : w / c.width;
      el.width = c.width; el.height = c.height; el.getContext('2d').drawImage(c, 0, 0);
      w = c.width; h = c.height;
      if (first) fitView(); else { const r = box(); fit = Math.min(r.width / w, r.height / h); s *= k; clamp(); apply(); }
      if (done) ov.querySelector('.vload').hidden = true;
    }

    // Zeiger: ein Finger/Maus = verschieben, zwei Finger = zoomen
    const pts = new Map();
    let last = null, lastTap = 0, gesture = null;
    const mid = () => { const a = [...pts.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) }; };
    stage.addEventListener('pointerdown', (e) => {
      try { stage.setPointerCapture(e.pointerId); } catch { /* nicht überall verfügbar */ }
      const r = box(); pts.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      last = pts.size === 2 ? mid() : { ...pts.get(e.pointerId) };
      if (pts.size === 1) gesture = { x: last.x, y: last.y, t: Date.now(), multi: false, moved: 0 };
      else if (gesture) gesture.multi = true;
      stage.classList.add('drag');
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const r = box(); pts.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      if (gesture && pts.size === 1) { const p0 = pts.get(e.pointerId); gesture.moved = Math.max(gesture.moved, Math.hypot(p0.x - gesture.x, p0.y - gesture.y)); }
      if (pts.size === 1) { const p = pts.get(e.pointerId); tx += p.x - last.x; ty += p.y - last.y; last = { ...p }; clamp(); apply(); }
      else if (pts.size === 2) { const m = mid(); tx += m.x - last.x; ty += m.y - last.y; zoomAt(m.x, m.y, m.d / (last.d || m.d)); last = m; }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size === 1) last = { ...[...pts.values()][0] };
      if (!pts.size) {
        stage.classList.remove('drag');
        // Doppeltipp (Handy): Zoom an/aus – nur echte Tipps (ein Finger, kurz, ohne Bewegung) zählen
        const tap = gesture && !gesture.multi && gesture.moved < 10 && Date.now() - gesture.t < 300;
        if (e.pointerType === 'touch' && tap) { const t = Date.now(); if (t - lastTap < 320) { toggleZoom(p.x, p.y); lastTap = 0; } else lastTap = t; }
        else if (!tap) lastTap = 0;
        gesture = null;
      }
    };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = box(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, { passive: false });
    stage.addEventListener('dblclick', (e) => { const r = box(); toggleZoom(e.clientX - r.left, e.clientY - r.top); });
    function toggleZoom(x, y) { if (s > fit * 1.3) fitView(); else zoomAt(x, y, 3); }
    // Safari: eigene Gesten-Zoomereignisse unterdrücken (sonst zoomt die ganze Seite)
    ['gesturestart', 'gesturechange'].forEach((t) => ov.addEventListener(t, (e) => e.preventDefault()));

    const onResize = () => { if (w) { const was = s / fit; const r = box(); fit = Math.min(r.width / w, r.height / h); s = fit * was; clamp(); apply(); } };
    addEventListener('resize', onResize);
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === '+' || e.key === '=') { const r = box(); zoomAt(r.width / 2, r.height / 2, 1.4); }
      else if (e.key === '-') { const r = box(); zoomAt(r.width / 2, r.height / 2, 1 / 1.4); }
      else if (e.key === '0') fitView();
    };
    addEventListener('keydown', onKey);
    function close() {
      removeEventListener('resize', onResize); removeEventListener('keydown', onKey);
      ov.remove();
      if (onClose) onClose();
    }
    ov.querySelector('.vx').addEventListener('click', close);
    setTimeout(() => ov.querySelector('.vhint').classList.add('fade'), 3500);
    if (canvas) setImage(canvas, false);
    return {
      setImage,
      setSub: (t) => { ov.querySelector('.vt span').textContent = t; },
      fail: (msg) => { const l = ov.querySelector('.vload'); l.textContent = msg; l.classList.add('err'); },
      close,
      get open() { return ov.isConnected; },
    };
  }

  root.SoluxViewer = { open };
})(window);
