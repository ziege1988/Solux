/*
 * Solux – Astronomische Grundlagen
 * Sonnenstand, Sonnenorientierung (P, B0, L0), parallaktischer Winkel und
 * heliografische Projektionen. Formeln nach J. Meeus, "Astronomical Algorithms",
 * Kap. 25 und 29 (Genauigkeit ~0,01° – mehr als ausreichend für Beschriftungen).
 * Läuft in Node (Tests, Hauptprozess) und im Browser (Renderer).
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const sin = (d) => Math.sin(d * D2R), cos = (d) => Math.cos(d * D2R), tan = (d) => Math.tan(d * D2R);
  const norm360 = (a) => ((a % 360) + 360) % 360;
  const norm180 = (a) => { a = norm360(a); return a > 180 ? a - 360 : a; };

  function julianDay(date) { return date.getTime() / 86400000 + 2440587.5; }

  /** Scheinbare Sonnenposition (Meeus Kap. 25, niedrige Genauigkeit). */
  function sunApparent(date) {
    const JD = julianDay(date), T = (JD - 2451545) / 36525;
    const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
    const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
    const e = 0.016708634 - 0.000042037 * T;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
    const trueLon = L0 + C, v = M + C;
    const R = (1.000001018 * (1 - e * e)) / (1 + e * cos(v)); // AE
    const omega = 125.04 - 1934.136 * T;
    const lambda = trueLon - 0.00569 - 0.00478 * sin(omega); // scheinbare Länge
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * cos(omega);
    const ra = norm360(Math.atan2(cos(eps) * sin(lambda), cos(lambda)) * R2D);
    const dec = Math.asin(sin(eps) * sin(lambda)) * R2D;
    return { JD, T, lambda: norm360(lambda), trueLon, eps, ra, dec, R, semiDiameter: 959.63 / R };
  }

  /** Mittlere Sternzeit Greenwich in Grad. */
  function gmst(date) {
    const JD = julianDay(date), T = (JD - 2451545) / 36525;
    return norm360(280.46061837 + 360.98564736629 * (JD - 2451545) + 0.000387933 * T * T - (T * T * T) / 38710000);
  }

  /** Höhe/Azimut (Azimut ab Nord über Ost), Stundenwinkel; mit einfacher Refraktion. */
  function sunAltAz(date, lat, lon) {
    const s = sunApparent(date);
    const H = norm180(gmst(date) + lon - s.ra);
    const alt = Math.asin(sin(lat) * sin(s.dec) + cos(lat) * cos(s.dec) * cos(H)) * R2D;
    const az = norm360(Math.atan2(-sin(H) * cos(s.dec), cos(lat) * sin(s.dec) - sin(lat) * cos(s.dec) * cos(H)) * R2D);
    let refr = 0;
    if (alt > -1) refr = 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * D2R) / 60; // Bennett
    return { alt: alt + refr, altGeometric: alt, az, H, dec: s.dec, ra: s.ra };
  }

  /** Parallaktischer Winkel q (Grad) – dreht das Bildfeld bei azimutaler Montierung. */
  function parallacticAngle(date, lat, lon) {
    const p = sunAltAz(date, lat, lon);
    return Math.atan2(sin(p.H), tan(lat) * cos(p.dec) - sin(p.dec) * cos(p.H)) * R2D;
  }

  /**
   * Orientierung der Sonne (Meeus Kap. 29):
   * P  = Positionswinkel der Sonnenachse (Ost positiv)
   * B0 = heliografische Breite der Scheibenmitte
   * L0 = Carrington-Länge der Scheibenmitte
   */
  function solarOrientation(date) {
    const s = sunApparent(date), JD = s.JD;
    const theta = norm360(((JD - 2398220) * 360) / 25.38);
    const I = 7.25;
    const K = 73.6667 + (1.3958333 * (JD - 2396758)) / 36525;
    const lam = s.lambda;
    const x = Math.atan(-cos(lam) * tan(s.eps)) * R2D;
    const y = Math.atan(-cos(lam - K) * tan(I)) * R2D;
    const P = x + y;
    const B0 = Math.asin(sin(lam - K) * sin(I)) * R2D;
    const eta = Math.atan2(-sin(lam - K) * cos(I), -cos(lam - K)) * R2D;
    const L0 = norm360(eta - theta);
    return { P, B0, L0 };
  }

  /** Synodische Carrington-Rotationsnummer (näherungsweise). */
  function carringtonRotation(date) {
    return Math.floor((julianDay(date) - 2398140.227) / 27.2752316) + 1;
  }

  /**
   * Heliografische Koordinaten -> Scheibe (Einheit Sonnenradius).
   * cmd = Abstand zum Zentralmeridian, West positiv. x: West positiv, y: Nord positiv.
   */
  function heliographicToDisk(lat, cmd, B0) {
    const x = cos(lat) * sin(cmd);
    const y = sin(lat) * cos(B0) - cos(lat) * cos(cmd) * sin(B0);
    const z = sin(lat) * sin(B0) + cos(lat) * cos(cmd) * cos(B0);
    return { x, y, visible: z > 0, mu: z };
  }

  /** Scheibe -> heliografisch (Umkehrung). */
  function diskToHeliographic(x, y, B0) {
    const r2 = x * x + y * y;
    if (r2 >= 1) return null;
    const z = Math.sqrt(1 - r2);
    const lat = Math.asin(y * cos(B0) + z * sin(B0)) * R2D;
    const cmd = Math.atan2(x, z * cos(B0) - y * sin(B0)) * R2D;
    return { lat, cmd };
  }

  /** Synodische Rotation nach Snodgrass (1983) minus Carrington-Rate, Grad/Tag. */
  function driftVsCarrington(lat) {
    const s2 = sin(lat) ** 2;
    const sidereal = 14.713 - 2.396 * s2 - 1.787 * s2 * s2;
    return sidereal - 360 / 25.38;
  }

  /**
   * Position einer NOAA-Region zum Zeitpunkt `date`.
   * region: { latitude, carrington_longitude, validAt: Date }
   * Aus den SRS-Daten gilt: Lo = L0 + W  ->  W = Lo - L0.
   */
  function regionPosition(region, date, orient) {
    const o = orient || solarOrientation(date);
    let lo = region.carrington_longitude;
    if (region.validAt) {
      const dt = (date - region.validAt) / 86400000;
      lo += driftVsCarrington(region.latitude) * dt;
    }
    const cmd = norm180(lo - o.L0);
    const p = heliographicToDisk(region.latitude, cmd, o.B0);
    return { ...p, cmd, lat: region.latitude, location: formatLocation(region.latitude, cmd) };
  }

  function formatLocation(lat, cmd) {
    const ns = lat >= 0 ? 'N' : 'S', ew = cmd >= 0 ? 'W' : 'E';
    return `${ns}${String(Math.round(Math.abs(lat))).padStart(2, '0')}${ew}${String(Math.round(Math.abs(cmd))).padStart(2, '0')}`;
  }

  /** Datum der nächsten/letzten Jahreszeitenwechsel (Näherung Meeus Kap. 27, ±15 min). */
  function seasonEvents(year) {
    const Y = (year - 2000) / 1000;
    const jde = [
      2451623.80984 + 365242.37404 * Y + 0.05169 * Y * Y,
      2451716.56767 + 365241.62603 * Y + 0.00325 * Y * Y,
      2451810.21715 + 365242.01767 * Y - 0.11575 * Y * Y,
      2451900.05952 + 365242.74049 * Y - 0.06223 * Y * Y,
    ];
    const names = ['Frühlingsanfang', 'Sommersonnenwende', 'Herbstanfang', 'Wintersonnenwende'];
    const seasons = ['Frühling', 'Sommer', 'Herbst', 'Winter'];
    return jde.map((j, i) => ({ date: new Date((j - 2440587.5) * 86400000), name: names[i], season: seasons[i] }));
  }

  function currentSeason(date) {
    const y = date.getUTCFullYear();
    const ev = [...seasonEvents(y - 1), ...seasonEvents(y), ...seasonEvents(y + 1)];
    let cur = ev[0], next = null;
    for (const e of ev) { if (e.date <= date) cur = e; else { next = e; break; } }
    return { season: cur.season, next, daysToNext: Math.ceil((next.date - date) / 86400000) };
  }

  const api = {
    D2R, R2D, norm180, norm360, julianDay, sunApparent, gmst, sunAltAz, parallacticAngle,
    solarOrientation, carringtonRotation, heliographicToDisk, diskToHeliographic, driftVsCarrington,
    regionPosition, formatLocation, seasonEvents, currentSeason,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SoluxAstro = api;
})(typeof self !== 'undefined' ? self : this);
