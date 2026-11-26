/* Solux – Aufnahmen: Analyse, Ausrichtung, Beschriftung, Export */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const A = window.SoluxAstro, M = window.SoluxMcIntosh, AL = window.SoluxAlign, U = window.SoluxUI;
  const { fmt, esc } = U;
  const api = window.solux;
  const D2R = Math.PI / 180;
  const S = window.SoluxSeeing;
  const MODE_LABEL = { wl: 'Weißlicht', ca: 'Kalzium (Ca-K)', ha: 'H-Alpha' };
  const MODE_FILE = { wl: 'WL', ca: 'CaK', ha: 'Ha' };
  const ACCENT = { wl: '#f3b544', ca: '#d7c0ff', ha: '#ff9a5c' };
  const REF_LABEL = { wl: 'SDO/HMI Kontinuum', ca: 'SDO/AIA 1700 Å', ha: 'GONG H-Alpha (NSO)' };
  const chromo = () => st.mode !== 'wl'; // Kalzium und H-Alpha: Plages sichtbar, dunkle Strukturen sind nicht nur Flecken
  const num = (v, d = 1) => v.toFixed(d).replace('.', ',');
  const kmFmt = (km) => (Math.round(km / 1000) * 1000).toLocaleString('de-DE');
  /** Flare-Markierung: bei H-Alpha eigene Einstellung (Standard an), sonst wie gewählt (Standard aus). */
  const flaresOn = (opt) => (st.mode === 'ha' ? (opt.flaresHa ?? true) !== false : !!opt.flares);
  const flareKey = () => (st.mode === 'ha' ? 'flaresHa' : 'flares');
  const flareRank = (cls) => { const m = /^([ABCMX])(\d+(?:\.\d+)?)/.exec(cls || ''); return m ? 'ABCMX'.indexOf(m[1]) * 10 + parseFloat(m[2]) : 0; };
  /** C-, M- und X-Flares ±12 h um die Aufnahme, stärkste zuerst; null = keine Flare-Daten für diesen Zeitraum. */
  function dayFlareList() {
    const all = st.dayFlares || [];
    const covered = !st.flareInfo || (st.flareInfo.missing || []).length < 3 || all.length > 0;
    const list = all.filter((f) => Math.abs(f.max - st.time) < 12 * 3600000 && /^[CMX]/.test(f.cls)).sort((a, b) => flareRank(b.cls) - flareRank(a.cls));
    return list.length || covered ? list : null;
  }
  function flareWhen(f) {
    const d = Math.round((f.max - st.time) / 60000), a = Math.abs(d);
    const rel = a < 90 ? `${a} min` : `${num(a / 60)} h`;
    return `${new Date(f.max).toISOString().slice(11, 16)} UTC (${d >= 0 ? rel + ' nach' : rel + ' vor'} der Aufnahme)`;
  }
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
        else if (task === 'texture') res(AL.textureIndex(args.gray, args.w, args.h, args.disc));
        else if (task === 'sharp') res(AL.limbSharpness(args.gray, args.w, args.h, args.disc));
        else if (task === 'proms') res(AL.measureProminences(args.gray, args.w, args.h, args.disc, args.opts));
        else if (task === 'plages') res(AL.detectPlages(args.gray, args.w, args.h, args.disc, args.opts));
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
    st.exp = { text: 'list', scale: 'none', labels: true, grid: true, flares: false, flaresHa: true, proms: true, plages: true, format: 'jpeg', quality: 95, txt: true, ...(st.cfg.recordings.export || {}) };
    syncOptBar();
    updateProfileInfo();
  }

  function setMode(m, rerun = true) {
    st.mode = m;
    if (st.cfg) api.setConfig({ recordings: { lastMode: m } });
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.k === m));
    updateProfileInfo();
    if (rerun && st.src) processImage();
  }
  $('#modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.k !== st.mode) { st.modeAuto = false; setMode(b.dataset.k); } });

  function updateProfileInfo() {
    if (!st.cfg) return;
    const p = st.cfg.profiles[st.mode] || {};
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
      const nd = (st.nameDate = window.SoluxFileDate.parseNameDate(f.name));
      st.time = null; st.timeUnknown = false; st.yearAuto = false;
      // Wellenlänge: Dateiname/Ordner, sonst Bildfarbe (Kalziumbilder sind violett/blau eingefärbt)
      let modeHint = ''; st.modeAuto = false;
      if (/(^|[^a-z])(ha|halpha|h-alpha|h_alpha|hα|h-α|656|6563)([^a-z]|$)/i.test(f.name) || /h[-_ ]?alpha|hα/i.test(f.path)) { setMode('ha', false); modeHint = 'Dateiname'; }
      else if (/(^|[^a-z])(ca|cak|ca-k|calcium|kalzium|caii|393)([^a-z]|$)/i.test(f.path)) { setMode('ca', false); modeHint = 'Dateiname'; }
      else if (/(weiss|weiß|wl|white|herschel|kontinuum)/i.test(f.path)) { setMode('wl', false); modeHint = 'Dateiname'; }
      else { const g = guessModeByColor(cv); setMode(g, false); modeHint = 'Bildfarbe'; st.modeAuto = g === 'wl'; /* orange: Weißlicht oder H-Alpha – wird beim Abgleich entschieden */ }
      $('#empty').hidden = true; $('#intakeBtn').disabled = false;
      st.imgType = 'auto';
      st.scaleFull = scaleFromConfig();
      showCanvas(cv);
      if (nd) {
        // Datum im Dateinamen: ohne Rückfrage automatisch starten
        const p2 = (n) => String(n).padStart(2, '0');
        const t = nd.time ? `${p2(nd.time.hh)}:${p2(nd.time.mm)}:${p2(nd.time.ss)}` : '12:00:00';
        st.time = new Date(`${nd.y}-${p2(nd.m)}-${p2(nd.d)}T${t}${nd.time && nd.time.utc ? 'Z' : ''}`);
        st.timeUnknown = !nd.time; st.yearAuto = nd.yearGuessed;
        st.timeSource = `Dateiname (${nd.text}${nd.yearGuessed ? ', Jahr wird automatisch bestimmt' : ''}${nd.time ? '' : ', Uhrzeit unbekannt → 12:00 Ortszeit'})`;
        st.autoInfo = `▸ Automatischer Start  Datum aus dem Dateinamen · Wellenlänge aus ${modeHint}: ${st.modeAuto ? 'Weißlicht oder H-Alpha (wird geprüft)' : MODE_LABEL[st.mode]} · Korrektur jederzeit über „Einordnung …“`;
        $('#intakeInfo').textContent = `${nd.text}${nd.yearGuessed ? ' (Jahr?)' : ''} · ${MODE_LABEL[st.mode]}`;
        processImage(true);
      } else {
        setState('wartet auf Einordnung');
        if (await askIntake()) processImage(); else { setState('bereit'); logLine('Auswertung abgebrochen – über „Einordnung …“ jederzeit starten.', 'warn'); }
      }
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
  /** Kalzium-Aufnahmen sind meist violett/blau eingefärbt, Weißlicht orange/gelb oder grau. */
  function guessModeByColor(cv) {
    const n = 64, t = document.createElement('canvas'); t.width = t.height = n;
    const x = t.getContext('2d'); x.drawImage(cv, 0, 0, n, n);
    const d = x.getImageData(0, 0, n, n).data; let r = 0, b = 0, cnt = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] < 60) continue; r += d[i]; b += d[i + 2]; cnt++; }
    return cnt && b > r * 1.08 ? 'ca' : 'wl';
  }
  /** Optik (Brennweite, Pixelgröße, Binning) aus dem Ausrüstungsprofil der Wellenlänge. */
  function opticsFor(m = st.mode) { const p = st.cfg && st.cfg.profiles[m]; return (p && p.optics) || {}; }
  function scaleFromConfig(m = st.mode) {
    const o = opticsFor(m);
    return o.focal > 0 && o.pixel > 0 ? (206.265 * o.pixel * (o.binning || 1)) / o.focal : null;
  }
  /** Referenzbild als Graustufen laden. */
  async function refGray(refImg) {
    const img = new Image(); await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = refImg.dataUrl; });
    const rc = document.createElement('canvas'); rc.width = rc.height = refImg.size;
    const rx = rc.getContext('2d', { willReadFrequently: true }); rx.drawImage(img, 0, 0);
    return { gray: AL.toGray(rx.getImageData(0, 0, rc.width, rc.height).data, rc.width, rc.height), w: rc.width, h: rc.height, date: new Date(refImg.date), label: refImg.label };
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
      const fillOptics = (m) => { const o = opticsFor(m); $('#inFocal').value = o.focal || ''; $('#inPixel').value = o.pixel || ''; $('#inBin').value = String(o.binning || 1); $('#inOptLbl').textContent = MODE_LABEL[m]; updateIntakeScale(); };
      $('#inMode').onclick = (e) => { const b = e.target.closest('button'); if (b) { mode = b.dataset.k; setM(mode); fillOptics(mode); } };
      $('#inType').value = st.imgType || 'auto';
      fillOptics(mode);
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
        st.time = t; st.timeUnknown = $('#inNoTime').checked; st.yearAuto = false;
        st.timeSource = st.timeUnknown ? 'Datum bestätigt, Uhrzeit unbekannt (12:00 Ortszeit angenommen)' : nd ? 'Dateiname, im Dialog bestätigt' : 'im Dialog eingetragen';
        st.imgType = $('#inType').value;
        st.scaleFull = intakeScale();
        const optics = { focal: parseFloat($('#inFocal').value) || null, pixel: parseFloat($('#inPixel').value) || null, binning: parseInt($('#inBin').value, 10) || 1 };
        st.cfg.profiles[mode].optics = optics; api.setConfig({ profiles: { [mode]: { optics } } });
        st.modeAuto = false;
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
      x.beginPath(); x.arc(cx, cy, r * (1.3 - 0.3 * p), 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
      x.strokeStyle = 'rgba(61,187,108,.6)'; x.beginPath(); x.moveTo(cx - r * 0.05, cy); x.lineTo(cx + r * 0.05, cy); x.moveTo(cx, cy - r * 0.05); x.lineTo(cx, cy + r * 0.05); x.stroke();
    };
  }
  function sweepAnim(d, s) {
    return (x, t) => {
      const cx = d.cx * s, cy = d.cy * s, r = d.r * s, a = t * 2.4;
      x.lineWidth = Math.max(2, r * 0.006);
      const g = x.createConicGradient ? x.createConicGradient(a - Math.PI / 2, cx, cy) : null;
      if (g) { g.addColorStop(0, 'rgba(243,181,68,.0)'); g.addColorStop(0.92, 'rgba(243,181,68,.0)'); g.addColorStop(1, 'rgba(243,181,68,.28)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); }
      x.strokeStyle = 'rgba(243,181,68,.95)'; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r); x.stroke();
      x.strokeStyle = 'rgba(243,181,68,.3)'; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
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
    if (st.autoInfo) { logLine(st.autoInfo, 'hi'); st.autoInfo = null; }
    st.cfg = await api.getConfig(); updateProfileInfo();
    const f = st.file, src = st.src;
    let prof = st.cfg.profiles[st.mode];
    st.scaleFull = st.scaleFull || scaleFromConfig();
    st.sharp = null; st.seeingRec = null; st.proms = null; st.promCoverage = null; st.diaryId = null; st.caPlages = null;
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
      // Negativ bearbeitete H-Alpha-Bilder: Himmel weiß, Protuberanzen dunkel -> für die Randsuche umkehren
      const sky = AL.skyInfo(gray, wc.width, wc.height);
      const grayD = sky.inverted ? AL.normalizeSky(gray, sky.sky) : gray;
      st.sky = sky;
      if (sky.inverted) {
        logLine('▸ Heller Himmel erkannt (Protuberanzen negativ bearbeitet) – Rand wird gegen den Himmel gesucht');
        if (st.modeAuto || st.mode === 'wl') { if (st.mode !== 'ha') logLine('  ✓ Wellenlänge: H-Alpha (typische Negativ-Bearbeitung des Himmels)', 'ok'); setMode('ha', false); st.modeAuto = false; prof = st.cfg.profiles.ha; st.scaleFull = scaleFromConfig(); }
      }

      const rsunArc = 959.63 / A.sunApparent(st.time).R;
      let scaleWork = st.scaleFull ? st.scaleFull / k : null;
      if (st.scaleFull) logLine(`▸ Bildmaßstab  ${st.scaleFull.toFixed(3)}″/px (Brennweite/Pixelgröße) · erwarteter Sonnenradius ${(rsunArc / st.scaleFull).toFixed(0)} px`);
      logLine('▸ Bildart bestimmen  (Sonnenrand: steilster Helligkeitsabfall auf 720 Strahlen, Kreis-Fit)');
      let cls = st.imgType === 'surface' ? { type: 'surface' } : await compute('classify', { gray: grayD, w: wc.width, h: wc.height, opts: { expectedR: scaleWork ? rsunArc / scaleWork : null } });
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

      // Orange Bilder ohne Hinweis im Namen: Weißlicht oder H-Alpha? -> gegen beide Referenzen abgleichen
      if (st.modeAuto && cls.type !== 'surface') {
        const tex = await compute('texture', { gray, w: wc.width, h: wc.height, disc: dWork });
        if (!alive()) return;
        logLine(`▸ Wellenlänge prüfen  Weißlicht oder H-Alpha? Feinstruktur der Scheibe ${tex != null ? num(tex, 3) : '–'} (Weißlicht meist unter 0,08, H-Alpha über 0,12)`);
        const cand = {};
        for (const m of ['wl', 'ha']) {
          try {
            const rg = await refGray(await api.sunImage(m, st.time.toISOString()));
            if (!alive()) return;
            const r = await compute('align', { user: { gray: gray.slice(), w: wc.width, h: wc.height }, ref: { gray: rg.gray, w: rg.w, h: rg.h }, mode: m, opts: { knownFlip: st.cfg.profiles[m].flip, disc: dWork } });
            cand[m] = r.ncc * Math.min(3, r.ratio);
            logLine(`  ${MODE_LABEL[m]} (${REF_LABEL[m]}): Übereinstimmung ${(r.ncc * 100).toFixed(0)} % · Eindeutigkeit ×${num(r.ratio)}`);
          } catch (e) { logLine(`  ${MODE_LABEL[m]}: kein Referenzbild (${esc(e.message)})`, 'warn'); }
        }
        let pick = tex != null && tex > 0.1 ? 'ha' : 'wl', why = 'Feinstruktur';
        if (cand.wl != null && cand.ha != null && Math.abs(cand.ha - cand.wl) > 0.15 * Math.max(cand.ha, cand.wl)) { pick = cand.ha > cand.wl ? 'ha' : 'wl'; why = 'Referenzabgleich'; }
        st.modeAuto = false;
        if (pick !== st.mode) setMode(pick, false);
        prof = st.cfg.profiles[st.mode]; st.scaleFull = scaleFromConfig(); scaleWork = st.scaleFull ? st.scaleFull / k : null;
        logLine(`  ✓ Wellenlänge: ${MODE_LABEL[st.mode]} (${why})`, 'ok');
        $('#intakeInfo').textContent = `${fmt.dateShort.format(st.time)}${st.timeUnknown ? ' (Uhrzeit unbekannt)' : ''} · ${MODE_LABEL[st.mode]}`;
      }

      // Jahr fehlt im Dateinamen: gegen SDO-Bilder der letzten drei Jahre prüfen
      if (st.yearAuto && cls.type !== 'surface') {
        logLine('▸ Jahr fehlt im Dateinamen – Abgleich mit SDO-Bildern der letzten drei Jahre …');
        let best = null;
        for (let dy = 0; dy < 3; dy++) {
          const t = new Date(st.time); t.setFullYear(st.time.getFullYear() - dy);
          try {
            const rg = await refGray(await api.sunImage(st.mode, t.toISOString()));
            if (!alive()) return;
            const r = await compute('align', { user: { gray: gray.slice(), w: wc.width, h: wc.height }, ref: { gray: rg.gray, w: rg.w, h: rg.h }, mode: st.mode, opts: { knownFlip: prof.flip, disc: dWork } });
            const score = r.ncc * Math.min(3, r.ratio);
            logLine(`  ${t.getFullYear()}: Übereinstimmung ${(r.ncc * 100).toFixed(0)} % · Eindeutigkeit ×${r.ratio.toFixed(1)}`);
            if (!best || score > best.score) best = { t, score, r };
          } catch (e) { logLine(`  ${t.getFullYear()}: kein Referenzbild (${esc(e.message)})`, 'warn'); }
        }
        if (best) {
          st.time = best.t; st.yearAuto = false;
          logLine(`  ✓ Jahr ${best.t.getFullYear()} passt am besten${best.r.ok ? '' : ' (aber nicht eindeutig – bitte prüfen)'}`, best.r.ok ? 'ok' : 'warn');
          $('#intakeInfo').textContent = `${fmt.dateShort.format(st.time)}${st.timeUnknown ? ' (Uhrzeit unbekannt)' : ''} · ${MODE_LABEL[st.mode]}`;
        }
      } else if (st.yearAuto) logLine('  ! Jahr fehlt im Dateinamen – bei Oberflächenbildern bitte über „Einordnung …“ bestätigen.', 'warn');

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
      logLine(`▸ Referenz laden  ${REF_LABEL[refKind]}${refSize ? ' 2048 px' : ''} zur Aufnahmezeit …`);
      overlay(dWork ? sweepAnim(dWork, 1) : scanAnim(wc.width, wc.height));
      const [refImg, reg] = await Promise.all([api.sunImage(refKind, st.time.toISOString(), refSize), api.regions(st.time.toISOString())]);
      if (!alive()) return;
      st.ref = await refGray(refImg);
      const dtMin = Math.round((st.ref.date - st.time) / 60000);
      logLine(`  ✓ ${refImg.label}  ${st.ref.date.toISOString().slice(0, 16).replace('T', ' ')} UTC  (Δt ${dtMin >= 0 ? '+' : ''}${dtMin} min)`, Math.abs(dtMin) > 180 ? 'warn' : 'ok');
      st.regions = reg.regions || []; st.regionsDay = reg.day;
      try { const fr = await api.flaresAround(st.time.toISOString()); st.dayFlares = fr.flares || []; st.flareInfo = fr; }
      catch (e) { st.dayFlares = []; st.flareInfo = { missing: ['?', '?', '?'], source: 'Fehler' }; }
      { const n = dayFlareList(); logLine(n ? `▸ Flares ±12 h  ${n.length} C/M/X-Flare(s) · Quelle: ${st.flareInfo.source}` : '▸ Flares  keine Daten für diesen Zeitraum (NOAA-Archiv nicht erreichbar)', n ? '' : 'warn'); }
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
          const blobs = await compute('blobs', { gray: gray.slice(), w: wc.width, h: wc.height, opts: { radius: 30 / scaleWork, threshold: chromo() ? -0.3 : -0.18, minPixels: 3 } });
          const rArc = rsunArc;
          spots = blobs.map((b) => { const p = mapToSun(b.u, b.v, dWork, rotation, flip); const px2 = (scaleWork / rArc) ** 2; return { x: p.x, y: p.y, pixels: b.pixels, areaMSH: (b.pixels * px2 / Math.PI / 2) * 1e6, contrast: b.contrast }; });
        } else {
          logLine('▸ Flecken erkennen  (Kontrast gegen Ring-Median, Zusammenhangskomponenten)');
          spots = await compute('spots', { gray: gray.slice(), w: wc.width, h: wc.height, disc: dWork, rotation, flip, opts: { grid: Math.min(1400, Math.max(520, Math.round(dWork.r * 2))), threshold: chromo() ? -0.38 : -0.14 } });
        }
        if (!alive()) return;
        st.spotsTotal = spots.length;
        const m = AL.matchSpots(spots, st.regions.filter((r) => r.type === 'spots' || chromo()), st.type === 'surface' ? 0.06 : 0.12);
        st.groups = m.matched; st.extra = chromo() ? [] : m.extra; // im Ca-/H-Alpha-Licht sind dunkle Strukturen (Netzwerk, Filamente) keine Flecken
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

      // Bildschärfe am Sonnenrand -> Seeing-Kalibrierung (nur Weißlicht: scharfer Photosphärenrand)
      if (dWork && st.type !== 'surface') {
        const sh = await compute('sharp', { gray: grayD, w: wc.width, h: wc.height, disc: dWork });
        if (!alive()) return;
        if (sh && sh.n >= 30) {
          const arcPx = rsunArc / dWork.r, see = S.seeingFromLimb(sh.fwhmPx, arcPx);
          st.sharp = { arcsec: see, n: sh.n, fwhmPx: sh.fwhmPx, arcPx };
          logLine(`▸ Bildschärfe  Randabfall ≈ ${num(see)}″ Halbwertsbreite (${sh.n} Randstücke, ${num(arcPx, 2)}″/px im Arbeitsbild)`);
          if (st.mode !== 'wl') logLine(`  · ${MODE_LABEL[st.mode]} hat einen natürlich weichen Rand – zählt nicht zur Seeing-Kalibrierung.`);
          else if (st.timeUnknown) logLine('  · Für die Seeing-Kalibrierung wird die genaue Aufnahmezeit benötigt.');
          else if (st.eph.alt < 5) logLine('  · Sonne zu tief (unter 5°) – keine Seeing-Kalibrierung.');
          else {
            try {
              const r = await api.seeing.record({ time: st.time.toISOString(), measured: see, mode: st.mode, file: f.name });
              st.seeingRec = r;
              if (r.model) logLine(`  ✓ Seeing-Modell zur Aufnahmezeit ${num(r.model)}″ · gemessen ${num(see)}″ → Kalibrierfaktor ×${num(r.factor, 2)} (${r.n} Aufnahme${r.n === 1 ? '' : 'n'}${r.n < 2 ? ', aktiv ab 2' : ''})`, 'ok');
              else logLine('  ! Wetterdaten für die Aufnahmezeit nicht verfügbar – keine Kalibrierung.', 'warn');
            } catch (e) { logLine(`  ! Seeing-Kalibrierung nicht möglich: ${esc(e.message)}`, 'warn'); }
          }
        }
      }

      // Protuberanzen (H-Alpha)
      if (st.mode === 'ha' && dWork) {
        logLine('▸ Protuberanzen messen  (Radialprofile außerhalb des Rands gegen den Median aller Winkel)');
        const pr = await compute('proms', { gray: grayD, w: wc.width, h: wc.height, disc: dWork, opts: {} });
        if (!alive()) return;
        st.promCoverage = pr.coverage || 0;
        st.proms = (pr.list || []).map((p) => promInfo(p, dWork, st.align));
        if (!st.proms.length) logLine(`  · Keine deutlichen Protuberanzen über ≈ 7.000 km am sichtbaren Rand (${Math.round(st.promCoverage * 100)} % des Rands im Bild).`);
        else {
          logLine(`  ✓ ${st.proms.length} Protuberanz${st.proms.length === 1 ? '' : 'en'} · ${Math.round(st.promCoverage * 100)} % des Rands im Bild`, 'ok');
          for (const p of st.proms.slice(0, 6)) logLine(`  • ${promText(p)}`);
        }
      }

      // Kalzium: Plages erkennen und vermessen
      if (st.mode === 'ca' && dWork && st.type !== 'surface') {
        logLine('▸ Plages vermessen  (Helligkeit gegen Ring-Median, Fläche in MH, perspektivisch korrigiert)');
        const pr = await compute('plages', { gray: grayD, w: wc.width, h: wc.height, disc: dWork, opts: {} });
        if (!alive()) return;
        const al = st.align, aligned = al && al.method !== 'none';
        const list = pr.plages.map((p) => {
          const q = aligned ? mapToSun(p.u, p.v, dWork, al.rotation, al.flip) : null;
          let region = null;
          if (q) {
            const cands = (st.groups || []).map((g) => ({ g, d: Math.hypot(g.x - q.x, g.y - q.y) })).filter((c) => c.d < 0.2).sort((a, b) => a.d - b.d);
            if (cands.length) region = cands[0].g.region.region;
          }
          const hel = q ? A.diskToHeliographic(q.x, q.y, st.eph.B0) : null;
          return { ...p, x: q ? q.x : null, y: q ? q.y : null, region, loc: hel ? A.formatLocation(hel.lat, hel.cmd) : null };
        });
        // je Region nur den größten Teil benennen; weitere Teile derselben Region zusammenzählen
        const byReg = new Map();
        for (const p of list) if (p.region) { const e = byReg.get(p.region); if (!e) byReg.set(p.region, { ...p }); else { e.areaMH += p.areaMH; e.excess = Math.max(e.excess, p.excess); } }
        const merged = [...byReg.values(), ...list.filter((p) => !p.region)].sort((a, b) => b.areaMH - a.areaMH);
        st.caPlages = { list: merged, totalMH: pr.totalMH, coverage: pr.coverage, meanExcess: pr.meanExcess, threshold: pr.threshold, mask: pr.mask, disc: dWork };
        logLine(`  ✓ ${merged.length} Plage-Gebiete · gesamt ${pr.totalMH.toLocaleString('de-DE')} MH = ${num(pr.coverage, 2)} % der Halbkugel · Schwelle +${Math.round(pr.threshold * 100)} %`, 'ok');
        for (const p of merged.slice(0, 6)) logLine(`  • ${p.region ? 'AR ' + p.region : 'ohne NOAA-Nummer'}${p.loc ? ' bei ' + p.loc : ''} · ${p.areaMH.toLocaleString('de-DE')} MH (${num(p.areaMH / 41.9, 0)} Erdscheiben) · +${Math.round(p.excess * 100)} % heller`);
      }

      logLine('▸ Ausrichten (Norden oben, Osten links), beschriften, Legende setzen');
      renderPreview();
      st.txt = buildText();
      $('#txtOut').textContent = st.txt;
      $('#txtName').textContent = baseName() + '.txt';
      logLine(`✓ Fertig`, 'ok');
      setState('fertig'); $('#saveBtn').disabled = false;
      if (st.cfg.recordings.diary !== false && st.align.method !== 'none') saveDiary().catch((e) => logLine(`  ! Tagebuch: ${esc(e.message)}`, 'warn'));
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

  /** Protuberanz: Bildwinkel -> Positionswinkel (von Sonnennord über Ost), Breite, Höhe in km. */
  function promInfo(p, disc, al) {
    const out = { height: p.height, km: p.height * 696000, width: p.width, angle: p.angle, peak: p.peak, pa: null, lat: null, side: null, x: null, y: null };
    if (!al || al.method === 'none') return out;
    const q = mapToSun(disc.cx + Math.cos(p.angle) * disc.r, disc.cy + Math.sin(p.angle) * disc.r, disc, al.rotation, al.flip);
    const n = Math.hypot(q.x, q.y) || 1; out.x = q.x / n; out.y = q.y / n;
    out.pa = ((Math.atan2(-out.x, out.y) * 180) / Math.PI + 360) % 360;
    const hel = A.diskToHeliographic(out.x * 0.999, out.y * 0.999, st.eph.B0);
    out.lat = hel ? hel.lat : null; out.side = out.x < 0 ? 'Ostrand' : 'Westrand';
    return out;
  }
  function promText(p) {
    const where = p.pa != null ? `PA ${Math.round(p.pa)}°${p.lat != null ? ` (${Math.abs(Math.round(p.lat))}° ${p.lat >= 0 ? 'N' : 'S'}, ${p.side})` : ''}` : `Bildwinkel ${Math.round((p.angle * 180) / Math.PI)}°`;
    return `${where} · Höhe ≈ ${kmFmt(p.km)} km (${num(p.km / 12742)} Erddurchmesser) · Breite ${Math.round(p.width)}°`;
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
    const cv = renderOutput(w.canvas, w.disc, st.exp, w.k);
    st.preview = cv;
    showCanvas(cv);
  }
  /* Bedienleiste: Text, Skala, Gradnetz – wirkt sofort auf die Vorschau und wird gemerkt */
  function setSeg(id, v) { document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); }
  function syncOptBar() { setSeg('optText', st.exp.text); setSeg('optScale', st.exp.scale); $('#gridChk').checked = !!st.exp.grid; }
  function setExp(patch) { Object.assign(st.exp, patch); api.setConfig({ recordings: { export: st.exp } }); syncOptBar(); if (st.align) renderPreview(); }
  $('#optText').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setExp({ text: b.dataset.v }); });
  $('#optScale').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setExp({ scale: b.dataset.v }); });
  $('#gridChk').addEventListener('change', () => setExp({ grid: $('#gridChk').checked }));

  /**
   * Ausgabe zeichnen. Ganze Sonne: quadratisch um die Scheibe. Ausschnitt/Oberfläche: das gedrehte Bild selbst.
   * Die Geometrie {cx, cy, r} beschreibt die Sonnenmitte im Ausgabebild (bei Ausschnitten oft außerhalb).
   */
  function renderOutput(srcCv, disc, opt, kScale = 1) {
    const al = st.align || { rotation: 0, flip: false, method: 'none' };
    const type = st.type || 'full';
    const noDisc = !disc;
    const rot = al.rotation * D2R, cR = Math.cos(rot), sR = Math.sin(rot);
    const T = (u, v) => { let dx = u - (disc ? disc.cx : srcCv.width / 2); const dy = v - (disc ? disc.cy : srcCv.height / 2); if (al.flip) dx = -dx; return [dx * cR - dy * sR, dx * sR + dy * cR]; };
    let W, H, ox, oy;
    const withScale = type === 'full' && !noDisc && opt.scale && opt.scale !== 'none' && al.method !== 'none';
    if (type === 'full' && !noDisc) { W = H = Math.round(disc.r * (withScale ? 2.78 : 2.3)); ox = oy = W / 2; }
    else {
      const cs = [[0, 0], [srcCv.width, 0], [0, srcCv.height], [srcCv.width, srcCv.height]].map(([u, v]) => T(u, v));
      const minX = Math.min(...cs.map((c) => c[0])), maxX = Math.max(...cs.map((c) => c[0])), minY = Math.min(...cs.map((c) => c[1])), maxY = Math.max(...cs.map((c) => c[1]));
      W = Math.round(maxX - minX); H = Math.round(maxY - minY); ox = -minX; oy = -minY;
    }
    const z = Math.min(1, 9000 / Math.max(W, H));
    W = Math.round(W * z); H = Math.round(H * z);
    const fs = type === 'full' && !noDisc ? Math.max(11, Math.round(disc.r * z * 0.042)) : Math.max(12, Math.round(Math.min(W, H) * 0.024));
    const textMode = opt.text || 'none';
    const L = textMode !== 'none' ? Math.max(Math.round(H * 0.46), Math.round(fs * 24)) : 0;
    const cv = document.createElement('canvas'); cv.width = W + L; cv.height = H;
    const x = cv.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, H);
    // Ganze Sonne: Himmel mit passender Farbe/Körnung erweitern und das Foto weich einblenden – die Erweiterung fällt nicht auf
    const sky = type === 'full' && disc ? skyStats(srcCv, disc) : null;
    if (sky) fillSky(x, W, H, sky);
    x.save(); x.beginPath(); x.rect(0, 0, W, H); x.clip();
    x.translate(ox * z, oy * z); x.scale(z, z); x.rotate(rot); if (al.flip) x.scale(-1, 1); x.translate(-(disc ? disc.cx : srcCv.width / 2), -(disc ? disc.cy : srcCv.height / 2));
    x.drawImage(sky ? feathered(srcCv, Math.max(6, Math.round(disc.r * 0.025))) : srcCv, 0, 0);
    x.restore();
    const geom = { cx: ox * z, cy: oy * z, r: disc ? disc.r * z : 0, W, H };
    const mono = '"SF Mono", Menlo, monospace';
    const accent = ACCENT[st.mode];
    if (al.method !== 'none' && disc) {
      x.save(); x.beginPath(); x.rect(0, 0, W, H); x.clip();
      if (opt.grid) drawGrid(x, geom, type === 'surface' ? 5 : 15);
      x.restore();
      if (withScale) drawDistanceScale(x, geom, fs, opt.scale === 'through');
      else if (type === 'full') {
        const { cx: c, r } = geom;
        x.fillStyle = '#9a958d'; x.font = `600 ${fs}px ${mono}`; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('N', c, c - r - fs * 0.9); x.fillText('O', c - r - fs * 0.9, c); x.fillText('W', c + r + fs * 0.9, c); x.fillText('S', c, c + r + fs * 0.9);
      } else { drawCompass(x, fs, mono); drawScaleBar(x, geom, fs, mono); }
      if (opt.proms !== false && st.mode === 'ha' && st.proms && st.proms.length) drawProms(x, geom, fs);
      if (opt.plages !== false && st.mode === 'ca' && st.caPlages) drawPlages(x, geom);
      if (opt.labels !== false) drawLabels(x, geom, fs, mono, accent);
      if (flaresOn(opt)) drawDayFlares(x, geom, fs, mono);
    }
    x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillStyle = '#b9b5ad'; x.font = `500 ${Math.round(fs * 0.85)}px ${mono}`;
    x.fillText(`${fmt.utcDate(st.time)} ${st.time.toISOString().slice(11, 16)} UTC · ${MODE_LABEL[st.mode]}`, fs * 0.8, H - fs * 0.9);
    x.textAlign = 'right'; x.fillStyle = '#6f6a63';
    x.fillText(al.method === 'none' ? 'nicht ausgerichtet' : 'N oben · O links · Solux', W - fs * 0.8, H - fs * 0.9);
    st.curOpt = opt;
    if (L) drawLegend(x, W, H, L, fs, mono, accent, textMode);
    cv.__geom = geom;
    return cv;
  }

  /** Mittelwert und Streuung des Himmels (außerhalb der Scheibe) – für die unauffällige Erweiterung. */
  function skyStats(srcCv, disc) {
    if (srcCv.__sky) return srcCv.__sky;
    const n = 200, f = n / Math.max(srcCv.width, srcCv.height), w = Math.round(srcCv.width * f), h = Math.round(srcCv.height * f);
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    const tx = t.getContext('2d', { willReadFrequently: true }); tx.drawImage(srcCv, 0, 0, w, h);
    const d = tx.getImageData(0, 0, w, h).data, acc = [[], [], []];
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      if (Math.hypot(xx / f - disc.cx, y / f - disc.cy) < disc.r * 1.08) continue;
      const i = (y * w + xx) * 4; acc[0].push(d[i]); acc[1].push(d[i + 1]); acc[2].push(d[i + 2]);
    }
    const stat = (a) => { if (!a.length) return [0, 0]; a.sort((p, q) => p - q); const m = a[a.length >> 1]; const lo = a[Math.floor(a.length * 0.16)], hi = a[Math.floor(a.length * 0.84)]; return [m, (hi - lo) / 2]; };
    const res = acc.map(stat);
    srcCv.__sky = { mean: res.map((r) => r[0]), std: res.map((r) => Math.min(25, r[1])) };
    return srcCv.__sky;
  }
  function fillSky(x, W, H, sky) {
    x.fillStyle = `rgb(${sky.mean.map(Math.round).join(',')})`; x.fillRect(0, 0, W, H);
    const sd = Math.max(...sky.std); if (sd < 0.6) return;
    // Rauschkachel in der Körnung des Originals
    const T = 256, t = document.createElement('canvas'); t.width = t.height = T;
    const tx = t.getContext('2d'), id = tx.createImageData(T, T), rnd = U.rng(7);
    for (let i = 0; i < id.data.length; i += 4) { const g = (rnd() + rnd() + rnd() - 1.5) * 2; for (let c = 0; c < 3; c++) id.data[i + c] = Math.max(0, Math.min(255, sky.mean[c] + g * sky.std[c])); id.data[i + 3] = 255; }
    tx.putImageData(id, 0, 0);
    x.fillStyle = x.createPattern(t, 'repeat'); x.fillRect(0, 0, W, H);
  }
  /** Bild mit weich auslaufenden Rändern (für den Übergang zum erweiterten Himmel). */
  function feathered(srcCv, f) {
    if (srcCv.__feather && srcCv.__feather.f === f) return srcCv.__feather.cv;
    const c = document.createElement('canvas'); c.width = srcCv.width; c.height = srcCv.height;
    const x = c.getContext('2d'); x.drawImage(srcCv, 0, 0);
    x.globalCompositeOperation = 'destination-out';
    const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => { const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(rx, ry, rw, rh); };
    const w = c.width, h = c.height;
    edge(0, 0, f, 0, 0, 0, f, h); edge(w, 0, w - f, 0, w - f, 0, f, h); edge(0, 0, 0, f, 0, 0, w, f); edge(0, h, 0, h - f, 0, h - f, w, f);
    srcCv.__feather = { f, cv: c };
    return c;
  }

  /**
   * Entfernungsskala (nur ganze Sonne): Höhenringe 50/100/150 Tsd. km, Kranz mit Strichen alle 5°/30°,
   * Höhenlineale Ost und West; optional durchgehende Skala über die Scheibe (Abstand von der Mitte).
   * Maßstab: gemessener Sonnenradius in Pixeln ≙ 696.000 km.
   */
  function drawDistanceScale(x, g, fs, through) {
    const { cx, cy, r } = g, RS = 696000, h = (km) => (r * km) / RS;
    const accent = { wl: [255, 205, 120], ca: [215, 190, 255], ha: [255, 170, 115] }[st.mode], tick = [225, 219, 208];
    const ink = st.mode === 'ca' ? [40, 12, 85] : [70, 28, 4], halo = st.mode === 'ca' ? [240, 230, 255] : [255, 236, 205];
    const rgba = (c, a) => `rgba(${c.join(',')},${a})`;
    const top = 150000, Rt = r + h(top), R0 = Rt + Math.max(8, r * 0.03), lw = Math.max(1, r / 260);
    x.save();
    // Höhenringe (gestrichelt)
    x.setLineDash([r * 0.025, r * 0.035]); x.lineWidth = lw; x.strokeStyle = rgba(accent, 0.38);
    for (const km of [50000, 100000, 150000]) { x.beginPath(); x.arc(cx, cy, r + h(km), 0, Math.PI * 2); x.stroke(); }
    x.setLineDash([]);
    // Kranz: Striche alle 5°, lange alle 30° (Positionswinkel von Nord über Ost)
    x.strokeStyle = rgba(tick, 0.45); x.beginPath(); x.arc(cx, cy, R0, 0, Math.PI * 2); x.stroke();
    for (let pa = 0; pa < 360; pa += 5) {
      const a = (-90 - pa) * D2R, L = pa % 30 === 0 ? r * 0.028 : r * 0.012;
      x.strokeStyle = rgba(tick, pa % 30 === 0 ? 0.8 : 0.5); x.lineWidth = pa % 30 === 0 ? lw * 2 : lw;
      x.beginPath(); x.moveTo(cx + R0 * Math.cos(a), cy + R0 * Math.sin(a)); x.lineTo(cx + (R0 + L) * Math.cos(a), cy + (R0 + L) * Math.sin(a)); x.stroke();
    }
    // Höhenlineale Ost und West
    x.font = `500 ${Math.round(fs * 0.75)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'top';
    for (const side of [-1, 1]) {
      x.strokeStyle = rgba(accent, 0.92); x.lineWidth = lw * 2;
      x.beginPath(); x.moveTo(cx + side * r, cy); x.lineTo(cx + side * Rt, cy); x.stroke();
      for (let km = 0; km <= top; km += 10000) {
        const X = cx + side * (r + h(km)), L = km % 50000 === 0 ? r * 0.02 : r * 0.01;
        x.lineWidth = km % 50000 === 0 ? lw * 2 : lw; x.beginPath(); x.moveTo(X, cy - L); x.lineTo(X, cy + L); x.stroke();
        if (km && km % 50000 === 0) { x.fillStyle = rgba(accent, 0.96); x.fillText(String(km / 1000), X, cy + L + fs * 0.25); }
      }
    }
    if (through) {
      // durchgehend über die Scheibe: dunkel mit hellem Saum, Abstand von der Sonnenmitte
      const line = (x0, y0, x1, y1, w) => { x.lineWidth = w + lw * 2; x.strokeStyle = rgba(halo, 0.6); x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); x.lineWidth = w; x.strokeStyle = rgba(ink, 0.92); x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); };
      line(cx - r, cy, cx + r, cy, lw * 1.5);
      x.textBaseline = 'bottom';
      for (let km = -650000; km <= 650000; km += 50000) {
        const X = cx + h(km), major = km % 200000 === 0, L = major ? r * 0.02 : r * 0.01;
        line(X, cy - L, X, cy + L, major ? lw * 1.6 : lw);
        if (major) { x.lineWidth = Math.max(2, fs * 0.18); x.strokeStyle = rgba(halo, 0.8); x.strokeText(String(Math.abs(km / 1000)), X, cy - L - fs * 0.15); x.fillStyle = rgba(ink, 1); x.fillText(String(Math.abs(km / 1000)), X, cy - L - fs * 0.15); }
      }
    }
    // Himmelsrichtungen außerhalb des Kranzes
    x.font = `700 ${Math.round(fs * 1.1)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; x.textBaseline = 'middle'; x.fillStyle = '#f2eee6';
    const d = R0 + r * 0.075;
    x.fillText('N', cx, cy - d); x.fillText('S', cx, cy + d); x.fillText('O', cx - d, cy); x.fillText('W', cx + d, cy);
    x.font = `400 ${Math.round(fs * 0.7)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillStyle = 'rgba(200,195,186,.85)';
    x.fillText(`Höhe über dem Sonnenrand in 1.000 km${through ? ' · innen: Abstand von der Sonnenmitte in 1.000 km' : ''} · Kranz alle 5°/30°`, fs * 0.8, g.H - fs * 2.2);
    x.restore();
  }

  /** Protuberanzen markieren: Bogen über der Spitze und Höhe in km (außerhalb, damit die Struktur frei bleibt). */
  function drawProms(x, g, fs) {
    const { cx, cy, r, W, H } = g;
    x.save();
    x.font = `600 ${Math.round(fs * 0.8)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; x.textBaseline = 'middle';
    const placed = [];
    for (const p of st.proms.slice(0, 6)) {
      // Richtung im Ausgabebild: ausgerichtet = Sonnenkoordinaten, sonst Bildwinkel
      const ang = p.x != null ? Math.atan2(-p.y, p.x) : p.angle;
      const half = Math.max(1.5, p.width / 2 + 1) * D2R, R1 = r * (1 + p.height) + fs * 0.35;
      x.strokeStyle = 'rgba(255,190,140,.9)'; x.lineWidth = Math.max(1.5, fs * 0.1);
      x.beginPath(); x.arc(cx, cy, R1, ang - half, ang + half); x.stroke();
      const R2 = R1 + fs * 0.9;
      let tx = cx + Math.cos(ang) * R2, ty = cy + Math.sin(ang) * R2;
      const label = `${kmFmt(p.km)} km`;
      const tw = x.measureText(label).width;
      x.textAlign = Math.cos(ang) > 0.3 ? 'left' : Math.cos(ang) < -0.3 ? 'right' : 'center';
      tx = Math.max(fs * 0.4 + (x.textAlign === 'right' ? tw : x.textAlign === 'center' ? tw / 2 : 0), Math.min(W - fs * 0.4 - (x.textAlign === 'left' ? tw : x.textAlign === 'center' ? tw / 2 : 0), tx));
      ty = Math.max(fs, Math.min(H - fs * 2.2, ty));
      for (let k = 0; k < 6 && placed.some((q) => Math.abs(q.x - tx) < tw + fs && Math.abs(q.y - ty) < fs * 1.15); k++) ty += (Math.sin(ang) >= 0 ? 1 : -1) * fs * 1.2;
      placed.push({ x: tx, y: ty });
      x.lineWidth = Math.max(2, fs * 0.22); x.strokeStyle = 'rgba(0,0,0,.7)'; x.strokeText(label, tx, ty);
      x.fillStyle = '#ffd2b0'; x.fillText(label, tx, ty);
    }
    x.restore();
  }

  /** Umrisse der Kalzium-Plages: Kanten der Maske (Arbeitsbild) über die Ausrichtung ins Ausgabebild übertragen. */
  function drawPlages(x, g) {
    const P = st.caPlages, m = P.mask, al = st.align; if (!m || !al || al.method === 'none') return;
    const d = P.disc, k = m.k, W = m.w, H = m.h, on = (gx, gy) => (gx >= 0 && gy >= 0 && gx < W && gy < H && m.data[gy * W + gx] ? 1 : 0);
    const toOut = (gx, gy) => { const q = mapToSun(gx / k, gy / k, d, al.rotation, al.flip); return [g.cx + q.x * g.r, g.cy - q.y * g.r]; };
    x.save(); x.strokeStyle = 'rgba(255,226,120,.85)'; x.lineWidth = Math.max(1, g.r / 450); x.beginPath();
    for (let gy = 0; gy <= H; gy++) for (let gx = 0; gx <= W; gx++) {
      const a = on(gx, gy);
      if (a !== on(gx - 1, gy)) { const [x0, y0] = toOut(gx, gy), [x1, y1] = toOut(gx, gy + 1); x.moveTo(x0, y0); x.lineTo(x1, y1); }
      if (a !== on(gx, gy - 1)) { const [x0, y0] = toOut(gx, gy), [x1, y1] = toOut(gx + 1, gy); x.moveTo(x0, y0); x.lineTo(x1, y1); }
    }
    x.stroke(); x.restore();
  }

  /** Flares des Aufnahmetags (±12 h) an ihren Regionen markieren. */
  function drawDayFlares(x, g, fs, mono) {
    // je Region nur der stärkste Flare (sonst liegen die Markierungen übereinander), dazu die Zahl der weiteren
    const byReg = new Map();
    for (const f of dayFlareList() || []) { if (!f.region) continue; const e = byReg.get(f.region); if (!e) byReg.set(f.region, { f, more: 0 }); else e.more++; }
    for (const { f, more } of byReg.values()) {
      const grp = st.groups && st.groups.find((q) => q.region.region === f.region); if (!grp) continue;
      const px = g.cx + grp.x * g.r, py = g.cy - grp.y * g.r, rr = fs * (f.cls[0] === 'X' ? 1.3 : f.cls[0] === 'M' ? 1 : 0.7);
      x.save(); x.translate(px - fs * 1.6, py - fs * 1.2); x.strokeStyle = f.cls[0] === 'X' ? '#ff4d4d' : f.cls[0] === 'M' ? '#ff9a3c' : '#ffe08a'; x.lineWidth = Math.max(1.5, fs * 0.12);
      x.beginPath(); for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, r1 = k % 2 ? rr * 0.45 : rr; x.moveTo(0, 0); x.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); } x.stroke();
      x.font = `700 ${Math.round(fs * 0.75)}px ${mono}`; x.fillStyle = x.strokeStyle; x.textAlign = 'right'; x.textBaseline = 'middle';
      const lbl = more ? `${f.cls} +${more}` : f.cls;
      x.lineWidth = Math.max(2, fs * 0.2); x.strokeStyle = 'rgba(0,0,0,.75)'; x.strokeText(lbl, -rr - fs * 0.2, 0); x.fillText(lbl, -rr - fs * 0.2, 0);
      x.restore();
    }
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
      if (reg.type !== 'spots' && !chromo()) continue;
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

  /** Variante „Zusammenfassung“: die aktivsten Regionen im Bild kurz erklärt. */
  function summaryLines() {
    const head = legendLines().filter(([k]) => k === 'h' || k === 't').slice(0, 2);
    const lines = [...head, ['m', `${st.cfg.location.name} · P ${st.eph.P.toFixed(1)}° · B₀ ${st.eph.B0.toFixed(2)}°`], ['g', '']];
    const cand = (st.groups || []).filter((g) => g.region.type === 'spots' && (st.type === 'full' || g.spots.length || inField(g)))
      .sort((a, b) => ((/D/.test(b.region.magClass) ? 1000 : 0) + (b.region.area || 0)) - ((/D/.test(a.region.magClass) ? 1000 : 0) + (a.region.area || 0))).slice(0, 4);
    if (!cand.length) lines.push(['m', 'Keine nummerierten Fleckengruppen im Bild.']);
    else lines.push(['s', 'Die aktivsten Regionen']);
    for (const g of cand) {
      const r = g.region, story = M.regionStory(r, [], (st.dayFlares || []).filter((f) => f.region === r.region), st.mode);
      const earths = r.area ? (r.area / 41.9 >= 1 ? `etwa ${Math.round(r.area / 41.9)} Erdscheiben` : `etwa ${(r.area / 41.9).toFixed(1).replace('.', ',')} Erdscheiben`) : '';
      lines.push(['a', `AR ${r.region} · ${r.spotClass} ${M.magSymbol(r.magClass)}`]);
      lines.push(['p', story.fazit]);
      lines.push(['m', [earths, r.location, r.numberSpots ? `${r.numberSpots} Flecken` : ''].filter(Boolean).join(' · ')]);
      lines.push(['g', '']);
    }
    if (st.caPlages && st.caPlages.list.length) {
      const P = st.caPlages, top = P.list[0];
      lines.push(['s', 'Plages']);
      lines.push(['p', `Helle Plages bedecken ${num(P.coverage, 1)} % der sichtbaren Sonne. Das größte Gebiet${top.region ? ` liegt um AR ${top.region}` : ' hat noch keine NOAA-Nummer'} und ist etwa ${num(top.areaMH / 41.9, 0)}-mal so groß wie die Erdscheibe.${P.list.some((p) => !p.region && p.areaMH >= 200) ? ' Es gibt helle Gebiete ohne Nummer – dort können neue Flecken entstehen.' : ''}`]);
      lines.push(['g', '']);
    }
    if (st.curOpt && flaresOn(st.curOpt)) {
      const fl = dayFlareList();
      if (fl && fl.length) {
        const f = fl[0], big = /^X/.test(f.cls) ? 'ein starker X-Flare' : /^M/.test(f.cls) ? 'ein mittelstarker M-Flare' : 'ein kleiner C-Flare';
        lines.push(['s', 'Flares']);
        const n = (c) => fl.filter((q) => q.cls[0] === c).length;
        const parts = [['X', n('X')], ['M', n('M')], ['C', n('C')]].filter(([, k]) => k).map(([c, k]) => `${k} ${c}`);
        const cnt = parts.length > 1 ? parts.slice(0, -1).map((q) => q + '-').join(', ') + ' und ' + parts[parts.length - 1] + '-Flares' : parts[0] + '-Flare' + (fl.length > 1 ? 's' : '');
        lines.push(['p', `In den 12 Stunden vor und nach der Aufnahme gab es ${fl.length === 1 ? 'einen ' + fl[0].cls[0] + '-Flare' : cnt}. Der stärkste war ${big} (${f.cls})${f.region ? ' aus AR ' + f.region : ''} um ${flareWhen(f)}.`]);
        lines.push(['g', '']);
      } else if (fl) { lines.push(['s', 'Flares']); lines.push(['p', 'In den 12 Stunden vor und nach der Aufnahme gab es keinen nennenswerten Flare.']); lines.push(['g', '']); }
    }
    if (st.proms && st.proms.length) {
      const p = st.proms.slice().sort((a, b) => b.km - a.km)[0];
      lines.push(['s', 'Protuberanzen']);
      lines.push(['p', `${st.proms.length === 1 ? 'Eine Protuberanz' : st.proms.length + ' Protuberanzen'} am Rand. Die höchste ragt etwa ${kmFmt(p.km)} km hinaus – das sind ${num(p.km / 12742)} Erddurchmesser${p.pa != null ? ` (am ${p.side}, ${Math.abs(Math.round(p.lat))}° ${p.lat >= 0 ? 'Nord' : 'Süd'})` : ''}.`]);
      lines.push(['g', '']);
    }
    lines.push(['d', `Daten: NOAA SWPC (SRS), ${st.mode === 'ha' ? 'NSO/GONG' : 'NASA SDO'} via Helioviewer`]);
    return lines;
  }

  function legendLines() {
    const al = st.align, e = st.eph, loc = st.cfg.location;
    const how = { auto: `automatisch (${st.mode === 'ha' && st.type !== 'surface' ? 'GONG' : 'SDO'}-Abgleich)`, field: 'fortgeschrieben (Bildfeldrotation)', manual: 'manuell', none: 'nicht ausgerichtet' }[al.method];
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
    // Kalzium: Plages vor der Regionsliste (sonst bei vielen Regionen abgeschnitten)
    if (st.caPlages && st.caPlages.list.length) {
      const P = st.caPlages;
      lines.push(['s', 'Plages (Kalzium, gemessen)']);
      lines.push(['m', `gesamt ${P.totalMH.toLocaleString('de-DE')} MH · ${num(P.coverage, 2)} % der Halbkugel`]);
      for (const p of P.list.slice(0, 4)) lines.push(['a', `${(p.region ? 'AR ' + p.region : 'neu?').padEnd(8)} ${p.areaMH.toLocaleString('de-DE').padStart(6)} MH  +${Math.round(p.excess * 100)} %`]);
      lines.push(['g', '']);
    }
    if (st.groups && st.groups.length) {
      lines.push(['s', chromo() ? 'Aktive Regionen' : 'Fleckengruppen (NOAA)']);
      for (const g of st.groups) {
        const r = g.region;
        if (r.type !== 'spots' && !chromo()) continue;
        if (st.type !== 'full' && !g.spots.length && !inField(g)) continue; // nur Regionen im Bildausschnitt
        if (r.type !== 'spots') { lines.push(['a', `AR ${r.region}  Plage  ${r.location}`]); continue; }
        lines.push(['a', `AR ${r.region}  ${r.spotClass}  ${M.magSymbol(r.magClass) || '–'}  ${r.location}`]);
        lines.push(['m', `  ${r.area ?? '–'} MH · ${r.numberSpots ?? '–'} Flecken · M-Flare ${r.probs.m ?? '–'} %`]);
        const z = M.Z[r.spotClass[0]]; if (z) lines.push(['d', `  ${z}`]);
      }
      if (st.extra.length) lines.push(['m', `${st.extra.length} Gruppe(n) ohne NOAA-Nummer („neu?“)`]);
    } else if (al.method !== 'none') lines.push(['m', 'Keine nummerierten Regionen sichtbar.']);
    if (st.curOpt && flaresOn(st.curOpt)) {
      const fl = dayFlareList();
      lines.push(['g', '']); lines.push(['s', 'Flares ±12 h']);
      if (!fl) lines.push(['m', 'Keine Flare-Daten für diesen Tag']);
      else if (!fl.length) lines.push(['m', 'Keine C-, M- oder X-Flares']);
      for (const f of (fl || []).slice(0, 5)) lines.push(['a', `${f.cls.padEnd(5)} ${new Date(f.max).toISOString().slice(11, 16)} UTC  ${f.region ? 'AR ' + f.region : 'ohne Region'}`]);
      if (fl && fl.length > 5) lines.push(['m', `… und ${fl.length - 5} weitere`]);
    }
    if (st.proms && st.proms.length) {
      lines.push(['g', '']); lines.push(['s', 'Protuberanzen']);
      for (const p of st.proms.slice(0, 5)) lines.push(['a', `${p.pa != null ? 'PA ' + String(Math.round(p.pa)).padStart(3) + '°' : 'Bild ' + Math.round((p.angle * 180) / Math.PI) + '°'}  ${kmFmt(p.km).padStart(7)} km${p.lat != null ? `  ${Math.abs(Math.round(p.lat))}° ${p.lat >= 0 ? 'N' : 'S'}` : ''}`]);
    }
    if (st.sharp) { lines.push(['g', '']); lines.push(['m', `Bildschärfe am Rand ≈ ${num(st.sharp.arcsec)}″${st.seeingRec && st.seeingRec.model ? ` · Modell ${num(st.seeingRec.model)}″` : ''}`]); }
    lines.push(['g', '']);
    lines.push(['d', `Daten: NOAA SWPC (SRS), ${st.mode === 'ha' ? 'NSO/GONG' : 'NASA SDO'} via Helioviewer`]);
    return lines;
  }

  function drawLegend(x, S, H, L, fs, mono, accent, textMode = 'list') {
    x.fillStyle = '#0b0b0c'; x.fillRect(S, 0, L, H);
    x.fillStyle = '#1e1e22'; x.fillRect(S, 0, Math.max(1, fs * 0.08), H);
    const pad = fs * 1.4, maxW = L - pad * 2; let y = pad * 1.4;
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    const wrap = (txt, font) => { x.font = font; const out = []; let cur = ''; for (const w of txt.split(' ')) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { out.push(cur); cur = '  ' + w; } else cur = t; } out.push(cur); return out; };
    for (const [kind, text] of (textMode === 'summary' ? summaryLines() : legendLines())) {
      if (y > H - pad) break;
      let font, color, lh;
      if (kind === 'h') { font = `700 ${Math.round(fs * 1.35)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; color = '#ece8e1'; lh = fs * 1.9; }
      else if (kind === 's') { font = `600 ${Math.round(fs * 0.8)}px ${mono}`; color = '#6f6a63'; lh = fs * 1.5; }
      else if (kind === 'a') { font = `600 ${Math.round(fs * 0.95)}px ${mono}`; color = accent; lh = fs * 1.35; }
      else if (kind === 't') { font = `500 ${Math.round(fs * 1.0)}px ${mono}`; color = accent; lh = fs * 1.4; }
      else if (kind === 'd') { font = `400 ${Math.round(fs * 0.78)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; color = '#8e8a83'; lh = fs * 1.15; }
      else if (kind === 'p') { font = `400 ${Math.round(fs * 0.9)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; color = '#ece8e1'; lh = fs * 1.3; }
      else if (kind === 'g') { y += fs * 0.6; continue; }
      else { font = `400 ${Math.round(fs * 0.82)}px ${mono}`; color = '#b9b5ad'; lh = fs * 1.2; }
      x.fillStyle = color;
      for (const ln of wrap(kind === 's' ? text.toUpperCase() : text, font)) { if (y > H - pad) break; x.font = font; x.fillText(ln, S + pad, y); y += lh; }
    }
  }

  /* ---------------- Textdatei ---------------- */
  function baseName() {
    const d = st.time.toISOString();
    return `Sonne_${MODE_FILE[st.mode]}_${d.slice(0, 10)}_${d.slice(11, 13)}${d.slice(14, 16)}UTC`;
  }

  function buildText() {
    const e = st.eph, al = st.align, loc = st.cfg.location, r = st.result;
    const L = [];
    const how = { auto: `automatisch per Abgleich mit ${st.mode === 'ha' && st.type !== 'surface' ? 'GONG (NSO)' : 'SDO'}`, field: 'fortgeschrieben aus letzter Ausrichtung (Bildfeldrotation)', manual: 'manuell', none: 'nicht ausgerichtet' }[al.method];
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
    if (st.scaleFull) { const o = opticsFor(); L.push(`Optik:          ${o.focal} mm · ${o.pixel} µm · Bin ${o.binning || 1} → ${st.scaleFull.toFixed(3)}″/px`); }
    if (st.sharp) L.push(`Bildschärfe:    Randabfall ${st.sharp.arcsec.toFixed(2)}″ (Halbwertsbreite)${st.seeingRec && st.seeingRec.model ? ` · Seeing-Modell zur Aufnahmezeit ${st.seeingRec.model.toFixed(2)}″ (unkalibriert)` : ''}`);
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
      if (chromo() && plages.length) {
        L.push(`PLAGES OHNE FLECKEN (im ${st.mode === 'ha' ? 'H-Alpha' : 'Kalzium'}-Licht hell)`);
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
    if (st.caPlages) {
      const P = st.caPlages;
      L.push('');
      L.push('PLAGES (KALZIUM) – gemessen in deiner Aufnahme');
      L.push('-'.repeat(60));
      L.push(`   Gesamtfläche ${P.totalMH.toLocaleString('de-DE')} MH = ${P.coverage.toFixed(2)} % der Halbkugel · mittlere Mehrhelligkeit der Scheibe ${(P.meanExcess * 100).toFixed(2)} %`);
      L.push(`   Schwelle: ${Math.round(P.threshold * 100)} % heller als der Ring-Median · Mindestgröße 40 MH`);
      for (const p of P.list) L.push(`   ${(p.region ? 'AR ' + p.region : 'ohne Nr.').padEnd(9)} ${p.loc || '–'}   ${String(p.areaMH).padStart(6)} MH   +${Math.round(p.excess * 100)} % (Mittel)   +${Math.round(p.peak * 100)} % (Spitze)`);
      L.push('   Hinweis: Helligkeiten hängen von der Bildbearbeitung ab – Vergleichswerte für eigene Aufnahmen mit gleichem Ablauf.');
    }
    {
      const fl = dayFlareList();
      L.push('');
      L.push('FLARES ±12 h UM DIE AUFNAHME (NOAA SWPC, GOES-Röntgen)');
      L.push('-'.repeat(60));
      if (!fl) L.push('   keine Flare-Daten für diesen Zeitraum (NOAA-Archiv nicht erreichbar)');
      else L.push(`   Quelle: ${st.flareInfo && st.flareInfo.source === 'NOAA-Archiv' ? 'NOAA-Ereignisarchiv (NCEI)' : 'NOAA SWPC, lokal gespeichert'}`);
      if (fl && !fl.length) L.push('   keine C-, M- oder X-Flares');
      for (const f of fl || []) L.push(`   ${f.cls.padEnd(5)} Maximum ${flareWhen(f)}${f.region ? ` · AR ${f.region}` : ' · ohne Region'}${f.location ? ` (${f.location})` : ''}${f.optical ? ` · optisch ${f.optical}` : ''}`);
    }
    if (st.mode === 'ha' && st.proms) {
      L.push('');
      L.push(`PROTUBERANZEN  ·  ${Math.round((st.promCoverage || 0) * 100)} % des Sonnenrands im Bild`);
      L.push('-'.repeat(60));
      if (!st.proms.length) L.push('   keine deutlichen Protuberanzen über ca. 7.000 km');
      for (const p of st.proms) L.push(`   ${promText(p)}`);
      L.push('   Höhe = Abstand vom Sonnenrand, projiziert (Mindesthöhe). PA = Positionswinkel von Sonnennord über Ost.');
    }
    L.push('Begriffe: McIntosh-Klasse Zpc (Z = Gruppentyp, p = Penumbra, c = Verteilung);');
    L.push('Mt.-Wilson-Klasse α/β/γ/δ = magnetische Komplexität. MH = millionstel Sonnenhemisphäre.');
    L.push(`Quellen: NOAA SWPC Solar Region Summary · ${st.mode === 'ha' ? 'NSO/GONG H-Alpha' : 'NASA SDO (HMI/AIA)'} via Helioviewer.org`);
    L.push(`Erstellt mit Solux ${st.cfg.version} am ${fmt.dateShort.format(new Date())}`);
    return L.join('\n');
  }

  /* ---------------- Exportieren ---------------- */
  function exportName() { return baseName() + (st.exp.format === 'tiff' ? '.tif' : '.jpg'); }
  function updateExportPreview() {
    const e = st.exp, pv = st.preview, k = st.work ? st.work.k : 1;
    const w = pv ? Math.round(pv.width / k) : 0, h = pv ? Math.round(pv.height / k) : 0;
    const mb = e.format === 'tiff' ? (w * h * 4) / 1048576 : (w * h * (e.quality >= 100 ? 0.9 : e.quality >= 95 ? 0.45 : 0.3)) / 1048576;
    $('#exPrev').textContent = `${exportName()}${e.txt ? ' + .txt' : ''} · ${w.toLocaleString('de-DE')} × ${h.toLocaleString('de-DE')} px · ≈ ${mb.toFixed(1).replace('.', ',')} MB\nOrdner: ${st.cfg.recordings.folder || 'wird beim Exportieren gewählt'}`;
    $('#exQGrp').style.opacity = e.format === 'tiff' ? 0.4 : 1;
  }
  function openExport() {
    const e = st.exp;
    setSeg('exText', e.text); setSeg('exScale', e.scale); setSeg('exFormat', e.format); setSeg('exQ', e.quality);
    $('#exLabels').checked = e.labels !== false; $('#exGrid').checked = !!e.grid; $('#exFlares').checked = flaresOn(e); $('#exTxt').checked = e.txt !== false; $('#exProms').checked = e.proms !== false;
    $('#exPromsRow').hidden = st.mode !== 'ha';
    $('#exPlages').checked = e.plages !== false; $('#exPlagesRow').hidden = st.mode !== 'ca';
    $('#exScale').style.opacity = st.type === 'full' ? 1 : 0.4;
    updateExportPreview();
    $('#exportDlg').hidden = false;
  }
  const exSeg = (id, key, num) => $(id).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; setExp({ [key]: num ? +b.dataset.v : b.dataset.v }); setSeg(id.slice(1), num ? +b.dataset.v : b.dataset.v); updateExportPreview(); });
  exSeg('#exText', 'text'); exSeg('#exScale', 'scale'); exSeg('#exFormat', 'format'); exSeg('#exQ', 'quality', true);
  [['#exLabels', 'labels'], ['#exGrid', 'grid'], ['#exFlares', null], ['#exTxt', 'txt'], ['#exProms', 'proms'], ['#exPlages', 'plages']].forEach(([id, key]) => $(id).addEventListener('change', () => { setExp({ [key || flareKey()]: $(id).checked }); updateExportPreview(); }));
  $('#exCancel').addEventListener('click', () => ($('#exportDlg').hidden = true));
  $('#exFolderBtn').addEventListener('click', async () => { const f = await api.rec.chooseFolder(); if (f) { st.cfg.recordings.folder = f; updateExportPreview(); } });
  $('#saveBtn').addEventListener('click', openExport);
  $('#exportForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    let folder = st.cfg.recordings.folder;
    if (!folder) { folder = await api.rec.chooseFolder(); if (!folder) return; st.cfg.recordings.folder = folder; }
    const e = st.exp;
    $('#exGo').disabled = true; $('#exGo').textContent = 'Erzeuge …';
    try {
      await sleep(30);
      const cv = renderOutput(st.src, st.disc, e, 1);
      let payload;
      if (e.format === 'tiff') {
        const id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
        payload = { tiff: { rgba: id.data, w: cv.width, h: cv.height } };
      } else {
        const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', (e.quality || 95) / 100));
        payload = { jpeg: await blob.arrayBuffer() };
      }
      const res = await api.rec.save({ folder, baseName: baseName(), ...payload, txt: e.txt ? st.txt : null });
      $('#saved').innerHTML = `Gespeichert: <a id="reveal">${esc(res.jpgPath.split('/').pop())}</a>${res.txtPath ? ' + ' + esc(res.txtPath.split('/').pop()) : ''} · ${cv.width}×${cv.height} px`;
      $('#reveal').onclick = () => api.rec.reveal(res.jpgPath);
      $('#exportDlg').hidden = true;
      toast(e.format === 'tiff' ? 'TIFF gespeichert.' : 'JPEG gespeichert.');
    } catch (err) { toast('Exportieren fehlgeschlagen: ' + err.message); }
    $('#exGo').disabled = false; $('#exGo').textContent = 'Exportieren';
  });

  /* ---------------- Tagebuch ---------------- */
  /** Ausgewertete Aufnahme ins Tagebuch: Vorschaubild, ausgerichtete Fassung (Norden oben) und Messwerte. */
  async function saveDiary() {
    const w = st.work;
    const cv = renderOutput(w.canvas, w.disc, { text: 'none', scale: 'none', labels: false, grid: false, flares: false, flaresHa: false, proms: false, plages: false }, w.k);
    const g = cv.__geom;
    const resize = (c, m) => { const f = Math.min(1, m / Math.max(c.width, c.height)); const o = document.createElement('canvas'); o.width = Math.round(c.width * f); o.height = Math.round(c.height * f); const ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(c, 0, 0, o.width, o.height); return o; };
    const jpg = async (c, q) => (await new Promise((r) => c.toBlob(r, 'image/jpeg', q))).arrayBuffer();
    const regions = (st.groups || []).filter((gr) => (gr.region.type === 'spots' || chromo()) && gr.region.visible !== false && (st.type === 'full' || gr.spots.length || inField(gr)))
      .map((gr) => ({ region: gr.region.region, type: gr.region.type, spotClass: gr.region.spotClass || null, mag: gr.region.magClass || null, area: gr.region.area ?? null, numberSpots: gr.region.numberSpots ?? null, location: gr.region.location, x: +gr.x.toFixed(4), y: +gr.y.toFixed(4), seen: gr.spots.length }));
    const entry = {
      file: st.file.name, path: st.file.path, time: st.time.toISOString(), timeUnknown: !!st.timeUnknown, mode: st.mode, type: st.type, method: st.align.method,
      geom: g && g.r ? { cx: g.cx / cv.width, cy: g.cy / cv.height, r: g.r / cv.width, aspect: cv.width / cv.height } : null,
      regions, extra: (st.extra || []).length,
      proms: (st.proms || []).slice(0, 8).map((p) => ({ pa: p.pa != null ? Math.round(p.pa) : null, km: Math.round(p.km), lat: p.lat != null ? Math.round(p.lat) : null, side: p.side, width: Math.round(p.width) })),
      caIndex: st.caPlages ? { coverage: +st.caPlages.coverage.toFixed(3), totalMH: st.caPlages.totalMH, meanExcess: +st.caPlages.meanExcess.toFixed(4), plages: st.caPlages.list.slice(0, 12).map((p) => ({ region: p.region, areaMH: p.areaMH, excess: +p.excess.toFixed(3) })) } : null,
      sharp: st.sharp ? +st.sharp.arcsec.toFixed(2) : null, seeingModel: st.seeingRec && st.seeingRec.model ? +st.seeingRec.model.toFixed(2) : null,
      alt: +st.eph.alt.toFixed(1), place: st.cfg.location.name, regionsDay: st.regionsDay || null, version: st.cfg.version,
    };
    st.diaryId = await api.diary.add(entry, await jpg(resize(cv, 360), 0.82), await jpg(resize(cv, 1600), 0.88));
    logLine('▸ Im Beobachtungstagebuch gespeichert (Tagebuch oben rechts)', 'ok');
    if (window.SoluxDiaryView) window.SoluxDiaryView.refresh();
  }
  window.__soluxReload = (p) => loadPath(p);

  let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 3500); }

  init();
})();
