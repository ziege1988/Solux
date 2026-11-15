/*
 * Solux – Großansicht der Sonne (Handy und Mac)
 *  - Handy: zwei Finger zoomen, ein Finger verschieben, Doppeltipp = Zoom an/aus
 *  - Mac:   Mausrad zoomt an der Mausposition, gedrückte linke Maustaste verschiebt, Doppelklick = Zoom an/aus
 *  - × oben rechts oder Esc schließt
 */
(function (root) {
  'use strict';

  /**
   * markers: [{x, y (Scheibenkoordinaten in Sonnenradien, Norden oben), label, type: 'spots'|'plage'|'flare', title, lines[], region, flare}]
   * disc: Lage der Sonne im Bild als Anteil der Bildbreite {cx, cy, r}
   */
  function open({ title = 'Sonne', sub = '', canvas = null, onClose = null, hint = null, markers = [], disc = { cx: 0.5, cy: 0.5, r: 0.45 }, accent = '#f3b544', onMore = null } = {}) {
    const ov = document.createElement('div');
    ov.className = 'viewer';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Großansicht der Sonne');
    const touch = matchMedia('(pointer: coarse)').matches;
    ov.innerHTML = `<div class="vstage"><canvas></canvas></div><canvas class="vov"></canvas>
      <div class="vbar"><div class="vt"><b></b><span></span></div><div class="vbtns"><button class="vlab" aria-pressed="true" title="Regionsnummern und Flares ein-/ausblenden"${markers.length ? '' : ' hidden'}>Beschriftung</button><button class="vx" aria-label="Großansicht schließen" title="Schließen (Esc)">×</button></div></div>
      <div class="vcard" hidden></div>
      <div class="vload">Lade hochaufgelöstes Bild …</div>
      <div class="vhint">${hint || (touch ? 'Mit zwei Fingern zoomen · mit einem Finger verschieben · Doppeltipp' : 'Mausrad = Zoom · gedrückt halten = verschieben · Doppelklick')}</div>`;
    document.body.appendChild(ov);
    const stage = ov.querySelector('.vstage'), el = ov.querySelector('canvas');
    ov.querySelector('.vt b').textContent = title;
    ov.querySelector('.vt span').textContent = sub;

    let w = 0, h = 0, s = 1, tx = 0, ty = 0, fit = 1;
    const box = () => stage.getBoundingClientRect();
    const ovc = ov.querySelector('.vov');
    let showLabels = true; try { showLabels = localStorage.getItem('solux.viewerLabels') !== '0'; } catch { /* egal */ }
    let hits = [];
    const apply = () => { el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; drawOverlay(); };

    /** Beschriftung in Bildschirmgröße zeichnen: bleibt beim Zoomen lesbar, die Position wandert mit. */
    function drawOverlay() {
      const r = box(), dpr = devicePixelRatio || 1;
      if (ovc.width !== Math.round(r.width * dpr) || ovc.height !== Math.round(r.height * dpr)) { ovc.width = Math.round(r.width * dpr); ovc.height = Math.round(r.height * dpr); ovc.style.width = r.width + 'px'; ovc.style.height = r.height + 'px'; }
      const x = ovc.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, r.width, r.height);
      hits = [];
      if (!showLabels || !w || !markers.length) return;
      const fs = Math.round(Math.max(12, Math.min(16, r.width / 40)));
      const R = disc.r * w * s, cx = tx + disc.cx * w * s, cy = ty + disc.cy * w * s, off = Math.max(22, Math.min(46, R * 0.09));
      x.font = `600 ${fs}px "SF Mono", Menlo, monospace`; x.textBaseline = 'middle'; x.lineJoin = 'round';
      const placed = [];
      for (const m of markers) {
        const px = cx + m.x * R, py = cy - m.y * R;
        if (px < -40 || py < -40 || px > r.width + 40 || py > r.height + 40) continue;
        if (m.type === 'flare') {
          const rr = m.big ? fs * 0.95 : fs * 0.7;
          x.strokeStyle = m.color; x.lineWidth = 2; x.beginPath();
          for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, r1 = k % 2 ? rr * 0.45 : rr; x.moveTo(px, py); x.lineTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1); }
          x.stroke();
          x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,.8)'; x.strokeText(m.label, px + rr * 0.7, py - rr * 0.9); x.fillStyle = m.color; x.fillText(m.label, px + rr * 0.7, py - rr * 0.9);
          hits.push({ m, x0: px - rr - 6, x1: px + rr + x.measureText(m.label).width + 6, y0: py - rr * 1.6, y1: py + rr + 6 });
          continue;
        }
        const ang = Math.atan2(m.y || 0.001, m.x || 0.001);
        let lx = px + Math.cos(ang) * off, ly = py - Math.sin(ang) * off;
        const tw = x.measureText(m.label).width;
        for (let k = 0; k < 8 && placed.some((q) => Math.abs(q.x - lx) < tw + 8 && Math.abs(q.y - ly) < fs * 1.3); k++) ly += fs * 1.3 * (m.y > 0 ? -1 : 1);
        placed.push({ x: lx, y: ly });
        const left = lx < px, tx0 = Math.max(6, Math.min(r.width - tw - 6, left ? lx - tw - 4 : lx + 4));
        x.globalAlpha = m.type === 'spots' ? 1 : 0.85;
        x.strokeStyle = m.color; x.lineWidth = 1.4;
        x.beginPath(); x.moveTo(px + (lx - px) * 0.3, py + (ly - py) * 0.3); x.lineTo(lx, ly); x.stroke();
        x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,.85)'; x.strokeText(m.label, tx0, ly);
        x.fillStyle = m.color; x.fillText(m.label, tx0, ly);
        x.globalAlpha = 1;
        hits.push({ m, x0: Math.min(tx0, px) - 8, x1: Math.max(tx0 + tw, px) + 8, y0: Math.min(ly, py) - fs * 0.8, y1: Math.max(ly, py) + fs * 0.8 });
      }
    }
    const card = ov.querySelector('.vcard');
    function showCard(m) {
      card.innerHTML = `<div class="vch"><b></b><button class="vcx" aria-label="Schließen">×</button></div><div class="vcl"></div>${onMore && m.region ? '<button class="vmore">Ausführliche Erklärung</button>' : ''}`;
      card.querySelector('b').textContent = m.title;
      card.querySelector('.vcl').innerHTML = m.lines.map((l) => `<span></span>`).join('');
      card.querySelectorAll('.vcl span').forEach((sp, i) => { sp.textContent = m.lines[i]; });
      card.hidden = false;
      card.querySelector('.vcx').onclick = () => { card.hidden = true; };
      const mb = card.querySelector('.vmore'); if (mb) mb.onclick = () => { close(); onMore(m); };
    }
    function hitAt(px, py) { return hits.slice().reverse().find((h) => px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1); }
    const lab = ov.querySelector('.vlab');
    if (lab) {
      const sync = () => { lab.classList.toggle('on', showLabels); lab.setAttribute('aria-pressed', String(showLabels)); };
      sync();
      lab.addEventListener('click', () => { showLabels = !showLabels; try { localStorage.setItem('solux.viewerLabels', showLabels ? '1' : '0'); } catch { /* egal */ } sync(); if (!showLabels) card.hidden = true; drawOverlay(); });
    }
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
        if (tap || (gesture && !gesture.multi && gesture.moved < 4 && e.pointerType === 'mouse')) {
          const hh = hitAt(p.x, p.y);
          if (hh) { showCard(hh.m); lastTap = 0; gesture = null; return; }
          if (!card.hidden) card.hidden = true;
        }
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
      document.body.classList.remove('viewer-open');
      ov.remove();
      if (onClose) onClose();
    }
    ov.querySelector('.vx').addEventListener('click', close);
    document.body.classList.add('viewer-open');
    setTimeout(() => ov.querySelector('.vhint').classList.add('fade'), 3500);
    if (canvas) setImage(canvas, false);
    return {
      setImage,
      setSub: (t) => { ov.querySelector('.vt span').textContent = t; },
      setMarkers: (list) => { markers = list || []; if (lab) lab.hidden = !markers.length; drawOverlay(); },
      fail: (msg) => { const l = ov.querySelector('.vload'); l.textContent = msg; l.classList.add('err'); },
      close,
      get open() { return ov.isConnected; },
    };
  }

  /** Markierungen aus Regionen (mit x/y zum Bildzeitpunkt) und Flares der letzten 24 h – wie im Widget. */
  function markersFrom(regions, flares, kind, whenMs) {
    const M = root.SoluxMcIntosh, A = root.SoluxAstro;
    const accent = kind === 'ca' ? '#d9c2ff' : kind === 'ha' ? '#ffb08a' : '#f3b544';
    const out = [];
    for (const r of regions || []) {
      if (r.type !== 'spots' && kind === 'wl') continue;
      if (r.x == null || r.y == null || r.visible === false) continue;
      const mag = M && r.magClass ? M.magSymbol(r.magClass) : '';
      out.push({ x: r.x, y: r.y, label: String(r.region), type: r.type === 'spots' ? 'spots' : 'plage', color: r.type === 'spots' ? accent : '#c3a4ff', region: r.region,
        title: `AR ${r.region} · ${r.spotClass || 'Plage'}${mag ? ' ' + mag : ''}`,
        lines: [r.location ? `Ort ${r.location}` : '', r.area ? `Fläche ${r.area} MH (≈ ${(r.area / 41.9).toFixed(1).replace('.', ',')} Erdscheiben)` : '', r.numberSpots ? `${r.numberSpots} Flecken` : '', r.probs && r.probs.m != null ? `Flare-Chance 24 h: M ${r.probs.m} % · X ${r.probs.x ?? 0} %` : ''].filter(Boolean) });
    }
    const rank = (c) => { const m = /^([ABCMX])(\d+(?:\.\d+)?)/.exec(c || ''); return m ? 'ABCMX'.indexOf(m[1]) * 10 + parseFloat(m[2]) : 0; };
    for (const f of flares || []) {
      if (whenMs - f.max > 24 * 3600000 || whenMs - f.max < -3600000 || rank(f.cls) < 25) continue;
      let p = null;
      const reg = f.region && (regions || []).find((r) => r.region === f.region);
      if (reg && reg.x != null) p = { x: reg.x, y: reg.y };
      else if (A) {
        const m = /^([NS])(\d+)([EW])(\d+)$/.exec(f.location || '');
        if (m) { const q = A.heliographicToDisk((m[1] === 'N' ? 1 : -1) * +m[2], (m[3] === 'W' ? 1 : -1) * +m[4] + 13.2 * ((whenMs - f.max) / 86400000), A.solarOrientation(new Date(whenMs)).B0); if (q.visible) p = { x: q.x, y: q.y }; }
      }
      if (!p) continue;
      const big = f.cls[0] === 'X', mid = f.cls[0] === 'M', t = new Date(f.max);
      out.push({ ...p, label: f.cls, type: 'flare', big, color: big ? '#ff4d4d' : mid ? '#ff9a3c' : '#ffe08a', flare: f,
        title: `Flare ${f.cls}`, lines: [`Maximum ${t.toISOString().slice(0, 16).replace('T', ' ')} UTC`, f.region ? `aus AR ${f.region}` : 'ohne Regionsnummer', f.location ? `Ort ${f.location}` : ''].filter(Boolean) });
    }
    return out;
  }

  root.SoluxViewer = { open, markersFrom };
})(window);
