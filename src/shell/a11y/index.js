// Accessibility for the whole device: keeps Magnifier, Narrator, the on-screen keyboard,
// colour filters, pointer size, Sticky/Bounce/Toggle Keys and visual sound notifications in
// line with the active user's settings (or the sign-in screen's), and owns their shortcuts.
// Contrast themes, the focus indicator and scrollbars are applied with the theme (theme.js).

import { a11yGet, a11ySet } from './prefs.js';
import { applyCursors } from './cursors.js';
import { installColorFilterDefs } from './color-filters.js';
import { Magnifier, ZOOM_MIN, ZOOM_MAX } from './magnifier.js';
import { Narrator } from './narrator.js';
import { KeyboardAids } from './keyboard.js';
import { OnScreenKeyboard } from './osk.js';
import { onSound } from '../sounds.js';
import { a11yChannel } from './channel.js';
import { h } from '../../ui/h.js';
import { dialog } from '../../ui/dialog.js';

export class Accessibility {
  constructor(kernel, { openSettings, inSession }) {
    this.kernel = kernel;
    this.openSettings = openSettings;
    this.inSession = inSession;
    const s = kernel.settings;
    this.get = (name) => a11yGet(s, name);
    this.set = (name, value) => a11ySet(s, name, value);
    installColorFilterDefs();
    // Keyboard aids first: they adjust key events before shortcuts and apps see them.
    this.keys = new KeyboardAids({ get: this.get, onShiftFive: () => this.askStickyKeys() });
    this.magnifier = new Magnifier({ onZoom: (dir) => this.zoomBy(dir), onClose: () => this.set('magnifier', false) });
    this.narrator = new Narrator({ get: this.get, set: this.set });
    this.osk = new OnScreenKeyboard({
      getTop: () => this.get('oskTop'),
      setTop: (v) => this.set('oskTop', v),
      onClose: () => this.set('osk', false),
      sendToWebview: (wv, ev) => kernel.platform.browser.sendKey(wv.getWebContentsId(), ev).catch(() => {}),
    });
    s.watch('a11y.*', () => this.apply());
    s.watch('appearance.accent', () => this.apply());
    kernel.bus.on('session:changed', () => this.apply());
    onSound(() => this.flash());
    a11yChannel.on('say', ({ text, interrupt }) => this.narrator.say(text, { interrupt }));
    this.registerShortcuts();
    this.apply();
  }

  apply() {
    const g = this.get;
    applyCursors({ size: g('cursorSize'), color: g('cursorColor'), accent: this.kernel.settings.currentUser ? this.kernel.settings.get('appearance.accent') : '#e8618c' });
    const root = document.documentElement;
    if (g('colorFilter')) root.dataset.colorFilter = g('colorFilterType'); else delete root.dataset.colorFilter;
    if (g('magnifier')) { if (this.magnifier.on) this.magnifier.setZoom(g('magnifierZoom')); else this.magnifier.start(g('magnifierZoom')); } else this.magnifier.stop();
    if (g('narrator')) this.narrator.start(); else this.narrator.stop();
    if (g('osk')) this.osk.show(); else this.osk.hide();
    this.keys.refresh();
  }

  zoomBy(dir) {
    const step = this.get('magnifierStep');
    if (!this.get('magnifier')) { if (dir > 0) this.set('magnifier', true); return; }
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.get('magnifierZoom') + dir * step));
    this.set('magnifierZoom', z);
  }

  toggle(name) { this.set(name, !this.get(name)); }

  /** Visual notification instead of (or as well as) a sound. */
  flash() {
    if (!this.get('flashOnSound')) return;
    const win = document.querySelector('.session:not([hidden]) .win.active');
    if (win) {
      win.classList.remove('flash'); void win.offsetWidth; win.classList.add('flash');
      setTimeout(() => win.classList.remove('flash'), 1000);
    } else {
      const f = h('div.sound-flash', { 'aria-hidden': 'true' });
      document.body.append(f);
      setTimeout(() => f.remove(), 500);
    }
  }

  async askStickyKeys() {
    if (this.asking) return;
    this.asking = true;
    const on = this.get('stickyKeys');
    const answer = await dialog({
      title: on ? 'Turn off Sticky Keys?' : 'Turn on Sticky Keys?',
      body: h('p', on ? 'You pressed Shift five times.' : 'Sticky Keys lets you use Shift, Ctrl and Alt by pressing one key at a time — for example Ctrl, then C to copy. You turned this on by pressing Shift five times.'),
      buttons: [{ label: 'Yes', value: true, primary: true }, { label: 'No', value: false }, ...(this.inSession() ? [{ label: 'Settings…', value: 'settings' }] : [])],
      cancelValue: false,
    }).finally(() => { this.asking = false; });
    if (answer === true) this.set('stickyKeys', !on);
    else if (answer === 'settings') this.openSettings('a11ykeyboard');
  }

  registerShortcuts() {
    const sc = this.kernel.shortcuts;
    const add = (id, keys, description, handler, extra = {}) => sc.register(id, { keys, description, handler, group: 'Accessibility', inInputs: true, ...extra });
    add('a11y.zoomIn', ['Meta+Equal', 'Ctrl+Alt+Equal'], 'Magnifier: turn on or zoom in', () => this.zoomBy(1));
    add('a11y.zoomOut', ['Meta+Minus', 'Ctrl+Alt+Minus'], 'Magnifier: zoom out', () => this.zoomBy(-1), { when: () => this.get('magnifier') });
    add('a11y.zoomOff', ['Meta+Escape', 'Ctrl+Alt+Escape'], 'Turn Magnifier off', () => this.set('magnifier', false), { when: () => this.get('magnifier') });
    add('a11y.narrator', ['Ctrl+Meta+Enter', 'Ctrl+Alt+Enter'], 'Turn Narrator on or off', () => this.toggle('narrator'));
    add('a11y.osk', ['Ctrl+Meta+O', 'Ctrl+Alt+O'], 'On-screen keyboard', () => this.toggle('osk'));
    add('a11y.contrast', ['Alt+Shift+PrintScreen', 'Ctrl+Alt+Shift+H'], 'Turn the contrast theme on or off', () => this.toggle('highContrast'));
    add('a11y.colorFilter', ['Ctrl+Meta+C', 'Ctrl+Alt+Shift+C'], 'Turn colour filters on or off (when allowed in Settings)', () => this.toggle('colorFilter'),
      { when: () => this.kernel.settings.currentUser && this.kernel.settings.get('a11y.colorFilterShortcut') });
    add('a11y.settings', ['Meta+U', 'Ctrl+Alt+U'], 'Accessibility settings', () => this.openSettings('accessibility'), { when: () => this.inSession(), inInputs: false });
  }
}
