/*
 * Solux – Seeing-Modell für die Tagbeobachtung
 *
 * Idee: Die Bildunruhe ergibt sich aus der Summe der Turbulenzbeiträge entlang des
 * Lichtwegs. Seeing-FWHM ε skaliert mit (∫Cn² dh)^(3/5); Beiträge addieren sich deshalb als
 *   ε_ges = ( Σ ε_i^(5/3) )^(3/5)
 * und wachsen mit der Luftmasse wie (sec z)^(3/5).
 *
 * Beiträge (Datenquelle Open-Meteo, stündlich):
 *  1. Bodenschicht: Aufheizung des Untergrunds (Globalstrahlung, Boden- minus Lufttemperatur),
 *     moduliert durch Wind (Windstille -> stehende Thermik, starker Wind -> mechanische Turbulenz).
 *     Ein Standortfaktor beschreibt den Untergrund (gepflasterter Hof = stark aufheizend).
 *  2. Freie Atmosphäre: Windscherung zwischen 850 und 500 hPa.
 *  3. Jetstream: Wind auf 250/200 hPa.
 * Die Koeffizienten sind empirisch so gewählt, dass typische Werte herauskommen
 * (Sommermittag über Pflaster 3,5–4″, tiefe Wintersonne 2,5–3″). Über Bewertungen
 * des Nutzers wird ein persönlicher Kalibrierfaktor gelernt.
 */
(function (root) {
  'use strict';

  const SURFACES = {
    pflaster: { label: 'Pflaster / Asphalt', factor: 1.25 },
    kies: { label: 'Kies / Schotter', factor: 1.15 },
    rasen: { label: 'Rasen / Wiese', factor: 0.85 },
    dach: { label: 'Flachdach / Balkon', factor: 1.45 },
    wasser: { label: 'Nähe Wasser / Wald', factor: 0.75 },
  };

  const combine = (parts) => Math.pow(parts.reduce((s, e) => s + Math.pow(Math.max(0, e), 5 / 3), 0), 3 / 5);

  /**
   * h: Stundenwerte {sw, t2m, tSoil, wind10, gust10, w850, w500, w250, w200, alt}
   * opts: {surface, calibration, wavelengthNm}
   * Rückgabe: Seeing in Bogensekunden (bei 550 nm, bzw. Wellenlänge), Komponenten.
   */
  function estimate(h, opts = {}) {
    if (h.alt == null || h.alt < 3) return null;
    const surf = SURFACES[opts.surface] || SURFACES.pflaster;
    const sw = Math.max(0, h.sw || 0);
    const dT = Math.max(0, (h.tSoil ?? h.t2m) - h.t2m);
    const v = Math.max(0, h.wind10 ?? 0);

    // 1) Bodenschicht
    let wind = 1;
    if (v < 1.5) wind += 0.3 * (1.5 - v);           // stehende Thermikblasen
    else if (v <= 4) wind -= 0.06 * (v - 1.5);      // gute Durchmischung
    else wind += 0.1 * Math.pow(v - 4, 1.2) - 0.15; // mechanische Turbulenz
    const gustiness = h.gust10 && v ? Math.min(1.4, Math.max(1, h.gust10 / Math.max(v, 0.5) / 2)) : 1;
    const ground = surf.factor * (0.35 + 1.4 * Math.pow(sw / 850, 0.85) + 0.07 * dT) * wind * gustiness;

    // 2) Scherung in der freien Atmosphäre
    const shear = Math.abs((h.w500 ?? 10) - (h.w850 ?? 5));
    const free = 0.25 + 0.022 * shear;

    // 3) Jetstream
    const jet = Math.max(h.w250 ?? 0, h.w200 ?? 0);
    const upper = 0.15 + 0.014 * Math.pow(Math.max(0, jet - 12), 1.15);

    const zenith = combine([ground, free, upper]);
    const airmass = 1 / Math.sin(Math.max(h.alt, 3) * Math.PI / 180);
    let seeing = zenith * Math.pow(Math.min(airmass, 12), 3 / 5);
    if (opts.wavelengthNm) seeing *= Math.pow(opts.wavelengthNm / 550, -0.2);
    seeing *= opts.calibration || 1;
    return { seeing, parts: { ground, free, upper }, airmass, jet, shear };
  }

  /** Ampel: grün < 2″, orange 2–3,5″, rot darüber. */
  function rating(seeing) {
    if (seeing == null) return { level: 'off', label: 'Sonne zu tief' };
    if (seeing < 2) return { level: 'ok', label: 'gut' };
    if (seeing < 3.5) return { level: 'warn', label: 'okay' };
    return { level: 'bad', label: 'schlecht' };
  }

  /** Fried-Parameter r0 (cm) bei 550 nm aus Seeing (″): ε = 0,98 λ/r0. */
  function r0cm(seeing) { return (0.98 * 550e-9 / (seeing / 206265)) * 100; }

  /** Nutzerbewertung 1 (sehr ruhig) … 5 (sehr unruhig) in Bogensekunden. */
  const RATING_ARCSEC = { 1: 1.2, 2: 1.8, 3: 2.6, 4: 3.5, 5: 4.6 };

  /** Kalibrierfaktor als Median der Verhältnisse Bewertung/Modell (begrenzt). */
  function calibrationFrom(ratings) {
    const r = (ratings || []).filter((x) => x.model > 0 && RATING_ARCSEC[x.rating]).map((x) => RATING_ARCSEC[x.rating] / x.model).sort((a, b) => a - b);
    if (r.length < 2) return 1;
    const m = r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2;
    return Math.min(2, Math.max(0.5, m));
  }

  /** Bestes zusammenhängendes Beobachtungsfenster des Tages. */
  function bestWindow(hours) {
    const good = hours.filter((h) => h.seeing != null && h.cloud < 40 && h.alt > 8);
    if (!good.length) return null;
    const best = good.reduce((a, b) => (b.seeing < a.seeing ? b : a));
    // Fenster um das Minimum, solange Seeing < Minimum * 1.2
    const idx = hours.indexOf(best);
    let s = idx, e = idx;
    while (s > 0 && hours[s - 1].seeing != null && hours[s - 1].seeing < best.seeing * 1.2 && hours[s - 1].cloud < 40) s--;
    while (e < hours.length - 1 && hours[e + 1].seeing != null && hours[e + 1].seeing < best.seeing * 1.2 && hours[e + 1].cloud < 40) e++;
    return { from: hours[s].time, to: new Date(hours[e].time.getTime() + 3600000), seeing: best.seeing };
  }

  const api = { SURFACES, estimate, rating, r0cm, RATING_ARCSEC, calibrationFrom, bestWindow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SoluxSeeing = api;
})(typeof self !== 'undefined' ? self : this);
