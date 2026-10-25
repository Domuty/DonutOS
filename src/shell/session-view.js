// The signed-in user's screen: wallpaper and a bottom bar with Start, status and clock.
// Phase 3 replaces the bar and Start panel with the full taskbar, Start menu, desktop
// icons and flyouts; the account, personalisation and power actions here carry over.

import { h, mount } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { avatar } from '../ui/avatar.js';
import { dialog } from '../ui/dialog.js';
import { showMenu } from '../ui/menu.js';
import { paintWallpaper } from './wallpaper.js';
import { formatTime, formatDate, everyTick } from './format.js';
import { mountStatusIcons } from './status-icons.js';
import { renderAccounts } from './accounts-panel.js';
import { renderPersonalize } from './personalize-panel.js';
import { mountKernelConsole } from '../kernel-console.js';

export class SessionView {
  constructor(shell, user) {
    this.shell = shell;
    this.kernel = shell.kernel;
    this.uid = user.id;
    this.settings = this.kernel.settings.forUser(user.id);
    this.disposers = [];
    this.wp = h('div.wp');
    this.startBtn = h('button.sbar-btn', { 'aria-label': 'Start', title: 'Start', 'aria-expanded': 'false', onclick: () => this.toggleStart() },
      h('img', { src: 'assets/brand/logo.svg', alt: '' }));
    this.clock = h('div.sbar-clock');
    this.status = h('div', { style: { display: 'flex', gap: '10px', padding: '0 8px', alignItems: 'center' } });
    this.bar = h('div.sbar', { role: 'toolbar', 'aria-label': 'Taskbar' }, this.startBtn,
      h('div.sbar-right', h('div.sbar-btn', this.status), h('div.sbar-btn', this.clock)));
    this.start = h('div.start.acrylic.hidden', { role: 'dialog', 'aria-label': 'Start' });
    this.el = h('div.screen.session.appear', { 'aria-label': `${user.name}’s desktop` }, this.wp, this.start, this.bar);
    this.shell.sessions.append(this.el);

    this.disposers.push(
      this.settings.watch('appearance.wallpaper', () => this.paint()),
      this.settings.watch('appearance.wallpaperFit', () => this.paint()),
      this.settings.watch('time.*', () => this.tick()),
      everyTick(() => this.tick()),
      mountStatusIcons(this.status, this.kernel.platform, { size: 16 }),
      this.kernel.bus.on('session:userUpdated', ({ user: u }) => { if (u.id === this.uid) this.renderStart(); }),
    );
    this.onDocDown = (e) => { if (!this.start.contains(e.target) && !this.startBtn.contains(e.target) && !e.target.closest('.menu, .dlg-backdrop')) this.toggleStart(false); };
    this.onKey = (e) => { if (e.key === 'Escape' && !this.start.classList.contains('hidden') && !document.querySelector('.dlg, .menu')) { this.toggleStart(false); this.startBtn.focus(); } };
    document.addEventListener('pointerdown', this.onDocDown, true);
    document.addEventListener('keydown', this.onKey);
    this.paint();
    this.renderStart();
  }

  get user() { return this.kernel.sessions.get(this.uid)?.user; }

  paint() { return paintWallpaper(this.wp, this.settings.get('appearance.wallpaper'), this.kernel.fs, this.settings.get('appearance.wallpaperFit')); }

  tick() {
    const now = new Date();
    mount(this.clock, h('div', formatTime(now, this.settings)), h('div', formatDate(now, this.settings)));
    this.clock.parentElement.title = formatDate(now, this.settings, 'long');
  }

  toggleStart(force) {
    const open = force ?? this.start.classList.contains('hidden');
    this.start.classList.toggle('hidden', !open);
    this.startBtn.setAttribute('aria-expanded', String(open));
    if (open) this.start.querySelector('button')?.focus();
  }

  renderStart() {
    const u = this.user;
    if (!u) return;
    const tile = (ic, label, desc, fn) => h('button.start-tile', { type: 'button', onclick: () => { this.toggleStart(false); fn(); } },
      icon(ic, { size: 24 }), h('div', h('div', label), h('div', { style: { fontSize: '12px', color: 'var(--text-2)' } }, desc)));
    mount(this.start,
      h('h3', 'DonutOS'),
      h('div.start-grid',
        tile('palette', 'Personalize', 'Background, colours, lock screen', () => this.openPersonalize()),
        tile('users', 'Accounts', 'Your info, sign-in options, other people', () => this.openAccounts()),
        tile('terminal', 'Kernel console', 'Processes, stats, file system', () => this.openConsole()),
      ),
      h('div.start-foot',
        h('button.start-user', { type: 'button', 'aria-label': `${u.name}, account options`, onclick: (e) => this.userMenu(e.currentTarget) }, avatar(u, 32), h('span', u.name)),
        h('button.sbar-btn', { type: 'button', title: 'Power', 'aria-label': 'Power', onclick: (e) => this.powerMenu(e.currentTarget) }, icon('power'))));
  }

  userMenu(anchor) {
    showMenu([
      { label: 'Change account settings', icon: 'settings', onSelect: () => { this.toggleStart(false); this.openAccounts(); } },
      { separator: true },
      { label: 'Lock', icon: 'lock', onSelect: () => this.shell.lock() },
      { label: 'Switch user', icon: 'switchUser', onSelect: () => this.shell.switchUser() },
      { label: 'Sign out', icon: 'signOut', onSelect: () => this.shell.power.signOut() },
    ], { anchor, placement: 'above' });
  }

  powerMenu(anchor) {
    showMenu([
      { label: 'Sleep', icon: 'sleep', onSelect: () => this.shell.power.sleep() },
      { label: 'Shut down', icon: 'power', onSelect: () => this.shell.power.shutdown() },
      { label: 'Restart', icon: 'restart', onSelect: () => this.shell.power.restart() },
    ], { anchor, placement: 'above' });
  }

  async openPanel(title, render, width = 720) {
    const host = h('div.panel');
    const stop = render(host);
    await dialog({ title, body: host, width, buttons: [{ label: 'Close', value: true, primary: true }], parent: this.el });
    stop?.();
  }

  openAccounts() { return this.openPanel('Accounts', (host) => renderAccounts(host, { kernel: this.kernel, uid: this.uid, onChanged: () => this.renderStart() })); }
  openPersonalize() { return this.openPanel('Personalize', (host) => renderPersonalize(host, { kernel: this.kernel, uid: this.uid })); }

  async openConsole() {
    const host = h('div.kc-host');
    let stop = null;
    await dialog({ body: host, width: 1240, buttons: [{ label: 'Close', value: true, primary: true }], parent: this.el, onOpen: () => { stop = mountKernelConsole(host, this.kernel); } });
    stop?.();
  }

  hide() { this.toggleStart(false); this.el.hidden = true; this.el.inert = true; }
  show() { this.el.hidden = false; this.el.inert = false; this.el.classList.remove('appear'); void this.el.offsetWidth; this.el.classList.add('appear'); }
  setInert(on) { this.el.inert = on; }

  destroy() {
    for (const d of this.disposers) d();
    document.removeEventListener('pointerdown', this.onDocDown, true);
    document.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}
