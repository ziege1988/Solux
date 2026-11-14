/*
 * Solux Push – prüft die NOAA-Daten und schickt bei brisanten Ereignissen eine Web-Push-Mitteilung
 * an die Handy-Version (läuft als GitHub-Workflow alle 15 Minuten).
 *
 * Umgebung:
 *   VAPID_PRIVATE_KEY   GitHub-Secret (privater Schlüssel)
 *   PUSH_SUBSCRIPTIONS  GitHub-Secret: Code aus Solux mobil → Einstellungen → Mitteilungen (ein Objekt oder Liste)
 *   PUSH_LAT            Breitengrad für die Polarlicht-Schwelle (Standard 50.28)
 *   PUSH_TEST=1         schickt eine Testmitteilung
 *   STATE_FILE          Datei mit bereits gemeldeten Ereignissen
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SW = require('../src/shared/spaceweather');

const STATE_FILE = process.env.STATE_FILE || path.join(process.cwd(), '.push-state.json');
const PUBLIC_KEY = (fs.readFileSync(path.join(__dirname, '..', 'web', 'push-config.js'), 'utf8').match(/publicKey:\s*'([^']+)'/) || [])[1];

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Solux-Push' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { sent: [] }; } }

async function collect() {
  const keys = ['regions', 'flares', 'kp', 'alerts', 'ssn', 'flux'];
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
  const lat = parseFloat(process.env.PUSH_LAT) || 50.28;
  return SW.buildNews(d, { lat, lon: 0 });
}

function messageFor(item) {
  const emoji = item.kind === 'aurora' ? 'Polarlicht' : item.kind === 'flare' ? 'Flare' : 'Warnung';
  return { title: `Solux · ${item.title}`, body: item.detail, tag: `${emoji}-${SW.pushKey(item)}`, url: './' };
}

async function main() {
  const state = loadState();
  const sent = new Set(state.sent || []);
  const news = await collect();
  const now = Date.now();
  const fresh = news.items.filter((i) => SW.pushWorthy(i) && now - i.time < 6 * 3600000 && !sent.has(SW.pushKey(i)));
  const messages = fresh.map(messageFor);
  if (process.env.PUSH_TEST === '1' || process.env.PUSH_TEST === 'true') messages.unshift({ title: 'Solux · Test', body: 'Push-Mitteilungen sind eingerichtet. ☀', tag: 'solux-test', url: './' });
  console.log(`${news.items.length} Meldungen, ${fresh.length} neu und brisant${messages.length ? ':' : '.'}`);
  messages.forEach((m) => console.log(' -', m.title, '|', m.body));

  const subsRaw = process.env.PUSH_SUBSCRIPTIONS, priv = process.env.VAPID_PRIVATE_KEY;
  if (messages.length && subsRaw && priv && PUBLIC_KEY) {
    const webpush = require('web-push');
    webpush.setVapidDetails('https://ziege1988.github.io/Solux/', PUBLIC_KEY, priv.trim());
    let subs = JSON.parse(subsRaw); if (!Array.isArray(subs)) subs = [subs];
    for (const m of messages) for (const sub of subs) {
      try { await webpush.sendNotification(sub, JSON.stringify(m), { TTL: 6 * 3600, urgency: 'high' }); console.log('   gesendet an', new URL(sub.endpoint).host); }
      catch (e) { console.log('   Fehler', e.statusCode || '', e.body || e.message, e.statusCode === 410 ? '→ Abo abgelaufen: in Solux mobil neu aktivieren und Secret ersetzen.' : ''); }
    }
  } else if (messages.length) console.log('Nicht gesendet: VAPID_PRIVATE_KEY oder PUSH_SUBSCRIPTIONS fehlt.');

  for (const i of fresh) sent.add(SW.pushKey(i));
  fs.writeFileSync(STATE_FILE, JSON.stringify({ sent: [...sent].slice(-300), updated: new Date().toISOString() }));
}

main().catch((e) => { console.error(e); process.exit(1); });
