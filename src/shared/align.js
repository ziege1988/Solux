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
  function detectDisc(g, w, h) {
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
    const step = 0.5, n0 = Math.floor((r0 * 0.6) / step), n1 = Math.ceil((r0 * 1.6) / step);
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
      for (let k = n0 + m; k <= last - m; k++) { if (prof[k + m] > dark) continue; const d = dAt(k); if (d < best) { best = d; bk = k; } }
      if (bk < 0 || -best < jump * 0.5) continue;
      if (!valid && last - bk < 2 * m + 4) continue; // Kante liegt am Bildrand
      let off = 0;
      if (bk - 1 >= n0 + m && bk + 1 <= last - m) { const a1 = dAt(bk - 1), b1 = best, c1 = dAt(bk + 1), den = a1 - 2 * b1 + c1; if (den) off = Math.max(-0.5, Math.min(0.5, (0.5 * (a1 - c1)) / den)); }
      const s = (bk + off) * step;
      pts.push([cx + dx * s, cy + dy * s]);
    }
    if (pts.length < 40) throw new Error('Sonnenrand zu wenig sichtbar.');
    let c = fitCircle(pts);
    for (let it = 0; it < 3; it++) {
      const res = pts.map(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r));
      const med = res.slice().sort((a, b) => a - b)[res.length >> 1] || 0.5;
      const keep = pts.filter((p, i) => res[i] < Math.max(1.5, 4 * med));
      if (keep.length < 30) break;
      pts = keep; c = fitCircle(pts);
    }
    const resid = Math.sqrt(pts.reduce((s, [x, y]) => s + (Math.hypot(x - c.cx, y - c.cy) - c.r) ** 2, 0) / pts.length);
    const coverage = pts.length / 720;
    return { cx: c.cx, cy: c.cy, r: c.r, residual: resid, coverage, threshold: thr };
  }

  /**
   * Polar-Abtastung mit Kontrast relativ zum Ring-Median.
   * Winkel θ: im Uhrzeigersinn ab "oben" (Bildschirm). flip: horizontal gespiegelt abtasten.
   */
  function polarContrast(g, w, h, disc, opt = {}) {
    const nR = opt.nR || 64, nT = opt.nT || 720, rMin = opt.rMin ?? 0.04, rMax = opt.rMax ?? 0.93;
    const out = new Float32Array(nR * nT);
    const ring = new Float32Array(nT);
    for (let i = 0; i < nR; i++) {
      const rho = rMin + ((rMax - rMin) * (i + 0.5)) / nR;
      for (let k = 0; k < nT; k++) {
        const t = (k / nT) * 2 * Math.PI;
        const sx = Math.sin(t) * (opt.flip ? -1 : 1);
        const v = bilinear(g, w, h, disc.cx + sx * rho * disc.r, disc.cy - Math.cos(t) * rho * disc.r);
        ring[k] = Number.isNaN(v) ? 0 : v;
      }
      const med = Float32Array.from(ring).sort()[nT >> 1] || 1;
      for (let k = 0; k < nT; k++) out[i * nT + k] = ring[k] / med - 1;
    }
    return { data: out, nR, nT, rMin, rMax };
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
    let mean = 0; for (const v of s) mean += v; mean /= s.length;
    let norm = 0; for (let i = 0; i < s.length; i++) { s[i] -= mean; norm += s[i] * s[i]; }
    return { data: s, nR, nT, norm: Math.sqrt(norm) };
  }

  /** Zirkuläre Korrelation über alle Winkelverschiebungen. */
  function correlate(fu, fr) {
    const { nR, nT } = fu, out = new Float32Array(nT);
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
    const du0 = detectDisc(user.gray, user.w, user.h);
    const fU = Math.max(1, du0.r / targetR);
    const U = downsample(user.gray, user.w, user.h, fU);
    const dU = detectDisc(U.data, U.w, U.h);
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
      con[gy * N + gx] = c; if (c < thr) mask[gy * N + gx] = 1;
    }
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
    return { matched: assigned, extra: extra.filter((g) => g.spots.reduce((t, s) => t + s.pixels, 0) >= 4) };
  }

  const api = { toGray, downsample, detectDisc, polarContrast, featureMap, correlate, countGroups, clusterGroups, align, detectSpots, matchSpots, bilinear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SoluxAlign = api;
})(typeof self !== 'undefined' ? self : this);
