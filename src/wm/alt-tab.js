// Alt+Tab: hold Alt and press Tab to step through your windows (most recent first);
// release Alt to switch. Shift goes backwards, Esc cancels. Ctrl+Alt+Tab keeps the
// switcher open without holding keys (pick with the arrows/Enter or a click).

import { h, mount } from '../ui/h.js';

export class AltTab {
  constructor(session) {
    this.s = session;
    this.wm = session.wm;
    this.el = null;
  }

  /** Starts the switcher. `sticky` keeps it open after the keys are released. */
  start({ reverse = false, sticky = false } = {}) {
    const scope = this.s.settings.get('wm.altTabScope');
    const list = [...this.wm.order].reverse().filter((w) => scope === 'all' || this.wm.isVisible(w));
    if (!list.length) return;
    if (this.el) { this.step(reverse ? -1 : 1); return; }
    this.list = list;
    this.sticky = sticky;
    this.index = list.length > 1 ? (reverse ? list.length - 1 : 1) : 0;
    this.el = h('div.alt-tab.acrylic', { role: 'listbox', 'aria-label': 'Switch windows' });
    this.s.el.append(this.el);
    this.render();
    this.onKey = (e) => this.key(e);
    this.onUp = (e) => { if (!this.sticky && (e.key === 'Alt' || !e.altKey)) this.commit(); };
    this.onBlur = () => this.cancel();
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('keyup', this.onUp, true);
    window.addEventListener('blur', this.onBlur);
  }

  render() {
    mount(this.el, this.list.map((w, i) => h('div.at-item', {
      role: 'option', 'aria-selected': String(i === this.index), class: i === this.index && 'sel',
      onclick: () => { this.index = i; this.commit(); }, onpointerenter: () => { if (this.sticky) { this.index = i; this.render(); } },
    }, h('div.at-head', h('img', { src: w.icon, alt: '' }), h('span', w.title)), h('div.at-shot', this.wm.snapshot(w, 220, 140)),
      !this.wm.isVisible(w) ? h('small.at-desk', this.s.desktops.get(w.desktop)?.name || '') : null)));
    this.el.querySelector('.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  step(d) {
    this.index = (this.index + d + this.list.length) % this.list.length;
    this.render();
  }

  key(e) {
    if (e.key === 'Tab' || e.code === 'Backquote') { e.preventDefault(); e.stopPropagation(); this.step(e.shiftKey ? -1 : 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); this.commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancel(); }
    else if (e.key === 'Delete') { e.preventDefault(); const w = this.list[this.index]; w.close().then(() => { this.list = this.list.filter((x) => this.wm.windows.has(x.id)); if (!this.list.length) this.cancel(); else { this.index = Math.min(this.index, this.list.length - 1); this.render(); } }); }
  }

  commit() {
    const w = this.list?.[this.index];
    this.cancel();
    if (w) this.wm.focus(w);
  }

  cancel() {
    if (!this.el) return;
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('keyup', this.onUp, true);
    window.removeEventListener('blur', this.onBlur);
    this.el.remove();
    this.el = null;
  }
}
