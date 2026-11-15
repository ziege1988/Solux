/* Solux – gemeinsame Hilfsfunktionen für die Oberflächen */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;

  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /** Startbild: H-Alpha-Sonne mit Schriftzug. */
  function drawHalpha(cv, text = 'SOLUX') {
    const ctx = cv.getContext('2d'), W = cv.width, c = W / 2, R = W * 0.33, rnd = rng(42);
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(c, c, W / 2, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [a, h, wd] of [[200, 0.17, 0.09], [320, 0.12, 0.06], [35, 0.09, 0.05], [115, 0.14, 0.07], [260, 0.06, 0.04]]) {
      for (let k = 0; k < 80; k++) {
        const aa = (a + (rnd() - 0.5) * wd * 90) * D2R, hh = R * (1 + rnd() * h * (1 - Math.abs(rnd() - 0.5)));
        ctx.fillStyle = `rgba(${(200 + rnd() * 55) | 0},${(50 + rnd() * 40) | 0},20,${0.05 + rnd() * 0.07})`;
        ctx.beginPath(); ctx.arc(c + Math.cos(aa) * hh, c + Math.sin(aa) * hh, W * 0.004 + rnd() * W * 0.012, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (let i = 0; i < 900; i++) { const a = rnd() * 7, h = R * (1 + rnd() * 0.03); ctx.fillStyle = 'rgba(230,70,30,.06)'; ctx.beginPath(); ctx.arc(c + Math.cos(a) * h, c + Math.sin(a) * h, W * 0.003, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    const g = ctx.createRadialGradient(c, c, 0, c, c, R); g.addColorStop(0, '#c63c1f'); g.addColorStop(0.75, '#a92e16'); g.addColorStop(1, '#6e170a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
    for (let i = 0; i < 9000; i++) { const a = rnd() * 7, rr = Math.sqrt(rnd()) * R; ctx.fillStyle = rnd() < 0.55 ? 'rgba(60,8,2,.10)' : 'rgba(255,120,70,.08)'; ctx.beginPath(); ctx.arc(c + Math.cos(a) * rr, c + Math.sin(a) * rr, W * 0.002 + rnd() * W * 0.006, 0, Math.PI * 2); ctx.fill(); }
    for (const [px, py] of [[-0.4, 0.24], [0.22, -0.3], [0.6, 0.16]]) for (let k = 0; k < 60; k++) { ctx.fillStyle = 'rgba(255,170,110,.09)'; ctx.beginPath(); ctx.arc(c + (px + (rnd() - 0.5) * 0.25) * R, c - (py + (rnd() - 0.5) * 0.16) * R, W * 0.006 + rnd() * W * 0.012, 0, Math.PI * 2); ctx.fill(); }
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

  /** Startbild: eigene Kalziumaufnahme mit Schriftzug „SOLUX“. Fällt auf die gezeichnete Sonne zurück. */
  function drawSplash(cv, src = 'assets/splash-sun.jpg') {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const x = cv.getContext('2d'), W = cv.width, c = W / 2;
        x.clearRect(0, 0, W, W);
        x.save(); x.beginPath(); x.arc(c, c, W / 2, 0, Math.PI * 2); x.clip();
        x.fillStyle = '#000'; x.fillRect(0, 0, W, W); x.drawImage(img, 0, 0, W, W);
        // weicher Abschluss zum Rand
        const g = x.createRadialGradient(c, c, W * 0.43, c, c, W * 0.5); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
        x.fillStyle = g; x.fillRect(0, 0, W, W);
        x.restore();
        x.font = `800 ${W * 0.105}px -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        if ('letterSpacing' in x) x.letterSpacing = `${W * 0.018}px`;
        x.shadowColor = 'rgba(40,10,90,.9)'; x.shadowBlur = W * 0.04; x.fillStyle = 'rgba(255,255,255,.96)';
        x.fillText('SOLUX', c + W * 0.009, c + W * 0.005);
        x.shadowColor = 'rgba(190,150,255,.9)'; x.shadowBlur = W * 0.02; x.fillText('SOLUX', c + W * 0.009, c + W * 0.005);
        x.shadowBlur = 0; resolve(true);
      };
      img.onerror = () => { drawHalpha(cv); resolve(false); };
      img.src = src;
    });
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
    // Ring-Mediane: Randverdunkelung ausgleichen (sonst kippt der Rand bei Kalzium/H-Alpha ins Schwarze)
    const NB = 48, bins = Array.from({ length: NB }, () => []);
    if (kind !== 'wl') for (let j = 0; j < lum.length; j += 3) { const px = j % size, py = (j / size) | 0, rr = Math.hypot(px - c, py - c) / R; if (rr < 0.995) bins[Math.min(NB - 1, (rr * NB) | 0)].push(lum[j]); }
    const ringMed = bins.map((b) => { if (!b.length) return med; b.sort((a, c2) => a - c2); return b[b.length >> 1]; });
    // H-Alpha: Himmel außerhalb des Rands je Ring (Streulicht), damit Protuberanzen verstärkt werden können
    const SB = 60, sky = new Float32Array(SB);
    if (kind === 'ha') {
      const sb = Array.from({ length: SB }, () => []);
      for (let j = 0; j < lum.length; j += 2) { const px = j % size, py = (j / size) | 0, rr = Math.hypot(px - c, py - c) / R; if (rr > 1 && rr < 1.6) sb[Math.min(SB - 1, (((rr - 1) / 0.6) * SB) | 0)].push(lum[j]); }
      sb.forEach((b, k) => { b.sort((p, q) => p - q); sky[k] = b.length ? b[b.length >> 1] : 0; });
    }
    // H-Alpha-Farben nach einer eigenen Aufnahme des Nutzers ausgemessen (kräftiges Orange-Braun)
    const pal = kind === 'ha'
      ? [[0, [18, 3, 0]], [0.16, [139, 36, 1]], [0.36, [180, 73, 10]], [0.52, [195, 92, 22]], [0.68, [210, 111, 37]], [0.82, [226, 140, 61]], [0.93, [241, 176, 101]], [1, [255, 222, 160]]]
      : [[0, [0, 0, 0]], [0.25, [72, 30, 140]], [0.5, [150, 95, 235]], [0.75, [222, 196, 255]], [1, [255, 252, 255]]];
    for (let j = 0, i = 0; j < lum.length; j++, i += 4) {
      const px = j % size, py = (j / size) | 0, rr = Math.hypot(px - c + 0.5, py - c + 0.5) / R;
      if (kind === 'ha' && rr > 1) {
        // Protuberanzen: Überschuss über dem Himmel verstärken (bis ×8, ab dem Rand weich eingeblendet), leicht aufgehellt
        // Überschuss über Himmel und Streulicht, abzüglich einer Rauschschwelle (≈ 4 % der Scheibenhelligkeit)
        const ex = Math.max(0, (lum[j] - sky[Math.min(SB - 1, (((rr - 1) / 0.6) * SB) | 0)]) / med - 0.04);
        const t = Math.min(1, (rr - 1) / 0.008), gain = 2 + 6 * t * t * (3 - 2 * t);
        // bis 1,12 R voll, bis 1,145 R auslaufend: Die GONG-Bilder enden bei ≈ 1,16 R, deren Rand soll nicht aufleuchten
        const fade = rr < 1.12 ? 1 : Math.max(0, 1 - (rr - 1.12) / 0.025);
        const v = Math.pow(Math.min(1, ex * gain), 0.8) * 245 * fade;
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255; continue;
      }
      if (rr > 1.004) { d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = 255; continue; }
      const edge = rr > 1 ? 1 - (rr - 1) / 0.004 : 1;
      if (kind === 'ha') {
        // H-Alpha schwarz-weiß: Filamente dunkel, Plages hell, Randverdunkelung ausgeglichen
        // Ring-Median zwischen den Stützstellen interpolieren (sonst entstehen sichtbare Ringe)
        const fb = Math.min(NB - 1.001, Math.max(0, Math.min(rr, 0.999) * NB - 0.5)), k0 = fb | 0, rm = ringMed[k0] + (ringMed[Math.min(NB - 1, k0 + 1)] - ringMed[k0]) * (fb - k0);
        const q = lum[j] / rm;
        const v = Math.max(0.03, Math.min(1, 0.55 + (q - 1) * 1.7)) * 235;
        d[i] = v; d[i + 1] = v; d[i + 2] = v;
      } else if (kind === 'ca') {
        // Kalzium: Grundhelligkeit, damit sich die Scheibe vom Schwarz abhebt · H-Alpha: Kontrast für Filamente und Plages anheben
        const q = lum[j] / ringMed[Math.min(NB - 1, (Math.min(rr, 0.999) * NB) | 0)], v = Math.max(0, Math.min(1, kind === 'ha' ? 0.52 + (q - 1) * 2.2 : 0.08 + q * 0.46)) * edge;
        let k = 0; while (k < pal.length - 2 && v > pal[k + 1][0]) k++;
        const f = Math.max(0, Math.min(1, (v - pal[k][0]) / (pal[k + 1][0] - pal[k][0])));
        for (let ch = 0; ch < 3; ch++) d[i + ch] = pal[k][1][ch] + (pal[k + 1][1][ch] - pal[k][1][ch]) * f;
      } else {
        const mu = Math.sqrt(Math.max(0, 1 - Math.min(1, rr) ** 2));
        const ld = 1 - 0.56 * (1 - mu) - 0.12 * (1 - mu) ** 2;
        const v = Math.max(0, Math.min(1.15, (lum[j] / med) * 0.96)) * ld * edge;
        d[i] = Math.min(255, 255 * v); d[i + 1] = Math.min(255, 240 * Math.pow(v, 1.08)); d[i + 2] = Math.min(255, 205 * Math.pow(v, 1.35));
      }
      d[i + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    if (kind === 'wl') {
      // Granulation und Fleckenstruktur schärfen, Scheibenrand danach wieder sauber ausschneiden
      highPassSharpen(cv, size / 450, 2);
      highPassSharpen(cv, size / 150, 1);
      x.save(); x.globalCompositeOperation = 'destination-in'; x.fillStyle = '#000'; x.beginPath(); x.arc(c, c, R * 1.004, 0, Math.PI * 2); x.fill();
      x.globalCompositeOperation = 'destination-over'; x.fillRect(0, 0, size, size); x.restore();
    }
    if (kind === 'ca') drawRim(x, c, R, kind);
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
    // H-Alpha: Ring außerhalb des Rands getrennt verstärken – dort liegen die Protuberanzen.
    // Streulicht schätzen ohne Pixelzugriff: Ring (1,006–1,15 R) stark weichzeichnen; weil Scheibe und Bildrand
    // durchsichtig sind, mittelt die Unschärfe nur über den Ring (normierte Faltung). |Ring − Streulicht| ergibt die
    // Protuberanzen, eine Schwelle (≈ 2 %) entfernt Rauschen, danach ×16.
    let off = null;
    if (kind === 'ha') {
      off = document.createElement('canvas'); off.width = off.height = size;
      const o = off.getContext('2d'); o.drawImage(cv, 0, 0);
      o.fillStyle = '#000';
      o.globalCompositeOperation = 'destination-out'; o.beginPath(); o.arc(c, c, R * 1.006, 0, Math.PI * 2); o.fill();
      o.globalCompositeOperation = 'destination-in'; o.beginPath(); o.arc(c, c, R * 1.15, 0, Math.PI * 2); o.fill();
      const sm = document.createElement('canvas'); sm.width = sm.height = Math.max(16, Math.round(size / 24));
      const smx = sm.getContext('2d'); smx.imageSmoothingQuality = 'high'; smx.drawImage(off, 0, 0, sm.width, sm.height);
      const bl = document.createElement('canvas'); bl.width = bl.height = size;
      const bx = bl.getContext('2d'); bx.imageSmoothingQuality = 'high';
      for (let i = 0; i < 6; i++) bx.drawImage(sm, 0, 0, size, size); // Deckkraft auffüllen, Farbe = Mittel über den Ring
      bx.globalCompositeOperation = 'destination-in'; bx.drawImage(off, 0, 0);
      o.globalCompositeOperation = 'difference'; o.drawImage(bl, 0, 0);
      o.globalCompositeOperation = 'color-burn'; o.fillStyle = '#fafafa'; o.fillRect(0, 0, size, size); // Schwelle ≈ 2 %
      // die Mischung füllt durchsichtige Stellen – Scheibe wieder ausschneiden
      o.fillStyle = '#000'; o.globalCompositeOperation = 'destination-out'; o.beginPath(); o.arc(c, c, R * 1.006, 0, Math.PI * 2); o.fill();
      for (let i = 0; i < 4; i++) selfDraw(o, off, 'lighter'); // ×16
      // bis ≈ 1,12 R, weich auslaufend (die GONG-Bilder enden bei ≈ 1,16 R)
      const fg = o.createRadialGradient(c, c, R * 1.11, c, c, R * 1.145); fg.addColorStop(0, '#000'); fg.addColorStop(1, 'rgba(0,0,0,0)');
      o.globalCompositeOperation = 'destination-in'; o.fillStyle = fg; o.fillRect(0, 0, size, size);
    }
    if (kind === 'ca') {
      // Erst aufhellen (×2), dann Kontrast (v²) und nochmals ×1,5: Scheibe hell, Netzwerk und Plages treten hervor
      liftLimb(x, c, R, size, 0.18);
      selfDraw(x, cv, 'lighter'); selfDraw(x, cv, 'multiply');
      x.globalAlpha = 0.5; selfDraw(x, cv, 'lighter'); x.globalAlpha = 1;
      x.globalCompositeOperation = 'multiply'; x.fillStyle = '#cfa8ff'; x.fillRect(0, 0, size, size);
      x.globalCompositeOperation = 'screen'; x.fillStyle = 'rgba(62,26,125,.35)'; x.fillRect(0, 0, size, size); // Grundhelligkeit der Scheibe
    }
    else if (kind === 'ha') {
      liftLimb(x, c, R, size, 0.3);
      selfDraw(x, cv, 'multiply'); x.globalAlpha = 0.5; selfDraw(x, cv, 'lighter'); x.globalAlpha = 1; // Kontrast: v² · 1,5
      // Details hervorheben: feine Strukturen (Fibrillen, Plages) und mittlere (Filamente, aktive Regionen)
      highPassSharpen(cv, size / 400, 2);
      highPassSharpen(cv, size / 120, 1);
    }
    else {
      // Weißlicht: sanfter Kontrast (Quadrat zu 35 % eingemischt, dann +20 %) – Flecken dunkler, Mitte nicht ausgefressen;
      // Schärfung für Fleckenstruktur
      x.globalAlpha = 0.35; selfDraw(x, cv, 'multiply'); x.globalAlpha = 0.2; selfDraw(x, cv, 'lighter'); x.globalAlpha = 1;
      highPassSharpen(cv, size / 300, 1);
      highPassSharpen(cv, size / 150, 1);
      // Einfärben per Multiplikation: auch die hellste Stelle bleibt warm-orange (Mischart „Farbe“ wird dort weiß)
      x.globalCompositeOperation = 'multiply'; x.fillStyle = '#ffcf8c'; x.fillRect(0, 0, size, size);
    }
    if (kind === 'wl') {
      const g = x.createRadialGradient(c, c, 0, c, c, R);
      for (let i = 0; i <= 12; i++) { const r = i / 12, mu = Math.sqrt(Math.max(0, 1 - r * r)), ld = 1 - 0.56 * (1 - mu) - 0.12 * (1 - mu) ** 2, v = Math.round(255 * ld); g.addColorStop(r, `rgb(${v},${v},${v})`); }
      x.globalCompositeOperation = 'multiply'; x.fillStyle = g; x.fillRect(0, 0, size, size);
    }
    x.fillStyle = '#000'; // deckende Füllung, sonst wird die Scheibe beim Zuschnitt teilweise durchsichtig (dunkel)
    x.globalCompositeOperation = 'destination-in'; x.beginPath(); x.arc(c, c, R * 1.004, 0, Math.PI * 2); x.fill();
    x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#000'; x.fillRect(0, 0, size, size);
    if (off) { x.globalCompositeOperation = 'lighter'; x.drawImage(off, 0, 0); }
    x.globalCompositeOperation = 'source-over';
    if (kind === 'ca') drawRim(x, c, R, kind);
    return cv;
  }

  /**
   * Hochpass-Schärfung ohne Pixelzugriff (funktioniert auch mit Bildern fremder Server):
   * Unschärfe durch Verkleinern/Vergrößern, Hochpass = (Bild + Negativ der Unschärfe) / 2 (Mittelgrau = keine Kante),
   * dann per „Ineinanderkopieren“ (overlay) zurückmischen – wie „Hochpass schärfen“ in der Bildbearbeitung.
   * blurPx: Unschärferadius in Pixeln, passes: Stärke (1–3).
   */
  function highPassSharpen(cv, blurPx = 3, passes = 2) {
    const W = cv.width, H = cv.height, f = Math.max(1.5, blurPx);
    const sm = document.createElement('canvas'); sm.width = Math.max(1, Math.round(W / f)); sm.height = Math.max(1, Math.round(H / f));
    const sx = sm.getContext('2d'); sx.imageSmoothingQuality = 'high'; sx.drawImage(cv, 0, 0, sm.width, sm.height);
    const hp = document.createElement('canvas'); hp.width = W; hp.height = H;
    const hx = hp.getContext('2d'); hx.imageSmoothingQuality = 'high';
    hx.fillStyle = '#fff'; hx.fillRect(0, 0, W, H);
    hx.globalCompositeOperation = 'difference'; hx.drawImage(sm, 0, 0, W, H); // 255 − Unschärfe
    hx.globalCompositeOperation = 'source-over'; hx.globalAlpha = 0.5; hx.drawImage(cv, 0, 0); hx.globalAlpha = 1;
    const x = cv.getContext('2d');
    x.save(); x.globalCompositeOperation = 'overlay';
    for (let i = 0; i < passes; i++) x.drawImage(hp, 0, 0);
    x.restore();
  }

  /** Leinwand mit einer Mischart auf sich selbst zeichnen – über eine Kopie (Selbst-Zeichnen ist nicht überall zuverlässig). */
  function selfDraw(x, cv, op) {
    const t = document.createElement('canvas'); t.width = cv.width; t.height = cv.height;
    t.getContext('2d').drawImage(cv, 0, 0);
    x.globalCompositeOperation = op; x.drawImage(t, 0, 0);
  }

  /** Randverdunkelung ohne Pixelzugriff grob ausgleichen: Rand per „Screen“ aufhellen. */
  function liftLimb(x, c, R, size, amount) {
    const g = x.createRadialGradient(c, c, R * 0.55, c, c, R);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, `rgba(255,255,255,${amount * 0.45})`); g.addColorStop(1, `rgba(255,255,255,${amount})`);
    x.globalCompositeOperation = 'screen'; x.fillStyle = g; x.beginPath(); x.arc(c, c, R, 0, Math.PI * 2); x.fill();
  }

  /** Leuchtender Saum am Sonnenrand (Kalzium), damit die Scheibe klar vom Hintergrund abgesetzt ist. */
  function drawRim(x, c, R, kind = 'ca') {
    x.save();
    const g = x.createRadialGradient(c, c, R * 0.985, c, c, R * 1.06);
    if (kind === 'ha') { g.addColorStop(0, 'rgba(255,140,90,.7)'); g.addColorStop(0.25, 'rgba(230,70,35,.35)'); g.addColorStop(1, 'rgba(180,30,10,0)'); }
    else { g.addColorStop(0, 'rgba(205,170,255,.75)'); g.addColorStop(0.25, 'rgba(170,120,255,.35)'); g.addColorStop(1, 'rgba(120,70,220,0)'); }
    x.globalCompositeOperation = 'lighter'; x.fillStyle = g;
    x.beginPath(); x.arc(c, c, R * 1.06, 0, Math.PI * 2); x.arc(c, c, R * 0.985, 0, Math.PI * 2, true); x.fill();
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

  root.SoluxUI = { highPassSharpen, rng, drawHalpha, drawSplash, colorizeSun, tintSun, fmt, esc, arName, D2R };
})(window);
