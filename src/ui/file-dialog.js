// Open and Save As dialogs for apps. They browse through the app's own permission-checked
// ctx.fs, sit inside the app's window (so other apps stay usable), and remember the last
// folder per app.

import { h, mount } from './h.js';
import { icon } from './icons.js';
import { dialog, confirmDialog, promptDialog } from './dialog.js';
import { formatBytes } from '../core/util.js';
import * as P from '../core/path.js';

const PLACES = [['Home', '', 'user'], ['Desktop', 'Desktop', 'monitor'], ['Documents', 'Documents', 'file'], ['Downloads', 'Downloads', 'download'],
  ['Pictures', 'Pictures', 'image'], ['Music', 'Music', 'volume'], ['Videos', 'Videos', 'camera']];

/**
 * Lets the user pick a file (or files). Resolves with a path, an array of paths (multiple),
 * or null when cancelled.
 * filters: [{ label: 'Images', exts: ['.png', '.jpg'] }, { label: 'All files', exts: ['*'] }]
 */
export function openFileDialog(ctx, win, { title = 'Open', filters = [{ label: 'All files', exts: ['*'] }], multiple = false, startIn } = {}) {
  return fileDialog(ctx, win, { mode: 'open', title, filters, multiple, startIn });
}

/** Asks where to save. Resolves with the chosen path (extension added if missing) or null. */
export function saveFileDialog(ctx, win, { title = 'Save as', filters = [{ label: 'All files', exts: ['*'] }], suggestedName = 'Untitled', startIn } = {}) {
  return fileDialog(ctx, win, { mode: 'save', title, filters, suggestedName, startIn });
}

async function fileDialog(ctx, win, { mode, title, filters, multiple, suggestedName, startIn }) {
  const fs = ctx.fs;
  const home = fs.home();
  let dir = startIn || ctx.storage.get('fileDialog.dir', null) || P.join(home, mode === 'save' ? 'Documents' : '');
  if (!(await fs.isDir(dir).catch(() => false))) dir = home;
  let filter = 0;
  let entries = [];
  let selected = new Set();
  const back = [];

  const pathInput = h('input.input.fd-path', { 'aria-label': 'Folder', spellcheck: false, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); go(fs.path.resolve(home, pathInput.value.replace(/^~/, home))); } } });
  const list = h('div.fd-list', { role: 'listbox', 'aria-label': 'Files', 'aria-multiselectable': String(!!multiple), tabindex: '0' });
  const nameInput = h('input.input', { 'aria-label': 'File name', spellcheck: false, value: mode === 'save' ? suggestedName : '' });
  const filterSelect = h('select.input.fd-filter', { 'aria-label': 'File type', onchange: () => { filter = Number(filterSelect.value); if (mode === 'save') fixExt(); render(); } },
    filters.map((f, i) => h('option', { value: i }, f.exts.includes('*') ? f.label : `${f.label} (${f.exts.map((x) => `*${x}`).join(', ')})`)));
  const err = h('div.error-text', { role: 'alert' });
  const places = h('nav.fd-places', { 'aria-label': 'Places' }, PLACES.map(([label, sub, ic]) => h('button.fd-place', { type: 'button', onclick: () => go(sub ? P.join(home, sub) : home) }, icon(ic, { size: 16 }), label)));

  const accepts = (e) => e.type === 'dir' || filters[filter].exts.includes('*') || filters[filter].exts.includes(e.ext.toLowerCase());

  function fixExt() {
    const exts = filters[filter].exts;
    if (exts.includes('*')) return;
    const v = nameInput.value;
    const cur = P.extname(v);
    if (!exts.includes(cur.toLowerCase())) nameInput.value = (cur ? v.slice(0, -cur.length) : v) + exts[0];
  }

  async function go(path, { push = true } = {}) {
    try {
      if (!(await fs.isDir(path))) { err.textContent = 'That folder doesn’t exist.'; return; }
      entries = await fs.readdir(path);
    } catch (e) { err.textContent = e.name === 'PermissionError' ? 'You don’t have access to that folder.' : e.message; return; }
    if (push && path !== dir) back.push(dir);
    dir = path;
    selected = new Set();
    err.textContent = '';
    render();
  }

  function render() {
    pathInput.value = dir === home || P.isInside(home, dir) ? `~${dir.slice(home.length)}` : dir;
    const shown = entries.filter(accepts).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1));
    mount(list, shown.length ? shown.map((e) => h('div.fd-item', {
      role: 'option', 'aria-selected': String(selected.has(e.path)), dataset: { path: e.path },
      onclick: (ev) => {
        if (multiple && (ev.ctrlKey || ev.metaKey)) { if (selected.has(e.path)) selected.delete(e.path); else selected.add(e.path); }
        else selected = new Set([e.path]);
        if (e.type !== 'dir') nameInput.value = multiple && selected.size > 1 ? [...selected].map((p) => `"${P.basename(p)}"`).join(' ') : e.name;
        render();
      },
      ondblclick: () => { if (e.type === 'dir') go(e.path); else { nameInput.value = e.name; selected = new Set([e.path]); api?.close('ok'); } },
    }, icon(e.type === 'dir' ? 'folder' : e.kind === 'image' ? 'image' : e.kind === 'audio' ? 'volume' : e.kind === 'video' ? 'camera' : 'file', { size: 18 }),
    h('span.fd-name', e.name), h('span.fd-meta', e.type === 'dir' ? 'Folder' : formatBytes(e.size)), h('span.fd-meta', new Date(e.mtime).toLocaleDateString())))
      : h('div.fd-empty', 'This folder is empty.'));
  }

  list.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('.fd-item')];
    const i = items.findIndex((x) => x.getAttribute('aria-selected') === 'true');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.click(); list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); e.stopPropagation(); items[i].dispatchEvent(new MouseEvent('dblclick')); }
    else if (e.key === 'Backspace') { e.preventDefault(); go(P.dirname(dir)); }
  });

  let api = null;
  const toolbar = h('div.fd-bar',
    h('button.tb-btn', { type: 'button', 'aria-label': 'Back', title: 'Back', onclick: () => back.length && go(back.pop(), { push: false }) }, icon('arrowLeft', { size: 16 })),
    h('button.tb-btn', { type: 'button', 'aria-label': 'Up one folder', title: 'Up', onclick: () => go(P.dirname(dir)) }, icon('chevronUp', { size: 16 })),
    pathInput,
    h('button.btn', { type: 'button', onclick: async () => {
      const name = await promptDialog('New folder', { label: 'Folder name', value: 'New folder', parent: win.body, validate: (v) => P.validateName(v.trim()) || '' });
      if (!name) return;
      try { const p = P.join(dir, name.trim()); await fs.mkdir(p); await go(dir, { push: false }); selected = new Set([p]); render(); } catch (e) { err.textContent = e.message; }
    } }, icon('newFolder', { size: 16 }), 'New folder'));

  const resolveChoice = async () => {
    const raw = nameInput.value.trim();
    if (mode === 'open') {
      const chosen = [...selected].filter((p) => entries.find((e) => e.path === p)?.type !== 'dir');
      if (chosen.length) return multiple ? chosen : chosen[0];
      if (!raw) { err.textContent = 'Choose a file.'; return null; }
      const p = P.resolve(dir, raw.replace(/^~/, home));
      const st = await fs.stat(p).catch(() => null);
      if (!st) { err.textContent = `${raw} wasn’t found.`; return null; }
      if (st.type === 'dir') { go(p); return null; }
      return multiple ? [p] : p;
    }
    if (!raw) { err.textContent = 'Type a file name.'; return null; }
    let name = raw;
    const exts = filters[filter].exts;
    if (!exts.includes('*') && !P.extname(name)) name += exts[0];
    const problem = P.validateName(name);
    if (problem) { err.textContent = problem; return null; }
    const p = P.join(dir, name);
    const st = await fs.stat(p).catch(() => null);
    if (st?.type === 'dir') { go(p); return null; }
    if (st && !(await confirmDialog(`${name} already exists`, 'Do you want to replace it?', { ok: 'Replace', parent: win.body }))) return null;
    return p;
  };

  let result = null;
  await go(dir, { push: false });
  const value = await dialog({
    title, width: 760, parent: win.body, cancelValue: null,
    body: h('div.fd', toolbar, h('div.fd-main', places, list),
      h('div.fd-foot', h('label', mode === 'save' ? 'File name' : 'File name', nameInput), filterSelect), err),
    buttons: [{ label: mode === 'save' ? 'Save' : 'Open', value: 'ok', primary: true, validate: async () => { result = await resolveChoice(); return result !== null; } }, { label: 'Cancel', value: null }],
    onOpen: (o) => { api = o; if (mode === 'save') { fixExt(); const base = nameInput.value.length - P.extname(nameInput.value).length; nameInput.setSelectionRange(0, base); } else list.focus(); },
  });
  if (value !== 'ok') return null;
  ctx.storage.set('fileDialog.dir', dir);
  return result;
}
