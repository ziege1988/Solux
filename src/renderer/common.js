/* Solux – gemeinsame Hilfsfunktionen für die Oberflächen */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;

  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /** Startbild: H-Alpha-Sonne mit Schriftzug. */
  function drawHalpha(cv, text = 'SOLUX') {
    const ctx = cv.getContext('2d'), W = cv.width, c = W / 2, R = W * 0.33, rnd = rng(42);
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(c, c, W / 2, 0, 7); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [a, h, wd] of [[200, 0.17, 0.09], [320, 0.12, 0.06], [35, 0.09, 0.05], [115, 0.14, 0.07], [260, 0.06, 0.04]]) {
      for (let k = 0; k < 80; k++) {
        const aa = (a + (rnd() - 0.5) * wd * 90) * D2R, hh = R * (1 + rnd() * h * (1 - Math.abs(rnd() - 0.5)));
        ctx.fillStyle = `rgba(${(200 + rnd() * 55) | 0},${(50 + rnd() * 40) | 0},20,${0.05 + rnd() * 0.07})`;
        ctx.beginPath(); ctx.arc(c + Math.cos(aa) * hh, c + Math.sin(aa) * hh, W * 0.004 + rnd() * W * 0.012, 0, 7); ctx.fill();
      }
    }
    for (let i = 0; i < 900; i++) { const a = rnd() * 7, h = R * (1 + rnd() * 0.03); ctx.fillStyle = 'rgba(230,70,30,.06)'; ctx.beginPath(); ctx.arc(c + Math.cos(a) * h, c + Math.sin(a) * h, W * 0.003, 0, 7); ctx.fill(); }
    ctx.restore();
    const g = ctx.createRadialGradient(c, c, 0, c, c, R); g.addColorStop(0, '#c63c1f'); g.addColorStop(0.75, '#a92e16'); g.addColorStop(1, '#6e170a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, R, 0, 7); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(c, c, R, 0, 7); ctx.clip();
    for (let i = 0; i < 9000; i++) { const a = rnd() * 7, rr = Math.sqrt(rnd()) * R; ctx.fillStyle = rnd() < 0.55 ? 'rgba(60,8,2,.10)' : 'rgba(255,120,70,.08)'; ctx.beginPath(); ctx.arc(c + Math.cos(a) * rr, c + Math.sin(a) * rr, W * 0.002 + rnd() * W * 0.006, 0, 7); ctx.fill(); }
    for (const [px, py] of [[-0.4, 0.24], [0.22, -0.3], [0.6, 0.16]]) for (let k = 0; k < 60; k++) { ctx.fillStyle = 'rgba(255,170,110,.09)'; ctx.beginPath(); ctx.arc(c + (px + (rnd() - 0.5) * 0.25) * R, c - (py + (rnd() - 0.5) * 0.16) * R, W * 0.006 + rnd() * W * 0.012, 0, 7); ctx.fill(); }
    ctx.lineCap = 'round';
    for (let f = 0; f < 7; f++) {
      let x = c + (rnd() - 0.5) * 1.4 * R, y = c + (rnd() - 0.5) * 1.4 * R, a = rnd() * 7;
      ctx.strokeStyle = `rgba(40,4,0,${0.45 + rnd() * 0.3})`; ctx.lineWidth = W * 0.004 + rnd() * W * 0.005; ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 14; s++) { a += (rnd() - 0.5) * 0.7; x += Math.cos(a) * W * 0.012; y += Math.sin(a) * W * 0.012; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.restore();
    ctx.font = `800 ${W * 0.105}px -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${W * 0.018}px`;
    ctx.shadowColor = 'rgba(255,140,90,.85)'; ctx.shadowBlur = W * 0.03; ctx.fillStyle = '#fff1e4';
    ctx.fillText(text, c + W * 0.009, c + W * 0.005); ctx.shadowBlur = 0;
  }

  /**
   * Färbt ein SDO-Bild ein: Weißlicht warm (mit Randverdunkelung zur natürlichen Darstellung),
   * Kalzium violett (wie Ca-K-Aufnahmen üblich dargestellt).
   */
  function colorizeSun(img, kind, size, radiusPx) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, size, size);
    const id = x.getImageData(0, 0, size, size), d = id.data, c = size / 2, R = radiusPx * (size / 1024);
    const lum = new Float32Array(size * size);
    const samples = [];
    for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
      lum[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const px = j % size, py = (j / size) | 0;
      if ((px - c) ** 2 + (py - c) ** 2 < (R * 0.5) ** 2 && (j % 7 === 0)) samples.push(lum[j]);
    }
    samples.sort((a, b) => a - b);
    const med = samples[samples.length >> 1] || 128;
    const pal = [[0, 0, 0], [72, 30, 140], [150, 95, 235], [222, 196, 255], [255, 252, 255]];
    for (let j = 0, i = 0; j < lum.length; j++, i += 4) {
      const px = j % size, py = (j / size) | 0, rr = Math.hypot(px - c + 0.5, py - c + 0.5) / R;
      if (rr > 1.004) { d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = 255; continue; }
      const edge = rr > 1 ? 1 - (rr - 1) / 0.004 : 1;
      if (kind === 'ca') {
        const v = Math.max(0, Math.min(1, 0.18 + (lum[j] / med) * 0.48)) * edge; // Grundhelligkeit, damit sich die Scheibe vom Schwarz abhebt
        const t = v * (pal.length - 1), k = Math.min(pal.length - 2, t | 0), f = t - k;
        for (let ch = 0; ch < 3; ch++) d[i + ch] = pal[k][ch] + (pal[k + 1][ch] - pal[k][ch]) * f;
      } else {
        const mu = Math.sqrt(Math.max(0, 1 - Math.min(1, rr) ** 2));
        const ld = 1 - 0.56 * (1 - mu) - 0.12 * (1 - mu) ** 2;
        const v = Math.max(0, Math.min(1.15, (lum[j] / med) * 0.96)) * ld * edge;
        d[i] = Math.min(255, 255 * v); d[i + 1] = Math.min(255, 240 * Math.pow(v, 1.08)); d[i + 2] = Math.min(255, 205 * Math.pow(v, 1.35));
      }
      d[i + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    if (kind === 'ca') drawRim(x, c, R);
    return cv;
  }

  /**
   * Einfärben ohne Pixelzugriff (für Bilder fremder Server ohne CORS, z. B. auf dem Handy):
   * Graustufen per Sättigungs-Mischung, Farbton per Farb-Mischung, Randverdunkelung per Multiplikation.
   */
  function tintSun(img, kind, size, radiusPx) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const x = cv.getContext('2d'), c = size / 2, R = radiusPx * (size / 1024);
    x.drawImage(img, 0, 0, size, size);
    x.globalCompositeOperation = 'saturation'; x.fillStyle = '#808080'; x.fillRect(0, 0, size, size);
    if (kind === 'ca') {
      // Kontrast anheben (v² · 4): Netzwerk und Plages treten hervor, Hintergrund bleibt dunkel
      x.globalCompositeOperation = 'multiply'; x.drawImage(cv, 0, 0);
      x.globalCompositeOperation = 'lighter'; x.drawImage(cv, 0, 0); x.drawImage(cv, 0, 0);
      x.globalCompositeOperation = 'multiply'; x.fillStyle = '#cfa8ff'; x.fillRect(0, 0, size, size);
      x.globalCompositeOperation = 'screen'; x.fillStyle = 'rgba(62,26,125,.55)'; x.fillRect(0, 0, size, size); // Grundhelligkeit der Scheibe
    }
    else { x.globalCompositeOperation = 'color'; x.fillStyle = '#f5c27a'; x.fillRect(0, 0, size, size); }
    if (kind !== 'ca') {
      const g = x.createRadialGradient(c, c, 0, c, c, R);
      for (let i = 0; i <= 12; i++) { const r = i / 12, mu = Math.sqrt(Math.max(0, 1 - r * r)), ld = 1 - 0.56 * (1 - mu) - 0.12 * (1 - mu) ** 2, v = Math.round(255 * ld); g.addColorStop(r, `rgb(${v},${v},${v})`); }
      x.globalCompositeOperation = 'multiply'; x.fillStyle = g; x.fillRect(0, 0, size, size);
    }
    x.globalCompositeOperation = 'destination-in'; x.beginPath(); x.arc(c, c, R * 1.004, 0, 7); x.fill();
    x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#000'; x.fillRect(0, 0, size, size);
    x.globalCompositeOperation = 'source-over';
    if (kind === 'ca') drawRim(x, c, R);
    return cv;
  }

  /** Leuchtender Saum am Sonnenrand (Kalzium), damit die Scheibe klar vom Hintergrund abgesetzt ist. */
  function drawRim(x, c, R) {
    x.save();
    const g = x.createRadialGradient(c, c, R * 0.985, c, c, R * 1.06);
    g.addColorStop(0, 'rgba(205,170,255,.75)'); g.addColorStop(0.25, 'rgba(170,120,255,.35)'); g.addColorStop(1, 'rgba(120,70,220,0)');
    x.globalCompositeOperation = 'lighter'; x.fillStyle = g;
    x.beginPath(); x.arc(c, c, R * 1.06, 0, 7); x.arc(c, c, R * 0.985, 0, 7, true); x.fill();
    x.restore();
  }

  const fmt = {
    date: new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }),
    dateShort: new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    hm: new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }),
    utcHM: (d) => new Date(d).toISOString().slice(11, 16) + ' UTC',
    utcDate: (d) => { const s = new Date(d).toISOString(); return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`; },
    num: (v, n = 1) => (v == null || Number.isNaN(v) ? '–' : v.toFixed(n).replace('.', ',')),
    ago: (t) => { const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'gerade'; if (m < 60) return `vor ${m} min`; const h = Math.round(m / 60); if (h < 48) return `vor ${h} h`; return `vor ${Math.round(h / 24)} d`; },
  };

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function arName(num) { return `AR ${num}`; }

  root.SoluxUI = { rng, drawHalpha, colorizeSun, tintSun, fmt, esc, arName, D2R };
})(window);
