// File operations shared by the desktop and (from phase 5) File Explorer:
// a file clipboard (cut/copy/paste), Recycle Bin deletes, new items, rename, properties,
// and importing files dragged in from the real computer.

import { h } from '../ui/h.js';
import { alertDialog, confirmDialog, dialog } from '../ui/dialog.js';
import { formatBytes } from '../core/util.js';
import { iconForEntry, typeName } from './file-icons.js';
import * as P from '../core/path.js';

let clip = { mode: null, paths: [] };
export const fileClipboard = () => clip;

export function setFileClipboard(kernel, mode, paths) {
  clip = { mode, paths: [...paths] };
  kernel.bus.emit('shell:fileClipboard', { ...clip });
  // Also put the paths on the system clipboard as text, like a desktop OS does.
  navigator.clipboard?.writeText(paths.join('\n')).catch(() => {});
}

/** Pastes the file clipboard into `dir`. Returns the new paths. */
export async function pasteInto(kernel, dir) {
  const { mode, paths } = clip;
  if (!mode || !paths.length) return [];
  const out = [];
  for (const src of paths) {
    try {
      if (!(await kernel.fs.exists(src))) continue;
      if (mode === 'cut' && P.dirname(src) === dir) { out.push(src); continue; }
      if (P.isSameOrInside(src, dir)) throw new Error(`“${P.basename(src)}” can’t be put inside itself.`);
      const name = await kernel.fs.uniqueName(dir, P.basename(src));
      const dest = P.join(dir, name);
      if (mode === 'cut') await kernel.fs.move(src, dest); else await kernel.fs.copy(src, dest);
      out.push(dest);
    } catch (err) {
      await alertDialog('Couldn’t paste', err.message);
    }
  }
  if (mode === 'cut') setFileClipboard(kernel, null, []);
  return out;
}

export async function moveInto(kernel, paths, dir, { copy = false } = {}) {
  const out = [];
  for (const src of paths) {
    try {
      if (P.dirname(src) === dir && !copy) continue;
      if (P.isSameOrInside(src, dir)) throw new Error(`“${P.basename(src)}” can’t be put inside itself.`);
      const dest = P.join(dir, await kernel.fs.uniqueName(dir, P.basename(src)));
      if (copy) await kernel.fs.copy(src, dest); else await kernel.fs.move(src, dest);
      out.push(dest);
    } catch (err) { await alertDialog(copy ? 'Couldn’t copy' : 'Couldn’t move', err.message); }
  }
  return out;
}

export async function trashPaths(kernel, home, paths) {
  for (const p of paths) {
    try { await kernel.fs.moveToTrash(p, home); } catch (err) { await alertDialog('Couldn’t delete', err.message); }
  }
}

export async function deletePermanently(kernel, paths) {
  const what = paths.length === 1 ? `“${P.basename(paths[0])}”` : `these ${paths.length} items`;
  if (!(await confirmDialog('Delete permanently?', `Are you sure you want to permanently delete ${what}? This can’t be undone.`, { ok: 'Delete', danger: true }))) return;
  for (const p of paths) {
    try { await kernel.fs.remove(p, { recursive: true }); } catch (err) { await alertDialog('Couldn’t delete', err.message); }
  }
}

export async function newFolder(kernel, dir) {
  const name = await kernel.fs.uniqueName(dir, 'New folder');
  await kernel.fs.mkdir(P.join(dir, name));
  return P.join(dir, name);
}

export async function newFile(kernel, dir, baseName, content = '') {
  const name = await kernel.fs.uniqueName(dir, baseName);
  await kernel.fs.writeText(P.join(dir, name), content);
  return P.join(dir, name);
}

/** Renames; shows a friendly message instead of throwing. Returns the new path or null. */
export async function renamePath(kernel, path, newName) {
  newName = newName.trim();
  if (!newName || newName === P.basename(path)) return null;
  const problem = P.validateName(newName);
  if (problem) { await alertDialog('Can’t rename', problem); return null; }
  try {
    const dest = P.join(P.dirname(path), newName);
    if (dest.toLowerCase() !== path.toLowerCase() && (await kernel.fs.exists(dest))) {
      await alertDialog('Can’t rename', `There’s already an item named “${newName}” here.`);
      return null;
    }
    return await kernel.fs.rename(path, newName);
  } catch (err) { await alertDialog('Can’t rename', err.message); return null; }
}

export async function showProperties(kernel, path) {
  const e = await kernel.fs.stat(path);
  if (!e) return;
  const size = h('dd', 'Calculating…');
  const contains = h('dd', e.type === 'dir' ? 'Calculating…' : '—');
  const fmtDate = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
  const body = h('div.props',
    h('div.props-head', h('img', { src: iconForEntry(e), alt: '' }), h('b', e.name)),
    h('dl', h('dt', 'Type'), h('dd', typeName(e)), h('dt', 'Location'), h('dd', P.dirname(path)),
      h('dt', 'Size'), size, ...(e.type === 'dir' ? [h('dt', 'Contains'), contains] : []),
      h('dt', 'Created'), h('dd', fmtDate(e.ctime)), h('dt', 'Modified'), h('dd', fmtDate(e.mtime))));
  const dlg = dialog({ title: `${e.name} properties`, body, buttons: [{ label: 'OK', value: true, primary: true }], width: 420 });
  if (e.type === 'dir') {
    kernel.fs.du(path).then((d) => {
      size.textContent = `${formatBytes(d.size)} (${d.size.toLocaleString()} bytes)`;
      contains.textContent = `${d.files.toLocaleString()} file${d.files === 1 ? '' : 's'}, ${d.dirs.toLocaleString()} folder${d.dirs === 1 ? '' : 's'}`;
    }).catch(() => { size.textContent = '—'; });
  } else {
    size.textContent = `${formatBytes(e.size)} (${e.size.toLocaleString()} bytes)`;
  }
  return dlg;
}

/** Writes files chosen/dropped from the real computer into `dir`, recreating folders. */
export async function importHostFiles(kernel, dir, files) {
  const out = [];
  for (const f of files) {
    try {
      const rel = (f.relativePath || f.name).split('/').filter(Boolean);
      let target = dir;
      for (const seg of rel.slice(0, -1)) {
        target = P.join(target, seg);
        await kernel.fs.mkdir(target, { recursive: true });
      }
      const name = rel.length > 1 ? rel[rel.length - 1] : await kernel.fs.uniqueName(target, rel[rel.length - 1]);
      await kernel.fs.writeFile(P.join(target, name), f.data);
      if (rel.length === 1) out.push(P.join(target, name));
      else if (!out.includes(P.join(dir, rel[0]))) out.push(P.join(dir, rel[0]));
    } catch (err) {
      await alertDialog('Couldn’t import a file', `${f.name}: ${err.message}`);
    }
  }
  return out;
}

/** Reads files (and whole folders) from a drop event coming from the real computer. */
export async function filesFromDataTransfer(dt) {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const out = [];
  const readFile = (entry, rel) => new Promise((resolve) => entry.file(async (file) => {
    out.push({ name: file.name, relativePath: rel, type: file.type, size: file.size, lastModified: file.lastModified, data: new Uint8Array(await file.arrayBuffer()) });
    resolve();
  }, () => resolve()));
  const walk = async (entry, rel) => {
    if (entry.isFile) return readFile(entry, rel);
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((r) => reader.readEntries(r, () => r([])));
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${rel}/${child.name}`);
    }
  };
  if (entries.length) { for (const e of entries) await walk(e, e.name); return out; }
  for (const f of dt.files) out.push({ name: f.name, relativePath: f.name, type: f.type, size: f.size, lastModified: f.lastModified, data: new Uint8Array(await f.arrayBuffer()) });
  return out;
}

export const hasHostFiles = (dt) => [...(dt?.types || [])].includes('Files');
export const DRAG_TYPE = 'application/x-donut-paths';
