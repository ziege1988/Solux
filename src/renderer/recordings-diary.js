/* Solux – Beobachtungstagebuch: Übersicht, Details und Regionsverlauf als Animation */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const api = window.solux, U = window.SoluxUI, M = window.SoluxMcIntosh;
  const { fmt, esc } = U;
  const MODE = { wl: 'Weißlicht', ca: 'Kalzium', ha: 'H-Alpha' };
  const MODE_SHORT = { wl: 'WL', ca: 'Ca-K', ha: 'Hα' };
  const TYPE = { full: 'ganze Sonne', partial: 'Ausschnitt', surface: 'Oberfläche' };
  const num = (v, d = 1) => (v == null ? '–' : v.toFixed(d).replace('.', ','));
  const dv = { list: [], filter: 'all', imgs: new Map(), cur: null, track: null, timer: 0 };

  const when = (e) => `${fmt.dateShort.format(new Date(e.time))}${e.timeUnknown ? '' : ' ' + fmt.hm.format(new Date(e.time))}`;
  const spotRegions = (e) => (e.regions || []).filter((r) => r.type === 'spots');

  /* ---------------- Übersicht ---------------- */
  async function refresh() {
    dv.list = (await api.diary.list()) || [];
    if (!$('#diary').hidden) render();
  }
  function render() {
    const list = dv.list.filter((e) => dv.filter === 'all' || e.mode === dv.filter);
    const g = $('#dGrid');
    if (!dv.list.length) { g.innerHTML = '<div class="dempty"><b>Noch keine Einträge.</b><br>Jede ausgewertete Aufnahme landet automatisch hier – mit Regionen, Protuberanzen und Bildschärfe.<br>Ab zwei Aufnahmen derselben Region lässt sich ihre Entwicklung als Animation abspielen.</div>'; }
    else g.innerHTML = list.map((e) => {
      const sr = spotRegions(e), topP = (e.proms || []).reduce((m, p) => Math.max(m, p.km || 0), 0);
      const facts = [sr.length ? `${sr.length} Fleckengruppe${sr.length === 1 ? '' : 'n'}` : (e.regions || []).length ? `${e.regions.length} Region(en)` : 'keine nummerierten Regionen', topP ? `Protuberanz ${Math.round(topP / 1000)} Tsd. km` : '', e.sharp && e.mode === 'wl' ? `Schärfe ${num(e.sharp)}″` : ''].filter(Boolean).join(' · ');
      return `<button class="dcard" data-id="${e.id}">${e.thumb ? `<img src="${e.thumb}" alt="">` : '<img alt="">'}
        <div class="dm"><b><span class="badge ${e.mode}">${MODE_SHORT[e.mode] || e.mode}</span>${esc(when(e))}</b><span class="note">${esc(TYPE[e.type] || '')}${e.timeUnknown ? ' · Uhrzeit unbekannt' : ''}</span><span>${esc(facts)}</span>${e.note ? `<span class="note">✎ ${esc(e.note.slice(0, 60))}</span>` : ''}</div></button>`;
    }).join('');
    // Regionen, die mindestens zweimal vorkommen
    const cnt = new Map();
    for (const e of dv.list) for (const r of e.regions || []) if (r.region) cnt.set(r.region, (cnt.get(r.region) || 0) + 1);
    const opts = [...cnt.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[0] - a[0]);
    $('#dTrack').innerHTML = `<option value="">${opts.length ? 'Region verfolgen …' : 'Region verfolgen (ab 2 Aufnahmen)'}</option>` + opts.map(([r, n]) => `<option value="${r}">AR ${r} · ${n} Aufnahmen</option>`).join('');
    api.diary.info().then((i) => { $('#dInfo').textContent = `${i.count} Einträge · ${(i.bytes / 1048576).toFixed(1).replace('.', ',')} MB`; });
  }
  function open() { document.body.classList.add('diary-on'); $('#diary').hidden = false; $('#diaryBtn').classList.add('on'); refresh().then(render); }
  function close() { document.body.classList.remove('diary-on'); $('#diary').hidden = true; $('#diaryBtn').classList.remove('on'); }
  $('#diaryBtn').addEventListener('click', () => ($('#diary').hidden ? open() : close()));
  $('#dClose').addEventListener('click', close);
  $('#dFilter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; dv.filter = b.dataset.v; document.querySelectorAll('#dFilter button').forEach((x) => x.classList.toggle('on', x === b)); render(); });
  $('#dTrack').addEventListener('change', (e) => { if (e.target.value) { openTrack(+e.target.value); e.target.value = ''; } });
  $('#dGrid').addEventListener('click', (e) => { const c = e.target.closest('.dcard'); if (c) openDetail(c.dataset.id); });

  async function image(id) {
    if (dv.imgs.has(id)) return dv.imgs.get(id);
    const url = await api.diary.image(id);
    if (!url) return null;
    const img = new Image(); await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = url; });
    dv.imgs.set(id, img);
    return img;
  }

  /* ---------------- Detail ---------------- */
  async function openDetail(id) {
    const e = dv.list.find((x) => x.id === id); if (!e) return;
    dv.cur = e;
    $('#ddTitle').innerHTML = `<span class="badge ${e.mode}">${MODE_SHORT[e.mode]}</span>${esc(when(e))} · ${esc(MODE[e.mode])}`;
    const kv = [
      ['Datei', esc(e.file)], ['Aufnahme', `${new Date(e.time).toISOString().slice(0, 16).replace('T', ' ')} UTC${e.timeUnknown ? ' (Uhrzeit unbekannt)' : ''}`],
      ['Bildart', esc(TYPE[e.type] || '–')], ['Sonnenhöhe', `${num(e.alt)}°`], ['Ort', esc(e.place || '–')],
      ['Ausrichtung', { auto: 'automatisch', manual: 'manuell', field: 'fortgeschrieben' }[e.method] || '–'],
      ['Bildschärfe', e.sharp ? `${num(e.sharp)}″ am Rand${e.seeingModel ? ` · Modell ${num(e.seeingModel)}″` : ''}` : '–'],
    ];
    $('#ddKv').innerHTML = kv.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    const regs = (e.regions || []).filter((r) => r.region);
    $('#ddRegions').innerHTML = regs.length ? regs.map((r) => `<button data-r="${r.region}" title="Entwicklung von AR ${r.region} zeigen">AR ${r.region}${r.spotClass ? ' ' + esc(r.spotClass) : ' Plage'}${r.mag ? ' ' + esc(M.magSymbol(r.mag)) : ''}</button>`).join('') : '<span class="note">Keine nummerierten Regionen.</span>';
    $('#ddProms').innerHTML = (e.proms || []).length ? '<b>Protuberanzen:</b> ' + e.proms.slice(0, 5).map((p) => `${p.pa != null ? 'PA ' + p.pa + '°' : ''} ${Math.round(p.km / 1000)} Tsd. km`).join(' · ') : '';
    $('#ddNote').value = e.note || '';
    $('#dDetail').hidden = false;
    const cv = $('#ddCv'), img = await image(e.id);
    if (!img) { cv.width = 10; cv.height = 10; return; }
    cv.width = img.width; cv.height = img.height;
    const x = cv.getContext('2d'); x.drawImage(img, 0, 0);
    // Regionsnummern über das ausgerichtete Bild legen
    if (e.geom) {
      const gx = e.geom.cx * img.width, gy = e.geom.cy * img.height, gr = e.geom.r * img.width, fs = Math.max(11, Math.round(img.width * 0.018));
      x.font = `600 ${fs}px "SF Mono", Menlo, monospace`; x.textBaseline = 'middle';
      for (const r of regs) {
        const px = gx + r.x * gr, py = gy - r.y * gr; if (px < 0 || py < 0 || px > img.width || py > img.height) continue;
        x.strokeStyle = 'rgba(0,0,0,.75)'; x.lineWidth = Math.max(2, fs * 0.22); x.strokeText(String(r.region), px + fs * 0.7, py - fs * 0.7);
        x.fillStyle = r.type === 'spots' ? '#f3b544' : '#c9b0ff'; x.fillText(String(r.region), px + fs * 0.7, py - fs * 0.7);
      }
    }
  }
  $('#ddClose').addEventListener('click', () => { $('#dDetail').hidden = true; });
  $('#ddRegions').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) openTrack(+b.dataset.r, dv.cur && dv.cur.mode); });
  $('#ddNote').addEventListener('change', async () => { if (!dv.cur) return; await api.diary.note(dv.cur.id, $('#ddNote').value); dv.cur.note = $('#ddNote').value; render(); });
  $('#ddReveal').addEventListener('click', () => { if (dv.cur && dv.cur.path) api.rec.reveal(dv.cur.path); });
  $('#ddRerun').addEventListener('click', () => { if (!dv.cur || !dv.cur.path) return; $('#dDetail').hidden = true; close(); window.__soluxReload(dv.cur.path); });
  $('#ddDel').addEventListener('click', async () => {
    if (!dv.cur || !confirm('Diesen Tagebucheintrag löschen? Die Originaldatei bleibt erhalten.')) return;
    await api.diary.remove(dv.cur.id); dv.imgs.delete(dv.cur.id); $('#dDetail').hidden = true; await refresh(); render();
  });

  /* ---------------- Regionsverlauf ---------------- */
  function trackFrames(num, mode, same) {
    return dv.list.filter((e) => e.geom && (!same || !mode || e.mode === mode) && (e.regions || []).some((r) => r.region === num))
      .slice().sort((a, b) => new Date(a.time) - new Date(b.time));
  }
  async function openTrack(num, mode) {
    const all = dv.list.filter((e) => (e.regions || []).some((r) => r.region === num));
    // Standard: die Wellenlänge mit den meisten Aufnahmen dieser Region
    if (!mode) { const c = {}; for (const e of all) c[e.mode] = (c[e.mode] || 0) + 1; mode = Object.keys(c).sort((a, b) => c[b] - c[a])[0]; }
    dv.track = { num, mode, pos: 0, frames: [] };
    $('#tSame').checked = trackFrames(num, mode, true).length >= 2;
    $('#dTrackDlg').hidden = false;
    await buildTrack();
  }
  async function buildTrack() {
    const t = dv.track; stop();
    t.frames = trackFrames(t.num, t.mode, $('#tSame').checked);
    $('#tTitle').textContent = `AR ${t.num} · Entwicklung über ${t.frames.length} Aufnahme${t.frames.length === 1 ? '' : 'n'}`;
    $('#tPos').max = Math.max(0, t.frames.length - 1); $('#tPos').value = 0; t.pos = 0;
    $('#tTab').innerHTML = '<thead><tr><th>Datum</th><th></th><th>Klasse</th><th>Fläche</th><th>Flecken</th><th>Ort</th></tr></thead><tbody>' + t.frames.map((e, i) => {
      const r = e.regions.find((q) => q.region === t.num);
      return `<tr data-i="${i}"><td>${esc(when(e))}</td><td><span class="badge ${e.mode}">${MODE_SHORT[e.mode]}</span></td><td>${esc(r.spotClass || 'Plage')} ${esc(M.magSymbol(r.mag) || '')}</td><td>${r.area != null ? r.area + ' MH' : '–'}</td><td>${r.numberSpots ?? '–'}</td><td>${esc(r.location || '')}</td></tr>`;
    }).join('') + '</tbody>';
    await Promise.all(t.frames.map((e) => image(e.id).catch(() => null)));
    draw();
  }
  function draw() {
    const t = dv.track, cv = $('#tCv'), x = cv.getContext('2d'), S = cv.width;
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    const e = t.frames[t.pos]; if (!e) return;
    const img = dv.imgs.get(e.id), r = e.regions.find((q) => q.region === t.num);
    document.querySelectorAll('#tTab tbody tr').forEach((tr) => tr.classList.toggle('on', +tr.dataset.i === t.pos));
    if (img && r) {
      const gr = e.geom.r * img.width, px = e.geom.cx * img.width + r.x * gr, py = e.geom.cy * img.height - r.y * gr;
      const half = gr * 0.22; // ≈ 300.000 km Bildfeld
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, px - half, py - half, half * 2, half * 2, 0, 0, S, S);
    }
    // Beschriftung
    x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, S - 54, S, 54);
    x.font = '600 17px -apple-system, "Helvetica Neue", Arial, sans-serif'; x.fillStyle = '#f2eee6'; x.textBaseline = 'middle';
    x.fillText(`${when(e)}  ·  ${MODE[e.mode]}`, 14, S - 36);
    x.font = '500 14px "SF Mono", Menlo, monospace'; x.fillStyle = '#f3b544';
    x.fillText(`AR ${t.num}  ${r && r.spotClass ? r.spotClass : 'Plage'} ${r && r.mag ? M.magSymbol(r.mag) : ''}  ${r && r.area != null ? r.area + ' MH' : ''}`, 14, S - 14);
    x.textAlign = 'right'; x.fillStyle = '#9a958d'; x.fillText(`${t.pos + 1}/${t.frames.length}`, S - 14, S - 14); x.textAlign = 'left';
    $('#tPos').value = t.pos;
  }
  function stop() { clearInterval(dv.timer); dv.timer = 0; $('#tPlay').textContent = '▶ Abspielen'; }
  function play() {
    const t = dv.track; if (!t || t.frames.length < 2) return;
    $('#tPlay').textContent = '❚❚ Pause';
    dv.timer = setInterval(() => { t.pos = (t.pos + 1) % t.frames.length; draw(); }, +$('#tSpeed').value);
  }
  $('#tPlay').addEventListener('click', () => (dv.timer ? stop() : play()));
  $('#tSpeed').addEventListener('change', () => { if (dv.timer) { stop(); play(); } });
  $('#tPos').addEventListener('input', (e) => { stop(); dv.track.pos = +e.target.value; draw(); });
  $('#tTab').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) { stop(); dv.track.pos = +tr.dataset.i; draw(); } });
  $('#tSame').addEventListener('change', buildTrack);
  $('#tClose').addEventListener('click', () => { stop(); $('#dTrackDlg').hidden = true; });

  window.SoluxDiaryView = { refresh, open, close };
  refresh();
})();
