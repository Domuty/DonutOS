// ZIP support (compress and extract) using the vendored JSZip library.

import * as P from '../core/path.js';

let loading = null;
export function loadJSZip() {
  if (globalThis.JSZip) return Promise.resolve(globalThis.JSZip);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/jszip.min.js', import.meta.url).href;
    s.onload = () => resolve(globalThis.JSZip);
    s.onerror = () => { loading = null; reject(new Error('The ZIP library could not be loaded')); };
    document.head.append(s);
  });
  return loading;
}

/**
 * Compresses files/folders into a ZIP. `fs` is a DonutOS file API. Returns the ZIP bytes.
 * onProgress(done, total) is called as files are added.
 */
export async function zipPaths(fs, paths, { onProgress, signal } = {}) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const files = [];
  for (const p of paths) {
    const st = await fs.stat(p);
    if (!st) continue;
    const base = P.basename(p);
    if (st.type === 'file') { files.push([p, base]); continue; }
    zip.folder(base);
    await fs.walk(p, (e) => {
      const rel = `${base}${e.path.slice(p.length)}`;
      if (e.type === 'dir') zip.folder(rel); else files.push([e.path, rel]);
    }, { hidden: true });
  }
  let done = 0;
  for (const [path, rel] of files) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const st = await fs.stat(path);
    zip.file(rel, await fs.readFile(path), { date: new Date(st.mtime) });
    onProgress?.(++done, files.length);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Lists a ZIP's entries: [{ name, dir, size, date }]. */
export async function listZip(bytes) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(bytes);
  const out = [];
  zip.forEach((rel, entry) => {
    out.push({ name: rel.replace(/\/$/, ''), dir: entry.dir, size: entry._data?.uncompressedSize ?? 0, date: entry.date });
  });
  return out;
}

/** Extracts every entry under `destDir` (created if needed). Refuses entries that escape it. */
export async function unzipTo(fs, bytes, destDir, { onProgress, signal } = {}) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(bytes);
  await fs.mkdir(destDir, { recursive: true });
  const entries = [];
  zip.forEach((rel, entry) => entries.push([rel, entry]));
  let done = 0;
  for (const [rel, entry] of entries) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const target = P.join(destDir, rel);
    if (!P.isSameOrInside(destDir, target)) continue; // "zip slip" protection
    if (entry.dir) await fs.mkdir(target, { recursive: true });
    else await fs.writeFile(target, await entry.async('uint8array'), { mkdirp: true });
    onProgress?.(++done, entries.length);
  }
  return entries.length;
}
