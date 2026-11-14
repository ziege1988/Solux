/*
 * Solux – Updates über GitHub Releases
 *
 * Ablauf: neuestes Release abfragen -> passendes ZIP (arm64/x64) laden -> entpacken (ditto)
 * -> Hilfsskript startet, wartet bis Solux beendet ist, ersetzt die App und öffnet sie neu
 * (mit --after-update, damit das Startbild erscheint).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

let httpFetch = (...a) => globalThis.fetch(...a);
function setFetch(f) { httpFetch = f; }

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return Math.sign(d); }
  return 0;
}

async function checkForUpdate(repo, currentVersion, arch = process.arch) {
  const res = await httpFetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Solux-Updater' },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) return { available: false, message: 'Noch kein Release veröffentlicht.' };
  if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}`);
  const rel = await res.json();
  const latest = rel.tag_name.replace(/^v/, '');
  if (cmpVersion(latest, currentVersion) <= 0) return { available: false, latest, message: `Solux ${currentVersion} ist aktuell.` };
  const asset = rel.assets.find((a) => a.name.endsWith(`-mac-${arch}.zip`)) || rel.assets.find((a) => /-mac(-universal)?\.zip$/.test(a.name));
  if (!asset) return { available: false, latest, message: `Version ${latest} gefunden, aber kein Paket für ${arch}.` };
  return { available: true, latest, notes: rel.body || '', url: asset.browser_download_url, size: asset.size, name: asset.name };
}

/** Bundle-Pfad der laufenden App (…/Solux.app). */
function appBundlePath(execPath = process.execPath) {
  const i = execPath.indexOf('.app/');
  return i > 0 ? execPath.slice(0, i + 4) : null;
}

async function downloadAndInstall(info, onProgress = () => {}) {
  if (process.platform !== 'darwin') throw new Error('Automatische Installation nur unter macOS.');
  const bundle = appBundlePath();
  if (!bundle) throw new Error('Solux läuft nicht als App-Paket (Entwicklungsmodus).');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solux-update-'));
  const zip = path.join(dir, info.name);
  const res = await httpFetch(info.url, { headers: { 'User-Agent': 'Solux-Updater' } });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const total = Number(res.headers.get('content-length')) || info.size || 0;
  const out = fs.createWriteStream(zip);
  let done = 0;
  for await (const chunk of res.body) { out.write(chunk); done += chunk.length; if (total) onProgress(done / total); }
  await new Promise((r) => out.end(r));
  const unpack = path.join(dir, 'neu');
  fs.mkdirSync(unpack);
  execFileSync('/usr/bin/ditto', ['-x', '-k', zip, unpack]);
  const app = fs.readdirSync(unpack).find((f) => f.endsWith('.app'));
  if (!app) throw new Error('Im Update-Paket wurde keine App gefunden.');
  const newApp = path.join(unpack, app);
  const script = path.join(dir, 'install.sh');
  fs.writeFileSync(script, `#!/bin/bash
PID=${process.pid}
APP=${JSON.stringify(bundle)}
NEW=${JSON.stringify(newApp)}
for i in $(seq 1 100); do kill -0 $PID 2>/dev/null || break; sleep 0.2; done
rm -rf "$APP.alt"
if mv "$APP" "$APP.alt" && /usr/bin/ditto "$NEW" "$APP"; then
  rm -rf "$APP.alt"
else
  rm -rf "$APP"; mv "$APP.alt" "$APP"
fi
/usr/bin/xattr -cr "$APP" 2>/dev/null
/usr/bin/open "$APP" --args --after-update
rm -rf ${JSON.stringify(dir)}
`, { mode: 0o755 });
  const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' });
  child.unref();
  return true;
}

module.exports = { setFetch, cmpVersion, checkForUpdate, downloadAndInstall, appBundlePath };
