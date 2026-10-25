// The clipboard & emoji panel (Win+V / Win+.): clipboard history, emoji with search and
// skin tones, and symbols. Picking an item types it where you were typing.

import { h, mount } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { relTime } from './start-menu.js';

const SYMBOLS = [
  ['General', '•·°±×÷≈≠≤≥∞√∑∏∫∂∆µπΩ‰%‱'], ['Currency', '$€£¥¢₹₽₩₺₴₦₫฿₿'], ['Arrows', '←↑→↓↔↕⇐⇑⇒⇓⇔↩↪⤴⤵↻↺'],
  ['Punctuation', '–—…‘’“”‹›«»¡¿§¶†‡※‽'], ['Shapes', '■□▪▫▲△▼▽◆◇○●◎★☆♠♣♥♦✓✔✗✘'], ['Math letters', 'αβγδεζηθικλνξρστυφχψω'],
  ['Fractions', '½⅓⅔¼¾⅕⅛⅜⅝⅞'], ['Super/sub', '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻₀₁₂₃₄₅₆₇₈₉'], ['Legal', '©®™℗℠'],
];

export class ClipboardPanel {
  constructor(session) {
    this.s = session;
    this.kernel = session.kernel;
    this.settings = session.settings;
    this.tab = 'emoji';
    this.target = null;
    // This panel floats above other flyouts (you may be typing in Search), so it manages
    // its own open/close instead of joining the one-flyout-at-a-time group.
    this.f = { el: h('div.flyout.fly-clip.hidden', { role: 'dialog', 'aria-label': 'Emoji and clipboard', 'aria-hidden': 'true', 'data-flyout-keep': '' }) };
    session.flyoutLayer.append(this.f.el);
    this.isOpen = false;
    this.onDown = (e) => { if (this.isOpen && !this.f.el.contains(e.target) && !e.target.closest('.menu')) this.close(); };
    this.onKey = (e) => { if (this.isOpen && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); this.target?.el?.focus(); } };
    document.addEventListener('pointerdown', this.onDown, true);
    document.addEventListener('keydown', this.onKey, true);
    this.offs = [this.kernel.bus.on('clipboard:changed', () => { if (this.isOpen && this.tab === 'clipboard') this.render(); })];
  }

  open(tab) {
    this.tab = tab || this.tab;
    this.isOpen = true;
    this.position();
    this.f.el.classList.remove('hidden');
    this.f.el.setAttribute('aria-hidden', 'false');
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.f.el.classList.add('hidden');
    this.f.el.setAttribute('aria-hidden', 'true');
  }

  /** Opens next to wherever the user was typing, remembering the caret. */
  openFor(tab) {
    const el = document.activeElement;
    const editable = el && (el.isContentEditable || (/^(INPUT|TEXTAREA)$/.test(el.tagName) && !['checkbox', 'radio', 'range', 'button', 'color', 'file'].includes(el.type)));
    this.target = editable ? { el, start: el.selectionStart, end: el.selectionEnd, range: el.isContentEditable ? getSelection().rangeCount && getSelection().getRangeAt(0).cloneRange() : null } : null;
    if (this.isOpen && this.tab === tab) { this.close(); return; }
    this.open(tab);
  }

  position() {
    const el = this.f.el;
    const r = this.target?.el?.getBoundingClientRect();
    const w = 360, hh = 440;
    let left = r ? r.left : innerWidth - w - 16;
    let top = r ? r.bottom + 8 : innerHeight - hh - 64;
    if (top + hh > innerHeight - 56) top = Math.max(8, (r ? r.top : innerHeight) - hh - 8);
    left = Math.max(8, Math.min(innerWidth - w - 8, left));
    Object.assign(el.style, { left: `${left}px`, top: `${top}px` });
  }

  /** Types text at the remembered caret; with no text field, copies it instead. */
  insert(text) {
    const t = this.target;
    this.close();
    if (!t?.el?.isConnected) {
      navigator.clipboard.writeText(text).catch(() => {});
      this.kernel.clipboard.record(text);
      this.kernel.notifications.post({ appId: 'shell', appName: 'DonutOS', title: 'Copied to clipboard', body: 'There was no text box selected, so it was copied. Press Ctrl+V to paste it.', uid: this.s.uid });
      return;
    }
    t.el.focus();
    if (t.range) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(t.range); }
    else if (typeof t.start === 'number') t.el.setSelectionRange(t.start, t.end);
    if (!document.execCommand('insertText', false, text)) {
      const v = t.el.value ?? '';
      t.el.value = v.slice(0, t.start ?? v.length) + text + v.slice(t.end ?? v.length);
      t.el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  render() {
    const tabs = h('div.tabs', { role: 'tablist' }, [['emoji', 'emoji', 'Emoji'], ['symbols', 'sparkle', 'Symbols'], ['clipboard', 'clipboard', 'Clipboard']].map(([id, ic, label]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), title: label, onclick: () => { this.tab = id; this.render(); } }, icon(ic, { size: 18 }))));
    this.body = h('div.clip-body');
    mount(this.f.el, h('div.clip-head', tabs), this.body);
    if (this.tab === 'clipboard') this.renderClipboard();
    else if (this.tab === 'symbols') this.renderSymbols();
    else this.renderEmoji();
  }

  renderClipboard() {
    const enabled = this.settings.get('privacy.clipboardHistory');
    if (!enabled) {
      mount(this.body, h('div.empty-state', icon('clipboard', { size: 40 }), h('b', 'Clipboard history is off'), h('p', 'Turn it on to keep a list of what you copy.'),
        h('button.btn.primary', { type: 'button', onclick: () => { this.settings.set('privacy.clipboardHistory', true); this.render(); } }, 'Turn on')));
      return;
    }
    const items = this.kernel.clipboard.list();
    mount(this.body,
      h('div.clip-bar', h('b', 'Clipboard'), items.some((i) => !i.pinned) ? h('button.btn.small', { type: 'button', onclick: () => this.kernel.clipboard.clear() }, 'Clear all') : null),
      items.length ? h('div.clip-list', items.map((it) => h('div.clip-item', { role: 'button', tabindex: '0', onclick: () => this.insert(it.text), onkeydown: (e) => { if (e.key === 'Enter') this.insert(it.text); } },
        h('div.clip-text', it.text.length > 300 ? `${it.text.slice(0, 300)}…` : it.text),
        h('div.clip-meta', h('small', relTime(it.time)),
          h('button.tb-btn', { type: 'button', title: it.pinned ? 'Unpin' : 'Pin', 'aria-label': it.pinned ? 'Unpin' : 'Pin', class: it.pinned && 'on', onclick: (e) => { e.stopPropagation(); this.kernel.clipboard.pin(it.id, !it.pinned); } }, icon('pin', { size: 14 })),
          h('button.tb-btn', { type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: (e) => { e.stopPropagation(); this.kernel.clipboard.remove(it.id); } }, icon('trash', { size: 14 }))))))
        : h('div.empty-state', icon('clipboard', { size: 40 }), h('p', 'You’ll see what you copy here.')));
  }

  renderSymbols() {
    mount(this.body, h('div.emoji-scroll', SYMBOLS.map(([name, chars]) => [h('div.emoji-group', name), h('div.emoji-grid.sym', [...chars].map((c) => h('button', { type: 'button', title: c, onclick: () => this.insert(c) }, c)))])));
  }

  async renderEmoji() {
    const { EMOJI_GROUPS } = await import('./emoji-data.js');
    const skin = this.settings.get('emoji.skin');
    const pick = (item) => {
      const ch = skin >= 0 && item[2] ? item[2][skin] : item[0];
      this.settings.set('emoji.recent', [item[0], ...this.settings.get('emoji.recent').filter((x) => x !== item[0])].slice(0, 24));
      this.insert(ch);
    };
    const btn = (item) => h('button', { type: 'button', title: item[1].split(' ').slice(0, 4).join(' '), onclick: () => pick(item) }, skin >= 0 && item[2] ? item[2][skin] : item[0]);
    const all = EMOJI_GROUPS.flatMap((g) => g.items);
    const byChar = new Map(all.map((i) => [i[0], i]));
    const scroll = h('div.emoji-scroll');
    const input = h('input.input', { type: 'search', placeholder: 'Search emoji', 'aria-label': 'Search emoji', oninput: () => fill() });
    const skins = h('div.skins', ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'].map((c, i) => h('button', { type: 'button', title: i ? `Skin tone ${i}` : 'Default skin tone', 'aria-pressed': String(skin === i - 1), onclick: () => { this.settings.set('emoji.skin', i - 1); this.render(); } }, c)));
    const fill = () => {
      const q = input.value.trim().toLowerCase();
      if (q) {
        const hits = all.filter((i) => i[1].includes(q)).slice(0, 200);
        mount(scroll, hits.length ? h('div.emoji-grid', hits.map(btn)) : h('div.hint', { style: { padding: '12px' } }, 'No emoji found.'));
        return;
      }
      const recent = this.settings.get('emoji.recent').map((c) => byChar.get(c)).filter(Boolean);
      mount(scroll, recent.length ? [h('div.emoji-group', 'Most recently used'), h('div.emoji-grid', recent.map(btn))] : null,
        EMOJI_GROUPS.map((g) => [h('div.emoji-group', g.name), h('div.emoji-grid', g.items.map(btn))]));
    };
    mount(this.body, h('div.emoji-top', input, skins), scroll);
    fill();
    input.focus();
  }

  destroy() {
    this.offs.forEach((f) => f());
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
  }
}
