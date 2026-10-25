// One application window: frame, title bar, body, resize handles, and its state machine
// (normal / maximized / minimized). The WindowManager owns z-order and focus.

import { h } from '../ui/h.js';

let nextId = 1;
const EASE = 'cubic-bezier(0.1, 0.9, 0.2, 1)';
const reduced = () => document.documentElement.dataset.motion === 'reduce';

const CONTROL_ICONS = {
  min: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>',
  max: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor"/></svg>',
  restore: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y="2.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor"/><path d="M2.5 2.5V1.8A1.3 1.3 0 0 1 3.8.5h4.4A1.3 1.3 0 0 1 9.5 1.8v4.4a1.3 1.3 0 0 1-1.3 1.3H7.5" fill="none" stroke="currentColor"/></svg>',
  close: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" stroke-width="1"/></svg>',
};

export class AppWindow {
  constructor(wm, proc, opts) {
    this.wm = wm;
    this.id = `w${nextId++}`;
    this.pid = proc.pid;
    this.proc = proc;
    this.appId = proc.appId;
    this.opts = {
      title: proc.name, icon: proc.icon, width: 800, height: 560, minWidth: 320, minHeight: 200,
      resizable: true, maximizable: true, minimizable: true, keepAlive: false, showTitle: true,
      ...proc.app.window, ...opts,
    };
    this.title = this.opts.title;
    this.icon = this.opts.icon;
    this.state = 'normal';
    this.bounds = { x: 0, y: 0, w: this.opts.width, h: this.opts.height };
    this.prevBounds = null;
    this.listeners = new Map();
    this.beforeClose = [];
    this.closing = false;
    this.lastFocus = null;
    this.build();
  }

  build() {
    const o = this.opts;
    this.iconEl = h('img.win-icon', { src: this.icon, alt: '', draggable: 'false' });
    this.titleEl = h('span.win-title', { hidden: !o.showTitle }, this.title);
    this.titlebarSlot = h('div.win-tb-slot');
    const btn = (name, label, fn, hidden) => h(`button.win-btn.win-${name}`, { type: 'button', title: label, 'aria-label': label, hidden, tabindex: '-1', onclick: (e) => { e.stopPropagation(); fn(); } });
    this.minBtn = btn('min', 'Minimize', () => this.minimize(), !o.minimizable);
    this.maxBtn = btn('max', 'Maximize', () => this.toggleMaximize(), !o.maximizable || !o.resizable);
    this.closeBtn = btn('close', 'Close', () => this.close());
    this.minBtn.innerHTML = CONTROL_ICONS.min; this.maxBtn.innerHTML = CONTROL_ICONS.max; this.closeBtn.innerHTML = CONTROL_ICONS.close;
    this.titlebar = h('div.win-titlebar', this.iconEl, this.titleEl, this.titlebarSlot, h('div.win-controls', this.minBtn, this.maxBtn, this.closeBtn));
    this.body = h('div.win-body');
    this.el = h('section.win', { role: 'dialog', 'aria-label': this.title, tabindex: '-1', dataset: { id: this.id, app: this.appId } }, this.titlebar, this.body);
    if (o.resizable) for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) this.el.append(h(`div.rz.rz-${d}`, { dataset: { dir: d } }));
    this.el.addEventListener('pointerdown', () => this.wm.focus(this), true);
    this.el.addEventListener('focusin', (e) => { this.lastFocus = e.target; });
    this.titlebar.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input, .win-tb-slot > *')) this.toggleMaximize(); });
    this.titlebar.addEventListener('pointerdown', (e) => this.startMove(e));
    this.titlebar.addEventListener('contextmenu', (e) => { if (!e.target.closest('.win-tb-slot > *')) { e.preventDefault(); this.wm.systemMenu(this, e.clientX, e.clientY); } });
    this.iconEl.addEventListener('click', (e) => { const r = this.iconEl.getBoundingClientRect(); this.wm.systemMenu(this, r.left, r.bottom + 4); e.stopPropagation(); });
    this.el.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('rz')) this.startResize(e, e.target.dataset.dir); });
  }

  // ── Events ───────────────────────────────────────────────────────────
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }
  emit(event, payload) { for (const fn of this.listeners.get(event) || []) { try { fn(payload); } catch { /* app handler errors don't break the WM */ } } }

  // ── Geometry ─────────────────────────────────────────────────────────
  apply() {
    const { x, y, w, h: hh } = this.bounds;
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    this.el.style.width = `${w}px`;
    this.el.style.height = `${hh}px`;
    this.el.style.setProperty('--mx', `${-x}px`);
    this.el.style.setProperty('--my', `${-y}px`);
  }

  setBounds(b, { save = true } = {}) {
    const area = this.wm.workArea();
    const w = Math.max(this.opts.minWidth, Math.min(b.w ?? this.bounds.w, area.w));
    const hh = Math.max(this.opts.minHeight, Math.min(b.h ?? this.bounds.h, area.h));
    // Keep at least part of the title bar reachable.
    const x = Math.min(Math.max(b.x ?? this.bounds.x, area.x - w + 120), area.x + area.w - 120);
    const y = Math.min(Math.max(b.y ?? this.bounds.y, area.y), area.y + area.h - 40);
    this.bounds = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) };
    this.apply();
    this.emit('resize', this.getBounds());
    if (save) this.wm.rememberBounds(this);
  }

  getBounds() { return { ...this.bounds }; }

  center() {
    const a = this.wm.workArea();
    this.setBounds({ x: a.x + (a.w - this.bounds.w) / 2, y: a.y + Math.max(0, (a.h - this.bounds.h) / 2.4) }, { save: false });
  }

  /** Animates from one rectangle to the current bounds (FLIP). */
  morphFrom(from, duration = 220) {
    if (reduced() || !from) return;
    const to = this.bounds;
    const sx = from.w / to.w, sy = from.h / to.h;
    this.el.animate([
      { transform: `translate(${from.x}px, ${from.y}px) scale(${sx}, ${sy})` },
      { transform: `translate(${to.x}px, ${to.y}px) scale(1, 1)` },
    ], { duration, easing: EASE });
  }

  // ── Move & resize ────────────────────────────────────────────────────
  startMove(e) {
    if (e.button !== 0 || e.target.closest('button, input, select, textarea, a, [data-no-drag], .win-tb-slot > *:not(.drag)')) return;
    const startX = e.clientX, startY = e.clientY;
    let base = { ...this.bounds };
    let moved = false, frame = 0, last = e;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev) => {
      last = ev;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      if (!moved) {
        moved = true;
        this.el.classList.add('moving');
        if (this.state === 'maximized') {
          // Restore under the cursor, keeping the grab point proportional.
          const ratio = (startX - this.bounds.x) / this.bounds.w;
          const pb = this.prevBounds || { w: this.opts.width, h: this.opts.height };
          this.state = 'normal';
          this.el.classList.remove('maximized');
          this.updateMaxIcon();
          base = { x: startX - pb.w * ratio, y: 0, w: pb.w, h: pb.h };
          this.bounds = { ...base };
          this.emit('state', this.state);
        }
        this.wm.dragStart?.(this, ev);
      }
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        this.setBounds({ x: base.x + (last.clientX - startX), y: base.y + (last.clientY - startY) }, { save: false });
        this.wm.dragMove?.(this, last);
      });
    };
    const up = (ev) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      cancelAnimationFrame(frame);
      this.el.classList.remove('moving');
      if (moved) {
        this.setBounds({ x: base.x + (ev.clientX - startX), y: base.y + (ev.clientY - startY) });
        this.wm.dragEnd?.(this, ev);
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  startResize(e, dir) {
    if (e.button !== 0 || this.state !== 'normal') return;
    e.preventDefault();
    e.stopPropagation();
    const start = { ...this.bounds }, sx = e.clientX, sy = e.clientY;
    const { minWidth: mw, minHeight: mh } = this.opts;
    const handle = e.target;
    handle.setPointerCapture(e.pointerId);
    this.el.classList.add('resizing');
    let frame = 0, last = e;
    const compute = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let { x, y, w, h: hh } = start;
      if (dir.includes('e')) w = Math.max(mw, start.w + dx);
      if (dir.includes('s')) hh = Math.max(mh, start.h + dy);
      if (dir.includes('w')) { w = Math.max(mw, start.w - dx); x = start.x + start.w - w; }
      if (dir.includes('n')) { hh = Math.max(mh, start.h - dy); y = start.y + start.h - hh; }
      const area = this.wm.workArea();
      if (y < area.y) { hh -= area.y - y; y = area.y; }
      return { x, y, w, h: hh };
    };
    const move = (ev) => {
      last = ev;
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; this.setBounds(compute(last), { save: false }); });
    };
    const up = (ev) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      cancelAnimationFrame(frame);
      this.el.classList.remove('resizing');
      this.setBounds(compute(ev));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  // ── State ────────────────────────────────────────────────────────────
  setTitle(t) {
    this.title = String(t);
    this.titleEl.textContent = this.title;
    this.el.setAttribute('aria-label', this.title);
    this.wm.changed(this);
  }

  setIcon(url) { this.icon = url; this.iconEl.src = url; this.wm.changed(this); }

  focus() { this.wm.focus(this); }

  maximize() {
    if (this.state === 'maximized' || !this.opts.resizable) return;
    if (this.state === 'minimized') this.restore();
    const from = { ...this.bounds };
    this.prevBounds = { ...this.bounds };
    const a = this.wm.workArea();
    this.state = 'maximized';
    this.el.classList.add('maximized');
    this.bounds = { x: a.x, y: a.y, w: a.w, h: a.h };
    this.apply();
    this.morphFrom(from);
    this.updateMaxIcon();
    this.emit('state', this.state);
    this.emit('resize', this.getBounds());
    this.wm.rememberBounds(this);
    this.wm.changed(this);
  }

  unmaximize() {
    if (this.state !== 'maximized') return;
    const from = { ...this.bounds };
    this.state = 'normal';
    this.el.classList.remove('maximized');
    this.setBounds(this.prevBounds || { w: this.opts.width, h: this.opts.height });
    this.morphFrom(from);
    this.updateMaxIcon();
    this.emit('state', this.state);
    this.wm.changed(this);
  }

  toggleMaximize() { if (this.state === 'maximized') this.unmaximize(); else this.maximize(); }

  updateMaxIcon() {
    const max = this.state === 'maximized';
    this.maxBtn.innerHTML = max ? CONTROL_ICONS.restore : CONTROL_ICONS.max;
    this.maxBtn.title = max ? 'Restore down' : 'Maximize';
    this.maxBtn.setAttribute('aria-label', this.maxBtn.title);
  }

  async minimize() {
    if (this.state === 'minimized' || !this.opts.minimizable) return;
    this.restoreState = this.state;
    this.state = 'minimized';
    this.emit('state', this.state);
    this.wm.minimized(this);
    const target = this.wm.taskbarTarget(this);
    if (!reduced()) {
      const { x, y, w, h: hh } = this.bounds;
      const tx = target ? target.x + target.width / 2 - w / 2 : x;
      const ty = target ? target.y - hh / 2 : y + 200;
      await this.el.animate([
        { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1 },
        { transform: `translate(${tx}px, ${ty}px) scale(0.1)`, opacity: 0 },
      ], { duration: 220, easing: 'cubic-bezier(.4,0,.6,1)' }).finished.catch(() => {});
    }
    if (this.state === 'minimized') this.el.hidden = true;
  }

  restore() {
    if (this.state !== 'minimized') { this.focus(); return; }
    this.state = this.restoreState === 'maximized' ? 'maximized' : 'normal';
    this.el.hidden = false;
    this.emit('state', this.state);
    if (!reduced()) {
      const target = this.wm.taskbarTarget(this);
      const { x, y, w, h: hh } = this.bounds;
      const tx = target ? target.x + target.width / 2 - w / 2 : x;
      const ty = target ? target.y - hh / 2 : y + 200;
      this.el.animate([
        { transform: `translate(${tx}px, ${ty}px) scale(0.1)`, opacity: 0 },
        { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1 },
      ], { duration: 240, easing: EASE });
    }
    this.focus();
  }

  /** Runs beforeClose handlers (an app can refuse, e.g. to ask about unsaved work) and closes. */
  async close({ force = false } = {}) {
    if (this.closing) return false;
    if (!force) {
      for (const fn of this.beforeClose) {
        let ok;
        try { ok = await fn(); } catch { ok = true; }
        if (ok === false) return false;
      }
    }
    this.closing = true;
    this.wm.rememberBounds(this);
    this.emit('close');
    if (!reduced() && !this.el.hidden) {
      const { x, y } = this.bounds;
      await this.el.animate([
        { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1 },
        { transform: `translate(${x}px, ${y}px) scale(0.96)`, opacity: 0 },
      ], { duration: 140, easing: 'cubic-bezier(.4,0,1,1)' }).finished.catch(() => {});
    }
    this.wm.removed(this);
    return true;
  }

  open() {
    this.apply();
    if (reduced()) return;
    const { x, y } = this.bounds;
    this.el.animate([
      { transform: `translate(${x}px, ${y}px) scale(0.94)`, opacity: 0 },
      { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1 },
    ], { duration: 200, easing: EASE });
  }

  /** The API handed to the app (a narrow view of this object). */
  api() {
    const w = this;
    return Object.freeze({
      id: w.id,
      body: w.body,
      titlebar: w.titlebarSlot,
      get state() { return w.state; },
      get active() { return w.wm.active === w; },
      setTitle: (t) => w.setTitle(t),
      setIcon: (u) => w.setIcon(u),
      focus: () => w.focus(),
      minimize: () => w.minimize(),
      maximize: () => w.maximize(),
      restore: () => (w.state === 'maximized' ? w.unmaximize() : w.restore()),
      close: (o) => w.close(o),
      setBounds: (b) => w.setBounds(b),
      getBounds: () => w.getBounds(),
      center: () => w.center(),
      on: (ev, fn) => w.on(ev, fn),
      onBeforeClose: (fn) => { w.beforeClose.push(fn); },
      flash: () => w.wm.flash(w),
      setProgress: (p) => w.wm.setProgress(w, p),
    });
  }
}

