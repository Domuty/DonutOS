// Task View (Win+Tab): every window on the current desktop, plus a strip of virtual
// desktops to switch to, create, rename, reorder, close, give their own background, and
// drag windows onto.

import { h, mount, settle } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { showMenu } from '../ui/menu.js';
import { dialog } from '../ui/dialog.js';
import { ZONES } from './snap.js';
import { BUILTIN_WALLPAPERS, builtinUrl, resolveWallpaper } from '../shell/wallpaper.js';

export class TaskView {
  constructor(session) {
    this.s = session;
    this.wm = session.wm;
    this.desktops = session.desktops;
    this.el = null;
    this.previewDesk = null;
  }

  get isOpen() { return !!this.el; }
  toggle() { if (this.el) this.close(); else this.open(); }

  open() {
    if (this.el) return;
    this.s.flyouts.close();
    this.wm.snapper.endAssist();
    this.grid = h('div.tv-grid', { role: 'listbox', 'aria-label': 'Open windows' });
    this.strip = h('div.tv-desks', { role: 'list', 'aria-label': 'Desktops',
      // Hovering a desktop previews its windows; leaving the strip shows the current desktop again.
      onpointerleave: () => { clearTimeout(this.hoverTimer); if (this.previewDesk) { this.previewDesk = null; this.render(); } } });
    this.el = h('div.task-view', { role: 'dialog', 'aria-label': 'Task view', tabindex: '-1',
      onclick: (e) => { if (e.target === this.el || e.target === this.grid) this.close(); } },
    this.grid, this.strip);
    this.s.el.append(this.el);
    this.onKey = (e) => this.key(e);
    document.addEventListener('keydown', this.onKey, true);
    this.off = this.wm.subscribe(() => this.render());
    this.offDesk = this.desktops.subscribe(() => this.render());
    this.render();
    this.el.focus();
    this.s.taskbar.setTaskView(true);
  }

  async close() {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    document.removeEventListener('keydown', this.onKey, true);
    this.off(); this.offDesk();
    el.classList.add('out');
    this.s.taskbar.setTaskView(false);
    await settle(el, 250);
    el.remove();
  }

  windowsFor(deskId) {
    return this.wm.list().filter((w) => w.allDesktops || w.desktop === deskId).sort((a, b) => this.wm.order.indexOf(b) - this.wm.order.indexOf(a));
  }

  render() {
    if (!this.el) return;
    const deskId = this.previewDesk || this.desktops.current;
    const wins = this.windowsFor(deskId);
    mount(this.grid, wins.length ? wins.map((w, i) => this.card(w, i)) : h('div.tv-empty', this.previewDesk ? 'No windows on this desktop' : 'No open windows'));
    const desks = this.desktops.list();
    mount(this.strip, desks.map((d) => this.deskCard(d, desks.length)),
      h('button.tv-new', { type: 'button', 'aria-label': 'New desktop', onclick: () => { this.desktops.create(); } }, icon('plus', { size: 22 }), h('span', 'New desktop')));
    this.loadThumbs();
  }

  card(w, i) {
    const c = h('div.tv-card', {
      role: 'option', tabindex: '0', draggable: 'true', 'aria-label': w.title, dataset: { id: w.id, idx: i },
      class: w === this.wm.active && 'active',
      onclick: () => { this.close(); this.wm.focus(w); },
      oncontextmenu: (e) => { e.preventDefault(); this.windowMenu(w, e); },
    },
    h('div.tv-head', h('img', { src: w.icon, alt: '' }), h('span', w.title),
      h('button.tv-close', { type: 'button', 'aria-label': `Close ${w.title}`, onclick: (e) => { e.stopPropagation(); w.close(); } }, icon('close', { size: 12 }))),
    h('div.tv-shot', this.wm.snapshot(w, 300, 190)));
    c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-donut-window', w.id); e.dataTransfer.effectAllowed = 'move'; });
    return c;
  }

  deskCard(d, count) {
    const current = d.id === this.desktops.current;
    const thumb = h('div.tv-desk-thumb');
    const name = h('span.tv-desk-name', d.name);
    const card = h('div.tv-desk', {
      role: 'listitem', tabindex: '0', class: [current && 'current'], dataset: { desk: d.id }, 'aria-label': `${d.name}${current ? ' (current)' : ''}`,
      onclick: () => { this.close(); this.desktops.switchTo(d.id); },
      onkeydown: (e) => { if (e.key === 'Enter') { this.close(); this.desktops.switchTo(d.id); } else if (e.key === 'F2') this.rename(d, name); },
      onpointerenter: () => { clearTimeout(this.hoverTimer); this.hoverTimer = setTimeout(() => { if (this.previewDesk !== d.id) { this.previewDesk = d.id; this.render(); } }, 350); },
      onpointerleave: () => { clearTimeout(this.hoverTimer); },
      oncontextmenu: (e) => { e.preventDefault(); this.deskMenu(d, name, e, count); },
      ondblclick: (e) => { if (e.target === name) { e.stopPropagation(); this.rename(d, name); } },
    }, thumb, h('div.tv-desk-foot', name,
      count > 1 ? h('button.tv-close', { type: 'button', 'aria-label': `Close ${d.name}`, onclick: (e) => { e.stopPropagation(); this.desktops.remove(d.id); } }, icon('close', { size: 12 })) : null));
    card.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-donut-window')) { e.preventDefault(); card.classList.add('drop'); } });
    card.addEventListener('dragleave', () => card.classList.remove('drop'));
    card.addEventListener('drop', (e) => {
      card.classList.remove('drop');
      const w = this.wm.get(e.dataTransfer.getData('application/x-donut-window'));
      if (w) { e.preventDefault(); this.desktops.moveWindow(w, d.id); }
    });
    card._thumb = { el: thumb, desk: d };
    return card;
  }

  async loadThumbs() {
    const a = this.wm.workArea();
    for (const card of this.strip.querySelectorAll('.tv-desk')) {
      const { el, desk } = card._thumb;
      const spec = desk.wallpaper || this.s.settings.get('appearance.wallpaper');
      const res = await resolveWallpaper(spec, this.s.kernel.fs, { thumb: true });
      el.style.background = res.url ? `center / cover url("${res.url}")` : res.color;
      // Miniature outlines of the desktop's windows.
      mount(el, this.windowsFor(desk.id).filter((w) => w.state !== 'minimized').map((w) => h('i', { style: {
        left: `${(w.bounds.x / a.w) * 100}%`, top: `${(w.bounds.y / a.h) * 100}%`, width: `${(w.bounds.w / a.w) * 100}%`, height: `${(w.bounds.h / a.h) * 100}%`,
      } })));
    }
  }

  rename(d, nameEl) {
    const input = h('input.tv-rename', { value: d.name, 'aria-label': 'Desktop name', maxlength: 40 });
    nameEl.replaceWith(input);
    input.focus(); input.select();
    const done = (save) => { if (save && input.value.trim()) this.desktops.rename(d.id, input.value); else this.render(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  deskMenu(d, nameEl, e, count) {
    const i = this.desktops.index(d.id);
    showMenu([
      { label: 'Rename', icon: 'edit', onSelect: () => this.rename(d, nameEl) },
      { label: 'Choose background', icon: 'image', onSelect: () => this.chooseBackground(d) },
      { separator: true },
      { label: 'Move left', icon: 'arrowLeft', disabled: i === 0, onSelect: () => this.desktops.move(d.id, -1) },
      { label: 'Move right', icon: 'arrowRight', disabled: i === count - 1, onSelect: () => this.desktops.move(d.id, 1) },
      { separator: true },
      { label: 'Close', icon: 'close', disabled: count < 2, onSelect: () => this.desktops.remove(d.id) },
    ], { x: e.clientX, y: e.clientY - 200 });
  }

  async chooseBackground(d) {
    let chosen = d.wallpaper || null;
    const grid = h('div.wp-grid');
    const paint = () => mount(grid,
      h('button.choice', { type: 'button', 'aria-pressed': String(!chosen), title: 'Use my usual background', onclick: () => { chosen = null; paint(); } }, h('div.wp-solid', { style: { display: 'grid', placeItems: 'center', background: 'var(--surface-3)', fontSize: '12px' } }, 'My background')),
      BUILTIN_WALLPAPERS.map((w) => h('button.choice', { type: 'button', title: w.name, 'aria-pressed': String(chosen === w.id), onclick: () => { chosen = w.id; paint(); } }, h('img', { src: builtinUrl(w.id.slice(8), true), alt: w.name }))));
    paint();
    const ok = await dialog({ title: `Background for ${d.name}`, body: grid, width: 560, cancelValue: false, buttons: [{ label: 'Save', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (ok) this.desktops.setWallpaper(d.id, chosen);
  }

  windowMenu(w, e) {
    const desks = this.desktops.list().filter((d) => d.id !== w.desktop);
    showMenu([
      { label: 'Snap left', icon: 'arrowLeft', disabled: !w.opts.resizable, onSelect: () => { this.close(); this.wm.snapper.snap(w, ZONES.left, { assist: true }); } },
      { label: 'Snap right', icon: 'arrowRight', disabled: !w.opts.resizable, onSelect: () => { this.close(); this.wm.snapper.snap(w, ZONES.right, { assist: true }); } },
      { separator: true },
      ...desks.map((d) => ({ label: `Move to ${d.name}`, icon: 'view', onSelect: () => this.desktops.moveWindow(w, d.id) })),
      { label: 'Move to a new desktop', icon: 'plus', onSelect: () => this.desktops.moveWindow(w, this.desktops.create().id) },
      { label: 'Show this window on all desktops', checked: w.allDesktops, onSelect: () => this.desktops.setAllDesktops(w, !w.allDesktops) },
      { separator: true },
      { label: 'Close', icon: 'close', onSelect: () => w.close() },
    ], { x: e.clientX, y: e.clientY });
  }

  key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    const cards = [...this.grid.querySelectorAll('.tv-card')];
    const i = cards.indexOf(document.activeElement);
    if (['ArrowRight', 'ArrowDown'].includes(e.key) && cards.length) { e.preventDefault(); cards[(i + 1) % cards.length].focus(); }
    else if (['ArrowLeft', 'ArrowUp'].includes(e.key) && cards.length) { e.preventDefault(); cards[(i - 1 + cards.length) % cards.length].focus(); }
    else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); cards[i].click(); }
    else if (e.key === 'Delete' && i >= 0) { e.preventDefault(); this.wm.get(cards[i].dataset.id)?.close(); }
  }
}
