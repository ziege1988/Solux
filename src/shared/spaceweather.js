/*
 * Solux – Aufbereitung der Sonnen- und Wetterdaten (gemeinsam für Mac und Handy)
 * Reine Funktionen ohne Datei- oder Netzwerkzugriff: Regionen auf Zeitpunkt drehen,
 * Newsroom zusammenstellen, Wetter/Seeing auswerten, SWPC-Meldungen übersetzen.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const astro = isNode ? require('./astro') : root.SoluxAstro;
  const seeingModel = isNode ? require('./seeing') : root.SoluxSeeing;

  const SWPC = 'https://services.swpc.noaa.gov';
  const HV = 'https://api.helioviewer.org/v2';
  const SOURCES = {
    wl: { id: 18, layer: '[SDO,HMI,continuum,1,100]', label: 'SDO/HMI Kontinuum' },
    ca: { id: 16, layer: '[SDO,AIA,1700,1,100]', label: 'SDO/AIA 1700 Å' },
  };
  const IMG_SIZE = 1024, DISC_FRACTION = 0.45; // Sonnenradius = 0,45 · Bildbreite
  const SWPC_URLS = {
    regions: `${SWPC}/json/solar_regions.json`,
    flares: `${SWPC}/json/goes/primary/xray-flares-7-day.json`,
    kp: `${SWPC}/products/noaa-planetary-k-index-forecast.json`,
    alerts: `${SWPC}/products/alerts.json`,
    ssn: `${SWPC}/json/solar-cycle/swpc_observed_ssn.json`,
    flux: `${SWPC}/products/summary/10cm-flux.json`,
  };

  /* ---------------- Sonnenbild (Helioviewer) ---------------- */
  function closestImageUrl(kind, date) {
    const iso = new Date(date).toISOString().replace(/\.\d+Z$/, 'Z');
    return `${HV}/getClosestImage/?date=${iso}&sourceId=${(SOURCES[kind] || SOURCES.wl).id}`;
  }
  /** Bild-URL so skaliert, dass der Sonnenradius genau DISC_FRACTION · Breite ist. */
  function screenshotUrl(kind, meta, size = IMG_SIZE) {
    const scale = (meta.rsun * meta.scale) / (size * DISC_FRACTION);
    return `${HV}/takeScreenshot/?date=${meta.date.replace(' ', 'T')}Z&imageScale=${scale.toFixed(5)}&layers=${encodeURIComponent((SOURCES[kind] || SOURCES.wl).layer)}&x0=0&y0=0&width=${size}&height=${size}&display=true&watermark=false`;
  }

  /* ---------------- Regionen ---------------- */
  /** Kp-Daten liegen je nach Produkt als Tabelle (Array von Arrays) oder als Objekte vor. */
  function normKp(kp) {
    if (!kp) return [];
    return Array.isArray(kp[0]) ? kp.slice(1).map((a) => ({ time_tag: a[0], kp: +a[1], observed: a[2], noaa_scale: a[3] })) : kp;
  }

  /**
   * NOAA-Regionen mit Positionen für `date`.
   * observed_date D in solar_regions.json gilt für D+1 00:00 UT (vgl. SRS „valid at D/2400Z“).
   * Es wird der jüngste vollständig klassifizierte Tag vor/um `date` genutzt.
   */
  function computeRegions(rows, date) {
    const byDay = {};
    for (const r of rows || []) (byDay[r.observed_date] ||= []).push(r);
    const days = Object.keys(byDay).sort();
    const validAt = (d) => new Date(new Date(d + 'T00:00:00Z').getTime() + 86400000);
    let pick = null;
    // Der laufende Tag ist vorläufig (Klassen fehlen noch) – nur weitgehend klassifizierte Tage verwenden
    const complete = (d) => { const sp = byDay[d].filter((r) => (r.number_spots || 0) > 0 || r.spot_class); return sp.length > 0 && sp.filter((r) => r.spot_class).length >= sp.length * 0.6; };
    for (const d of days) {
      if (!complete(d)) continue;
      if (validAt(d).getTime() <= date.getTime() + 18 * 3600000) pick = d; // bis 18 h im Voraus erlaubt
    }
    if (!pick) {
      const first = days.find(complete);
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

  function regionHistory(rows, num) {
    return (rows || []).filter((r) => r.region === num && r.spot_class).sort((a, b) => a.observed_date.localeCompare(b.observed_date))
      .map((r) => ({ day: r.observed_date, cls: r.spot_class, mag: r.mag_class, area: r.area, n: r.number_spots, flares: { c: r.c_xray_events, m: r.m_xray_events, x: r.x_xray_events } }));
  }

  /* ---------------- Wetter & Seeing ---------------- */
  function weatherUrl(loc) {
    const hourly = ['temperature_2m', 'soil_temperature_0cm', 'shortwave_radiation', 'cloud_cover', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'wind_speed_850hPa', 'wind_speed_500hPa', 'wind_speed_250hPa', 'wind_speed_200hPa'];
    const current = ['temperature_2m', 'cloud_cover', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'weather_code'];
    return `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=${hourly.join(',')}&current=${current.join(',')}&wind_speed_unit=ms&timezone=UTC&forecast_days=2`;
  }

  function buildWeather(w, loc, ratings, nowMs = Date.now()) {
    const H = w.hourly;
    const calib = seeingModel.calibrationFrom(ratings || []);
    const hours = H.time.map((t, i) => {
      const time = new Date(t + ':00Z');
      const alt = astro.sunAltAz(new Date(time.getTime() + 1800000), loc.lat, loc.lon).alt;
      const s = seeingModel.estimate({
        sw: H.shortwave_radiation[i], t2m: H.temperature_2m[i], tSoil: H.soil_temperature_0cm[i], wind10: H.wind_speed_10m[i], gust10: H.wind_gusts_10m[i],
        w850: H.wind_speed_850hPa[i], w500: H.wind_speed_500hPa[i], w250: H.wind_speed_250hPa[i], w200: H.wind_speed_200hPa[i], alt,
      }, { surface: loc.surface, calibration: calib });
      return { time, alt, cloud: H.cloud_cover[i], precip: H.precipitation[i], wind: H.wind_speed_10m[i], gust: H.wind_gusts_10m[i], seeing: s ? s.seeing : null, parts: s ? s.parts : null, jet: Math.max(H.wind_speed_250hPa[i] || 0, H.wind_speed_200hPa[i] || 0) };
    });
    const idx = Math.max(0, hours.findIndex((h) => h.time.getTime() > nowMs) - 1);
    const cur = w.current, curHour = hours[idx];
    // Seeing jetzt – oder, bei Sonne unter dem Horizont, die nächste Stunde mit Sonne
    const seeingHour = curHour.seeing != null ? curHour : hours.slice(idx).find((h) => h.seeing != null);
    const day = new Date((seeingHour || curHour).time).toISOString().slice(0, 10);
    const today = hours.filter((h) => new Date(h.time).toISOString().slice(0, 10) === day);
    return {
      updated: new Date(nowMs).toISOString(),
      current: { cloud: cur.cloud_cover, precip: cur.precipitation, wind: cur.wind_speed_10m, gust: cur.wind_gusts_10m, windDir: cur.wind_direction_10m, temp: cur.temperature_2m, code: cur.weather_code },
      seeing: seeingHour ? { value: seeingHour.seeing, at: seeingHour.time, isForecast: seeingHour !== curHour, parts: seeingHour.parts, jet: seeingHour.jet, r0: seeingModel.r0cm(seeingHour.seeing) } : null,
      best: seeingModel.bestWindow(today),
      hours: hours.slice(idx, idx + 14),
      calibration: calib,
    };
  }

  /* ---------------- Newsroom ---------------- */
  const fmtUTC = (t) => new Date(t).toISOString().slice(11, 16) + ' UTC';
  const fmtLocal = (t) => new Date(t).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  /** d = { flares[], kp[] (normalisiert), alerts[], regions[], ssn, flux, updated } */
  function buildNews(d, loc, nowMs = Date.now()) {
    const items = [], now = nowMs;
    const flares = d.flares || [];
    for (const f of flares) {
      const t = new Date(f.max_time || f.begin_time).getTime(), cls = f.max_class || '';
      if (now - t > 72 * 3600000) continue;
      if (cls[0] === 'X' || cls[0] === 'M') {
        const r = cls[0] === 'X' ? (parseFloat(cls.slice(1)) >= 10 ? 'R4' : 'R3') : (parseFloat(cls.slice(1)) >= 5 ? 'R2' : 'R1');
        items.push({ level: cls[0] === 'X' ? 'bad' : 'warn', title: `${cls}-Flare`, detail: `Maximum ${fmtUTC(t)} · Funkausfall ${r} auf der Tagseite`, time: t, kind: 'flare' });
      }
    }
    if (!items.some((i) => i.kind === 'flare')) {
      const c = flares.filter((f) => now - new Date(f.max_time).getTime() < 86400000).sort((a, b) => (b.max_xrlong || 0) - (a.max_xrlong || 0))[0];
      if (c) items.push({ level: 'ok', title: `Stärkster Flare 24 h: ${c.max_class}`, detail: `Maximum ${fmtUTC(new Date(c.max_time))}`, time: new Date(c.max_time).getTime(), kind: 'flare' });
    }
    const kp = (d.kp || []).map((k) => ({ ...k, t: new Date(k.time_tag + 'Z').getTime() }));
    const next24 = kp.filter((k) => k.t >= now - 3 * 3600000 && k.t <= now + 24 * 3600000);
    if (next24.length) {
      const max = next24.reduce((a, b) => (b.kp > a.kp ? b : a));
      const needKp = Math.max(4, (66 - loc.lat) / 2.6);
      const g = max.kp >= 9 ? 'G5' : max.kp >= 8 ? 'G4' : max.kp >= 7 ? 'G3' : max.kp >= 6 ? 'G2' : max.kp >= 5 ? 'G1' : '';
      if (max.kp >= needKp + 1) items.push({ level: 'bad', title: 'Polarlichter wahrscheinlich', detail: `Kp ${max.kp.toFixed(1)} ${g} um ${fmtLocal(max.t)} · bei klarem Himmel Richtung Norden schauen`, time: now, kind: 'aurora', pin: true });
      else if (max.kp >= needKp) items.push({ level: 'warn', title: 'Polarlichter möglich', detail: `Kp ${max.kp.toFixed(1)} ${g} erwartet · am Nordhorizont, ab Kp ${needKp.toFixed(1)} an deinem Standort`, time: now, kind: 'aurora', pin: true });
      else if (max.kp >= 5) items.push({ level: 'warn', title: `Geomagnetischer Sturm ${g}`, detail: `Kp ${max.kp.toFixed(1)} erwartet – für Polarlichter an deinem Standort ab Kp ${needKp.toFixed(1)}`, time: now, kind: 'kp' });
      else items.push({ level: 'ok', title: 'Magnetfeld ruhig', detail: `Kp max. ${max.kp.toFixed(1)} in den nächsten 24 h`, time: now - 1, kind: 'kp' });
    }
    for (const a of d.alerts || []) {
      const t = new Date(a.issue_datetime.replace(' ', 'T') + 'Z').getTime();
      if (now - t > 48 * 3600000) continue;
      const h = translateAlert(a.message);
      if (h) items.push({ ...h, time: t, kind: 'alert' });
    }
    const seen = new Set();
    for (const r of (d.regions || []).slice().sort((a, b) => b.observed_date.localeCompare(a.observed_date))) {
      if (seen.has(r.region) || !r.first_date) continue;
      seen.add(r.region);
      const t = new Date(r.first_date + 'Z').getTime();
      if (now - t < 48 * 3600000 && now - t > 0) items.push({ level: 'ok', title: `Neue Region AR ${r.region}`, detail: `Position ${r.location}`, time: t, kind: 'region' });
    }
    const uniq = [];
    for (const i of items.sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.time - a.time)) if (!uniq.some((u) => u.title === i.title)) uniq.push(i);
    return { items: uniq.slice(0, 12), ssn: d.ssn ?? null, flux: d.flux ?? null, updated: d.updated };
  }

  /** Übersetzt SWPC-Meldungen in kurze deutsche Überschriften. */
  function translateAlert(msg) {
    const lines = String(msg).split(/\r?\n/).map((l) => l.trim());
    const head = lines.find((l) => /^(ALERT|WARNING|WATCH|SUMMARY|EXTENDED WARNING|CONTINUED ALERT|CANCEL WARNING|CANCEL WATCH):/.test(l));
    if (!head) return null;
    const [kindEn, ...rest] = head.split(':');
    const text = rest.join(':').trim();
    const kinds = { ALERT: 'Alarm', WARNING: 'Warnung', WATCH: 'Vorhersage', SUMMARY: 'Zusammenfassung', 'EXTENDED WARNING': 'Warnung verlängert', 'CONTINUED ALERT': 'Alarm dauert an', 'CANCEL WARNING': 'Warnung aufgehoben', 'CANCEL WATCH': 'Vorhersage aufgehoben' };
    let level = /CANCEL/.test(kindEn) ? 'ok' : 'warn';
    let title = text, m;
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

  const api = { SWPC, HV, SOURCES, IMG_SIZE, DISC_FRACTION, SWPC_URLS, closestImageUrl, screenshotUrl, normKp, computeRegions, regionHistory, weatherUrl, buildWeather, buildNews, translateAlert };
  if (isNode) module.exports = api; else root.SoluxSW = api;
})(typeof self !== 'undefined' ? self : this);
