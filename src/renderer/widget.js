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
    state.kind = 'wl'; // Weißlicht ist immer die Hauptansicht beim Start
    setKindButtons();
    tick(); setInterval(tick, 1000);
    drawAltitude(); setInterval(drawAltitude, 60000);
    loadSun(); loadWeather();
    // Sonnenbild und Wetter im eingestellten Takt erneuern; nach Ruhezustand/Hintergrund sofort nachholen
    setInterval(refreshDue, 60000);
    document.addEventListener('visibilitychange', refreshDue);
    window.addEventListener('focus', refreshDue);
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
    document.body.classList.toggle('kind-ha', state.kind === 'ha');
    $('#arHead').textContent = state.kind !== 'wl' ? 'Regionen & Plages' : 'Fleckengruppen';
  }
  const KINDS = ['wl', 'ca', 'ha'], KIND_LABEL = { wl: 'Weißlicht', ca: 'Kalzium', ha: 'H-Alpha' };
  function setKind(k) {
    if (k === state.kind) return;
    state.kind = k; setKindButtons(); api.setConfig({ widget: { kind: state.kind } }); loadSun();
  }
  $('#kindSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setKind(b.dataset.k); });

  let sunReq = 0;
  let lastSun = 0, lastWx = 0;
  const refreshEvery = () => Math.max(WEB ? 15 : 10, (state.cfg && state.cfg.data && state.cfg.data.refreshMinutes) || 15) * 60000;
  function refreshDue() {
    if (document.visibilityState === 'hidden') return;
    const now = Date.now(), ev = refreshEvery();
    if (now - lastSun >= ev) loadSun();
    if (now - lastWx >= ev) loadWeather();
  }

  let sunRetry = 0;
  const shortErr = (m) => String(m || 'unbekannt').replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 90);
  async function loadSun(fresh = false) {
    lastSun = Date.now();
    clearTimeout(sunRetry);
    const my = ++sunReq;
    $('#sunLoad').hidden = false; $('#sunLoad').textContent = 'Lade Sonnenbild …';
    let step = 'Abruf';
    try {
      const sun = await api.sunImage(state.kind, null, undefined, fresh);
      if (my !== sunReq) return;
      step = 'Bild öffnen';
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Bilddatei beschädigt')); img.src = sun.dataUrl || sun.url; });
      state.sun = sun;
      step = 'Einfärben';
      const S = $('#sunCv').width, R1024 = (sun.radiusPx * 1024) / (sun.size || 1024);
      state.sunCanvas = sun.dataUrl ? U.colorizeSun(img, state.kind, S, R1024) : U.tintSun(img, state.kind, S, R1024);
      $('#sunLoad').hidden = true;
      const d = new Date(sun.date);
      $('#capDate').textContent = fmt.utcDate(d);
      $('#capTime').textContent = fmt.utcHM(d);
      $('#capTime').title = 'Ortszeit ' + fmt.hm.format(d);
      $('#capSrc').textContent = sun.label;
      drawSunCanvas();
    } catch (e) {
      if (my !== sunReq) return;
      const why = shortErr(e && e.message);
      if (api.log) api.log(`Sonnenbild ${state.kind} (${step}): ${e && e.message}`);
      // beschädigte Datei im Zwischenspeicher: einmal sofort frisch laden
      if (!fresh && step === 'Bild öffnen') { loadSun(true); return; }
      $('#sunLoad').hidden = false; $('#sunLoad').textContent = `Sonnenbild nicht erreichbar (${step}: ${why}) – neuer Versuch in 1 min`;
      if (!state.sunCanvas) drawSunCanvas();
      sunRetry = setTimeout(() => loadSun(true), 60000);
      return;
    }
    // Regionen getrennt laden: ein Fehler hier darf das Sonnenbild nicht verhindern
    try { await loadRegions(); }
    catch (e) { if (api.log) api.log(`Regionen: ${e && e.message}`); drawSunCanvas(); }
  }

  async function loadRegions() {
    const when = state.sun ? new Date(state.sun.date) : new Date();
    const r = await api.regions(when.toISOString());
    state.regions = r.regions || [];
    try { state.flares = (await api.flares(Date.now() - 7 * 86400000)) || []; } catch { state.flares = []; }
    drawSunCanvas();
    renderRegionList();
    const o = A.solarOrientation(when);
    $('#ephem').innerHTML = `P ${o.P >= 0 ? '+' : ''}${fmt.num(o.P)}° · B₀ ${o.B0 >= 0 ? '+' : ''}${fmt.num(o.B0, 2)}°<br>L₀ ${fmt.num(o.L0)}° · CR ${A.carringtonRotation(when)}`;
  }

  function drawSunCanvas(highlight = null) {
    const cv = $('#sunCv'), x = cv.getContext('2d'), W = cv.width;
    x.clearRect(0, 0, W, W); x.fillStyle = '#000'; x.fillRect(0, 0, W, W);
    const Z = 0.88; // Sonne etwas kleiner, damit sie nicht am Rand klebt
    if (state.sunCanvas) x.drawImage(state.sunCanvas, W * (1 - Z) / 2, W * (1 - Z) / 2, W * Z, W * Z);
    if (!state.sun) return;
    const c = W / 2, R = state.sun.radiusPx * (W / state.sun.size) * Z;
    state.labelHits = [];
    x.font = `500 ${Math.round(W * 0.03)}px ${getComputedStyle(document.body).getPropertyValue('--f-mono')}`;
    x.textBaseline = 'middle';
    const accent = state.kind === 'ca' ? '#d9c2ff' : state.kind === 'ha' ? '#ffb08a' : '#f3b544';
    const placed = [];
    for (const r of state.regions) {
      if (r.type !== 'spots' && state.kind === 'wl') continue;
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
      drawFlares(x, W, c, R);
  }

  /** Position eines Flares zum Bildzeitpunkt (Region bevorzugt, sonst gemeldeter Ort + Rotation). */
  function flarePos(f, when) {
    const reg = f.region && state.regions.find((r) => r.region === f.region);
    if (reg) return { x: reg.x, y: reg.y };
    const m = /^([NS])(\d+)([EW])(\d+)$/.exec(f.location || '');
    if (!m) return null;
    const lat = (m[1] === 'N' ? 1 : -1) * +m[2], cmd = (m[3] === 'W' ? 1 : -1) * +m[4] + 13.2 * ((when - f.max) / 86400000);
    const p = A.heliographicToDisk(lat, cmd, A.solarOrientation(when).B0);
    return p.visible ? { x: p.x, y: p.y } : null;
  }
  function drawFlares(x, W, c, R) {
    const when = state.sun ? new Date(state.sun.date).getTime() : Date.now();
    const recent = (state.flares || []).filter((f) => when - f.max < 24 * 3600000 && when - f.max > -3600000 && SW_rank(f.cls) >= 25);
    for (const f of recent) {
      const p = flarePos(f, when); if (!p) continue;
      const px = c + p.x * R, py = c - p.y * R, big = f.cls[0] === 'X', mid = f.cls[0] === 'M';
      const rr = W * (big ? 0.03 : mid ? 0.022 : 0.014);
      x.save(); x.translate(px, py);
      x.strokeStyle = big ? '#ff4d4d' : mid ? '#ff9a3c' : '#ffe08a'; x.lineWidth = W / 280;
      x.beginPath(); for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, r1 = k % 2 ? rr * 0.45 : rr; x.moveTo(0, 0); x.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); } x.stroke();
      if (big || mid) { x.font = `700 ${Math.round(W * 0.026)}px ${getComputedStyle(document.body).getPropertyValue('--f-mono')}`; x.fillStyle = x.strokeStyle; x.textBaseline = 'bottom'; x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.8)'; x.strokeText(f.cls, rr * 0.6, -rr * 0.6); x.fillText(f.cls, rr * 0.6, -rr * 0.6); }
      x.restore();
      state.labelHits.push({ flare: f, x0: px - rr - 4, x1: px + rr + 4, y0: py - rr - 4, y1: py + rr + 4 });
    }
  }
  const SW_rank = (cls) => { const m = /^([ABCMX])(\d+(?:\.\d+)?)/.exec(cls || ''); return m ? 'ABCMX'.indexOf(m[1]) * 10 + parseFloat(m[2]) : 0; };

  function showFlare(f) {
    const t = (ms) => (ms ? new Date(ms).toISOString().slice(11, 16) + ' UTC' : '–');
    const reg = f.region && state.regions.find((r) => r.region === f.region);
    const strength = f.cls[0] === 'X' ? 'starker Flare (X-Klasse) – kann Kurzwellenfunk auf der Tagseite weitflächig stören, oft mit Massenauswurf' : f.cls[0] === 'M' ? 'mittlerer Flare (M-Klasse) – kurze Funkstörungen auf der Tagseite möglich' : 'kleiner Flare (C-Klasse) – für die Erde unbedeutend, im H-Alpha-Licht als kurzes Aufhellen sichtbar';
    openPop(`<div class="hd"><div><span class="lbl">Flare · Strahlungsausbruch</span><h2>${esc(f.cls)}</h2></div><button class="xbtn" data-close aria-label="Schließen">×</button></div>
      <div class="plain"><span class="lbl">Kurz gesagt</span><p>Ein ${esc(strength)}.</p></div>
      <div class="kv"><span>Datum</span><span>${fmt.utcDate(f.max)}</span><span>Beginn · Maximum · Ende</span><span>${t(f.begin)} · ${t(f.max)} · ${t(f.end)}</span>
      ${f.region ? `<span>Region</span><span>AR ${f.region}${reg ? ' · ' + esc(reg.spotClass) + ' ' + esc(M.magSymbol(reg.magClass)) : ''}</span>` : ''}
      ${f.location ? `<span>Ort</span><span>${esc(f.location)}${f.optical ? ` · optisch ${esc(f.optical)}` : ''}</span>` : ''}</div>
      ${reg ? `<button class="ghost" data-region="${reg.region}" style="align-self:flex-start">Zur Region AR ${reg.region}</button>` : ''}
      <button class="ghost" data-glossary style="align-self:flex-start">Flare-Klassen erklärt</button>
      <p class="note">Quelle: NOAA SWPC Ereignisliste (GOES-Röntgen, optische Beobachtungen).</p>`);
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-region]'); if (b) showRegion(+b.dataset.region); });

  // Sonne: Antippen = Region/Flare-Erklärung (auf Beschriftung) oder Großansicht · waagerecht wischen = Wellenlänge wechseln
  let down = null;
  $('#sunCv').addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  $('#sunCv').addEventListener('pointercancel', () => { down = null; });
  $('#sunCv').addEventListener('pointerup', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = Date.now() - down.t; down = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > 1.6 * Math.abs(dy) && dt < 900) { swipeKind(dx < 0 ? 1 : -1); return; }
    if (Math.hypot(dx, dy) > 10) return;
    const cv = e.currentTarget, rect = cv.getBoundingClientRect();
    const X = ((e.clientX - rect.left) / rect.width) * cv.width, Y = ((e.clientY - rect.top) / rect.height) * cv.height;
    const hit = (state.labelHits || []).find((h) => X >= h.x0 && X <= h.x1 && Y >= h.y0 && Y <= h.y1);
    if (hit) hit.flare ? showFlare(hit.flare) : showRegion(hit.region);
    else openBig();
  });
  function swipeKind(dir) {
    const i = KINDS.indexOf(state.kind), k = KINDS[(i + dir + KINDS.length) % KINDS.length];
    setKind(k);
    const t = $('#swipeTip'); t.textContent = KIND_LABEL[k]; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  }
  /** Großansicht: am Mac eigenes Fenster, am Handy Vollbild mit 2048-px-Bild. */
  async function openBig() {
    if (!state.sun) return;
    if (!WEB) { api.openViewer(state.kind); return; }
    const kind = state.kind, sun = state.sun;
    const markers = window.SoluxViewer.markersFrom(state.regions, state.flares, kind, new Date(sun.date).getTime());
    const v = window.SoluxViewer.open({ title: `Sonne · ${KIND_LABEL[kind]}`, sub: `${fmt.utcDate(sun.date)} ${fmt.utcHM(sun.date)} · ${sun.label}`, canvas: state.sunCanvas, markers, onMore: (m) => showRegion(m.region) });
    try {
      const big = await api.sunImage(kind, sun.date, 2048);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = big.url; });
      if (v.open) v.setImage(U.tintSun(img, kind, 2048, (big.radiusPx * 1024) / big.size));
    } catch (e) { v.fail('Hochaufgelöstes Bild nicht verfügbar'); }
  }

  function renderRegionList() {
    const list = state.regions.filter((r) => r.type === 'spots' || state.kind !== 'wl');
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
    const trend = hist.length > 2 ? (() => { const a = hist[hist.length - 3].area || 0, b = hist[hist.length - 1].area || 0; return b > a * 1.2 ? 'wächst' : b < a * 0.8 ? 'schrumpft' : 'bleibt etwa gleich'; })() : null;
    const pct = (v) => (v == null ? '–' : `${v} %`);
    openPop(`
      <div class="hd"><div><span class="lbl">Aktive Region · NOAA-Nummer</span><h2>AR ${r.region}</h2></div><button class="xbtn" data-close aria-label="Schließen">×</button></div>
      ${(() => { const fl = (state.flares || []).filter((f) => f.region === r.region); const st = M.regionStory(r, hist, fl, state.kind); return `<div class="plain"><span class="lbl">Kurz gesagt</span><p><b>${esc(st.fazit)}</b></p></div>
      <div class="story">${st.sections.map((x) => `<h4>${esc(x.h)}</h4><p>${esc(x.p)}</p>`).join('')}</div>`; })()}
      <details class="tech"><summary>Fachliche Details</summary><div class="techbody">
      ${r.spotClass ? `<div class="explain">
        <div class="codehead"><span class="code">${esc(r.spotClass)}</span><span class="note">McIntosh-Klasse: drei Buchstaben für Typ, Hof und Verteilung</span></div>
        <dl class="decode">${d.parts.map((p, i) => `<dt>${p.key}</dt><dd><b>${['Typ und Größe', 'Hof des größten Flecks', 'Wie dicht die Flecken stehen'][i]}</b><small>${esc(i === 0 ? M.Z_PLAIN[p.key] : i === 1 ? M.P_PLAIN[p.key] : M.C_PLAIN[p.key])}</small><small class="tech">Fachbegriff: ${esc(p.text)}</small></dd>`).join('')}</dl>
      </div>
      ${d.mag.length ? `<div class="explain"><div class="codehead"><span class="code">${esc(M.magSymbol(r.magClass))}</span><span class="note">Mount-Wilson-Klasse: wie verwickelt das Magnetfeld ist</span></div>
        <dl class="decode">${d.mag.map((m) => `<dt>${m.key}</dt><dd><b>${m.title}</b><small>${esc(M.MW_PLAIN[{ α: 'A', β: 'B', γ: 'G', δ: 'D' }[m.key]] || m.text)}</small></dd>`).join('')}</dl></div>` : ''}
      <div class="box"><b class="lv-${risk.level}">Flare-Risiko: ${risk.label}</b><br>${risk.text}
        <div class="probs"><span>C-Flare<br><b>${pct(r.probs.c)}</b></span><span>M-Flare<br><b>${pct(r.probs.m)}</b></span><span>X-Flare<br><b>${pct(r.probs.x)}</b></span></div>
        <span class="note">Wahrscheinlichkeit für mindestens einen Flare dieser Stärke in den nächsten 24 h (NOAA). C = klein, M = mittel, X = stark.</span></div>` : ''}
      <div class="kv">
        ${r.area ? `<span>Größe</span><span>${esc(M.areaPlain(r.area))}</span>` : ''}
        ${r.numberSpots ? `<span>Flecken</span><span>${r.numberSpots} einzelne Flecken gezählt</span>` : ''}
        <span>Lage</span><span>${esc(r.location)} – ${esc(M.positionPlain(r.location) || '')}</span>
        <span>Erstmals gesehen</span><span>${firstSeen}${trend ? ` · die Fläche ${trend}` : ''}</span>
        ${r.flares.c || r.flares.m || r.flares.x ? `<span>Flares zuletzt</span><span>${r.flares.c}× C · ${r.flares.m}× M · ${r.flares.x}× X (am Meldetag)</span>` : ''}
      </div>
      ${hist.length > 1 ? `<div><span class="lbl">Entwicklung der Fläche (rot = δ-Konfiguration)</span><div style="display:flex;gap:2px;height:50px;margin-top:6px">${bars}</div><div class="note" style="display:flex;justify-content:space-between"><span>${hist[0].day.slice(5)}</span><span>${hist[hist.length - 1].day.slice(5)}</span></div></div>` : ''}
      ${(() => { const fl = (state.flares || []).filter((f) => f.region === r.region && SW_rank(f.cls) >= 20).slice(0, 8); return fl.length ? `<div><span class="lbl">Flares der letzten 7 Tage</span><div class="flist">${fl.map((f) => `<span class="fl ${f.cls[0]}">${esc(f.cls)}<small>${fmt.utcDate(f.max).slice(0, 6)} ${new Date(f.max).toISOString().slice(11, 16)}</small></span>`).join('')}</div></div>` : '<p class="note">Keine Flares ab C2 in den letzten 7 Tagen.</p>'; })()}
      </div></details>
      <button class="ghost" data-glossary style="align-self:flex-start">Alle Kürzel erklärt</button>
      <p class="note">Daten: NOAA SWPC. MH = millionstel Sonnenhälfte (eine Erdscheibe ≈ 42 MH).</p>`);
  }

  function showGlossary() {
    openPop(`<div class="hd"><div><span class="lbl">Glossar</span><h2>Kürzel und Begriffe</h2></div><button class="xbtn" data-close aria-label="Schließen">×</button></div>
      <dl class="gloss">${M.GLOSSARY.map((g) => `<dt><span class="code-s">${esc(g.k)}</span><b>${esc(g.t)}</b></dt><dd>${esc(g.d)}</dd>`).join('')}</dl>`);
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-glossary]')) showGlossary(); });

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
    lastWx = Date.now();
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
        <p class="note">${calText(w)}</p>
        <p class="note">Schätzung aus Sonneneinstrahlung, Boden-/Lufttemperatur, Wind, Windscherung und Jetstream (Open-Meteo) sowie der Sonnenhöhe. Grün &lt; 2″, Orange 2–3,5″, Rot darüber.</p>`;
    }
    openPop(html);
  }
  function calText(w) {
    const ci = w.calibrationInfo || {};
    if (ci.source === 'manuell') return `Kalibriert mit Faktor ×${fmt.num(ci.factor, 2)} (vom Mac).`;
    if (ci.source === 'bilder' && ci.n >= 2) return `Auf deinen Hof kalibriert: Faktor ×${fmt.num(ci.factor, 2)} aus ${ci.n} Weißlicht-Aufnahmen (Randschärfe).`;
    return WEB ? 'Noch nicht kalibriert – Faktor vom Mac unter Einstellungen → Über Solux eintragen.' : 'Noch nicht kalibriert – Solux lernt automatisch aus deinen Weißlicht-Aufnahmen (Randschärfe).';
  }

  /* ---------------- Newsroom ---------------- */
  async function loadNews() {
    try {
      const n = await api.news();
      state.news = n;
      $('#newsList').innerHTML = n.items.length ? n.items.map((i, k) => `<button class="news" data-news="${k}"><i class="${i.level}"></i><p>${esc(i.title)}<small>${esc(i.detail)}</small></p><time>${fmt.ago(i.time)}</time></button>`).join('') : '<p class="note">Keine aktuellen Meldungen.</p>';
      $('#newsMeta').textContent = n.updated ? 'Stand ' + fmt.hm.format(new Date(n.updated)) : '';
      $('#footInfo').textContent = `SN ${n.ssn ?? '–'} · F10.7 ${n.flux ?? '–'} · NASA SDO · NOAA SWPC · Open-Meteo`;
    } catch { /* offline */ }
  }

  $('#newsList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-news]'); if (!b || !state.news) return;
    const i = state.news.items[+b.dataset.news]; if (!i) return;
    const st = window.SoluxSW ? window.SoluxSW.newsStory(i) : { sections: [{ h: 'Info', p: i.detail }] };
    const reg = /AR (\d{4,5})/.exec(i.title + ' ' + i.detail);
    openPop(`<div class="hd"><div><span class="lbl">Newsroom · ${fmt.ago(i.time)}</span><h2>${esc(i.title)}</h2></div><button class="xbtn" data-close aria-label="Schließen">×</button></div>
      <div class="plain"><span class="lbl">Kurz gesagt</span><p>${esc(i.detail)}</p></div>
      <div class="story">${st.sections.map((x) => `<h4>${esc(x.h)}</h4><p>${esc(x.p)}</p>`).join('')}</div>
      ${reg && state.regions.some((r) => r.region === +reg[1]) ? `<button class="ghost" data-region="${reg[1]}" style="align-self:flex-start">Zur Region AR ${reg[1]}</button>` : ''}
      <button class="ghost" data-glossary style="align-self:flex-start">Begriffe erklärt</button>`);
  });

  /* ---------------- Popups ---------------- */
  function openPop(html) { $('#setPop').hidden = true; const p = $('#pop'); p.innerHTML = html; p.hidden = false; p.scrollTop = 0; }
  function closePops() { $('#pop').hidden = true; $('#setPop').hidden = true; }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closePops(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePops(); });

  /* ---------------- Einstellungen ---------------- */
  $('#gearBtn').addEventListener('click', () => ($('#setPop').hidden ? openSettings(WEB ? 'ort' : 'allg') : closePops()));
  $('#setNav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) openSettings(b.dataset.s); });

  const SURF = S.SURFACES;
  const pathSet = (p, v) => p.split('.').reduceRight((acc, k) => ({ [k]: acc }), v);
  const MODES = [['wl', 'Weißlicht'], ['ca', 'Kalzium (Ca-K)'], ['ha', 'H-Alpha']];
  const opticScale = (o) => (o && o.focal > 0 && o.pixel > 0 ? (206.265 * o.pixel * (o.binning || 1)) / o.focal : null);
  const opticNote = (o) => { const sc = opticScale(o); return sc ? `${fmt.num(sc, 3)}″ pro Pixel · Sonne ≈ ${Math.round((2 * 959.6) / sc).toLocaleString('de-DE')} px Durchmesser` : 'Ohne Angabe: ganze Sonne und lange Randbögen klappen trotzdem, Oberflächenbilder nicht.'; };
  const NOTIFY_INFO = `<div class="box"><b>Interessant</b> = X-Flares und M-Flares ab M5, besonders aktive oder große Fleckengruppen im Blickfeld (δ-Magnetfeld, über 300 MH, hohe Flare-Chance), Polarlicht-Chance am Standort, starke Stürme und Protonenereignisse.<br><b>Alle</b> = zusätzlich jeder M-Flare, neue Regionen und geomagnetische Stürme.</div>
      <p class="note">Mitteilungen kommen nur, solange die Sonne an deinem Standort über dem Horizont steht, und jede Region bzw. Meldung höchstens einmal am Tag – außer es passiert etwas Neues (z. B. ein weiterer Flare).</p>`;

  const SECTIONS = {
    allg: (c) => `<h3>Allgemein</h3>
      <label class="chk"><input type="checkbox" data-p="general.openAtLogin" ${c.general.openAtLogin ? 'checked' : ''}> Bei Anmeldung starten</label>
      <label class="chk"><input type="checkbox" data-p="widget.showSplash" ${c.widget.showSplash ? 'checked' : ''}> Startbild beim Öffnen zeigen</label>
      <label class="chk"><input type="checkbox" data-p="widget.alwaysOnTop" ${c.widget.alwaysOnTop ? 'checked' : ''}> Widget immer im Vordergrund</label>
      <div class="row2"><div class="field"><label for="scl">Größe</label><select id="scl" data-p="widget.scale" data-num>${[0.85, 1, 1.15, 1.3].map((v) => `<option value="${v}" ${c.widget.scale === v ? 'selected' : ''}>${Math.round(v * 100)} %</option>`).join('')}</select></div>
      <div class="field"><label for="opa">Deckkraft ${Math.round(c.widget.opacity * 100)} %</label><input id="opa" type="range" min="0.5" max="1" step="0.05" value="${c.widget.opacity}" data-p="widget.opacity" data-num></div></div>
      <button class="ghost" id="hideW" style="align-self:flex-start">Widget ausblenden (Menüleiste ☀︎)</button>
      <p class="note">Solux läuft im Hintergrund weiter und ist über das Sonnensymbol in der Menüleiste erreichbar.</p>`,
    ort: (c) => `<h3>Standort</h3>
      ${WEB ? '<button class="ghost" id="gpsBtn" style="align-self:flex-start">Aktuellen Standort verwenden</button>' : ''}
      <div class="field"><label for="locq">Ort suchen</label><div style="display:flex;gap:6px"><input class="inp" id="locq" value="${esc(c.location.name)}"><button class="ghost" id="locBtn">Suchen</button></div></div>
      <div class="results" id="locRes"></div>
      <div class="row3"><div class="field"><label for="lat">Breite °N</label><input id="lat" type="number" step="0.0001" value="${c.location.lat}" data-p="location.lat" data-num></div>
      <div class="field"><label for="lon">Länge °E</label><input id="lon" type="number" step="0.0001" value="${c.location.lon}" data-p="location.lon" data-num></div>
      <div class="field"><label for="ele">Höhe m</label><input id="ele" type="number" value="${c.location.elevation}" data-p="location.elevation" data-num></div></div>
      <div class="field"><label for="srf">Untergrund am Teleskop (für das Seeing)</label><select id="srf" data-p="location.surface">${Object.entries(SURF).map(([k, v]) => `<option value="${k}" ${c.location.surface === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <p class="note">Koordinaten bleiben auf ${WEB ? 'diesem Gerät' : 'deinem Mac'} und werden nur für Wetterabfragen (Open-Meteo) genutzt.</p>`,
    ausr: (c) => `<h3>Ausrüstung</h3>
      <div class="field"><label for="mnt">Montierung</label><select id="mnt" data-p="location.mount"><option value="altaz" ${c.location.mount === 'altaz' ? 'selected' : ''}>azimutal (Bildfeld dreht sich)</option><option value="eq" ${c.location.mount === 'eq' ? 'selected' : ''}>parallaktisch</option></select></div>
      ${MODES.map(([m, label]) => { const p = c.profiles[m] || {}, o = p.optics || {}; return `<div class="box prof">
        <b>${label}</b><input class="inp" data-p="profiles.${m}.name" value="${esc(p.name || '')}" aria-label="Bezeichnung ${label}" placeholder="Bezeichnung des Aufbaus">
        <div class="row3"><div class="field"><label>Brennweite</label><input type="number" min="50" step="any" placeholder="mm" data-p="profiles.${m}.optics.focal" data-num value="${o.focal || ''}"></div>
        <div class="field"><label>Pixel</label><input type="number" min="0.5" step="any" placeholder="µm" data-p="profiles.${m}.optics.pixel" data-num value="${o.pixel || ''}"></div>
        <div class="field"><label>Binning</label><select data-p="profiles.${m}.optics.binning" data-num>${[1, 2, 3, 4].map((v) => `<option ${(o.binning || 1) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
        <span class="note" data-scale="${m}">${opticNote(o)}</span>
        <span class="note">Gelernte Ausrichtung: ${p.flip == null ? 'noch unbekannt' : p.flip ? 'Bild gespiegelt' : 'nicht gespiegelt'} · ${(p.history || []).length} Aufnahmen <button class="lnk" data-reset="${m}">zurücksetzen</button></span></div>`; }).join('')}
      <div class="field"><label>Zielordner für Exporte</label><div style="display:flex;gap:6px;align-items:center"><span class="note" style="word-break:break-all;flex:1">${esc(c.recordings.folder || 'noch nicht gewählt – wird beim ersten Export gefragt')}</span><button class="ghost" id="folderBtn">Ändern …</button></div></div>
      <label class="chk"><input type="checkbox" data-p="recordings.diary" ${c.recordings.diary !== false ? 'checked' : ''}> Ausgewertete Aufnahmen im Tagebuch speichern</label>
      <p class="note">Brennweite in mm inklusive Barlow, Pixelgröße der Kamera in µm. Beide bestimmen den Bildmaßstab – nötig für Oberflächenbilder und kurze Randbögen. Die Spiegelung lernt Solux beim Ausrichten selbst. Text, Skala, Format und Qualität wählst du im Export-Dialog unter „Aufnahmen“.</p>`,
    hinw: (c) => `<h3>Mitteilungen</h3>
      <div class="field"><label for="nm">Mitteilungen am Mac</label><select id="nm" data-p="notify.mode">
        <option value="interessant" ${(c.notify.mode || 'interessant') === 'interessant' ? 'selected' : ''}>Nur interessante Meldungen</option>
        <option value="alle" ${c.notify.mode === 'alle' ? 'selected' : ''}>Alle neuen Meldungen</option>
        <option value="aus" ${c.notify.mode === 'aus' ? 'selected' : ''}>Aus</option></select></div>
      <label class="chk"><input type="checkbox" data-p="notify.goodWindow" ${c.notify.goodWindow ? 'checked' : ''}> Zusätzlich: gutes Beobachtungsfenster (klar, ruhig, windstill)</label>
      ${NOTIFY_INFO}`,
    about: (c) => `<h3>Über Solux</h3>
      ${WEB ? `<div class="box">Solux mobil <b>${esc(c.version)}</b> · aktualisiert sich automatisch beim Öffnen.</div>` : `<div class="box" style="display:flex;flex-direction:column;gap:8px"><span>Installiert: <b>Solux ${esc(c.version)}</b>${c.packaged ? '' : ' (Entwicklungsmodus)'}</span>
      <label class="chk"><input type="checkbox" data-p="update.auto" ${c.update.auto ? 'checked' : ''}> Automatisch nach Updates suchen</label>
      <button class="pbtn" id="chkUpd" style="align-self:flex-start">Nach Updates suchen</button><div id="updRes" style="display:flex;flex-direction:column;gap:8px"></div>
      <span class="note">Beim Installieren wird Solux beendet, ersetzt und mit Startbild neu geöffnet. Quelle: GitHub-Releases (${esc(c.update.repo)}).${c.update.lastCheck ? ' Zuletzt geprüft ' + fmt.ago(new Date(c.update.lastCheck).getTime()) + '.' : ''}</span></div>`}
      <span class="lbl">Seeing-Kalibrierung</span>
      <div class="box" id="calBox">Lade …</div>
      ${WEB ? `<div class="field"><label for="calF">Faktor vom Mac übernehmen (leer = ohne)</label><input id="calF" type="number" min="0.5" max="2" step="0.01" value="${c.seeing && c.seeing.factor ? c.seeing.factor : ''}" placeholder="z. B. 1.12"></div>` : ''}
      <span class="lbl">Daten</span>
      <div class="field"><label for="ref">Aktualisierung</label><select id="ref" data-p="data.refreshMinutes" data-num>${(WEB ? [15, 30, 60] : [10, 15, 30, 60]).map((v) => `<option value="${v}" ${c.data.refreshMinutes === v ? 'selected' : ''}>alle ${v} Minuten</option>`).join('')}</select></div>
      ${WEB ? '<p class="note">Gilt, solange Solux mobil geöffnet ist. Push-Mitteilungen kommen unabhängig davon im 15-Minuten-Takt.</p>' : ''}
      <div class="box" id="storeBox">Lade Speicherinfo …</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ghost" id="refNow">Jetzt aktualisieren</button>${WEB ? '' : '<button class="ghost" id="clrImg">Bild-Zwischenspeicher leeren</button><button class="ghost" id="logBtn">Protokoll zeigen</button>'}</div>
      <p class="note">Quellen: Sonnenbilder NASA SDO und NSO/GONG über Helioviewer · Regionen, Flares, Kp, Meldungen NOAA SWPC${WEB ? ' (ca. 30 Tage online)' : ' (lokal 60 Tage gesammelt, ältere Tage aus dem NOAA-Archiv)'} · Wetter Open-Meteo.</p>`,
  };

  SECTIONS.push = () => `<h3>Mitteilungen</h3>
      <p>Solux meldet sich auf diesem iPhone – auch wenn die App geschlossen ist.</p>
      <div class="field"><label for="pmode">Was soll gemeldet werden?</label><select id="pmode" class="inp">
        <option value="interessant">Nur interessante Meldungen</option><option value="alle">Alle neuen Meldungen</option><option value="aus">Aus</option></select></div>
      <div class="box" id="pushBox">Prüfe …</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="pbtn" id="pushOn">Mitteilungen aktivieren</button><button class="ghost" id="pushTest">Test auf diesem Gerät</button></div>
      <div id="pushSub" hidden>
        <p class="note" id="pushHint">Diesen Code einmalig als GitHub-Secret <b>PUSH_SUBSCRIPTIONS</b> speichern (bestehenden Wert ersetzen).</p>
        <textarea id="pushJson" class="inp" rows="5" readonly style="width:100%;font:11px var(--f-mono)"></textarea>
        <button class="ghost" id="pushCopy">Code kopieren</button>
      </div>
      ${NOTIFY_INFO}`;
  if (WEB) SECTIONS.hinw = SECTIONS.push;

  async function openSettings(sec) {
    state.cfg = await api.getConfig();
    $('#pop').hidden = true; $('#setPop').hidden = false;
    document.querySelectorAll('#setNav button').forEach((b) => b.classList.toggle('on', b.dataset.s === sec));
    const body = $('#setBody');
    body.innerHTML = `<div style="display:flex;justify-content:flex-end;margin:-4px -2px -12px 0"><button class="xbtn" data-close aria-label="Einstellungen schließen">×</button></div>` + SECTIONS[sec](state.cfg);
    body.querySelectorAll('[data-p]').forEach((el) => el.addEventListener(el.type === 'range' ? 'input' : 'change', async () => {
      const a = el.dataset.p.split('.')[0];
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if ('num' in el.dataset) { v = parseFloat(v); if (Number.isNaN(v)) v = null; }
      state.cfg = await api.setConfig(pathSet(el.dataset.p, v));
      if (el.id === 'opa') el.previousElementSibling.textContent = `Deckkraft ${Math.round(v * 100)} %`;
      const pm = el.dataset.p.match(/^profiles\.(\w+)\.optics/);
      if (pm) body.querySelector(`[data-scale="${pm[1]}"]`).textContent = opticNote(state.cfg.profiles[pm[1]].optics);
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
    if (sec === 'about') {
      const showCal = async () => {
        try {
          const f = state.cfg.seeing && state.cfg.seeing.factor;
          const ci = WEB ? (f ? { factor: f, n: 0, source: 'manuell' } : { factor: 1, n: 0, source: null }) : await api.seeing.info();
          let txt;
          if (ci.source === 'manuell') txt = `Faktor <b>×${fmt.num(ci.factor, 2)}</b> (vom Mac übernommen).`;
          else if (ci.source === 'bilder' && ci.n >= 2) txt = `Faktor <b>×${fmt.num(ci.factor, 2)}</b> aus ${ci.n} Weißlicht-Aufnahmen gelernt.`;
          else if (ci.source === 'bilder') txt = `Noch ${2 - ci.n} Weißlicht-Aufnahme(n) bis zur ersten Kalibrierung.`;
          else if (ci.source === 'bewertung') txt = `Faktor <b>×${fmt.num(ci.factor, 2)}</b> aus früheren Handbewertungen – wird durch Messungen aus Aufnahmen ersetzt.`;
          else txt = WEB ? 'Noch keine Kalibrierung. Am Mac lernt Solux sie aus deinen Aufnahmen – den Faktor hier eintragen.' : 'Noch keine Kalibrierung – Solux lernt sie automatisch aus deinen Weißlicht-Aufnahmen unter „Aufnahmen“.';
          $('#calBox').innerHTML = `${txt}<br><span class="note">Gemessen wird die Schärfe des Sonnenrands (in Bogensekunden) und mit dem Seeing-Modell zur Aufnahmezeit verglichen. Kalzium und H-Alpha haben einen natürlich weichen Rand und zählen deshalb nicht mit.</span>${!WEB && ci.n ? '<br><button class="lnk" id="calReset">Kalibrierung zurücksetzen</button>' : ''}`;
          const rb = $('#calReset'); if (rb) rb.addEventListener('click', async () => { if (confirm('Alle gelernten Seeing-Messungen löschen?')) { await api.seeing.reset(); showCal(); } });
        } catch (e) { $('#calBox').textContent = 'Kalibrierung nicht lesbar: ' + e.message; }
      };
      showCal();
      if (WEB) $('#calF').addEventListener('change', async (e) => { const v = parseFloat(e.target.value); state.cfg = await api.setConfig({ seeing: { factor: v >= 0.5 && v <= 2 ? v : null } }); loadWeather(); showCal(); });
      api.storeInfo().then((i) => { $('#storeBox').innerHTML = `Lokaler Verlauf: <b>${i.days} Tage</b>${i.from ? ` (${i.from} bis ${i.to})` : ''}<br><span class="note">Speicher ${(i.bytes / 1048576).toFixed(1)} MB · ${esc(i.dir)}</span>`; });
      $('#refNow').addEventListener('click', async (e) => { e.target.textContent = 'Aktualisiere …'; await api.refresh(); loadSun(); e.target.textContent = 'Aktualisiert ✓'; });
      if (!WEB) { $('#clrImg').addEventListener('click', async (e) => { await api.clearImages(); e.target.textContent = 'Geleert ✓'; }); $('#logBtn').addEventListener('click', () => api.showLog()); }
    }
    if (sec === 'ausr') {
      $('#folderBtn').addEventListener('click', async () => { const f = await api.rec.chooseFolder(); if (f) openSettings('ausr'); });
      body.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => { await api.rec.profileReset(b.dataset.reset); openSettings('ausr'); }));
    }
    if (WEB && sec === 'hinw' && api.push) {
      const show = async () => {
        const st2 = await api.push.status();
        $('#pmode').value = st2.mode;
        $('#pushBox').innerHTML = st2.message;
        $('#pushOn').hidden = !st2.canSubscribe;
        $('#pushSub').hidden = !st2.code;
        if (st2.code) $('#pushJson').value = st2.code;
        if (st2.codeChanged) $('#pushHint').innerHTML = '<b class="lv-warn">Stufe geändert:</b> Code kopieren und bei GitHub im Secret <b>PUSH_SUBSCRIPTIONS</b> den alten Wert ersetzen.';
      };
      show();
      $('#pmode').addEventListener('change', async (e) => { try { await api.push.setMode(e.target.value); } catch (err) { $('#pushBox').textContent = err.message; } show(); });
      $('#pushOn').addEventListener('click', async (e) => { e.target.disabled = true; try { await api.push.subscribe(); } catch (err) { $('#pushBox').textContent = err.message; } e.target.disabled = false; show(); });
      $('#pushTest').addEventListener('click', () => api.push.test().catch((err) => ($('#pushBox').textContent = err.message)));
      $('#pushCopy').addEventListener('click', async (e) => { try { await navigator.clipboard.writeText($('#pushJson').value); api.push.markCopied($('#pushJson').value); e.target.textContent = 'Kopiert ✓'; } catch { $('#pushJson').select(); } });
    }
    if (sec === 'about' && !WEB) {
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
