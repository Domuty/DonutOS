// Renders DonutOS's original wallpapers (SVG compositions defined below) to JPEG at
// 2560×1440 plus 384×216 thumbnails. Requires Playwright. Output: src/assets/wallpapers.

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const W = 2560, H = 1440;
const OUT = path.join(__dirname, '..', 'src', 'assets', 'wallpapers');

// Deterministic pseudo-random numbers so builds are reproducible.
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

const blur = (id, sd) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
const grain = `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.05 0"/></filter>`;
const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}${grain}</defs>${body}<rect width="100%" height="100%" filter="url(#grain)"/></svg>`;

/** A soft ribbon: a thick stroked curve with a gradient. */
function ribbon(id, d, width, stops, opacity = 1, blurId = '') {
  const g = `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  return { def: g, el: `<path d="${d}" fill="none" stroke="url(#${id})" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}" ${blurId ? `filter="url(#${blurId})"` : ''}/>` };
}

const wallpapers = {
  // Pink glaze ribbons over deep plum (the default).
  glaze() {
    const r = [
      ribbon('g1', 'M-200 1200 C 500 700, 900 1500, 1500 900 S 2400 300, 2900 600', 420, [[0, '#ff7eb0'], [0.5, '#e8618c'], [1, '#ff9f6b']], 0.85, 'b2'),
      ribbon('g2', 'M-300 900 C 400 400, 1100 1100, 1700 600 S 2500 100, 2900 200', 220, [[0, '#ffc2d9'], [1, '#f06f9c']], 0.7, 'b1'),
      ribbon('g3', 'M200 1600 C 800 1100, 1300 1500, 1900 1100 S 2600 900, 2900 1000', 260, [[0, '#9b4dff'], [1, '#e8618c']], 0.55, 'b2'),
      ribbon('g4', 'M-100 700 C 600 300, 1000 800, 1600 450 S 2300 0, 2800 -100', 60, [[0, '#ffffff'], [1, '#ffd0e2']], 0.35, 'b1'),
    ];
    return svg(`<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c0d25"/><stop offset="1" stop-color="#3a1233"/></linearGradient>${blur('b1', 10)}${blur('b2', 34)}${blur('b3', 160)}${r.map((x) => x.def).join('')}`,
      `<rect width="100%" height="100%" fill="url(#bg)"/>
       <circle cx="2000" cy="350" r="520" fill="#7a2c6b" filter="url(#b3)" opacity=".8"/>
       <circle cx="500" cy="1250" r="560" fill="#5d1f5a" filter="url(#b3)" opacity=".8"/>
       ${r.map((x) => x.el).join('')}`);
  },

  // Night sky of soft bokeh and tiny sprinkles.
  sprinkles() {
    const rand = rng(11);
    const cols = ['#ff8fb8', '#ffd84d', '#6fd6ff', '#7ee08a', '#b58cff', '#ff9e5e'];
    let bokeh = '', spr = '';
    for (let i = 0; i < 26; i++) bokeh += `<circle cx="${rand() * W}" cy="${rand() * H}" r="${60 + rand() * 180}" fill="${cols[i % 6]}" opacity="${0.08 + rand() * 0.14}" filter="url(#b2)"/>`;
    for (let i = 0; i < 140; i++) {
      const x = rand() * W, y = rand() * H, a = rand() * 180, s = 0.6 + rand() * 1.2;
      spr += `<rect x="${x}" y="${y}" width="${26 * s}" height="${8 * s}" rx="${4 * s}" fill="${cols[i % 6]}" opacity="${0.35 + rand() * 0.5}" transform="rotate(${a} ${x} ${y})"/>`;
    }
    return svg(`<radialGradient id="bg" cx="0.5" cy="0.35" r="0.9"><stop offset="0" stop-color="#2a2150"/><stop offset="1" stop-color="#0c0a1c"/></radialGradient>${blur('b2', 40)}`,
      `<rect width="100%" height="100%" fill="url(#bg)"/>${bokeh}${spr}`);
  },

  // Warm sunrise over layered hills.
  dawn() {
    const layers = [
      ['#f7b267', 'M0 900 C 400 780, 800 860, 1200 820 S 2100 700, 2560 780 V1440 H0Z'],
      ['#f4845f', 'M0 1020 C 500 900, 900 1060, 1400 960 S 2200 880, 2560 940 V1440 H0Z'],
      ['#d65a6a', 'M0 1140 C 600 1040, 1100 1180, 1600 1080 S 2300 1020, 2560 1080 V1440 H0Z'],
      ['#8f3b6e', 'M0 1260 C 500 1180, 1000 1300, 1500 1220 S 2200 1180, 2560 1220 V1440 H0Z'],
      ['#4a2152', 'M0 1360 C 600 1300, 1100 1400, 1700 1330 S 2300 1310, 2560 1340 V1440 H0Z'],
    ];
    return svg(`<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b1f4e"/><stop offset=".45" stop-color="#c45a73"/><stop offset=".75" stop-color="#ffb37a"/></linearGradient>${blur('sun', 60)}`,
      `<rect width="100%" height="100%" fill="url(#sky)"/>
       <circle cx="1720" cy="820" r="260" fill="#ffe3a8" filter="url(#sun)" opacity=".9"/>
       <circle cx="1720" cy="820" r="150" fill="#fff1cf"/>
       ${layers.map(([c, d]) => `<path d="${d}" fill="${c}"/>`).join('')}`);
  },

  // Light mint waves (pairs well with the light theme).
  mint() {
    const r = [
      ribbon('m1', 'M-200 1000 C 500 600, 1000 1300, 1700 800 S 2500 500, 2900 700', 500, [[0, '#bff3e2'], [1, '#7fd8c4']], 0.9, 'b2'),
      ribbon('m2', 'M-200 600 C 600 200, 1200 900, 1900 400 S 2600 200, 2900 300', 300, [[0, '#d8f7ff'], [1, '#9fe3f0']], 0.85, 'b2'),
      ribbon('m3', 'M0 1500 C 700 1100, 1300 1500, 2000 1150 S 2700 1000, 2900 1100', 260, [[0, '#a6e9d3'], [1, '#e9fbf5']], 0.8, 'b1'),
    ];
    return svg(`<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3fbf8"/><stop offset="1" stop-color="#d9f2ec"/></linearGradient>${blur('b1', 12)}${blur('b2', 40)}${r.map((x) => x.def).join('')}`,
      `<rect width="100%" height="100%" fill="url(#bg)"/>${r.map((x) => x.el).join('')}`);
  },

  // Deep ocean bands.
  ocean() {
    const r = [];
    for (let i = 0; i < 6; i++) {
      const y = 300 + i * 200;
      r.push(ribbon(`o${i}`, `M-300 ${y + 200} C 500 ${y - 200}, 1100 ${y + 350}, 1700 ${y} S 2500 ${y - 250}, 2900 ${y - 50}`, 190 - i * 12,
        [[0, ['#0b3c6f', '#1360a8', '#1c84c6', '#33a7d8', '#5cc8e6', '#9ee6f2'][i]], [1, ['#082a52', '#0f4c8a', '#176fb2', '#2994cc', '#48b8de', '#7fd8ee'][i]]], 0.85, 'b1'));
    }
    return svg(`<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04162c"/><stop offset="1" stop-color="#0a2c50"/></linearGradient>${blur('b1', 14)}${r.map((x) => x.def).join('')}`,
      `<rect width="100%" height="100%" fill="url(#bg)"/>${r.map((x) => x.el).join('')}`);
  },

  // Aurora curtains over a dark horizon.
  aurora() {
    const r = [
      ribbon('a1', 'M-200 700 C 400 200, 900 900, 1500 400 S 2400 100, 2900 300', 380, [[0, '#2ee6a6'], [1, '#6a5cff']], 0.6, 'b2'),
      ribbon('a2', 'M-200 900 C 500 500, 1000 1000, 1600 650 S 2400 400, 2900 600', 200, [[0, '#7cffcb'], [1, '#2ec5e6']], 0.55, 'b2'),
      ribbon('a3', 'M300 500 C 900 100, 1400 700, 2000 300 S 2700 100, 2900 0', 160, [[0, '#c38bff'], [1, '#ff7ec7']], 0.45, 'b2'),
    ];
    let stars = '';
    const rand = rng(5);
    for (let i = 0; i < 220; i++) stars += `<circle cx="${rand() * W}" cy="${rand() * H * 0.8}" r="${0.8 + rand() * 1.8}" fill="#fff" opacity="${0.2 + rand() * 0.7}"/>`;
    return svg(`<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050816"/><stop offset="1" stop-color="#0e1a2b"/></linearGradient>${blur('b2', 48)}${r.map((x) => x.def).join('')}`,
      `<rect width="100%" height="100%" fill="url(#bg)"/>${stars}${r.map((x) => x.el).join('')}
       <path d="M0 1260 C 400 1200, 700 1250, 1100 1190 S 1900 1150, 2560 1220 V1440 H0Z" fill="#03060d"/>`);
  },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [name, make] of Object.entries(wallpapers)) {
    await page.setContent(`<html><body style="margin:0">${make()}</body></html>`);
    await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 88 });
    const thumb = await browser.newPage({ viewport: { width: 384, height: 216 } });
    await thumb.setContent(`<html><body style="margin:0;background:url('data:image/jpeg;base64,${fs.readFileSync(path.join(OUT, `${name}.jpg`)).toString('base64')}') center/cover"></body></html>`);
    await thumb.screenshot({ path: path.join(OUT, `${name}-thumb.jpg`), type: 'jpeg', quality: 85 });
    await thumb.close();
    console.log(`wallpaper: ${name}`);
  }
  await browser.close();
})();
