// Wallpapers. A wallpaper "spec" is either "builtin:<name>" or "file:<DonutOS path>"
// (an image the user picked from their files), or "color:#rrggbb".

import { h } from '../ui/h.js';

export const BUILTIN_WALLPAPERS = [
  { id: 'builtin:glaze', name: 'Glaze', theme: 'dark' },
  { id: 'builtin:sprinkles', name: 'Sprinkles', theme: 'dark' },
  { id: 'builtin:dawn', name: 'Dawn', theme: 'dark' },
  { id: 'builtin:mint', name: 'Mint', theme: 'light' },
  { id: 'builtin:ocean', name: 'Ocean', theme: 'dark' },
  { id: 'builtin:aurora', name: 'Aurora', theme: 'dark' },
];

export const SOLID_COLORS = ['#1b1b2f', '#2d1238', '#0f3d3e', '#3b2a1a', '#203a5c', '#5a1f3d', '#e9e4dc', '#c8d6e5'];

const base = new URL('../assets/wallpapers/', import.meta.url);
const fileUrls = new Map(); // spec -> { url, mtime } (cached so switching back is instant)

export const builtinUrl = (name, thumb = false) => new URL(`${name}${thumb ? '-thumb' : ''}.jpg`, base).href;

/** Resolves a spec to something usable as a CSS background. Falls back to Glaze if a file is gone. */
export async function resolveWallpaper(spec, fs, { thumb = false } = {}) {
  if (spec?.startsWith('color:')) return { color: spec.slice(6), url: null };
  if (spec?.startsWith('file:')) {
    try {
      // Cache by modification time so a replaced image is picked up.
      const st = await fs.stat(spec.slice(5));
      if (!st) throw new Error('missing');
      const cached = fileUrls.get(spec);
      if (cached?.mtime === st.mtime) return { url: cached.url };
      if (cached) URL.revokeObjectURL(cached.url);
      const url = URL.createObjectURL(await fs.readBlob(spec.slice(5)));
      fileUrls.set(spec, { url, mtime: st.mtime });
      return { url };
    } catch {
      return { url: builtinUrl('glaze', thumb), missing: true };
    }
  }
  const name = spec?.startsWith('builtin:') ? spec.slice(8) : 'glaze';
  return { url: builtinUrl(BUILTIN_WALLPAPERS.some((w) => w.id === `builtin:${name}`) ? name : 'glaze', thumb) };
}

const FIT = { fill: 'cover', fit: 'contain', stretch: '100% 100%', center: 'auto', tile: 'auto' };

/** Paints `el` with a wallpaper, fading the new image in once it has loaded. */
export async function paintWallpaper(el, spec, fs, fit = 'fill') {
  const token = (el._wpToken = (el._wpToken || 0) + 1);
  const res = await resolveWallpaper(spec, fs);
  const layer = h('div.wp-layer', { style: { backgroundColor: res.color || '#000' } });
  if (res.url) {
    await new Promise((resolve) => { const img = new Image(); img.onload = img.onerror = resolve; img.src = res.url; });
    if (token !== el._wpToken) return res;
    Object.assign(layer.style, {
      backgroundImage: `url("${res.url}")`, backgroundSize: FIT[fit] || 'cover',
      backgroundRepeat: fit === 'tile' ? 'repeat' : 'no-repeat', backgroundPosition: 'center',
    });
  }
  // Paints can overlap (fast clicks): a slower, older paint must not land on top.
  if (token !== el._wpToken) return res;
  const below = [...el.querySelectorAll('.wp-layer')];
  el.append(layer);
  requestAnimationFrame(() => layer.classList.add('in'));
  setTimeout(() => below.forEach((old) => old.remove()), 700);
  return res;
}
