/*
 * Solux – Datenquellen und lokaler Speicher
 *
 *  - Sonnenbilder:   Helioviewer.org (NASA SDO/HMI Kontinuum, SDO/AIA 1700 Å), jeder Zeitpunkt seit 2010
 *  - Regionen:       NOAA SWPC solar_regions.json (≈ 30 Tage) -> lokal 60 Tage gesammelt
 *  - Flares:         NOAA SWPC GOES-Röntgen (7 Tage) -> lokal 60 Tage gesammelt
 *  - Kp / Alarme:    NOAA SWPC
 *  - Wetter:         Open-Meteo (ohne Schlüssel)
 * Der Speicher liegt als JSON in ~/Library/Application Support/Solux/cache.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const astro = require('../shared/astro');
const seeingModel = require('../shared/seeing');

const SWPC = 'https://services.swpc.noaa.gov';
const HV = 'https://api.helioviewer.org/v2';
const KEEP_DAYS = 60;
const SOURCES = { wl: { id: 18, layer: '[SDO,HMI,continuum,1,100]', label: 'SDO/HMI Kontinuum' }, ca: { id: 16, layer: '[SDO,AIA,1700,1,100]', label: 'SDO/AIA 1700 Å' } };
const IMG_SIZE = 1024, DISC_FRACTION = 0.45; // Sonnenradius = 0,45 · Bildbreite

// In Electron wird net.fetch (Chromium-Netzwerk, System-Proxy) eingesetzt, in Tests das globale fetch.
let httpFetch = (...a) => globalThis.fetch(...a);
function setFetch(f) { httpFetch = f; }

class DataStore {
  constructor(dir, log = () => {}) {
    this.dir = dir;
    this.log = log;
    fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    this.mem = {};
  }

  file(name) { return path.join(this.dir, name); }
  load(name, def) {
    if (this.mem[name]) return this.mem[name];
    try { this.mem[name] = JSON.parse(fs.readFileSync(this.file(name), 'utf8')); } catch { this.mem[name] = def; }
    return this.mem[name];
  }
  save(name, data) {
    this.mem[name] = data;
    fs.writeFileSync(this.file(name) + '.tmp', JSON.stringify(data));
    fs.renameSync(this.file(name) + '.tmp', this.file(name));
  }

  async fetchJSON(url, timeout = 30000) {
    const res = await httpFetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'Solux' } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  /* ---------------- Sammeln & Speichern (60 Tage) ---------------- */
  async refreshSpaceWeather() {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    const results = await Promise.allSettled([
      this.fetchJSON(`${SWPC}/json/solar_regions.json`),
      this.fetchJSON(`${SWPC}/json/goes/primary/xray-flares-7-day.json`),
      this.fetchJSON(`${SWPC}/products/noaa-planetary-k-index-forecast.json`),
      this.fetchJSON(`${SWPC}/products/alerts.json`),
      this.fetchJSON(`${SWPC}/json/solar-cycle/swpc_observed_ssn.json`),
      this.fetchJSON(`${SWPC}/products/summary/10cm-flux.json`),
    ]);
    const [reg, flr, kp, alerts, ssn, flux] = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    results.forEach((r) => r.status === 'rejected' && this.log('Abruf fehlgeschlagen: ' + r.reason.message));

    if (reg) {
      const store = this.load('regions.json', {});
      for (const r of reg) store[`${r.observed_date}|${r.region}`] = r;
      for (const k of Object.keys(store)) if (new Date(k.split('|')[0]).getTime() < cutoff) delete store[k];
      this.save('regions.json', store);
    }
    if (flr) {
      const store = this.load('flares.json', {});
      for (const f of flr) store[f.begin_time] = f;
      for (const k of Object.keys(store)) if (new Date(k).getTime() < cutoff) delete store[k];
      this.save('flares.json', store);
    }
    if (kp) {
      const store = this.load('kp.json', {});
      const rows = Array.isArray(kp[0]) ? kp.slice(1).map((a) => ({ time_tag: a[0], kp: +a[1], observed: a[2], noaa_scale: a[3] })) : kp;
      for (const k of rows) store[k.time_tag] = k;
      for (const k of Object.keys(store)) if (new Date(k + 'Z').getTime() < cutoff) delete store[k];
      this.save('kp.json', store);
    }
    if (alerts) {
      const store = this.load('alerts.json', {});
      for (const a of alerts) store[a.issue_datetime + '|' + a.product_id] = a;
      for (const k of Object.keys(store)) if (new Date(k.split('|')[0].replace(' ', 'T') + 'Z').getTime() < cutoff) delete store[k];
      this.save('alerts.json', store);
    }
    const misc = this.load('misc.json', {});
    if (ssn && ssn.length) misc.ssn = ssn[ssn.length - 1];
    if (flux && flux.length) misc.flux = flux[0];
    misc.updated = new Date().toISOString();
    this.save('misc.json', misc);
    return { ok: results.filter((r) => r.status === 'fulfilled').length, total: results.length };
  }

  /* ---------------- Regionen für einen Zeitpunkt ---------------- */
  /**
   * Liefert die NOAA-Regionen mit Positionen für `date`.
   * observed_date D in solar_regions.json gilt für D+1 00:00 UT (vgl. SRS „valid at D/2400Z“).
   * Es wird der jüngste vollständig klassifizierte Tag vor/um `date` genutzt.
   */
  regionsFor(date) {
    const store = this.load('regions.json', {});
    const byDay = {};
    for (const r of Object.values(store)) (byDay[r.observed_date] ||= []).push(r);
    const days = Object.keys(byDay).sort();
    const validAt = (d) => new Date(new Date(d + 'T00:00:00Z').getTime() + 86400000);
    let pick = null;
    for (const d of days) {
      const classified = byDay[d].some((r) => r.spot_class);
      if (!classified) continue;
      if (validAt(d).getTime() <= date.getTime() + 18 * 3600000) pick = d; // bis 18 h im Voraus erlaubt
    }
    if (!pick) {
      // Zeitpunkt vor dem Speicher: ältesten Tag nehmen, wenn höchstens 2 Tage entfernt
      const first = days.find((d) => byDay[d].some((r) => r.spot_class));
      if (first && Math.abs(validAt(first) - date) < 2 * 86400000) pick = first;
    }
    if (!pick) return { day: null, regions: [] };
    const o = astro.solarOrientation(date);
    const regions = byDay[pick]
      .filter((r) => r.carrington_longitude != null && r.latitude != null && r.status !== 'd')
      .map((r) => {
        const pos = astro.regionPosition({ latitude: r.latitude, carrington_longitude: r.carrington_longitude, validAt: validAt(pick) }, date, o);
        return {
          region: r.region, spotClass: r.spot_class || '', magClass: r.mag_class || '', area: r.area, numberSpots: r.number_spots,
          extent: r.extent, latitude: r.latitude, carrLon: r.carrington_longitude, firstDate: r.first_date,
          probs: { c: r.c_flare_probability, m: r.m_flare_probability, x: r.x_flare_probability, p: r.proton_probability },
          flares: { c: r.c_xray_events || 0, m: r.m_xray_events || 0, x: r.x_xray_events || 0 },
          type: r.spot_class ? 'spots' : 'plage',
          x: pos.x, y: pos.y, visible: pos.visible, mu: pos.mu, location: pos.location,
        };
      })
      .filter((r) => r.visible)
      .sort((a, b) => (b.area || 0) - (a.area || 0));
    return { day: pick, validAt: validAt(pick).toISOString(), regions };
  }

  /** Verlauf einer Region (Entwicklung über die gespeicherten Tage). */
  regionHistory(num) {
    const store = this.load('regions.json', {});
    return Object.values(store).filter((r) => r.region === num && r.spot_class).sort((a, b) => a.observed_date.localeCompare(b.observed_date))
      .map((r) => ({ day: r.observed_date, cls: r.spot_class, mag: r.mag_class, area: r.area, n: r.number_spots, flares: { c: r.c_xray_events, m: r.m_xray_events, x: r.x_xray_events } }));
  }

  /* ---------------- Sonnenbilder ---------------- */
  async sunImage(kind = 'wl', date = null) {
    const src = SOURCES[kind] || SOURCES.wl;
    const when = date ? new Date(date) : new Date();
    const iso = when.toISOString().replace(/\.\d+Z$/, 'Z');
    const meta = await this.fetchJSON(`${HV}/getClosestImage/?date=${iso}&sourceId=${src.id}`);
    const imgDate = new Date(meta.date.replace(' ', 'T') + 'Z');
    const cacheName = `${kind}_${meta.id}.png`;
    const cachePath = path.join(this.dir, 'images', cacheName);
    if (!fs.existsSync(cachePath)) {
      const rsunArcsec = meta.rsun * meta.scale;
      const scale = rsunArcsec / (IMG_SIZE * DISC_FRACTION);
      const url = `${HV}/takeScreenshot/?date=${meta.date.replace(' ', 'T')}Z&imageScale=${scale.toFixed(5)}&layers=${encodeURIComponent(src.layer)}&x0=0&y0=0&width=${IMG_SIZE}&height=${IMG_SIZE}&display=true&watermark=false`;
      const res = await httpFetch(url, { signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`Sonnenbild nicht verfügbar (${res.status})`);
      fs.writeFileSync(cachePath, Buffer.from(await res.arrayBuffer()));
      this.pruneImages();
    }
    return {
      kind, label: src.label, date: imgDate.toISOString(), size: IMG_SIZE, radiusPx: IMG_SIZE * DISC_FRACTION,
      dataUrl: 'data:image/png;base64,' + fs.readFileSync(cachePath).toString('base64'),
    };
  }

  pruneImages() {
    const dir = path.join(this.dir, 'images');
    const files = fs.readdirSync(dir).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const x of files.slice(80)) fs.rmSync(path.join(dir, x.f), { force: true });
  }

  /* ---------------- Wetter & Seeing ---------------- */
  async weather(cfg) {
    const { lat, lon } = cfg.location;
    const key = `${lat},${lon},${cfg.location.surface}`;
    if (this.wcache && this.wcache.key === key && Date.now() - this.wcache.t < 10 * 60000) return this.wcache.data;
    const data = await this.weatherFetch(cfg);
    this.wcache = { key, t: Date.now(), data };
    return data;
  }

  async weatherFetch(cfg) {
    const { lat, lon } = cfg.location;
    const hourly = ['temperature_2m', 'soil_temperature_0cm', 'shortwave_radiation', 'cloud_cover', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'wind_speed_850hPa', 'wind_speed_500hPa', 'wind_speed_250hPa', 'wind_speed_200hPa'];
    const current = ['temperature_2m', 'cloud_cover', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'weather_code'];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${hourly.join(',')}&current=${current.join(',')}&wind_speed_unit=ms&timezone=UTC&forecast_days=2`;
    const w = await this.fetchJSON(url);
    const H = w.hourly;
    const calib = seeingModel.calibrationFrom(this.load('ratings.json', []));
    const hours = H.time.map((t, i) => {
      const time = new Date(t + ':00Z');
      const alt = astro.sunAltAz(new Date(time.getTime() + 1800000), lat, lon).alt;
      const s = seeingModel.estimate({
        sw: H.shortwave_radiation[i], t2m: H.temperature_2m[i], tSoil: H.soil_temperature_0cm[i], wind10: H.wind_speed_10m[i], gust10: H.wind_gusts_10m[i],
        w850: H.wind_speed_850hPa[i], w500: H.wind_speed_500hPa[i], w250: H.wind_speed_250hPa[i], w200: H.wind_speed_200hPa[i], alt,
      }, { surface: cfg.location.surface, calibration: calib });
      return { time, alt, cloud: H.cloud_cover[i], precip: H.precipitation[i], wind: H.wind_speed_10m[i], gust: H.wind_gusts_10m[i], seeing: s ? s.seeing : null, parts: s ? s.parts : null, jet: Math.max(H.wind_speed_250hPa[i] || 0, H.wind_speed_200hPa[i] || 0) };
    });
    const now = Date.now();
    const idx = Math.max(0, hours.findIndex((h) => h.time.getTime() > now) - 1);
    const cur = w.current;
    const curHour = hours[idx];
    // Seeing jetzt: falls Sonne unter dem Horizont, nächste Stunde mit Sonne
    let seeingHour = curHour.seeing != null ? curHour : hours.slice(idx).find((h) => h.seeing != null);
    const today = hours.filter((h) => new Date(h.time).toISOString().slice(0, 10) === new Date((seeingHour || curHour).time).toISOString().slice(0, 10));
    return {
      updated: new Date().toISOString(),
      current: { cloud: cur.cloud_cover, precip: cur.precipitation, wind: cur.wind_speed_10m, gust: cur.wind_gusts_10m, windDir: cur.wind_direction_10m, temp: cur.temperature_2m, code: cur.weather_code },
      seeing: seeingHour ? { value: seeingHour.seeing, at: seeingHour.time, isForecast: seeingHour !== curHour, parts: seeingHour.parts, jet: seeingHour.jet, r0: seeingModel.r0cm(seeingHour.seeing) } : null,
      best: seeingModel.bestWindow(today),
      hours: hours.slice(idx, idx + 14),
      calibration: calib,
    };
  }

  addRating(rating, modelSeeing) {
    const r = this.load('ratings.json', []);
    r.push({ time: new Date().toISOString(), rating, model: modelSeeing });
    this.save('ratings.json', r.slice(-60));
    this.wcache = null;
    return seeingModel.calibrationFrom(r);
  }

  /* ---------------- Newsroom ---------------- */
  news(cfg) {
    const items = [];
    const now = Date.now();
    const flares = Object.values(this.load('flares.json', {}));
    for (const f of flares) {
      const t = new Date(f.max_time || f.begin_time).getTime();
      const cls = f.max_class || '';
      if (now - t > 72 * 3600000) continue;
      if (cls[0] === 'X' || cls[0] === 'M') {
        const r = cls[0] === 'X' ? (parseFloat(cls.slice(1)) >= 10 ? 'R4' : 'R3') : (parseFloat(cls.slice(1)) >= 5 ? 'R2' : 'R1');
        items.push({ level: cls[0] === 'X' ? 'bad' : 'warn', title: `${cls}-Flare`, detail: `Maximum ${fmtUTC(t)} · Funkausfall ${r} auf der Tagseite`, time: t, kind: 'flare' });
      }
    }
    // stärkster C-Flare der letzten 24 h, falls keine M/X
    if (!items.some((i) => i.kind === 'flare')) {
      const c = flares.filter((f) => now - new Date(f.max_time).getTime() < 86400000).sort((a, b) => (b.max_xrlong || 0) - (a.max_xrlong || 0))[0];
      if (c) items.push({ level: 'ok', title: `Stärkster Flare 24 h: ${c.max_class}`, detail: `Maximum ${fmtUTC(new Date(c.max_time))}`, time: new Date(c.max_time).getTime(), kind: 'flare' });
    }
    // Kp-Prognose & Polarlicht
    const kp = Object.values(this.load('kp.json', {})).map((k) => ({ ...k, t: new Date(k.time_tag + 'Z').getTime() }));
    const next24 = kp.filter((k) => k.t >= now - 3 * 3600000 && k.t <= now + 24 * 3600000);
    if (next24.length) {
      const max = next24.reduce((a, b) => (b.kp > a.kp ? b : a));
      const needKp = Math.max(4, (66 - cfg.location.lat) / 2.6);
      const g = max.kp >= 9 ? 'G5' : max.kp >= 8 ? 'G4' : max.kp >= 7 ? 'G3' : max.kp >= 6 ? 'G2' : max.kp >= 5 ? 'G1' : '';
      if (max.kp >= needKp + 1) items.push({ level: 'bad', title: 'Polarlichter wahrscheinlich', detail: `Kp ${max.kp.toFixed(1)} ${g} um ${fmtLocal(max.t)} · bei klarem Himmel Richtung Norden schauen`, time: now, kind: 'aurora', pin: true });
      else if (max.kp >= needKp) items.push({ level: 'warn', title: 'Polarlichter möglich', detail: `Kp ${max.kp.toFixed(1)} ${g} erwartet · am Nordhorizont, ab Kp ${needKp.toFixed(1)} an deinem Standort`, time: now, kind: 'aurora', pin: true });
      else if (max.kp >= 5) items.push({ level: 'warn', title: `Geomagnetischer Sturm ${g}`, detail: `Kp ${max.kp.toFixed(1)} erwartet – für Polarlichter an deinem Standort ab Kp ${needKp.toFixed(1)}`, time: now, kind: 'kp' });
      else items.push({ level: 'ok', title: 'Magnetfeld ruhig', detail: `Kp max. ${max.kp.toFixed(1)} in den nächsten 24 h`, time: now - 1, kind: 'kp' });
    }
    // SWPC-Meldungen (Warnungen, Watches)
    const alerts = Object.values(this.load('alerts.json', {}));
    for (const a of alerts) {
      const t = new Date(a.issue_datetime.replace(' ', 'T') + 'Z').getTime();
      if (now - t > 48 * 3600000) continue;
      const h = translateAlert(a.message);
      if (h) items.push({ ...h, time: t, kind: 'alert' });
    }
    // Neue Regionen (letzte 48 h)
    const regs = Object.values(this.load('regions.json', {}));
    const seen = new Set();
    for (const r of regs.sort((a, b) => b.observed_date.localeCompare(a.observed_date))) {
      if (seen.has(r.region) || !r.first_date) continue;
      seen.add(r.region);
      const t = new Date(r.first_date + 'Z').getTime();
      if (now - t < 48 * 3600000 && now - t > 0) items.push({ level: 'ok', title: `Neue Region AR ${r.region}`, detail: `Position ${r.location}`, time: t, kind: 'region' });
    }
    // Doppelte Meldungen zusammenfassen
    const uniq = [];
    for (const i of items.sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.time - a.time)) if (!uniq.some((u) => u.title === i.title)) uniq.push(i);
    const misc = this.load('misc.json', {});
    return { items: uniq.slice(0, 12), ssn: misc.ssn ? misc.ssn.swpc_ssn : null, flux: misc.flux ? misc.flux.flux : null, updated: misc.updated };
  }
}

function fmtUTC(t) { return new Date(t).toISOString().slice(11, 16) + ' UTC'; }
function fmtLocal(t) { return new Date(t).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' }); }

/** Übersetzt SWPC-Meldungen in kurze deutsche Überschriften. */
function translateAlert(msg) {
  const lines = String(msg).split(/\r?\n/).map((l) => l.trim());
  const head = lines.find((l) => /^(ALERT|WARNING|WATCH|SUMMARY|EXTENDED WARNING|CONTINUED ALERT|CANCEL WARNING|CANCEL WATCH):/.test(l));
  if (!head) return null;
  const [kindEn, ...rest] = head.split(':');
  const text = rest.join(':').trim();
  const kinds = { ALERT: 'Alarm', WARNING: 'Warnung', WATCH: 'Vorhersage', SUMMARY: 'Zusammenfassung', 'EXTENDED WARNING': 'Warnung verlängert', 'CONTINUED ALERT': 'Alarm dauert an', 'CANCEL WARNING': 'Warnung aufgehoben', 'CANCEL WATCH': 'Vorhersage aufgehoben' };
  let level = /CANCEL/.test(kindEn) ? 'ok' : 'warn';
  let title = text;
  let m;
  if ((m = text.match(/Geomagnetic K-index of (\d)/i))) { title = `Geomagnetik Kp ${m[1]}`; if (+m[1] >= 6) level = 'bad'; }
  else if ((m = text.match(/Geomagnetic Storm Category (G\d)/i))) { title = `Geomagnetischer Sturm ${m[1]} erwartet`; if (+m[1][1] >= 2) level = 'bad'; }
  else if ((m = text.match(/X-ray Flux exceeded (M5|X1)/i))) { title = `Röntgenfluss über ${m[1]}`; level = 'bad'; }
  else if (/Type II Radio Emission/i.test(text)) title = 'Radioburst Typ II (Hinweis auf CME)';
  else if (/Type IV Radio Emission/i.test(text)) title = 'Radioburst Typ IV (großer Ausbruch)';
  else if ((m = text.match(/Proton Event 10MeV Integral Flux exceeded (\d+)pfu/i))) { title = `Protonenereignis > ${m[1]} pfu`; level = 'bad'; }
  else if (/Electron 2MeV Integral Flux/i.test(text)) { title = 'Elektronenfluss > 1000 pfu (Satelliten)'; level = 'ok'; }
  else if (/Geomagnetic Sudden Impulse/i.test(text)) title = 'Plötzlicher Impuls – CME-Schockfront angekommen';
  else if (/10cm Radio Burst/i.test(text)) title = '10-cm-Radioburst';
  return { level, title: `${kinds[kindEn] || kindEn}: ${title}`, detail: text };
}

module.exports = { DataStore, setFetch, translateAlert, SOURCES, IMG_SIZE, DISC_FRACTION };
