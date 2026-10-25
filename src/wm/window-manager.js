// Window manager for one user session: creates windows for processes, keeps z-order and
// focus, remembers each app's last size/position, and provides what the taskbar needs
// (window list, previews, minimize targets). Phase 4 adds snapping, virtual desktops,
// Task View and Alt+Tab on top of this.

import { AppWindow } from './window.js';
import { Snapper, ZONES } from './snap.js';
import { showMenu } from '../ui/menu.js';

const TASKBAR_H = 48;

export class WindowManager {
  constructor({ kernel, uid, layer, hooks = {} }) {
    this.kernel = kernel;
    this.uid = uid;
    this.layer = layer;
    this.hooks = hooks;          // { taskbarTarget(win), taskbarHidden() }
    this.windows = new Map();    // id -> AppWindow, in creation order
    this.order = [];             // z-order, bottom to top
    this.active = null;
    this.z = 10;
    this.listeners = new Set();
    this.shownDesktop = null;    // windows minimised by "Show desktop"
    this.desktops = null;        // VirtualDesktops, attached by the session
    this.snapper = new Snapper(this);
    this.dragging = false;
    this.offExit = kernel.bus.on('process:exit', ({ pid }) => this.#closeForPid(pid));
    this.onResize = () => this.fitToScreen();
    window.addEventListener('resize', this.onResize);
  }

  /** Subscribe to any change (open, close, focus, title, state). */
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(win) { for (const fn of this.listeners) fn(win); }

  workArea() {
    const hidden = this.hooks.taskbarHidden?.();
    return { x: 0, y: 0, w: innerWidth, h: innerHeight - (hidden ? 0 : TASKBAR_H) };
  }

  create(proc, opts = {}) {
    const win = new AppWindow(this, proc, opts);
    win.desktop = this.desktops?.current || null;
    proc.windows.add(win.id);
    this.windows.set(win.id, win);
    this.layer.append(win.el);
    proc.elements.add(win.el); // counted as the process's memory; removed if it is killed
    this.#place(win, opts);
    win.open();
    this.focus(win);
    if (this.#savedBounds(win.appId)?.maximized && opts.maximized !== false) win.maximize();
    else if (opts.maximized) win.maximize();
    this.kernel.bus.emit('wm:opened', { uid: this.uid, id: win.id, pid: win.pid, appId: win.appId });
    this.changed(win);
    return win.api();
  }

  #savedBounds(appId) {
    try { return this.kernel.settings.get(`wm.bounds.${appId}`, this.uid); } catch { return null; }
  }

  /** Initial placement: explicit, then remembered, then cascaded from the centre. */
  #place(win, opts) {
    const saved = this.#savedBounds(win.appId);
    const a = this.workArea();
    let w = opts.width ?? saved?.w ?? win.opts.width;
    let hh = opts.height ?? saved?.h ?? win.opts.height;
    w = Math.min(w, a.w - 16); hh = Math.min(hh, a.h - 16);
    let x = opts.x ?? saved?.x ?? a.x + (a.w - w) / 2;
    let y = opts.y ?? saved?.y ?? a.y + Math.max(8, (a.h - hh) / 2.4);
    // Cascade if another window already sits exactly there.
    const others = [...this.windows.values()].filter((o) => o !== win && o.state !== 'minimized');
    let guard = 0;
    while (others.some((o) => Math.abs(o.bounds.x - x) < 8 && Math.abs(o.bounds.y - y) < 8) && guard++ < 20) { x += 32; y += 32; }
    if (x + w > a.x + a.w) x = a.x + 24;
    if (y + hh > a.y + a.h) y = a.y + 24;
    win.bounds = { x, y, w, h: hh };
    win.setBounds(win.bounds, { save: false });
  }

  rememberBounds(win) {
    if (win.state === 'minimized') return;
    const b = win.state === 'maximized' && win.prevBounds ? win.prevBounds : win.snap && win.preSnap ? win.preSnap : win.bounds;
    try { this.kernel.settings.set(`wm.bounds.${win.appId}`, { ...b, maximized: win.state === 'maximized' }, this.uid); } catch { /* user signed out */ }
  }

  /** Windows on the current virtual desktop (or on all desktops). */
  visibleWindows() { return this.list().filter((w) => this.isVisible(w)); }
  isVisible(w) { return !this.desktops || w.allDesktops || w.desktop === this.desktops.current; }

  dragStart(win) { this.dragging = true; this.snapper.dragStart(win); }
  dragMove(win, ev) { this.snapper.dragMove(win, ev); }
  dragEnd(win, ev) { this.dragging = false; this.snapper.dragEnd(win, ev); }

  focus(win) {
    if (!win || win.closing) return;
    if (!this.isVisible(win)) { this.desktops.switchTo(win.desktop, { focus: win }); return; }
    if (win.state === 'minimized') { win.restore(); return; }
    this.shownDesktop = null;
    if (this.active !== win) {
      this.active?.el.classList.remove('active');
      this.active?.emit('blur');
      this.active = win;
      win.el.classList.add('active');
      win.emit('focus');
    }
    this.order = this.order.filter((w) => w !== win).concat(win);
    win.el.style.zIndex = String(++this.z);
    if (!win.el.contains(document.activeElement)) (win.lastFocus?.isConnected ? win.lastFocus : win.el).focus({ preventScroll: true });
    this.kernel.bus.emit('wm:focus', { uid: this.uid, id: win.id, appId: win.appId });
    this.changed(win);
  }

  minimized(win) {
    if (this.active === win) {
      win.el.classList.remove('active');
      this.active = null;
      const next = [...this.order].reverse().find((w) => w !== win && w.state !== 'minimized' && this.isVisible(w));
      if (next) this.focus(next);
    }
    this.changed(win);
  }

  /** Focuses the top-most window on the current desktop (after switching desktops). */
  focusTop() {
    const next = [...this.order].reverse().find((w) => w.state !== 'minimized' && this.isVisible(w));
    if (next) this.focus(next);
    else { this.active?.el.classList.remove('active'); this.active = null; this.changed(null); }
  }

  removed(win) {
    this.snapper.leave(win);
    this.windows.delete(win.id);
    this.order = this.order.filter((w) => w !== win);
    win.proc.windows.delete(win.id);
    win.proc.elements.delete(win.el);
    win.el.remove();
    if (this.active === win) {
      this.active = null;
      const next = [...this.order].reverse().find((w) => w.state !== 'minimized' && this.isVisible(w));
      if (next) this.focus(next);
    }
    this.kernel.bus.emit('wm:closed', { uid: this.uid, id: win.id, pid: win.pid, appId: win.appId });
    this.changed(win);
    // The app ends when its last window closes (unless it asked to stay alive).
    if (!win.proc.windows.size && !win.opts.keepAlive && win.proc.state === 'running') {
      this.kernel.processes.kill(win.pid).catch(() => {});
    }
  }

  #closeForPid(pid) {
    for (const w of [...this.windows.values()]) if (w.pid === pid) { w.closing = true; this.removed(w); }
  }

  list() { return [...this.windows.values()]; }
  forPid(pid) { return this.list().filter((w) => w.pid === pid).map((w) => w.api()); }
  forApp(appId) { return this.list().filter((w) => w.appId === appId); }
  get(id) { return this.windows.get(id) || null; }

  taskbarTarget(win) { return this.hooks.taskbarTarget?.(win) || null; }

  /** Show desktop: minimise everything; calling again brings the same windows back. */
  toggleDesktop() {
    if (this.shownDesktop) {
      const back = this.shownDesktop;
      this.shownDesktop = null;
      for (const w of back) if (this.windows.has(w.id)) w.restore();
      return;
    }
    const visible = this.order.filter((w) => w.state !== 'minimized' && this.isVisible(w));
    if (!visible.length) return;
    for (const w of visible) w.minimize();
    this.shownDesktop = visible;
  }

  minimizeAll() { for (const w of this.order) if (w.state !== 'minimized' && this.isVisible(w)) w.minimize(); }

  closeActive() {
    if (this.active) { this.active.close(); return true; }
    return false;
  }

  flash(win) { this.hooks.flash?.(win); }
  setProgress(win, p) { win.progress = p; this.changed(win); }

  /** Right-click on a title bar / click on its icon. */
  systemMenu(win, x, y) {
    const max = win.state === 'maximized';
    const canSnap = win.opts.resizable;
    const desks = this.desktops?.list() || [];
    showMenu([
      { label: 'Restore', icon: 'restart', disabled: !max && !win.snap, onSelect: () => (win.snap ? this.snapper.unsnap(win) : win.unmaximize()) },
      { label: 'Minimize', icon: 'minus', disabled: !win.opts.minimizable, onSelect: () => win.minimize() },
      { label: 'Maximize', icon: 'chevronUp', disabled: max || !win.opts.maximizable || !canSnap, onSelect: () => win.maximize() },
      { separator: true },
      { label: 'Snap left', icon: 'arrowLeft', hint: 'Win+←', disabled: !canSnap, onSelect: () => this.snapper.snap(win, ZONES.left, { assist: true }) },
      { label: 'Snap right', icon: 'arrowRight', hint: 'Win+→', disabled: !canSnap, onSelect: () => this.snapper.snap(win, ZONES.right, { assist: true }) },
      ...(this.desktops ? [
        { separator: true },
        ...desks.filter((d) => d.id !== win.desktop).map((d) => ({ label: `Move to ${d.name}`, icon: 'view', onSelect: () => this.desktops.moveWindow(win, d.id) })),
        { label: 'Move to a new desktop', icon: 'plus', onSelect: () => this.desktops.moveWindow(win, this.desktops.create().id) },
        { label: 'Show this window on all desktops', checked: win.allDesktops, onSelect: () => this.desktops.setAllDesktops(win, !win.allDesktops) },
      ] : []),
      { separator: true },
      { label: 'Close', icon: 'close', hint: 'Alt+F4', onSelect: () => win.close() },
    ], { x, y });
  }

  /** Keeps windows on screen after the browser window / display changes size. */
  fitToScreen() {
    const a = this.workArea();
    for (const w of this.windows.values()) {
      if (w.state === 'maximized') { w.bounds = { x: a.x, y: a.y, w: a.w, h: a.h }; w.apply(); w.emit('resize', w.getBounds()); }
      else if (!this.snapper.refit(w)) w.setBounds(w.bounds, { save: false });
    }
  }

  /** A scaled visual copy of a window for taskbar previews. */
  snapshot(win, maxW = 220, maxH = 130) {
    const { w, h: hh } = win.bounds;
    const scale = Math.min(maxW / w, maxH / hh, 1);
    const clone = win.el.cloneNode(true);
    clone.classList.remove('active');
    clone.removeAttribute('data-id');
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    clone.hidden = false;
    // Canvases lose their pixels when cloned; videos/iframes would reload. Copy pixels, replace the rest.
    const srcCanvases = win.el.querySelectorAll('canvas');
    clone.querySelectorAll('canvas').forEach((c, i) => {
      try { c.getContext('2d')?.drawImage(srcCanvases[i], 0, 0); } catch { /* tainted or webgl: leave blank */ }
    });
    const srcVideos = win.el.querySelectorAll('video');
    clone.querySelectorAll('video').forEach((v, i) => {
      const c = document.createElement('canvas');
      c.width = srcVideos[i].videoWidth || 160; c.height = srcVideos[i].videoHeight || 90;
      try { c.getContext('2d').drawImage(srcVideos[i], 0, 0); } catch { /* not ready */ }
      c.style.cssText = v.style.cssText + ';width:100%;height:100%;object-fit:contain;background:#000';
      v.replaceWith(c);
    });
    clone.querySelectorAll('iframe, webview, audio, script').forEach((n) => {
      const ph = document.createElement('div');
      ph.style.cssText = 'width:100%;height:100%;background:var(--surface-2)';
      n.replaceWith(ph);
    });
    clone.inert = true;
    Object.assign(clone.style, { transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute', left: '0', top: '0', zIndex: '0', pointerEvents: 'none', '--mx': '0px', '--my': '0px' });
    const box = document.createElement('div');
    box.className = 'win-snapshot';
    Object.assign(box.style, { width: `${w * scale}px`, height: `${hh * scale}px`, position: 'relative', overflow: 'hidden' });
    box.append(clone);
    return box;
  }

  destroy() {
    this.offExit();
    window.removeEventListener('resize', this.onResize);
    for (const w of [...this.windows.values()]) w.el.remove();
    this.windows.clear();
  }
}
