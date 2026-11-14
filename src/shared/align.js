/*
 * Solux – Bildanalyse und automatische Ausrichtung
 *
 * Ablauf:
 *  1. Graustufen, verkleinern (Sonnenradius ≈ 200 px)
 *  2. Sonnenrand finden: Strahlen vom Schwerpunkt, Kreis-Fit (Kasa) mit Ausreißerentfernung
 *  3. Polar-Abtastung (Radius × Winkel), Randverdunkelung entfernen (Ring-Median)
 *  4. Merkmale: Weißlicht = dunkle Flecken; Kalzium = helle Plages/Netzwerk + Flecken
 *  5. Zirkuläre Kreuzkorrelation gegen das SDO-Referenzbild über 360°, mit und ohne Spiegelung
 *  6. Sicherheit aus Korrelationsgüte, Abstand zum zweitbesten Peak und Zahl der Fleckengruppen
 *
 * Konvention der Transformation (Canvas): zuerst horizontal spiegeln (flip),
 * dann im Uhrzeigersinn um `rotation` Grad drehen, jeweils um den Scheibenmittelpunkt.
 * Ergebnis: Sonnennorden oben, Osten links.
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;

  function toGray(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    return g;
  }

  /** Flächenmittelnde Verkleinerung um ganzzahligen/reellen Faktor. */
  function downsample(gray, w, h, factor) {
    if (factor <= 1) return { data: gray, w, h, scale: 1 };
    const nw = Math.max(1, Math.round(w / factor)), nh = Math.max(1, Math.round(h / factor));
    const out = new Float32Array(nw * nh), cnt = new Float32Array(nw * nh);
    for (let y = 0; y < h; y++) {
      const ny = Math.min(nh - 1, Math.floor((y * nh) / h));
      for (let x = 0; x < w; x++) {
        const nx = Math.min(nw - 1, Math.floor((x * nw) / w));
        out[ny * nw + nx] += gray[y * w + x]; cnt[ny * nw + nx]++;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] /= cnt[i] || 1;
    return { data: out, w: nw, h: nh, scale: nw / w };
  }

  function bilinear(g, w, h, x, y) {
    if (x < 0 || y < 0 || x > w - 1.001 || y > h - 1.001) return NaN;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy;
  }

  function percentile(arr, p) {
    const step = Math.max(1, Math.floor(arr.length / 20000));
    const s = []; for (let i = 0; i < arr.length; i += step) s.push(arr[i]);
    s.sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  }

  function fitCircle(pts) {
    // Kasa-Fit: x² + y² + Dx + Ey + F = 0
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const n = pts.length;
    for (const [x, y] of pts) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], b = [-sxz, -syz, -sz];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d = det(A); if (!d) return null;
    const rep = (k) => A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)));
    const D = det(rep(0)) / d, E = det(rep(1)) / d, F = det(rep(2)) / d;
    const cx = -D / 2, cy = -E / 2, r = Math.sqrt(cx * cx + cy * cy - F);
    return { cx, cy, r };
  }

  /** Sonnenscheibe finden. Liefert Mittelpunkt/Radius in Pixeln des übergebenen Bildes. */
  /** Kreis mit festem Radius an Randpunkte anpassen (Gauss-Newton) – für kurze Randbögen. */
  function fitCircleFixedR(pts, r, init) {
    let cx = init.cx, cy = init.cy;
    for (let it = 0; it < 50; it++) {
      let gx = 0, gy = 0, hxx = 0, hxy = 0, hyy = 0;
      for (const [x, y] of pts) {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1e-9, res = d - r, jx = -dx / d, jy = -dy / d;
        gx += jx * res; gy += jy * res; hxx += jx * jx; hxy += jx * jy; hyy += jy * jy;
      }
      const det = hxx * hyy - hxy * hxy; if (Math.abs(det) < 1e-12) break;
      const sx = -(hyy * gx - hxy * gy) / det, sy = -(-hxy * gx + hxx * gy) / det;
      cx += sx; cy += sy;
      if (Math.hypot(sx, sy) < 1e-3) break;
    }
    return { cx, cy, r };
  }

  /** Winkelspanne des sichtbaren Randbogens (Grad) um den Mittelpunkt. */
  function arcSpan(pts, cx, cy) {
    const a = pts.map(([x, y]) => Math.atan2(y - cy, x - cx)).sort((p, q) => p - q);
    let gap = 0;
    for (let i = 0; i < a.length; i++) gap = Math.max(gap, (i ? a[i] - a[i - 1] : a[0] + 2 * Math.PI - a[a.length - 1]));
    return 360 - (gap * 180) / Math.PI;
  }

  function detectDisc(g, w, h, opts = {}) {
    const bg = percentile(g, 0.05), hi = percentile(g, 0.98);
    if (hi - bg < 8) throw new Error('Kein Kontrast – ist die Sonne im Bild?');
    const thr = bg + 0.3 * (hi - bg);
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (g[y * w + x] > thr) { n++; sx += x; sy += y; }
    if (n < 50) throw new Error('Sonnenscheibe nicht gefunden.');
    let cx = sx / n, cy = sy / n;
    const r0 = Math.sqrt((n * 4) / Math.PI);
    let pts = [];
    const jump = 0.15 * (hi - bg);
    // Suchbereich: bei Ausschnitten kann der Rand weit vom hellen Schwerpunkt entfernt liegen
    const step = 0.5, n0 = Math.floor((r0 * 0.25) / step), n1 = Math.ceil(Math.max(r0 * 1.6, Math.hypot(w, h)) / step);
    const prof = new Float32Array(n1 + 2);
    for (let a = 0; a < 720; a++) {
      const t = (a / 720) * 2 * Math.PI, dx = Math.cos(t), dy = Math.sin(t);
      let valid = true, last = n1;
      for (let k = n0; k <= n1; k++) {
        const v = bilinear(g, w, h, cx + dx * k * step, cy + dy * k * step);
        if (Number.isNaN(v)) { last = k - 1; valid = false; break; }
        prof[k] = v;
      }
      // steilster Abfall (über m Stützstellen geglättet) = Sonnenrand, unabhängig von Randverdunkelung
      const m = Math.max(2, Math.round((r0 * 0.006) / step));
      const dAt = (k) => { let a2 = 0, b2 = 0; for (let q = 1; q <= m; q++) { a2 += prof[k + q]; b2 += prof[k - q]; } return (a2 - b2) / m; };
      let best = 0, bk = -1;
      const dark = bg + 0.3 * (hi - bg);
      for (let k = n0 + m; k <= last - m; k++) {
        if (prof[k + m] > dark) continue;
        // Hinter dem Sonnenrand bleibt es dunkel (Himmel) – Flecken dagegen enden wieder in heller Photosphäre
        let after = 0, na = 0; for (let q = k + m; q <= Math.min(last, k + 6 * m); q++) { after += prof[q]; na++; }
        if (na && after / na > dark) continue;
        const d = dAt(k); if (d < best) { best = d; bk = k; }
      }
      if (bk < 0 || -best < jump * 0.5) continue;
      if (!valid && last - bk < 2 * m + 4) continue; // Kante liegt am Bildrand
      let off = 0;
      if (bk - 1 >= n0 + m && bk + 1 <= last - m) { const a1 = dAt(bk - 1), b1 = best, c1 = dAt(bk + 1), den = a1 - 2 * b1 + c1; if (den) off = Math.max(-0.5, Math.min(0.5, (0.5 * (a1 - c1)) / den)); }
      const s = (bk + off) * step;
      pts.push([cx + dx * s, cy + dy * s]);
    }
    if (pts.length < 25) throw new Error('Sonnenrand zu wenig sichtbar.');
    let c = fitCircle(pts);
    if (!c || !Number.isFinite(c.r)) throw new Error('Sonnenrand nicht auswertbar.');
    for (let it = 0; it < 3; it++) {
      const res = pts.map(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r));
      const med = res.slice().sort((a, b) => a - b)[res.length >> 1] || 0.5;
      const keep = pts.filter((p, i) => res[i] < Math.max(1.5, 4 * med));
      if (keep.length < 30) break;
      pts = keep; c = fitCircle(pts);
    }
    let span = arcSpan(pts, c.cx, c.cy);
    // Kurzer Bogen: Radius aus dem Bildmaßstab vorgeben, nur den Mittelpunkt anpassen
    if (opts.expectedR && span < 200) {
      const mx = pts.reduce((t, p) => t + p[0], 0) / pts.length, my = pts.reduce((t, p) => t + p[1], 0) / pts.length;
      let nx = cx - mx, ny = cy - my; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl; // Sonne liegt auf der hellen Seite
      c = fitCircleFixedR(pts, opts.expectedR, { cx: mx + nx * opts.expectedR, cy: my + ny * opts.expectedR });
      span = arcSpan(pts, c.cx, c.cy);
    }
    const resid = Math.sqrt(pts.reduce((s, [x, y]) => s + (Math.hypot(x - c.cx, y - c.cy) - c.r) ** 2, 0) / pts.length);
    const coverage = pts.length / 720;
    const inside = c.cx - c.r > -2 && c.cy - c.r > -2 && c.cx + c.r < w + 2 && c.cy + c.r < h + 2;
    return { cx: c.cx, cy: c.cy, r: c.r, residual: resid, coverage, span, inside, threshold: thr, fixedR: !!(opts.expectedR && span < 200) };
  }

  /**
   * Bildart bestimmen: ganze Sonne, Ausschnitt mit Randbogen oder Oberfläche ohne Rand.
   * opts.expectedR: erwarteter Sonnenradius in Pixeln (aus dem Bildmaßstab), optional.
   */
  function classifyImage(g, w, h, opts = {}) {
    let d = null;
    try { d = detectDisc(g, w, h, opts); } catch (e) { return { type: 'surface', reason: e.message }; }
    if (d.inside && d.span > 300) return { type: 'full', disc: d };
    const minSpan = opts.expectedR ? 12 : 30; // ohne Maßstab braucht der Kreis-Fit einen längeren Bogen
    const plausible = d.r > 0.3 * Math.min(w, h) && d.r < 6 * Math.max(w, h);
    if (d.span >= minSpan && plausible && d.residual < Math.max(2.5, d.r * 0.01)) return { type: 'partial', disc: d };
    return { type: 'surface', disc: null, reason: 'Kein eindeutiger Sonnenrand im Bild.' };
  }

  /**
   * Polar-Abtastung mit Kontrast relativ zum Ring-Median.
   * Winkel θ: im Uhrzeigersinn ab "oben" (Bildschirm). flip: horizontal gespiegelt abtasten.
   */
  function polarContrast(g, w, h, disc, opt = {}) {
    const nR = opt.nR || 64, nT = opt.nT || 720, rMin = opt.rMin ?? 0.04, rMax = opt.rMax ?? 0.93;
    const out = new Float32Array(nR * nT);
    const ring = new Float32Array(nT);
    const mask = new Uint8Array(nR * nT).fill(1); let partial = false;
    for (let i = 0; i < nR; i++) {
      const rho = rMin + ((rMax - rMin) * (i + 0.5)) / nR;
      for (let k = 0; k < nT; k++) {
        const t = (k / nT) * 2 * Math.PI;
        const sx = Math.sin(t) * (opt.flip ? -1 : 1);
        const v = bilinear(g, w, h, disc.cx + sx * rho * disc.r, disc.cy - Math.cos(t) * rho * disc.r);
        ring[k] = v; // NaN = außerhalb des Bildes
      }
      const valid = Array.from(ring).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
      const med = valid[valid.length >> 1] || 1;
      for (let k = 0; k < nT; k++) { const ok = !Number.isNaN(ring[k]); out[i * nT + k] = ok ? ring[k] / med - 1 : 0; if (!ok) { mask[i * nT + k] = 0; partial = true; } }
    }
    return { data: out, nR, nT, rMin, rMax, mask, partial };
  }

  /** Merkmalskarte aus Kontrast. mode 'wl': dunkle Flecken, 'ca': signierter Kontrast (Plages + Flecken). */
  function featureMap(p, mode) {
    const f = new Float32Array(p.data.length);
    const { nR, nT } = p;
    for (let i = 0; i < nR; i++) {
      // Ringweise robuste Streuung, damit Rauschen/Granulation nicht dominiert
      const row = p.data.subarray(i * nT, (i + 1) * nT);
      const absd = Float32Array.from(row, Math.abs).sort();
      const mad = absd[nT >> 1] * 1.4826 || 0.01;
      const radW = Math.sqrt((p.rMin + ((p.rMax - p.rMin) * (i + 0.5)) / nR)); // äußere Ringe haben mehr Fläche
      for (let k = 0; k < nT; k++) {
        const c = row[k];
        let v;
        if (mode === 'ca') v = Math.max(-6, Math.min(6, c / mad)) ;
        else v = Math.max(0, -c / mad - 3.5);
        f[i * nT + k] = v * radW;
      }
    }
    // leicht glätten (±2 Winkelschritte), mittelwertfrei machen
    const s = new Float32Array(f.length);
    for (let i = 0; i < nR; i++) for (let k = 0; k < nT; k++) {
      let acc = 0; for (let d = -2; d <= 2; d++) acc += f[i * nT + ((k + d + nT) % nT)];
      s[i * nT + k] = acc / 5;
    }
    let mean = 0, nv = 0; for (let i = 0; i < s.length; i++) if (!p.mask || p.mask[i]) { mean += s[i]; nv++; } mean /= nv || 1;
    let norm = 0; for (let i = 0; i < s.length; i++) { if (p.mask && !p.mask[i]) { s[i] = 0; continue; } s[i] -= mean; norm += s[i] * s[i]; }
    return { data: s, nR, nT, norm: Math.sqrt(norm), mask: p.partial ? p.mask : null };
  }

  /** Zirkuläre Korrelation über alle Winkelverschiebungen. */
  function correlate(fu, fr) {
    const { nR, nT } = fu, out = new Float32Array(nT);
    if (fu.mask) {
      // Ausschnitt: nur über den sichtbaren Bereich normieren
      for (let s = 0; s < nT; s++) {
        let acc = 0, er = 0;
        for (let i = 0; i < nR; i++) {
          const a = i * nT;
          for (let k = 0; k < nT; k++) { const j = a + ((k + s) % nT); if (!fu.mask[j]) continue; const r = fr.data[a + k]; acc += fu.data[j] * r; er += r * r; }
        }
        out[s] = acc / (fu.norm * Math.sqrt(er) || 1);
      }
      return out;
    }
    for (let s = 0; s < nT; s++) {
      let acc = 0;
      for (let i = 0; i < nR; i++) {
        const a = i * nT;
        for (let k = 0; k < nT; k++) acc += fu.data[a + ((k + s) % nT)] * fr.data[a + k];
      }
      out[s] = acc / (fu.norm * fr.norm || 1);
    }
    return out;
  }

  function peakOf(c) {
    let best = 0; for (let i = 1; i < c.length; i++) if (c[i] > c[best]) best = i;
    const n = c.length, a = c[(best - 1 + n) % n], b = c[best], d = c[(best + 1) % n];
    const den = a - 2 * b + d; const off = den ? (0.5 * (a - d)) / den : 0;
    return { idx: best, value: b, shift: best + Math.max(-0.5, Math.min(0.5, off)) };
  }

  /** Fleckengruppen zählen (Cluster dunkler Pixel) in der Polar-Kontrastkarte. */
  function countGroups(p, thresh = -0.18) {
    const pts = [];
    const { nR, nT } = p;
    for (let i = 0; i < nR; i++) {
      const rho = p.rMin + ((p.rMax - p.rMin) * (i + 0.5)) / nR;
      for (let k = 0; k < nT; k += 2) if (p.data[i * nT + k] < thresh) { const t = (k / nT) * 2 * Math.PI; pts.push([rho * Math.sin(t), rho * Math.cos(t)]); }
    }
    const groups = [];
    for (const q of pts) {
      const g = groups.find((G) => Math.hypot(G.x - q[0], G.y - q[1]) < 0.1);
      if (g) { g.n++; g.x += (q[0] - g.x) / g.n; g.y += (q[1] - g.y) / g.n; } else groups.push({ x: q[0], y: q[1], n: 1 });
    }
    return groups.filter((g) => g.n >= 2);
  }

  /** Flecken zu Gruppen zusammenfassen (Abstand < 0,08 R). */
  function clusterGroups(spots, dist = 0.08) {
    const groups = [];
    for (const sp of spots) {
      const near = groups.filter((G) => G.spots.some((q) => Math.hypot(q.x - sp.x, q.y - sp.y) < dist));
      if (!near.length) groups.push({ spots: [sp] });
      else { near[0].spots.push(sp); for (const o of near.slice(1)) { near[0].spots.push(...o.spots); groups.splice(groups.indexOf(o), 1); } }
    }
    return groups.map((G) => ({ x: G.spots.reduce((t, q) => t + q.x, 0) / G.spots.length, y: G.spots.reduce((t, q) => t + q.y, 0) / G.spots.length, n: G.spots.length }));
  }

  /**
   * Hauptfunktion.
   * user/ref: {gray, w, h}; mode: 'wl'|'ca'; opts.knownFlip: true/false/null
   * Rückgabe: {ok, reason, rotation, flip, ncc, ratio, groups, discUser, discRef, log[]}
   */
  function align(user, ref, mode, opts = {}) {
    const log = [];
    const targetR = 200;
    const du0 = opts.disc || detectDisc(user.gray, user.w, user.h);
    const fU = Math.max(1, du0.r / targetR);
    const U = downsample(user.gray, user.w, user.h, fU);
    const dU = { cx: du0.cx * U.scale, cy: du0.cy * U.scale, r: du0.r * U.scale };
    log.push(`Sonnenrand: Mittelpunkt (${du0.cx.toFixed(1)}, ${du0.cy.toFixed(1)}) · r = ${du0.r.toFixed(1)} px · Restfehler ${du0.residual.toFixed(2)} px`);
    const dr0 = ref.disc || detectDisc(ref.gray, ref.w, ref.h);
    const fR = Math.max(1, dr0.r / targetR);
    const R = downsample(ref.gray, ref.w, ref.h, fR);
    const dR = { cx: dr0.cx * R.scale, cy: dr0.cy * R.scale, r: dr0.r * R.scale };

    const pr = polarContrast(R.data, R.w, R.h, dR);
    const fr = featureMap(pr, mode);
    const refSpots = detectSpots(ref.gray, ref.w, ref.h, dr0, 0, false, { grid: Math.min(900, Math.round(dr0.r * 2)), threshold: -0.12 });
    const groupsRef = clusterGroups(refSpots);
    log.push(`Referenz: ${groupsRef.length} Fleckengruppe(n) erkannt`);

    const results = [];
    for (const flip of [false, true]) {
      const pu = polarContrast(U.data, U.w, U.h, dU, { flip });
      const fu = featureMap(pu, mode);
      const c = correlate(fu, fr);
      const pk = peakOf(c);
      const step = 360 / fr.nT;
      // zweitbester Peak außerhalb ±10°
      let second = -Infinity;
      for (let i = 0; i < c.length; i++) { const d = Math.min(Math.abs(i - pk.idx), c.length - Math.abs(i - pk.idx)) * step; if (d > 10 && c[i] > second) second = c[i]; }
      results.push({ flip, corr: c, ncc: pk.value, shiftDeg: pk.shift * step, second });
    }
    results.sort((a, b) => b.ncc - a.ncc);
    let best = results[0], other = results[1];
    let profileConflict = false;
    if (opts.knownFlip != null && best.flip !== opts.knownFlip) {
      // Profil nur als Entscheidungshilfe, wenn das Ergebnis nicht eindeutig ist
      if (best.ncc < other.ncc * 1.25) { [best, other] = [other, best]; log.push('Spiegelung uneindeutig – Wert aus dem Setup-Profil verwendet.'); }
      else { profileConflict = true; log.push('Hinweis: Spiegelung weicht vom Setup-Profil ab (Bild anders aufgenommen?).'); }
    }
    const competitor = Math.max(best.second, other ? other.ncc : -Infinity);
    const ratio = competitor > 0 ? best.ncc / competitor : 9;
    let rotation = -best.shiftDeg; rotation = ((rotation % 360) + 540) % 360 - 180;
    log.push(`Korrelation ${best.ncc.toFixed(3)} · Abstand zum nächsten Kandidaten ×${ratio.toFixed(2)}`);

    // Fleckengruppen auf der eigenen Aufnahme (maßgeblich für die Rückfrage)
    const userSpots = detectSpots(U.data, U.w, U.h, dU, 0, false, { grid: Math.min(900, Math.round(dU.r * 2)), threshold: -0.12 });
    const groupsUser = clusterGroups(userSpots).length;
    log.push(`Eigene Aufnahme: ${groupsUser} Fleckengruppe(n) erkannt`);
    const nGroups = Math.min(groupsRef.length, groupsUser);
    let ok = false, reason = '';
    if (mode === 'ca') {
      ok = best.ncc >= 0.35 && ratio >= 1.5;
      if (!ok) reason = 'Zu wenig eindeutige Strukturen (Plages/Flecken) für einen sicheren Abgleich.';
    } else if (nGroups >= 2) {
      ok = best.ncc >= 0.2 && ratio >= 1.2;
      if (!ok) reason = 'Fleckenmuster passt nicht eindeutig zur Referenz (Aufnahmezeit prüfen?).';
    } else if (nGroups === 1 && opts.knownFlip != null) {
      ok = best.flip === opts.knownFlip && best.ncc >= 0.2 && ratio >= 1.3;
      if (ok) log.push('Nur eine Fleckengruppe – Spiegelung aus dem Setup-Profil übernommen.');
      else reason = 'Die einzige Fleckengruppe ist nicht eindeutig zuzuordnen.';
    } else {
      if (groupsUser === 0) reason = 'Auf deiner Aufnahme sind keine Sonnenflecken erkennbar.';
      else if (nGroups === 1) reason = 'Nur eine Fleckengruppe sichtbar – damit ist die Spiegelung nicht bestimmbar (Setup-Profil noch leer).';
      else reason = 'Keine Sonnenflecken in der Referenz sichtbar.';
    }
    return {
      ok, reason, rotation, flip: best.flip, ncc: best.ncc, ratio, groups: nGroups, groupsRef: groupsRef.length, groupsUser, groupList: groupsRef, profileConflict,
      discUser: du0, discRef: dr0, log, curve: Array.from(best.corr),
    };
  }

  /**
   * Flecken im ausgerichteten Bild finden.
   * Liefert Flecken in Sonnenradien (x West+, y Nord+), Fläche in Millionstel Hemisphäre (grob), Kontrast.
   */
  function detectSpots(gray, w, h, disc, rotation, flip, opts = {}) {
    const N = opts.grid || 360; // Raster über Durchmesser
    const half = N / 2, spots = [];
    const mask = new Uint8Array(N * N), val = new Float32Array(N * N);
    const cr = Math.cos(-rotation * D2R), sr = Math.sin(-rotation * D2R);
    // Ring-Median für Kontrast
    const rings = 40, ringVals = Array.from({ length: rings }, () => []);
    const sample = (gx, gy) => {
      const X = (gx - half + 0.5) / half, Y = (gy - half + 0.5) / half; // X rechts, Y unten, Einheit Radius (ausgerichtet)
      // zurück in Originalbild: inverse Drehung, dann inverse Spiegelung
      let ux = X * cr - Y * sr, uy = X * sr + Y * cr;
      if (flip) ux = -ux;
      return bilinear(gray, w, h, disc.cx + ux * disc.r, disc.cy + uy * disc.r);
    };
    for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
      const X = (gx - half + 0.5) / half, Y = (gy - half + 0.5) / half, rr = Math.hypot(X, Y);
      if (rr > 0.97) continue;
      const v = sample(gx, gy); val[gy * N + gx] = v;
      if (!Number.isNaN(v)) ringVals[Math.min(rings - 1, Math.floor(rr * rings))].push(v);
    }
    const ringMed = ringVals.map((a) => (a.length ? a.sort((x, y) => x - y)[a.length >> 1] : 1));
    const thr = opts.threshold ?? -0.16;
    const con = new Float32Array(N * N);
    for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
      const X = (gx - half + 0.5) / half, Y = (gy - half + 0.5) / half, rr = Math.hypot(X, Y);
      if (rr > 0.97) continue;
      const c = val[gy * N + gx] / ringMed[Math.min(rings - 1, Math.floor(rr * rings))] - 1;
      con[gy * N + gx] = Number.isNaN(c) ? 0 : c;
    }
    // Schwelle an das Bildrauschen anpassen (stark geschärfte Bilder: Granulation nicht als Flecken zählen)
    const samp = []; for (let i = 0; i < con.length; i += 7) if (con[i] !== 0) samp.push(Math.abs(con[i]));
    samp.sort((a, b) => a - b);
    const mad = samp.length ? samp[samp.length >> 1] * 1.4826 : 0;
    const thrEff = Math.min(thr, -5 * mad);
    for (let i = 0; i < con.length; i++) if (con[i] < thrEff) mask[i] = 1;
    // Zusammenhangskomponenten
    const seen = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) {
      if (!mask[i] || seen[i]) continue;
      const stack = [i]; seen[i] = 1; let n = 0, sx = 0, sy = 0, minC = 0, umbra = 0;
      while (stack.length) {
        const j = stack.pop(); const x = j % N, y = (j / N) | 0; n++; sx += x; sy += y; minC = Math.min(minC, con[j]); if (con[j] < -0.45) umbra++;
        for (const k of [j - 1, j + 1, j - N, j + N]) if (k >= 0 && k < N * N && mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
      if (n < 2) continue;
      const X = (sx / n - half + 0.5) / half, Y = (sy / n - half + 0.5) / half;
      const mu = Math.sqrt(Math.max(0.05, 1 - X * X - Y * Y));
      const areaMSH = (n / (Math.PI * half * half)) / mu / 2 * 1e6; // Anteil an Hemisphäre, verkürzungskorrigiert
      spots.push({ x: X, y: -Y, pixels: n, areaMSH, contrast: minC, penumbra: umbra < n * 0.85 && n > 6 });
    }
    return spots;
  }

  /** Flecken zu NOAA-Regionen zuordnen (nächste Region, max. Abstand 0,12 R). */
  function matchSpots(spots, regions, maxDist = 0.12) {
    const assigned = regions.map((r) => ({ region: r, spots: [] }));
    const unassigned = [];
    for (const s of spots) {
      let best = null, bd = Infinity;
      for (const a of assigned) { const d = Math.hypot(a.region.x - s.x, a.region.y - s.y); if (d < bd) { bd = d; best = a; } }
      if (best && bd < maxDist) best.spots.push(s); else unassigned.push(s);
    }
    for (const a of assigned) {
      if (a.spots.length) {
        const wsum = a.spots.reduce((t, s) => t + s.pixels, 0);
        a.x = a.spots.reduce((t, s) => t + s.x * s.pixels, 0) / wsum;
        a.y = a.spots.reduce((t, s) => t + s.y * s.pixels, 0) / wsum;
      } else { a.x = a.region.x; a.y = a.region.y; }
    }
    // nicht zugeordnete Flecken grob gruppieren
    const extra = [];
    for (const s of unassigned) {
      const g = extra.find((G) => Math.hypot(G.x - s.x, G.y - s.y) < 0.08);
      if (g) { g.spots.push(s); g.x = (g.x + s.x) / 2; g.y = (g.y + s.y) / 2; } else extra.push({ x: s.x, y: s.y, spots: [s] });
    }
    // Nur deutliche Gruppen als „neu?“ melden: genug Fläche und mindestens ein dunkler Kern
    return { matched: assigned, extra: extra.filter((g) => g.spots.reduce((t, s) => t + s.pixels, 0) >= 12 && Math.min(...g.spots.map((s) => s.contrast)) <= -0.32) };
  }

  /* ================= Oberflächenbilder ohne Sonnenrand ================= */

  /** Dunkle Flecken/Poren gegen den lokalen Hintergrund finden (Kastenfilter über Integralbild). */
  function detectBlobs(g, w, h, opts = {}) {
    const rad = Math.max(4, Math.round(opts.radius || 25)), thr = opts.threshold ?? -0.18;
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    const box = (x, y) => { const x0 = Math.max(0, x - rad), y0 = Math.max(0, y - rad), x1 = Math.min(w, x + rad + 1), y1 = Math.min(h, y + rad + 1); return (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)); };
    const hiV = percentile(g, 0.9);
    const con = new Float32Array(w * h), mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, bgv = Math.max(box(x, y), hiV * 0.6); // in großen Flecken nicht den Fleck selbst als Hintergrund nehmen
      const c = g[i] / (bgv || 1) - 1; con[i] = c; if (c < thr) mask[i] = 1;
    }
    const seen = new Uint8Array(w * h), out = [];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || seen[i]) continue;
      const st = [i]; seen[i] = 1; let n = 0, sx = 0, sy = 0, wsum = 0, minC = 0;
      while (st.length) {
        const j = st.pop(), x = j % w, y = (j / w) | 0, wt = -con[j];
        n++; sx += x * wt; sy += y * wt; wsum += wt; minC = Math.min(minC, con[j]);
        for (const k of [j - 1, j + 1, j - w, j + w]) if (k >= 0 && k < w * h && mask[k] && !seen[k] && Math.abs((k % w) - x) <= 1) { seen[k] = 1; st.push(k); }
      }
      if (n < (opts.minPixels || 3)) continue;
      out.push({ u: sx / wsum, v: sy / wsum, pixels: n, contrast: minC });
    }
    return out.sort((a, b) => b.pixels - a.pixels);
  }

  /** Ähnlichkeitstransformation (Procrustes) aus Punktpaaren: b ≈ s·R(θ)·a + t */
  function fitSimilarity(A, B) {
    const n = A.length; let ax = 0, ay = 0, bx = 0, by = 0;
    for (let i = 0; i < n; i++) { ax += A[i][0]; ay += A[i][1]; bx += B[i][0]; by += B[i][1]; }
    ax /= n; ay /= n; bx /= n; by /= n;
    let sxx = 0, sxy = 0, saa = 0;
    for (let i = 0; i < n; i++) { const p = A[i][0] - ax, q = A[i][1] - ay, u = B[i][0] - bx, v = B[i][1] - by; sxx += p * u + q * v; sxy += p * v - q * u; saa += p * p + q * q; }
    const th = Math.atan2(sxy, sxx), sc = Math.hypot(sxx, sxy) / (saa || 1);
    const c = Math.cos(th), s2 = Math.sin(th);
    return { theta: th, scale: sc, tx: bx - sc * (c * ax - s2 * ay), ty: by - sc * (s2 * ax + c * ay) };
  }

  /**
   * Oberflächenbild im SDO-Gesamtbild wiederfinden (Punktmuster-Abgleich der Flecken).
   * userPts/refPts: {x, y, w} in Bogensekunden (x West/rechts, y Nord/oben), w = Gewicht (Fläche).
   * Liefert Drehung θ (math., gegen den Uhrzeigersinn), Spiegelung, Verschiebung, Treffer.
   */
  function matchPatterns(userPts, refPts, opts = {}) {
    const tolBase = opts.tol || 4, K = Math.min(10, userPts.length);
    if (K < 2 || refPts.length < 2) return null;
    // Raster für schnelle Nachbarsuche in der Referenz
    const cell = 12, grid = new Map();
    refPts.forEach((r, i) => { const key = `${Math.floor(r.x / cell)},${Math.floor(r.y / cell)}`; (grid.get(key) || grid.set(key, []).get(key)).push(i); });
    const nearest = (x, y, tol) => { let best = -1, bd = tol; const cx = Math.floor(x / cell), cy = Math.floor(y / cell), rr = Math.ceil(tol / cell); for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) for (const i of grid.get(`${cx + a},${cy + b}`) || []) { const d = Math.hypot(refPts[i].x - x, refPts[i].y - y); if (d < bd) { bd = d; best = i; } } return best; };
    const refPairs = [];
    for (let a = 0; a < refPts.length; a++) for (let b = a + 1; b < refPts.length; b++) { const d = Math.hypot(refPts[b].x - refPts[a].x, refPts[b].y - refPts[a].y); if (d < (opts.maxDist || 900)) refPairs.push([d, a, b]); }
    refPairs.sort((p, q) => p[0] - q[0]);
    const lower = (d) => { let lo = 0, hi = refPairs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (refPairs[m][0] < d) lo = m + 1; else hi = m; } return lo; };
    const ext = Math.max(...userPts.map((p) => Math.hypot(p.x, p.y)));
    const tol = Math.max(tolBase, ext * 0.025);
    const hyps = [];
    for (const flip of opts.flips || [false, true]) {
      const U = userPts.map((p) => ({ x: flip ? -p.x : p.x, y: p.y, w: p.w }));
      for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
        const du = Math.hypot(U[j].x - U[i].x, U[j].y - U[i].y); if (du < 6) continue;
        const angU = Math.atan2(U[j].y - U[i].y, U[j].x - U[i].x), win = 0.12 * du + 2;
        for (let q = lower(du - win); q < refPairs.length && refPairs[q][0] <= du + win; q++) {
          const [, a, b] = refPairs[q];
          for (const [ra, rb] of [[a, b], [b, a]]) {
            const angR = Math.atan2(refPts[rb].y - refPts[ra].y, refPts[rb].x - refPts[ra].x), th = angR - angU, c = Math.cos(th), s2 = Math.sin(th);
            const tx = refPts[ra].x - (c * U[i].x - s2 * U[i].y), ty = refPts[ra].y - (s2 * U[i].x + c * U[i].y);
            let score = 0, inl = 0;
            for (const p of U) { const x = c * p.x - s2 * p.y + tx, y = s2 * p.x + c * p.y + ty; if (nearest(x, y, tol) >= 0) { score += Math.sqrt(p.w); inl++; } }
            if (inl >= 3) hyps.push({ flip, th, tx, ty, score, inl });
          }
        }
      }
    }
    if (!hyps.length) return null;
    hyps.sort((p, q) => q.score - p.score);
    const best = hyps[0];
    const distinct = hyps.find((h) => h.flip !== best.flip || Math.abs(Math.atan2(Math.sin(h.th - best.th), Math.cos(h.th - best.th))) > 0.17 || Math.hypot(h.tx - best.tx, h.ty - best.ty) > 40);
    // Verfeinern mit allen Treffern (inkl. Maßstab)
    const U = userPts.map((p) => ({ x: best.flip ? -p.x : p.x, y: p.y }));
    const c = Math.cos(best.th), s2 = Math.sin(best.th), A = [], B = [];
    for (const p of U) { const x = c * p.x - s2 * p.y + best.tx, y = s2 * p.x + c * p.y + best.ty, k = nearest(x, y, tol); if (k >= 0) { A.push([p.x, p.y]); B.push([refPts[k].x, refPts[k].y]); } }
    const fit = A.length >= 3 ? fitSimilarity(A, B) : { theta: best.th, scale: 1, tx: best.tx, ty: best.ty };
    return { flip: best.flip, theta: fit.theta, scale: fit.scale, tx: fit.tx, ty: fit.ty, inliers: best.inl, score: best.score, second: distinct ? distinct.score : 0, total: userPts.length };
  }

  /**
   * Oberflächenbild ausrichten.
   * user: {gray, w, h}, scale: Bogensekunden pro Pixel (Arbeitsauflösung), refSpots: Flecken der SDO-Referenz
   * in Sonnenradien, rsun: Sonnenradius in Bogensekunden.
   * Ergebnis im selben Format wie align(): virtuelle Sonnenscheibe in Bildpixeln + Drehung/Spiegelung.
   */
  function alignSurface(user, refSpots, mode, opts) {
    const log = [];
    const sc = opts.scale, rsun = opts.rsun;
    const f = Math.max(1, 0.9 / sc); // auf ≈ 0,9″/px verkleinern, Auflösung der Referenz
    const U = downsample(user.gray, user.w, user.h, f), s1 = sc / U.scale;
    const blobs = detectBlobs(U.data, U.w, U.h, { radius: 30 / s1, threshold: mode === 'ca' ? -0.3 : -0.18, minPixels: Math.max(3, Math.round(4 / (s1 * s1))) });
    log.push(`Oberflächenbild: ${blobs.length} Flecken/Poren erkannt · Maßstab ${sc.toFixed(3)}″/px`);
    const userPts = blobs.slice(0, 40).map((b) => ({ x: (b.u - U.w / 2) * s1, y: -(b.v - U.h / 2) * s1, w: b.pixels * s1 * s1 }));
    const refPts = refSpots.map((r) => ({ x: r.x * rsun, y: r.y * rsun, w: r.areaMSH || r.pixels || 1 }));
    log.push(`Referenz: ${refPts.length} Flecken auf der ganzen Sonne`);
    const flips = opts.knownFlip != null ? [opts.knownFlip, !opts.knownFlip] : [false, true];
    const m = matchPatterns(userPts, refPts, { flips });
    const base = { log, blobs: blobs.length, type: 'surface' };
    if (blobs.length < 3) return { ...base, ok: false, reason: 'Zu wenige Flecken im Bild (mindestens 3 nötig), um die Stelle auf der Sonne zu finden.' };
    if (!m) return { ...base, ok: false, reason: 'Das Fleckenmuster wurde auf der SDO-Sonne nicht gefunden (Aufnahmezeit oder Bildmaßstab prüfen).' };
    const ratio = m.second ? m.score / m.second : 9;
    log.push(`Treffer ${m.inliers} von ${Math.min(40, blobs.length)} Flecken · Eindeutigkeit ×${ratio.toFixed(2)} · Maßstab-Korrektur ×${m.scale.toFixed(3)}`);
    const ok = m.inliers >= 3 && ratio >= 1.4 && m.scale > 0.85 && m.scale < 1.15;
    // Sonnenmittelpunkt in Bildpixeln (Arbeitsauflösung des Aufrufers)
    const sEff = sc * m.scale, c = Math.cos(-m.theta), s2 = Math.sin(-m.theta);
    // q = s·R(θ)·F·p + t  ->  Sonnenmitte q = 0  ->  p0 = F·R(-θ)·(-t)/s
    let px = (c * -m.tx - s2 * -m.ty) / sEff, py = (s2 * -m.tx + c * -m.ty) / sEff; if (m.flip) px = -px;
    const disc = { cx: user.w / 2 + px, cy: user.h / 2 - py, r: rsun / sEff };
    const rotation = ((-m.theta * 180) / Math.PI % 360 + 540) % 360 - 180;
    const center = { x: m.tx / rsun, y: m.ty / rsun };
    return {
      ...base, ok, reason: ok ? '' : (m.scale <= 0.85 || m.scale >= 1.15 ? `Bildmaßstab passt nicht (Abweichung ×${m.scale.toFixed(2)}) – Brennweite/Pixelgröße prüfen.` : 'Das Fleckenmuster ist nicht eindeutig zuzuordnen.'),
      rotation, flip: m.flip, disc, scale: sEff, center, inliers: m.inliers, ratio, ncc: m.inliers / Math.min(40, blobs.length), groups: m.inliers,
    };
  }

  const api = { detectBlobs, matchPatterns, alignSurface, fitSimilarity, toGray, downsample, detectDisc, classifyImage, fitCircleFixedR, polarContrast, featureMap, correlate, countGroups, clusterGroups, align, detectSpots, matchSpots, bilinear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SoluxAlign = api;
})(typeof self !== 'undefined' ? self : this);
