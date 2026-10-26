// Narrator: DonutOS's screen reader. It speaks with the device's own voices (Web Speech).
//
// It reads what gets keyboard focus (with the window or dialog it's in), what you type,
// changes to check boxes, sliders and lists, and live announcements (toasts, status text).
// It can also read what's under the mouse pointer, and show what it says as captions.
//
// Commands (Narrator key = Insert, or Caps Lock if chosen in Settings):
//   Ctrl              stop speaking
//   Narrator + Tab    read the current item again
//   Narrator + T      read the window title
//   Narrator + W      read the whole window
//   Narrator + = / -  speak faster / slower
//   Narrator + F1     list these commands

import { h } from '../../ui/h.js';
import { describe, nameOf } from '../../ui/a11y-name.js';

const COMMANDS = 'Narrator commands. Control: stop speaking. Narrator key plus Tab: read the current item. Narrator key plus T: read the window title. Narrator key plus W: read the whole window. Narrator key plus equals or minus: speak faster or slower. The Narrator key is Insert, or Caps Lock if you chose it in Settings.';

const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();

export class Narrator {
  constructor({ get, set }) {
    this.get = get;   // (name) => a11y preference
    this.set = set;
    this.on = false;
    this.lastContext = null;
    this.lastHover = null;
    this.caption = null;
    this.focusBox = null;
    this.focused = null;
    this.narratorDown = false;
    this.wordBuf = '';
    this.timers = new Set();
    this.observer = null;
    this.voicesReady = false;
    this.h = {
      focus: (e) => this.onFocus(e.target),
      input: (e) => this.onInput(e),
      change: (e) => this.onChange(e.target),
      keydown: (e) => this.onKeyDown(e),
      keyup: (e) => this.onKeyUp(e),
      move: (e) => this.onPointer(e),
      reposition: () => this.drawFocus(),
    };
  }

  /** Voices installed on this device (they can load a moment after start). */
  static voices() { return typeof speechSynthesis === 'undefined' ? [] : speechSynthesis.getVoices(); }

  start() {
    if (this.on) return;
    this.on = true;
    document.addEventListener('focusin', this.h.focus, true);
    document.addEventListener('input', this.h.input, true);
    document.addEventListener('change', this.h.change, true);
    addEventListener('keydown', this.h.keydown, true);
    addEventListener('keyup', this.h.keyup, true);
    addEventListener('pointermove', this.h.move, { capture: true, passive: true });
    addEventListener('scroll', this.h.reposition, true);
    addEventListener('resize', this.h.reposition);
    this.boxTimer = setInterval(this.h.reposition, 400);
    this.observeLive();
    this.say('Narrator is on. Press the Narrator key plus F1 for commands.', { interrupt: true });
    if (document.activeElement && document.activeElement !== document.body) setTimeout(() => this.onFocus(document.activeElement), 600);
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    document.removeEventListener('focusin', this.h.focus, true);
    document.removeEventListener('input', this.h.input, true);
    document.removeEventListener('change', this.h.change, true);
    removeEventListener('keydown', this.h.keydown, true);
    removeEventListener('keyup', this.h.keyup, true);
    removeEventListener('pointermove', this.h.move, true);
    removeEventListener('scroll', this.h.reposition, true);
    removeEventListener('resize', this.h.reposition);
    clearInterval(this.boxTimer);
    this.observer?.disconnect();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.focusBox?.remove(); this.focusBox = null;
    // Say goodbye even though Narrator is now off.
    this.speakRaw('Narrator off', true);
    setTimeout(() => { this.caption?.remove(); this.caption = null; }, 1500);
  }

  // ── Speech ───────────────────────────────────────────────────────────
  say(text, { interrupt = false } = {}) {
    if (!this.on || !text) return;
    this.speakRaw(text, interrupt);
  }

  speakRaw(text, interrupt) {
    text = String(text).replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (this.get('narratorCaptions')) this.showCaption(text);
    if (typeof speechSynthesis === 'undefined') return;
    if (interrupt) speechSynthesis.cancel();
    const voices = Narrator.voices();
    const wanted = this.get('narratorVoice');
    const voice = voices.find((v) => v.voiceURI === wanted || v.name === wanted) || null;
    // Long text is split into sentences: some engines stop after ~15 seconds of one utterance.
    for (const part of text.match(/[^.!?]+[.!?]*\s*|.+$/g).reduce((acc, s) => {
      if (acc.length && (acc[acc.length - 1] + s).length < 220) acc[acc.length - 1] += s; else acc.push(s);
      return acc;
    }, [])) {
      const u = new SpeechSynthesisUtterance(part.trim());
      u.rate = this.get('narratorRate');
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = document.documentElement.lang || navigator.language;
      speechSynthesis.speak(u);
    }
  }

  silence() { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }

  showCaption(text) {
    if (!this.caption) {
      this.caption = h('div.narrator-captions', { 'aria-hidden': 'true' });
      document.documentElement.append(this.caption);
    }
    this.caption.textContent = text;
    clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => { if (this.caption) this.caption.textContent = ''; this.caption?.remove(); this.caption = null; }, Math.max(2500, text.length * 70));
  }

  // ── What to say ──────────────────────────────────────────────────────
  context(el) {
    const dlg = el.closest?.('[role="dialog"], [role="alertdialog"]');
    if (dlg) return { el: dlg, text: `${dlg.getAttribute('aria-label') || textOf(dlg.querySelector('h1, h2'))}, dialog` };
    const menu = el.closest?.('[role="menu"]');
    if (menu) return { el: menu, text: 'menu' };
    const win = el.closest?.('.win');
    if (win) return { el: win, text: `${textOf(win.querySelector('.win-title')) || win.getAttribute('aria-label') || 'Window'}, window` };
    const region = el.closest?.('[aria-label][role="region"], [aria-label][role="dialog"], .flyout[aria-label], nav[aria-label], [role="toolbar"][aria-label]');
    if (region) return { el: region, text: region.getAttribute('aria-label') };
    return null;
  }

  onFocus(el) {
    if (!el || el === document.body || el === document.documentElement) return;
    // Focus inside a sandboxed app frame: the frame itself has the focus here.
    this.focused = el;
    this.drawFocus();
    const ctx = this.context(el);
    const parts = [];
    if (ctx && ctx.el !== this.lastContext) parts.push(ctx.text);
    this.lastContext = ctx?.el || null;
    parts.push(describe(el));
    this.wordBuf = '';
    this.say(parts.filter(Boolean).join(', '), { interrupt: true });
  }

  onInput(e) {
    const el = e.target;
    if (el.type === 'range') { this.later('range', () => this.say(describe(el), { interrupt: true }), 150); return; }
    const echo = this.get('narratorKeyEcho');
    if (echo === 'none' || !e.inputType?.startsWith('insert') || e.data == null) return;
    if (el.type === 'password') { this.say('star', { interrupt: true }); return; }
    if (echo === 'chars') this.say(e.data === ' ' ? 'space' : e.data, { interrupt: true });
    else {
      this.wordBuf += e.data;
      if (/[\s.,;:!?]$/.test(this.wordBuf)) { this.say(this.wordBuf.trim(), { interrupt: true }); this.wordBuf = ''; }
    }
  }

  onChange(el) {
    if (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') this.say(describe(el), { interrupt: true });
  }

  later(key, fn, ms) {
    clearTimeout(this[`t_${key}`]);
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this[`t_${key}`] = t;
    this.timers.add(t);
  }

  // Live regions: toasts, status text, alerts.
  observeLive() {
    const pending = new Map();
    const flush = () => {
      for (const [region, text] of pending) {
        const assertive = region.getAttribute('aria-live') === 'assertive' || region.getAttribute('role') === 'alert';
        this.say(text.slice(0, 400), { interrupt: assertive });
      }
      pending.clear();
    };
    this.observer = new MutationObserver((records) => {
      for (const r of records) {
        const node = r.type === 'characterData' ? r.target.parentElement : r.target;
        const region = node?.closest?.('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"]');
        if (!region || region.closest('[aria-hidden="true"], [hidden], [inert]')) continue;
        let text;
        if (region.getAttribute('aria-atomic') === 'true' || r.type === 'characterData') text = textOf(region);
        else text = [...r.addedNodes].map((n) => (n.nodeType === 3 ? n.textContent : textOf(n))).join(' ').trim();
        if (text) pending.set(region, text);
      }
      if (pending.size) this.later('live', flush, 120);
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // Mouse: read what's under the pointer once it rests.
  onPointer(e) {
    if (!this.get('narratorHover') || e.pointerType === 'touch') return;
    const { clientX: x, clientY: y } = e;
    this.later('hover', () => {
      const at = document.elementFromPoint(x, y);
      const el = at?.closest?.('button, a, input, select, textarea, [role], h1, h2, h3, h4, h5, h6, label, li, p, .t, .d, img[alt]');
      if (!el || el === this.lastHover) return;
      this.lastHover = el;
      this.say(describe(el) || textOf(el).slice(0, 200), { interrupt: true });
    }, 180);
  }

  // ── Commands ─────────────────────────────────────────────────────────
  isNarratorKey(e) {
    const k = this.get('narratorKey');
    return (e.key === 'Insert' && k !== 'capslock') || (e.key === 'CapsLock' && k !== 'insert');
  }

  onKeyDown(e) {
    if (e.key === 'Control' && !e.repeat) this.silence();
    if (this.isNarratorKey(e)) { this.narratorDown = true; if (e.key === 'Insert') e.preventDefault(); return; }
    if (!this.narratorDown) return;
    const win = document.activeElement?.closest?.('.win') || document.querySelector('.win.active');
    const run = {
      Tab: () => this.say(describe(this.focused || document.activeElement) || 'Nothing is focused', { interrupt: true }),
      KeyT: () => this.say(win ? `${textOf(win.querySelector('.win-title')) || 'Untitled'}, window` : 'Desktop', { interrupt: true }),
      KeyW: () => this.say(win ? `${textOf(win.querySelector('.win-title'))}. ${textOf(win.querySelector('.win-body')).slice(0, 2500)}` : 'No window is open', { interrupt: true }),
      Equal: () => this.rate(0.1),
      NumpadAdd: () => this.rate(0.1),
      Minus: () => this.rate(-0.1),
      NumpadSubtract: () => this.rate(-0.1),
      F1: () => this.say(COMMANDS, { interrupt: true }),
    }[e.code];
    if (run) { e.preventDefault(); e.stopImmediatePropagation(); run(); }
  }

  onKeyUp(e) { if (this.isNarratorKey(e)) this.narratorDown = false; }

  rate(delta) {
    const r = Math.round(Math.max(0.5, Math.min(2, this.get('narratorRate') + delta)) * 10) / 10;
    this.set('narratorRate', r);
    this.say(`Speed ${Math.round(r * 100)} percent`, { interrupt: true });
  }

  // A box around what Narrator is reading.
  drawFocus() {
    const el = this.focused;
    if (!this.on || !el?.isConnected || el === document.body) { this.focusBox?.remove(); this.focusBox = null; return; }
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) { if (this.focusBox) this.focusBox.hidden = true; return; }
    if (!this.focusBox) { this.focusBox = h('div.narrator-focus', { 'aria-hidden': 'true' }); document.documentElement.append(this.focusBox); }
    this.focusBox.hidden = false;
    Object.assign(this.focusBox.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
  }

  /** For tests and the Settings preview. */
  static describe(el) { return describe(el); }
  static nameOf(el) { return nameOf(el); }
}
