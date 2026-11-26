'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  location: { name: 'Unterleichtersbach', lat: 50.28, lon: 9.8, elevation: 300, surface: 'pflaster', mount: 'altaz' },
  widget: { x: null, y: null, alwaysOnTop: false, opacity: 1, scale: 1, showSplash: true, kind: 'wl', visible: true },
  general: { openAtLogin: true },
  data: { refreshMinutes: 15 },
  recordings: { export: { text: 'list', scale: 'none', labels: true, grid: true, flares: false, flaresHa: true, proms: true, plages: true, format: 'jpeg', quality: 95, txt: true }, lastMode: 'wl', folder: null, diary: true },
  // Ausrüstung je Wellenlänge: Bildmaßstab (Brennweite inkl. Barlow, Pixelgröße, Binning) und gelernte Ausrichtung
  profiles: {
    wl: { name: 'Refraktor + Herschelkeil (Weißlicht)', flip: null, sigma: 1, history: [], optics: { focal: null, pixel: null, binning: 1 } },
    ca: { name: 'Refraktor + Ca-K (Kalzium)', flip: null, sigma: 1, history: [], optics: { focal: null, pixel: null, binning: 1 } },
    ha: { name: 'H-Alpha-Teleskop', flip: null, sigma: 1, history: [], optics: { focal: null, pixel: null, binning: 1 } },
  },
  seeing: { factor: null },
  notify: { mode: 'interessant', goodWindow: true, seen: [] },
  update: { auto: true, repo: 'ziege1988/Solux', lastCheck: null },
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? merge(base[k], over[k]) : over[k];
  return out;
}

/** Ältere Einstellungen übernehmen: gemeinsame Optik -> je Profil, veraltete Aufnahme-Schalter entfernen. */
function migrate(d) {
  const o = d.recordings && d.recordings.optics;
  if (o && (o.focal || o.pixel)) {
    for (const k of Object.keys(d.profiles)) if (!d.profiles[k].optics || !d.profiles[k].optics.focal) d.profiles[k].optics = { focal: o.focal || null, pixel: o.pixel || null, binning: o.binning || 1 };
  }
  if (d.recordings) for (const k of ['optics', 'jpegQuality', 'legend', 'labelStyle', 'grid', 'cameraTime']) delete d.recordings[k];
}

class Config {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* erster Start */ }
    this.data = merge(DEFAULTS, stored);
    migrate(this.data);
  }
  get() { return JSON.parse(JSON.stringify(this.data)); }
  set(patch) {
    this.data = merge(this.data, patch);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.get();
  }
}

module.exports = { Config, DEFAULTS, merge };
