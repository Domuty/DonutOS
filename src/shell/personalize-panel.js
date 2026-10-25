// Personalisation: background, lock screen, theme, accent colour, effects.
// Rendered inside a dialog for now; Settings › Personalization (phase 5) embeds it too.

import { h, mount } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { alertDialog } from '../ui/dialog.js';
import { BUILTIN_WALLPAPERS, SOLID_COLORS, builtinUrl, resolveWallpaper } from './wallpaper.js';
import { ACCENTS } from './oobe.js';
import * as P from '../core/path.js';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg']);

export function renderPersonalize(container, { kernel, uid }) {
  const s = kernel.settings.forUser(uid);
  const home = kernel.homeFor(uid);
  const folder = P.join(home, 'Pictures', 'Wallpapers');

  const toggle = (key, label, desc) => {
    const input = h('input', { type: 'checkbox', checked: s.get(key), onchange: (e) => s.set(key, e.target.checked), 'aria-label': label });
    return h('div.row', h('div.grow', h('div.t', label), desc ? h('div.d', desc) : null), h('label.toggle', input, h('span')));
  };

  async function customImages() {
    if (!(await kernel.fs.exists(folder))) return [];
    return (await kernel.fs.readdir(folder)).filter((e) => e.type === 'file' && IMAGE_EXT.has(e.ext));
  }

  async function browse() {
    const files = await kernel.platform.host.importFiles({ multiple: false, accept: 'image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.svg' });
    if (!files.length) return;
    const f = files[0];
    if (!IMAGE_EXT.has(P.extname(f.name))) { await alertDialog('Can’t use that file', 'Choose a PNG, JPEG, WebP, GIF, BMP, AVIF or SVG image.'); return; }
    await kernel.fs.mkdir(folder, { recursive: true });
    const name = await kernel.fs.uniqueName(folder, f.name);
    await kernel.fs.writeFile(P.join(folder, name), f.data);
    s.set('appearance.wallpaper', `file:${P.join(folder, name)}`);
    render();
  }

  async function wallpaperChoices(key, { includeSame = false } = {}) {
    const current = s.get(key);
    const pick = (spec) => { s.set(key, spec); render(); };
    const btn = (spec, label, content) => h('button.choice', { type: 'button', role: 'radio', title: label, 'aria-label': label, 'aria-checked': String(current === spec), 'aria-pressed': String(current === spec), onclick: () => pick(spec) }, content);
    const items = [];
    if (includeSame) items.push(btn('same', 'Same as desktop', h('div.wp-solid', { style: { display: 'grid', placeItems: 'center', background: 'var(--surface-3)', fontSize: '12px' } }, 'Same as desktop')));
    for (const w of BUILTIN_WALLPAPERS) items.push(btn(w.id, w.name, h('img', { src: builtinUrl(w.id.slice(8), true), alt: '' })));
    for (const e of await customImages()) {
      const { url } = await resolveWallpaper(`file:${e.path}`, kernel.fs);
      items.push(btn(`file:${e.path}`, e.name, h('img', { src: url, alt: '' })));
    }
    if (!includeSame) for (const c of SOLID_COLORS) items.push(btn(`color:${c}`, `Solid colour ${c}`, h('div.wp-solid', { style: { background: c } })));
    return h('div.wp-grid', { role: 'radiogroup' }, items);
  }

  async function render() {
    const theme = s.get('appearance.theme');
    const accent = s.get('appearance.accent');
    const fit = h('select.input', { style: { width: '140px' }, 'aria-label': 'Picture fit', onchange: (e) => s.set('appearance.wallpaperFit', e.target.value) },
      ['fill', 'fit', 'stretch', 'center', 'tile'].map((v) => h('option', { value: v, selected: s.get('appearance.wallpaperFit') === v }, v[0].toUpperCase() + v.slice(1))));
    const custom = h('input', { type: 'color', value: accent, 'aria-label': 'Custom accent colour', style: { width: '40px', height: '32px', border: 0, background: 'none', padding: 0 }, onchange: (e) => { s.set('appearance.accent', e.target.value); render(); } });

    mount(container,
      h('div.section-title', 'Background'),
      await wallpaperChoices('appearance.wallpaper'),
      h('div.row', h('div.grow', h('div.t', 'Choose a photo'), h('div.d', 'Copies an image from your computer into Pictures › Wallpapers')), h('button.btn', { type: 'button', onclick: browse }, icon('image', { size: 16 }), 'Browse photos')),
      h('div.row', h('div.grow', h('div.t', 'Choose a fit for your desktop image')), fit),

      h('div.section-title', 'Lock screen'),
      await wallpaperChoices('appearance.lockWallpaper', { includeSame: true }),
      toggle('lock.showStatus', 'Show network and battery status on the lock screen'),

      h('div.section-title', 'Colours'),
      h('div.row', h('div.grow', h('div.t', 'Choose your mode'), h('div.d', 'Auto follows your computer’s light/dark setting')),
        h('select.input', { style: { width: '140px' }, 'aria-label': 'Mode', onchange: (e) => { s.set('appearance.theme', e.target.value); } },
          [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']].map(([v, l]) => h('option', { value: v, selected: theme === v }, l)))),
      h('div.row', { style: { flexWrap: 'wrap' } }, h('div.grow', h('div.t', 'Accent colour')),
        h('div.swatches', ACCENTS.map((c) => h('button.swatch', { type: 'button', 'aria-label': c, 'aria-pressed': String(accent === c), style: { background: c }, onclick: () => { s.set('appearance.accent', c); render(); } })), custom)),
      toggle('appearance.transparency', 'Transparency effects', 'Windows and surfaces appear slightly see-through'),
      toggle('appearance.animations', 'Animation effects'),
    );
  }

  render();
  const off = kernel.bus.on('fs:changed', (e) => { if (e.dir === folder) render(); });
  return () => off();
}
