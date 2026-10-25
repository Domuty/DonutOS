// File Explorer operations that need a dialog or progress: ZIP compress/extract,
// exporting to the real computer, importing, and opening ZIP files.

import { h } from '../../ui/h.js';
import { dialog, alertDialog } from '../../ui/dialog.js';
import { formatBytes } from '../../core/util.js';
import { zipPaths, unzipTo, listZip } from '../../lib/zip.js';
import { importHostFiles } from '../../shell/file-ops.js';
import * as P from '../../core/path.js';

/** A small progress dialog. Returns { update(done, total, label), close(), signal }. */
export function progress(title) {
  const ctrl = new AbortController();
  const bar = h('div.ex-progress', h('i'));
  const label = h('div.hint', 'Starting…');
  let close;
  dialog({
    title, width: 420, body: h('div', { style: { display: 'grid', gap: '10px' } }, bar, label),
    buttons: [{ label: 'Cancel', value: 'cancel' }], cancelValue: 'cancel', dismissible: false,
    onOpen: ({ close: c }) => { close = c; },
  }).then((v) => { if (v === 'cancel') ctrl.abort(); });
  return {
    signal: ctrl.signal,
    update(done, total, text) {
      bar.firstChild.style.width = `${total ? (done / total) * 100 : 0}%`;
      label.textContent = text || `${done} of ${total}`;
    },
    close: () => close?.('done'),
  };
}

export async function compress(k, dir, paths) {
  if (!paths.length) return null;
  const base = paths.length === 1 ? P.basename(paths[0]).replace(/\.[^.]+$/, '') || P.basename(paths[0]) : 'Archive';
  const name = await k.fs.uniqueName(dir, `${base}.zip`);
  const prog = progress('Compressing');
  try {
    const bytes = await zipPaths(k.fs, paths, { signal: prog.signal, onProgress: (d, t) => prog.update(d, t, `Adding ${d} of ${t} files`) });
    await k.fs.writeFile(P.join(dir, name), bytes);
    return P.join(dir, name);
  } catch (err) {
    if (err.name !== 'AbortError') await alertDialog('Couldn’t compress', err.message);
    return null;
  } finally { prog.close(); }
}

/** Asks where to extract a ZIP, extracts it, and returns the destination folder. */
export async function extractAll(k, zipPath) {
  const dir = P.dirname(zipPath);
  const stem = P.basename(zipPath).replace(/\.zip$/i, '');
  const input = h('input.input', { value: P.join(dir, await k.fs.uniqueName(dir, stem)), 'aria-label': 'Destination folder' });
  const ok = await dialog({
    title: 'Extract compressed (zipped) folder', width: 520,
    body: h('div.field', h('label', 'Files will be extracted to this folder:'), input),
    cancelValue: false, buttons: [{ label: 'Extract', value: true, primary: true }, { label: 'Cancel', value: false }],
    onOpen: () => input.select(),
  });
  if (!ok) return null;
  const dest = P.normalize(input.value.trim());
  const prog = progress('Extracting');
  try {
    await unzipTo(k.fs, await k.fs.readFile(zipPath), dest, { signal: prog.signal, onProgress: (d, t) => prog.update(d, t, `Extracting ${d} of ${t} items`) });
    return dest;
  } catch (err) {
    if (err.name !== 'AbortError') await alertDialog('Couldn’t extract', /end of central directory|corrupted/i.test(err.message) ? 'This file isn’t a valid ZIP archive, or it is damaged.' : err.message);
    return null;
  } finally { prog.close(); }
}

/** Shows what's inside a ZIP and offers to extract it. Resolves with the extract folder or null. */
export async function openZip(k, zipPath) {
  let entries;
  try { entries = await listZip(await k.fs.readFile(zipPath)); }
  catch { await alertDialog('Can’t open this file', 'This file isn’t a valid ZIP archive, or it is damaged.'); return null; }
  const files = entries.filter((e) => !e.dir);
  const total = files.reduce((n, e) => n + (e.size || 0), 0);
  const list = h('div.ex-ziplist', entries.slice(0, 300).map((e) => h('div', h('span', e.dir ? `${e.name}/` : e.name), h('small', e.dir ? 'Folder' : formatBytes(e.size)))));
  const choice = await dialog({
    title: P.basename(zipPath), width: 560,
    body: h('div', { style: { display: 'grid', gap: '10px' } },
      h('p', `${files.length} file${files.length === 1 ? '' : 's'}, ${formatBytes(total)} uncompressed.${entries.length > 300 ? ' Showing the first 300 items.' : ''}`), list),
    cancelValue: false, buttons: [{ label: 'Extract all…', value: true, primary: true }, { label: 'Close', value: false }],
  });
  return choice ? extractAll(k, zipPath) : null;
}

/** Saves items to the real computer: a single file as-is, anything else as one ZIP. */
export async function exportToHost(k, paths) {
  if (!paths.length) return;
  try {
    const st = await k.fs.stat(paths[0]);
    if (paths.length === 1 && st?.type === 'file') {
      await k.platform.host.exportFile(st.name, await k.fs.readFile(paths[0]), st.mime);
      return;
    }
    const prog = progress('Preparing download');
    try {
      const bytes = await zipPaths(k.fs, paths, { signal: prog.signal, onProgress: (d, t) => prog.update(d, t) });
      const name = paths.length === 1 ? `${P.basename(paths[0])}.zip` : 'DonutOS files.zip';
      await k.platform.host.exportFile(name, bytes, 'application/zip');
    } finally { prog.close(); }
  } catch (err) {
    if (err.name !== 'AbortError') await alertDialog('Couldn’t export', err.message);
  }
}

export async function importFromHost(k, dir, { directory = false } = {}) {
  const files = await k.platform.host.importFiles({ multiple: true, directory });
  if (!files.length) return [];
  return importHostFiles(k, dir, files);
}

