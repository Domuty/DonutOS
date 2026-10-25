// Window snapping: drag a window to an edge or corner, pick a layout from the maximize
// button (or Win+Z), fill the rest of the screen with Snap Assist, keep snapped windows
// together as a snap group (resizing the shared edge resizes the neighbours), shake a
// title bar to minimise everything else, and Win+Arrow keyboard snapping.
//
// Snapped positions are stored as fractions of the work area, so they survive the
// screen (or browser window) changing size.

import { h, mount } from '../ui/h.js';
import { uid as makeId } from '../core/util.js';

export const ZONES = {
  left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1],
  tl: [0, 0, 0.5, 0.5], tr: [0.5, 0, 0.5, 0.5], bl: [0, 0.5, 0.5, 0.5], br: [0.5, 0.5, 0.5, 0.5],
};

export const LAYOUTS = [
  [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
  [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
  [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  [[0, 0, 0.25, 1], [0.25, 0, 0.5, 1], [0.75, 0, 0.25, 1]],
];

const EDGE = 8;        // px from the screen edge that triggers a snap
const CORNER = 90;     // px along an edge that counts as a corner

export function fracToRect([fx, fy, fw, fh], a) {
  const x = Math.round(a.x + fx * a.w), y = Math.round(a.y + fy * a.h);
  return { x, y, w: Math.round(a.x + (fx + fw) * a.w) - x, h: Math.round(a.y + (fy + fh) * a.h) - y };
}

export function rectToFrac(r, a) {
  return [(r.x - a.x) / a.w, (r.y - a.y) / a.h, r.w / a.w, r.h / a.h];
}

/** Which snap zone a pointer position is in, or null. */
export function zoneAt(x, y, a) {
  const left = x <= a.x + EDGE, right = x >= a.x + a.w - EDGE, top = y <= a.y + EDGE;
  if ((left && y < a.y + CORNER) || (top && x < a.x + CORNER)) return 'tl';
  if ((right && y < a.y + CORNER) || (top && x > a.x + a.w - CORNER)) return 'tr';
  if (left && y > a.y + a.h - CORNER) return 'bl';
  if (right && y > a.y + a.h - CORNER) return 'br';
  if (left) return 'left';
  if (right) return 'right';
  if (top) return 'max';
  return null;
}

const same = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 0.002);
const zoneName = (frac) => Object.keys(ZONES).find((k) => same(ZONES[k], frac)) || null;

export class Snapper {
  constructor(wm) {
    this.wm = wm;
    this.groups = new Map();   // groupId -> Set<AppWindow>
    this.preview = h('div.snap-preview', { hidden: true });
    this.layouts = h('div.snap-layouts.acrylic', { hidden: true, onpointerenter: () => clearTimeout(this.layoutTimer), onpointerleave: () => this.hideLayoutsSoon() });
    this.assist = null;
    this.shaken = null;
    wm.layer.append(this.preview, this.layouts);
  }

  setting(key) { try { return this.wm.kernel.settings.get(key, this.wm.uid); } catch { return true; } }

  // ── Dragging ─────────────────────────────────────────────────────────
  dragStart(win) {
    this.zone = null;
    this.samples = [];
    this.dragFrom = win.snap ? null : { ...win.bounds };
    this.endAssist();
    this.hideLayouts();
  }

  dragMove(win, ev) {
    if (!this.setting('wm.snapEnabled') || !win.opts.resizable) return;
    const a = this.wm.workArea();
    const zone = zoneAt(ev.clientX, ev.clientY, a);
    if (zone === this.zone) return;
    this.zone = zone;
    if (!zone) { this.preview.hidden = true; return; }
    const r = zone === 'max' ? { x: a.x, y: a.y, w: a.w, h: a.h } : fracToRect(ZONES[zone], a);
    const first = this.preview.hidden;
    this.preview.hidden = false;
    // Grow the preview out of the pointer the first time, then glide between zones.
    if (first) Object.assign(this.preview.style, { transition: 'none', left: `${ev.clientX - 20}px`, top: `${ev.clientY - 20}px`, width: '40px', height: '40px', zIndex: String(this.wm.z + 1) });
    requestAnimationFrame(() => {
      Object.assign(this.preview.style, { transition: '', left: `${r.x + 6}px`, top: `${r.y + 6}px`, width: `${r.w - 12}px`, height: `${r.h - 12}px` });
    });
  }

  dragEnd(win) {
    this.preview.hidden = true;
    const zone = this.zone;
    this.zone = null;
    if (!zone) return;
    // Un-snapping later returns the window to where it was before this drag.
    if (zone === 'max') { win.maximize(); if (this.dragFrom) win.prevBounds = this.dragFrom; return; }
    this.snap(win, ZONES[zone], { assist: true, preSnap: this.dragFrom });
  }

  /** Shaking a title bar left-right minimises every other window; shaking again restores them. */
  detectShake(win, ev) {
    if (!this.setting('wm.shakeToMinimize')) return;
    const now = performance.now();
    this.samples = (this.samples || []).filter((s) => now - s.t < 700);
    this.samples.push({ x: ev.clientX, t: now });
    let turns = 0, dir = 0, last = this.samples[0]?.x, span = 0;
    for (const s of this.samples) {
      const d = Math.sign(s.x - last);
      if (d && Math.abs(s.x - last) > 4) { if (dir && d !== dir) turns++; dir = d; last = s.x; }
      span = Math.max(span, Math.abs(s.x - this.samples[0].x));
    }
    if (turns >= 4 && span > 30 && (!this.lastShake || now - this.lastShake > 1200)) {
      this.lastShake = now;
      this.samples = [];
      this.toggleOthers(win);
    }
  }

  toggleOthers(win) {
    if (this.shaken?.length) {
      for (const w of this.shaken) if (this.wm.windows.has(w.id)) w.restore();
      this.shaken = null;
      this.wm.focus(win);
      return;
    }
    this.shaken = this.wm.visibleWindows().filter((w) => w !== win && w.state !== 'minimized');
    for (const w of this.shaken) w.minimize();
  }

  // ── Snapping ─────────────────────────────────────────────────────────
  snap(win, frac, { assist = false, group = null, animate = true, preSnap = null } = {}) {
    if (!win.opts.resizable) return;
    if (win.state === 'minimized') win.restore();
    let from = { ...win.bounds };
    if (win.state === 'maximized') {
      win.state = 'normal';
      win.el.classList.remove('maximized');
      win.updateMaxIcon();
      if (!win.snap) win.preSnap = win.prevBounds ? { ...win.prevBounds } : null;
    } else if (!win.snap) {
      win.preSnap = { ...win.bounds };
    }
    if (preSnap) win.preSnap = { ...preSnap };
    this.leave(win, { keepSnap: true });
    const a = this.wm.workArea();
    win.snap = { frac: [...frac], group: null };
    win.el.classList.add('snapped');
    win.bounds = fracToRect(frac, a);
    win.apply();
    if (animate) win.morphFrom(from);
    from = null;
    win.emit('state', 'snapped');
    win.emit('resize', win.getBounds());
    if (group) this.join(win, group);
    this.wm.focus(win);
    this.wm.changed(win);
    if (assist && this.setting('wm.snapAssist')) this.assistFor(win, frac);
  }

  /** Restores a snapped window to the size it had before snapping. */
  unsnap(win, { animate = true } = {}) {
    if (!win.snap) return;
    const from = { ...win.bounds };
    this.leave(win);
    if (win.preSnap) win.setBounds(win.preSnap); else win.center();
    if (animate) win.morphFrom(from);
    this.wm.changed(win);
  }

  /** Called when a snapped window starts being dragged: it takes its old size, under the pointer. */
  release(win, pointerX) {
    if (!win.snap) return null;
    const ratio = (pointerX - win.bounds.x) / win.bounds.w;
    const size = win.preSnap || { w: win.opts.width, h: win.opts.height };
    this.leave(win);
    return { x: pointerX - size.w * ratio, y: win.bounds.y, w: size.w, h: size.h };
  }

  leave(win, { keepSnap = false } = {}) {
    const gid = win.snap?.group;
    if (gid && this.groups.has(gid)) {
      const g = this.groups.get(gid);
      g.delete(win);
      if (g.size < 2) { for (const w of g) if (w.snap) w.snap.group = null; this.groups.delete(gid); }
    }
    if (!keepSnap) {
      win.snap = null;
      win.el.classList.remove('snapped');
    } else if (win.snap) win.snap.group = null;
  }

  join(win, gid) {
    if (!this.setting('wm.snapGroups')) return;
    if (!this.groups.has(gid)) this.groups.set(gid, new Set());
    this.groups.get(gid).add(win);
    win.snap.group = gid;
  }

  groupOf(win) {
    const gid = win?.snap?.group;
    return gid && this.groups.has(gid) ? [...this.groups.get(gid)] : null;
  }

  /** Brings every window of a snap group to the front together. */
  focusGroup(win) {
    const members = this.groupOf(win);
    if (!members) { this.wm.focus(win); return; }
    for (const w of members.filter((m) => m !== win)) { if (w.state === 'minimized') w.restore(); this.wm.focus(w); }
    this.wm.focus(win);
  }

  /** Re-applies fractions after the work area changes. */
  refit(win) {
    if (!win.snap) return false;
    win.bounds = fracToRect(win.snap.frac, this.wm.workArea());
    win.apply();
    win.emit('resize', win.getBounds());
    return true;
  }

  // ── Shared-edge resizing ─────────────────────────────────────────────
  /** While a grouped window is resized, move the matching edges of its neighbours. */
  resizing(win, before, after) {
    const members = this.groupOf(win);
    if (!members) return;
    const e0 = { l: before.x, r: before.x + before.w, t: before.y, b: before.y + before.h };
    const e1 = { l: after.x, r: after.x + after.w, t: after.y, b: after.y + after.h };
    // A neighbour can't shrink below its minimum size: stop the shared edge there.
    for (const n of members) {
      if (n === win) continue;
      const nb = n.bounds, nr = nb.x + nb.w, nbt = nb.y + nb.h;
      const near = (p, q) => Math.abs(p - q) <= 3;
      if (e1.r > e0.r && near(nb.x, e0.r)) e1.r = Math.min(e1.r, nr - n.opts.minWidth);
      if (e1.l < e0.l && near(nr, e0.l)) e1.l = Math.max(e1.l, nb.x + n.opts.minWidth);
      if (e1.b > e0.b && near(nb.y, e0.b)) e1.b = Math.min(e1.b, nbt - n.opts.minHeight);
      if (e1.t < e0.t && near(nbt, e0.t)) e1.t = Math.max(e1.t, nb.y + n.opts.minHeight);
    }
    if (e1.l !== after.x || e1.r !== after.x + after.w || e1.t !== after.y || e1.b !== after.y + after.h) {
      win.bounds = { x: e1.l, y: e1.t, w: e1.r - e1.l, h: e1.b - e1.t };
      win.apply();
      win.emit('resize', win.getBounds());
    }
    const near = (p, q) => Math.abs(p - q) <= 3;
    for (const n of members) {
      if (n === win) continue;
      const nb = n.bounds;
      const ne = { l: nb.x, r: nb.x + nb.w, t: nb.y, b: nb.y + nb.h };
      let { l, r, t, b } = ne;
      if (e0.l !== e1.l) { if (near(ne.r, e0.l)) r = e1.l; if (near(ne.l, e0.l)) l = e1.l; }
      if (e0.r !== e1.r) { if (near(ne.l, e0.r)) l = e1.r; if (near(ne.r, e0.r)) r = e1.r; }
      if (e0.t !== e1.t) { if (near(ne.b, e0.t)) b = e1.t; if (near(ne.t, e0.t)) t = e1.t; }
      if (e0.b !== e1.b) { if (near(ne.t, e0.b)) t = e1.b; if (near(ne.b, e0.b)) b = e1.b; }
      if (l !== ne.l || r !== ne.r || t !== ne.t || b !== ne.b) {
        n.bounds = { x: l, y: t, w: Math.max(n.opts.minWidth, r - l), h: Math.max(n.opts.minHeight, b - t) };
        n.apply();
        n.emit('resize', n.getBounds());
      }
    }
  }

  /** After any resize of a snapped window, store the new fractions for the whole group. */
  resized(win) {
    const a = this.wm.workArea();
    for (const w of this.groupOf(win) || [win]) if (w.snap) w.snap.frac = rectToFrac(w.bounds, a);
  }

  // ── Keyboard (Win+Arrow) ─────────────────────────────────────────────
  keyboard(win, dir) {
    if (!win) return;
    const z = win.snap ? zoneName(win.snap.frac) : null;
    const go = (name) => this.snap(win, ZONES[name], { assist: name === 'left' || name === 'right' });
    if (win.state === 'maximized') {
      if (dir === 'left') go('left'); else if (dir === 'right') go('right'); else if (dir === 'down') win.unmaximize();
      return;
    }
    if (!win.snap) {
      if (dir === 'left') go('left'); else if (dir === 'right') go('right'); else if (dir === 'up') win.maximize(); else win.minimize();
      return;
    }
    const table = {
      left: { right: 'restore', up: 'tl', down: 'bl' },
      right: { left: 'restore', up: 'tr', down: 'br' },
      tl: { down: 'left', right: 'tr', up: 'max' },
      tr: { down: 'right', left: 'tl', up: 'max' },
      bl: { up: 'left', right: 'br', down: 'min' },
      br: { up: 'right', left: 'bl', down: 'min' },
    };
    const action = z ? table[z][dir] : { left: 'left', right: 'right', up: 'max', down: 'restore' }[dir];
    if (!action) return;
    if (action === 'restore') this.unsnap(win);
    else if (action === 'max') { this.leave(win); win.maximize(); }
    else if (action === 'min') win.minimize();
    else go(action);
  }

  // ── Snap layouts ─────────────────────────────────────────────────────
  showLayouts(win, anchor) {
    if (!this.setting('wm.snapLayouts') || !win.opts.resizable || this.wm.dragging) return;
    clearTimeout(this.layoutTimer);
    this.layoutWin = win;
    mount(this.layouts, LAYOUTS.map((layout, li) => h('div.sl-layout', { role: 'group', 'aria-label': `Layout ${li + 1}` },
      layout.map((cell, ci) => h('button.sl-cell', {
        type: 'button', 'aria-label': `Snap to area ${ci + 1} of layout ${li + 1}`,
        style: { left: `${cell[0] * 100}%`, top: `${cell[1] * 100}%`, width: `${cell[2] * 100}%`, height: `${cell[3] * 100}%` },
        onclick: () => this.pickLayout(win, layout, ci),
      })))));
    this.layouts.hidden = false;
    const r = anchor.getBoundingClientRect();
    const box = this.layouts.getBoundingClientRect();
    Object.assign(this.layouts.style, {
      left: `${Math.max(8, Math.min(innerWidth - box.width - 8, r.right - box.width + 40))}px`,
      top: `${Math.min(innerHeight - box.height - 56, r.bottom + 6)}px`, zIndex: String(this.wm.z + 5),
    });
  }

  hideLayoutsSoon() { clearTimeout(this.layoutTimer); this.layoutTimer = setTimeout(() => this.hideLayouts(), 350); }
  hideLayouts() { clearTimeout(this.layoutTimer); this.layouts.hidden = true; }

  pickLayout(win, layout, index) {
    this.hideLayouts();
    const gid = makeId('g');
    this.snap(win, layout[index], { group: gid });
    const rest = layout.filter((_, i) => i !== index);
    if (rest.length && this.setting('wm.snapAssist')) this.runAssist(rest, gid, win);
  }

  // ── Snap Assist ──────────────────────────────────────────────────────
  assistFor(win, frac) {
    const name = zoneName(frac);
    const rest = { left: [ZONES.right], right: [ZONES.left], tl: [ZONES.tr, ZONES.bl, ZONES.br], tr: [ZONES.tl, ZONES.bl, ZONES.br], bl: [ZONES.tl, ZONES.tr, ZONES.br], br: [ZONES.tl, ZONES.tr, ZONES.bl] }[name];
    if (!rest) return;
    // Don't offer areas already covered by snapped windows.
    const taken = this.wm.visibleWindows().filter((w) => w !== win && w.snap && w.state !== 'minimized').map((w) => w.snap.frac);
    const free = rest.filter((f) => !taken.some((t) => same(t, f)));
    const gid = makeId('g');
    this.join(win, gid);
    if (free.length) this.runAssist(free, gid, win);
  }

  runAssist(cells, gid, first) {
    const candidates = this.wm.visibleWindows().filter((w) => w !== first && w.opts.resizable && !(w.snap && w.snap.group === gid));
    if (!candidates.length || !cells.length) return;
    this.endAssist();
    const a = this.wm.workArea();
    const cell = cells[0];
    const r = fracToRect(cell, a);
    const finish = () => { this.endAssist(); };
    const box = h('div.snap-assist', { style: { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, zIndex: String(this.wm.z + 4) } },
      h('div.sa-grid', candidates.map((w) => h('button.sa-card', {
        type: 'button', 'aria-label': `Snap ${w.title} here`,
        onclick: () => { this.endAssist(); this.snap(w, cell, { group: gid }); this.runAssist(cells.slice(1), gid, w); },
      }, h('div.sa-head', h('img', { src: w.icon, alt: '' }), h('span', w.title)), this.wm.snapshot(w, 200, 120)))));
    this.assist = { box, onDown: (e) => { if (!box.contains(e.target)) finish(); }, onKey: (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(); } } };
    this.wm.layer.append(box);
    setTimeout(() => document.addEventListener('pointerdown', this.assist?.onDown, true));
    document.addEventListener('keydown', this.assist.onKey, true);
    box.querySelector('button')?.focus();
  }

  endAssist() {
    if (!this.assist) return;
    document.removeEventListener('pointerdown', this.assist.onDown, true);
    document.removeEventListener('keydown', this.assist.onKey, true);
    this.assist.box.remove();
    this.assist = null;
  }
}
