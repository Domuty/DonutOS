// The item area of a File Explorer tab: details, list, tiles and icon views, selection
// (click, Ctrl/Shift, rubber band, keyboard), inline rename, drag and drop, context menus.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { iconForEntry, typeName } from '../../shell/file-icons.js';
import { canThumb, thumbnail } from '../../shell/thumbs.js';
import { DRAG_TYPE, hasHostFiles } from '../../shell/file-ops.js';
import { formatBytes } from '../../core/util.js';

const fmtDate = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '');

export const VIEWS = [
  ['details', 'Details', 'sort'], ['list', 'List', 'view'], ['tiles', 'Tiles', 'apps'],
  ['medium', 'Medium icons', 'view'], ['large', 'Large icons', 'image'],
];

export class FolderView {
  constructor(ex) {
    this.ex = ex;
    this.el = h('div.ex-items', { tabindex: '0', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Items' });
    this.band = h('div.ex-band', { hidden: true });
    this.wrap = h('div.ex-items-wrap', this.el, this.band);
    this.entries = [];
    this.selected = new Set();
    this.anchor = null;
    this.focusPath = null;
    this.renaming = null;
    this.bind();
  }

  get tab() { return this.ex.tab; }

  /** Renders `entries` (already sorted/filtered) in the given view. `extraColumn` shows Location for search. */
  render(entries, { view, extraColumn = false, emptyText = 'This folder is empty.' } = {}) {
    if (this.renaming) { this.pending = [entries, { view, extraColumn, emptyText }]; return; }
    this.entries = entries;
    this.view = view;
    this.extra = extraColumn;
    for (const p of [...this.selected]) if (!entries.some((e) => e.path === p)) this.selected.delete(p);
    this.el.className = `ex-items view-${view}`;
    const cut = this.ex.cutSet();
    const rows = entries.map((e, i) => this.item(e, i, cut));
    if (view === 'details') {
      const sort = this.tab.sort;
      const col = (key, label, cls) => h(`button.ex-col.${cls}`, { type: 'button', onclick: () => this.ex.setSort(key) }, label,
        sort.key === key ? icon(sort.dir > 0 ? 'chevronUp' : 'chevronDown', { size: 12 }) : null);
      mount(this.el, h('div.ex-head', col('name', 'Name', 'c-name'), extraColumn ? col('location', 'Location', 'c-loc') : null, col('date', 'Date modified', 'c-date'), col('type', 'Type', 'c-type'), col('size', 'Size', 'c-size')),
        rows.length ? rows : h('div.ex-empty', emptyText));
    } else {
      mount(this.el, rows.length ? rows : h('div.ex-empty', emptyText));
    }
    this.loadThumbs();
  }

  item(e, i, cut) {
    const sel = this.selected.has(e.path);
    const img = h('img', { src: iconForEntry(e), alt: '', draggable: 'false' });
    const name = h('span.ex-name', this.ex.displayName(e));
    const common = {
      role: 'option', draggable: 'true', title: e.name, 'aria-selected': String(sel),
      class: [sel && 'selected', cut.has(e.path) && 'cut', e.name.startsWith('.') && 'hidden-item'], dataset: { path: e.path, idx: i },
    };
    if (this.view === 'details') {
      return h('div.ex-row', common, h('span.c-name', img, name),
        this.extra ? h('span.c-loc', this.ex.prettyPath(e.path.slice(0, e.path.lastIndexOf('/')) || '/')) : null,
        h('span.c-date', fmtDate(e.mtime)), h('span.c-type', typeName(e)), h('span.c-size', e.type === 'dir' ? '' : formatBytes(e.size)));
    }
    if (this.view === 'tiles') {
      return h('div.ex-tile', common, img, h('span.ex-tile-text', name, h('small', typeName(e)), e.type === 'file' ? h('small', formatBytes(e.size)) : null));
    }
    return h('div.ex-icon', common, img, name);
  }

  async loadThumbs() {
    if (!['tiles', 'medium', 'large'].includes(this.view)) return;
    const size = this.view === 'large' ? 160 : 96;
    for (const e of this.entries) {
      if (!canThumb(e)) continue;
      const url = await thumbnail(this.ex.k.fs, e, size);
      const img = url && this.el.querySelector(`[data-path="${CSS.escape(e.path)}"] img`);
      if (img) { img.src = url; img.classList.add('thumb'); }
    }
  }

  // ── Selection ────────────────────────────────────────────────────────
  setSelection(paths, { add = false, focus } = {}) {
    if (!add) this.selected.clear();
    for (const p of paths) this.selected.add(p);
    if (focus) this.focusPath = focus;
    for (const n of this.el.querySelectorAll('[data-path]')) {
      const on = this.selected.has(n.dataset.path);
      n.classList.toggle('selected', on);
      n.setAttribute('aria-selected', String(on));
      n.classList.toggle('focused', n.dataset.path === this.focusPath);
    }
    this.ex.selectionChanged();
  }

  selectedEntries() { return this.entries.filter((e) => this.selected.has(e.path)); }
  entryFor(node) { const p = node?.closest?.('[data-path]')?.dataset.path; return p ? this.entries.find((e) => e.path === p) : null; }

  // ── Events ───────────────────────────────────────────────────────────
  bind() {
    const ctx = this.ex.ctx;
    ctx.listen(this.el, 'pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      if (this.renaming && !e.target.closest('.ex-rename')) this.renaming.commit();
      const entry = this.entryFor(e.target);
      if (!entry) {
        if (e.target.closest('.ex-head')) return;
        if (e.button === 0) this.startBand(e); else if (!e.ctrlKey) this.setSelection([]);
        return;
      }
      const p = entry.path;
      if ((e.ctrlKey || e.metaKey) && e.button === 0) { if (this.selected.has(p)) this.selected.delete(p); else this.selected.add(p); this.setSelection([], { add: true, focus: p }); }
      else if (e.shiftKey && this.anchor) this.selectRange(this.anchor, p);
      else if (!this.selected.has(p)) this.setSelection([p], { focus: p });
      if (!e.shiftKey) this.anchor = p;
      this.el.focus({ preventScroll: true });
    });
    ctx.listen(this.el, 'click', (e) => {
      const entry = this.entryFor(e.target);
      if (entry && !e.ctrlKey && !e.metaKey && !e.shiftKey && this.selected.size > 1) this.setSelection([entry.path], { focus: entry.path });
    });
    ctx.listen(this.el, 'dblclick', (e) => { const entry = this.entryFor(e.target); if (entry) this.ex.openEntry(entry); });
    ctx.listen(this.el, 'auxclick', (e) => { const entry = this.entryFor(e.target); if (e.button === 1 && entry?.type === 'dir') this.ex.newTab(entry.path); });
    ctx.listen(this.el, 'contextmenu', (e) => {
      e.preventDefault();
      const entry = this.entryFor(e.target);
      if (entry) { if (!this.selected.has(entry.path)) this.setSelection([entry.path], { focus: entry.path }); this.ex.itemMenu(e); }
      else this.ex.backgroundMenu(e);
    });
    ctx.listen(this.el, 'keydown', (e) => this.onKey(e));

    // Drag out (to folders, the desktop, other windows — or the real computer in Chromium).
    ctx.listen(this.el, 'dragstart', (e) => {
      const entry = this.entryFor(e.target);
      if (!entry) return;
      if (!this.selected.has(entry.path)) this.setSelection([entry.path], { focus: entry.path });
      const paths = [...this.selected];
      this.dragging = paths;
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
      e.dataTransfer.setData('text/plain', paths.join('\n'));
      e.dataTransfer.effectAllowed = 'copyMove';
      this.ex.prepareHostDrag(e, paths);
    });
    ctx.listen(this.el, 'dragend', () => { this.dragging = null; this.clearDrop(); });
    ctx.listen(this.el, 'dragover', (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE) && !hasHostFiles(e.dataTransfer)) return;
      const target = this.entryFor(e.target);
      const folder = target?.type === 'dir' && !this.dragging?.includes(target.path) ? target : null;
      if (!folder && !this.ex.canDropHere()) return;
      e.preventDefault();
      this.clearDrop();
      if (folder) e.target.closest('[data-path]').classList.add('drop-target');
      e.dataTransfer.dropEffect = hasHostFiles(e.dataTransfer) || e.ctrlKey ? 'copy' : 'move';
    });
    ctx.listen(this.el, 'dragleave', (e) => { if (!this.el.contains(e.relatedTarget)) this.clearDrop(); });
    ctx.listen(this.el, 'drop', (e) => {
      const target = this.entryFor(e.target);
      this.clearDrop();
      const dir = target?.type === 'dir' ? target.path : this.ex.currentDir();
      if (!dir) return;
      e.preventDefault();
      if (this.dragging && !target) return; // dropped back where it came from
      this.ex.dropInto(dir, e);
    });
  }

  clearDrop() { this.el.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target')); }

  startBand(e) {
    const r0 = this.wrap.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY + this.el.scrollTop;
    const base = e.ctrlKey ? new Set(this.selected) : new Set();
    if (!e.ctrlKey) this.setSelection([]);
    this.el.setPointerCapture(e.pointerId);
    let frame = 0, last = e;
    const move = (ev) => {
      last = ev;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const cy = last.clientY + this.el.scrollTop;
        const x1 = Math.min(sx, last.clientX), x2 = Math.max(sx, last.clientX), y1 = Math.min(sy, cy), y2 = Math.max(sy, cy);
        if (x2 - x1 < 4 && y2 - y1 < 4) return;
        Object.assign(this.band.style, { left: `${x1 - r0.left}px`, top: `${y1 - this.el.scrollTop - r0.top}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
        this.band.hidden = false;
        const hit = new Set(base);
        for (const n of this.el.querySelectorAll('[data-path]')) {
          const b = n.getBoundingClientRect();
          const top = b.top + this.el.scrollTop, bottom = b.bottom + this.el.scrollTop;
          const left = this.view === 'details' ? b.left : b.left;
          const right = this.view === 'details' ? Math.min(b.right, b.left + 320) : b.right;
          if (right > x1 && left < x2 && bottom > y1 && top < y2) hit.add(n.dataset.path);
        }
        this.setSelection(hit);
      });
    };
    const up = () => {
      cancelAnimationFrame(frame);
      this.band.hidden = true;
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', up);
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
  }

  selectRange(from, to) {
    const order = this.entries.map((e) => e.path);
    const a = order.indexOf(from), b = order.indexOf(to);
    if (a < 0 || b < 0) { this.setSelection([to], { focus: to }); return; }
    this.setSelection(order.slice(Math.min(a, b), Math.max(a, b) + 1), { focus: to });
  }

  /** How many items fit on one row (for Up/Down in icon views). */
  perRow() {
    const items = [...this.el.querySelectorAll('[data-path]')];
    if (items.length < 2 || this.view === 'details') return 1;
    const top = items[0].offsetTop;
    const n = items.findIndex((x) => x.offsetTop !== top);
    return n < 0 ? items.length : n;
  }

  onKey(e) {
    if (this.renaming || e.target.closest('input, textarea')) return;
    const ex = this.ex;
    const ctrl = e.ctrlKey || e.metaKey;
    const list = this.entries;
    const idx = Math.max(0, list.findIndex((x) => x.path === this.focusPath));
    const move = (to) => {
      if (!list.length) return;
      const i = Math.max(0, Math.min(list.length - 1, to));
      const p = list[i].path;
      if (e.shiftKey) this.selectRange(this.anchor || p, p);
      else { this.setSelection([p], { focus: p }); this.anchor = p; }
      this.el.querySelector(`[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    const keys = {
      ArrowDown: () => move(this.focusPath ? idx + (this.view === 'list' ? 1 : this.perRow()) : 0),
      ArrowUp: () => move(idx - (this.view === 'list' ? 1 : this.perRow())),
      ArrowRight: () => (this.view === 'details' ? null : move(idx + 1)),
      ArrowLeft: () => (this.view === 'details' ? null : move(idx - 1)),
      Home: () => move(0), End: () => move(list.length - 1),
      Enter: () => this.selectedEntries().forEach((x) => ex.openEntry(x)),
      Delete: () => ex.deleteSelected(e.shiftKey),
      F2: () => { const s = this.selectedEntries()[0]; if (s) this.startRename(s); },
    };
    if (keys[e.key] && !ctrl) { e.preventDefault(); keys[e.key](); return; }
    if (ctrl && e.code === 'KeyA') { e.preventDefault(); this.setSelection(list.map((x) => x.path)); return; }
    // Type to jump to an item by name.
    if (e.key.length === 1 && !ctrl && !e.altKey && /\S/.test(e.key)) {
      const now = Date.now();
      this.typed = now - (this.typedAt || 0) < 900 ? this.typed + e.key.toLowerCase() : e.key.toLowerCase();
      this.typedAt = now;
      const hit = list.findIndex((x) => x.name.toLowerCase().startsWith(this.typed));
      if (hit >= 0) move(hit);
    }
  }

  startRename(entry) {
    const node = this.el.querySelector(`[data-path="${CSS.escape(entry.path)}"]`);
    const label = node?.querySelector('.ex-name');
    if (!label) return;
    const input = h(this.view === 'details' || this.view === 'list' || this.view === 'tiles' ? 'input.ex-rename' : 'textarea.ex-rename', { value: entry.name, spellcheck: false, 'aria-label': 'New name', rows: 2 });
    label.replaceWith(input);
    node.draggable = false;
    input.focus();
    const dot = entry.type === 'file' ? entry.name.lastIndexOf('.') : -1;
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const value = input.value.replace(/\n/g, '').trim();
      if (save && value && value !== entry.name) {
        const np = await this.ex.renameEntry(entry, value);
        if (np) { this.selected = new Set([np]); this.focusPath = np; }
      }
      this.renaming = null;
      if (this.pending) { const [es, opts] = this.pending; this.pending = null; this.render(es, opts); } else this.ex.refresh();
      this.el.focus({ preventScroll: true });
    };
    this.renaming = { commit: () => finish(true) };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }
}
