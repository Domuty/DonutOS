// .dapp packages: one JSON file holding a Store app.
//
// {
//   "format": "donutos-app", "formatVersion": 1,
//   "manifest": { "id": "com.example.hello", "name": "Hello", "version": "1.0.0", "author": "…",
//                 "description": "…", "category": "Utilities", "permissions": [], "window": {…} },
//   "icon": "<svg …>…</svg>"            (SVG markup, or a data: URL of a PNG/JPEG/WebP)
//   "source": "export default function main(app) { … }"
// }

import { DonutError } from './errors.js';
import { validateManifest } from './registry.js';

const MAX_PACKAGE = 6 * 1024 * 1024;
const enc = new TextEncoder();

function svgDataUrl(svg) {
  // Icons are shown with <img>, which never runs scripts inside SVG; strip them anyway.
  const clean = svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
  const bytes = enc.encode(clean);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(s)}`;
}

/** Parses and checks a .dapp package. Returns a manifest ready for registry.install(). */
export function parseDapp(text) {
  if (typeof text !== 'string') text = new TextDecoder().decode(text);
  if (text.length > MAX_PACKAGE) throw new DonutError('E2BIG', 'This package is larger than 6 MB');
  let pkg;
  try { pkg = JSON.parse(text); } catch { throw new DonutError('EFORMAT', 'This isn’t a DonutOS app package (.dapp)'); }
  if (pkg?.format !== 'donutos-app') throw new DonutError('EFORMAT', 'This isn’t a DonutOS app package (.dapp)');
  if (pkg.formatVersion !== 1) throw new DonutError('EFORMAT', `Package format ${pkg.formatVersion} needs a newer DonutOS`);
  const m = pkg.manifest || {};
  let icon;
  if (typeof pkg.icon === 'string' && pkg.icon.trim().startsWith('<svg')) icon = svgDataUrl(pkg.icon);
  else if (typeof pkg.icon === 'string' && /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(pkg.icon)) icon = pkg.icon;
  const manifest = {
    id: m.id, name: m.name, version: m.version,
    author: typeof m.author === 'string' ? m.author.slice(0, 80) : 'Unknown developer',
    description: typeof m.description === 'string' ? m.description.slice(0, 600) : '',
    category: typeof m.category === 'string' ? m.category.slice(0, 40) : 'Other',
    permissions: Array.isArray(m.permissions) ? m.permissions : [],
    fileTypes: Array.isArray(m.fileTypes) ? m.fileTypes : [],
    singleInstance: !!m.singleInstance,
    window: m.window && typeof m.window === 'object' ? {
      width: clampNum(m.window.width, 240, 2400, 800), height: clampNum(m.window.height, 160, 1600, 560),
      minWidth: clampNum(m.window.minWidth, 200, 2400, 320), minHeight: clampNum(m.window.minHeight, 140, 1600, 220),
    } : undefined,
    homepage: typeof m.homepage === 'string' && /^https:\/\//.test(m.homepage) ? m.homepage : undefined,
    ...(icon ? { icon } : {}),
    source: typeof pkg.source === 'string' ? pkg.source : '',
  };
  if (!manifest.source.trim()) throw new DonutError('EFORMAT', 'The package has no code');
  const errors = validateManifest(manifest);
  if (errors.length) throw new DonutError('EMANIFEST', `This package can’t be installed: ${errors.join('; ')}`, { errors });
  return manifest;
}

const clampNum = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : d);

/** Builds a .dapp package (used by the Terminal's `dapp pack` and scripts/pack-dapp.js). */
export function buildDapp({ manifest, source, icon }) {
  return `${JSON.stringify({ format: 'donutos-app', formatVersion: 1, manifest, icon: icon || undefined, source }, null, 1)}\n`;
}

/** Compares versions like 1.2.10 > 1.2.9. */
export function compareVersions(a, b) {
  const pa = String(a).split(/[.+-]/).map((x) => parseInt(x, 10) || 0), pb = String(b).split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}
