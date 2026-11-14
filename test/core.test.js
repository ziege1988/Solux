'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../src/shared/astro');
const S = require('../src/shared/seeing');
const M = require('../src/shared/mcintosh');
const { DataStore, translateAlert } = require('../src/main/data');
const { cmpVersion, appBundlePath } = require('../src/main/updater');
const { merge } = require('../src/main/config');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b} (±${tol})`);

test('Sonnenorientierung entspricht Meeus Beispiel 29.a', () => {
  const o = A.solarOrientation(new Date('1992-10-13T00:00:00Z'));
  near(o.P, 26.27, 0.02, 'P'); near(o.B0, 5.99, 0.02, 'B0'); near(o.L0, 238.63, 0.05, 'L0');
});

test('NOAA-Positionen werden aus Carrington-Länge reproduziert (SRS 14.11.2026, 00 UT)', () => {
  const t = new Date('2026-11-14T00:00:00Z');
  assert.strictEqual(A.regionPosition({ latitude: -8, carrington_longitude: 154 }, t).location, 'S08W80');
  assert.strictEqual(A.regionPosition({ latitude: -9, carrington_longitude: 36 }, t).location, 'S09E38');
  assert.strictEqual(A.regionPosition({ latitude: 16, carrington_longitude: 41 }, t).location, 'N16E33');
});

test('Heliografische Projektion ist umkehrbar', () => {
  for (const [lat, cmd, B0] of [[10, 20, 3], [-25, -60, -6], [40, 75, 7]]) {
    const p = A.heliographicToDisk(lat, cmd, B0);
    const h = A.diskToHeliographic(p.x, p.y, B0);
    near(h.lat, lat, 1e-6, 'lat'); near(h.cmd, cmd, 1e-6, 'cmd');
  }
});

test('Sonnenhöhe und Jahreszeiten plausibel', () => {
  near(A.sunAltAz(new Date('2026-06-21T11:30:00Z'), 50.28, 9.8).alt, 63.1, 0.3, 'Mittagshöhe Sommer');
  const ev = A.seasonEvents(2026);
  assert.strictEqual(ev[3].date.toISOString().slice(0, 10), '2026-12-21');
  assert.strictEqual(A.currentSeason(new Date('2026-11-14T12:00:00Z')).season, 'Herbst');
});

test('Seeing-Modell: Sommermittag über Pflaster schlechter als ruhiger Morgen', () => {
  const noon = S.estimate({ sw: 850, t2m: 26, tSoil: 42, wind10: 2, gust10: 4, w850: 6, w500: 15, w250: 25, alt: 62 }, { surface: 'pflaster' }).seeing;
  const calm = S.estimate({ sw: 100, t2m: 12, tSoil: 12, wind10: 2.5, w850: 5, w500: 8, w250: 15, alt: 45 }, { surface: 'pflaster' }).seeing;
  assert.ok(noon > calm * 2, `${noon} vs ${calm}`);
  assert.strictEqual(S.estimate({ alt: 1 }), null);
  assert.strictEqual(S.rating(1.5).level, 'ok');
  assert.strictEqual(S.rating(3).level, 'warn');
  assert.strictEqual(S.rating(5).level, 'bad');
  assert.strictEqual(S.calibrationFrom([{ rating: 3, model: 2.6 }]), 1);
  near(S.calibrationFrom([{ rating: 5, model: 2.3 }, { rating: 5, model: 2.3 }]), 2, 1e-9, 'Kalibrierung begrenzt');
});

test('McIntosh-Dekodierung', () => {
  const d = M.decode('Ekc', 'BGD');
  assert.deepStrictEqual(d.parts.map((p) => p.key), ['E', 'k', 'c']);
  assert.strictEqual(M.magSymbol('BGD'), 'βγδ');
  assert.strictEqual(d.risk.level, 'bad');
  assert.strictEqual(M.riskOf('Axx', 'A').level, 'ok');
});

test('Regionen aus dem lokalen Speicher, gedreht auf Aufnahmezeit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solux-test-'));
  const store = new DataStore(dir);
  store.save('regions.json', {
    '2026-11-13|4566': { observed_date: '2026-11-13', region: 4566, latitude: -8, carrington_longitude: 154, spot_class: 'Dsi', mag_class: 'B', area: 50, number_spots: 6, location: 'S08W80' },
    '2026-11-14|4566': { observed_date: '2026-11-14', region: 4566, latitude: -8, carrington_longitude: 155, spot_class: null, mag_class: null, location: 'S08W94' },
  });
  const r = store.regionsFor(new Date('2026-11-14T00:00:00Z'));
  assert.strictEqual(r.day, '2026-11-13');
  assert.strictEqual(r.regions[0].location, 'S08W80');
  const later = store.regionsFor(new Date('2026-11-14T12:00:00Z'));
  assert.ok(later.regions[0].x > r.regions[0].x, 'Region wandert nach Westen');
});

test('SWPC-Meldungen werden übersetzt', () => {
  const h = translateAlert('Space Weather Message Code: WATA20\r\nWATCH: Geomagnetic Storm Category G2 Predicted\r\n');
  assert.match(h.title, /Vorhersage: Geomagnetischer Sturm G2/);
  assert.strictEqual(h.level, 'bad');
  assert.strictEqual(translateAlert('nichts'), null);
});

test('Updater: Versionsvergleich und App-Pfad', () => {
  assert.strictEqual(cmpVersion('1.0.1', '1.0.0'), 1);
  assert.strictEqual(cmpVersion('v1.2.0', '1.10.0'), -1);
  assert.strictEqual(cmpVersion('1.0.0', '1.0'), 0);
  assert.strictEqual(appBundlePath('/Applications/Solux.app/Contents/MacOS/Solux'), '/Applications/Solux.app');
});

test('Einstellungen werden tief zusammengeführt', () => {
  const m = merge({ a: { b: 1, c: 2 }, l: [1] }, { a: { c: 3 }, l: [2, 3] });
  assert.deepStrictEqual(m, { a: { b: 1, c: 3 }, l: [2, 3] });
});
