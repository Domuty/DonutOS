// Generates DonutOS's original app and file-type icons as SVG.
// Apps: a rounded gradient tile with a white line glyph. Files: a sheet with a coloured badge.
// Output: src/assets/icons/apps/*.svg, src/assets/icons/files/*.svg

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.join(__dirname, '..', 'src', 'assets', 'icons');

// Glyphs are drawn on a 24×24 grid (stroke 1.8, round caps), like the system icons.
const G = {
  explorer: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 10.5h18"/>',
  browser: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.6 2.3 3.8 5.2 3.8 8.5S14.6 18.2 12 20.5C9.4 18.2 8.2 15.3 8.2 12S9.4 5.8 12 3.5z"/>',
  store: '<path d="M4.5 8.5h15l-1.2 10.5a1.5 1.5 0 0 1-1.5 1.3H7.2a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M8.5 8.5V7a3.5 3.5 0 0 1 7 0v1.5"/><circle cx="12" cy="14" r="2.2"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7 9.5l3 2.5-3 2.5"/><path d="M12.5 15H17"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.5"/>',
  notepad: '<path d="M6.5 3.5h8l4 4v13h-12z"/><path d="M14.5 3.5v4h4"/><path d="M9 11.5h6.5M9 14.5h6.5M9 17.5h4"/>',
  writer: '<path d="M6.5 3.5h8l4 4v13h-12z"/><path d="M14.5 3.5v4h4"/><path d="M9 12l1.6 5.5L12 13l1.4 4.5L15 12"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><rect x="8" y="6" width="8" height="3.5" rx=".8"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" stroke-width="2.6"/>',
  paint: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.7-.7 1.7-1.6 0-1.1-.9-1.5-.9-2.4 0-.8.7-1.5 1.6-1.5h2.1a4 4 0 0 0 4-4c0-4.2-3.8-7.5-8.5-7.5z"/><circle cx="7.6" cy="11" r="1.1" fill="#fff"/><circle cx="10" cy="7.3" r="1.1" fill="#fff"/><circle cx="14.3" cy="7.3" r="1.1" fill="#fff"/>',
  photos: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 15.5l-5-5-8.5 9"/>',
  mediaplayer: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.5v7l5.5-3.5z" fill="#fff"/>',
  camera: '<path d="M4 7.5h3.5L9 5h6l1.5 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/>',
  recorder: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 16.5h.01M12 16.5h.01" stroke-width="2.4"/>',
  stickynotes: '<path d="M4.5 4.5h15v10l-5 5h-10z"/><path d="M14.5 19.5v-5h5"/><path d="M8 9h8M8 12h5"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6.5L20.5 7"/>',
  solitaire: '<rect x="4" y="5" width="10" height="14" rx="1.8" transform="rotate(-10 9 12)"/><rect x="10" y="5" width="10" height="14" rx="1.8"/><path d="M15 9.5c-1.3 1.2-2.2 2-2.2 3a1.2 1.2 0 0 0 2.2.7 1.2 1.2 0 0 0 2.2-.7c0-1-.9-1.8-2.2-3z" fill="#fff"/>',
  minesweeper: '<circle cx="12" cy="13" r="5.5"/><path d="M12 4v3M12 19v2M4.5 13h2M17.5 13h2M6.7 7.7l1.4 1.4M15.9 16.9l1.4 1.4M6.7 18.3l1.4-1.4M15.9 9.1l1.4-1.4"/><circle cx="10.2" cy="11.2" r="1" fill="#fff"/>',
  taskmanager: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M6 14.5h2.5l1.5-4 2.5 6 2-4h3.5"/>',
  snipping: '<circle cx="6.5" cy="17" r="2.5"/><circle cx="17.5" cy="17" r="2.5"/><path d="M8.3 15.3L17 4.5M15.7 15.3L7 4.5"/>',
  recyclebin: '<path d="M5 7h14"/><path d="M9.5 7V5h5v2"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  console: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 8.5h18"/><path d="M7 12.5l2.5 2-2.5 2M12 16.5h4"/>',
  run: '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>',
  default: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M9 12h6M12 9v6"/>',
};

const PLATES = {
  explorer: ['#ffcc4d', '#f39b1c'], browser: ['#4fb4ff', '#1f6fe0'], store: ['#5c7cfa', '#7b4ff2'],
  terminal: ['#3d3a46', '#1c1a22'], settings: ['#8a8f9c', '#4e5360'], notepad: ['#5ec3f2', '#2d8ad1'],
  writer: ['#4b8df5', '#2253c9'], calculator: ['#6b6f7d', '#3c3f49'], paint: ['#ff7aa8', '#e8466f'],
  photos: ['#4ad0c2', '#1f93a8'], mediaplayer: ['#ff8d4d', '#e2531f'], camera: ['#59616f', '#2e333d'],
  recorder: ['#ff5a6e', '#c92a4a'], clock: ['#5b8cff', '#3254d6'], calendar: ['#3fbf88', '#1d8a5f'],
  stickynotes: ['#ffd84d', '#f0a400'], mail: ['#3aa0ff', '#1a5fd6'], solitaire: ['#3fbf6e', '#167a44'],
  minesweeper: ['#8a95a8', '#545e70'], taskmanager: ['#40c9a2', '#178a74'], snipping: ['#e8618c', '#b23a78'],
  recyclebin: ['#9aa3b5', '#5f6880'], console: ['#e8618c', '#5a2a6d'], run: ['#7c8494', '#4a505d'], default: ['#9c8cff', '#6a54d8'],
};

function appIcon(id) {
  const [a, b] = PLATES[id] || PLATES.default;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  <rect x="3" y="3" width="42" height="42" rx="11" fill="url(#g)"/>
  <rect x="3" y="3" width="42" height="42" rx="11" fill="url(#s)"/>
  <rect x="3.5" y="3.5" width="41" height="41" rx="10.5" fill="none" stroke="#000" stroke-opacity=".12"/>
  <g transform="translate(9 9) scale(1.25)" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${G[id] || G.default}</g>
</svg>
`;
}

// Recycle bin, full: papers peeking out.
const binFull = appIcon('recyclebin').replace('<path d="M9.5 7V5h5v2"/>', '').replace('</g>', '</g><g transform="translate(9 9) scale(1.25)" fill="#fff" stroke="none"><rect x="7.2" y="1.2" width="5" height="6" rx=".6" transform="rotate(-14 9.7 4.2)"/><rect x="11.8" y="1.6" width="5" height="5.6" rx=".6" opacity=".8" transform="rotate(12 14.3 4.4)"/></g>');

const FILES = {
  generic: { color: '#8a8f9c', glyph: '' },
  text: { color: '#5ec3f2', glyph: '<path d="M16 26h16M16 31h16M16 36h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' },
  document: { color: '#4b8df5', glyph: '<path d="M16 26h16M16 31h16M16 36h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' },
  code: { color: '#9466e8', glyph: '<path d="M20 26l-5 5 5 5M28 26l5 5-5 5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
  image: { color: '#4ad0c2', glyph: '<circle cx="19" cy="27" r="2.5" fill="#fff"/><path d="M14 38l7-7 4 4 3-3 6 6z" fill="#fff"/>' },
  audio: { color: '#ff8d4d', glyph: '<path d="M27 25v10.5a3 3 0 1 1-2-2.8V25l7-1.5v9a3 3 0 1 1-2-2.8v-6.7z" fill="#fff"/>' },
  video: { color: '#e2531f', glyph: '<path d="M21 26v11l9-5.5z" fill="#fff"/>' },
  archive: { color: '#e6b422', glyph: '<path d="M24 22v3M24 27v3M24 32v3" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><rect x="21.5" y="35" width="5" height="4" rx="1" fill="#fff"/>' },
  pdf: { color: '#e5484d', glyph: '<path d="M16 34c4-1 9-6 10-11s-2-4-2 0 6 10 9 10-4-2-17 1z" stroke="#fff" stroke-width="1.8" fill="none" stroke-linejoin="round"/>' },
  app: { color: '#7b4ff2', glyph: '<rect x="18" y="25" width="5" height="5" rx="1" fill="#fff"/><rect x="25" y="25" width="5" height="5" rx="1" fill="#fff"/><rect x="18" y="32" width="5" height="5" rx="1" fill="#fff"/><rect x="25" y="32" width="5" height="5" rx="1" fill="#fff"/>' },
};

function fileIcon({ color, glyph }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <path d="M11 4h18l10 10v28a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fbfbfd" stroke="#c9ccd6"/>
  <path d="M29 4v8a2 2 0 0 0 2 2h8" fill="#e9eaf0" stroke="#c9ccd6" stroke-linejoin="round"/>
  ${glyph ? `<rect x="12" y="20" width="24" height="20" rx="3" fill="${color}"/>${glyph}` : `<path d="M15 24h18M15 29h18M15 34h12" stroke="#c9ccd6" stroke-width="2" stroke-linecap="round"/>`}
</svg>
`;
}

const folder = (open = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd76a"/><stop offset="1" stop-color="#f5b52a"/></linearGradient></defs>
  <path d="M4 12a3 3 0 0 1 3-3h11l4 4h19a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#e9a21a"/>
  ${open ? '<path d="M9 18h33a2 2 0 0 1 2 2.4l-2.8 16A3 3 0 0 1 38.2 39H7a3 3 0 0 1-3-3l2.2-15.6A3 3 0 0 1 9 18z" fill="url(#f)"/>' : '<rect x="4" y="16" width="40" height="25" rx="3" fill="url(#f)"/>'}
</svg>
`;

fs.mkdirSync(path.join(OUT, 'apps'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'files'), { recursive: true });
for (const id of Object.keys(G)) fs.writeFileSync(path.join(OUT, 'apps', `${id}.svg`), appIcon(id));
fs.writeFileSync(path.join(OUT, 'apps', 'recyclebin-full.svg'), binFull);
for (const [k, v] of Object.entries(FILES)) fs.writeFileSync(path.join(OUT, 'files', `${k}.svg`), fileIcon(v));
fs.writeFileSync(path.join(OUT, 'files', 'folder.svg'), folder(false));
fs.writeFileSync(path.join(OUT, 'files', 'folder-open.svg'), folder(true));
console.log(`icons: ${Object.keys(G).length + 1} apps, ${Object.keys(FILES).length + 2} file types`);
