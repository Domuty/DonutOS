// Magnifier: zooms the whole screen and follows the mouse pointer and keyboard focus.
//
// The screen is scaled around the pointer: the point under the pointer stays exactly where
// it is and everything else spreads out from it, so moving towards an edge reveals that edge.
// That keeps every pointer position meaningful as it is (menus open, windows drag and drop
// lands where the pointer is) without DonutOS's code knowing about the zoom.
// Pointer moves inside sandboxed app frames arrive on the a11y channel.

import { h } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { a11yChannel } from './channel.js';
import { setScreenView, screenToPage } from '../../ui/screen.js';

export const ZOOM_MIN = 125;
export const ZOOM_MAX = 800;

let state = { on: false, z: 1, px: 0, py: 0 };
const publish = () => setScreenView(state.on ? { z: state.z, px: state.px, py: state.py } : { z: 1, px: 0, py: 0 });

export class Magnifier {
  constructor({ onZoom, onClose }) {
    this.onZoom = onZoom;
    this.onClose = onClose;
    this.frame = 0;
    this.keyboard = false;
    this.bar = null;
    this.handlers = {
      move: (e) => { if (e.pointerType !== 'touch') this.keyboard = false; this.aim(e.clientX, e.clientY, true); },
      key: () => { this.keyboard = true; },
      // Follow keyboard focus, and anything that gets focus out of sight (a dialog opening).
      focus: (e) => { if (this.keyboard || !this.visible(e.target)) this.follow(e.target); },
      resize: () => this.aim(state.px, state.py),
    };
    this.offPointer = null;
  }

  get on() { return state.on; }

  start(zoomPercent) {
    const body = document.body;
    state = { on: true, z: zoomPercent / 100, px: state.px || innerWidth / 2, py: state.py || innerHeight / 2 };
    body.classList.add('magnified');
    addEventListener('pointermove', this.handlers.move, { capture: true, passive: true });
    addEventListener('keydown', this.handlers.key, true);
    document.addEventListener('focusin', this.handlers.focus, true);
    addEventListener('resize', this.handlers.resize);
    this.offPointer = a11yChannel.on('pointer', ({ x, y }) => this.aim(x, y, true));
    this.showBar();
    this.crisp();
    this.paint();
  }

  stop() {
    if (!state.on) return;
    state = { ...state, on: false };
    publish();
    cancelAnimationFrame(this.frame);
    document.body.classList.remove('magnified', 'mag-crisp');
    document.body.style.transform = '';
    removeEventListener('pointermove', this.handlers.move, true);
    removeEventListener('keydown', this.handlers.key, true);
    document.removeEventListener('focusin', this.handlers.focus, true);
    removeEventListener('resize', this.handlers.resize);
    this.offPointer?.();
    this.bar?.remove();
    this.bar = null;
  }

  setZoom(percent) {
    if (!state.on) return;
    state.z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, percent)) / 100;
    if (this.bar) this.bar.querySelector('output').value = `${Math.round(state.z * 100)}%`;
    this.crisp();
    this.paint();
  }

  /** Points the zoom at a screen position (`fromPointer`: the pointer is there). */
  aim(x, y, fromPointer = false) {
    if (!state.on) return;
    if (fromPointer) {
      // While the screen is zoomed, a pointer position on screen is already the page position
      // under it (see the comment at the top), so it can be used directly.
      state.px = Math.max(0, Math.min(innerWidth, x));
      state.py = Math.max(0, Math.min(innerHeight, y));
    } else {
      state.px = x; state.py = y;
    }
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  visible(el) {
    const r = el?.getBoundingClientRect?.();
    return !r || (r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight);
  }

  /** Brings a focused element into view (keyboard users). */
  follow(el) {
    if (!state.on || !el?.getBoundingClientRect || el === document.body) return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    // r is on-screen; page coordinates of its centre:
    const c = screenToPage(r.left + r.width / 2, r.top + r.height / 2);
    // Showing page point c at screen point c (aim there) keeps it fully visible.
    this.aim(c.x, c.y);
  }

  paint() {
    if (!state.on) return;
    const { z, px, py } = state;
    publish();
    document.body.style.transform = `translate(${px * (1 - z)}px, ${py * (1 - z)}px) scale(${z})`;
  }

  // Text is drawn at the zoomed size: the layer is re-rasterised after each zoom change.
  crisp() {
    document.body.classList.remove('mag-crisp');
    clearTimeout(this.crispTimer);
    this.crispTimer = setTimeout(() => { if (state.on) document.body.classList.add('mag-crisp'); }, 120);
  }

  showBar() {
    if (this.bar) return;
    const out = h('output', { 'aria-live': 'polite', 'aria-label': 'Zoom level' }, `${Math.round(state.z * 100)}%`);
    this.bar = h('div.mag-bar', { role: 'toolbar', 'aria-label': 'Magnifier' },
      icon('search', { size: 16 }),
      h('button', { type: 'button', title: 'Zoom out (Win+Minus)', 'aria-label': 'Zoom out', onclick: () => this.onZoom(-1) }, icon('minus', { size: 16 })),
      out,
      h('button', { type: 'button', title: 'Zoom in (Win+Plus)', 'aria-label': 'Zoom in', onclick: () => this.onZoom(1) }, icon('plus', { size: 16 })),
      h('span.mag-sep'),
      h('button', { type: 'button', title: 'Close Magnifier (Win+Esc)', 'aria-label': 'Close Magnifier', onclick: () => this.onClose() }, icon('close', { size: 16 })));
    // Outside <body>, so the toolbar itself isn't magnified.
    document.documentElement.append(this.bar);
  }
}
