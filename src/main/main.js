/*
 * Solux – Hauptprozess
 * Fenster (Widget, Startbild, Aufnahmen), Menüleisten-Symbol, Daten-Aktualisierung,
 * Benachrichtigungen, Dateizugriff und Updates.
 */
'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, screen, shell, Notification, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { Config } = require('./config');
const { DataStore, setFetch: setDataFetch } = require('./data');
const updater = require('./updater');
const { Diary } = require('./diary');
const astro = require('../shared/astro');
const SW = require('../shared/spaceweather');

const R = (...p) => path.join(__dirname, '..', ...p);
const BUILD = path.join(__dirname, '..', '..', 'build');
const WIDGET_W = 420, WIDGET_H = 820;

let config, store, diary, tray = null;
let widgetWin = null, splashWin = null, recWin = null;
let refreshTimer = null, pendingUpdate = null;
const isMac = process.platform === 'darwin';

// Nur Entwicklung/Test: eigener Datenordner und automatische Bildschirmfotos
if (!app.isPackaged && process.env.SOLUX_USERDATA) app.setPath('userData', process.env.SOLUX_USERDATA);

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (widgetWin) { widgetWin.show(); widgetWin.focus(); } });

function log(msg) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'solux.log'), `${new Date().toISOString()} ${msg}\n`); } catch { /* egal */ }
}

/* ---------------- Fenster ---------------- */
function createWidget() {
  const cfg = config.get().widget;
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.round(WIDGET_W * cfg.scale), h = Math.round(WIDGET_H * cfg.scale);
  let x = cfg.x, y = cfg.y;
  const visible = screen.getAllDisplays().some((d) => x != null && x >= d.workArea.x - 50 && x < d.workArea.x + d.workArea.width - 50 && y >= d.workArea.y - 20 && y < d.workArea.y + d.workArea.height - 50);
  if (!visible) { x = wa.x + wa.width - w - 24; y = wa.y + 24; }
  widgetWin = new BrowserWindow({
    x, y, width: w, height: h, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: true, show: false, alwaysOnTop: !!cfg.alwaysOnTop,
    title: 'Solux', backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, zoomFactor: cfg.scale },
  });
  widgetWin.setOpacity(cfg.opacity || 1);
  if (isMac) widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  widgetWin.loadFile(R('renderer', 'widget.html'));
  widgetWin.on('moved', () => { const [nx, ny] = widgetWin.getPosition(); config.set({ widget: { x: nx, y: ny } }); });
  widgetWin.on('closed', () => { widgetWin = null; });
  widgetWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function showSplash(then) {
  splashWin = new BrowserWindow({
    width: 380, height: 380, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    center: true, show: false, hasShadow: false, focusable: false, webPreferences: { contextIsolation: true },
  });
  splashWin.loadFile(R('renderer', 'splash.html'));
  splashWin.once('ready-to-show', () => splashWin.show());
  setTimeout(() => {
    if (splashWin && !splashWin.isDestroyed()) splashWin.close();
    splashWin = null;
    then && then();
  }, 2600);
}

function openRecordings() {
  if (recWin) { recWin.show(); recWin.focus(); return; }
  if (isMac && app.dock) app.dock.show();
  recWin = new BrowserWindow({
    width: 1280, height: 860, minWidth: 980, minHeight: 680, title: 'Solux · Aufnahmen', backgroundColor: '#0b0b0c',
    titleBarStyle: isMac ? 'hiddenInset' : 'default', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  recWin.loadFile(R('renderer', 'recordings.html'));
  recWin.once('ready-to-show', () => recWin.show());
  recWin.on('closed', () => { recWin = null; if (isMac && app.dock) app.dock.hide(); notifyAll('recordings-closed'); });
  notifyAll('recordings-opened');
}

/** Großansicht der Sonne in einem eigenen Fenster (Mausrad zoomt, Ziehen verschiebt). */
let viewerWin = null;
function openViewer(kind = 'wl') {
  if (viewerWin && !viewerWin.isDestroyed()) viewerWin.close();
  const wa = screen.getPrimaryDisplay().workArea, side = Math.round(Math.min(wa.width, wa.height) * 0.9);
  viewerWin = new BrowserWindow({
    width: side, height: side, minWidth: 420, minHeight: 420, title: 'Solux · Sonne', backgroundColor: '#000000',
    frame: false, show: false, fullscreenable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  viewerWin.loadFile(R('renderer', 'viewer.html'), { query: { kind: ['wl', 'ca', 'ha'].includes(kind) ? kind : 'wl' } });
  viewerWin.once('ready-to-show', () => { viewerWin.show(); viewerWin.focus(); });
  viewerWin.on('closed', () => { viewerWin = null; });
}

function toggleWidget(show) {
  if (!widgetWin) createWidget();
  const vis = show ?? !widgetWin.isVisible();
  if (vis) widgetWin.show(); else widgetWin.hide();
  config.set({ widget: { visible: vis } });
  buildTrayMenu();
}

function notifyAll(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

/* ---------------- Menüleiste & App-Menü ---------------- */
function createTray() {
  let img = nativeImage.createFromPath(path.join(BUILD, 'trayTemplate.png'));
  if (img.isEmpty()) img = nativeImage.createEmpty();
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Solux');
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  const visible = widgetWin && widgetWin.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Widget ausblenden' : 'Widget einblenden', click: () => toggleWidget() },
    { label: 'Aufnahmen …', click: openRecordings },
    { label: 'Einstellungen …', click: () => { toggleWidget(true); widgetWin.webContents.send('show-settings'); } },
    { type: 'separator' },
    { label: pendingUpdate ? `Update ${pendingUpdate.latest} installieren` : 'Nach Updates suchen …', click: () => { toggleWidget(true); widgetWin.webContents.send('show-settings', 'about'); } },
    { type: 'separator' },
    { label: 'Solux beenden', click: () => app.quit() },
  ]));
}

function buildAppMenu() {
  const template = [
    ...(isMac ? [{ label: 'Solux', submenu: [{ role: 'about', label: 'Über Solux' }, { type: 'separator' }, { role: 'hide', label: 'Solux ausblenden' }, { type: 'separator' }, { role: 'quit', label: 'Solux beenden' }] }] : []),
    { label: 'Bearbeiten', submenu: [{ role: 'undo', label: 'Widerrufen' }, { role: 'redo', label: 'Wiederholen' }, { type: 'separator' }, { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einsetzen' }, { role: 'selectAll', label: 'Alles auswählen' }] },
    { label: 'Fenster', submenu: [{ label: 'Aufnahmen', accelerator: 'CmdOrCtrl+Shift+A', click: openRecordings }, { role: 'close', label: 'Schließen' }, { role: 'minimize', label: 'Im Dock ablegen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- Daten-Aktualisierung & Hinweise ---------------- */
async function refresh() {
  try {
    const r = await store.refreshSpaceWeather();
    log(`Weltraumwetter aktualisiert (${r.ok}/${r.total})`);
    notifyAll('data-updated');
    checkNotifications();
  } catch (e) { log('Aktualisierung fehlgeschlagen: ' + e.message); }
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  const min = Math.max(5, config.get().data.refreshMinutes || 15);
  refreshTimer = setInterval(refresh, min * 60000);
}

/**
 * Mitteilungen am Mac – gleiche Regeln wie beim Handy (spaceweather.pushMessages):
 * Stufe alle / interessant / aus, nur bei Sonne über dem Horizont, jede Meldung höchstens einmal am Tag.
 */
async function checkNotifications() {
  if (!Notification.isSupported()) return;
  const cfg = config.get();
  const mode = cfg.notify.mode || 'interessant';
  if (mode === 'aus') return;
  const { lat, lon } = cfg.location;
  if (astro.sunAltAz(new Date(), lat, lon).alt <= 0) return;
  const seen = new Set(cfg.notify.seen || []);
  let regions = [];
  try { regions = (await store.regionsFor(new Date())).regions; } catch { /* offline */ }
  const msgs = SW.pushMessages(store.news(cfg), regions, mode).filter((m) => !seen.has(m.key));
  for (const m of msgs.slice(0, 3)) new Notification({ title: m.title, body: m.body, silent: false }).show();
  for (const m of msgs) seen.add(m.key);
  config.set({ notify: { seen: [...seen].slice(-400) } });
}

async function checkGoodWindow() {
  const cfg = config.get();
  if (!cfg.notify.goodWindow || !Notification.isSupported()) return;
  try {
    const w = await store.weather(cfg);
    const h = w.hours[0];
    if (!h || h.seeing == null) return;
    const good = h.cloud < 20 && h.seeing < 2 && h.wind < 1.6;
    const key = `good|${new Date().toISOString().slice(0, 10)}`;
    const seen = new Set(cfg.notify.seen || []);
    if (good && !seen.has(key)) {
      new Notification({ title: 'Solux · Gutes Beobachtungsfenster', body: `Klar, Seeing ca. ${h.seeing.toFixed(1)}″, windstill – jetzt lohnt sich die Sonne.` }).show();
      seen.add(key); config.set({ notify: { seen: [...seen].slice(-300) } });
    }
  } catch { /* offline */ }
}

async function autoUpdateCheck() {
  const cfg = config.get();
  if (!cfg.update.auto || !app.isPackaged) return;
  try {
    const info = await updater.checkForUpdate(cfg.update.repo, app.getVersion());
    config.set({ update: { lastCheck: new Date().toISOString() } });
    if (info.available) {
      pendingUpdate = info; buildTrayMenu(); notifyAll('update-available', info);
      if (Notification.isSupported()) new Notification({ title: 'Solux-Update verfügbar', body: `Version ${info.latest} kann in den Einstellungen installiert werden.` }).show();
    }
  } catch (e) { log('Update-Prüfung: ' + e.message); }
}

/* ---------------- Bilder laden (JPEG/TIFF + EXIF) ---------------- */
async function loadImageFile(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const exifr = require('exifr');
  let exif = null;
  try { exif = await exifr.parse(buf, { reviveValues: false, pick: ['DateTimeOriginal', 'CreateDate', 'DateTime', 'ModifyDate', 'OffsetTimeOriginal', 'OffsetTime', 'Make', 'Model', 'ExposureTime', 'ImageDescription'] }); } catch { /* keine EXIF */ }
  const stat = fs.statSync(file);
  const meta = { name: path.basename(file), path: file, size: stat.size, mtime: stat.mtime.toISOString(), exif: exif || null };
  if (ext === '.tif' || ext === '.tiff') {
    const UTIF = require('utif');
    const ifds = UTIF.decode(buf);
    const page = ifds.reduce((a, b) => ((b.width || 0) * (b.height || 0) > (a.width || 0) * (a.height || 0) ? b : a), ifds[0]);
    UTIF.decodeImage(buf, page, ifds);
    const rgba = UTIF.toRGBA8(page);
    return { ...meta, format: 'tiff', width: page.width, height: page.height, rgba: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength) };
  }
  return { ...meta, format: ext === '.png' ? 'png' : 'jpeg', bytes: buf };
}

/* ---------------- IPC ---------------- */
function registerIpc() {
  ipcMain.handle('config:get', () => ({ ...config.get(), version: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle('config:set', (_e, patch) => {
    const before = config.get();
    const cfg = config.set(patch);
    if (widgetWin) {
      if (patch.widget && 'alwaysOnTop' in patch.widget) widgetWin.setAlwaysOnTop(!!cfg.widget.alwaysOnTop);
      if (patch.widget && 'opacity' in patch.widget) widgetWin.setOpacity(cfg.widget.opacity);
      if (patch.widget && 'scale' in patch.widget && cfg.widget.scale !== before.widget.scale) {
        widgetWin.setSize(Math.round(WIDGET_W * cfg.widget.scale), Math.round(WIDGET_H * cfg.widget.scale));
        widgetWin.webContents.setZoomFactor(cfg.widget.scale);
      }
    }
    if (patch.general && 'openAtLogin' in patch.general) app.setLoginItemSettings({ openAtLogin: !!cfg.general.openAtLogin });
    if (patch.data) scheduleRefresh();
    if (patch.location) notifyAll('data-updated');
    return cfg;
  });
  ipcMain.handle('data:refresh', () => refresh());
  ipcMain.handle('data:sun', (_e, kind, date, size) => store.sunImage(kind, date, Math.min(4096, size || undefined) || undefined));
  ipcMain.handle('data:regions', (_e, date) => store.regionsFor(date ? new Date(date) : new Date()));
  ipcMain.handle('data:regionHistory', (_e, num) => store.regionHistory(num));
  ipcMain.handle('data:flares', (_e, since) => store.flares(since));
  ipcMain.handle('data:flaresAround', (_e, date) => store.flaresAround(date));
  ipcMain.handle('data:news', () => store.news(config.get()));
  ipcMain.handle('data:weather', () => store.weather(config.get()));
  ipcMain.handle('data:rateSeeing', (_e, rating, model) => store.addRating(rating, model));
  ipcMain.handle('seeing:record', async (_e, rec) => { const r = await store.seeingRecord(config.get(), rec); notifyAll('data-updated'); return r; });
  ipcMain.handle('seeing:info', () => store.seeingInfo());
  ipcMain.handle('seeing:reset', () => { const r = store.seeingReset(); notifyAll('data-updated'); return r; });
  ipcMain.handle('diary:add', (_e, entry, thumb, aligned) => diary.add(entry, thumb, aligned));
  ipcMain.handle('diary:list', () => diary.list());
  ipcMain.handle('diary:image', (_e, id) => diary.image(id));
  ipcMain.handle('diary:remove', (_e, id) => diary.remove(id));
  ipcMain.handle('diary:note', (_e, id, text) => diary.note(id, text));
  ipcMain.handle('diary:info', () => diary.info());
  ipcMain.handle('data:storeInfo', () => {
    const dir = store.dir; let bytes = 0;
    const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.statSync(p); if (s.isDirectory()) walk(p); else bytes += s.size; } };
    walk(dir);
    const regions = store.load('regions.json', {});
    const days = [...new Set(Object.keys(regions).map((k) => k.split('|')[0]))].sort();
    return { bytes, days: days.length, from: days[0], to: days[days.length - 1], dir };
  });
  ipcMain.handle('data:clearImages', () => { fs.rmSync(path.join(store.dir, 'images'), { recursive: true, force: true }); fs.mkdirSync(path.join(store.dir, 'images')); return true; });
  ipcMain.handle('geo:search', async (_e, name) => {
    const r = await store.fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=de&format=json`);
    return (r.results || []).map((x) => ({ name: x.name, admin: [x.admin3, x.admin2, x.admin1].filter(Boolean).join(', '), country: x.country, lat: x.latitude, lon: x.longitude, elevation: x.elevation }));
  });

  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:openRecordings', () => openRecordings());
  ipcMain.handle('app:openViewer', (_e, kind) => openViewer(kind));
  ipcMain.handle('app:hideWidget', () => toggleWidget(false));
  ipcMain.handle('app:openExternal', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle('app:showLog', () => shell.showItemInFolder(path.join(app.getPath('userData'), 'solux.log')));

  ipcMain.handle('rec:openDialog', async () => {
    const r = await dialog.showOpenDialog(recWin, { properties: ['openFile'], filters: [{ name: 'Sonnenaufnahmen', extensions: ['jpg', 'jpeg', 'tif', 'tiff', 'png'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('rec:load', (_e, file) => loadImageFile(file));
  ipcMain.handle('rec:chooseFolder', async (_e) => {
    const opts = { properties: ['openDirectory', 'createDirectory'], defaultPath: config.get().recordings.folder || app.getPath('pictures') };
    const parent = BrowserWindow.fromWebContents(_e.sender);
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled) return null;
    config.set({ recordings: { folder: r.filePaths[0] } });
    return r.filePaths[0];
  });
  ipcMain.handle('rec:save', async (_e, { folder, baseName, jpeg, tiff, txt }) => {
    folder = folder || config.get().recordings.folder;
    if (!folder) throw new Error('Kein Zielordner gewählt.');
    fs.mkdirSync(folder, { recursive: true });
    const ext = tiff ? '.tif' : '.jpg';
    let base = baseName, n = 1;
    while (fs.existsSync(path.join(folder, base + ext))) base = `${baseName}_${++n}`;
    const jpgPath = path.join(folder, base + ext);
    if (tiff) {
      // verlustfreies TIFF (RGB, 8 Bit je Kanal)
      const UTIF = require('utif');
      const rgba = new Uint8Array(tiff.rgba.buffer || tiff.rgba, tiff.rgba.byteOffset || 0, tiff.w * tiff.h * 4);
      fs.writeFileSync(jpgPath, Buffer.from(UTIF.encodeImage(rgba, tiff.w, tiff.h)));
    } else fs.writeFileSync(jpgPath, Buffer.from(jpeg));
    let txtPath = null;
    if (txt) { txtPath = path.join(folder, base + '.txt'); fs.writeFileSync(txtPath, txt, 'utf8'); }
    return { jpgPath, txtPath };
  });
  ipcMain.handle('rec:reveal', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('rec:profileUpdate', (_e, mode, entry) => {
    const cfg = config.get();
    const prof = cfg.profiles[mode];
    prof.history = [...(prof.history || []), entry].slice(-40);
    const flips = prof.history.filter((h) => h.auto).map((h) => h.flip);
    if (flips.length) prof.flip = flips.filter(Boolean).length * 2 > flips.length;
    // Drehsinn der Bildfeldrotation aus zwei automatischen Ausrichtungen bestimmen
    const autos = prof.history.filter((h) => h.auto && h.flip === prof.flip);
    for (let i = autos.length - 1; i > 0; i--) {
      const a = autos[i], b = autos[i - 1];
      const dpq = astro.norm180(a.pq - b.pq), drot = astro.norm180(a.rotation - b.rotation);
      if (Math.abs(dpq) > 5 && new Date(a.time) - new Date(b.time) < 12 * 3600000) { prof.sigma = Math.sign(drot / dpq) || 1; break; }
    }
    config.set({ profiles: { [mode]: prof } });
    return prof;
  });
  ipcMain.handle('rec:profileReset', (_e, mode) => { config.set({ profiles: { [mode]: { flip: null, sigma: 1, history: [] } } }); notifyAll('data-updated'); return config.get().profiles[mode]; });

  ipcMain.handle('update:check', async () => {
    const info = await updater.checkForUpdate(config.get().update.repo, app.getVersion());
    config.set({ update: { lastCheck: new Date().toISOString() } });
    pendingUpdate = info.available ? info : null; buildTrayMenu();
    return info;
  });
  ipcMain.handle('update:install', async (e) => {
    if (!pendingUpdate) throw new Error('Kein Update vorgemerkt.');
    await updater.downloadAndInstall(pendingUpdate, (p) => e.sender.send('update-progress', p));
    setTimeout(() => app.quit(), 300);
    return true;
  });
}

/* ---------------- Entwicklung: Bildschirmfotos ---------------- */
async function devScreenshots(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (win, name) => { if (win && !win.isDestroyed()) fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  await wait(Number(process.env.SOLUX_SHOT_WAIT || 20000));
  await shot(widgetWin, 'widget');
  for (const js of (process.env.SOLUX_SHOT_STEPS || '').split('||').filter(Boolean)) {
    const [name, code] = js.split('::');
    await widgetWin.webContents.executeJavaScript(code).catch((e) => log('shot ' + e.message));
    await wait(2500);
    await shot(widgetWin, name);
  }
  if (viewerWin && !viewerWin.isDestroyed()) {
    await wait(Number(process.env.SOLUX_SHOT_VIEW_WAIT || 12000));
    await shot(viewerWin, 'viewer');
    if (process.env.SOLUX_SHOT_VIEW_JS) { await viewerWin.webContents.executeJavaScript(process.env.SOLUX_SHOT_VIEW_JS).catch((e) => log('view js ' + e.message)); await wait(1500); await shot(viewerWin, 'viewer2'); }
  }
  if (process.env.SOLUX_SHOT_REC) {
    openRecordings(); await wait(3000);
    // Mehrere Dateien nacheinander: SOLUX_SHOT_REC='[{"path":"…","opts":{…},"wait":20000}, …]'
    const seq = process.env.SOLUX_SHOT_REC.startsWith('[') ? JSON.parse(process.env.SOLUX_SHOT_REC) : process.env.SOLUX_SHOT_REC !== '1' ? [{ path: process.env.SOLUX_SHOT_REC, opts: JSON.parse(process.env.SOLUX_SHOT_REC_OPTS || 'null') }] : [];
    let i = 0;
    for (const it of seq) {
      await recWin.webContents.executeJavaScript(`window.__soluxTestLoad && window.__soluxTestLoad(${JSON.stringify(it.path)}, ${JSON.stringify(it.opts || null)})`).catch((e) => log('rec ' + e.message));
      await wait(Number(it.wait || process.env.SOLUX_SHOT_REC_WAIT || 15000));
      await shot(recWin, seq.length > 1 ? `recordings_${++i}` : 'recordings');
    }
    if (!seq.length) { await wait(Number(process.env.SOLUX_SHOT_REC_WAIT || 15000)); await shot(recWin, 'recordings'); }
    if (process.env.SOLUX_SHOT_REC_JS) { await recWin.webContents.executeJavaScript(process.env.SOLUX_SHOT_REC_JS).catch((e) => log('rec js ' + e.message)); await wait(8000); await shot(recWin, 'recordings2'); }
  }
  app.quit();
}

/* ---------------- Start ---------------- */
app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  setDataFetch((...a) => net.fetch(...a));
  updater.setFetch((...a) => net.fetch(...a));
  config = new Config(userData);
  store = new DataStore(path.join(userData, 'cache'), log);
  diary = new Diary(path.join(userData, 'diary'));
  if (isMac && app.dock) app.dock.hide();
  buildAppMenu();
  registerIpc();
  createTray();
  createWidget();

  const cfg = config.get();
  const login = isMac ? app.getLoginItemSettings().wasOpenedAtLogin : false;
  const afterUpdate = process.argv.includes('--after-update');
  if (!app.isPackaged) { /* Entwicklung */ } else app.setLoginItemSettings({ openAtLogin: !!cfg.general.openAtLogin });
  const showWidget = () => { if (cfg.widget.visible !== false || afterUpdate) widgetWin.show(); buildTrayMenu(); };
  if ((cfg.widget.showSplash && !login) || afterUpdate) showSplash(showWidget); else widgetWin.once('ready-to-show', showWidget);

  refresh();
  scheduleRefresh();
  setInterval(checkGoodWindow, 30 * 60000);
  setTimeout(autoUpdateCheck, 20000);
  if (!app.isPackaged && process.env.SOLUX_SHOT) devScreenshots(process.env.SOLUX_SHOT);
  setInterval(autoUpdateCheck, 12 * 3600000);
});

app.on('window-all-closed', (e) => { /* Solux läuft im Hintergrund weiter (Menüleiste) */ });
app.on('activate', () => { if (widgetWin) widgetWin.show(); });
