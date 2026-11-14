/*
 * Solux mobil – Datenanbindung im Browser.
 * Stellt dieselbe Schnittstelle bereit wie die Mac-App (window.solux), damit die
 * Oberfläche (widget.js) unverändert auf dem Handy läuft. Daten kommen direkt von
 * NOAA SWPC, Open-Meteo und Helioviewer; Einstellungen und der letzte Datenstand
 * liegen nur auf diesem Gerät (localStorage).
 */
(() => {
  'use strict';
  const SW = window.SoluxSW, S = window.SoluxSeeing;
  const VERSION = '1.5.1';

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('solux.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('solux.' + k, JSON.stringify(v)); } catch { /* voll oder gesperrt */ } },
  };
  const merge = (a, b) => {
    if (typeof a !== 'object' || a === null || Array.isArray(a)) return b === undefined ? a : b;
    const o = { ...a };
    for (const k of Object.keys(b || {})) o[k] = k in a ? merge(a[k], b[k]) : b[k];
    return o;
  };
  const DEF = {
    location: { name: 'Unterleichtersbach', lat: 50.28, lon: 9.8, elevation: 300, surface: 'pflaster', mount: 'altaz' },
    widget: { kind: 'wl', showSplash: true }, data: { refreshMinutes: 15 },
    general: {}, notify: {}, recordings: {}, profiles: {}, update: { repo: 'ziege1988/Solux' },
  };
  let cfg = merge(DEF, LS.get('config', {}));
  // Kürzer als 15 Minuten ist am Handy nicht sinnvoll (Push-Takt, Datenquellen) – alte Einstellung anheben
  if (!(cfg.data.refreshMinutes >= 15)) { cfg.data.refreshMinutes = 15; LS.set('config', cfg); }

  const listeners = {};
  const emit = (ch, p) => (listeners[ch] || []).forEach((f) => { try { f(p); } catch (e) { console.error(e); } });

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} beim Abruf`);
    return r.json();
  }
  // Helioviewer erlaubt keinen direkten Browser-Abruf, unterstützt aber JSONP
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = '__solux' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const done = () => { clearTimeout(t); delete window[cb]; s.remove(); };
      const t = setTimeout(() => { done(); reject(new Error('Helioviewer antwortet nicht')); }, 25000);
      window[cb] = (d) => { done(); resolve(d); };
      s.onerror = () => { done(); reject(new Error('Helioviewer nicht erreichbar')); };
      s.src = url + '&callback=' + cb;
      document.head.appendChild(s);
    });
  }

  /* ---------- Weltraumwetter (letzter Stand bleibt für den schnellen Start gespeichert) ---------- */
  let sw = LS.get('sw', null);
  let swLoading = null;
  async function refresh() {
    const keys = ['regions', 'flares', 'kp', 'alerts', 'ssn', 'flux', 'events'];
    const res = await Promise.allSettled(keys.map((k) => getJSON(SW.SWPC_URLS[k])));
    const d = { ...(sw || {}) };
    res.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const v = r.value, k = keys[i];
      if (k === 'kp') d.kp = SW.normKp(v);
      else if (k === 'ssn') d.ssn = v.length ? v[v.length - 1].swpc_ssn : d.ssn;
      else if (k === 'flux') d.flux = v.length ? v[0].flux : d.flux;
      else if (k === 'events') d.events = v.filter((e) => e.type === 'XRA' || e.type === 'FLA');
      else d[k] = v;
    });
    d.updated = new Date().toISOString();
    sw = d; LS.set('sw', d);
    emit('data-updated');
    return { ok: res.filter((r) => r.status === 'fulfilled').length, total: keys.length };
  }
  async function ensureData() {
    const fresh = sw && Date.now() - new Date(sw.updated).getTime() < 15 * 60000;
    if (fresh) return sw;
    if (sw) { if (!swLoading) swLoading = refresh().finally(() => (swLoading = null)); return sw; } // alter Stand sofort, neuer im Hintergrund
    swLoading ||= refresh().finally(() => (swLoading = null));
    await swLoading;
    return sw;
  }

  let wcache = null;
  async function weather() {
    const key = `${cfg.location.lat},${cfg.location.lon},${cfg.location.surface}`;
    if (wcache && wcache.key === key && Date.now() - wcache.t < 10 * 60000) return wcache.data;
    const w = await getJSON(SW.weatherUrl(cfg.location));
    const data = SW.buildWeather(w, cfg.location, LS.get('ratings', []), Date.now(), cfg.seeing && cfg.seeing.factor);
    wcache = { key, t: Date.now(), data };
    return data;
  }

  window.solux = {
    platform: 'web',
    getConfig: async () => ({ ...JSON.parse(JSON.stringify(cfg)), version: VERSION, packaged: true }),
    setConfig: async (patch) => {
      cfg = merge(cfg, patch); LS.set('config', cfg);
      if (patch.location) wcache = null;
      return window.solux.getConfig();
    },
    refresh: async () => { wcache = null; return refresh(); },
    sunImage: async (kind) => {
      const meta = await jsonp(SW.closestImageUrl(kind, new Date()));
      const src = SW.SOURCES[kind] || SW.SOURCES.wl;
      return { kind, label: src.label, date: new Date(meta.date.replace(' ', 'T') + 'Z').toISOString(), size: SW.IMG_SIZE, radiusPx: SW.IMG_SIZE * SW.DISC_FRACTION, url: SW.screenshotUrl(kind, meta) };
    },
    regions: async (iso) => {
      const date = iso ? new Date(iso) : new Date();
      const local = SW.computeRegions((await ensureData()).regions, date);
      if (local.day && Math.abs(new Date(local.validAt) - date) < 1.5 * 86400000) return local;
      const rows = [];
      for (const day of SW.srsIssueDays(date)) { try { const r = await fetch(SW.srsArchiveUrl(day)); if (r.ok) rows.push(...SW.parseSRS(await r.text(), day)); } catch { /* offline */ } }
      const r = SW.computeRegions(rows, date);
      return r.day ? { ...r, source: 'NOAA-Archiv' } : local;
    },
    flares: async (since) => SW.flareEvents((await ensureData()).events).filter((f) => !since || f.max >= since),
    regionHistory: async (num) => SW.regionHistory((await ensureData()).regions, num),
    news: async () => { const d = await ensureData(); return SW.buildNews(d, cfg.location); },
    weather,
    rateSeeing: async (rating, model) => {
      const r = LS.get('ratings', []); r.push({ time: new Date().toISOString(), rating, model });
      LS.set('ratings', r.slice(-60)); wcache = null;
      return S.calibrationFrom(r);
    },
    storeInfo: async () => {
      const days = [...new Set(((sw && sw.regions) || []).map((r) => r.observed_date))].sort();
      let bytes = 0; try { for (const k of Object.keys(localStorage)) if (k.startsWith('solux.')) bytes += localStorage.getItem(k).length; } catch { /* egal */ }
      return { bytes, days: days.length, from: days[0], to: days[days.length - 1], dir: 'nur auf diesem Gerät' };
    },
    geoSearch: async (name) => {
      const r = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=de&format=json`);
      return (r.results || []).map((x) => ({ name: x.name, admin: [x.admin3, x.admin2, x.admin1].filter(Boolean).join(', '), country: x.country, lat: x.latitude, lon: x.longitude, elevation: x.elevation }));
    },
    locate: () => new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Standortdienste nicht verfügbar'));
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, elevation: p.coords.altitude }), (e) => reject(new Error(e.code === 1 ? 'Standortzugriff nicht erlaubt' : 'Standort nicht ermittelbar')), { enableHighAccuracy: false, timeout: 15000 });
    }),
    // Mac-spezifische Funktionen sind auf dem Handy ohne Wirkung
    clearImages: async () => true, showLog: async () => {}, quit: async () => {}, openRecordings: async () => {}, hideWidget: async () => {},
    openExternal: async (url) => window.open(url, '_blank', 'noopener'),
    rec: { profileReset: async () => ({}) },
    update: { check: async () => ({ available: false, message: 'Die Handy-Version aktualisiert sich automatisch.' }), install: async () => false },
    push: {
      // Code für das GitHub-Secret: Abo + gewünschte Stufe
      _code(sub, mode) { return JSON.stringify({ mode, subscription: sub }); },
      async status() {
        const mode = LS.get('pushMode', 'interessant');
        const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return { mode, message: standalone ? 'Dieses Gerät unterstützt keine Web-Push-Mitteilungen (iOS 16.4 oder neuer nötig).' : 'Mitteilungen gibt es nur in der installierten App (Safari → Teilen → Zum Home-Bildschirm).', canSubscribe: false };
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return { mode, message: 'Mitteilungen gibt es nur in der installierten App (Safari → Teilen → Zum Home-Bildschirm).', canSubscribe: false };
        const sub = await reg.pushManager.getSubscription();
        if (mode === 'aus') return { mode, message: 'Mitteilungen sind <b>aus</b>. Dieses Gerät erhält keine Push-Meldungen mehr.', canSubscribe: false };
        if (sub) {
          const code = this._code(sub.toJSON(), mode), last = LS.get('pushCode', null);
          return { mode, message: `<b class="lv-ok">Aktiv</b> · Stufe „${mode === 'alle' ? 'Alle neuen Meldungen' : 'Nur interessante'}“.`, canSubscribe: false, code, codeChanged: !!last && last !== code };
        }
        if (Notification.permission === 'denied') return { mode, message: 'Mitteilungen sind blockiert. iOS-Einstellungen → Mitteilungen → Solux erlauben.', canSubscribe: false };
        return { mode, message: 'Noch nicht aktiviert.', canSubscribe: true };
      },
      async setMode(mode) {
        LS.set('pushMode', mode);
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && (await reg.pushManager.getSubscription());
        if (mode === 'aus' && sub) await sub.unsubscribe();
      },
      async subscribe() {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('Mitteilungen wurden nicht erlaubt.');
        if (LS.get('pushMode', 'interessant') === 'aus') LS.set('pushMode', 'interessant');
        const reg = await navigator.serviceWorker.ready;
        const key = window.SOLUX_PUSH.publicKey.replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(key + '='.repeat((4 - (key.length % 4)) % 4));
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
        LS.set('pushCode', this._code(sub.toJSON(), LS.get('pushMode', 'interessant')));
        return true;
      },
      markCopied(code) { LS.set('pushCode', code); },
      async test() {
        if (Notification.permission !== 'granted') throw new Error('Zuerst Mitteilungen aktivieren.');
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification('Solux · Test', { body: 'So sieht eine Mitteilung von Solux aus.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'solux-test' });
      },
    },
    on: (ch, fn) => { (listeners[ch] ||= []).push(fn); return () => { listeners[ch] = listeners[ch].filter((f) => f !== fn); }; },
  };

  // Beim Zurückkehren in die App aktualisieren, sonst alle 15 Minuten
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sw && Date.now() - new Date(sw.updated).getTime() > 5 * 60000) { wcache = null; refresh().catch(() => {}); }
  });
  // Aktualisierung im eingestellten Takt (15/30/60 Minuten), nur solange die App sichtbar ist
  let lastAuto = Date.now();
  setInterval(() => {
    const every = Math.max(15, cfg.data.refreshMinutes || 15) * 60000;
    if (document.visibilityState === 'visible' && Date.now() - lastAuto >= every) { lastAuto = Date.now(); wcache = null; refresh().catch(() => {}); }
  }, 60000);
})();
