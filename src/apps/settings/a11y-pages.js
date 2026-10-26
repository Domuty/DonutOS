// Settings › Accessibility pages.

import { h, mount } from '../../ui/h.js';
import { row, section, toggle, select, slider, link } from './controls.js';
import { PAGES } from './index-data.js';
import { CONTRAST_THEMES } from '../../shell/a11y/contrast.js';
import { COLOR_FILTERS } from '../../shell/a11y/color-filters.js';
import { Narrator } from '../../shell/a11y/narrator.js';
import { playSound } from '../../shell/sounds.js';
import { cursorImage } from '../../shell/a11y/cursors.js';

const ICONS = { a11ytext: 'textA', a11yvisual: 'sparkle', a11ypointer: 'arrowRight', a11ymagnifier: 'search', a11ycolor: 'palette', a11ycontrast: 'sun', a11ynarrator: 'volume', a11yaudio: 'info', a11ykeyboard: 'keypad' };

const go = (env, id) => link(ICONS[id], PAGES[id].title, PAGES[id].description, () => env.go(id));

/** Keeps controls tagged with data-key in step with changes made elsewhere (shortcuts, Quick Settings). */
function keepInSync(el, s) {
  return s.watch('a11y.*', (value, key) => {
    for (const input of el.querySelectorAll(`[data-key="${key}"]`)) {
      if (input === document.activeElement && input.type === 'range') continue;
      if (input.type === 'checkbox') {
        input.checked = !!value;
        const state = input.closest('.toggle')?.querySelector('.toggle-state');
        if (state) state.textContent = value ? 'On' : 'Off';
      } else input.value = String(value);
    }
    for (const card of el.querySelectorAll(`[data-choice-key="${key}"]`)) card.setAttribute('aria-checked', String(card.dataset.value === String(value)));
  });
}
const tag = (control, key) => { (control.matches('input, select') ? control : control.querySelector('input, select')).dataset.key = key; return control; };
const tg = (s, key, label) => tag(toggle(s, key, { label }), key);
const sel = (s, key, options, o) => tag(select(s, key, options, o), key);
const sl = (s, key, o) => tag(slider(s, key, o), key);

/** A set of choice cards (radio group). */
function choices(s, key, items, render) {
  return h('div.a11y-choices', { role: 'radiogroup', 'aria-label': PAGES[key]?.title || key },
    items.map(([value, label]) => h('button.a11y-choice', {
      type: 'button', role: 'radio', 'aria-checked': String(s.get(key) === value), dataset: { choiceKey: key, value: String(value) },
      onclick: () => s.set(key, value),
    }, render(value), h('span', label))));
}

export const A11Y_PAGES = {
  accessibility(el, env) {
    mount(el,
      h('div.panel', section('Vision'), ['a11ytext', 'a11yvisual', 'a11ypointer', 'a11ymagnifier', 'a11ycolor', 'a11ycontrast', 'a11ynarrator'].map((id) => go(env, id))),
      h('div.panel', section('Hearing'), go(env, 'a11yaudio')),
      h('div.panel', section('Interaction'), go(env, 'a11ykeyboard')),
      h('p.hint', 'Narrator, Magnifier, the on-screen keyboard, contrast themes and Sticky Keys are also on the sign-in screen (the accessibility button in the corner), and in Quick Settings.'));
  },

  a11ytext(el, { s }) {
    const sample = h('div.a11y-text-sample', h('b', 'The quick brown fox jumps over the lazy dog'), h('p', 'Text size changes the size of text and controls in DonutOS and its apps.'));
    mount(el, sample, h('div.panel',
      row('textA', 'Text size', 'Drag to change it everywhere', slider(s, 'appearance.textScale', { min: 100, max: 225, step: 25, label: 'Text size', format: (v) => `${v}%` }))));
  },

  a11yvisual(el, { s }) {
    mount(el, h('div.panel',
      row('view', 'Show bigger scrollbars', 'Wider scrollbars with more contrast', tg(s, 'a11y.alwaysScrollbars', 'Show bigger scrollbars')),
      row('sparkle', 'Transparency effects', 'Translucent windows and panels', toggle(s, 'appearance.transparency', { label: 'Transparency effects' })),
      row('activity', 'Animation effects', 'Turn off to stop windows, menus and panels from moving', toggle(s, 'appearance.animations', { label: 'Animation effects' })),
      row('info', 'Dismiss notifications after this amount of time', null, sel(s, 'a11y.notificationSeconds', [[6, '6 seconds'], [10, '10 seconds'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes']], { label: 'Notification timeout' })),
      section('Focus indicator'),
      row('selectRect', 'Make the focus indicator thicker', 'A bold outline and halo around whatever has keyboard focus', tg(s, 'a11y.focusRing', 'Thick focus indicator'))));
    return keepInSync(el, s);
  },

  a11ypointer(el, { s }) {
    const preview = (color) => h('span.a11y-cursor-preview', h('img', { src: cursorImage('default', 40, color, s.get('appearance.accent')), alt: '' }), h('img', { src: cursorImage('pointer', 40, color, s.get('appearance.accent')), alt: '' }));
    mount(el, h('div.panel',
      row('arrowRight', 'Size', 'Makes the mouse pointer bigger', sl(s, 'a11y.cursorSize', { min: 1, max: 3, step: 0.5, label: 'Pointer size', format: (v) => (v === 1 ? 'Standard' : `${v}×`) })),
      section('Colour'),
      choices(s, 'a11y.cursorColor', [['white', 'White'], ['black', 'Black'], ['accent', 'Accent colour']], preview),
      h('p.hint', 'Resize pointers on window edges also grow. Pointers inside web pages in Browser keep the website’s own pointers.')));
    return keepInSync(el, s);
  },

  a11ymagnifier(el, { s }) {
    const zooms = [125, 150, 175, 200, 250, 300, 400, 500, 600, 800];
    mount(el, h('div.panel',
      row('search', 'Magnifier', 'Win+Plus or Ctrl+Alt+= turns it on; Win+Esc or Ctrl+Alt+Esc turns it off', tg(s, 'a11y.magnifier', 'Magnifier')),
      row(null, 'Zoom level', 'Win+Plus and Win+Minus change it while Magnifier is on', sel(s, 'a11y.magnifierZoom', [...new Set([...zooms, s.get('a11y.magnifierZoom')])].sort((a, b) => a - b).map((z) => [z, `${z}%`]), { label: 'Zoom level' })),
      row(null, 'Zoom increment', null, sel(s, 'a11y.magnifierStep', [[25, '25%'], [50, '50%'], [100, '100%'], [200, '200%']], { label: 'Zoom increment' })),
      h('p.hint', 'Magnifier follows the mouse pointer and, when you use the keyboard, the item with keyboard focus.')));
    // The zoom list includes the current value, which shortcuts can change to any step.
    const off = s.watch('a11y.magnifierZoom', () => A11Y_PAGES.a11ymagnifier(el, { s }));
    const sync = keepInSync(el, s);
    return () => { off(); sync(); };
  },

  a11ycolor(el, { s }) {
    const swatch = (type) => h('span.a11y-filter-preview', { dataset: { filter: type } });
    mount(el, h('div.panel',
      row('palette', 'Colour filters', 'Change colours on the whole screen', tg(s, 'a11y.colorFilter', 'Colour filters')),
      section('Filter'),
      choices(s, 'a11y.colorFilterType', Object.entries(COLOR_FILTERS), swatch),
      row('keypad', 'Keyboard shortcut for colour filters', 'Win+Ctrl+C or Ctrl+Alt+Shift+C turns the filter on or off', tg(s, 'a11y.colorFilterShortcut', 'Colour filter shortcut'))));
    return keepInSync(el, s);
  },

  a11ycontrast(el, { s }) {
    const preview = (id) => {
      const t = CONTRAST_THEMES[id];
      return h('span.a11y-contrast-preview', { style: { background: t.bg, color: t.text, borderColor: t.text } },
        h('b', 'Aa'), h('i', { style: { color: t.link } }, 'link'), h('em', { style: { background: t.selBg, color: t.selText } }, 'selected'), h('u', { style: { color: t.btnText, borderColor: t.text } }, 'button'));
    };
    mount(el, h('div.panel',
      row('sun', 'Contrast theme', 'Alt+Shift+Print Screen or Ctrl+Alt+Shift+H turns it on or off', tg(s, 'a11y.highContrast', 'Contrast theme')),
      section('Theme'),
      choices(s, 'a11y.contrastTheme', Object.entries(CONTRAST_THEMES).map(([id, t]) => [id, t.name]), preview),
      h('p.hint', 'Contrast themes use solid colours, turn off transparency and replace the desktop picture with a plain background.')));
    return keepInSync(el, s);
  },

  a11ynarrator(el, { s }) {
    const voiceSel = h('select.input', { style: { width: '260px' }, 'aria-label': 'Voice', dataset: { key: 'a11y.narratorVoice' }, onchange: (e) => s.set('a11y.narratorVoice', e.target.value) });
    const fillVoices = () => {
      const voices = Narrator.voices();
      const cur = s.get('a11y.narratorVoice');
      mount(voiceSel, h('option', { value: '', selected: !cur }, voices.length ? 'Default voice' : 'No voices installed on this device'),
        voices.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === cur }, `${v.name} (${v.lang})`)));
      voiceSel.disabled = !voices.length;
    };
    fillVoices();
    const onVoices = () => fillVoices();
    globalThis.speechSynthesis?.addEventListener?.('voiceschanged', onVoices);
    const test = () => {
      if (typeof speechSynthesis === 'undefined') return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance('Hello! This is how Narrator sounds.');
      u.rate = s.get('a11y.narratorRate');
      const v = Narrator.voices().find((x) => x.voiceURI === s.get('a11y.narratorVoice'));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    };
    mount(el, h('div.panel',
      row('volume', 'Narrator', 'Ctrl+Alt+Enter or Win+Ctrl+Enter turns it on or off', tg(s, 'a11y.narrator', 'Narrator')),
      section('Voice'),
      row(null, 'Voice', 'Voices come from your device (or browser)', voiceSel),
      row(null, 'Speed', null, sl(s, 'a11y.narratorRate', { min: 0.5, max: 2, step: 0.1, label: 'Narrator speed', format: (v) => `${Math.round(v * 100)}%` })),
      row(null, 'Hear a sample', null, h('button.btn', { type: 'button', onclick: test }, 'Play')),
      section('What Narrator reads'),
      row('keypad', 'Read what I type', null, sel(s, 'a11y.narratorKeyEcho', [['none', 'Nothing'], ['chars', 'Characters'], ['words', 'Words']], { label: 'Read what I type' })),
      row('arrowRight', 'Read what’s under the mouse pointer', null, tg(s, 'a11y.narratorHover', 'Read under the pointer')),
      row('view', 'Show what Narrator says on screen', 'Captions at the bottom of the screen', tg(s, 'a11y.narratorCaptions', 'Narrator captions')),
      section('Narrator key and commands'),
      row('keypad', 'Narrator key', null, sel(s, 'a11y.narratorKey', [['insert', 'Insert'], ['capslock', 'Caps Lock'], ['both', 'Insert or Caps Lock']], { label: 'Narrator key' })),
      h('div.a11y-commands', [
        ['Ctrl', 'Stop speaking'], ['Narrator + Tab', 'Read the current item'], ['Narrator + T', 'Read the window title'],
        ['Narrator + W', 'Read the whole window'], ['Narrator + = / −', 'Speak faster / slower'], ['Narrator + F1', 'List the commands'],
      ].map(([k, d]) => h('div', h('kbd', k), h('span', d)))),
      h('p.hint', 'With Caps Lock as the Narrator key, pressing it also turns Caps Lock on or off. Narrator works with DonutOS, its apps and Store apps; web pages shown in Browser aren’t read.')));
    const sync = keepInSync(el, s);
    return () => { sync(); globalThis.speechSynthesis?.removeEventListener?.('voiceschanged', onVoices); };
  },

  a11yaudio(el, { s }) {
    mount(el, h('div.panel',
      row('info', 'Flash the screen when a sound plays', 'The active window’s title bar flashes (or the whole screen, when no window is open)', tg(s, 'a11y.flashOnSound', 'Flash for sounds')),
      row(null, 'Test', null, h('button.btn', { type: 'button', onclick: () => playSound('notify', s) }, 'Play a sound'))));
    return keepInSync(el, s);
  },

  a11ykeyboard(el, { s }) {
    mount(el, h('div.panel',
      row('keypad', 'Sticky Keys', 'Press Shift, Ctrl or Alt one at a time for shortcuts (twice to lock)', tg(s, 'a11y.stickyKeys', 'Sticky Keys')),
      row(null, 'Turn Sticky Keys on or off by pressing Shift five times', null, tg(s, 'a11y.stickyShortcut', 'Sticky Keys shortcut')),
      section('Bounce Keys'),
      row('keypad', 'Bounce Keys', 'Ignore a key pressed again too soon after it was released', tg(s, 'a11y.bounceKeys', 'Bounce Keys')),
      row(null, 'Ignore repeats within', null, sl(s, 'a11y.bounceMs', { min: 200, max: 2000, step: 100, label: 'Bounce Keys delay', format: (v) => `${(v / 1000).toFixed(1)} s` })),
      section('More'),
      row('volume', 'Toggle Keys', 'Play a tone for Caps Lock, Num Lock and Scroll Lock (high for on, low for off)', tg(s, 'a11y.toggleKeys', 'Toggle Keys')),
      row('keypad', 'On-screen keyboard', 'Win+Ctrl+O or Ctrl+Alt+O', tg(s, 'a11y.osk', 'On-screen keyboard')),
      h('p.hint', 'Sticky Keys doesn’t latch the Win key: use a shortcut’s Ctrl+Alt form instead (see Settings › System › Keyboard shortcuts).')));
    return keepInSync(el, s);
  },
};

