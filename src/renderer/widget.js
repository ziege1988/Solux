/* Solux – Widget „Sonne“ */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const A = window.SoluxAstro, M = window.SoluxMcIntosh, S = window.SoluxSeeing, U = window.SoluxUI;
  const { fmt, esc } = U;
  const api = window.solux;

  const WEB = api.platform === 'web';
  const state = { cfg: null, kind: 'wl', sun: null, sunCanvas: null, regions: [], weather: null, news: null, update: null, labelHits: [] };

  /* ---------------- Start ---------------- */
  async function init() {
    state.cfg = await api.getConfig();
    state.kind = state.cfg.widget.kind || 'wl';
    setKindButtons();
    tick(); setInterval(tick, 1000);
    drawAltitude(); setInterval(drawAltitude, 60000);
    loadSun(); setInterval(loadSun, 15 * 60000);
    loadWeather(); setInterval(loadWeather, 15 * 60000);
    loadNews();
    api.on('data-updated', async () => { state.cfg = await api.getConfig(); loadNews(); loadRegions(); drawAltitude(); loadWeather(); });
    api.on('show-settings', (sec) => openSettings(sec || 'allg'));
    api.on('update-available', (info) => { state.update = info; $('#updDot').hidden = false; });
    api.on('recordings-opened', () => setTab('rec'));
    api.on('recordings-closed', () => setTab('sun'));
  }

  function setTab(t) { $('#tabSun').classList.toggle('on', t === 'sun'); $('#tabRec').classList.toggle('on', t === 'rec'); }
  $('#tabRec').addEventListener('click', () => api.openRecordings());
  $('#tabSun').addEventListener('click', () => { closePops(); setTab('sun'); });
  $('#quitBtn').addEventListener('click', () => api.quit());

  /* ---------------- Uhr ---------------- */
  function tick() {
    const d = new Date();
    $('#nowDate').textContent = fmt.date.format(d);
    $('#nowTime').textContent = fmt.time.format(d);
  }

  /* ---------------- Sonnenbild ---------------- */
  function setKindButtons() {
    document.querySelectorAll('#kindSeg button').forEach((b) => b.classList.toggle('on', b.dataset.k === state.kind));
    document.body.classList.toggle('kind-ca', state.kind === 'ca');
    $('#arHead').textContent = state.kind === 'ca' ? 'Regionen & Plages' : 'Fleckengruppen';
  }
  $('#kindSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.k === state.kind) return;
    state.kind = b.dataset.k; setKindButtons(); api.setConfig({ widget: { kind: state.kind } }); loadSun();
  });

  let sunReq = 0;
  async function loadSun() {
    const my = ++sunReq;
    $('#sunLoad').hidden = false; $('#sunLoad').textContent = 'Lade Sonnenbild …';
    try {
      const sun = await api.sunImage(state.kind);
      if (my !== sunReq) return;
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = sun.dataUrl || sun.url; });
      state.sun = sun;
      state.sunCanvas = sun.dataUrl ? U.colorizeSun(img, state.kind, 560, sun.radiusPx) : U.tintSun(img, state.kind, 560, sun.radiusPx);
      $('#sunLoad').hidden = true;
      const d = new Date(sun.date);
      $('#capDate').textContent = fmt.utcDate(d);
      $('#capTime').textContent = fmt.utcHM(d);
      $('#capTime').title = 'Ortszeit ' + fmt.hm.format(d);
      $('#capSrc').textContent = sun.label;
      await loadRegions();
    } catch (e) {
      if (my !== sunReq) return;
      $('#sunLoad').hidden = false; $('#sunLoad').textContent = 'Sonnenbild nicht erreichbar – erneuter Versuch in 15 min';
      if (!state.sunCanvas) drawSunCanvas();
    }
  }

  async function loadRegions() {
    const when = state.sun ? new Date(state.sun.date) : new Date();
    const r = await api.regions(when.toISOString());
    state.regions = r.regions || [];
    drawSunCanvas();
    renderRegionList();
    const o = A.solarOrientation(when);
    $('#ephem').innerHTML = `P ${o.P >= 0 ? '+' : ''}${fmt.num(o.P)}° · B₀ ${o.B0 >= 0 ? '+' : ''}${fmt.num(o.B0, 2)}°<br>L₀ ${fmt.num(o.L0)}° · CR ${A.carringtonRotation(when)}`;
  }

  function drawSunCanvas(highlight = null) {
    const cv = $('#sunCv'), x = cv.getContext('2d'), W = cv.width;
    x.clearRect(0, 0, W, W); x.fillStyle = '#000'; x.fillRect(0, 0, W, W);
    if (state.sunCanvas) x.drawImage(state.sunCanvas, 0, 0, W, W);
    if (!state.sun) return;
    const c = W / 2, R = state.sun.radiusPx * (W / state.sun.size);
    state.labelHits = [];
    x.font = `500 ${Math.round(W * 0.03)}px ${getComputedStyle(document.body).getPropertyValue('--f-mono')}`;
    x.textBaseline = 'middle';
    const accent = state.kind === 'ca' ? '#d9c2ff' : '#f3b544';
    const placed = [];
    for (const r of state.regions) {
      if (r.type !== 'spots' && state.kind !== 'ca') continue;
      const px = c + r.x * R, py = c - r.y * R;
      // Beschriftung nach außen versetzt, Überlappungen vermeiden
      const ang = Math.atan2(r.y || 0.001, r.x || 0.001);
      let lx = px + Math.cos(ang) * R * 0.1, ly = py - Math.sin(ang) * R * 0.1;
      const txt = String(r.region);
      const tw = x.measureText(txt).width;
      for (let k = 0; k < 6 && placed.some((p) => Math.abs(p.x - lx) < tw + 4 && Math.abs(p.y - ly) < W * 0.035); k++) ly += W * 0.035 * (r.y > 0 ? -1 : 1);
      placed.push({ x: lx, y: ly });
      const hl = highlight === r.region;
      x.strokeStyle = hl ? '#fff' : r.type === 'spots' ? accent : 'rgba(180,140,255,.7)'; x.lineWidth = hl ? 2 : 1;
      x.globalAlpha = r.type === 'spots' ? 1 : 0.8;
      x.beginPath(); x.moveTo(px + (lx - px) * 0.35, py + (ly - py) * 0.35); x.lineTo(lx, ly); x.stroke();
      x.fillStyle = hl ? '#fff' : r.type === 'spots' ? accent : '#b48cff';
      const left = lx < px;
      const tx = Math.max(2, Math.min(W - tw - 2, left ? lx - tw - 3 : lx + 3));
      x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,.8)'; x.lineJoin = 'round'; x.strokeText(txt, tx, ly);
      x.fillText(txt, tx, ly);
      x.globalAlpha = 1;
      state.labelHits.push({ region: r.region, x0: Math.min(tx, px) - 6, x1: Math.max(tx + tw, px) + 6, y0: Math.min(ly, py) - 10, y1: Math.max(ly, py) + 10 });
    }
  }

  $('#sunCv').addEventListener('click', (e) => {
    const cv = e.currentTarget, rect = cv.getBoundingClientRect();
    const X = ((e.clientX - rect.left) / rect.width) * cv.width, Y = ((e.clientY - rect.top) / rect.height) * cv.height;
    const hit = state.labelHits.find((h) => X >= h.x0 && X <= h.x1 && Y >= h.y0 && Y <= h.y1);
    if (hit) showRegion(hit.region);
  });

  function renderRegionList() {
    const list = state.regions.filter((r) => r.type === 'spots' || state.kind === 'ca');
    if (!list.length) { $('#arList').innerHTML = `<li class="note">${state.regions.length ? 'nur fleckenfreie Plages' : 'keine nummerierten Gruppen'}</li>`; return; }
    $('#arList').innerHTML = list.map((r) => `<li><button class="arbtn ${r.type}" data-r="${r.region}" title="Erklärung zu AR ${r.region}"><b>${r.region}</b><span>${esc(r.spotClass || 'Plage')}</span><em>${esc(M.magSymbol(r.magClass) || '–')} · ${esc(r.location)}</em></button></li>`).join('');
  }
  $('#arList').addEventListener('click', (e) => { const b = e.target.closest('.arbtn'); if (b) showRegion(+b.dataset.r); });
  $('#arList').addEventListener('mouseover', (e) => { const b = e.target.closest('.arbtn'); drawSunCanvas(b ? +b.dataset.r : null); });
  $('#arList').addEventListener('mouseleave', () => drawSunCanvas());

  /* ---------------- Erklärung einer Region ---------------- */
  async function showRegion(num) {
    const r = state.regions.find((x) => x.region === num); if (!r) return;
    const d = M.decode(r.spotClass, r.magClass);
    const risk = M.riskOf(r.spotClass, r.magClass, r.probs);
    const hist = await api.regionHistory(num);
    const maxA = Math.max(10, ...hist.map((h) => h.area || 0));
    const bars = hist.map((h) => `<div title="${h.day}: ${h.cls} ${h.area} MH" style="flex:1;align-self:flex-end;height:${Math.max(4, ((h.area || 0) / maxA) * 46)}px;background:${h.mag && h.mag.includes('D') ? 'var(--bad)' : 'var(--sun)'};opacity:.8;border-radius:2px"></div>`).join('');
    const firstSeen = r.firstDate ? fmt.dateShort.format(new Date(r.firstDate + 'Z')) : '–';
    openPop(`
      <div class="hd"><div><span class="lbl">NOAA Active Region</span><h2>AR ${r.region}</h2></div><button class="xbtn" data-close aria-label="Schließen">×</button></div>
      ${r.spotClass ? `<div style="display:flex;gap:16px;align-items:baseline;flex-wrap:wrap"><span class="code">${esc(r.spotClass)}</span><span class="note">Mt. Wilson ${esc(M.magSymbol(r.magClass) || '–')} · ${esc(r.location)} · ${r.area ?? '–'} MH · ${r.numberSpots ?? '–'} Flecken</span></div>` : `<p>Plage-Gebiet ohne Flecken (nur im Kalziumlicht hell) · ${esc(r.location)}</p>`}
      ${d.parts.length || d.mag.length ? `<dl class="decode">${d.parts.map((p) => `<dt>${p.key}</dt><dd>${p.title}<small>${esc(p.text)}</small></dd>`).join('')}${d.mag.map((m) => `<dt>${m.key}</dt><dd>${m.title}<small>${esc(m.text)}</small></dd>`).join('')}</dl>` : ''}
      ${r.spotClass ? `<div class="box"><b class="lv-${risk.level}">Flare-Potenzial: ${risk.label}</b><br>${risk.text}<br><span class="note">NOAA-Wahrscheinlichkeit 24 h: C ${r.probs.c ?? '–'} % · M ${r.probs.m ?? '–'} % · X ${r.probs.x ?? '–'} %</span></div>` : ''}
      ${hist.length > 1 ? `<div><span class="lbl">Entwicklung der Fläche</span><div style="display:flex;gap:2px;height:50px;margin-top:6px">${bars}</div><div class="note" style="display:flex;justify-content:space-between"><span>${hist[0].day.slice(5)}</span><span>${hist[hist.length - 1].day.slice(5)}</span></div></div>` : ''}
      <div class="kv"><span>Erstmals gesehen</span><span>${firstSeen}</span><span>Flares am Vortag</span><span>${r.flares.c}× C · ${r.flares.m}× M · ${r.flares.x}× X</span><span>Carrington-Länge</span><span>${r.carrLon}°</span></div>
      <p class="note">MH = millionstel Sonnenhemisphäre. Daten: NOAA SWPC.</p>`);
  }

  /* ---------------- Sonnenhöhe ---------------- */
  function drawAltitude() {
    if (!state.cfg) return;
    const { lat, lon, name } = state.cfg.location;
    const svg = $('#altSvg'), W = 420, H = 140, pl = 30, pr = 8, pt = 10, pb = 18, ymin = -10, ymax = 70;
    const now = new Date(), y0 = now.getFullYear();
    const X = (h) => pl + ((W - pl - pr) * h) / 24, Y = (a) => pt + ((H - pt - pb) * (ymax - Math.max(ymin, Math.min(ymax, a)))) / (ymax - ymin);
    const curve = (day) => { let p = ''; for (let m = 0; m <= 1440; m += 10) { const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m); p += (m ? 'L' : 'M') + X(m / 60).toFixed(1) + ',' + Y(A.sunAltAz(d, lat, lon).alt).toFixed(1); } return p; };
    const ev = A.seasonEvents(y0);
    const today = new Date(y0, now.getMonth(), now.getDate());
    let maxA = -90, maxH = 0, rise = null, set = null, prev = null;
    for (let m = 0; m <= 1440; m += 2) {
      const a = A.sunAltAz(new Date(y0, now.getMonth(), now.getDate(), 0, m), lat, lon).alt;
      if (a > maxA) { maxA = a; maxH = m / 60; }
      if (prev != null && prev < -0.833 && a >= -0.833) rise = m / 60;
      if (prev != null && prev >= -0.833 && a < -0.833) set = m / 60;
      prev = a;
    }
    const cur = A.sunAltAz(now, lat, lon).alt, hn = now.getHours() + now.getMinutes() / 60;
    const hm = (h) => (h == null ? '–' : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`);
    let g = '';
    for (const a of [0, 20, 40, 60]) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(a)}" y2="${Y(a)}" stroke="${a ? '#1c1c20' : '#3a3a40'}"/><text x="${pl - 5}" y="${Y(a) + 3}" fill="#5f5b56" font-size="9" text-anchor="end" font-family="Menlo, monospace">${a}°</text>`;
    for (const h of [0, 6, 12, 18, 24]) g += `<text x="${X(h)}" y="${H - 5}" fill="#5f5b56" font-size="9" text-anchor="middle" font-family="Menlo, monospace">${String(h).padStart(2, '0')}</text>`;
    g += `<path d="${curve(ev[1].date)}" fill="none" stroke="#f3b544" stroke-opacity=".3" stroke-dasharray="3 3"/>`;
    g += `<path d="${curve(ev[3].date)}" fill="none" stroke="#7fa7d9" stroke-opacity=".4" stroke-dasharray="3 3"/>`;
    const tp = curve(today);
    g += `<clipPath id="above"><rect x="0" y="0" width="${W}" height="${Y(0)}"/></clipPath><path d="${tp}L${X(24)},${Y(0)}L${X(0)},${Y(0)}Z" fill="#f3b544" fill-opacity=".14" clip-path="url(#above)"/>`;
    g += `<path d="${tp}" fill="none" stroke="#f3b544" stroke-width="2"/>`;
    g += `<line x1="${X(hn)}" x2="${X(hn)}" y1="${pt}" y2="${H - pb}" stroke="#ece8e1" stroke-opacity=".25"/>`;
    g += `<circle cx="${X(hn)}" cy="${Y(cur)}" r="5" fill="${cur > 0 ? '#ffd77a' : '#3a3a40'}" stroke="#000" stroke-width="2"/>`;
    g += `<text x="${W - pr}" y="${pt + 7}" fill="#ece8e1" font-size="10.5" text-anchor="end" font-weight="600">jetzt ${fmt.num(cur)}° · max ${fmt.num(maxA)}° um ${hm(maxH)}</text>`;
    g += `<text x="${W - pr}" y="${pt + 19}" fill="#8e8a83" font-size="9.5" text-anchor="end">Aufgang ${hm(rise)} · Untergang ${hm(set)}</text>`;
    g += `<text x="${pl + 4}" y="${pt + 7}" fill="#f3b544" fill-opacity=".65" font-size="9">Sommer ${fmt.dateShort.format(ev[1].date).slice(0, 6)}</text><text x="${pl + 4}" y="${pt + 18}" fill="#7fa7d9" fill-opacity=".8" font-size="9">Winter ${fmt.dateShort.format(ev[3].date).slice(0, 6)}</text>`;
    svg.innerHTML = g;
    const s = A.currentSeason(now);
    $('#season').innerHTML = `<span>${s.season} · ${esc(name)}</span><span>${s.daysToNext} Tage bis ${s.next.name}</span>`;
  }

  /* ---------------- Wetter / Seeing / Wind ---------------- */
  async function loadWeather() {
    try {
      state.weather = await api.weather();
      renderStatus();
    } catch (e) {
      for (const id of ['#stWeather', '#stSeeing', '#stWind']) { const b = $(id); b.className = 'st off'; b.querySelector('small').textContent = 'offline'; }
    }
  }

  function weatherLevel(c) {
    if (c.precip > 0.05) return ['bad', 'Niederschlag'];
    if (c.cloud < 20) return ['ok', `klar · ${Math.round(c.cloud)} %`];
    if (c.cloud <= 70) return ['warn', `Sonne/Wolken · ${Math.round(c.cloud)} %`];
    return ['bad', `bedeckt · ${Math.round(c.cloud)} %`];
  }
  function windLevel(c) {
    const v = Math.max(c.wind, (c.gust || 0) * 0.6);
    if (v < 1.6) return ['ok', `windstill · ${fmt.num(c.wind)} m/s`];
    if (v <= 5.4) return ['warn', `leicht · ${fmt.num(c.wind)} m/s`];
    return ['bad', `windig · ${fmt.num(c.wind)} m/s`];
  }
  function renderStatus() {
    const w = state.weather, c = w.current;
    const set = (id, [lv, txt]) => { const b = $(id); b.className = 'st ' + lv; b.querySelector('small').textContent = txt; };
    set('#stWeather', weatherLevel(c));
    set('#stWind', windLevel(c));
    if (w.seeing && w.seeing.value != null) {
      const r = S.rating(w.seeing.value);
      set('#stSeeing', [w.seeing.isForecast ? 'off' : r.level, `${r.label} · ${fmt.num(w.seeing.value)}″${w.seeing.isForecast ? ' (Prog.)' : ''}`]);
    } else set('#stSeeing', ['off', 'keine Daten']);
  }

  document.querySelectorAll('.st').forEach((b) => b.addEventListener('click', () => showStatus(b.dataset.k)));

  function hourCells(key, f) {
    const hrs = (state.weather.hours || []).filter((h, i) => i % 1 === 0).slice(0, 7);
    return `<div class="hours">${hrs.map((h) => `<div><span class="note">${fmt.hm.format(new Date(h.time)).slice(0, 2)} h</span><b class="${f(h)[0] ? 'lv-' + f(h)[0] : ''}">${f(h)[1]}</b></div>`).join('')}</div>`;
  }

  function showStatus(k) {
    const w = state.weather;
    if (!w) return;
    const c = w.current;
    let html = '';
    if (k === 'weather') {
      html = `<div class="hd"><h2>Wetter</h2><button class="xbtn" data-close aria-label="Schließen">×</button></div>
        <div class="kv"><span>Bewölkung</span><span>${Math.round(c.cloud)} %</span><span>Niederschlag</span><span>${fmt.num(c.precip)} mm</span><span>Temperatur</span><span>${fmt.num(c.temp)} °C</span></div>
        <span class="lbl">Bewölkung nächste Stunden</span>${hourCells('cloud', (h) => [h.precip > 0.05 ? 'bad' : h.cloud < 20 ? 'ok' : h.cloud <= 70 ? 'warn' : 'bad', Math.round(h.cloud) + '%'])}
        <p class="note">Grün = klar (&lt; 20 %), Orange = Sonne/Wolken-Mix, Rot = bedeckt oder Niederschlag. Quelle: Open-Meteo.</p>`;
    } else if (k === 'wind') {
      html = `<div class="hd"><h2>Wind</h2><button class="xbtn" data-close aria-label="Schließen">×</button></div>
        <div class="kv"><span>Mittelwind</span><span>${fmt.num(c.wind)} m/s aus ${Math.round(c.windDir)}°</span><span>Böen</span><span>${fmt.num(c.gust)} m/s</span></div>
        <span class="lbl">Wind nächste Stunden (m/s)</span>${hourCells('wind', (h) => [h.wind < 1.6 ? 'ok' : h.wind <= 5.4 ? 'warn' : 'bad', fmt.num(h.wind)])}
        <p class="note">Grün = windstill (&lt; 1,6 m/s, 0–1 Bft), Orange = leichter Wind (bis 5,4 m/s, 2–3 Bft), Rot = darüber. Böen fließen mit ein.</p>`;
    } else {
      const s = w.seeing;
      const best = w.best ? `${fmt.hm.format(new Date(w.best.from))}–${fmt.hm.format(new Date(w.best.to))} (≈ ${fmt.num(w.best.seeing)}″)` : 'heute kein klares Fenster';
      html = `<div class="hd"><h2>Seeing</h2><button class="xbtn" data-close aria-label="Schließen">×</button></div>
        ${s ? `<div class="kv"><span>${s.isForecast ? 'Prognose ' + fmt.hm.format(new Date(s.at)) : 'Jetzt'}</span><span><b>${fmt.num(s.value)}″</b> · r₀ ≈ ${fmt.num(s.r0)} cm</span>
        <span>Bodenschicht</span><span>${fmt.num(s.parts.ground, 2)}″</span><span>Freie Atmosphäre</span><span>${fmt.num(s.parts.free, 2)}″</span><span>Jetstream</span><span>${fmt.num(s.parts.upper, 2)}″ (${fmt.num(s.jet, 0)} m/s)</span>
        <span>Bestes Fenster</span><span>${best}</span></div>` : '<p>Keine Daten.</p>'}
        <span class="lbl">Seeing nächste Stunden (″)</span>${hourCells('seeing', (h) => (h.seeing == null ? ['off', '–'] : [S.rating(h.seeing).level, fmt.num(h.seeing)]))}
        <div class="box"><b>Wie war das Seeing gerade?</b><br><span class="note">Deine Bewertung kalibriert das Modell auf deinen Hof (Faktor jetzt ×${fmt.num(w.calibration, 2)}).</span>
        <div class="rate" id="rate" style="margin-top:6px"><button data-r="1">1 sehr ruhig</button><button data-r="2">2 ruhig</button><button data-r="3">3 mittel</button><button data-r="4">4 unruhig</button><button data-r="5">5 sehr unruhig</button></div></div>
        <p class="note">Schätzung aus Sonneneinstrahlung, Boden-/Lufttemperatur, Wind, Windscherung und Jetstream (Open-Meteo) sowie der Sonnenhöhe. Grün &lt; 2″, Orange 2–3,5″, Rot darüber.</p>`;
    }
    openPop(html);
    const rate = $('#rate');
    if (rate) rate.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b || !w.seeing) return;
      const cal = await api.rateSeeing(+b.dataset.r, w.seeing.value / (w.calibration || 1));
      rate.outerHTML = `<p class="note" style="margin-top:6px">Danke – Kalibrierfaktor jetzt ×${fmt.num(cal, 2)}.</p>`;
      loadWeather();
    });
  }

  /* ---------------- Newsroom ---------------- */
  async function loadNews() {
    try {
      const n = await api.news();
      state.news = n;
      $('#newsList').innerHTML = n.items.length ? n.items.map((i) => `<div class="news"><i class="${i.level}"></i><p>${esc(i.title)}<small>${esc(i.detail)}</small></p><time>${fmt.ago(i.time)}</time></div>`).join('') : '<p class="note">Keine aktuellen Meldungen.</p>';
      $('#newsMeta').textContent = n.updated ? 'Stand ' + fmt.hm.format(new Date(n.updated)) : '';
      $('#footInfo').textContent = `SN ${n.ssn ?? '–'} · F10.7 ${n.flux ?? '–'} · NASA SDO · NOAA SWPC · Open-Meteo`;
    } catch { /* offline */ }
  }

  /* ---------------- Popups ---------------- */
  function openPop(html) { $('#setPop').hidden = true; const p = $('#pop'); p.innerHTML = html; p.hidden = false; p.scrollTop = 0; }
  function closePops() { $('#pop').hidden = true; $('#setPop').hidden = true; }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closePops(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePops(); });

  /* ---------------- Einstellungen ---------------- */
  $('#gearBtn').addEventListener('click', () => ($('#setPop').hidden ? openSettings(WEB ? 'ort' : 'allg') : closePops()));
  $('#setNav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) openSettings(b.dataset.s); });

  const SURF = S.SURFACES;
  const SECTIONS = {
    allg: (c) => `<h3>Allgemein</h3>
      <label class="chk"><input type="checkbox" data-p="general.openAtLogin" ${c.general.openAtLogin ? 'checked' : ''}> Bei Anmeldung starten</label>
      <label class="chk"><input type="checkbox" data-p="widget.alwaysOnTop" ${c.widget.alwaysOnTop ? 'checked' : ''}> Immer im Vordergrund</label>
      <label class="chk"><input type="checkbox" data-p="widget.showSplash" ${c.widget.showSplash ? 'checked' : ''}> Startbild beim Öffnen zeigen</label>
      <div class="field"><label for="opa">Deckkraft ${Math.round(c.widget.opacity * 100)} %</label><input id="opa" type="range" min="0.5" max="1" step="0.05" value="${c.widget.opacity}" data-p="widget.opacity" data-num></div>
      <div class="field"><label for="scl">Größe</label><select id="scl" data-p="widget.scale" data-num>${[0.85, 1, 1.15, 1.3].map((v) => `<option value="${v}" ${c.widget.scale === v ? 'selected' : ''}>${Math.round(v * 100)} %</option>`).join('')}</select></div>
      <button class="ghost" id="hideW" style="align-self:flex-start">Widget ausblenden (Menüleiste ☀︎)</button>
      <p class="note">Solux läuft im Hintergrund weiter und ist über das Sonnensymbol in der Menüleiste erreichbar.</p>`,
    ort: (c) => `<h3>Standort</h3>
      ${WEB ? '<button class="ghost" id="gpsBtn" style="align-self:flex-start">Aktuellen Standort verwenden</button>' : ''}
      <div class="field"><label for="locq">Ort suchen</label><div style="display:flex;gap:6px"><input class="inp" id="locq" value="${esc(c.location.name)}"><button class="ghost" id="locBtn">Suchen</button></div></div>
      <div class="results" id="locRes"></div>
      <div class="row2"><div class="field"><label for="lat">Breite °N</label><input id="lat" type="number" step="0.0001" value="${c.location.lat}" data-p="location.lat" data-num></div>
      <div class="field"><label for="lon">Länge °E</label><input id="lon" type="number" step="0.0001" value="${c.location.lon}" data-p="location.lon" data-num></div></div>
      <div class="row2"><div class="field"><label for="ele">Höhe m</label><input id="ele" type="number" value="${c.location.elevation}" data-p="location.elevation" data-num></div>
      <div class="field"><label for="mnt">Montierung</label><select id="mnt" data-p="location.mount"><option value="altaz" ${c.location.mount === 'altaz' ? 'selected' : ''}>azimutal</option><option value="eq" ${c.location.mount === 'eq' ? 'selected' : ''}>parallaktisch</option></select></div></div>
      <div class="field"><label for="srf">Untergrund am Teleskop (für Seeing)</label><select id="srf" data-p="location.surface">${Object.entries(SURF).map(([k, v]) => `<option value="${k}" ${c.location.surface === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <p class="note">Koordinaten bleiben auf ${WEB ? 'diesem Gerät' : 'deinem Mac'} und werden nur für Wetterabfragen (Open-Meteo) genutzt.</p>`,
    daten: (c) => `<h3>Daten &amp; Quellen</h3>
      <div class="field"><label for="ref">Aktualisierung</label><select id="ref" data-p="data.refreshMinutes" data-num>${[10, 15, 30, 60].map((v) => `<option value="${v}" ${c.data.refreshMinutes === v ? 'selected' : ''}>alle ${v} Minuten</option>`).join('')}</select></div>
      <div class="box" id="storeBox">Lade Speicherinfo …</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ghost" id="refNow">Jetzt aktualisieren</button>${WEB ? '' : '<button class="ghost" id="clrImg">Bild-Zwischenspeicher leeren</button><button class="ghost" id="logBtn">Protokoll zeigen</button>'}</div>
      <p class="note">Sonnenbilder: NASA SDO über Helioviewer · Regionen, Flares, Kp, Meldungen: NOAA SWPC${WEB ? ' (ca. 30 Tage online)' : ' (lokal 60 Tage gesammelt)'} · Wetter: Open-Meteo.</p>
      ${WEB ? `<p class="note">Solux mobil ${esc(c.version)} · aktualisiert sich automatisch beim Öffnen.</p>` : ''}`,
    aufn: (c) => `<h3>Aufnahmen</h3>
      <div class="field"><label>Standard-Zielordner</label><div class="note" style="word-break:break-all">${esc(c.recordings.folder || 'noch nicht gewählt – wird beim ersten Speichern gefragt')}</div></div>
      <div class="row2"><div class="field"><label for="jq">JPEG-Qualität</label><select id="jq" data-p="recordings.jpegQuality" data-num>${[85, 90, 95, 98, 100].map((v) => `<option ${c.recordings.jpegQuality === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label for="ls">Beschriftung</label><select id="ls" data-p="recordings.labelStyle"><option value="full" ${c.recordings.labelStyle === 'full' ? 'selected' : ''}>AR + McIntosh</option><option value="short" ${c.recordings.labelStyle === 'short' ? 'selected' : ''}>nur AR-Nummer</option></select></div></div>
      <label class="chk"><input type="checkbox" data-p="recordings.legend" ${c.recordings.legend ? 'checked' : ''}> Legende standardmäßig anhängen</label>
      <label class="chk"><input type="checkbox" data-p="recordings.grid" ${c.recordings.grid ? 'checked' : ''}> Heliografisches Gradnetz einzeichnen</label>
      <div class="field"><label for="ct">Uhrzeit der Kamera (EXIF)</label><select id="ct" data-p="recordings.cameraTime"><option value="local" ${c.recordings.cameraTime === 'local' ? 'selected' : ''}>Ortszeit (MEZ/MESZ)</option><option value="utc" ${c.recordings.cameraTime === 'utc' ? 'selected' : ''}>UTC</option></select></div>
      <span class="lbl">Setup-Profile</span>
      ${['wl', 'ca'].map((m) => { const p = c.profiles[m]; return `<div class="box"><b>${esc(p.name)}</b><br><span class="note">Spiegelung: ${p.flip == null ? 'noch unbekannt' : p.flip ? 'gespiegelt' : 'nicht gespiegelt'} · ${p.history.length} Ausrichtungen gespeichert</span><br><button class="ghost" data-reset="${m}" style="margin-top:6px">Profil zurücksetzen</button></div>`; }).join('')}`,
    hinw: (c) => `<h3>Hinweise (Mitteilungen)</h3>
      <label class="chk"><input type="checkbox" data-p="notify.flareM" ${c.notify.flareM ? 'checked' : ''}> Flares ab Klasse M</label>
      <label class="chk"><input type="checkbox" data-p="notify.aurora" ${c.notify.aurora ? 'checked' : ''}> Polarlicht-Chance am Standort</label>
      <label class="chk"><input type="checkbox" data-p="notify.newRegion" ${c.notify.newRegion ? 'checked' : ''}> Neue aktive Regionen</label>
      <label class="chk"><input type="checkbox" data-p="notify.goodWindow" ${c.notify.goodWindow ? 'checked' : ''}> Gutes Beobachtungsfenster (klar, ruhig, windstill)</label>`,
    upd: (c) => `<h3>Updates</h3>
      <div class="box" style="display:flex;flex-direction:column;gap:8px"><span>Installiert: <b>Solux ${esc(c.version)}</b>${c.packaged ? '' : ' (Entwicklungsmodus)'}</span>
      <label class="chk"><input type="checkbox" data-p="update.auto" ${c.update.auto ? 'checked' : ''}> Automatisch nach Updates suchen</label>
      <button class="pbtn" id="chkUpd" style="align-self:flex-start">Nach Updates suchen</button><div id="updRes" style="display:flex;flex-direction:column;gap:8px"></div></div>
      <p class="note">Beim Installieren wird Solux beendet, ersetzt und mit Startbild neu geöffnet. Quelle: GitHub-Releases (${esc(c.update.repo)}).${c.update.lastCheck ? ' Zuletzt geprüft ' + fmt.ago(new Date(c.update.lastCheck).getTime()) + '.' : ''}</p>`,
  };

  async function openSettings(sec) {
    state.cfg = await api.getConfig();
    $('#pop').hidden = true; $('#setPop').hidden = false;
    document.querySelectorAll('#setNav button').forEach((b) => b.classList.toggle('on', b.dataset.s === sec));
    const body = $('#setBody');
    body.innerHTML = `<div style="display:flex;justify-content:flex-end;margin:-4px -2px -12px 0"><button class="xbtn" data-close aria-label="Einstellungen schließen">×</button></div>` + SECTIONS[sec](state.cfg);
    body.querySelectorAll('[data-p]').forEach((el) => el.addEventListener(el.type === 'range' ? 'input' : 'change', async () => {
      const [a, b] = el.dataset.p.split('.');
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if ('num' in el.dataset) v = parseFloat(v);
      state.cfg = await api.setConfig({ [a]: { [b]: v } });
      if (el.id === 'opa') el.previousElementSibling.textContent = `Deckkraft ${Math.round(v * 100)} %`;
      if (a === 'location') { drawAltitude(); loadWeather(); loadNews(); }
    }));
    if (sec === 'allg') $('#hideW').addEventListener('click', () => api.hideWidget());
    if (sec === 'ort') {
      const run = async () => {
        $('#locRes').innerHTML = '<span class="note">Suche …</span>';
        try {
          const res = await api.geoSearch($('#locq').value);
          $('#locRes').innerHTML = res.length ? res.map((r, i) => `<button data-i="${i}">${esc(r.name)}<small>${esc(r.admin)} · ${esc(r.country)} · ${r.lat.toFixed(3)}° / ${r.lon.toFixed(3)}° · ${Math.round(r.elevation)} m</small></button>`).join('') : '<span class="note">Nichts gefunden.</span>';
          $('#locRes').onclick = async (e) => {
            const b = e.target.closest('button'); if (!b) return; const r = res[+b.dataset.i];
            state.cfg = await api.setConfig({ location: { name: r.name, lat: +r.lat.toFixed(4), lon: +r.lon.toFixed(4), elevation: Math.round(r.elevation) } });
            openSettings('ort'); drawAltitude(); loadWeather();
          };
        } catch (e) { $('#locRes').innerHTML = `<span class="note">Suche nicht möglich: ${esc(e.message)}</span>`; }
      };
      $('#locBtn').addEventListener('click', run);
      if (WEB) $('#gpsBtn').addEventListener('click', async (e) => {
        e.target.textContent = 'Ermittle Standort …';
        try { const p = await api.locate(); state.cfg = await api.setConfig({ location: { name: 'Aktueller Standort', lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4), ...(p.elevation ? { elevation: Math.round(p.elevation) } : {}) } }); openSettings('ort'); drawAltitude(); loadWeather(); loadNews(); }
        catch (err) { e.target.textContent = err.message; }
      });
      $('#locq').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    }
    if (sec === 'daten') {
      api.storeInfo().then((i) => { $('#storeBox').innerHTML = `Lokaler Verlauf: <b>${i.days} Tage</b>${i.from ? ` (${i.from} bis ${i.to})` : ''}<br><span class="note">Speicher ${(i.bytes / 1048576).toFixed(1)} MB · ${esc(i.dir)}</span>`; });
      $('#refNow').addEventListener('click', async (e) => { e.target.textContent = 'Aktualisiere …'; await api.refresh(); loadSun(); e.target.textContent = 'Aktualisiert ✓'; });
      if (!WEB) { $('#clrImg').addEventListener('click', async (e) => { await api.clearImages(); e.target.textContent = 'Geleert ✓'; }); $('#logBtn').addEventListener('click', () => api.showLog()); }
    }
    if (sec === 'aufn') body.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => { await api.rec.profileReset(b.dataset.reset); openSettings('aufn'); }));
    if (sec === 'upd') {
      const res = $('#updRes');
      const showInstall = (info) => {
        res.innerHTML = `<p>Solux ${esc(info.latest)} ist verfügbar.</p>${info.notes ? `<p class="note" style="white-space:pre-wrap">${esc(info.notes.slice(0, 400))}</p>` : ''}<button class="pbtn" id="instUpd" style="align-self:flex-start">Installieren und neu starten</button><div class="progress" hidden id="prog"><i></i></div>`;
        $('#instUpd').addEventListener('click', async () => {
          $('#instUpd').disabled = true; $('#prog').hidden = false;
          const off = api.on('update-progress', (p) => { $('#prog i').style.width = Math.round(p * 100) + '%'; });
          try { await api.update.install(); res.insertAdjacentHTML('beforeend', '<p class="note">Solux wird beendet und neu gestartet …</p>'); } catch (e) { off(); res.insertAdjacentHTML('beforeend', `<p class="lv-bad">${esc(e.message)}</p>`); $('#instUpd').disabled = false; }
        });
      };
      if (state.update) showInstall(state.update);
      $('#chkUpd').addEventListener('click', async () => {
        res.innerHTML = '<span class="note">Prüfe …</span>';
        try { const info = await api.update.check(); if (info.available) { state.update = info; showInstall(info); } else res.innerHTML = `<span>${esc(info.message)}</span>`; } catch (e) { res.innerHTML = `<span class="lv-bad">Prüfung nicht möglich: ${esc(e.message)}</span>`; }
      });
    }
  }

  init();
})();
