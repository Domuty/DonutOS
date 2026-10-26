// Recycle Bin: everything deleted from your folders, with restore and permanent delete.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { showMenu } from '../../ui/menu.js';
import { confirmDialog, alertDialog } from '../../ui/dialog.js';
import { formatBytes } from '../../core/util.js';
import { iconForEntry } from '../../shell/file-icons.js';
import { extname, dirname } from '../../core/path.js';
import { kindFor } from '../../core/mime.js';

export default function main(ctx) {
  const k = ctx.privileged;
  const home = ctx.fs.home();
  const win = ctx.windows.create({ title: 'Recycle Bin' });
  let items = [];
  let selected = new Set();
  let sort = { key: 'deletedAt', dir: -1 };

  const toolbar = h('div.app-toolbar');
  const table = h('div.rb-table', { role: 'grid', 'aria-label': 'Deleted items', tabindex: '0' });
  const status = h('div.app-status');
  mount(win.body, toolbar, h('div.app-content', table), status);

  const selItems = () => items.filter((i) => selected.has(i.id));

  async function restore(list) {
    for (const it of list) {
      try { await k.fs.restoreFromTrash(home, it.id); } catch (err) { await alertDialog('Couldn’t restore', `${it.name}: ${err.message}`); }
    }
  }
  async function remove(list) {
    const what = list.length === 1 ? `“${list[0].name}”` : `these ${list.length} items`;
    if (!(await confirmDialog('Delete permanently?', `Are you sure you want to permanently delete ${what}?`, { ok: 'Delete', danger: true }))) return;
    for (const it of list) await k.fs.deleteFromTrash(home, it.id);
  }
  async function emptyBin() {
    if (!items.length) return;
    if (await confirmDialog('Empty the Recycle Bin?', `All ${items.length} item${items.length === 1 ? '' : 's'} will be permanently deleted.`, { ok: 'Empty Recycle Bin', danger: true })) await k.fs.emptyTrash(home);
  }

  function render() {
    const sel = selItems();
    mount(toolbar,
      h('button.btn.subtle', { type: 'button', disabled: !items.length, onclick: emptyBin }, icon('trash', { size: 16 }), 'Empty Recycle Bin'),
      h('button.btn.subtle', { type: 'button', disabled: !items.length, onclick: () => restore(items) }, icon('restart', { size: 16 }), 'Restore all items'),
      h('button.btn.subtle', { type: 'button', disabled: !sel.length, onclick: () => restore(sel) }, icon('upload', { size: 16 }), 'Restore selected'),
      h('button.btn.subtle', { type: 'button', disabled: !sel.length, onclick: () => remove(sel) }, icon('close', { size: 16 }), 'Delete'));
    const sorted = [...items].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir;
    });
    const head = (key, label) => h('div', { role: 'columnheader', 'aria-sort': sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
      h('button.rb-th', { type: 'button', onclick: () => { sort = { key, dir: sort.key === key ? -sort.dir : 1 }; render(); } },
        label, sort.key === key ? icon(sort.dir > 0 ? 'chevronUp' : 'chevronDown', { size: 12 }) : null));
    table.setAttribute('role', sorted.length ? 'grid' : 'group');
    mount(table,
      sorted.length ? h('div.rb-row.rb-head', { role: 'row' }, head('name', 'Name'), head('originalPath', 'Original location'), head('deletedAt', 'Date deleted'), head('size', 'Size')) : null,
      sorted.length ? sorted.map((it) => {
        const entry = { type: it.type, name: it.name, ext: extname(it.name), kind: kindFor(extname(it.name)) };
        return h('div.rb-row', {
          role: 'row', class: selected.has(it.id) && 'selected', 'aria-selected': String(selected.has(it.id)), dataset: { id: it.id },
          onclick: (e) => {
            if (e.ctrlKey || e.metaKey) { if (selected.has(it.id)) selected.delete(it.id); else selected.add(it.id); }
            else selected = new Set([it.id]);
            render();
          },
          ondblclick: () => restore([it]),
          oncontextmenu: (e) => {
            e.preventDefault();
            if (!selected.has(it.id)) { selected = new Set([it.id]); render(); }
            showMenu([
              { label: 'Restore', icon: 'restart', onSelect: () => restore(selItems()) },
              { label: 'Delete permanently', icon: 'trash', danger: true, onSelect: () => remove(selItems()) },
            ], { x: e.clientX, y: e.clientY });
          },
        },
        h('span.rb-name', { role: 'gridcell' }, h('img', { src: iconForEntry(entry), alt: '' }), it.name),
        h('span', { role: 'gridcell' }, dirname(it.originalPath).replace(home, 'Home')),
        h('span', { role: 'gridcell' }, new Date(it.deletedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })),
        h('span', { role: 'gridcell' }, it.type === 'dir' ? `${formatBytes(it.size)} (folder)` : formatBytes(it.size)));
      }) : h('div.empty-state', icon('trash', { size: 48 }), h('b', 'The Recycle Bin is empty'), h('p', 'Things you delete from your folders and desktop go here until you empty it.')));
    const total = items.reduce((n, i) => n + (i.size || 0), 0);
    mount(status, h('span', `${items.length} item${items.length === 1 ? '' : 's'}`), selected.size ? h('span', `${selected.size} selected`) : null, h('span', formatBytes(total)));
    win.setTitle(items.length ? `Recycle Bin (${items.length})` : 'Recycle Bin');
    win.setIcon(`assets/icons/apps/${items.length ? 'recyclebin-full' : 'recyclebin'}.svg`);
  }

  async function load() {
    items = await k.fs.listTrash(home);
    selected = new Set([...selected].filter((id) => items.some((i) => i.id === id)));
    render();
  }

  ctx.listen(table, 'keydown', (e) => {
    if (e.key === 'Delete') { const s = selItems(); if (s.length) remove(s); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') { e.preventDefault(); selected = new Set(items.map((i) => i.id)); render(); }
    else if (e.key === 'Enter') { const s = selItems(); if (s.length) restore(s); }
  });
  ctx.bus.on('trash:changed', load);
  ctx.onActivate(() => win.focus());
  load();
}
