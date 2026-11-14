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

test('Regionen aus dem lokalen Speicher, gedreht auf Aufnahmezeit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solux-test-'));
  const store = new DataStore(dir);
  store.save('regions.json', {
    '2026-11-13|4566': { observed_date: '2026-11-13', region: 4566, latitude: -8, carrington_longitude: 154, spot_class: 'Dsi', mag_class: 'B', area: 50, number_spots: 6, location: 'S08W80' },
    '2026-11-14|4566': { observed_date: '2026-11-14', region: 4566, latitude: -8, carrington_longitude: 155, spot_class: null, mag_class: null, location: 'S08W94' },
  });
  const r = await store.regionsFor(new Date('2026-11-14T00:00:00Z'));
  assert.strictEqual(r.day, '2026-11-13');
  assert.strictEqual(r.regions[0].location, 'S08W80');
  const later = await store.regionsFor(new Date('2026-11-14T12:00:00Z'));
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

const F = require('../src/shared/filedate');
const SWX = require('../src/shared/spaceweather');

test('Datum aus Dateinamen', () => {
  const now = new Date('2026-11-14T12:00:00');
  const a = F.parseNameDate('Sonne_Kalzium_28.12.jpeg', now);
  assert.deepStrictEqual([a.y, a.m, a.d, a.yearGuessed, a.time], [2025, 12, 28, true, null]);
  const b = F.parseNameDate('2026-04-23-1042_3-U-L-Sun.tif', now);
  assert.deepStrictEqual([b.y, b.m, b.d, b.time.hh, b.time.mm, b.time.utc], [2026, 4, 23, 10, 42, true]);
  const c = F.parseNameDate('WL 23.04.2024 10.42 Uhr.jpg', now);
  assert.deepStrictEqual([c.y, c.time.hh, c.time.mm, c.yearGuessed], [2024, 10, 42, false]);
  assert.strictEqual(F.parseNameDate('Fleckengruppe4.jpeg', now), null);
});

test('NOAA-Archivbericht wird gelesen', () => {
  const txt = `:Issued: 2026 Apr 23 0030 UTC
I.  Regions with Sunspots.  Locations Valid at 22/2400Z
Nmbr Location  Lo  Area  Z   LL   NN Mag Type
4420 N16E38   225  0180 Dai  10   15 Beta-Gamma
IA. H-alpha Plages without Spots.  Locations Valid at 22/2400Z Apr
Nmbr  Location  Lo
4415  S06W89   163
II. Regions Due to Return 23 Apr to 25 Apr`;
  const rows = SWX.parseSRS(txt, '2026-04-23');
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual([rows[0].region, rows[0].spot_class, rows[0].mag_class, rows[0].latitude, rows[0].carrington_longitude, rows[0].observed_date], [4420, 'Dai', 'BG', 16, 225, '2026-04-22']);
  assert.strictEqual(SWX.srsArchiveUrl('2026-04-23').endsWith('/2026/04/20260423SRS.txt'), true);
});

test('Push-Regeln: Stufen und einmal täglich', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  const news = { items: [
    { kind: 'flare', title: 'M6.1-Flare', detail: 'x', level: 'warn', time: now - 600000 },
    { kind: 'flare', title: 'M1.2-Flare', detail: 'x', level: 'warn', time: now - 600000 },
    { kind: 'region', title: 'Neue Region AR 4579', detail: 'x', level: 'ok', time: now - 3600000 },
    { kind: 'kp', title: 'Magnetfeld ruhig', detail: 'x', level: 'ok', time: now } ] };
  const regions = [{ region: 4566, type: 'spots', x: 0.2, y: 0, spotClass: 'Ekc', magClass: 'BGD', area: 520, probs: { m: 50, x: 15 }, location: 'S08W12' }];
  const i = SWX.pushMessages(news, regions, 'interessant', now).map((m) => m.key.split('|')[0] + ':' + m.title);
  assert.deepStrictEqual(i, ['flare:Solux · M6.1-Flare', 'region:Solux · AR 4566 lohnt sich']);
  const a = SWX.pushMessages(news, regions, 'alle', now);
  assert.strictEqual(a.length, 4);
  assert.strictEqual(SWX.pushMessages(news, regions, 'aus', now).length, 0);
  assert.ok(a.find((m) => m.title.includes('AR 4566')).key.endsWith('2026-11-14'));
});
