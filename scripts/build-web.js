/*
 * Baut die Handy-Version (Web-App) nach dist-web/.
 * Gemeinsame Dateien kommen direkt aus src/, damit Mac und Handy denselben Code nutzen.
 * Aufruf: node scripts/build-web.js   (danach z. B. npx serve dist-web)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-web');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'shared'), { recursive: true });

const copy = (from, to) => { fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true }); fs.copyFileSync(path.join(root, from), path.join(out, to)); };
for (const f of ['astro.js', 'seeing.js', 'mcintosh.js', 'spaceweather.js']) copy(`src/shared/${f}`, `shared/${f}`);
for (const f of ['base.css', 'widget.css', 'widget.js', 'common.js']) copy(`src/renderer/${f}`, f);
copy('src/renderer/assets/splash-sun.jpg', 'assets/splash-sun.jpg');
for (const f of fs.readdirSync(path.join(root, 'web'), { recursive: true })) {
  const p = path.join(root, 'web', f);
  if (fs.statSync(p).isFile()) copy(path.join('web', f), f);
}
// Cache-Version für den Service Worker (neue Version = neuer Zwischenspeicher)
const sw = path.join(out, 'sw.js');
const build = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 8) : Date.now().toString(36);
fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace('__BUILD__', build));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('Web-App gebaut:', out, '· Version', build);
