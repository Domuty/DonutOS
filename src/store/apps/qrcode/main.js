// QR Code — a complete QR encoder (byte mode, versions 1–40, levels L/M/Q/H) and a maker UI.
import { h, mount, css, ui } from '@donut/sdk';

// ── Encoder (follows ISO/IEC 18004) ────────────────────────────────────
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
const LEVELS = { L: [0, 1], M: [1, 0], Q: [2, 3], H: [3, 2] }; // [table row, format bits]

const rawModules = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
const dataCodewords = (v, e) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[e][v] * NUM_BLOCKS[e][v];
const gmul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; };
function rsDivisor(deg) { const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1; for (let i = 0; i < deg; i++) { for (let j = 0; j < r.length; j++) { r[j] = gmul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = gmul(root, 2); } return r; }
function rsRemainder(data, div) { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); } return r; }
function alignPositions(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, size = v * 4 + 17;
  const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
  return r;
}

export function encodeQR(text, level = 'M') {
  const bytes = [...new TextEncoder().encode(text)];
  const [e, formatBits] = LEVELS[level];
  let ver = 1;
  for (; ver <= 40; ver++) if (4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 <= dataCodewords(ver, e) * 8) break;
  if (ver > 40) throw new Error('That’s too much to fit in a QR code. Shorten the text or lower the error correction.');
  // Data bits
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16); bytes.forEach((b) => put(b, 8));
  const cap = dataCodewords(ver, e) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  // Error correction and interleaving
  const nb = NUM_BLOCKS[e][ver], eccLen = ECC_PER_BLOCK[e][ver], raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const all = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) all.push(b[i]); });
  // Modules
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < size && y < size) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); } } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = alignPositions(ver);
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (mask) => {
    const d = (formatBits << 3) | mask;
    let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    const bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const dark = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, dark); set(c, a, dark); }
  }
  // Codewords in the zig-zag order
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && i < all.length * 8) { m[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  // Pick the mask with the lowest penalty
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
  const apply = (k) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x]; };
  let best = 0, bestScore = Infinity;
  for (let k = 0; k < 8; k++) { apply(k); drawFormat(k); const s = penalty(m); if (s < bestScore) { bestScore = s; best = k; } apply(k); }
  apply(best); drawFormat(best);
  return { size, modules: m, version: ver };
}

function penalty(m) {
  const n = m.length;
  let p = 0, dark = 0;
  const line = (get) => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) run++;
        else { if (run >= 5) p += 3 + run - 5; run = 1; }
      }
      // Finder-like 1:1:3:1:1 patterns with light space on one side
      for (let b = 0; b + 10 < n; b++) {
        const s = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0].every((v, k) => get(a, b + k) === !!v);
        const r = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1].every((v, k) => get(a, b + k) === !!v);
        if (s) p += 40; if (r) p += 40;
      }
    }
  };
  line((y, x) => m[y][x]); line((x, y) => m[y][x]);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
  for (const row of m) for (const c of row) if (c) dark++;
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

// ── App ─────────────────────────────────────────────────────────────────
css(`
.qr { height: 100%; display: grid; grid-template-columns: 1fr 340px; }
.qr-form { padding: 18px 20px; overflow: auto; display: grid; gap: 12px; align-content: start; }
.qr-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.qr-tabs button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
.qr-out { border-left: 1px solid var(--border); padding: 18px; display: grid; gap: 12px; align-content: start; justify-items: center; background: var(--surface-2); }
canvas { width: 260px; height: 260px; image-rendering: pixelated; border-radius: 8px; box-shadow: var(--shadow-s); }
.qr-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 680px) { .qr { grid-template-columns: 1fr; } .qr-out { border-left: 0; border-top: 1px solid var(--border); } }
`);

export default function main(app) {
  let kind = app.storage.get('kind', 'url');
  let level = app.storage.get('level', 'M');
  let fg = app.storage.get('fg', '#000000'), bg = app.storage.get('bg', '#ffffff');
  const fields = app.storage.get('fields', { url: 'https://', text: '', ssid: '', pass: '', sec: 'WPA', hidden: false, name: '', phone: '', email: '', org: '' });
  let qr = null;

  const canvas = h('canvas', { width: 1, height: 1, 'aria-label': 'QR code' });
  const info = h('small.muted');
  const form = h('div.qr-form');
  mount(app.root, h('div.qr', form, h('div.qr-out', canvas, info,
    h('div.row', h('button.btn.primary', { type: 'button', onclick: () => save('png') }, 'Save PNG'), h('button.btn', { type: 'button', onclick: () => save('svg') }, 'Save SVG')),
    h('button.btn.subtle', { type: 'button', onclick: () => app.clipboard.writeText(payload()).then(() => ui.alert('Copied', 'The text inside the code is on the clipboard.')) }, 'Copy the encoded text'))));

  const esc = (s) => s.replace(/([\;,:"])/g, '\\$1');
  function payload() {
    if (kind === 'url') return fields.url.trim();
    if (kind === 'text') return fields.text;
    if (kind === 'wifi') return `WIFI:T:${fields.sec === 'none' ? 'nopass' : fields.sec};S:${esc(fields.ssid)};${fields.sec === 'none' ? '' : `P:${esc(fields.pass)};`}${fields.hidden ? 'H:true;' : ''};`;
    return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${fields.name}`, fields.org && `ORG:${fields.org}`, fields.phone && `TEL:${fields.phone}`, fields.email && `EMAIL:${fields.email}`, 'END:VCARD'].filter(Boolean).join('\n');
  }

  function renderForm() {
    const input = (key, label, opts = {}) => h('label.field', h('label', label), h(opts.area ? 'textarea.input' : 'input.input', { value: fields[key], type: opts.type || 'text', rows: 5, oninput: (e) => { fields[key] = e.target.value; changed(); } }, opts.area ? fields[key] : null));
    mount(form, h('h1', 'QR Code'),
      h('div.qr-tabs', [['url', 'Link'], ['text', 'Text'], ['wifi', 'Wi-Fi'], ['contact', 'Contact']].map(([k, l]) => h('button.btn', { type: 'button', 'aria-pressed': String(kind === k), onclick: () => { kind = k; app.storage.set('kind', k); renderForm(); changed(); } }, l))),
      kind === 'url' ? input('url', 'Web address') : null,
      kind === 'text' ? input('text', 'Text', { area: true }) : null,
      kind === 'wifi' ? [input('ssid', 'Network name (SSID)'), h('label.field', h('label', 'Security'), h('select.input', { onchange: (e) => { fields.sec = e.target.value; renderForm(); changed(); } },
        [['WPA', 'WPA/WPA2/WPA3'], ['WEP', 'WEP'], ['none', 'None (open)']].map(([v, l]) => h('option', { value: v, selected: fields.sec === v }, l)))),
      fields.sec !== 'none' ? input('pass', 'Password', { type: 'password' }) : null,
      h('label.row', h('input', { type: 'checkbox', checked: fields.hidden, onchange: (e) => { fields.hidden = e.target.checked; changed(); } }), 'Hidden network')] : null,
      kind === 'contact' ? [input('name', 'Name'), input('phone', 'Phone'), input('email', 'Email'), input('org', 'Company')] : null,
      h('hr'),
      h('div.qr-row2',
        h('label.field', h('label', 'Error correction'), h('select.input', { onchange: (e) => { level = e.target.value; app.storage.set('level', level); changed(); } },
          [['L', 'Low (7%)'], ['M', 'Medium (15%)'], ['Q', 'Quartile (25%)'], ['H', 'High (30%)']].map(([v, l]) => h('option', { value: v, selected: level === v }, l)))),
        h('div'),
        h('label.field', h('label', 'Colour'), h('input', { type: 'color', value: fg, oninput: (e) => { fg = e.target.value; app.storage.set('fg', fg); draw(); } })),
        h('label.field', h('label', 'Background'), h('input', { type: 'color', value: bg, oninput: (e) => { bg = e.target.value; app.storage.set('bg', bg); draw(); } }))),
      h('small.hint', 'Higher error correction keeps the code readable when it’s damaged or printed small, but makes it denser. Dark codes on light backgrounds scan best.'));
  }

  let t = null;
  function changed() { clearTimeout(t); t = setTimeout(() => { app.storage.set('fields', fields); build(); }, 150); }
  function build() {
    const text = payload();
    if (!text || text === 'https://') { qr = null; draw(); info.textContent = 'Type something to encode.'; return; }
    try { qr = encodeQR(text, level); info.textContent = `Version ${qr.version} · ${qr.size}×${qr.size} modules · ${new TextEncoder().encode(text).length} bytes`; }
    catch (err) { qr = null; info.textContent = err.message; }
    draw();
  }
  function draw(scale = 1, target = canvas) {
    const g = target.getContext('2d');
    if (!qr) { target.width = target.height = 29; g.fillStyle = bg; g.fillRect(0, 0, 29, 29); return; }
    const quiet = 4, n = qr.size + quiet * 2;
    target.width = target.height = n * scale;
    g.fillStyle = bg; g.fillRect(0, 0, target.width, target.height);
    g.fillStyle = fg;
    qr.modules.forEach((row, y) => row.forEach((on, x) => { if (on) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale); }));
  }
  async function save(fmt) {
    if (!qr) return;
    const name = `QR ${new Date().toISOString().slice(0, 10)}`;
    const path = await ui.saveFile({ title: `Save ${fmt.toUpperCase()}`, suggestedName: `${name}.${fmt}`, filters: [{ label: fmt === 'png' ? 'PNG picture' : 'SVG picture', exts: [`.${fmt}`] }] });
    if (!path) return;
    if (fmt === 'png') {
      const c = document.createElement('canvas');
      draw(Math.max(4, Math.ceil(1024 / (qr.size + 8))), c);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      await app.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    } else {
      const n = qr.size + 8;
      let d = '';
      qr.modules.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + 4},${y + 4}h1v1h-1z`; }));
      await app.fs.writeText(path, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>\n`);
    }
    ui.alert('Saved', path.split('/').pop());
  }
  renderForm();
  build();
}
