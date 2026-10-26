// On-screen keyboard: type with the mouse, a touch screen or a head pointer.
//
// Keys go to whatever has keyboard focus. Pressing a key never takes focus away from it.
// Each press is delivered as a key event, so shortcuts and app keys work, then typed or
// acted on (editing, Tab, Enter…) the way the real key would.
//   Shift: once for the next key, twice to lock. Caps: capitals until pressed again.
//   Ctrl / Alt: held for the next key (Ctrl+C, Ctrl+Alt+E…). Win: opens Start.
// Sandboxed Store apps get the keys through their frame. Desktop Browser pages get real key
// presses (send). Web pages in the web version's Browser are cross-origin frames that can't
// receive typing from DonutOS.

import { h } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { isEditable, performKey, SHIFTED } from './edit-actions.js';
import { a11yChannel } from './channel.js';

const ROWS = [
  [['Escape', 'Esc', 1.2, 'fn'], '`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', ['Backspace', '⌫', 1.8, 'fn']],
  [['Tab', 'Tab', 1.5, 'fn'], 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', ['\\', '\\', 1.4]],
  [['CapsLock', 'Caps', 1.8, 'mod'], 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", ['Enter', 'Enter', 2.1, 'fn']],
  [['Shift', 'Shift', 2.3, 'mod'], 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', ['Shift', 'Shift', 2.3, 'mod']],
  [['Control', 'Ctrl', 1.4, 'mod'], ['Meta', 'Win', 1.2, 'fn'], ['Alt', 'Alt', 1.2, 'mod'], [' ', 'Space', 6.5], ['Delete', 'Del', 1.2, 'fn'], ['ArrowLeft', '←', 1, 'fn'], ['ArrowUp', '↑', 1, 'fn'], ['ArrowDown', '↓', 1, 'fn'], ['ArrowRight', '→', 1, 'fn']],
];

const CODE = (key) => {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return { '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash', ' ': 'Space' }[key] || key;
};

export class OnScreenKeyboard {
  constructor({ getTop, setTop, onClose, sendToWebview }) {
    this.getTop = getTop;
    this.setTop = setTop;
    this.onClose = onClose;
    this.sendToWebview = sendToWebview;
    this.el = null;
    this.mods = { shift: 0, ctrl: 0, alt: 0 }; // 0 off, 1 next key, 2 locked
    this.caps = false;
    this.repeat = null;
  }

  get open() { return !!this.el; }

  // Where typing goes: clicking a key can move focus off a web page or app frame (they're
  // separate documents), so the last thing that had focus is remembered.
  #track = (e) => { if (!this.el?.contains(e.target) && e.target !== document.body) this.lastTarget = e.target; };

  show() {
    if (this.el) return;
    this.el = h('div.osk', { role: 'group', 'aria-label': 'On-screen keyboard', class: this.getTop() && 'top' },
      h('div.osk-head', icon('keypad', { size: 14 }), h('span.grow', 'On-screen keyboard'),
        h('button.tb-btn', { type: 'button', tabindex: '-1', title: this.getTop() ? 'Move to the bottom' : 'Move to the top', 'aria-label': 'Move keyboard', onclick: () => { this.setTop(!this.getTop()); this.el.classList.toggle('top', this.getTop()); } }, icon(this.getTop() ? 'chevronDown' : 'chevronUp', { size: 14 })),
        h('button.tb-btn', { type: 'button', tabindex: '-1', title: 'Close (Win+Ctrl+O)', 'aria-label': 'Close the on-screen keyboard', onclick: () => this.onClose() }, icon('close', { size: 14 }))),
      ROWS.map((row) => h('div.osk-row', row.map((k) => this.keyEl(k)))));
    // Keep focus where it is: pressing keys must not focus the keyboard.
    this.el.addEventListener('pointerdown', (e) => { e.preventDefault(); });
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
    document.addEventListener('focusin', this.#track, true);
    this.lastTarget = document.activeElement !== document.body ? document.activeElement : null;
    this.paint();
  }

  hide() {
    document.removeEventListener('focusin', this.#track, true);
    this.stopRepeat();
    this.el?.remove();
    this.el = null;
  }

  keyEl(spec) {
    const [key, label, width = 1, kind = 'char'] = typeof spec === 'string' ? [spec, spec, 1, 'char'] : spec;
    const b = h('button.osk-key', { type: 'button', tabindex: '-1', class: kind !== 'char' && kind, dataset: { key }, style: { flexGrow: String(width) }, 'aria-label': key === ' ' ? 'Space' : label },
      kind === 'char' && SHIFTED[key] ? [h('small', SHIFTED[key]), label] : label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('down');
      this.press(key);
      if (kind !== 'mod' && key !== 'Meta' && key !== 'Escape') {
        this.repeat = setTimeout(function again() { this.press(key); this.repeat = setTimeout(again.bind(this), 60); }.bind(this), 500);
      }
    });
    const up = () => { b.classList.remove('down'); this.stopRepeat(); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
    return b;
  }

  stopRepeat() { clearTimeout(this.repeat); this.repeat = null; }

  paint() {
    if (!this.el) return;
    const upper = (this.mods.shift > 0) !== this.caps;
    for (const b of this.el.querySelectorAll('.osk-key')) {
      const k = b.dataset.key;
      if (k.length === 1 && /[a-z]/.test(k)) b.textContent = upper ? k.toUpperCase() : k;
      const m = { Shift: 'shift', Control: 'ctrl', Alt: 'alt' }[k];
      if (m) { b.classList.toggle('latched', this.mods[m] === 1); b.classList.toggle('locked', this.mods[m] === 2); b.setAttribute('aria-pressed', String(this.mods[m] > 0)); }
      if (k === 'CapsLock') { b.classList.toggle('locked', this.caps); b.setAttribute('aria-pressed', String(this.caps)); }
    }
  }

  press(key) {
    const modName = { Shift: 'shift', Control: 'ctrl', Alt: 'alt' }[key];
    if (modName) { this.mods[modName] = (this.mods[modName] + 1) % 3; this.paint(); return; }
    if (key === 'CapsLock') { this.caps = !this.caps; this.paint(); return; }
    const mods = { ctrl: this.mods.ctrl > 0, alt: this.mods.alt > 0, shift: this.mods.shift > 0, meta: false };
    let out = key;
    if (key.length === 1) {
      if (/[a-z]/.test(key)) { if (mods.shift !== this.caps) out = key.toUpperCase(); }
      else if (mods.shift) out = SHIFTED[key] ?? key;
    }
    if (key === 'Meta') this.send('Meta', 'MetaLeft', { ...mods, meta: true }, true);
    else this.send(out, CODE(key), mods);
    for (const m of Object.keys(this.mods)) if (this.mods[m] === 1) this.mods[m] = 0;
    this.paint();
  }

  send(key, code, mods, metaAlone = false) {
    let target = document.activeElement || document.body;
    if ((target === document.body || target === document.documentElement || this.el?.contains(target)) && this.lastTarget?.isConnected) {
      target = this.lastTarget;
      target.focus?.({ preventScroll: true });
    }
    // A Store app's frame or a desktop Browser page has focus: hand the key over.
    if (target.tagName === 'IFRAME' && target.classList.contains('sandbox-frame')) { a11yChannel.emit('key', { frame: target, key, code, mods }); return; }
    if (target.tagName === 'WEBVIEW') { this.sendToWebview?.(target, { key, code, mods }); return; }
    if (target === document.documentElement) target = document.body;
    const init = { key, code, ctrlKey: mods.ctrl, altKey: mods.alt, shiftKey: mods.shift, metaKey: mods.meta, bubbles: true, cancelable: true, composed: true };
    if (metaAlone) {
      // Press and release Win: opens Start, as the real key does.
      target.dispatchEvent(new KeyboardEvent('keydown', { ...init, metaKey: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { ...init, metaKey: false }));
      return;
    }
    const down = new KeyboardEvent('keydown', init);
    const handled = !target.dispatchEvent(down);
    if (!handled) {
      // Characters also get keypress/beforeinput through insertText; other keys act directly.
      performKey(target, { key, mods }).catch(() => {});
      if (!isEditable(target) && key.length === 1 && !mods.ctrl && !mods.alt) target.dispatchEvent(new KeyboardEvent('keypress', init));
    }
    target.dispatchEvent(new KeyboardEvent('keyup', init));
  }
}
