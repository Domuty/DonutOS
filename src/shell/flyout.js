// Flyouts: panels that open from the taskbar (Start, Search, Quick Settings, Notifications,
// Widgets, Clipboard). Only one is open at a time; clicking outside or Escape closes it.

import { h } from '../ui/h.js';

export class FlyoutHost {
  constructor(container) {
    this.container = container;
    this.items = new Map();
    this.current = null;
    this.onDown = (e) => {
      if (!this.current) return;
      const f = this.items.get(this.current);
      if (f.el.contains(e.target) || f.trigger?.contains(e.target) || e.target.closest('.menu, .dlg-backdrop, [data-flyout-keep]')) return;
      this.close();
    };
    this.onKey = (e) => {
      if (e.key === 'Escape' && this.current && !document.querySelector('.dlg, .menu')) {
        e.preventDefault();
        const f = this.items.get(this.current);
        this.close();
        f.trigger?.focus();
      }
    };
    document.addEventListener('pointerdown', this.onDown, true);
    document.addEventListener('keydown', this.onKey);
  }

  /** def: { className, label, render(el, args), onOpen(args), onClose(), trigger } */
  add(name, def) {
    const el = h(`div.flyout.${def.className}.hidden`, { role: 'dialog', 'aria-label': def.label, 'aria-hidden': 'true' });
    this.container.append(el);
    const f = { ...def, el, name };
    this.items.set(name, f);
    return f;
  }

  isOpen(name) { return this.current === name; }

  open(name, args) {
    if (this.current && this.current !== name) this.close();
    const f = this.items.get(name);
    if (!f) return;
    this.current = name;
    f.el.classList.remove('hidden');
    f.el.setAttribute('aria-hidden', 'false');
    f.trigger?.setAttribute('aria-expanded', 'true');
    f.onOpen?.(args);
    this.container.dispatchEvent(new CustomEvent('flyout', { detail: { name, open: true } }));
  }

  close(name = this.current) {
    if (!name || this.current !== name) return;
    const f = this.items.get(name);
    this.current = null;
    f.el.classList.add('hidden');
    f.el.setAttribute('aria-hidden', 'true');
    f.trigger?.setAttribute('aria-expanded', 'false');
    f.onClose?.();
    this.container.dispatchEvent(new CustomEvent('flyout', { detail: { name, open: false } }));
  }

  toggle(name, args) { if (this.current === name) this.close(); else this.open(name, args); }

  destroy() {
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey);
  }
}
