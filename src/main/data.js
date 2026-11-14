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
    const misc = this.load('misc.json', {});
    if (ssn && ssn.length) misc.ssn = ssn[ssn.length - 1];
    if (flux && flux.length) misc.flux = flux[0];
    misc.updated = new Date().toISOString();
    this.save('misc.json', misc);
    return { ok: results.filter((r) => r.status === 'fulfilled').length, total: results.length };
  }

  /* ---------------- Regionen für einen Zeitpunkt ---------------- */
  regionsFor(date) { return SW.computeRegions(Object.values(this.load('regions.json', {})), date); }
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

  /* ---------------- Newsroom ---------------- */
  news(cfg) {
    const misc = this.load('misc.json', {});
    return SW.buildNews({
      flares: Object.values(this.load('flares.json', {})), kp: Object.values(this.load('kp.json', {})),
      alerts: Object.values(this.load('alerts.json', {})), regions: Object.values(this.load('regions.json', {})),
      ssn: misc.ssn ? misc.ssn.swpc_ssn : null, flux: misc.flux ? misc.flux.flux : null, updated: misc.updated,
    }, cfg.location);
  }
}

module.exports = { DataStore, setFetch, translateAlert, SOURCES, IMG_SIZE, DISC_FRACTION };
