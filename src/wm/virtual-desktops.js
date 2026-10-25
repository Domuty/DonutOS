// Virtual desktops: separate sets of windows you switch between. The list (names and
// optional per-desktop wallpapers) and the current desktop are saved per user; each window
// remembers which desktop it is on, or that it shows on all of them.

import { h, settle } from '../ui/h.js';
import { uid as makeId } from '../core/util.js';

export class VirtualDesktops {
  constructor({ wm, settings, layer, onWallpaper }) {
    this.wm = wm;
    this.s = settings;           // the user's settings view
    this.layer = layer;          // where the "Desktop 2" indicator appears
    this.onWallpaper = onWallpaper;
    this.listeners = new Set();
    let list = this.s.get('wm.desktops');
    if (!list.length) list = [{ id: 'd1', name: 'Desktop 1' }];
    this.desktops = list;
    this.current = list.some((d) => d.id === this.s.get('wm.currentDesktop')) ? this.s.get('wm.currentDesktop') : list[0].id;
    wm.desktops = this;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #changed() {
    this.s.set('wm.desktops', this.desktops);
    this.s.set('wm.currentDesktop', this.current);
    for (const fn of this.listeners) fn();
    this.wm.changed(null);
  }

  list() { return this.desktops.map((d) => ({ ...d })); }
  get(id) { return this.desktops.find((d) => d.id === id) || null; }
  index(id = this.current) { return this.desktops.findIndex((d) => d.id === id); }
  windowsOn(id) { return this.wm.list().filter((w) => w.allDesktops || w.desktop === id); }

  create({ switchTo = false } = {}) {
    let n = this.desktops.length + 1;
    while (this.desktops.some((d) => d.name === `Desktop ${n}`)) n++;
    const d = { id: makeId('d'), name: `Desktop ${n}` };
    this.desktops.push(d);
    this.#changed();
    if (switchTo) this.switchTo(d.id);
    return d;
  }

  /** Closes a desktop; its windows move to the desktop on its left (or right). */
  remove(id) {
    if (this.desktops.length < 2) return false;
    const i = this.index(id);
    if (i < 0) return false;
    const target = this.desktops[i > 0 ? i - 1 : 1];
    for (const w of this.wm.list()) if (w.desktop === id) w.desktop = target.id;
    this.desktops.splice(i, 1);
    if (this.current === id) { this.current = null; this.switchTo(target.id, { animate: false }); }
    else this.#apply();
    this.#changed();
    return true;
  }

  rename(id, name) {
    const d = this.get(id);
    if (!d) return;
    d.name = String(name).trim().slice(0, 40) || d.name;
    this.#changed();
  }

  move(id, delta) {
    const i = this.index(id), j = i + delta;
    if (i < 0 || j < 0 || j >= this.desktops.length) return;
    const [d] = this.desktops.splice(i, 1);
    this.desktops.splice(j, 0, d);
    this.#changed();
  }

  setWallpaper(id, spec) {
    const d = this.get(id);
    if (!d) return;
    if (spec) d.wallpaper = spec; else delete d.wallpaper;
    this.#changed();
    if (id === this.current) this.onWallpaper?.();
  }

  /** The wallpaper for the current desktop, or null for "use my normal wallpaper". */
  wallpaper() { return this.get(this.current)?.wallpaper || null; }

  switchTo(id, { animate = true, focus = null } = {}) {
    if (!this.get(id)) return;
    if (id === this.current) { if (focus) this.wm.focus(focus); return; }
    const dir = this.index(id) > this.index(this.current) ? 1 : -1;
    const prev = this.current;
    this.current = id;
    this.wm.snapper.endAssist();
    this.#apply({ animate, dir, prev });
    if (focus) this.wm.focus(focus); else this.wm.focusTop();
    this.#changed();
    this.onWallpaper?.();
    if (animate) this.#indicator();
  }

  next() { const i = this.index(); if (i < this.desktops.length - 1) this.switchTo(this.desktops[i + 1].id); else this.#bump(1); }
  prev() { const i = this.index(); if (i > 0) this.switchTo(this.desktops[i - 1].id); else this.#bump(-1); }

  moveWindow(win, id) {
    if (!this.get(id)) return;
    win.allDesktops = false;
    win.desktop = id;
    this.#apply();
    if (this.wm.active === win && id !== this.current) this.wm.focusTop();
    this.#changed();
  }

  setAllDesktops(win, on) {
    win.allDesktops = on;
    if (!on) win.desktop = this.current;
    this.#apply();
    this.#changed();
  }

  /** Shows windows on the current desktop and hides the rest (with a slide when switching). */
  #apply({ animate = false, dir = 1, prev = null } = {}) {
    const reduced = document.documentElement.dataset.motion === 'reduce';
    for (const w of this.wm.list()) {
      const visible = this.wm.isVisible(w);
      const wasVisible = prev ? (w.allDesktops || w.desktop === prev) : !w.el.hidden || w.state === 'minimized';
      if (w.state === 'minimized') { w.el.hidden = true; continue; }
      if (visible) {
        w.el.hidden = false;
        if (animate && !reduced && !w.allDesktops && !wasVisible) {
          const { x, y } = w.bounds;
          w.el.animate([{ transform: `translate(${x + 80 * dir}px, ${y}px)`, opacity: 0 }, { transform: `translate(${x}px, ${y}px)`, opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.1,.9,.2,1)' });
        }
      } else if (!w.el.hidden) {
        if (animate && !reduced) {
          const { x, y } = w.bounds;
          w.el.animate([{ transform: `translate(${x}px, ${y}px)`, opacity: 1 }, { transform: `translate(${x - 80 * dir}px, ${y}px)`, opacity: 0 }], { duration: 200, easing: 'ease-in' })
            .finished.then(() => { if (!this.wm.isVisible(w)) w.el.hidden = true; }).catch(() => {});
        } else w.el.hidden = true;
      }
    }
  }

  async #indicator() {
    this.pill?.remove();
    const d = this.get(this.current);
    const pill = h('div.desk-pill.acrylic', { role: 'status', 'aria-live': 'polite' }, d.name);
    this.pill = pill;
    this.layer.append(pill);
    await new Promise((r) => setTimeout(r, 1100));
    pill.classList.add('out');
    await settle(pill, 300);
    pill.remove();
  }

  /** A little nudge when there is no desktop further in that direction. */
  #bump(dir) {
    if (document.documentElement.dataset.motion === 'reduce') return;
    for (const w of this.wm.visibleWindows()) {
      if (w.state === 'minimized') continue;
      const { x, y } = w.bounds;
      w.el.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: `translate(${x - 24 * dir}px, ${y}px)` }, { transform: `translate(${x}px, ${y}px)` }], { duration: 260, easing: 'ease-out' });
    }
  }
}
