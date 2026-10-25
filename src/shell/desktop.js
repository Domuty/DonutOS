// Desktop icons: the user's Desktop folder (plus the shared Public desktop) and the
// Recycle Bin, on a grid. Supports selection (click, Ctrl/Shift, rectangle), keyboard,
// drag and drop (move, into folders, onto the Recycle Bin, files from the real computer),
// inline rename and context menus.

import { h, mount } from '../ui/h.js';
import { showMenu } from '../ui/menu.js';
import { iconForEntry } from './file-icons.js';
import { appIconUrl } from './file-icons.js';
import { launchApp, openPath, openWith } from './apps.js';
import {
  fileClipboard, setFileClipboard, pasteInto, moveInto, trashPaths, deletePermanently, newFolder, newFile,
  renamePath, showProperties, importHostFiles, filesFromDataTransfer, hasHostFiles, DRAG_TYPE,
} from './file-ops.js';
import { confirmDialog } from '../ui/dialog.js';
import { debounce } from '../core/util.js';
import * as P from '../core/path.js';

const SIZES = { small: { w: 76, h: 74, icon: 32 }, medium: { w: 88, h: 96, icon: 48 }, large: { w: 108, h: 120, icon: 72 } };
const BIN = '::recyclebin';
const THUMB_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);

export class Desktop {
  constructor(session) {
    this.s = session;
    this.kernel = session.kernel;
    this.settings = session.settings;
    this.home = session.user.home;
    this.dir = P.join(this.home, 'Desktop');
    this.items = [];
    this.selected = new Set();
    this.anchor = null;
    this.thumbs = new Map();
    this.renaming = null;
    this.el = h('div.desktop', { tabindex: '0', role: 'listbox', 'aria-label': 'Desktop', 'aria-multiselectable': 'true' });
    this.band = h('div.desktop-band', { hidden: true });
    session.desktopLayer.append(this.el, this.band);

    this.refresh = debounce(() => this.load(), 80);
    this.offs = [
      this.kernel.bus.on('fs:changed', (e) => { if (this.relevant(e.dir) || this.relevant(e.fromDir) || this.relevant(e.path)) this.refresh(); }),
      this.kernel.bus.on('trash:changed', () => this.refresh()),
      this.kernel.bus.on('shell:fileClipboard', () => this.render()),
      this.settings.watch('desktop.*', (_, key) => { if (key !== 'desktop.iconPositions') this.render(); }),
    ];
    this.bind();
    this.load();
    this.onResize = debounce(() => this.render(), 100);
    window.addEventListener('resize', this.onResize);
  }

  relevant(p) { return p && (p === this.dir || p === '/Users/Public/Desktop'); }

  async load() {
    const read = async (dir, isPublic) => (await this.kernel.fs.readdir(dir).catch(() => [])).map((e) => ({ ...e, key: e.path, isPublic }));
    const [mine, pub, trash] = await Promise.all([read(this.dir, false), read('/Users/Public/Desktop', true), this.kernel.fs.listTrash(this.home)]);
    this.binFull = trash.length > 0;
    this.items = [{ key: BIN, name: 'Recycle Bin', type: 'bin' }, ...mine, ...pub.filter((p) => !mine.some((m) => m.name === p.name))];
    for (const k of [...this.selected]) if (!this.items.some((i) => i.key === k)) this.selected.delete(k);
    this.render();
  }

  // ── Layout ───────────────────────────────────────────────────────────
  cell() { return SIZES[this.settings.get('desktop.iconSize')] || SIZES.medium; }
  rows() { return Math.max(1, Math.floor((this.el.clientHeight - 8) / this.cell().h)); }

  sorted(items) {
    const by = this.settings.get('desktop.sortBy');
    const cmp = {
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
      size: (a, b) => (a.size || 0) - (b.size || 0),
      type: (a, b) => (a.type === b.type ? (a.ext || '').localeCompare(b.ext || '') || a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1),
      date: (a, b) => (b.mtime || 0) - (a.mtime || 0),
    }[by === 'none' ? 'name' : by];
    const [bin, ...rest] = items;
    return [bin, ...rest.sort(cmp)];
  }

  /** Assigns every item a grid cell: saved position if any (unless auto-arrange), else the next free one. */
  layout() {
    const rows = this.rows();
    const saved = this.settings.get('desktop.iconPositions');
    const auto = this.settings.get('desktop.autoArrange');
    const taken = new Set();
    const pos = new Map();
    const list = auto || this.settings.get('desktop.sortBy') !== 'none' ? this.sorted([...this.items]) : this.items;
    if (!auto) {
      for (const it of list) {
        const p = saved[it.key];
        if (p && p.r < rows && !taken.has(`${p.c},${p.r}`)) { pos.set(it.key, p); taken.add(`${p.c},${p.r}`); }
      }
    }
    let c = 0, r = 0;
    for (const it of list) {
      if (pos.has(it.key)) continue;
      while (taken.has(`${c},${r}`)) { r++; if (r >= rows) { r = 0; c++; } }
      pos.set(it.key, { c, r });
      taken.add(`${c},${r}`);
    }
    return pos;
  }

  render() {
    if (!this.el.isConnected) return;
    // Re-rendering would destroy the rename box; catch up once the rename finishes.
    if (this.renaming) { this.renderPending = true; return; }
    this.el.hidden = !this.settings.get('desktop.showIcons');
    const cell = this.cell();
    this.positions = this.layout();
    const cut = fileClipboard().mode === 'cut' ? new Set(fileClipboard().paths) : new Set();
    this.el.style.setProperty('--icon', `${cell.icon}px`);
    mount(this.el, this.items.map((it) => {
      const p = this.positions.get(it.key);
      const sel = this.selected.has(it.key);
      const btn = h('div.dicon', {
        role: 'option', tabindex: '-1', 'aria-selected': String(sel), draggable: 'true', title: it.type === 'bin' ? 'Recycle Bin' : it.name,
        class: [sel && 'selected', cut.has(it.key) && 'cut'], dataset: { key: it.key },
        style: { left: `${p.c * cell.w + 4}px`, top: `${p.r * cell.h + 4}px`, width: `${cell.w}px`, height: `${cell.h}px` },
      }, h('img', { src: this.iconFor(it), alt: '', draggable: 'false' }), h('span.dlabel', it.name));
      return btn;
    }));
    this.loadThumbs();
  }

  iconFor(it) {
    if (it.type === 'bin') return appIconUrl(this.binFull ? 'recyclebin-full' : 'recyclebin');
    return this.thumbs.get(`${it.path}|${it.mtime}`) || iconForEntry(it);
  }

  /** Small previews for images on the desktop, like a desktop OS shows. */
  async loadThumbs() {
    for (const it of this.items) {
      if (it.type !== 'file' || !THUMB_EXT.has(it.ext) || it.size > 8 * 1024 * 1024) continue;
      const key = `${it.path}|${it.mtime}`;
      if (this.thumbs.has(key)) continue;
      this.thumbs.set(key, iconForEntry(it));
      try {
        const blob = await this.kernel.fs.readBlob(it.path);
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        const s = 96 / Math.max(bmp.width, bmp.height);
        c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        this.thumbs.set(key, c.toDataURL('image/png'));
        const img = this.el.querySelector(`[data-key="${CSS.escape(it.key)}"] img`);
        if (img) { img.src = this.thumbs.get(key); img.classList.add('thumb'); }
      } catch { /* not decodable: keep the file-type icon */ }
    }
  }

  // ── Selection ────────────────────────────────────────────────────────
  select(keys, { add = false } = {}) {
    if (!add) this.selected.clear();
    for (const k of keys) this.selected.add(k);
    this.el.querySelectorAll('.dicon').forEach((d) => {
      const on = this.selected.has(d.dataset.key);
      d.classList.toggle('selected', on);
      d.setAttribute('aria-selected', String(on));
    });
  }

  selectedItems() { return this.items.filter((i) => this.selected.has(i.key)); }
  selectedPaths() { return this.selectedItems().filter((i) => i.type !== 'bin').map((i) => i.path); }
  itemFor(el) { return this.items.find((i) => i.key === el?.closest('.dicon')?.dataset.key); }

  // ── Events ───────────────────────────────────────────────────────────
  bind() {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      const icon = e.target.closest('.dicon');
      if (this.renaming && !e.target.closest('.drename')) this.renaming.commit();
      if (!icon) {
        if (e.button === 0) this.startBand(e);
        else if (!e.ctrlKey) this.select([]);
        return;
      }
      const key = icon.dataset.key;
      if (e.ctrlKey || e.metaKey) { if (e.button === 0) { if (this.selected.has(key)) this.selected.delete(key); else this.selected.add(key); this.select([], { add: true }); } }
      else if (e.shiftKey && this.anchor) this.selectRange(this.anchor, key);
      else if (!this.selected.has(key)) this.select([key]);
      if (!e.shiftKey) this.anchor = key;
      el.focus({ preventScroll: true });
    });
    el.addEventListener('click', (e) => {
      const icon = e.target.closest('.dicon');
      if (icon && !e.ctrlKey && !e.metaKey && !e.shiftKey && this.selected.size > 1 && !this.dragged) this.select([icon.dataset.key]);
      this.dragged = false;
    });
    el.addEventListener('dblclick', (e) => { const it = this.itemFor(e.target); if (it) this.open(it); });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const it = this.itemFor(e.target);
      if (it) this.itemMenu(it, e); else this.backgroundMenu(e);
    });
    el.addEventListener('keydown', (e) => this.onKey(e));

    // Drag and drop
    el.addEventListener('dragstart', (e) => {
      const it = this.itemFor(e.target);
      if (!it) return;
      if (!this.selected.has(it.key)) this.select([it.key]);
      this.dragKeys = [...this.selected];
      this.dragOrigin = { x: e.clientX, y: e.clientY };
      const paths = this.selectedPaths();
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
      e.dataTransfer.setData('text/plain', paths.join('\n'));
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    el.addEventListener('dragend', () => { this.dragKeys = null; this.clearDropHint(); });
    el.addEventListener('dragover', (e) => {
      const internal = e.dataTransfer.types.includes(DRAG_TYPE);
      if (!internal && !hasHostFiles(e.dataTransfer)) return;
      e.preventDefault();
      const target = this.itemFor(e.target);
      const intoTarget = target && (target.type === 'dir' || target.type === 'bin') && !this.dragKeys?.includes(target.key);
      this.clearDropHint();
      if (intoTarget) e.target.closest('.dicon').classList.add('drop-target');
      e.dataTransfer.dropEffect = !internal ? 'copy' : target?.type === 'bin' ? 'move' : e.ctrlKey ? 'copy' : 'move';
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) this.clearDropHint(); });
    el.addEventListener('drop', (e) => this.onDrop(e));
  }

  clearDropHint() { this.el.querySelectorAll('.drop-target').forEach((d) => d.classList.remove('drop-target')); }

  async onDrop(e) {
    e.preventDefault();
    this.clearDropHint();
    const target = this.itemFor(e.target);
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) {
      if (!hasHostFiles(e.dataTransfer)) return;
      const files = await filesFromDataTransfer(e.dataTransfer);
      const dest = target?.type === 'dir' ? target.path : this.dir;
      const created = await importHostFiles(this.kernel, dest, files);
      if (dest === this.dir) this.placeNew(created, e);
      return;
    }
    const paths = JSON.parse(raw);
    if (target?.type === 'bin') { await trashPaths(this.kernel, this.home, paths); return; }
    if (target?.type === 'dir' && !paths.includes(target.path)) { await moveInto(this.kernel, paths, target.path, { copy: e.ctrlKey }); return; }
    if (this.dragKeys) { this.moveIcons(this.dragKeys, e); return; }
    // Dropped from another place (an Explorer window): move/copy onto the desktop.
    const created = await moveInto(this.kernel, paths, this.dir, { copy: e.ctrlKey });
    this.placeNew(created, e);
  }

  /** Moves icons to the drop point, keeping their arrangement relative to each other. */
  moveIcons(keys, e) {
    if (this.settings.get('desktop.autoArrange')) return;
    const cell = this.cell();
    const rows = this.rows();
    const dc = Math.round((e.clientX - this.dragOrigin.x) / cell.w);
    const dr = Math.round((e.clientY - this.dragOrigin.y) / cell.h);
    if (!dc && !dr) return;
    const saved = { ...this.settings.get('desktop.iconPositions') };
    for (const [k, p] of this.positions) saved[k] = p; // freeze the current layout
    const moving = new Set(keys);
    const occupied = new Set([...this.positions].filter(([k]) => !moving.has(k)).map(([, p]) => `${p.c},${p.r}`));
    for (const k of keys) {
      const p = this.positions.get(k);
      let c = Math.max(0, p.c + dc), r = Math.max(0, Math.min(rows - 1, p.r + dr));
      while (occupied.has(`${c},${r}`)) { r++; if (r >= rows) { r = 0; c++; } }
      occupied.add(`${c},${r}`);
      saved[k] = { c, r };
    }
    this.dragged = true;
    if (this.settings.get('desktop.sortBy') !== 'none') this.settings.set('desktop.sortBy', 'none');
    this.settings.set('desktop.iconPositions', this.prune(saved));
    this.render();
  }

  /** Puts newly created items at the cell under the pointer (or the next free one). */
  placeNew(paths, e) {
    if (!paths.length || this.settings.get('desktop.autoArrange') || !e) return;
    const cell = this.cell();
    const r0 = this.el.getBoundingClientRect();
    const saved = { ...this.settings.get('desktop.iconPositions') };
    const used = new Set(Object.values(saved).map((p) => `${p.c},${p.r}`));
    if (this.positions) for (const p of this.positions.values()) used.add(`${p.c},${p.r}`);
    let c = Math.max(0, Math.floor((e.clientX - r0.left) / cell.w)), r = Math.max(0, Math.floor((e.clientY - r0.top) / cell.h));
    const rows = this.rows();
    for (const p of paths) {
      while (used.has(`${c},${r}`)) { r++; if (r >= rows) { r = 0; c++; } }
      saved[p] = { c, r };
      used.add(`${c},${r}`);
    }
    this.settings.set('desktop.iconPositions', this.prune(saved));
  }

  prune(saved) {
    const keys = new Set(this.items.map((i) => i.key));
    return Object.fromEntries(Object.entries(saved).filter(([k]) => keys.has(k) || k.startsWith(this.dir)));
  }

  startBand(e) {
    const r0 = this.el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const base = e.ctrlKey ? new Set(this.selected) : new Set();
    if (!e.ctrlKey) this.select([]);
    this.el.setPointerCapture(e.pointerId);
    let frame = 0, last = e;
    const move = (ev) => {
      last = ev;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const x1 = Math.min(sx, last.clientX), y1 = Math.min(sy, last.clientY), x2 = Math.max(sx, last.clientX), y2 = Math.max(sy, last.clientY);
        if (x2 - x1 < 3 && y2 - y1 < 3) return;
        Object.assign(this.band.style, { left: `${x1 - r0.left}px`, top: `${y1 - r0.top}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
        this.band.hidden = false;
        const hit = new Set(base);
        this.el.querySelectorAll('.dicon').forEach((d) => {
          const b = d.getBoundingClientRect();
          if (b.right > x1 && b.left < x2 && b.bottom > y1 && b.top < y2) hit.add(d.dataset.key);
        });
        this.select(hit);
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

  selectRange(fromKey, toKey) {
    const order = [...this.positions].sort(([, a], [, b]) => a.c - b.c || a.r - b.r).map(([k]) => k);
    const a = order.indexOf(fromKey), b = order.indexOf(toKey);
    this.select(order.slice(Math.min(a, b), Math.max(a, b) + 1));
  }

  onKey(e) {
    if (this.renaming) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const paths = this.selectedPaths();
    if (e.key === 'Enter') { e.preventDefault(); this.selectedItems().forEach((it) => this.open(it)); }
    else if (e.key === 'Delete') { e.preventDefault(); if (paths.length) (e.shiftKey ? deletePermanently(this.kernel, paths) : trashPaths(this.kernel, this.home, paths)); }
    else if (e.key === 'F2') { e.preventDefault(); const it = this.selectedItems().find((i) => i.type !== 'bin'); if (it) this.startRename(it); }
    else if (e.key === 'F5') { e.preventDefault(); this.load(); }
    else if (ctrl && e.code === 'KeyA') { e.preventDefault(); this.select(this.items.map((i) => i.key)); }
    else if (ctrl && e.code === 'KeyC' && paths.length) { e.preventDefault(); setFileClipboard(this.kernel, 'copy', paths); }
    else if (ctrl && e.code === 'KeyX' && paths.length) { e.preventDefault(); setFileClipboard(this.kernel, 'cut', paths); }
    else if (ctrl && e.code === 'KeyV') { e.preventDefault(); pasteInto(this.kernel, this.dir); }
    else if (ctrl && e.shiftKey && e.code === 'KeyN') { e.preventDefault(); this.createFolder(); }
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const cur = this.positions.get(this.anchor || [...this.selected][0] || BIN);
      if (!cur) return;
      const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      const want = { c: cur.c + d[0], r: cur.r + d[1] };
      let best = null, bestD = Infinity;
      for (const [k, p] of this.positions) {
        const dist = (p.c - want.c) ** 2 * 4 + (p.r - want.r) ** 2;
        const forward = (d[0] && Math.sign(p.c - cur.c) === d[0]) || (d[1] && Math.sign(p.r - cur.r) === d[1] && p.c === cur.c);
        if (forward && dist < bestD) { best = k; bestD = dist; }
      }
      if (best) { this.anchor = best; if (e.shiftKey) this.select([best], { add: true }); else this.select([best]); }
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────
  open(it) {
    if (it.type === 'bin') return launchApp(this.kernel, 'recyclebin');
    return openPath(this.kernel, it.path);
  }

  async createFolder(e) {
    const p = await newFolder(this.kernel, this.dir);
    this.placeNew([p], e);
    await this.load();
    const it = this.items.find((i) => i.key === p);
    if (it) { this.select([p]); this.startRename(it); }
  }

  async createFile(e, base, content) {
    const p = await newFile(this.kernel, this.dir, base, content);
    this.placeNew([p], e);
    await this.load();
    const it = this.items.find((i) => i.key === p);
    if (it) { this.select([p]); this.startRename(it, true); }
  }

  startRename(it, stemOnly = true) {
    const node = this.el.querySelector(`[data-key="${CSS.escape(it.key)}"]`);
    if (!node) return;
    const label = node.querySelector('.dlabel');
    const ta = h('textarea.drename', { value: it.name, rows: 2, spellcheck: false, 'aria-label': 'New name' });
    label.replaceWith(ta);
    node.draggable = false;
    ta.focus();
    const dot = it.type === 'file' && stemOnly ? it.name.lastIndexOf('.') : -1;
    ta.setSelectionRange(0, dot > 0 ? dot : it.name.length);
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      this.renaming = null;
      this.renderPending = false;
      const value = ta.value.replace(/\n/g, '').trim();
      if (save && value && value !== it.name) {
        const saved = this.settings.get('desktop.iconPositions');
        const newPath = await renamePath(this.kernel, it.path, value);
        if (newPath && saved[it.path]) {
          const next = { ...saved, [newPath]: saved[it.path] };
          delete next[it.path];
          this.settings.set('desktop.iconPositions', next);
        }
        if (newPath) this.selected = new Set([newPath]);
      }
      this.render();
      this.el.focus({ preventScroll: true });
    };
    this.renaming = { commit: () => finish(true) };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    ta.addEventListener('blur', () => finish(true));
  }

  itemMenu(it, e) {
    if (!this.selected.has(it.key)) this.select([it.key]);
    if (it.type === 'bin') {
      showMenu([
        { label: 'Open', icon: 'folder', onSelect: () => this.open(it) },
        { label: 'Empty Recycle Bin', icon: 'trash', disabled: !this.binFull, onSelect: async () => {
          if (await confirmDialog('Empty the Recycle Bin?', 'Everything in the Recycle Bin will be permanently deleted.', { ok: 'Empty', danger: true })) await this.kernel.fs.emptyTrash(this.home);
        } },
      ], { x: e.clientX, y: e.clientY });
      return;
    }
    const paths = this.selectedPaths();
    const multi = paths.length > 1;
    showMenu([
      { label: 'Open', icon: 'arrowRight', onSelect: () => this.selectedItems().forEach((i) => this.open(i)) },
      ...(it.type === 'file' && !multi ? [{ label: 'Open with…', icon: 'apps', onSelect: () => openWith(this.kernel, it.path) }] : []),
      { separator: true },
      { label: 'Cut', icon: 'cut', hint: 'Ctrl+X', onSelect: () => setFileClipboard(this.kernel, 'cut', paths) },
      { label: 'Copy', icon: 'copy', hint: 'Ctrl+C', onSelect: () => setFileClipboard(this.kernel, 'copy', paths) },
      ...(it.type === 'dir' && fileClipboard().paths.length ? [{ label: 'Paste into folder', icon: 'paste', onSelect: () => pasteInto(this.kernel, it.path) }] : []),
      { label: 'Copy as path', icon: 'clipboard', onSelect: () => { navigator.clipboard.writeText(paths.join('\n')); this.kernel.clipboard.record(paths.join('\n')); } },
      { label: 'Export to this computer', icon: 'download', disabled: multi || it.type !== 'file', onSelect: async () => this.kernel.platform.host.exportFile(it.name, await this.kernel.fs.readFile(it.path), it.mime) },
      { separator: true },
      { label: 'Rename', icon: 'edit', hint: 'F2', disabled: multi, onSelect: () => this.startRename(it) },
      { label: 'Delete', icon: 'trash', hint: 'Del', onSelect: () => trashPaths(this.kernel, this.home, paths) },
      { separator: true },
      { label: 'Properties', icon: 'info', disabled: multi, onSelect: () => showProperties(this.kernel, it.path) },
    ], { x: e.clientX, y: e.clientY });
  }

  backgroundMenu(e) {
    const s = this.settings;
    const size = s.get('desktop.iconSize');
    const by = s.get('desktop.sortBy');
    const sortBy = (v) => { s.set('desktop.iconPositions', {}); s.set('desktop.sortBy', v); };
    const newFiles = this.kernel.registry.list({ includeHidden: true }).flatMap((a) => (a.newFiles || []).map((n) => ({ ...n, app: a })));
    showMenu([
      { header: 'View' },
      { label: 'Large icons', checked: size === 'large', onSelect: () => s.set('desktop.iconSize', 'large') },
      { label: 'Medium icons', checked: size === 'medium', onSelect: () => s.set('desktop.iconSize', 'medium') },
      { label: 'Small icons', checked: size === 'small', onSelect: () => s.set('desktop.iconSize', 'small') },
      { label: 'Auto arrange icons', checked: s.get('desktop.autoArrange'), onSelect: () => s.set('desktop.autoArrange', !s.get('desktop.autoArrange')) },
      { label: 'Show desktop icons', checked: s.get('desktop.showIcons'), onSelect: () => s.set('desktop.showIcons', !s.get('desktop.showIcons')) },
      { header: 'Sort by' },
      { label: 'Name', checked: by === 'name', onSelect: () => sortBy('name') },
      { label: 'Size', checked: by === 'size', onSelect: () => sortBy('size') },
      { label: 'Item type', checked: by === 'type', onSelect: () => sortBy('type') },
      { label: 'Date modified', checked: by === 'date', onSelect: () => sortBy('date') },
      { separator: true },
      { label: 'Refresh', icon: 'refresh', hint: 'F5', onSelect: () => this.load() },
      { label: 'Paste', icon: 'paste', hint: 'Ctrl+V', disabled: !fileClipboard().paths.length, onSelect: () => pasteInto(this.kernel, this.dir) },
      { separator: true },
      { header: 'New' },
      { label: 'Folder', icon: 'newFolder', onSelect: () => this.createFolder(e) },
      { label: 'Text document', icon: 'file', onSelect: () => this.createFile(e, 'New text document.txt', '') },
      ...newFiles.map((n) => ({ label: n.label, icon: n.app.icon, onSelect: () => this.createFile(e, `New ${n.label.toLowerCase()}${n.ext}`, n.template || '') })),
      { label: 'Import from this computer…', icon: 'upload', onSelect: async () => this.placeNew(await importHostFiles(this.kernel, this.dir, await this.kernel.platform.host.importFiles({ multiple: true })), e) },
      { separator: true },
      { label: 'Display settings', icon: 'monitor', onSelect: () => launchApp(this.kernel, 'settings', { page: 'display' }) },
      { label: 'Personalize', icon: 'palette', onSelect: () => launchApp(this.kernel, 'settings', { page: 'background' }) },
    ], { x: e.clientX, y: e.clientY });
  }

  destroy() {
    this.offs.forEach((f) => f());
    window.removeEventListener('resize', this.onResize);
  }
}
