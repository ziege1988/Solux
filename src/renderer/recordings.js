/* Solux – Aufnahmen: Analyse, Ausrichtung, Beschriftung, Export */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const A = window.SoluxAstro, M = window.SoluxMcIntosh, AL = window.SoluxAlign, U = window.SoluxUI;
  const { fmt, esc } = U;
  const api = window.solux;
  const D2R = Math.PI / 180;
  const MODE_LABEL = { wl: 'Weißlicht', ca: 'Kalzium (Ca-K)' };

  const st = {
    cfg: null, mode: 'wl', file: null, src: null, work: null, time: null, timeSource: '', disc: null, eph: null,
    ref: null, regions: [], regionsDay: null, result: null, method: null, groups: null, extra: [], spotsTotal: 0, out: null, txt: '', run: 0,
  };

  /* ---------------- Worker ---------------- */
  let worker = null, wid = 0; const pending = new Map();
  function computeHere(task, args) {
    return new Promise((res, rej) => setTimeout(() => {
      try {
        if (task === 'align') res(AL.align(args.user, args.ref, args.mode, args.opts));
        else if (task === 'disc') res(AL.detectDisc(args.gray, args.w, args.h));
        else res(AL.detectSpots(args.gray, args.w, args.h, args.disc, args.rotation, args.flip, args.opts));
      } catch (e) { rej(e); }
    }, 30));
  }
  try {
    worker = new Worker('align-worker.js');
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data.result) : p.rej(new Error(e.data.error)); };
    // Startet der Worker nicht, wird im Fenster selbst gerechnet
    worker.onerror = () => { worker = null; for (const [id, p] of pending) { pending.delete(id); computeHere(p.task, p.args).then(p.res, p.rej); } };
  } catch { worker = null; }
  function compute(task, args) {
    if (!worker) return computeHere(task, args);
    return new Promise((res, rej) => { const id = ++wid; pending.set(id, { res, rej, task, args }); worker.postMessage({ id, task, args }); });
  }

  /* ---------------- Start ---------------- */
  async function init() {
    st.cfg = await api.getConfig();
    setMode(st.cfg.recordings.lastMode || 'wl', false);
    $('#legendChk').checked = !!st.cfg.recordings.legend;
    $('#gridChk').checked = !!st.cfg.recordings.grid;
    $('#folder').textContent = st.cfg.recordings.folder || 'wird beim Speichern gewählt';
    updateProfileInfo();
  }

  function setMode(m, rerun = true) {
    st.mode = m;
    if (st.cfg) api.setConfig({ recordings: { lastMode: m } });
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.k === m));
    updateProfileInfo();
    if (rerun && st.src) processImage();
  }
  $('#modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.k !== st.mode) setMode(b.dataset.k); });

  function updateProfileInfo() {
    if (!st.cfg) return;
    const p = st.cfg.profiles[st.mode];
    $('#profileInfo').textContent = p.flip == null ? 'Profil: Spiegelung noch unbekannt' : p.flip ? 'Profil: gespiegelt' : 'Profil: nicht gespiegelt';
    $('#profileInfo').title = p.name;
  }

  /* ---------------- Datei laden ---------------- */
  $('#openBtn').addEventListener('click', async () => { const p = await api.rec.openDialog(); if (p) loadPath(p); });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (!/\.(jpe?g|tiff?|png)$/i.test(f.name)) return toast('Bitte eine JPEG- oder TIFF-Datei ablegen.');
    loadPath(api.rec.pathForFile(f));
  });
  window.__soluxTestLoad = (p) => loadPath(p);

  async function loadPath(p) {
    clearLog(); setState('lädt …');
    try {
      const f = await api.rec.load(p);
      st.file = f;
      let cv;
      if (f.format === 'tiff') {
        cv = document.createElement('canvas'); cv.width = f.width; cv.height = f.height;
        cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f.rgba.buffer, f.rgba.byteOffset, f.rgba.byteLength), f.width, f.height), 0, 0);
      } else {
        const bmp = await createImageBitmap(new Blob([f.bytes], { type: f.format === 'png' ? 'image/png' : 'image/jpeg' }));
        cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
        cv.getContext('2d').drawImage(bmp, 0, 0);
      }
      st.src = cv;
      // Zeit bestimmen
      const t = exifTime(f.exif, st.cfg.recordings.cameraTime);
      if (t) { st.time = t.date; st.timeSource = t.source; } else { st.time = new Date(f.mtime); st.timeSource = 'Dateidatum (keine EXIF-Zeit)'; }
      setTimeField(st.time);
      // Wellenlänge aus Dateiname/Ordner erraten
      if (/(^|[^a-z])(ca|cak|ca-k|calcium|kalzium|caii|393)([^a-z]|$)/i.test(f.path)) setMode('ca', false);
      else if (/(weiss|weiß|wl|white|herschel|kontinuum)/i.test(f.path)) setMode('wl', false);
      $('#empty').hidden = true; $('#rerun').disabled = false;
      processImage();
    } catch (e) {
      logLine(`Datei konnte nicht gelesen werden: ${esc(e.message)}`, 'err'); setState('Fehler');
    }
  }

  function exifTime(ex, cameraTime) {
    if (!ex) return null;
    const raw = ex.DateTimeOriginal || ex.CreateDate || ex.DateTime || ex.ModifyDate;
    if (!raw) return null;
    const m = String(raw).match(/(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m.map(Number);
    const off = ex.OffsetTimeOriginal || ex.OffsetTime;
    if (off && /^[+-]\d{2}:\d{2}$/.test(off)) {
      const sign = off[0] === '-' ? -1 : 1, oh = +off.slice(1, 3), om = +off.slice(4, 6);
      return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s) - sign * (oh * 60 + om) * 60000), source: `EXIF mit Zeitzone ${off}` };
    }
    if (cameraTime === 'utc') return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), source: 'EXIF (Kamera auf UTC)' };
    return { date: new Date(y, mo - 1, d, h, mi, s), source: 'EXIF (Kamera auf Ortszeit)' };
  }
  function setTimeField(d) {
    const p = (n) => String(n).padStart(2, '0');
    $('#capTime').value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    $('#timeSrc').textContent = st.timeSource;
  }
  $('#capTime').addEventListener('change', () => { const d = new Date($('#capTime').value); if (!isNaN(d)) { st.time = d; st.timeSource = 'manuell geändert'; $('#timeSrc').textContent = st.timeSource; } });
  $('#rerun').addEventListener('click', () => st.src && processImage());

  /* ---------------- Protokoll ---------------- */
  function clearLog() { $('#logPre').innerHTML = ''; $('#curveSvg').innerHTML = ''; }
  function ts() { const d = new Date(); return `<span class="ts">${fmt.time.format(d)}.${String(d.getMilliseconds()).padStart(3, '0')}</span>`; }
  function logLine(html, cls = '') {
    const pre = $('#logPre');
    pre.querySelector('.cursor')?.remove();
    pre.insertAdjacentHTML('beforeend', `${ts()}  ${cls ? `<span class="${cls}">${html}</span>` : html}\n<span class="cursor"></span>`);
    pre.scrollTop = pre.scrollHeight;
  }
  function logBar() { const s = document.createElement('span'); s.className = 'hi'; $('#logPre').querySelector('.cursor')?.before(s, document.createTextNode('\n')); return s; }
  function setState(t) { $('#logState').textContent = t; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- Ansicht & Animationen ---------------- */
  let anim = 0;
  function showCanvas(cv) {
    const v = $('#viewCv'), o = $('#ovCv');
    v.width = cv.width; v.height = cv.height; o.width = cv.width; o.height = cv.height;
    v.getContext('2d').drawImage(cv, 0, 0);
  }
  function overlay(fn) {
    cancelAnimationFrame(anim);
    const o = $('#ovCv'), x = o.getContext('2d');
    if (!fn) { x.clearRect(0, 0, o.width, o.height); return; }
    const t0 = performance.now();
    const loop = (t) => { x.clearRect(0, 0, o.width, o.height); fn(x, (t - t0) / 1000); anim = requestAnimationFrame(loop); };
    anim = requestAnimationFrame(loop);
  }
  function limbAnim(d, s) {
    return (x, t) => {
      const p = Math.min(1, t / 0.9), cx = d.cx * s, cy = d.cy * s, r = d.r * s;
      x.lineWidth = Math.max(2, r * 0.008); x.strokeStyle = 'rgba(61,187,108,.95)'; x.setLineDash([r * 0.03, r * 0.03]);
      x.beginPath(); x.arc(cx, cy, r * (1.3 - 0.3 * p), 0, 7); x.stroke(); x.setLineDash([]);
      x.strokeStyle = 'rgba(61,187,108,.6)'; x.beginPath(); x.moveTo(cx - r * 0.05, cy); x.lineTo(cx + r * 0.05, cy); x.moveTo(cx, cy - r * 0.05); x.lineTo(cx, cy + r * 0.05); x.stroke();
    };
  }
  function sweepAnim(d, s) {
    return (x, t) => {
      const cx = d.cx * s, cy = d.cy * s, r = d.r * s, a = t * 2.4;
      x.lineWidth = Math.max(2, r * 0.006);
      const g = x.createConicGradient ? x.createConicGradient(a - Math.PI / 2, cx, cy) : null;
      if (g) { g.addColorStop(0, 'rgba(243,181,68,.0)'); g.addColorStop(0.92, 'rgba(243,181,68,.0)'); g.addColorStop(1, 'rgba(243,181,68,.28)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); }
      x.strokeStyle = 'rgba(243,181,68,.95)'; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r); x.stroke();
      x.strokeStyle = 'rgba(243,181,68,.3)'; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
    };
  }
  function drawCurve(curve, bestShift) {
    const svg = $('#curveSvg'); if (!curve) { svg.innerHTML = ''; return; }
    const n = curve.length, mn = Math.min(...curve), mx = Math.max(...curve);
    let d = ''; for (let i = 0; i < n; i += 2) d += (i ? 'L' : 'M') + ((i / n) * 300).toFixed(1) + ',' + (66 - ((curve[i] - mn) / (mx - mn || 1)) * 60).toFixed(1);
    const bx = (((bestShift % 360) + 360) % 360) / 360 * 300;
    svg.innerHTML = `<path d="${d}" fill="none" stroke="#f3b544" stroke-width="1.2"/><line x1="${bx}" x2="${bx}" y1="0" y2="70" stroke="#3dbb6c" stroke-dasharray="3 3"/>`;
  }

  /* ---------------- Hauptablauf ---------------- */
  async function processImage() {
    const my = ++st.run;
    const alive = () => my === st.run;
    clearLog(); setState('arbeitet …'); $('#saveBtn').disabled = true; $('#manual').hidden = true; $('#saved').textContent = '';
    st.cfg = await api.getConfig(); updateProfileInfo();
    const f = st.file, src = st.src, prof = st.cfg.profiles[st.mode];
    try {
      logLine(`▸ Datei  ${esc(f.name)}  ${src.width}×${src.height} px  ${(f.size / 1048576).toFixed(1)} MB  ${f.format.toUpperCase()}`);
      await sleep(250);
      logLine(`▸ Aufnahmezeit  ${fmt.dateShort.format(st.time)} ${fmt.time.format(st.time)} Ortszeit = ${st.time.toISOString().slice(0, 19).replace('T', ' ')} UTC  <span class="ts">(${esc(st.timeSource)})</span>`);
      logLine(`▸ Modus  ${MODE_LABEL[st.mode]} · Profil „${esc(prof.name)}“`);

      // Arbeitskopie (max. 1800 px)
      const k = Math.min(1, 1800 / Math.max(src.width, src.height));
      const wc = document.createElement('canvas'); wc.width = Math.round(src.width * k); wc.height = Math.round(src.height * k);
      const wx = wc.getContext('2d', { willReadFrequently: true }); wx.drawImage(src, 0, 0, wc.width, wc.height);
      const gray = AL.toGray(wx.getImageData(0, 0, wc.width, wc.height).data, wc.width, wc.height);
      st.work = { canvas: wc, gray, w: wc.width, h: wc.height, k };
      showCanvas(wc);

      logLine('▸ Sonnenrand suchen  (steilster Helligkeitsabfall auf 720 Strahlen, Kreis-Fit)');
      const dWork = await compute('disc', { gray, w: wc.width, h: wc.height });
      if (!alive()) return;
      overlay(limbAnim(dWork, 1)); await sleep(1000);
      st.disc = { cx: dWork.cx / k, cy: dWork.cy / k, r: dWork.r / k };
      st.work.disc = dWork;
      logLine(`  ✓ Mittelpunkt (${st.disc.cx.toFixed(1)}, ${st.disc.cy.toFixed(1)})  r = ${st.disc.r.toFixed(1)} px  · Randabdeckung ${Math.round(dWork.coverage * 100)} %  · Restfehler ${(dWork.residual / k).toFixed(2)} px`, 'ok');

      // Ephemeriden
      const { lat, lon, mount } = st.cfg.location;
      const o = A.solarOrientation(st.time), pos = A.sunAltAz(st.time, lat, lon), q = A.parallacticAngle(st.time, lat, lon);
      st.eph = { ...o, alt: pos.alt, az: pos.az, q, pq: o.P - (mount === 'altaz' ? q : 0), cr: A.carringtonRotation(st.time) };
      logLine(`▸ Ephemeriden  P = ${o.P.toFixed(2)}°  B₀ = ${o.B0.toFixed(2)}°  L₀ = ${o.L0.toFixed(2)}°  CR ${st.eph.cr}`, 'hi');
      logLine(`▸ Sonnenstand  Höhe ${pos.alt.toFixed(1)}°  Azimut ${pos.az.toFixed(1)}°  parallaktischer Winkel ${q.toFixed(1)}°${mount === 'altaz' ? ' (Bildfeldrotation azimutal)' : ''}`);
      if (pos.alt < 0) logLine('  ! Die Sonne stand zur angegebenen Zeit unter dem Horizont – Aufnahmezeit prüfen.', 'warn');

      // Referenz & Regionen
      logLine(`▸ Referenz laden  ${st.mode === 'ca' ? 'SDO/AIA 1700 Å' : 'SDO/HMI Kontinuum'} zur Aufnahmezeit …`);
      overlay(sweepAnim(dWork, 1));
      const [refImg, reg] = await Promise.all([api.sunImage(st.mode, st.time.toISOString()), api.regions(st.time.toISOString())]);
      if (!alive()) return;
      const img = new Image(); await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = refImg.dataUrl; });
      const rc = document.createElement('canvas'); rc.width = rc.height = refImg.size;
      const rx = rc.getContext('2d', { willReadFrequently: true }); rx.drawImage(img, 0, 0);
      st.ref = { gray: AL.toGray(rx.getImageData(0, 0, rc.width, rc.height).data, rc.width, rc.height), w: rc.width, h: rc.height, date: new Date(refImg.date), label: refImg.label };
      const dtMin = Math.round((st.ref.date - st.time) / 60000);
      logLine(`  ✓ ${refImg.label}  ${st.ref.date.toISOString().slice(0, 16).replace('T', ' ')} UTC  (Δt ${dtMin >= 0 ? '+' : ''}${dtMin} min)`, Math.abs(dtMin) > 180 ? 'warn' : 'ok');
      st.regions = reg.regions || []; st.regionsDay = reg.day;
      if (reg.day) logLine(`▸ NOAA-Regionen  ${st.regions.filter((r) => r.type === 'spots').length} Fleckengruppen, ${st.regions.filter((r) => r.type !== 'spots').length} Plages  (SRS gültig ${reg.validAt.slice(0, 10)} 00 UT, auf Aufnahmezeit gedreht)`);
      else logLine('▸ NOAA-Regionen  für dieses Datum nicht im lokalen Speicher (60 Tage) – Beschriftung nur mit erkannten Flecken.', 'warn');

      // Ausrichtung
      logLine(`▸ Kreuzkorrelation  360° in 0,5°-Schritten, ${prof.flip == null ? 'mit und ohne Spiegelung' : prof.flip ? 'gespiegelt (Profil)' : 'ungespiegelt (Profil)'}`);
      const bar = logBar();
      let pct = 0; const barTimer = setInterval(() => { pct = Math.min(95, pct + 4); bar.textContent = `  [${'█'.repeat(pct / 5)}${'░'.repeat(20 - pct / 5)}] ${pct} %`; }, 70);
      let res;
      try {
        res = await compute('align', { user: { gray: gray.slice(), w: wc.width, h: wc.height }, ref: { gray: st.ref.gray, w: st.ref.w, h: st.ref.h }, mode: st.mode, opts: { knownFlip: prof.flip } });
      } finally { clearInterval(barTimer); }
      if (!alive()) return;
      bar.textContent = `  [${'█'.repeat(20)}] 100 %`;
      res.log.forEach((l) => logLine('  ' + esc(l)));
      drawCurve(res.curve, -res.rotation);
      st.result = res;

      let rotation = res.rotation, flip = res.flip, method = 'auto';
      if (res.ok) {
        logLine(`  ✓ Drehung ${rotation.toFixed(2)}°${flip ? ' · gespiegelt' : ''} · Sicherheit ${(res.ncc * 100).toFixed(0)} % / ×${res.ratio.toFixed(1)}`, 'ok');
      } else {
        overlay(null);
        logLine(`  ✗ ${esc(res.reason)}`, 'err');
        setState('Rückfrage');
        const choice = await askContinue(res.reason, prof);
        if (!alive()) return;
        if (choice === 'cancel') { logLine('Abgebrochen.', 'warn'); setState('abgebrochen'); return; }
        if (choice === 'field') {
          const fr = fieldRotation(prof);
          rotation = fr.rotation; flip = fr.flip; method = 'field';
          logLine(`  → Bildfeldrotation fortgeschrieben aus Aufnahme ${fr.from}: Drehung ${rotation.toFixed(2)}°${flip ? ' · gespiegelt' : ''}`, 'warn');
        } else if (choice === 'manual') {
          logLine('  → Manuelle Ausrichtung …', 'warn');
          const m = await manualAlign(res.ok ? res : { rotation: prof.flip != null ? res.rotation : 0, flip: prof.flip ?? false });
          if (!alive()) return;
          rotation = m.rotation; flip = m.flip; method = 'manual';
          logLine(`  ✓ Manuell: Drehung ${rotation.toFixed(1)}°${flip ? ' · gespiegelt' : ''}`, 'ok');
        } else { rotation = 0; flip = false; method = 'none'; logLine('  → Ohne Ausrichtung fortgefahren – keine Beschriftung der Regionen.', 'warn'); }
      }
      st.align = { rotation, flip, method };

      // Flecken erkennen & zuordnen
      overlay(null);
      if (method !== 'none') {
        logLine('▸ Flecken erkennen  (Kontrast gegen Ring-Median, Zusammenhangskomponenten)');
        const spots = await compute('spots', { gray: gray.slice(), w: wc.width, h: wc.height, disc: dWork, rotation, flip, opts: { grid: 520, threshold: st.mode === 'ca' ? -0.38 : -0.14 } });
        if (!alive()) return;
        st.spotsTotal = spots.length;
        const m = AL.matchSpots(spots, st.regions.filter((r) => r.type === 'spots' || st.mode === 'ca'));
        st.groups = m.matched; st.extra = st.mode === 'ca' ? [] : m.extra; // im Ca-Licht sind dunkle Zellen des Netzwerks keine Flecken
        logLine(`  ✓ ${spots.length} Flecken/Poren erkannt`, 'ok');
        for (const g of st.groups) {
          const r = g.region;
          if (r.type !== 'spots' && !g.spots.length) continue;
          logLine(`  • AR ${r.region}  ${esc(r.spotClass || 'Plage')}  ${esc(M.magSymbol(r.magClass))}  ${r.location}  → ${g.spots.length ? g.spots.length + ' im Bild' : 'im Bild nicht erkannt'}`);
        }
        if (st.extra.length) logLine(`  • ${st.extra.length} weitere Gruppe(n) ohne NOAA-Nummer`, 'warn');
        if (method === 'auto' || method === 'manual') {
          const prof2 = await api.rec.profileUpdate(st.mode, { time: st.time.toISOString(), rotation, flip, pq: st.eph.pq, auto: method === 'auto' });
          st.cfg.profiles[st.mode] = prof2; updateProfileInfo();
        }
      } else { st.groups = null; st.extra = []; }

      logLine('▸ Ausrichten (Norden oben, Osten links), beschriften, Legende setzen');
      renderPreview();
      st.txt = buildText();
      $('#txtOut').textContent = st.txt;
      $('#txtName').textContent = baseName() + '.txt';
      logLine(`✓ Fertig`, 'ok');
      setState('fertig'); $('#saveBtn').disabled = false;
    } catch (e) {
      overlay(null);
      if (!alive()) return;
      logLine(`Fehler: ${esc(e.message)}`, 'err'); setState('Fehler');
    }
  }

  /** Drehung aus der letzten Ausrichtung mit Bildfeldrotation fortschreiben. */
  function fieldRotation(prof) {
    const hist = (prof.history || []).slice().sort((a, b) => Math.abs(new Date(a.time) - st.time) - Math.abs(new Date(b.time) - st.time));
    const last = hist[0];
    const rot = last.rotation + (prof.sigma || 1) * A.norm180(st.eph.pq - last.pq);
    const sameDay = new Date(last.time).toDateString() === st.time.toDateString();
    return { rotation: A.norm180(rot), flip: last.flip, from: `${fmt.dateShort.format(new Date(last.time))} ${fmt.hm.format(new Date(last.time))}${sameDay ? '' : ' (anderer Tag – Kameradrehung prüfen)'}` };
  }

  /* ---------------- Rückfrage ---------------- */
  function askContinue(reason, prof) {
    return new Promise((resolve) => {
      $('#dlgText').textContent = reason;
      const hasHist = (prof.history || []).length > 0;
      const btns = [
        hasHist && ['field', 'Letzte Ausrichtung fortschreiben', `Drehung aus deiner letzten Aufnahme, korrigiert um die Bildfeldrotation (${st.cfg.location.mount === 'altaz' ? 'azimutal' : 'parallaktisch'}).`],
        ['manual', 'Manuell ausrichten', 'Mit Regler drehen und spiegeln, Gradnetz und Beschriftung als Kontrolle.'],
        ['none', 'Ohne Ausrichtung fortfahren', 'Bild bleibt wie aufgenommen, ohne Regionsbeschriftung.'],
        ['cancel', 'Abbrechen', ''],
      ].filter(Boolean);
      $('#dlgBtns').innerHTML = btns.map(([k, t, s], i) => `<button class="${i === 0 ? 'pbtn' : 'ghost'}" data-k="${k}">${t}${s ? `<small>${s}</small>` : ''}</button>`).join('');
      $('#modal').hidden = false;
      $('#dlgBtns').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; $('#modal').hidden = true; resolve(b.dataset.k); };
    });
  }

  function manualAlign(start) {
    return new Promise((resolve) => {
      const panel = $('#manual'), rng = $('#manRot'), num = $('#manRotNum'), fl = $('#manFlip');
      rng.value = num.value = (start.rotation || 0).toFixed(1); fl.checked = !!start.flip;
      panel.hidden = false;
      const upd = (v) => { rng.value = num.value = v; st.align = { rotation: +v, flip: fl.checked, method: 'manual' }; st.groups = st.regions.length ? AL.matchSpots([], st.regions.filter((r) => r.type === 'spots')).matched : null; st.extra = []; renderPreview(); };
      rng.oninput = () => upd(rng.value); num.onchange = () => upd(num.value); fl.onchange = () => upd(rng.value);
      upd(rng.value);
      $('#manOk').onclick = () => { panel.hidden = true; resolve({ rotation: +rng.value, flip: fl.checked }); };
    });
  }

  /* ---------------- Ausgabe zeichnen ---------------- */
  function renderPreview() {
    const w = st.work;
    const cv = renderOutput(w.canvas, w.disc, { legend: $('#legendChk').checked, grid: $('#gridChk').checked });
    st.preview = cv;
    showCanvas(cv);
  }
  $('#legendChk').addEventListener('change', () => { if (st.align) renderPreview(); });
  $('#gridChk').addEventListener('change', () => { if (st.align) renderPreview(); });

  function renderOutput(srcCv, disc, opt) {
    const al = st.align || { rotation: 0, flip: false, method: 'none' };
    const r = disc.r, S = Math.round(Math.min(9000, r * 2.3));
    const L = opt.legend ? Math.round(S * 0.46) : 0;
    const cv = document.createElement('canvas'); cv.width = S + L; cv.height = S;
    const x = cv.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, S);
    x.save(); x.translate(S / 2, S / 2); x.rotate(al.rotation * D2R); if (al.flip) x.scale(-1, 1); x.translate(-disc.cx, -disc.cy); x.drawImage(srcCv, 0, 0); x.restore();
    const c = S / 2, fs = Math.max(11, Math.round(r * 0.042)), mono = '"SF Mono", Menlo, monospace';
    const accent = st.mode === 'ca' ? '#d7c0ff' : '#f3b544';
    if (al.method !== 'none') {
      if (opt.grid) drawGrid(x, c, c, r);
      x.fillStyle = '#9a958d'; x.font = `600 ${fs}px ${mono}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('N', c, c - r - fs * 0.9); x.fillText('O', c - r - fs * 0.9, c); x.fillText('W', c + r + fs * 0.9, c); x.fillText('S', c, c + r + fs * 0.9);
      drawLabels(x, c, r, fs, mono, accent);
    }
    x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillStyle = '#b9b5ad'; x.font = `500 ${Math.round(fs * 0.85)}px ${mono}`;
    x.fillText(`${fmt.utcDate(st.time)} ${st.time.toISOString().slice(11, 16)} UTC · ${MODE_LABEL[st.mode]}`, fs * 0.8, S - fs * 0.9);
    x.textAlign = 'right'; x.fillStyle = '#6f6a63';
    x.fillText(al.method === 'none' ? 'nicht ausgerichtet' : 'N oben · O links · Solux', S - fs * 0.8, S - fs * 0.9);
    if (L) drawLegend(x, S, L, fs, mono, accent);
    return cv;
  }

  function drawGrid(x, cx, cy, r) {
    const B0 = st.eph.B0;
    x.save(); x.lineWidth = Math.max(1, r * 0.002);
    const line = (pts) => { let pen = false; x.beginPath(); for (const p of pts) { if (!p.visible) { pen = false; continue; } const X = cx + p.x * r, Y = cy - p.y * r; pen ? x.lineTo(X, Y) : x.moveTo(X, Y); pen = true; } x.stroke(); };
    for (let lat = -75; lat <= 75; lat += 15) { x.strokeStyle = lat === 0 ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.1)'; const pts = []; for (let l = -90; l <= 90; l += 2) pts.push(A.heliographicToDisk(lat, l, B0)); line(pts); }
    for (let lon = -90; lon <= 90; lon += 15) { x.strokeStyle = lon === 0 ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.1)'; const pts = []; for (let b = -90; b <= 90; b += 2) pts.push(A.heliographicToDisk(b, lon, B0)); line(pts); }
    x.restore();
  }

  function labelItems() {
    const items = [];
    if (st.groups) for (const g of st.groups) {
      const reg = g.region;
      if (reg.type !== 'spots' && st.mode !== 'ca') continue;
      if (!reg.visible) continue;
      const style = st.cfg.recordings.labelStyle;
      items.push({ x: g.x, y: g.y, text: style === 'short' || !reg.spotClass ? `AR ${reg.region}` : `AR ${reg.region} ${reg.spotClass}`, dim: !g.spots.length && reg.type === 'spots', plage: reg.type !== 'spots' });
    }
    for (const e of st.extra || []) items.push({ x: e.x, y: e.y, text: 'neu?', dim: true });
    return items;
  }

  function drawLabels(x, c, r, fs, mono, accent) {
    x.font = `600 ${fs}px ${mono}`; x.textBaseline = 'middle'; x.textAlign = 'left';
    const boxes = [];
    for (const it of labelItems().sort((a, b) => b.y - a.y)) {
      const px = c + it.x * r, py = c - it.y * r;
      const tw = x.measureText(it.text).width;
      const ang = Math.atan2(-(py - c), px - c);
      let lx = px + Math.cos(ang) * r * 0.16, ly = py - Math.sin(ang) * r * 0.16;
      const right = Math.cos(ang) >= 0;
      let bx = right ? lx + 4 : lx - tw - 4;
      bx = Math.max(fs * 0.4, Math.min(c * 2 - tw - fs * 0.4, bx));
      ly = Math.max(fs, Math.min(c * 2 - fs * 2, ly));
      for (let k = 0; k < 12 && boxes.some((b) => bx < b.x1 && bx + tw > b.x0 && ly - fs * 0.7 < b.y1 && ly + fs * 0.7 > b.y0); k++) ly += fs * 1.25 * (it.y >= 0 ? -1 : 1);
      boxes.push({ x0: bx - 2, x1: bx + tw + 2, y0: ly - fs * 0.7, y1: ly + fs * 0.7 });
      x.globalAlpha = it.dim ? 0.55 : 1;
      x.strokeStyle = it.plage ? '#b48cff' : accent; x.lineWidth = Math.max(1, r * 0.003);
      const d0 = Math.hypot(lx - px, ly - py) || 1;
      x.beginPath(); x.moveTo(px + ((lx - px) / d0) * r * 0.035, py + ((ly - py) / d0) * r * 0.035); x.lineTo(lx, ly); x.stroke();
      x.lineWidth = Math.max(2, fs * 0.25); x.strokeStyle = 'rgba(0,0,0,.75)'; x.strokeText(it.text, bx, ly);
      x.fillStyle = it.plage ? '#c9b0ff' : accent; x.fillText(it.text, bx, ly);
      x.globalAlpha = 1;
    }
  }

  function legendLines() {
    const al = st.align, e = st.eph, loc = st.cfg.location;
    const how = { auto: 'automatisch (SDO-Abgleich)', field: 'fortgeschrieben (Bildfeldrotation)', manual: 'manuell', none: 'nicht ausgerichtet' }[al.method];
    const lines = [
      ['h', `Solux · ${MODE_LABEL[st.mode]}`],
      ['t', `${fmt.utcDate(st.time)}  ${st.time.toISOString().slice(11, 19)} UTC`],
      ['m', `Ortszeit ${fmt.time.format(st.time)} · ${loc.name}`],
      ['m', `Sonnenhöhe ${e.alt.toFixed(1)}° · Azimut ${e.az.toFixed(0)}°`],
      ['m', `P ${e.P.toFixed(1)}°  B₀ ${e.B0.toFixed(2)}°  L₀ ${e.L0.toFixed(1)}°  CR ${e.cr}`],
      ['m', `Ausrichtung ${how}${al.method !== 'none' ? ` · ${al.rotation.toFixed(1)}°${al.flip ? ' · gespiegelt' : ''}` : ''}`],
      ['g', ''],
    ];
    if (st.groups && st.groups.length) {
      lines.push(['s', st.mode === 'ca' ? 'Aktive Regionen' : 'Fleckengruppen (NOAA)']);
      for (const g of st.groups) {
        const r = g.region;
        if (r.type !== 'spots' && st.mode !== 'ca') continue;
        if (r.type !== 'spots') { lines.push(['a', `AR ${r.region}  Plage  ${r.location}`]); continue; }
        lines.push(['a', `AR ${r.region}  ${r.spotClass}  ${M.magSymbol(r.magClass) || '–'}  ${r.location}`]);
        lines.push(['m', `  ${r.area ?? '–'} MH · ${r.numberSpots ?? '–'} Flecken · M-Flare ${r.probs.m ?? '–'} %`]);
        const z = M.Z[r.spotClass[0]]; if (z) lines.push(['d', `  ${z}`]);
      }
      if (st.extra.length) lines.push(['m', `${st.extra.length} Gruppe(n) ohne NOAA-Nummer („neu?“)`]);
    } else if (al.method !== 'none') lines.push(['m', 'Keine nummerierten Regionen sichtbar.']);
    lines.push(['g', '']);
    lines.push(['d', 'Daten: NOAA SWPC (SRS), NASA SDO via Helioviewer']);
    return lines;
  }

  function drawLegend(x, S, L, fs, mono, accent) {
    x.fillStyle = '#0b0b0c'; x.fillRect(S, 0, L, S);
    x.fillStyle = '#1e1e22'; x.fillRect(S, 0, Math.max(1, fs * 0.08), S);
    const pad = fs * 1.4, maxW = L - pad * 2; let y = pad * 1.4;
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    const wrap = (txt, font) => { x.font = font; const out = []; let cur = ''; for (const w of txt.split(' ')) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { out.push(cur); cur = '  ' + w; } else cur = t; } out.push(cur); return out; };
    for (const [kind, text] of legendLines()) {
      if (y > S - pad) break;
      let font, color, lh;
      if (kind === 'h') { font = `700 ${Math.round(fs * 1.35)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; color = '#ece8e1'; lh = fs * 1.9; }
      else if (kind === 's') { font = `600 ${Math.round(fs * 0.8)}px ${mono}`; color = '#6f6a63'; lh = fs * 1.5; }
      else if (kind === 'a') { font = `600 ${Math.round(fs * 0.95)}px ${mono}`; color = accent; lh = fs * 1.35; }
      else if (kind === 't') { font = `500 ${Math.round(fs * 1.0)}px ${mono}`; color = accent; lh = fs * 1.4; }
      else if (kind === 'd') { font = `400 ${Math.round(fs * 0.78)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; color = '#8e8a83'; lh = fs * 1.15; }
      else if (kind === 'g') { y += fs * 0.6; continue; }
      else { font = `400 ${Math.round(fs * 0.82)}px ${mono}`; color = '#b9b5ad'; lh = fs * 1.2; }
      x.fillStyle = color;
      for (const ln of wrap(kind === 's' ? text.toUpperCase() : text, font)) { if (y > S - pad) break; x.font = font; x.fillText(ln, S + pad, y); y += lh; }
    }
  }

  /* ---------------- Textdatei ---------------- */
  function baseName() {
    const d = st.time.toISOString();
    return `Sonne_${st.mode === 'ca' ? 'CaK' : 'WL'}_${d.slice(0, 10)}_${d.slice(11, 13)}${d.slice(14, 16)}UTC`;
  }

  function buildText() {
    const e = st.eph, al = st.align, loc = st.cfg.location, r = st.result;
    const L = [];
    const how = { auto: 'automatisch per Abgleich mit SDO', field: 'fortgeschrieben aus letzter Ausrichtung (Bildfeldrotation)', manual: 'manuell', none: 'nicht ausgerichtet' }[al.method];
    L.push(`SOLUX · Auswertung ${MODE_LABEL[st.mode]}`);
    L.push('='.repeat(60));
    L.push(`Datei:          ${st.file.name}`);
    L.push(`Aufnahme:       ${st.time.toISOString().replace('T', ' ').slice(0, 19)} UTC  (Ortszeit ${fmt.dateShort.format(st.time)} ${fmt.time.format(st.time)})`);
    L.push(`Zeitquelle:     ${st.timeSource}`);
    L.push(`Standort:       ${loc.name}  ${loc.lat.toFixed(4)}° N  ${loc.lon.toFixed(4)}° E  · Montierung ${loc.mount === 'altaz' ? 'azimutal' : 'parallaktisch'}`);
    L.push(`Sonnenstand:    Höhe ${e.alt.toFixed(1)}°  Azimut ${e.az.toFixed(1)}°  parallaktischer Winkel ${e.q.toFixed(1)}°`);
    L.push(`Orientierung:   P ${e.P.toFixed(2)}°  B0 ${e.B0.toFixed(2)}°  L0 ${e.L0.toFixed(2)}°  Carrington-Rotation ${e.cr}`);
    L.push(`Sonnenscheibe:  Mittelpunkt (${st.disc.cx.toFixed(1)}, ${st.disc.cy.toFixed(1)}) px  Radius ${st.disc.r.toFixed(1)} px  (${(959.63 / A.sunApparent(st.time).R / st.disc.r).toFixed(3)}″/px)`);
    L.push(`Ausrichtung:    ${how}${al.method !== 'none' ? `, Drehung ${al.rotation.toFixed(2)}°${al.flip ? ', gespiegelt' : ''}` : ''}`);
    if (r && al.method === 'auto') L.push(`                Korrelation ${r.ncc.toFixed(3)}, Eindeutigkeit ×${r.ratio.toFixed(2)}, ${r.groups} Fleckengruppen in der Referenz`);
    if (st.ref) L.push(`Referenz:       ${st.ref.label} ${st.ref.date.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    L.push(`Ergebnis:       Norden oben, Osten links`);
    L.push('');
    if (st.groups) {
      const spots = st.groups.filter((g) => g.region.type === 'spots');
      L.push(`FLECKENGRUPPEN (NOAA, ${st.regionsDay ? 'SRS vom ' + st.regionsDay : 'keine Daten'})  ·  ${st.spotsTotal} Flecken/Poren im Bild erkannt`);
      L.push('-'.repeat(60));
      for (const g of spots) {
        const reg = g.region, d = M.decode(reg.spotClass, reg.magClass), risk = M.riskOf(reg.spotClass, reg.magClass, reg.probs);
        const hel = A.diskToHeliographic(g.x, g.y, e.B0);
        L.push(`AR ${reg.region}   ${reg.spotClass.padEnd(4)} ${(M.magSymbol(reg.magClass) || '–').padEnd(4)} ${reg.location}   Fläche ${reg.area ?? '–'} MH   ${reg.numberSpots ?? '–'} Flecken (NOAA)`);
        L.push(`   Im Bild: ${g.spots.length ? `${g.spots.length} Fleck(e) erkannt bei ${hel ? A.formatLocation(hel.lat, hel.cmd) : '–'}` : 'nicht erkannt (zu klein, Seeing oder Randnähe)'}`);
        for (const p of d.parts) L.push(`   ${p.key}  ${p.title}: ${p.text}`);
        for (const m of d.mag) L.push(`   ${m.key}  ${m.title}: ${m.text}`);
        L.push(`   Flare-Potenzial: ${risk.label} – ${risk.text}`);
        L.push(`   NOAA-Wahrscheinlichkeit 24 h: C ${reg.probs.c ?? '–'} %, M ${reg.probs.m ?? '–'} %, X ${reg.probs.x ?? '–'} %, Protonen ${reg.probs.p ?? '–'} %`);
        if (reg.flares.c || reg.flares.m || reg.flares.x) L.push(`   Flares am Meldetag: ${reg.flares.c}× C, ${reg.flares.m}× M, ${reg.flares.x}× X`);
        if (reg.firstDate) L.push(`   Erstmals beobachtet: ${reg.firstDate.slice(0, 10)}`);
        L.push('');
      }
      const plages = st.groups.filter((g) => g.region.type !== 'spots');
      if (st.mode === 'ca' && plages.length) {
        L.push('PLAGES OHNE FLECKEN (im Kalziumlicht hell)');
        L.push('-'.repeat(60));
        for (const g of plages) L.push(`AR ${g.region.region}   ${g.region.location}`);
        L.push('');
      }
      if (st.extra.length) {
        L.push('NICHT NUMMERIERTE GRUPPEN ("neu?")');
        L.push('-'.repeat(60));
        for (const x of st.extra) { const hel = A.diskToHeliographic(x.x, x.y, e.B0); L.push(`   ${hel ? A.formatLocation(hel.lat, hel.cmd) : '–'}   ${x.spots.length} Fleck(e) – evtl. neu entstanden oder Pore`); }
        L.push('');
      }
    } else L.push('Keine Regionsbeschriftung (Bild nicht ausgerichtet).');
    L.push('Begriffe: McIntosh-Klasse Zpc (Z = Gruppentyp, p = Penumbra, c = Verteilung);');
    L.push('Mt.-Wilson-Klasse α/β/γ/δ = magnetische Komplexität. MH = millionstel Sonnenhemisphäre.');
    L.push('Quellen: NOAA SWPC Solar Region Summary · NASA SDO (HMI/AIA) via Helioviewer.org');
    L.push(`Erstellt mit Solux ${st.cfg.version} am ${fmt.dateShort.format(new Date())}`);
    return L.join('\n');
  }

  /* ---------------- Speichern ---------------- */
  $('#folderBtn').addEventListener('click', async () => { const f = await api.rec.chooseFolder(); if (f) { $('#folder').textContent = f; st.cfg.recordings.folder = f; } });
  $('#saveBtn').addEventListener('click', async () => {
    let folder = st.cfg.recordings.folder;
    if (!folder) { folder = await api.rec.chooseFolder(); if (!folder) return; $('#folder').textContent = folder; st.cfg.recordings.folder = folder; }
    $('#saveBtn').disabled = true; $('#saveInfo').textContent = 'Erzeuge JPEG in voller Auflösung …';
    try {
      await sleep(30);
      const cv = renderOutput(st.src, st.disc, { legend: $('#legendChk').checked, grid: $('#gridChk').checked });
      const q = (st.cfg.recordings.jpegQuality || 95) / 100;
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
      const res = await api.rec.save({ folder, baseName: baseName(), jpeg: await blob.arrayBuffer(), txt: st.txt });
      $('#saved').innerHTML = `Gespeichert: <a id="reveal">${esc(res.jpgPath.split('/').pop())}</a>${res.txtPath ? ' + ' + esc(res.txtPath.split('/').pop()) : ''} · ${cv.width}×${cv.height} px`;
      $('#reveal').onclick = () => api.rec.reveal(res.jpgPath);
      toast('Bild und Textdatei gespeichert.');
    } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message); }
    $('#saveBtn').disabled = false; $('#saveInfo').textContent = 'JPEG + Textdatei';
  });

  let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 3500); }

  init();
})();
