/*
 * Solux Push – prüft die NOAA-Daten und schickt Web-Push-Mitteilungen an Solux mobil
 * (läuft als GitHub-Workflow alle 15 Minuten). Regeln wie am Mac (spaceweather.pushMessages):
 *  - Stufe je Gerät: "interessant" | "alle" (steht im Code aus Solux mobil) – "aus" = Gerät abgemeldet
 *  - nur solange die Sonne am Standort über dem Horizont steht
 *  - jede Region/Meldung höchstens einmal am Tag, neue Ereignisse (Flares) einzeln
 *
 * Umgebung: VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTIONS (Secrets), PUSH_LAT/PUSH_LON/PUSH_MODE (Variablen, optional),
 * PUSH_TEST=1 (Testmitteilung), STATE_FILE.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SW = require('../src/shared/spaceweather');
const astro = require('../src/shared/astro');

const STATE_FILE = process.env.STATE_FILE || path.join(process.cwd(), '.push-state.json');
const PUBLIC_KEY = (fs.readFileSync(path.join(__dirname, '..', 'web', 'push-config.js'), 'utf8').match(/publicKey:\s*'([^']+)'/) || [])[1];
const LAT = parseFloat(process.env.PUSH_LAT) || 50.28, LON = parseFloat(process.env.PUSH_LON) || 9.8;

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Solux-Push' }, signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { sent: [] }; } }

async function collect() {
  const keys = ['regions', 'flares', 'kp', 'alerts', 'ssn', 'flux', 'events'];
  const res = await Promise.allSettled(keys.map((k) => getJSON(SW.SWPC_URLS[k])));
  const d = {};
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') { console.log('Abruf fehlgeschlagen:', keys[i], r.reason.message); return; }
    const v = r.value, k = keys[i];
    if (k === 'kp') d.kp = SW.normKp(v);
    else if (k === 'ssn') d.ssn = v.length ? v[v.length - 1].swpc_ssn : null;
    else if (k === 'flux') d.flux = v.length ? v[0].flux : null;
    else d[k] = v;
  });
  return { news: SW.buildNews(d, { lat: LAT, lon: LON }), regions: SW.computeRegions(d.regions || [], new Date()).regions };
}

function devices() {
  let list = []; try { list = JSON.parse(process.env.PUSH_SUBSCRIPTIONS || '[]'); } catch (e) { console.log('PUSH_SUBSCRIPTIONS ist kein gültiger Code:', e.message); }
  if (!Array.isArray(list)) list = [list];
  return list.map((e) => (e && e.subscription ? { mode: e.mode || 'interessant', sub: e.subscription } : { mode: process.env.PUSH_MODE || 'interessant', sub: e }))
    .filter((d) => d.sub && d.sub.endpoint)
    .map((d) => ({ ...d, mode: process.env.PUSH_MODE === 'aus' ? 'aus' : d.mode, id: crypto.createHash('sha1').update(d.sub.endpoint).digest('hex').slice(0, 8) }));
}

async function main() {
  const state = loadState(), sent = new Set(state.sent || []);
  const test = process.env.PUSH_TEST === '1' || process.env.PUSH_TEST === 'true';
  const alt = astro.sunAltAz(new Date(), LAT, LON).alt;
  const devs = devices();
  console.log(`Sonnenhöhe ${alt.toFixed(1)}° · ${devs.length} Gerät(e)`);
  const { news, regions } = await collect();

  const priv = process.env.VAPID_PRIVATE_KEY;
  let webpush = null;
  if (priv && PUBLIC_KEY && devs.length) { webpush = require('web-push'); webpush.setVapidDetails('https://ziege1988.github.io/Solux/', PUBLIC_KEY, priv.trim()); }

  for (const dev of devs) {
    let msgs = alt > 0 ? SW.pushMessages(news, regions, dev.mode).filter((m) => !sent.has(`${dev.id}|${m.key}`)) : [];
    if (test) msgs = [{ key: `test|${Date.now()}`, title: 'Solux · Test', body: `Push ist eingerichtet (Stufe: ${dev.mode === 'alle' ? 'alle neuen Meldungen' : dev.mode === 'aus' ? 'aus' : 'nur interessante'}). ☀`, test: true }, ...msgs];
    console.log(`Gerät ${dev.id} (${dev.mode}): ${msgs.length} Mitteilung(en)${alt <= 0 && !test ? ' – Sonne unter dem Horizont, nichts gesendet' : ''}`);
    for (const m of msgs.slice(0, 4)) {
      console.log('  -', m.title, '|', m.body);
      if (!webpush) { console.log('    nicht gesendet: VAPID_PRIVATE_KEY fehlt'); continue; }
      try { await webpush.sendNotification(dev.sub, JSON.stringify({ title: m.title, body: m.body, tag: m.key, url: './' }), { TTL: 4 * 3600, urgency: 'high' }); console.log('    gesendet an', new URL(dev.sub.endpoint).host); }
      catch (e) { console.log('    Fehler', e.statusCode || '', e.body || e.message, e.statusCode === 410 ? '→ Abo abgelaufen: in Solux mobil neu aktivieren und Secret ersetzen.' : ''); }
    }
    for (const m of msgs) if (!m.test) sent.add(`${dev.id}|${m.key}`); // auch über 4 hinaus als gemeldet merken (keine Flut)
  }
  if (!devs.length) console.log('Kein Gerät eingetragen (Secret PUSH_SUBSCRIPTIONS).');
  fs.writeFileSync(STATE_FILE, JSON.stringify({ sent: [...sent].slice(-600), updated: new Date().toISOString() }));
}

main().catch((e) => { console.error(e); process.exit(1); });
