/*
 * Erzeugt build/icon.png (1024 px, App-Icon) und build/trayTemplate(@2x).png (Menüleiste).
 * Aufruf: npm run icons  (benötigt Playwright/Chromium – nur zum Neuerzeugen nötig)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <radialGradient id="disc" cx="44%" cy="40%" r="62%"><stop offset="0" stop-color="#fff0c4"/><stop offset=".45" stop-color="#f8c45a"/><stop offset=".85" stop-color="#e58a24"/><stop offset="1" stop-color="#b9561a"/></radialGradient>
  <radialGradient id="glow" r=".5"><stop offset=".6" stop-color="#f3b544" stop-opacity=".55"/><stop offset="1" stop-color="#f3b544" stop-opacity="0"/></radialGradient>
  <filter id="gran"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .18 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
  <clipPath id="c"><circle cx="512" cy="512" r="330"/></clipPath>
</defs>
<rect x="100" y="100" width="824" height="824" rx="185" fill="#000"/>
<rect x="101.5" y="101.5" width="821" height="821" rx="183.5" fill="none" stroke="#2a2a2a" stroke-width="3"/>
<circle cx="512" cy="512" r="420" fill="url(#glow)"/>
<circle cx="512" cy="512" r="330" fill="url(#disc)"/>
<g clip-path="url(#c)"><rect x="150" y="150" width="724" height="724" filter="url(#gran)"/>
  <ellipse cx="392" cy="620" rx="15" ry="12" fill="#3a1d08" opacity=".85"/><ellipse cx="420" cy="628" rx="8" ry="7" fill="#3a1d08" opacity=".8"/>
  <ellipse cx="655" cy="405" rx="11" ry="9" fill="#3a1d08" opacity=".8"/></g>
<text x="512" y="560" text-anchor="middle" font-family="-apple-system, 'Helvetica Neue', Arial Black, Arial, sans-serif" font-weight="800" font-size="138" letter-spacing="4" fill="#1a0d02">Solux</text>
</svg>`;

const TRAY_SVG = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 22 22">
<circle cx="11" cy="11" r="4.6" fill="#000"/>
<g stroke="#000" stroke-width="1.6" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4, c = Math.cos(a), n = Math.sin(a); return `<line x1="${(11 + c * 7).toFixed(2)}" y1="${(11 + n * 7).toFixed(2)}" x2="${(11 + c * 9.2).toFixed(2)}" y2="${(11 + n * 9.2).toFixed(2)}"/>`; }).join('')}</g></svg>`;

(async () => {
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage();
  const render = async (svg, w, file) => {
    await p.setViewportSize({ width: w, height: w });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${w}" height="${w}"`)}</body></html>`);
    await p.screenshot({ path: path.join(out, file), omitBackground: true, clip: { x: 0, y: 0, width: w, height: w } });
  };
  await render(ICON_SVG, 1024, 'icon.png');
  await render(TRAY_SVG(22), 22, 'trayTemplate.png');
  await render(TRAY_SVG(44), 44, 'trayTemplate@2x.png');
  await b.close();
  console.log('Icons erzeugt in', out);
})();
