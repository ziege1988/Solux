/* Solux – Aufnahmen: Analyse, Ausrichtung, Beschriftung, Export */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const A = window.SoluxAstro, M = window.SoluxMcIntosh, AL = window.SoluxAlign, U = window.SoluxUI;
  const { fmt, esc } = U;
  const api = window.solux;
  const D2R = Math.PI / 180;
  const MODE_LABEL = { wl: 'Weißlicht', ca: 'Kalzium (Ca-K)' };
  const TYPE_LABEL = { full: 'ganze Sonne', partial: 'Ausschnitt mit Sonnenrand', surface: 'Oberfläche ohne Rand' };

  const st = {
    cfg: null, mode: 'wl', file: null, src: null, work: null, time: null, timeSource: '', disc: null, eph: null,
    imgType: 'auto', type: 'full', scaleFull: null,
    ref: null, regions: [], regionsDay: null, result: null, method: null, groups: null, extra: [], spotsTotal: 0, out: null, txt: '', run: 0,
  };

  /* ---------------- Worker ---------------- */
  let worker = null, wid = 0; const pending = new Map();
  function computeHere(task, args) {
    return new Promise((res, rej) => setTimeout(() => {
      try {
        if (task === 'align') res(AL.align(args.user, args.ref, args.mode, args.opts));
        else if (task === 'disc') res(AL.detectDisc(args.gray, args.w, args.h));
        else if (task === 'classify') res(AL.classifyImage(args.gray, args.w, args.h, args.opts));
        else if (task === 'surface') res(AL.alignSurface(args.user, args.refSpots, args.mode, args.opts));
        else if (task === 'blobs') res(AL.detectBlobs(args.gray, args.w, args.h, args.opts));
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
  // Nur für automatische Tests (Entwicklungsmodus): Datei laden und Einordnung vorbelegen/bestätigen
  window.__soluxTestLoad = (p, o) => {
    loadPath(p);
    if (o) setTimeout(() => {
      if (o.type) $('#inType').value = o.type;
      if (o.date) { $('#inDate').value = o.date; }
      if (o.time) { $('#inTime').value = o.time; $('#inNoTime').checked = false; $('#inTime').disabled = false; }
      if (o.noTime) { $('#inNoTime').checked = true; }
      if (o.focal) $('#inFocal').value = o.focal;
      if (o.pixel) $('#inPixel').value = o.pixel;
      if (o.mode) $(`#inMode [data-k="${o.mode}"]`).click();
      updateIntakeScale();
      if (o.submit !== false) $('#intakeForm').requestSubmit();
    }, o.delay || 1500);
  };

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
      // Datum aus dem Dateinamen (EXIF ist nach der Bildbearbeitung nicht verlässlich)
      st.nameDate = window.SoluxFileDate.parseNameDate(f.name);
      st.time = null; st.timeUnknown = false;
      // Wellenlänge aus Dateiname/Ordner erraten
      if (/(^|[^a-z])(ca|cak|ca-k|calcium|kalzium|caii|393)([^a-z]|$)/i.test(f.path)) setMode('ca', false);
      else if (/(weiss|weiß|wl|white|herschel|kontinuum)/i.test(f.path)) setMode('wl', false);
      $('#empty').hidden = true; $('#intakeBtn').disabled = false;
      st.imgType = 'auto';
      showCanvas(cv);
      setState('wartet auf Einordnung');
      if (await askIntake()) processImage(); else { setState('bereit'); logLine('Auswertung abgebrochen – über „Einordnung …“ jederzeit starten.', 'warn'); }
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
  /* ---------------- Einordnung (Datum, Wellenlänge, Bildart, Maßstab) ---------------- */
  const pad2 = (n) => String(n).padStart(2, '0');
  function intakeScale() {
    const f = parseFloat($('#inFocal').value), px = parseFloat($('#inPixel').value), bin = parseInt($('#inBin').value, 10) || 1;
    return f > 0 && px > 0 ? (206.265 * px * bin) / f : null;
  }
  function updateIntakeScale() {
    const sc = intakeScale();
    const need = ['partial', 'surface', 'auto'].includes($('#inType').value);
    $('#inScale').textContent = sc
      ? `${sc.toFixed(3).replace('.', ',')}″ pro Pixel · Sonnendurchmesser ≈ ${Math.round((2 * 959.6) / sc)} px`
      : need ? 'Ohne Maßstab: Ausschnitte nur mit langem Randbogen, Oberflächenbilder gar nicht auswertbar.' : 'Für die ganze Sonne nicht nötig.';
  }
  function askIntake() {
    return new Promise((resolve) => {
      const z = $('#inZone'), nd = st.nameDate;
      const setFields = (d, zone) => {
        if (!d) { $('#inDate').value = ''; $('#inTime').value = ''; return; }
        if (zone === 'utc') { $('#inDate').value = d.toISOString().slice(0, 10); $('#inTime').value = st.timeUnknown ? '' : d.toISOString().slice(11, 19); }
        else { $('#inDate').value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; $('#inTime').value = st.timeUnknown ? '' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
      };
      let hint = '';
      if (st.time) { z.value = 'local'; setFields(st.time, 'local'); $('#inNoTime').checked = !!st.timeUnknown; hint = 'Zuletzt verwendete Einordnung.'; }
      else if (nd) {
        z.value = nd.time && nd.time.utc ? 'utc' : 'local';
        $('#inDate').value = `${nd.y}-${pad2(nd.m)}-${pad2(nd.d)}`;
        $('#inTime').value = nd.time ? `${pad2(nd.time.hh)}:${pad2(nd.time.mm)}:${pad2(nd.time.ss)}` : '';
        $('#inNoTime').checked = !nd.time;
        hint = `Aus dem Dateinamen erkannt: ${nd.text}.` + (nd.yearGuessed ? ` <b class="lv-warn">Das Jahr steht nicht im Namen – ${nd.y} angenommen. Bitte prüfen!</b>` : '') + (nd.time ? '' : ' Keine Uhrzeit im Namen.');
      } else { z.value = 'local'; setFields(null); $('#inNoTime').checked = false; hint = '<b class="lv-warn">Kein Datum im Dateinamen gefunden – bitte Datum und Uhrzeit eintragen.</b>'; }
      z.onchange = () => { const cur = readTime(z.value === 'utc' ? 'local' : 'utc'); if (cur) setFields(cur, z.value); };
      const syncNoTime = () => { $('#inTime').disabled = $('#inNoTime').checked; };
      $('#inNoTime').onchange = syncNoTime; syncNoTime();
      $('#inFile').textContent = `${st.file.name} · ${st.src.width}×${st.src.height} px`;
      $('#inSrc').innerHTML = hint + ' Datum und Uhrzeit bestimmen Referenzbild und Fleckenpositionen.';
      const setM = (m) => document.querySelectorAll('#inMode button').forEach((b) => b.classList.toggle('on', b.dataset.k === m));
      let mode = st.mode; setM(mode);
      $('#inMode').onclick = (e) => { const b = e.target.closest('button'); if (b) { mode = b.dataset.k; setM(mode); } };
      $('#inType').value = st.imgType || 'auto';
      const o = st.cfg.recordings.optics || {};
      $('#inFocal').value = o.focal || ''; $('#inPixel').value = o.pixel || ''; $('#inBin').value = String(o.binning || 1);
      ['inFocal', 'inPixel', 'inBin', 'inType'].forEach((id) => { $('#' + id).oninput = updateIntakeScale; $('#' + id).onchange = updateIntakeScale; });
      updateIntakeScale();
      $('#intake').hidden = false;
      setTimeout(() => ($('#inDate').value ? $('#inStart') : $('#inDate')).focus(), 50);
      const close = (ok) => { $('#intake').hidden = true; resolve(ok); };
      $('#inCancel').onclick = () => close(false);
      $('#intakeForm').onsubmit = (e) => {
        e.preventDefault();
        if (!$('#inDate').value) { $('#inSrc').innerHTML = '<b class="lv-bad">Bitte das Aufnahmedatum eintragen.</b>'; return; }
        if (!$('#inNoTime').checked && !$('#inTime').value) { $('#inSrc').innerHTML = '<b class="lv-bad">Bitte die Uhrzeit eintragen oder „Uhrzeit unbekannt“ anhaken.</b>'; return; }
        const t = readTime(z.value);
        if (!t || isNaN(t)) { $('#inSrc').innerHTML = '<b class="lv-bad">Datum oder Uhrzeit ist ungültig.</b>'; return; }
        st.time = t; st.timeUnknown = $('#inNoTime').checked;
        st.timeSource = st.timeUnknown ? 'Datum bestätigt, Uhrzeit unbekannt (12:00 Ortszeit angenommen)' : nd ? 'Dateiname, im Dialog bestätigt' : 'im Dialog eingetragen';
        st.imgType = $('#inType').value;
        st.scaleFull = intakeScale();
        const optics = { focal: parseFloat($('#inFocal').value) || null, pixel: parseFloat($('#inPixel').value) || null, binning: parseInt($('#inBin').value, 10) || 1 };
        st.cfg.recordings.optics = optics; api.setConfig({ recordings: { optics } });
        if (mode !== st.mode) setMode(mode, false);
        $('#intakeInfo').textContent = `${fmt.dateShort.format(st.time)} ${st.timeUnknown ? '(Uhrzeit unbekannt)' : fmt.time.format(st.time)} · ${MODE_LABEL[st.mode]}`;
        close(true);
      };
    });
  }
  /** Datum/Uhrzeit aus dem Dialog lesen (Uhrzeit unbekannt = 12:00 Ortszeit). */
  function readTime(zone) {
    const dv = $('#inDate').value; if (!dv) return null;
    if ($('#inNoTime').checked) return new Date(`${dv}T12:00:00`);
    const tv = $('#inTime').value; if (!tv) return null;
    return new Date(`${dv}T${tv.length === 5 ? tv + ':00' : tv}${zone === 'utc' ? 'Z' : ''}`);
  }
  $('#intakeBtn').addEventListener('click', async () => { if (st.src && (await askIntake())) processImage(); });

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
  /** Bildpixel -> Sonnenkoordinaten (Radien, x West+, y Nord+) bei gegebener Ausrichtung. */
  function mapToSun(u, v, disc, rotation, flip) {
    let dx = u - disc.cx; const dy = v - disc.cy; if (flip) dx = -dx;
    const c = Math.cos(rotation * D2R), s = Math.sin(rotation * D2R);
    return { x: (dx * c - dy * s) / disc.r, y: -(dx * s + dy * c) / disc.r };
  }
  function scanAnim(w, h) {
    return (x, t) => {
      const y = ((t * 0.45) % 1) * h;
      const g = x.createLinearGradient(0, y - h * 0.12, 0, y); g.addColorStop(0, 'rgba(243,181,68,0)'); g.addColorStop(1, 'rgba(243,181,68,.25)');
      x.fillStyle = g; x.fillRect(0, y - h * 0.12, w, h * 0.12);
      x.strokeStyle = 'rgba(243,181,68,.95)'; x.lineWidth = Math.max(2, h * 0.003); x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke();
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
    st.disc = null; st.align = null; st.groups = null; st.extra = [];
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

      const rsunArc = 959.63 / A.sunApparent(st.time).R;
      const scaleWork = st.scaleFull ? st.scaleFull / k : null;
      if (st.scaleFull) logLine(`▸ Bildmaßstab  ${st.scaleFull.toFixed(3)}″/px (Brennweite/Pixelgröße) · erwarteter Sonnenradius ${(rsunArc / st.scaleFull).toFixed(0)} px`);
      logLine('▸ Bildart bestimmen  (Sonnenrand: steilster Helligkeitsabfall auf 720 Strahlen, Kreis-Fit)');
      let cls = st.imgType === 'surface' ? { type: 'surface' } : await compute('classify', { gray, w: wc.width, h: wc.height, opts: { expectedR: scaleWork ? rsunArc / scaleWork : null } });
      if (!alive()) return;
      if ((st.imgType === 'full' || st.imgType === 'partial') && cls.disc) cls.type = st.imgType;
      if ((st.imgType === 'full' || st.imgType === 'partial') && !cls.disc) throw new Error('Kein Sonnenrand gefunden. Bildart „Oberfläche ohne Rand“ wählen?');
      st.type = cls.type;
      let dWork = null;
      if (cls.type !== 'surface') {
        dWork = cls.disc;
        overlay(limbAnim(dWork, 1)); await sleep(1000);
        st.disc = { cx: dWork.cx / k, cy: dWork.cy / k, r: dWork.r / k };
        st.work.disc = dWork;
        logLine(`  ✓ ${st.imgType === 'auto' ? 'Erkannt: ' : ''}${TYPE_LABEL[cls.type]}`, 'ok');
        logLine(`  ✓ Mittelpunkt (${st.disc.cx.toFixed(1)}, ${st.disc.cy.toFixed(1)})  r = ${st.disc.r.toFixed(1)} px${dWork.fixedR ? ' (aus Bildmaßstab)' : ''}  · sichtbarer Randbogen ${Math.round(dWork.span)}°  · Restfehler ${(dWork.residual / k).toFixed(2)} px`, 'ok');
        if (cls.type === 'partial' && !st.scaleFull) logLine('  ! Tipp: Mit Brennweite und Pixelgröße wird der Mittelpunkt bei kurzen Randbögen genauer.', 'warn');
      } else {
        logLine(`  ✓ ${st.imgType === 'auto' ? 'Erkannt: ' : ''}${TYPE_LABEL.surface}${cls.reason ? ' – ' + esc(cls.reason) : ''}`, 'ok');
        if (!scaleWork) throw new Error('Für Oberflächenbilder wird der Bildmaßstab benötigt – bitte unter „Einordnung …“ Brennweite und Pixelgröße eintragen.');
      }

      // Ephemeriden
      const { lat, lon, mount } = st.cfg.location;
      const o = A.solarOrientation(st.time), pos = A.sunAltAz(st.time, lat, lon), q = A.parallacticAngle(st.time, lat, lon);
      st.eph = { ...o, alt: pos.alt, az: pos.az, q, pq: o.P - (mount === 'altaz' ? q : 0), cr: A.carringtonRotation(st.time) };
      logLine(`▸ Ephemeriden  P = ${o.P.toFixed(2)}°  B₀ = ${o.B0.toFixed(2)}°  L₀ = ${o.L0.toFixed(2)}°  CR ${st.eph.cr}`, 'hi');
      logLine(`▸ Sonnenstand  Höhe ${pos.alt.toFixed(1)}°  Azimut ${pos.az.toFixed(1)}°  parallaktischer Winkel ${q.toFixed(1)}°${mount === 'altaz' ? ' (Bildfeldrotation azimutal)' : ''}`);
      if (pos.alt < 0) logLine('  ! Die Sonne stand zur angegebenen Zeit unter dem Horizont – Aufnahmezeit prüfen.', 'warn');

      // Referenz & Regionen
      // Oberflächenbilder: Flecken werden im hochaufgelösten HMI-Kontinuum gesucht (auch für Ca-K)
      const refKind = st.type === 'surface' ? 'wl' : st.mode, refSize = st.type === 'surface' ? 2048 : undefined;
      logLine(`▸ Referenz laden  ${refKind === 'ca' ? 'SDO/AIA 1700 Å' : 'SDO/HMI Kontinuum'}${refSize ? ' 2048 px' : ''} zur Aufnahmezeit …`);
      overlay(dWork ? sweepAnim(dWork, 1) : scanAnim(wc.width, wc.height));
      const [refImg, reg] = await Promise.all([api.sunImage(refKind, st.time.toISOString(), refSize), api.regions(st.time.toISOString())]);
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
      let res;
      if (st.type === 'surface') {
        logLine('▸ Flecken der ganzen SDO-Sonne erfassen …');
        const refDisc = await compute('disc', { gray: st.ref.gray, w: st.ref.w, h: st.ref.h });
        const refSpots = await compute('spots', { gray: st.ref.gray, w: st.ref.w, h: st.ref.h, disc: refDisc, rotation: 0, flip: false, opts: { grid: Math.round(refDisc.r * 2), threshold: -0.12 } });
        if (!alive()) return;
        logLine(`▸ Punktmuster-Abgleich  ${refSpots.length} Referenzflecken · Drehung, Spiegelung und Lage frei`);
        const bar = logBar();
        let pct = 0; const barTimer = setInterval(() => { pct = Math.min(95, pct + 5); bar.textContent = `  [${'█'.repeat(pct / 5)}${'░'.repeat(20 - pct / 5)}] ${pct} %`; }, 70);
        try { res = await compute('surface', { user: { gray: gray.slice(), w: wc.width, h: wc.height }, refSpots, mode: st.mode, opts: { scale: scaleWork, rsun: rsunArc, knownFlip: prof.flip } }); }
        finally { clearInterval(barTimer); }
        if (!alive()) return;
        bar.textContent = `  [${'█'.repeat(20)}] 100 %`;
        res.log.forEach((l) => logLine('  ' + esc(l)));
        drawCurve(null);
        if (res.disc) { dWork = res.disc; st.work.disc = dWork; st.disc = { cx: dWork.cx / k, cy: dWork.cy / k, r: dWork.r / k }; }
      } else {
        logLine(`▸ Kreuzkorrelation  360° in 0,5°-Schritten, ${prof.flip == null ? 'mit und ohne Spiegelung' : prof.flip ? 'gespiegelt (Profil)' : 'ungespiegelt (Profil)'}${st.type === 'partial' ? ' · nur sichtbarer Bereich' : ''}`);
        const bar = logBar();
        let pct = 0; const barTimer = setInterval(() => { pct = Math.min(95, pct + 4); bar.textContent = `  [${'█'.repeat(pct / 5)}${'░'.repeat(20 - pct / 5)}] ${pct} %`; }, 70);
        try {
          res = await compute('align', { user: { gray: gray.slice(), w: wc.width, h: wc.height }, ref: { gray: st.ref.gray, w: st.ref.w, h: st.ref.h }, mode: st.mode, opts: { knownFlip: prof.flip, disc: dWork } });
        } finally { clearInterval(barTimer); }
        if (!alive()) return;
        bar.textContent = `  [${'█'.repeat(20)}] 100 %`;
        res.log.forEach((l) => logLine('  ' + esc(l)));
        drawCurve(res.curve, -res.rotation);
      }
      st.result = res;

      let rotation = res.rotation, flip = res.flip, method = 'auto';
      if (res.ok) {
        if (st.type === 'surface') { const h = A.diskToHeliographic(res.center.x, res.center.y, st.eph.B0); logLine(`  ✓ Stelle gefunden: Bildmitte bei ${h ? A.formatLocation(h.lat, h.cmd) : '–'} · Drehung ${rotation.toFixed(2)}°${flip ? ' · gespiegelt' : ''} · ${res.inliers} Flecken deckungsgleich`, 'ok'); }
        else logLine(`  ✓ Drehung ${rotation.toFixed(2)}°${flip ? ' · gespiegelt' : ''} · Sicherheit ${(res.ncc * 100).toFixed(0)} % / ×${res.ratio.toFixed(1)}`, 'ok');
      } else {
        overlay(null);
        logLine(`  ✗ ${esc(res.reason)}`, 'err');
        setState('Rückfrage');
        const choice = await askContinue(res.reason, prof, st.type);
        if (!alive()) return;
        if (choice === 'cancel') { logLine('Abgebrochen.', 'warn'); setState('abgebrochen'); return; }
        if (choice === 'retry') { if (await askIntake()) processImage(); else setState('abgebrochen'); return; }
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
        let spots;
        if (st.type === 'surface') {
          logLine('▸ Flecken erkennen  (Kontrast gegen lokale Umgebung)');
          const blobs = await compute('blobs', { gray: gray.slice(), w: wc.width, h: wc.height, opts: { radius: 30 / scaleWork, threshold: st.mode === 'ca' ? -0.3 : -0.18, minPixels: 3 } });
          const rArc = rsunArc;
          spots = blobs.map((b) => { const p = mapToSun(b.u, b.v, dWork, rotation, flip); const px2 = (scaleWork / rArc) ** 2; return { x: p.x, y: p.y, pixels: b.pixels, areaMSH: (b.pixels * px2 / Math.PI / 2) * 1e6, contrast: b.contrast }; });
        } else {
          logLine('▸ Flecken erkennen  (Kontrast gegen Ring-Median, Zusammenhangskomponenten)');
          spots = await compute('spots', { gray: gray.slice(), w: wc.width, h: wc.height, disc: dWork, rotation, flip, opts: { grid: Math.min(1400, Math.max(520, Math.round(dWork.r * 2))), threshold: st.mode === 'ca' ? -0.38 : -0.14 } });
        }
        if (!alive()) return;
        st.spotsTotal = spots.length;
        const m = AL.matchSpots(spots, st.regions.filter((r) => r.type === 'spots' || st.mode === 'ca'), st.type === 'surface' ? 0.06 : 0.12);
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
  function askContinue(reason, prof, type = 'full') {
    return new Promise((resolve) => {
      $('#dlgText').textContent = reason;
      const hasHist = (prof.history || []).length > 0 && type !== 'surface';
      const btns = [
        type === 'surface' && ['retry', 'Einordnung prüfen', 'Datum, Uhrzeit und Bildmaßstab korrigieren und erneut starten.'],
        hasHist && ['field', 'Letzte Ausrichtung fortschreiben', `Drehung aus deiner letzten Aufnahme, korrigiert um die Bildfeldrotation (${st.cfg.location.mount === 'altaz' ? 'azimutal' : 'parallaktisch'}).`],
        type !== 'surface' && ['manual', 'Manuell ausrichten', 'Mit Regler drehen und spiegeln, Gradnetz und Beschriftung als Kontrolle.'],
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

  /**
   * Ausgabe zeichnen. Ganze Sonne: quadratisch um die Scheibe. Ausschnitt/Oberfläche: das gedrehte Bild selbst.
   * Die Geometrie {cx, cy, r} beschreibt die Sonnenmitte im Ausgabebild (bei Ausschnitten oft außerhalb).
   */
  function renderOutput(srcCv, disc, opt) {
    const al = st.align || { rotation: 0, flip: false, method: 'none' };
    const type = st.type || 'full';
    const noDisc = !disc;
    const rot = al.rotation * D2R, cR = Math.cos(rot), sR = Math.sin(rot);
    const T = (u, v) => { let dx = u - (disc ? disc.cx : srcCv.width / 2); const dy = v - (disc ? disc.cy : srcCv.height / 2); if (al.flip) dx = -dx; return [dx * cR - dy * sR, dx * sR + dy * cR]; };
    let W, H, ox, oy;
    if (type === 'full' && !noDisc) { W = H = Math.round(disc.r * 2.3); ox = oy = W / 2; }
    else {
      const cs = [[0, 0], [srcCv.width, 0], [0, srcCv.height], [srcCv.width, srcCv.height]].map(([u, v]) => T(u, v));
      const minX = Math.min(...cs.map((c) => c[0])), maxX = Math.max(...cs.map((c) => c[0])), minY = Math.min(...cs.map((c) => c[1])), maxY = Math.max(...cs.map((c) => c[1]));
      W = Math.round(maxX - minX); H = Math.round(maxY - minY); ox = -minX; oy = -minY;
    }
    const z = Math.min(1, 9000 / Math.max(W, H));
    W = Math.round(W * z); H = Math.round(H * z);
    const fs = type === 'full' && !noDisc ? Math.max(11, Math.round(disc.r * z * 0.042)) : Math.max(12, Math.round(Math.min(W, H) * 0.024));
    const L = opt.legend ? Math.max(Math.round(H * 0.46), Math.round(fs * 24)) : 0;
    const cv = document.createElement('canvas'); cv.width = W + L; cv.height = H;
    const x = cv.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, H);
    x.save(); x.beginPath(); x.rect(0, 0, W, H); x.clip();
    x.translate(ox * z, oy * z); x.scale(z, z); x.rotate(rot); if (al.flip) x.scale(-1, 1); x.translate(-(disc ? disc.cx : srcCv.width / 2), -(disc ? disc.cy : srcCv.height / 2)); x.drawImage(srcCv, 0, 0);
    x.restore();
    const geom = { cx: ox * z, cy: oy * z, r: disc ? disc.r * z : 0, W, H };
    const mono = '"SF Mono", Menlo, monospace';
    const accent = st.mode === 'ca' ? '#d7c0ff' : '#f3b544';
    if (al.method !== 'none' && disc) {
      x.save(); x.beginPath(); x.rect(0, 0, W, H); x.clip();
      if (opt.grid) drawGrid(x, geom, type === 'surface' ? 5 : 15);
      x.restore();
      if (type === 'full') {
        const { cx: c, r } = geom;
        x.fillStyle = '#9a958d'; x.font = `600 ${fs}px ${mono}`; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('N', c, c - r - fs * 0.9); x.fillText('O', c - r - fs * 0.9, c); x.fillText('W', c + r + fs * 0.9, c); x.fillText('S', c, c + r + fs * 0.9);
      } else { drawCompass(x, fs, mono); drawScaleBar(x, geom, fs, mono); }
      drawLabels(x, geom, fs, mono, accent);
    }
    x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillStyle = '#b9b5ad'; x.font = `500 ${Math.round(fs * 0.85)}px ${mono}`;
    x.fillText(`${fmt.utcDate(st.time)} ${st.time.toISOString().slice(11, 16)} UTC · ${MODE_LABEL[st.mode]}`, fs * 0.8, H - fs * 0.9);
    x.textAlign = 'right'; x.fillStyle = '#6f6a63';
    x.fillText(al.method === 'none' ? 'nicht ausgerichtet' : 'N oben · O links · Solux', W - fs * 0.8, H - fs * 0.9);
    if (L) drawLegend(x, W, H, L, fs, mono, accent);
    return cv;
  }

  function drawCompass(x, fs, mono) {
    const L = fs * 2.6, cx = fs * 1.2 + L, cy = fs * 1.4 + L;
    x.save(); x.strokeStyle = '#d8d3cb'; x.fillStyle = '#d8d3cb'; x.lineWidth = Math.max(1.5, fs * 0.1);
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx, cy - L); x.moveTo(cx, cy); x.lineTo(cx - L, cy); x.stroke();
    x.font = `600 ${fs}px ${mono}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('N', cx, cy - L - fs * 0.8); x.fillText('O', cx - L - fs * 0.8, cy);
    x.restore();
  }

  function drawScaleBar(x, g, fs, mono) {
    const arcPerPx = (959.63 / A.sunApparent(st.time).R) / g.r;
    const want = g.W * 0.18 * arcPerPx;
    const nice = [5, 10, 20, 30, 60, 120, 300, 600, 900].reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
    const len = nice / arcPerPx, x1 = g.W - fs * 1.2, x0 = x1 - len, y = g.H - fs * 2.6;
    const km = Math.round((nice * 725.3 * A.sunApparent(st.time).R) / 1000) * 1000;
    x.save(); x.strokeStyle = '#d8d3cb'; x.lineWidth = Math.max(2, fs * 0.14);
    x.beginPath(); x.moveTo(x0, y); x.lineTo(x1, y); x.moveTo(x0, y - fs * 0.35); x.lineTo(x0, y + fs * 0.35); x.moveTo(x1, y - fs * 0.35); x.lineTo(x1, y + fs * 0.35); x.stroke();
    x.fillStyle = '#d8d3cb'; x.font = `500 ${Math.round(fs * 0.85)}px ${mono}`; x.textAlign = 'center'; x.textBaseline = 'bottom';
    x.fillText(`${nice >= 60 ? nice / 60 + '′' : nice + '″'} ≈ ${km.toLocaleString('de-DE')} km`, (x0 + x1) / 2, y - fs * 0.5);
    x.restore();
  }

  function drawGrid(x, g, step = 15) {
    const B0 = st.eph.B0, { cx, cy, r } = g, inc = step <= 5 ? 0.25 : 2;
    x.save(); x.lineWidth = Math.max(1, Math.min(r * 0.002, 3));
    const line = (pts) => { let pen = false; x.beginPath(); for (const p of pts) { if (!p.visible) { pen = false; continue; } const X = cx + p.x * r, Y = cy - p.y * r; pen ? x.lineTo(X, Y) : x.moveTo(X, Y); pen = true; } x.stroke(); };
    for (let lat = -90 + step; lat < 90; lat += step) { x.strokeStyle = lat === 0 ? 'rgba(255,255,255,.24)' : 'rgba(255,255,255,.11)'; const pts = []; for (let l = -90; l <= 90; l += inc) pts.push(A.heliographicToDisk(lat, l, B0)); line(pts); }
    for (let lon = -90; lon <= 90; lon += step) { x.strokeStyle = lon === 0 ? 'rgba(255,255,255,.24)' : 'rgba(255,255,255,.11)'; const pts = []; for (let b = -90; b <= 90; b += inc) pts.push(A.heliographicToDisk(b, lon, B0)); line(pts); }
    if (step <= 5) {
      // Gradbeschriftung am Bildrand für Oberflächenbilder
      x.fillStyle = 'rgba(255,255,255,.45)'; x.font = `500 ${Math.max(10, Math.round(g.H * 0.016))}px "SF Mono", Menlo, monospace`; x.textBaseline = 'top';
      for (let lat = -90 + step; lat < 90; lat += step) { for (let l = -90; l <= 90; l += 0.5) { const p = A.heliographicToDisk(lat, l, B0); const X = cx + p.x * r, Y = cy - p.y * r; if (p.visible && X > 4 && X < g.W * 0.25 && Y > 4 && Y < g.H - 20) { x.fillText(`${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}`, X + 3, Y + 2); break; } } }
    }
    x.restore();
  }

  function labelItems() {
    const items = [];
    if (st.groups) for (const g of st.groups) {
      const reg = g.region;
      if (reg.type !== 'spots' && st.mode !== 'ca') continue;
      if (!reg.visible) continue;
      if (st.type !== 'full' && !g.spots.length && !inField(g)) continue; // nur Regionen im Foto
      const style = st.cfg.recordings.labelStyle;
      items.push({ x: g.x, y: g.y, text: style === 'short' || !reg.spotClass ? `AR ${reg.region}` : `AR ${reg.region} ${reg.spotClass}`, dim: !g.spots.length && reg.type === 'spots', plage: reg.type !== 'spots' });
    }
    for (const e of st.extra || []) items.push({ x: e.x, y: e.y, text: 'neu?', dim: true });
    return items;
  }

  function drawLabels(x, g, fs, mono, accent) {
    const { cx, cy, r, W, H } = g;
    x.font = `600 ${fs}px ${mono}`; x.textBaseline = 'middle'; x.textAlign = 'left';
    const boxes = [], off = Math.min(r * 0.16, fs * 4.5), gap = Math.min(r * 0.035, fs * 0.9);
    for (const it of labelItems().sort((a, b) => b.y - a.y)) {
      const px = cx + it.x * r, py = cy - it.y * r;
      if (px < -fs || py < -fs || px > W + fs || py > H + fs) continue; // außerhalb des Bildausschnitts
      const tw = x.measureText(it.text).width;
      // Richtung: bei der ganzen Sonne radial nach außen, bei Ausschnitten nach oben rechts
      const ang = st.type === 'full' ? Math.atan2(-(py - cy), px - cx) : Math.PI / 4;
      let lx = px + Math.cos(ang) * off, ly = py - Math.sin(ang) * off;
      const right = Math.cos(ang) >= 0;
      let bx = right ? lx + 4 : lx - tw - 4;
      bx = Math.max(fs * 0.4, Math.min(W - tw - fs * 0.4, bx));
      ly = Math.max(fs, Math.min(H - fs * 2, ly));
      for (let k = 0; k < 12 && boxes.some((b) => bx < b.x1 && bx + tw > b.x0 && ly - fs * 0.7 < b.y1 && ly + fs * 0.7 > b.y0); k++) ly += fs * 1.25 * (it.y >= 0 ? -1 : 1);
      boxes.push({ x0: bx - 2, x1: bx + tw + 2, y0: ly - fs * 0.7, y1: ly + fs * 0.7 });
      x.globalAlpha = it.dim ? 0.55 : 1;
      x.strokeStyle = it.plage ? '#b48cff' : accent; x.lineWidth = Math.max(1, fs * 0.08);
      const d0 = Math.hypot(lx - px, ly - py) || 1;
      x.beginPath(); x.moveTo(px + ((lx - px) / d0) * gap, py + ((ly - py) / d0) * gap); x.lineTo(lx, ly); x.stroke();
      x.lineWidth = Math.max(2, fs * 0.25); x.strokeStyle = 'rgba(0,0,0,.75)'; x.strokeText(it.text, bx, ly);
      x.fillStyle = it.plage ? '#c9b0ff' : accent; x.fillText(it.text, bx, ly);
      x.globalAlpha = 1;
    }
  }

  /** Liegt eine Region im Bildausschnitt? */
  function inField(g) {
    if (!st.disc) return false;
    const al = st.align; let X = g.x * st.disc.r, Y = -g.y * st.disc.r;
    const c = Math.cos(-al.rotation * D2R), s2 = Math.sin(-al.rotation * D2R);
    let u = X * c - Y * s2; const v = X * s2 + Y * c; if (al.flip) u = -u;
    u += st.disc.cx; const vv = v + st.disc.cy;
    return u >= 0 && vv >= 0 && u <= st.src.width && vv <= st.src.height;
  }

  /** Bildmitte (heliografisch) und Bildfeld für Ausschnitte. */
  function fieldInfo() {
    if (!st.disc || st.align.method === 'none') return null;
    const p = mapToSun(st.src.width / 2, st.src.height / 2, st.disc, st.align.rotation, st.align.flip);
    const h = A.diskToHeliographic(p.x, p.y, st.eph.B0);
    const arcPerPx = (959.63 / A.sunApparent(st.time).R) / st.disc.r;
    return { loc: h ? A.formatLocation(h.lat, h.cmd) : 'außerhalb der Scheibe', w: (st.src.width * arcPerPx) / 60, h: (st.src.height * arcPerPx) / 60, scale: arcPerPx };
  }

  function legendLines() {
    const al = st.align, e = st.eph, loc = st.cfg.location;
    const how = { auto: 'automatisch (SDO-Abgleich)', field: 'fortgeschrieben (Bildfeldrotation)', manual: 'manuell', none: 'nicht ausgerichtet' }[al.method];
    const lines = [
      ['h', `Solux · ${MODE_LABEL[st.mode]}`],
      ['t', st.timeUnknown ? `${fmt.utcDate(st.time)} · Uhrzeit unbekannt` : `${fmt.utcDate(st.time)}  ${st.time.toISOString().slice(11, 19)} UTC`],
      ['m', `Ortszeit ${fmt.time.format(st.time)} · ${loc.name}`],
      ['m', `Sonnenhöhe ${e.alt.toFixed(1)}° · Azimut ${e.az.toFixed(0)}°`],
      ['m', `P ${e.P.toFixed(1)}°  B₀ ${e.B0.toFixed(2)}°  L₀ ${e.L0.toFixed(1)}°  CR ${e.cr}`],
      ['m', `Ausrichtung ${how}${al.method !== 'none' ? ` · ${al.rotation.toFixed(1)}°${al.flip ? ' · gespiegelt' : ''}` : ''}`],
      ['m', `Bildart: ${TYPE_LABEL[st.type || 'full']}`],
    ];
    const fi = st.type !== 'full' ? fieldInfo() : null;
    if (fi) lines.push(['m', `Bildmitte ${fi.loc} · Feld ${fi.w.toFixed(1).replace('.', ',')}′ × ${fi.h.toFixed(1).replace('.', ',')}′ · ${fi.scale.toFixed(2).replace('.', ',')}″/px`]);
    lines.push(['g', '']);
    if (st.groups && st.groups.length) {
      lines.push(['s', st.mode === 'ca' ? 'Aktive Regionen' : 'Fleckengruppen (NOAA)']);
      for (const g of st.groups) {
        const r = g.region;
        if (r.type !== 'spots' && st.mode !== 'ca') continue;
        if (st.type !== 'full' && !g.spots.length && !inField(g)) continue; // nur Regionen im Bildausschnitt
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

  function drawLegend(x, S, H, L, fs, mono, accent) {
    x.fillStyle = '#0b0b0c'; x.fillRect(S, 0, L, H);
    x.fillStyle = '#1e1e22'; x.fillRect(S, 0, Math.max(1, fs * 0.08), H);
    const pad = fs * 1.4, maxW = L - pad * 2; let y = pad * 1.4;
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    const wrap = (txt, font) => { x.font = font; const out = []; let cur = ''; for (const w of txt.split(' ')) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { out.push(cur); cur = '  ' + w; } else cur = t; } out.push(cur); return out; };
    for (const [kind, text] of legendLines()) {
      if (y > H - pad) break;
      let font, color, lh;
      if (kind === 'h') { font = `700 ${Math.round(fs * 1.35)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; color = '#ece8e1'; lh = fs * 1.9; }
      else if (kind === 's') { font = `600 ${Math.round(fs * 0.8)}px ${mono}`; color = '#6f6a63'; lh = fs * 1.5; }
      else if (kind === 'a') { font = `600 ${Math.round(fs * 0.95)}px ${mono}`; color = accent; lh = fs * 1.35; }
      else if (kind === 't') { font = `500 ${Math.round(fs * 1.0)}px ${mono}`; color = accent; lh = fs * 1.4; }
      else if (kind === 'd') { font = `400 ${Math.round(fs * 0.78)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; color = '#8e8a83'; lh = fs * 1.15; }
      else if (kind === 'g') { y += fs * 0.6; continue; }
      else { font = `400 ${Math.round(fs * 0.82)}px ${mono}`; color = '#b9b5ad'; lh = fs * 1.2; }
      x.fillStyle = color;
      for (const ln of wrap(kind === 's' ? text.toUpperCase() : text, font)) { if (y > H - pad) break; x.font = font; x.fillText(ln, S + pad, y); y += lh; }
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
    L.push(`Bildart:        ${TYPE_LABEL[st.type || 'full']}${st.imgType === 'auto' ? ' (automatisch erkannt)' : ''}`);
    if (st.disc) L.push(`Sonnenscheibe:  Mittelpunkt (${st.disc.cx.toFixed(1)}, ${st.disc.cy.toFixed(1)}) px${st.type === 'full' ? '' : ' (außerhalb/teilweise im Bild, berechnet)'}  Radius ${st.disc.r.toFixed(1)} px  (${(959.63 / A.sunApparent(st.time).R / st.disc.r).toFixed(3)}″/px)`);
    if (st.scaleFull) L.push(`Optik:          ${st.cfg.recordings.optics.focal} mm · ${st.cfg.recordings.optics.pixel} µm · Bin ${st.cfg.recordings.optics.binning} → ${st.scaleFull.toFixed(3)}″/px`);
    const fi = st.type !== 'full' ? fieldInfo() : null;
    if (fi) L.push(`Bildfeld:       Mitte ${fi.loc} · ${fi.w.toFixed(1)}′ × ${fi.h.toFixed(1)}′`);
    L.push(`Ausrichtung:    ${how}${al.method !== 'none' ? `, Drehung ${al.rotation.toFixed(2)}°${al.flip ? ', gespiegelt' : ''}` : ''}`);
    if (r && al.method === 'auto') L.push(st.type === 'surface' ? `                Punktmuster: ${r.inliers} Flecken deckungsgleich, Eindeutigkeit ×${r.ratio.toFixed(2)}` : `                Korrelation ${r.ncc.toFixed(3)}, Eindeutigkeit ×${r.ratio.toFixed(2)}, ${r.groups} Fleckengruppen in der Referenz`);
    if (st.ref) L.push(`Referenz:       ${st.ref.label} ${st.ref.date.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    L.push(`Ergebnis:       Norden oben, Osten links`);
    L.push('');
    if (st.groups) {
      const spots = st.groups.filter((g) => g.region.type === 'spots');
      L.push(`FLECKENGRUPPEN (NOAA, ${st.regionsDay ? 'SRS vom ' + st.regionsDay : 'keine Daten'})  ·  ${st.spotsTotal} Flecken/Poren im Bild erkannt`);
      L.push('-'.repeat(60));
      for (const g of spots) {
        if (st.type !== 'full' && !g.spots.length && !inField(g)) continue;
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
