// Keyboard accessibility: Sticky Keys, Bounce Keys and Toggle Keys.
//
// Sticky Keys: press Ctrl, Alt or Shift on its own and it stays down for the next key or
// click (press it twice to lock it, a third time to release). DonutOS adds the modifier to
// that next key press or click, so shortcuts (Ctrl+Alt+E, Shift-click…) work one key at a
// time. Where the browser would act on a real combination (Ctrl+C in a text box, Shift for
// a capital letter) the action is done here instead. The Win key isn't latched: every Win
// shortcut also has a Ctrl+Alt form.
//
// Bounce Keys: a key pressed again within a short time of being released is ignored.
// Toggle Keys: a tone when Caps Lock, Num Lock or Scroll Lock is pressed (high = on).

import { h } from '../../ui/h.js';
import { isEditable, insertText, performKey, SHIFTED } from './edit-actions.js';

const MODS = { Control: 'ctrl', Alt: 'alt', Shift: 'shift' };
const LABEL = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
const PROP = { ctrl: 'ctrlKey', alt: 'altKey', shift: 'shiftKey' };
const STATE_NAME = { ctrl: 'Control', alt: 'Alt', shift: 'Shift' };

function tone(freq) {
  try {
    const ac = (tone.ac ??= new AudioContext());
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = freq; g.gain.value = 0.12;
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.18);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.2);
  } catch { /* no audio device */ }
}

export class KeyboardAids {
  constructor({ get, onShiftFive }) {
    this.get = get;
    this.onShiftFive = onShiftFive;
    this.sticky = { ctrl: 0, alt: 0, shift: 0 };    // 0 off, 1 latched, 2 locked
    this.held = new Set();
    this.usedWithOther = new Set();
    this.released = new Map();                       // code -> time of keyup (Bounce Keys)
    this.bounced = new Set();
    this.shiftRun = { n: 0, at: 0 };
    this.modified = new WeakSet();
    this.indicator = null;
    this.h = {
      down: (e) => this.onDown(e),
      up: (e) => this.onUp(e),
      after: (e) => this.after(e),
      pointer: (e) => this.onPointer(e),
      click: (e) => this.onPointer(e, true),
      blur: () => { this.held.clear(); },
    };
    addEventListener('keydown', this.h.down, true);
    addEventListener('keyup', this.h.up, true);
    addEventListener('keydown', this.h.after, false);
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'contextmenu', 'dblclick']) addEventListener(t, this.h.pointer, true);
    addEventListener('click', this.h.click, true);
    addEventListener('blur', this.h.blur);
  }

  get stickyOn() { return !!this.get('stickyKeys'); }
  active() { return Object.keys(this.sticky).filter((m) => this.sticky[m]); }

  refresh() {
    if (!this.stickyOn) { this.sticky = { ctrl: 0, alt: 0, shift: 0 }; }
    this.paint();
  }

  // ── Keys ─────────────────────────────────────────────────────────────
  onDown(e) {
    if (!e.isTrusted) return;
    // Bounce Keys
    if (this.get('bounceKeys') && !e.repeat) {
      const t = this.released.get(e.code);
      if (t && performance.now() - t < this.get('bounceMs')) {
        e.preventDefault(); e.stopImmediatePropagation(); this.bounced.add(e.code); return;
      }
    }
    const mod = MODS[e.key];
    if (mod) {
      if (!e.repeat) { this.held.add(mod); this.usedWithOther.delete(mod); }
      if (mod === 'shift' && !e.repeat) this.countShift(e);
      return;
    }
    this.shiftRun.n = 0;
    for (const m of this.held) this.usedWithOther.add(m);
    if (!this.stickyOn) return;
    const extra = this.active().filter((m) => !e[PROP[m]]);
    if (!extra.length) { this.consume(); return; }
    this.addModifiers(e, extra);
    this.modified.add(e);
    this.consume();
  }

  onUp(e) {
    if (!e.isTrusted) return;
    if (this.bounced.has(e.code)) { this.bounced.delete(e.code); e.stopImmediatePropagation(); return; }
    if (this.get('bounceKeys')) this.released.set(e.code, performance.now());
    if (this.get('toggleKeys') && ['CapsLock', 'NumLock', 'ScrollLock'].includes(e.key)) tone(e.getModifierState(e.key) ? 880 : 440);
    const mod = MODS[e.key];
    if (!mod) return;
    this.held.delete(mod);
    if (this.stickyOn && !this.usedWithOther.has(mod)) {
      this.sticky[mod] = (this.sticky[mod] + 1) % 3;
      tone(this.sticky[mod] ? 660 + this.sticky[mod] * 120 : 330);
      this.paint();
    }
  }

  /** Runs after the page has handled a key with added modifiers: do what the browser would have. */
  after(e) {
    if (!this.modified.has(e) || e.defaultPrevented) return;
    const el = document.activeElement;
    if (!isEditable(el) && !(e.ctrlKey || e.metaKey)) return;
    const mods = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
    // Only Shift added to a character: type its shifted form.
    if (!mods.ctrl && !mods.alt && !mods.meta && e.key.length === 1) {
      e.preventDefault();
      insertText(el, /[a-z]/i.test(e.key) ? e.key.toUpperCase() : SHIFTED[e.key] ?? e.key);
      return;
    }
    if (mods.ctrl || mods.alt || mods.meta) {
      e.preventDefault();
      performKey(el, { key: e.key, mods });
    } else if (mods.shift && /^(Arrow|Home|End)/.test(e.key) && isEditable(el)) {
      e.preventDefault();
      performKey(el, { key: e.key, mods });
    }
  }

  addModifiers(e, mods) {
    for (const m of mods) Object.defineProperty(e, PROP[m], { value: true, configurable: true });
    const original = e.getModifierState.bind(e);
    Object.defineProperty(e, 'getModifierState', { value: (k) => mods.some((m) => STATE_NAME[m] === k) || original(k), configurable: true });
  }

  /** Latched (not locked) modifiers are used up by one key press or click. */
  consume() {
    let changed = false;
    for (const m of Object.keys(this.sticky)) if (this.sticky[m] === 1) { this.sticky[m] = 0; changed = true; }
    if (changed) this.paint();
  }

  // ── Mouse: Shift-click, Ctrl-click with a latched modifier ────────────
  onPointer(e, isClick = false) {
    if (!this.stickyOn || !e.isTrusted) return;
    const extra = this.active().filter((m) => !e[PROP[m]]);
    if (extra.length) this.addModifiers(e, extra);
    if (isClick || e.type === 'contextmenu') setTimeout(() => this.consume());
  }

  // ── Shift five times ─────────────────────────────────────────────────
  countShift() {
    const now = performance.now();
    this.shiftRun = now - this.shiftRun.at < 800 ? { n: this.shiftRun.n + 1, at: now } : { n: 1, at: now };
    if (this.shiftRun.n >= 5) { this.shiftRun.n = 0; if (this.get('stickyShortcut')) this.onShiftFive(); }
  }

  // ── Indicator ────────────────────────────────────────────────────────
  paint() {
    const on = this.stickyOn;
    if (!on) { this.indicator?.remove(); this.indicator = null; return; }
    if (!this.indicator) {
      // Visual only; the tones (and Narrator, which reads key presses) cover sound.
      this.indicator = h('div.sticky-keys', { 'aria-hidden': 'true' });
      document.body.append(this.indicator);
    }
    this.indicator.replaceChildren(...Object.keys(LABEL).map((m) => h('span', { class: this.sticky[m] === 2 ? 'locked' : this.sticky[m] === 1 ? 'latched' : null }, LABEL[m])));
  }
}
