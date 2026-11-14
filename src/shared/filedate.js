/*
 * Solux – Aufnahmedatum aus dem Dateinamen lesen.
 * EXIF wird bewusst nicht verwendet: Nach SER → AutoStakkert → RegiStax → ImPPG → Photoshop
 * steht dort nicht mehr die Aufnahmezeit, sondern höchstens die Bearbeitungszeit.
 *
 * Erkannte Muster (Beispiele):
 *   2026-04-23-1042_3-…  (FireCapture/SharpCap)   2026-04-23T10_42_17   20260423_104217
 *   23.04.2026  23.04.26  23.04. / 23.04 (ohne Jahr)   jeweils optional mit 10-42, 10.42 Uhr, 10h42, 1042UT
 */
(function (root) {
  'use strict';
  const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100;

  function parseTime(rest) {
    let m = /(?:^|[^\d])([01]\d|2[0-3])[-_.:h ]?([0-5]\d)(?:[-_.:m ]?([0-5]\d))?(?:[,.]\d+)?\s*(ut|utc|z)?(?![\d])/i.exec(rest);
    if (!m) return null;
    return { hh: +m[1], mm: +m[2], ss: m[3] ? +m[3] : 0, utc: !!m[4] };
  }

  /** Liefert { y, m, d, time|null, yearGuessed, text } oder null. now = Bezugsdatum für fehlendes Jahr. */
  function parseNameDate(name, now = new Date()) {
    const base = String(name).replace(/\.[a-z0-9]{2,5}$/i, '');
    let m, out = null, rest = '';
    // 1) ISO-artig: 2026-04-23 / 2026_04_23 / 20260423
    if ((m = /(?:^|[^\d])((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?!\d{3})/.exec(base))) {
      const [y, mo, d] = [+m[1], +m[2], +m[3]];
      if (valid(y, mo, d)) { out = { y, m: mo, d, yearGuessed: false, iso: true }; rest = base.slice(m.index + m[0].length); }
    }
    // 2) Deutsch: 23.04.2026 / 23.04.26 / 23.04. / 23.04
    if (!out && (m = /(?:^|[^\d])([0-3]?\d)\.([01]?\d)\.?((?:19|20)?\d{2})?(?![\d])/.exec(base))) {
      let y = m[3] ? +m[3] : null; const mo = +m[2], d = +m[1];
      if (y != null && y < 100) y += 2000;
      let guessed = false;
      if (y == null) { // Jahr fehlt: letztes zurückliegendes Vorkommen dieses Tages
        guessed = true; y = now.getFullYear();
        if (new Date(y, mo - 1, d) > now) y -= 1;
      }
      if (valid(y, mo, d)) { out = { y, m: mo, d, yearGuessed: guessed }; rest = base.slice(m.index + m[0].length); }
    }
    if (!out) return null;
    out.time = parseTime(rest);
    // Aufnahmeprogramme (FireCapture, SharpCap) benennen Dateien üblicherweise in UT
    if (out.time && out.iso) out.time.utc = true;
    const pad = (n) => String(n).padStart(2, '0');
    out.text = `${pad(out.d)}.${pad(out.m)}.${out.y}${out.time ? ` ${pad(out.time.hh)}:${pad(out.time.mm)}${out.time.utc ? ' UTC' : ''}` : ''}`;
    return out;
  }

  const api = { parseNameDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SoluxFileDate = api;
})(typeof self !== 'undefined' ? self : this);
