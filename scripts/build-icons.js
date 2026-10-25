// Renders the donut logo (src/assets/brand/logo.svg) to the PNG icons needed by the PWA
// manifest and by electron-builder. Requires Playwright: `npx playwright install chromium`.

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'src/assets/brand/logo.svg'), 'utf8');

const targets = [
  ['src/assets/brand/icon-192.png', 192, 0, 'transparent'],
  ['src/assets/brand/icon-512.png', 512, 0, 'transparent'],
  ['src/assets/brand/icon-maskable-512.png', 512, 0.2, '#2a1830'], // maskable: safe-zone padding
  ['build/icon.png', 1024, 0.04, 'transparent'],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [out, size, pad, bg] of targets) {
    await page.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * (1 - pad * 2));
    await page.setContent(`<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`);
    fs.mkdirSync(path.dirname(path.join(root, out)), { recursive: true });
    await page.screenshot({ path: path.join(root, out), omitBackground: bg === 'transparent' });
    console.log(`icon: ${out}`);
  }
  await browser.close();
})();
