// Colors — picker, conversions, harmonies, contrast checker and saved swatches.
import { h, mount, css } from '@donut/sdk';

css(`
.co { height: 100%; overflow: auto; padding: 18px 22px; display: grid; gap: 16px; align-content: start; }
.co-top { display: grid; grid-template-columns: 220px 1fr; gap: 18px; }
.co-big { height: 180px; border-radius: 12px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); position: relative; overflow: hidden; }
.co-big input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.co-vals { display: grid; gap: 8px; } .co-val { display: grid; grid-template-columns: 50px 1fr auto; align-items: center; gap: 8px; }
.co-sl { display: grid; grid-template-columns: 30px 1fr 44px; align-items: center; gap: 8px; } .co-sl input[type=range] { accent-color: var(--accent); }
.co-row { display: flex; gap: 6px; flex-wrap: wrap; }
.co-sw { width: 64px; text-align: center; border: 0; background: none; padding: 0; font: 11px var(--font-mono); color: var(--text-2); }
.co-sw i { display: block; height: 48px; border-radius: 8px; margin-bottom: 3px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
.co-contrast { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.co-sample { padding: 14px; border-radius: 10px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
.pass { color: var(--ok); font-weight: 600; } .fail { color: var(--danger); font-weight: 600; }
@media (max-width: 620px) { .co-top, .co-contrast { grid-template-columns: 1fr; } }
`);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hexToRgb = (hx) => { const n = parseInt(hx.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l * 100];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s * 100, l * 100];
}
function hslToRgb(hh, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const lum = (hx) => { const c = hexToRgb(hx).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export default function main(app) {
  let color = app.storage.get('color', '#e8618c');
  let text = app.storage.get('text', '#ffffff');
  let saved = app.storage.get('saved', []);
  const root = h('div.co');
  mount(app.root, root);

  const copy = (v) => { app.clipboard.writeText(v); toast(`Copied ${v}`); };
  let toastEl = null;
  function toast(msg) { toastEl?.remove(); toastEl = h('div.card', { style: { position: 'fixed', bottom: '14px', right: '14px', padding: '8px 14px' } }, msg); document.body.append(toastEl); setTimeout(() => toastEl?.remove(), 1600); }
  const sw = (hx, onclick = () => set(hx)) => h('button.co-sw', { type: 'button', title: `${hx} — click to use, right-click to copy`, onclick, oncontextmenu: (e) => { e.preventDefault(); copy(hx); } }, h('i', { style: { background: hx } }), hx);

  function set(hx) { color = hx.toLowerCase(); app.storage.set('color', color); render(); }
  function render() {
    const [r, g, b] = hexToRgb(color), [hh, s, l] = rgbToHsl(r, g, b);
    const fromHsl = (H, S, L) => rgbToHex(...hslToRgb(((H % 360) + 360) % 360, clamp(S, 0, 100), clamp(L, 0, 100)));
    const vals = [['HEX', color], ['RGB', `rgb(${r}, ${g}, ${b})`], ['HSL', `hsl(${Math.round(hh)}, ${Math.round(s)}%, ${Math.round(l)}%)`]];
    const hexIn = h('input.input', { value: color, 'aria-label': 'Hex colour', onchange: (e) => { const v = e.target.value.trim().replace(/^#?/, '#'); if (/^#[0-9a-f]{6}$/i.test(v)) set(v); else if (/^#[0-9a-f]{3}$/i.test(v)) set(`#${[...v.slice(1)].map((c) => c + c).join('')}`); } });
    const slider = (label, val, max, fn) => h('div.co-sl', h('small', label), h('input', { type: 'range', min: 0, max, value: Math.round(val), 'aria-label': label, oninput: (e) => fn(Number(e.target.value)) }), h('small', String(Math.round(val))));
    const harmony = { Complementary: [0, 180], Analogous: [-30, 0, 30], Triadic: [0, 120, 240], 'Split complementary': [0, 150, 210], Tetradic: [0, 90, 180, 270] };
    const cr = ratio(color, text);
    mount(root,
      h('div.co-top',
        h('div.co-big', { style: { background: color } }, h('input', { type: 'color', value: color, 'aria-label': 'Pick a colour', oninput: (e) => set(e.target.value) })),
        h('div.co-vals', hexIn, vals.map(([k, v]) => h('div.co-val', h('small', k), h('code', v), h('button.btn.subtle', { type: 'button', onclick: () => copy(v) }, 'Copy'))),
          slider('H', hh, 360, (v) => set(fromHsl(v, s, l))), slider('S', s, 100, (v) => set(fromHsl(hh, v, l))), slider('L', l, 100, (v) => set(fromHsl(hh, s, v))),
          h('div.row', h('button.btn', { type: 'button', onclick: () => { if (!saved.includes(color)) { saved = [color, ...saved].slice(0, 40); app.storage.set('saved', saved); render(); } } }, '☆ Save colour'),
            h('button.btn', { type: 'button', onclick: () => set(rgbToHex(Math.random() * 255, Math.random() * 255, Math.random() * 255)) }, '🎲 Random')))),
      h('h3', 'Shades and tints'), h('div.co-row', [10, 20, 30, 40, 50, 60, 70, 80, 90].map((L) => sw(fromHsl(hh, s, L)))),
      Object.entries(harmony).map(([name, offs]) => [h('h3', name), h('div.co-row', offs.map((o) => sw(fromHsl(hh + o, s, l))))]),
      h('h3', 'Contrast'),
      h('div.co-contrast',
        h('div.co-sample', { style: { background: color, color: text } }, h('b', { style: { fontSize: '20px' } }, 'Large text sample'), h('p', { style: { margin: '6px 0 0' } }, 'Regular body text on this background.')),
        h('div.stack', h('div.row', h('small', 'Text colour'), h('input', { type: 'color', value: text, 'aria-label': 'Text colour', oninput: (e) => { text = e.target.value; app.storage.set('text', text); render(); } }),
          h('button.btn.subtle', { type: 'button', onclick: () => { text = lum(color) > 0.179 ? '#000000' : '#ffffff'; app.storage.set('text', text); render(); } }, 'Best black/white')),
          h('div', h('b', { style: { fontSize: '22px' } }, `${cr.toFixed(2)} : 1`)),
          h('div', 'Normal text: ', h('span', { class: cr >= 7 ? 'pass' : cr >= 4.5 ? 'pass' : 'fail' }, cr >= 7 ? 'AAA' : cr >= 4.5 ? 'AA' : 'Fails')),
          h('div', 'Large text: ', h('span', { class: cr >= 3 ? 'pass' : 'fail' }, cr >= 4.5 ? 'AAA' : cr >= 3 ? 'AA' : 'Fails')))),
      h('h3', 'Saved colours'),
      saved.length ? h('div.co-row', saved.map((c) => h('div', sw(c), h('button.btn.subtle', { type: 'button', style: { width: '64px', minHeight: '22px', padding: 0, fontSize: '11px' }, onclick: () => { saved = saved.filter((x) => x !== c); app.storage.set('saved', saved); render(); } }, 'Remove')))) : h('small.hint', 'Save colours to keep them here.'));
  }
  render();
}
