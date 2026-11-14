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
const seeingModel = require('../shared/seeing');
const SW = require('../shared/spaceweather');
const { SOURCES, IMG_SIZE, DISC_FRACTION, SWPC_URLS, translateAlert } = SW;

const KEEP_DAYS = 60;

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
      this.fetchJSON(SWPC_URLS.regions),
      this.fetchJSON(SWPC_URLS.flares),
      this.fetchJSON(SWPC_URLS.kp),
      this.fetchJSON(SWPC_URLS.alerts),
      this.fetchJSON(SWPC_URLS.ssn),
      this.fetchJSON(SWPC_URLS.flux),
      this.fetchJSON(SWPC_URLS.events, 60000),
    ]);
    const [reg, flr, kp, alerts, ssn, flux, events] = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
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
      for (const k of SW.normKp(kp)) store[k.time_tag] = k;
      for (const k of Object.keys(store)) if (new Date(k + 'Z').getTime() < cutoff) delete store[k];
      this.save('kp.json', store);
    }
    if (alerts) {
      const store = this.load('alerts.json', {});
      for (const a of alerts) store[a.issue_datetime + '|' + a.product_id] = a;
      for (const k of Object.keys(store)) if (new Date(k.split('|')[0].replace(' ', 'T') + 'Z').getTime() < cutoff) delete store[k];
      this.save('alerts.json', store);
    }
    if (events) {
      const store = this.load('events.json', {});
      for (const e of events) if (e.type === 'XRA' || e.type === 'FLA') store[`${e.type}|${e.begin_datetime}|${e.region || ''}`] = e;
      for (const k of Object.keys(store)) if (new Date(k.split('|')[1] + 'Z').getTime() < cutoff) delete store[k];
      this.save('events.json', store);
    }
    const misc = this.load('misc.json', {});
    if (ssn && ssn.length) misc.ssn = ssn[ssn.length - 1];
    if (flux && flux.length) misc.flux = flux[0];
    misc.updated = new Date().toISOString();
    this.save('misc.json', misc);
    return { ok: results.filter((r) => r.status === 'fulfilled').length, total: results.length };
  }

  /* ---------------- Regionen für einen Zeitpunkt ---------------- */
  /** Regionen für einen Zeitpunkt – aus dem 60-Tage-Speicher, sonst aus dem NOAA-Archiv (Tagesberichte). */
  async regionsFor(date) {
    const local = SW.computeRegions(Object.values(this.load('regions.json', {})), date);
    if (local.day && Math.abs(new Date(local.validAt) - date) < 1.5 * 86400000) return local;
    const arch = this.load('archive.json', {});
    const rows = [];
    for (const day of SW.srsIssueDays(date)) {
      if (!arch[day]) {
        try {
          const res = await httpFetch(SW.srsArchiveUrl(day), { signal: AbortSignal.timeout(30000) });
          if (!res.ok) continue;
          arch[day] = SW.parseSRS(await res.text(), day);
          this.save('archive.json', arch);
        } catch (e) { this.log('NOAA-Archiv: ' + e.message); continue; }
      }
      rows.push(...arch[day]);
    }
    const r = SW.computeRegions(rows, date);
    return r.day ? { ...r, source: 'NOAA-Archiv' } : local;
  }
  /** Flares mit Region/Ort aus den gespeicherten Ereignissen. */
  flares(sinceMs) {
    return SW.flareEvents(Object.values(this.load('events.json', {}))).filter((f) => !sinceMs || f.max >= sinceMs);
  }
  /**
   * Flares rund um einen Zeitpunkt (±36 h). Liegt der Zeitraum im lokalen 60-Tage-Speicher, kommen sie von dort,
   * sonst aus dem NOAA-Archiv (Tageslisten seit 1996, dauerhaft zwischengespeichert in archive-events.json).
   * Rückgabe {flares, source, missing[]} – missing = Tage ohne Daten.
   */
  async flaresAround(date) {
    const t = new Date(date).getTime(), H = 3600000;
    const local = Object.values(this.load('events.json', {}));
    const first = local.reduce((m, e) => Math.min(m, new Date((e.begin_datetime || '') + 'Z').getTime() || Infinity), Infinity);
    const recent = Date.now() - t < 2 * 86400000;
    let events = local, source = 'lokal';
    const missing = [];
    if (!(first < t - 36 * H) && !recent) {
      const arch = this.load('archive-events.json', {});
      const days = [-1, 0, 1].map((d) => new Date(t + d * 86400000).toISOString().slice(0, 10));
      let changed = false;
      for (const day of days) {
        if (!arch[day]) {
          try {
            const res = await httpFetch(SW.eventsArchiveUrl(day), { signal: AbortSignal.timeout(30000) });
            if (!res.ok) { missing.push(day); continue; }
            const ev = SW.parseEvents(await res.text(), day);
            // Die Tagesliste wird erst nach ein paar Tagen endgültig – jüngere Tage nicht dauerhaft speichern
            if (Date.now() - new Date(day).getTime() > 5 * 86400000) { arch[day] = ev; changed = true; }
            events = events.concat(ev);
          } catch (e) { this.log('NOAA-Ereignisarchiv: ' + e.message); missing.push(day); }
        } else events = events.concat(arch[day]);
      }
      if (changed) this.save('archive-events.json', arch);
      source = 'NOAA-Archiv';
    }
    const seen = new Set();
    const uniq = events.filter((e) => { const k = `${e.type}|${e.begin_datetime}|${e.particulars1}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const flares = SW.flareEvents(uniq).filter((f) => Math.abs(f.max - t) <= 36 * H);
    return { flares, source, missing };
  }
  regionHistory(num) { return SW.regionHistory(Object.values(this.load('regions.json', {})), num); }

  /* ---------------- Sonnenbilder ---------------- */
  async sunImage(kind = 'wl', date = null, size = IMG_SIZE) {
    const src = SOURCES[kind] || SOURCES.wl;
    const when = date ? new Date(date) : new Date();
    const meta = await this.fetchJSON(SW.closestImageUrl(kind, when));
    const imgDate = new Date(meta.date.replace(' ', 'T') + 'Z');
    const cacheName = `${kind}_${meta.id}_${size}.png`;
    const cachePath = path.join(this.dir, 'images', cacheName);
    if (!fs.existsSync(cachePath)) {
      const res = await httpFetch(SW.screenshotUrl(kind, meta, size), { signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`Sonnenbild nicht verfügbar (${res.status})`);
      fs.writeFileSync(cachePath, Buffer.from(await res.arrayBuffer()));
      this.pruneImages();
    }
    return {
      kind, label: src.label, date: imgDate.toISOString(), size, radiusPx: size * DISC_FRACTION,
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
    const w = await this.fetchJSON(SW.weatherUrl(cfg.location));
    return SW.buildWeather(w, cfg.location, this.load('ratings.json', []));
  }

  addRating(rating, modelSeeing) {
    const r = this.load('ratings.json', []);
    r.push({ time: new Date().toISOString(), rating, model: modelSeeing });
    this.save('ratings.json', r.slice(-60));
    this.wcache = null;
    return seeingModel.calibrationFrom(r);
  }

  /**
   * Gemessenes Seeing einer Aufnahme speichern: Modellwert zur Aufnahmezeit (ohne Kalibrierung) dazuholen,
   * Verhältnis merken und den neuen Kalibrierfaktor zurückgeben.
   */
  async seeingRecord(cfg, { time, measured, mode, file }) {
    const w = await this.fetchJSON(SW.weatherDayUrl(cfg.location, time));
    const model = SW.modelSeeingAt(w, cfg.location, time);
    if (!(model > 0)) return { model: null, measured, ...seeingModel.calibrationInfo(this.load('ratings.json', [])) };
    const key = `${file}|${new Date(time).toISOString()}`;
    const r = this.load('ratings.json', []).filter((x) => x.key !== key);
    r.push({ key, time: new Date(time).toISOString(), measured, model, mode, file, added: new Date().toISOString() });
    this.save('ratings.json', r.slice(-120));
    this.wcache = null;
    return { model, measured, ...seeingModel.calibrationInfo(r) };
  }
  seeingInfo() { const r = this.load('ratings.json', []); return { ...seeingModel.calibrationInfo(r), records: r.filter((x) => x.measured).slice(-12) }; }
  seeingReset() { this.save('ratings.json', []); this.wcache = null; return seeingModel.calibrationInfo([]); }

  /* ---------------- Newsroom ---------------- */
  news(cfg) {
    const misc = this.load('misc.json', {});
    return SW.buildNews({
      flares: Object.values(this.load('flares.json', {})), kp: Object.values(this.load('kp.json', {})),
      alerts: Object.values(this.load('alerts.json', {})), regions: Object.values(this.load('regions.json', {})), events: Object.values(this.load('events.json', {})),
      ssn: misc.ssn ? misc.ssn.swpc_ssn : null, flux: misc.flux ? misc.flux.flux : null, updated: misc.updated,
    }, cfg.location);
  }
}

module.exports = { DataStore, setFetch, translateAlert, SOURCES, IMG_SIZE, DISC_FRACTION };
