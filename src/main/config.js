'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  location: { name: 'Unterleichtersbach', lat: 50.28, lon: 9.8, elevation: 300, surface: 'pflaster', mount: 'altaz' },
  widget: { x: null, y: null, alwaysOnTop: false, opacity: 1, scale: 1, showSplash: true, kind: 'wl', visible: true },
  general: { openAtLogin: true },
  data: { refreshMinutes: 15 },
  recordings: { lastMode: 'wl', folder: null, jpegQuality: 95, legend: true, labelStyle: 'full', grid: true, cameraTime: 'local' },
  profiles: {
    wl: { name: 'Refraktor + Herschelkeil (Weißlicht)', flip: null, sigma: 1, history: [] },
    ca: { name: 'Refraktor + Ca-K (Kalzium)', flip: null, sigma: 1, history: [] },
  },
  notify: { flareM: true, aurora: true, alerts: true, newRegion: false, goodWindow: true, seen: [] },
  update: { auto: true, repo: 'ziege1988/Solux', lastCheck: null },
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? merge(base[k], over[k]) : over[k];
  return out;
}

class Config {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* erster Start */ }
    this.data = merge(DEFAULTS, stored);
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
