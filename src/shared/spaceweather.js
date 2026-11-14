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
    ha: { id: 94, layer: '[GONG,GONG,H-alpha,6562,1,100]', label: 'GONG H-Alpha (NSO)' },
  };
  const IMG_SIZE = 1024, DISC_FRACTION = 0.45; // Sonnenradius = 0,45 · Bildbreite
  const SWPC_URLS = {
    regions: `${SWPC}/json/solar_regions.json`,
    flares: `${SWPC}/json/goes/primary/xray-flares-7-day.json`,
    kp: `${SWPC}/products/noaa-planetary-k-index-forecast.json`,
    alerts: `${SWPC}/products/alerts.json`,
    ssn: `${SWPC}/json/solar-cycle/swpc_observed_ssn.json`,
    flux: `${SWPC}/products/summary/10cm-flux.json`,
    events: `${SWPC}/json/edited_events.json`,
  };
  const SRS_ARCHIVE = 'https://www.ngdc.noaa.gov/stp/space-weather/swpc-products/daily_reports/solar_region_summaries';

  /* ---------------- NOAA-Archiv (ältere Tage) ---------------- */
  /** URL des Regionsberichts, der am Tag `issue` (UTC) erschienen ist. */
  function srsArchiveUrl(issue) {
    const d = new Date(issue), y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), day = String(d.getUTCDate()).padStart(2, '0');
    return `${SRS_ARCHIVE}/${y}/${m}/${y}${m}${day}SRS.txt`;
  }
  /** Ausgabetage, deren Berichte für einen Zeitpunkt gebraucht werden (gültig 00 UT des Ausgabetags). */
  /* ---------------- Ereignis-Archiv (Flares, lückenlos seit 1996) ---------------- */
  const EVENTS_ARCHIVE = 'https://www.ngdc.noaa.gov/stp/space-weather/swpc-products/daily_reports/solar_event_reports';
  function eventsArchiveUrl(day) {
    const [y, m, d] = day.split('-');
    return `${EVENTS_ARCHIVE}/${y}/${m}/${y}${m}${d}events.txt`;
  }
  /**
   * Tagesliste "Edited Events" (YYYYMMDDevents.txt) -> Objekte im Format von edited_events.json
   * (nur Röntgen-Flares XRA und optische Flares FLA). day = 'YYYY-MM-DD'.
   */
  function parseEvents(text, day) {
    const lines = String(text).split(/\r?\n/);
    const head = lines.find((l) => /^#Event/.test(l)) || '';
    const regCol = head.indexOf('Reg#');
    const base = new Date(day + 'T00:00:00Z').getTime();
    const tm = (v, ref) => {
      const m = /(\d{2})(\d{2})/.exec(v || ''); if (!m || /\/\//.test(v)) return null;
      let t = base + (+m[1] * 60 + +m[2]) * 60000;
      if (ref != null && t < ref - 6 * 3600000) t += 86400000; // über Mitternacht
      return new Date(t).toISOString().slice(0, 19);
    };
    const out = [];
    for (const l of lines) {
      if (!l.trim() || /^[#:]/.test(l)) continue;
      const tok = l.trim().split(/\s+/);
      if (tok[1] === '+') tok.splice(1, 1);
      const [, b, mx, e, obs, q, type, loc, ...rest] = tok;
      if (type !== 'XRA' && type !== 'FLA') continue;
      const reg = regCol > 0 ? parseInt(l.slice(regCol).trim(), 10) : NaN;
      const part = rest.filter((x) => !(regCol > 0 && x === String(reg) && l.trimEnd().endsWith(x)));
      const begin = tm(b), bt = begin ? new Date(begin + 'Z').getTime() : base;
      out.push({ type, begin_datetime: begin, max_datetime: tm(mx, bt), end_datetime: tm(e, bt), observatory: obs, quality: q,
        location: type === 'FLA' ? loc : '', frequency: type === 'XRA' ? loc : null, particulars1: part[0] || '', particulars2: part[1] || null, region: Number.isFinite(reg) ? reg : null, source: 'archiv' });
    }
    return out;
  }

  function srsIssueDays(date) {
    const t = new Date(date), d0 = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    return [d0, new Date(d0.getTime() + 86400000)].map((d) => d.toISOString().slice(0, 10));
  }
  const MAGMAP = { alpha: 'A', beta: 'B', gamma: 'G', delta: 'D' };
  /** SRS-Textbericht -> Zeilen im Format von solar_regions.json. */
  function parseSRS(text, issueDay) {
    const lines = String(text).split(/\r?\n/);
    const observed = new Date(new Date(issueDay + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
    const rows = []; let sec = '';
    for (const l of lines) {
      if (/^I\.\s+Regions with Sunspots/i.test(l)) { sec = 'I'; continue; }
      if (/^IA\.\s+H-alpha Plages/i.test(l)) { sec = 'IA'; continue; }
      if (/^II\.\s/.test(l)) { sec = ''; continue; }
      const loc = (x) => { const m = /^([NS])(\d{2})([EW])(\d{2})$/.exec(x); return m ? { lat: (m[1] === 'N' ? 1 : -1) * +m[2], lon: (m[3] === 'E' ? 1 : -1) * +m[4] } : null; };
      let m;
      if (sec === 'I' && (m = /^(\d{4,5})\s+([NS]\d{2}[EW]\d{2})\s+(\d{3})\s+(\d{4})\s+([A-Z][a-z]{2})\s+(\d+)\s+(\d+)\s+([A-Za-z-]+)/.exec(l))) {
        const p = loc(m[2]); if (!p) continue;
        rows.push({ observed_date: observed, region: +m[1], latitude: p.lat, longitude: p.lon, location: m[2], carrington_longitude: +m[3], area: +m[4], spot_class: m[5], extent: +m[6], number_spots: +m[7],
          mag_class: m[8].toLowerCase().split('-').map((x) => MAGMAP[x] || '').join(''), status: null, first_date: null, source: 'archiv' });
      } else if (sec === 'IA' && (m = /^(\d{4,5})\s+([NS]\d{2}[EW]\d{2})\s+(\d{3})/.exec(l))) {
        const p = loc(m[2]); if (!p) continue;
        rows.push({ observed_date: observed, region: +m[1], latitude: p.lat, longitude: p.lon, location: m[2], carrington_longitude: +m[3], area: 0, spot_class: '', number_spots: 0, mag_class: '', status: null, source: 'archiv' });
      }
    }
    return rows;
  }

  /* ---------------- Flares mit Region und Ort ---------------- */
  /** Ereignisliste (edited_events.json) -> Flares mit Klasse, Region und Ort (aus optischer Beobachtung). */
  function flareEvents(events) {
    const z = (t) => (t ? new Date(t + (t.endsWith('Z') ? '' : 'Z')).getTime() : null);
    const xra = (events || []).filter((e) => e.type === 'XRA' && e.particulars1);
    const fla = (events || []).filter((e) => e.type === 'FLA' && e.location);
    return xra.map((e) => {
      const t = z(e.max_datetime) || z(e.begin_datetime);
      const opt = fla.filter((f) => (e.region ? f.region === e.region : true) && Math.abs((z(f.max_datetime) || z(f.begin_datetime)) - t) < 40 * 60000)
        .sort((a, b) => Math.abs(z(a.begin_datetime) - t) - Math.abs(z(b.begin_datetime) - t))[0];
      return { cls: e.particulars1.trim(), begin: z(e.begin_datetime), max: t, end: z(e.end_datetime), region: e.region || (opt && opt.region) || null, location: opt ? opt.location : null, optical: opt ? opt.particulars1 : null };
    }).sort((a, b) => b.max - a.max);
  }
  const flareRank = (cls) => { const m = /^([ABCMX])(\d+(?:\.\d+)?)/.exec(cls || ''); return m ? 'ABCMX'.indexOf(m[1]) * 10 + parseFloat(m[2]) : 0; };

  /* ---------------- Interessante Regionen ---------------- */
  function interestingReason(r) {
    const mag = String(r.magClass || '').toUpperCase(), z = r.spotClass ? r.spotClass[0] : '', p = r.spotClass ? r.spotClass[1] : '', c = r.spotClass ? r.spotClass[2] : '';
    const why = [];
    if (mag.includes('D')) why.push('δ-Magnetfeld');
    if ((r.area || 0) >= 300) why.push(`groß (${r.area} MH)`);
    if ('EF'.includes(z) && z && ('hk'.includes(p) || c === 'c')) why.push(`ausgedehnte Gruppe ${r.spotClass}`);
    if ((r.probs && r.probs.x) >= 10) why.push(`X-Flare-Chance ${r.probs.x} %`);
    else if ((r.probs && r.probs.m) >= 40) why.push(`M-Flare-Chance ${r.probs.m} %`);
    return why;
  }

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

  /** Stundenwerte eines bestimmten Tages (für das Seeing-Modell zur Aufnahmezeit). Ältere Tage: Open-Meteo-Archiv der Vorhersagen. */
  function weatherDayUrl(loc, date) {
    const day = new Date(date).toISOString().slice(0, 10);
    const old = Date.now() - new Date(date).getTime() > 80 * 86400000;
    const hourly = ['temperature_2m', 'soil_temperature_0cm', 'shortwave_radiation', 'wind_speed_10m', 'wind_gusts_10m', 'wind_speed_850hPa', 'wind_speed_500hPa', 'wind_speed_250hPa', 'wind_speed_200hPa'];
    return `https://${old ? 'historical-forecast-api' : 'api'}.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=${hourly.join(',')}&wind_speed_unit=ms&timezone=UTC&start_date=${day}&end_date=${day}`;
  }
  /** Unkalibriertes Modell-Seeing zu einem Zeitpunkt (lineare Interpolation zwischen den Stunden). */
  function modelSeeingAt(w, loc, date) {
    const H = w.hourly, t = new Date(date).getTime();
    const at = (i) => {
      if (i < 0 || i >= H.time.length || H.shortwave_radiation[i] == null) return null;
      const alt = astro.sunAltAz(new Date(t), loc.lat, loc.lon).alt;
      const s = seeingModel.estimate({ sw: H.shortwave_radiation[i], t2m: H.temperature_2m[i], tSoil: H.soil_temperature_0cm[i], wind10: H.wind_speed_10m[i], gust10: H.wind_gusts_10m[i], w850: H.wind_speed_850hPa[i], w500: H.wind_speed_500hPa[i], w250: H.wind_speed_250hPa[i], w200: H.wind_speed_200hPa[i], alt }, { surface: loc.surface });
      return s ? s.seeing : null;
    };
    // Stundenwerte der Einstrahlung gelten für die vorangegangene Stunde -> Stundenmitte
    const pos = (t - new Date(H.time[0] + ':00Z').getTime()) / 3600000 + 0.5;
    const i0 = Math.floor(pos), f = pos - i0, a = at(i0), b = at(i0 + 1);
    if (a == null) return b; if (b == null) return a;
    return a * (1 - f) + b * f;
  }

  function buildWeather(w, loc, ratings, nowMs = Date.now(), calibOverride = null) {
    const H = w.hourly;
    const calInfo = seeingModel.calibrationInfo(ratings || []);
    const calib = calibOverride > 0 ? calibOverride : calInfo.factor;
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
      calibrationInfo: calibOverride > 0 ? { factor: calibOverride, n: 0, source: 'manuell' } : calInfo,
    };
  }

  /* ---------------- Newsroom ---------------- */
  const fmtUTC = (t) => new Date(t).toISOString().slice(11, 16) + ' UTC';
  const fmtLocal = (t) => new Date(t).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  /** d = { flares[], kp[] (normalisiert), alerts[], regions[], ssn, flux, updated } */
  function buildNews(d, loc, nowMs = Date.now()) {
    const items = [], now = nowMs;
    const flares = d.flares || [];
    const evf = flareEvents(d.events);
    const origin = (f) => { const t = new Date(f.max_time || f.begin_time).getTime(); const e = evf.find((x) => x.cls === (f.max_class || '').trim() && Math.abs(x.max - t) < 8 * 60000) || evf.find((x) => Math.abs(x.max - t) < 4 * 60000); return e && e.region ? ` · aus AR ${e.region}${e.location ? ' (' + e.location + ')' : ''}` : ''; };
    for (const f of flares) {
      const t = new Date(f.max_time || f.begin_time).getTime(), cls = f.max_class || '';
      if (now - t > 72 * 3600000) continue;
      if (cls[0] === 'X' || cls[0] === 'M') {
        const r = cls[0] === 'X' ? (parseFloat(cls.slice(1)) >= 10 ? 'R4' : 'R3') : (parseFloat(cls.slice(1)) >= 5 ? 'R2' : 'R1');
        items.push({ level: cls[0] === 'X' ? 'bad' : 'warn', title: `${cls}-Flare`, detail: `Maximum ${fmtUTC(t)}${origin(f)} · Funkausfall ${r} auf der Tagseite`, time: t, kind: 'flare', cls });
      }
    }
    if (!items.some((i) => i.kind === 'flare')) {
      const c = flares.filter((f) => now - new Date(f.max_time).getTime() < 86400000).sort((a, b) => (b.max_xrlong || 0) - (a.max_xrlong || 0))[0];
      if (c) items.push({ level: 'ok', title: `Stärkster Flare 24 h: ${c.max_class}`, detail: `Maximum ${fmtUTC(new Date(c.max_time))}${origin(c)}`, time: new Date(c.max_time).getTime(), kind: 'flare' });
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

  /** Verständliche Erklärung zu einer Newsroom-Meldung: { title, sections: [{h, p}] } */
  function newsStory(i) {
    const S = [];
    if (i.kind === 'flare') {
      const cls = (i.cls || i.title.replace(/^.*?([ABCMX]\d+(?:\.\d+)?).*$/, '$1')).trim(), L = cls[0];
      S.push({ h: 'Was ist passiert?', p: `Auf der Sonne gab es einen Flare – einen plötzlichen Strahlungsausbruch, bei dem sich verdrehte Magnetfelder schlagartig entladen. Er dauert meist nur Minuten bis eine Stunde.` });
      S.push({ h: `Wie stark war ${cls}?`, p: L === 'X' ? 'X ist die stärkste Klasse. Solche Flares sind selten und können auf der Tagseite der Erde den Kurzwellenfunk weiträumig stören. Oft folgt ein Auswurf von Sonnenmaterie (CME).' : L === 'M' ? 'M ist die mittlere Klasse (10× schwächer als X). Auf der Tagseite der Erde kann Kurzwellenfunk kurz gestört werden. Ab etwa M5 gilt ein Flare als stark.' : 'C ist eine kleine Klasse – für die Erde ohne Folgen, aber im H-Alpha-Licht als kurzes Aufhellen sichtbar.' });
      S.push({ h: 'Was bedeutet das für mich?', p: L === 'X' || L === 'M' ? 'Für dich am Boden ungefährlich. Interessant: Der Flare ist im H-Alpha-Licht als helles Aufleuchten in der Region zu sehen. Falls ein Massenauswurf die Erde trifft, sind 1–3 Tage später Polarlichter möglich – Solux meldet das.' : 'Keine Auswirkungen – ein Zeichen, dass die Region aktiv ist.' });
    } else if (i.kind === 'aurora') {
      S.push({ h: 'Was heißt das?', p: 'Das Erdmagnetfeld ist (bald) so stark gestört, dass Polarlichter bis nach Mitteleuropa reichen können. Auslöser sind meist Wolken aus Sonnenmaterie (CME) oder schneller Sonnenwind.' });
      S.push({ h: 'Wie sehe ich sie?', p: 'Bei klarem, dunklem Himmel nach Norden schauen, am besten zwischen 22 und 2 Uhr und abseits von Straßenlicht. Mit bloßem Auge oft nur als fahler Schimmer – eine Handykamera im Nachtmodus zeigt die Farben deutlich.' });
      S.push({ h: 'Wie sicher ist das?', p: 'Der Kp-Wert ist eine Vorhersage für 3-Stunden-Abschnitte. Die tatsächliche Stärke kann abweichen – es lohnt sich, mehrmals rauszuschauen.' });
    } else if (i.kind === 'kp') {
      S.push({ h: 'Was heißt das?', p: 'Der Kp-Index misst die Unruhe des Erdmagnetfelds von 0 (ruhig) bis 9 (extremer Sturm). ' + (i.level === 'ok' ? 'Gerade ist es ruhig – keine Polarlichter in Mitteleuropa zu erwarten.' : 'Ein geomagnetischer Sturm ist möglich; an deinem Standort reicht es für Polarlichter aber voraussichtlich noch nicht.') });
    } else if (i.kind === 'region') {
      S.push({ h: 'Was ist passiert?', p: `${i.title.replace('Neue Region ', '')} hat eine neue Nummer bekommen. ${/E[6-9]\d/.test(i.detail) ? 'Sie ist am Ostrand ins Blickfeld gedreht – die Sonne dreht sich in etwa 27 Tagen einmal um sich selbst.' : 'Sie ist mitten auf der Scheibe neu entstanden – ein Zeichen frischer magnetischer Aktivität.'}` });
      S.push({ h: 'Lohnt sich ein Blick?', p: 'Neue Regionen verändern sich oft schnell. Ein Foto heute und in ein paar Tagen zeigt schön, wie Flecken wachsen oder zerfallen.' });
    } else if (i.kind === 'alert') {
      const d = i.detail || '';
      let what = 'Das US-Weltraumwetterzentrum (NOAA SWPC) hat eine Meldung herausgegeben.';
      if (/Electron 2MeV/i.test(d)) what = 'Viele schnelle Elektronen im Strahlungsgürtel der Erde. Das betrifft nur Satelliten (Aufladung), nicht die Beobachtung am Boden.';
      else if (/K-index|Geomagnetic Storm/i.test(d)) what = 'Das Erdmagnetfeld ist gestört oder wird es bald sein. Je höher Kp bzw. die G-Stufe, desto eher sind Polarlichter möglich.';
      else if (/Proton/i.test(d)) what = 'Energiereiche Protonen von der Sonne erreichen die Erde – relevant für Raumfahrt, Satelliten und Polarflüge, nicht für Beobachter am Boden.';
      else if (/Type II/i.test(d)) what = 'Ein Radioburst vom Typ II zeigt eine Stoßwelle in der Sonnenkorona – meist ein Zeichen für einen Massenauswurf (CME).';
      else if (/Type IV/i.test(d)) what = 'Ein Radioburst vom Typ IV begleitet oft große Flares mit Massenauswurf.';
      else if (/X-ray Flux/i.test(d)) what = 'Die Röntgenstrahlung der Sonne ist stark angestiegen – ein großer Flare läuft.';
      else if (/Sudden Impulse/i.test(d)) what = 'Eine Stoßwelle im Sonnenwind ist an der Erde angekommen – oft der Beginn eines geomagnetischen Sturms.';
      S.push({ h: 'Was bedeutet das?', p: what });
      S.push({ h: 'Originalmeldung', p: d });
    } else S.push({ h: 'Info', p: i.detail || '' });
    return { title: i.title, sections: S };
  }

  /**
   * Push-Mitteilungen bestimmen (gemeinsam für Mac und Handy).
   * mode: 'alle' | 'interessant' | 'aus'. Schlüssel enthalten das Datum, damit jede Region/Meldung
   * höchstens einmal pro Tag kommt – neue Ereignisse (Flares) haben eigene Schlüssel.
   */
  function pushMessages(news, regions, mode, nowMs = Date.now()) {
    if (mode === 'aus') return [];
    const day = new Date(nowMs).toISOString().slice(0, 10), out = [];
    for (const i of news.items || []) {
      if (nowMs - i.time > 6 * 3600000 && i.kind !== 'aurora' && i.kind !== 'kp') continue;
      const strong = pushWorthy(i);
      if (!strong && mode !== 'alle') continue;
      if (mode === 'alle' && i.level === 'ok' && i.kind !== 'region') continue; // „Magnetfeld ruhig“ u. Ä. nicht melden
      const key = i.kind === 'flare' ? `flare|${i.title}|${new Date(i.time).toISOString().slice(0, 16)}` : `${i.kind}|${i.title}|${day}`;
      out.push({ key, title: `Solux · ${i.title}`, body: i.detail, kind: i.kind });
    }
    for (const r of regions || []) {
      if (r.type !== 'spots' || Math.abs(r.x) > 0.95) continue; // nur gut sichtbare Gruppen
      const why = interestingReason(r);
      if (!why.length) continue;
      out.push({ key: `region|${r.region}|${day}`, title: `Solux · AR ${r.region} lohnt sich`, body: `${why.join(', ')} – gut sichtbar bei ${r.location}.`, kind: 'region-hot' });
    }
    return out;
  }

  /** Ist eine Meldung „brisant“ genug für eine Push-Mitteilung? */
  function pushWorthy(item) {
    if (item.kind === 'aurora') return true;
    if (item.kind === 'flare') return /^X/.test(item.title) || /^M([5-9]|\d{2})/.test(item.title);
    if (item.kind === 'alert') return item.level === 'bad';
    return false;
  }
  /** Schlüssel zum Erkennen bereits gemeldeter Ereignisse. */
  function pushKey(item) {
    const t = new Date(item.time).toISOString();
    return `${item.kind}|${item.title}|${item.kind === 'aurora' ? t.slice(0, 10) : t.slice(0, 13)}`;
  }

  const api = { EVENTS_ARCHIVE, eventsArchiveUrl, parseEvents, newsStory, pushMessages, interestingReason, flareEvents, flareRank, parseSRS, srsArchiveUrl, srsIssueDays, SRS_ARCHIVE, pushWorthy, pushKey, SWPC, HV, SOURCES, IMG_SIZE, DISC_FRACTION, SWPC_URLS, closestImageUrl, screenshotUrl, normKp, computeRegions, regionHistory, weatherUrl, weatherDayUrl, modelSeeingAt, buildWeather, buildNews, translateAlert };
  if (isNode) module.exports = api; else root.SoluxSW = api;
})(typeof self !== 'undefined' ? self : this);
