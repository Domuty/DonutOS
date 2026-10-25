// POSIX-style path utilities for the DonutOS virtual file system.
// All DonutOS paths are absolute, use "/" and never contain "." or ".." after normalisation.

export const SEP = '/';

export function normalize(p) {
  if (typeof p !== 'string') throw new TypeError('Path must be a string');
  if (p.includes('\0')) throw new TypeError('Path contains a null byte');
  const parts = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

export const join = (...segs) => normalize(segs.filter((s) => s !== '' && s != null).join('/'));

/** Resolves `p` against `cwd` (like a shell would). */
export const resolve = (cwd, p) => (p.startsWith('/') ? normalize(p) : normalize(`${cwd}/${p}`));

export function dirname(p) {
  const n = normalize(p);
  if (n === '/') return '/';
  const i = n.lastIndexOf('/');
  return i <= 0 ? '/' : n.slice(0, i);
}

export function basename(p, ext) {
  const n = normalize(p);
  let b = n === '/' ? '' : n.slice(n.lastIndexOf('/') + 1);
  if (ext && b.toLowerCase().endsWith(ext.toLowerCase()) && b.length > ext.length) b = b.slice(0, -ext.length);
  return b;
}

/** Lower-cased extension including the dot (".txt"), or "" when there is none. Dotfiles have no extension. */
export function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i).toLowerCase();
}

export const split = (p) => normalize(p).split('/').filter(Boolean);

/** True when `child` is strictly inside `parent`. */
export function isInside(parent, child) {
  const a = normalize(parent), b = normalize(child);
  if (a === b) return false;
  return a === '/' ? true : b.startsWith(a + '/');
}

export const isSameOrInside = (parent, child) => normalize(parent) === normalize(child) || isInside(parent, child);

const INVALID_NAME = /[\\/:*?"<>|\u0000-\u001f]/;
const RESERVED = new Set(['.', '..']);

/** Validates a single file or folder name (not a path). Returns an error message or null. */
export function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) return 'Name cannot be empty';
  if (name.length > 255) return 'Name is too long';
  if (RESERVED.has(name)) return 'That name is reserved';
  if (INVALID_NAME.test(name)) return 'A name cannot contain any of: \\ / : * ? " < > |';
  if (/[. ]$/.test(name)) return 'A name cannot end with a space or a period';
  return null;
}
