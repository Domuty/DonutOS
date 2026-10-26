// The taskbar: Start, Search, widgets/weather, pinned and running apps (with live previews
// and jump lists), system tray (network, volume, battery), clock and notifications.

import { roving } from '../ui/roving.js';
import { h, mount } from '../ui/h.js';
import { icon, batteryIcon, iconMarkup } from '../ui/icons.js';
import { showMenu } from '../ui/menu.js';
import { formatTime, formatDate, everyTick } from './format.js';
import { launchApp, openPath, pinned, isPinned, setPinned, movePin } from './apps.js';
import { weatherIcon } from './weather.js';
import { extname } from '../core/path.js';

const volumeIcon = (v, muted) => {
  const waves = muted || v === 0 ? '<path d="M16 9.5l5 5M21 9.5l-5 5"/>' : v < 34 ? '<path d="M15.5 10a3 3 0 0 1 0 4"/>' : v < 67 ? '<path d="M15.5 10a3 3 0 0 1 0 4"/><path d="M17.8 7.8a6 6 0 0 1 0 8.4"/>' : '<path d="M15.5 10a3 3 0 0 1 0 4"/><path d="M17.8 7.8a6 6 0 0 1 0 8.4"/><path d="M20 5.5a9.2 9.2 0 0 1 0 13"/>';
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>${waves}</svg>`;
  return t.content.firstElementChild;
};

export class Taskbar {
  constructor(session) {
    this.s = session;
    this.kernel = session.kernel;
    this.settings = session.settings;
    this.wm = session.wm;
    this.disposers = [];

    this.startBtn = h('button.tb-btn.tb-start', { type: 'button', title: 'Start', 'aria-label': 'Start', 'aria-expanded': 'false', onclick: () => session.flyouts.toggle('start') },
      h('img', { src: 'assets/brand/logo.svg', alt: '', draggable: 'false' }));
    this.searchBox = h('button.tb-search', { type: 'button', 'aria-label': 'Search', 'aria-expanded': 'false', onclick: () => session.flyouts.toggle('search') }, svgSearch(), h('span', 'Search'));
    this.searchIcon = h('button.tb-btn', { type: 'button', title: 'Search', 'aria-label': 'Search', onclick: () => session.flyouts.toggle('search') }, svgSearch());
    this.taskViewBtn = h('button.tb-btn', { type: 'button', title: 'Task view', 'aria-label': 'Task view', 'aria-pressed': 'false', onclick: () => session.taskView.toggle() }, taskViewIcon());
    this.weatherBtn = h('button.tb-weather', { type: 'button', title: 'Widgets', 'aria-label': 'Widgets', 'aria-expanded': 'false', onclick: () => session.flyouts.toggle('widgets') });
    this.appsEl = h('div.tb-apps', { role: 'group', 'aria-label': 'Apps' });
    // App buttons are one Tab stop; ←/→ move between them (Win+T jumps here).
    this.appsNav = roving(this.appsEl, 'button');
    this.center = h('div.tb-center', this.startBtn, this.searchBox, this.searchIcon, this.taskViewBtn, this.appsEl);
    this.left = h('div.tb-left');
    this.trayBtn = h('button.tb-tray', { type: 'button', 'aria-label': 'Quick settings', 'aria-expanded': 'false', onclick: () => session.flyouts.toggle('qs') });
    this.trayBtn.addEventListener('wheel', (e) => {
      e.preventDefault();
      const v = Math.max(0, Math.min(100, this.settings.get('qs.volume') + (e.deltaY < 0 ? 2 : -2)));
      this.settings.set('qs.volume', v);
      if (v > 0 && this.settings.get('qs.muted')) this.settings.set('qs.muted', false);
    }, { passive: false });
    this.clockBtn = h('button.tb-clock', { type: 'button', 'aria-label': 'Notifications and calendar', 'aria-expanded': 'false', onclick: () => session.flyouts.toggle('nc') });
    this.peek = h('button.tb-peek', { type: 'button', title: 'Show desktop', 'aria-label': 'Show desktop', onclick: () => this.wm.toggleDesktop() });
    this.right = h('div.tb-right', this.trayBtn, this.clockBtn, this.peek);
    this.el = h('div.taskbar', { role: 'toolbar', 'aria-label': 'Taskbar' }, this.left, this.center, this.right);
    this.reveal = h('div.tb-reveal', { onpointerenter: () => this.setRevealed(true) });
    this.preview = h('div.tb-preview.acrylic', { hidden: true, onpointerenter: () => clearTimeout(this.previewTimer), onpointerleave: () => this.schedulePreviewClose() });
    session.el.append(this.el, this.reveal, this.preview);

    this.el.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tb-app')) return;
      e.preventDefault();
      showMenu([
        { label: 'Taskbar settings', icon: 'settings', onSelect: () => launchApp(this.kernel, 'settings', { page: 'taskbar' }) },
        ...(this.kernel.registry.has('taskmanager') ? [{ label: 'Task Manager', icon: 'apps', onSelect: () => launchApp(this.kernel, 'taskmanager') }] : []),
      ], { x: e.clientX, y: e.clientY - 80 });
    });
    this.el.addEventListener('pointerleave', () => { if (this.settings.get('taskbar.autoHide')) this.hideSoon(); });

    session.flyouts.items.get('start').trigger = this.startBtn;
    session.flyouts.items.get('search').trigger = this.searchBox;
    session.flyouts.items.get('qs').trigger = this.trayBtn;
    session.flyouts.items.get('nc').trigger = this.clockBtn;
    session.flyouts.items.get('widgets').trigger = this.weatherBtn;
    session.flyoutLayer.addEventListener('flyout', () => this.applyAutoHide());

    const s = this.settings;
    this.disposers.push(
      this.wm.subscribe(() => this.renderApps()),
      s.watch('taskbar.*', () => { this.applyLayout(); this.renderApps(); this.tickClock(); }),
      s.watch('wm.taskbarScope', () => this.renderApps()),
      s.watch('qs.*', () => this.renderTray()),
      s.watch('notifications.*', () => this.renderClockExtras()),
      s.watch('time.*', () => this.tickClock()),
      s.watch('widgets.weatherCache', () => this.renderWeather()),
      s.watch('weather.*', () => this.renderWeather()),
      this.kernel.bus.on('apps:*', () => this.renderApps()),
      this.kernel.bus.on('notification:*', () => this.renderClockExtras()),
      this.kernel.platform.system.onNetworkChange(() => this.renderTray()),
      this.kernel.platform.system.onBatteryChange(() => this.renderTray()),
      session.weather.subscribe(() => this.renderWeather()),
    );
    this.stopClock = null;
    this.applyLayout();
    this.renderApps();
    this.renderTray();
    this.renderWeather();
    this.tickClock();
  }

  // ── Layout ───────────────────────────────────────────────────────────
  applyLayout() {
    const s = this.settings;
    this.el.classList.toggle('left-aligned', s.get('taskbar.alignment') === 'left');
    this.s.el.classList.toggle('taskbar-left', s.get('taskbar.alignment') === 'left');
    const search = s.get('taskbar.showSearch');
    this.searchBox.hidden = search !== 'box';
    this.searchIcon.hidden = search !== 'icon';
    this.weatherBtn.hidden = !s.get('taskbar.showWidgets');
    this.taskViewBtn.hidden = !s.get('taskbar.showTaskView');
    // Centered: weather sits at the far left. Left-aligned: after the app buttons' start.
    if (s.get('taskbar.alignment') === 'left') this.right.prepend(this.weatherBtn);
    else this.left.append(this.weatherBtn);
    this.applyAutoHide();
    this.wm.fitToScreen();
    this.stopClock?.();
    this.stopClock = everyTick(() => this.tickClock(), { seconds: s.get('taskbar.showSeconds') });
  }

  applyAutoHide() {
    const auto = this.settings.get('taskbar.autoHide');
    this.el.classList.toggle('autohide', auto);
    this.reveal.hidden = !auto;
    if (!auto) { this.el.classList.remove('peeking'); return; }
    if (this.s.flyouts.current) this.setRevealed(true); else if (!this.el.matches(':hover')) this.setRevealed(false);
  }

  setRevealed(on) { clearTimeout(this.hideTimer); this.el.classList.toggle('peeking', on); }
  hideSoon() { clearTimeout(this.hideTimer); this.hideTimer = setTimeout(() => { if (!this.s.flyouts.current && !this.el.matches(':hover')) this.setRevealed(false); }, 600); }
  hidden() { return this.settings.get('taskbar.autoHide'); }

  // ── App buttons ──────────────────────────────────────────────────────
  setTaskView(on) { this.taskViewBtn.setAttribute('aria-pressed', String(on)); this.taskViewBtn.classList.toggle('pressed', on); }

  items() {
    const pins = pinned(this.kernel, 'taskbar');
    const all = this.settings.get('wm.taskbarScope') === 'all';
    const wins = this.wm.list().filter((w) => all || this.wm.isVisible(w));
    const order = [...pins];
    for (const w of wins) if (!order.includes(w.appId)) order.push(w.appId);
    return order.map((appId) => ({ appId, app: this.kernel.registry.get(appId) || { id: appId, name: appId, icon: wins.find((w) => w.appId === appId)?.icon }, windows: wins.filter((w) => w.appId === appId), pinned: pins.includes(appId) }));
  }

  renderApps() {
    const combine = this.settings.get('taskbar.combine');
    const active = this.wm.active;
    const buttons = [];
    for (const item of this.items()) {
      if (combine || !item.windows.length) buttons.push(this.appButton(item, item.windows, active));
      else for (const w of item.windows) buttons.push(this.appButton(item, [w], active, w.title));
    }
    mount(this.appsEl, buttons);
    this.appsNav.refresh();
  }

  appButton(item, windows, active, label) {
    const running = windows.length > 0;
    const isActive = windows.some((w) => w === active && w.state !== 'minimized');
    const progress = windows.find((w) => typeof w.progress === 'number')?.progress;
    const btn = h('button.tb-btn.tb-app', {
      type: 'button', draggable: item.pinned ? 'true' : 'false',
      class: [running && 'running', isActive && 'active', windows.some((w) => w.flashing) && 'flash', label && 'labelled'],
      title: windows.length === 1 ? windows[0].title : item.app.name,
      'aria-label': `${item.app.name}${running ? `, ${windows.length} window${windows.length > 1 ? 's' : ''} open` : ''}`,
      dataset: { app: item.appId, win: windows.length === 1 ? windows[0].id : '' },
      onclick: (e) => this.activate(item, windows, e),
      onauxclick: (e) => { if (e.button === 1) launchApp(this.kernel, item.appId); },
      oncontextmenu: (e) => { e.preventDefault(); this.jumpList(item, windows, e.currentTarget); },
      onpointerenter: (e) => { if (running) this.schedulePreview(item, windows, e.currentTarget); },
      onpointerleave: () => this.schedulePreviewClose(),
    }, h('img', { src: item.app.icon, alt: '', draggable: 'false' }), label ? h('span.tb-label', label) : null,
    typeof progress === 'number' ? h('i.tb-progress', { style: { '--p': `${Math.round(progress * 100)}%` } }) : null);
    if (item.pinned) this.makeDraggable(btn, item.appId);
    return btn;
  }

  activate(item, windows, e) {
    this.closePreview();
    if (!windows.length || e.shiftKey) { launchApp(this.kernel, item.appId); return; }
    if (windows.length === 1) {
      const w = windows[0];
      if (this.wm.active === w && w.state !== 'minimized') w.minimize(); else this.wm.focus(w);
      return;
    }
    // Several windows: show them all so the user can pick one.
    this.showPreview(item, windows, e.currentTarget, true);
  }

  /** Taskbar button rectangle for a window (minimise/restore animations). */
  targetFor(win) {
    const b = this.appsEl.querySelector(`[data-win="${win.id}"]`) || this.appsEl.querySelector(`[data-app="${CSS.escape(win.appId)}"]`);
    return b ? b.getBoundingClientRect() : null;
  }

  flash(win) {
    win.flashing = true;
    const off = win.on('focus', () => { win.flashing = false; off(); this.renderApps(); });
    this.renderApps();
  }

  makeDraggable(btn, appId) {
    btn.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-donut-pin', appId); e.dataTransfer.effectAllowed = 'move'; this.closePreview(); });
    btn.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-donut-pin')) { e.preventDefault(); btn.classList.add('drop-before'); } });
    btn.addEventListener('dragleave', () => btn.classList.remove('drop-before'));
    btn.addEventListener('drop', (e) => {
      btn.classList.remove('drop-before');
      const dragged = e.dataTransfer.getData('application/x-donut-pin');
      if (dragged && dragged !== appId) { e.preventDefault(); movePin(this.kernel, 'taskbar', dragged, appId); }
    });
  }

  jumpList(item, windows, anchor) {
    this.closePreview();
    const exts = item.app.fileTypes || [];
    const recent = exts.length ? this.settings.get('start.recentFiles').filter((r) => exts.includes(extname(r.path))).slice(0, 6) : [];
    const tasks = item.app.jumpList || [];
    const menu = [];
    if (recent.length) {
      menu.push({ header: 'Recent' });
      for (const r of recent) menu.push({ label: r.path.split('/').pop(), icon: 'image', onSelect: () => openPath(this.kernel, r.path, { appId: item.appId }) });
      menu.push({ separator: true });
    }
    if (tasks.length) {
      menu.push({ header: 'Tasks' });
      for (const t of tasks) menu.push({ label: t.label, icon: t.icon || 'arrowRight', onSelect: () => launchApp(this.kernel, item.appId, t.args || {}) });
      menu.push({ separator: true });
    }
    if (this.kernel.registry.has(item.appId)) {
      menu.push({ label: item.app.name, icon: item.app.icon, onSelect: () => launchApp(this.kernel, item.appId) });
      const pinnedNow = isPinned(this.kernel, 'taskbar', item.appId);
      menu.push({ label: pinnedNow ? 'Unpin from taskbar' : 'Pin to taskbar', icon: pinnedNow ? 'minus' : 'plus', onSelect: () => setPinned(this.kernel, 'taskbar', item.appId, !pinnedNow) });
    }
    if (windows.length) menu.push({ label: windows.length > 1 ? 'Close all windows' : 'Close window', icon: 'close', onSelect: () => windows.forEach((w) => w.close()) });
    showMenu(menu, { anchor, placement: 'above' });
  }

  // ── Previews ─────────────────────────────────────────────────────────
  schedulePreview(item, windows, anchor) {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.showPreview(item, windows, anchor), this.preview.hidden ? 450 : 80);
  }

  schedulePreviewClose() {
    clearTimeout(this.previewTimer);
    if (this.previewSticky) return;
    this.previewTimer = setTimeout(() => this.closePreview(), 300);
  }

  showPreview(item, windows, anchor, sticky = false) {
    if (document.querySelector('.menu') || !anchor.isConnected) return;
    this.previewSticky = sticky;
    // Snap groups get their own preview, which brings the whole group back together.
    const groups = [];
    for (const w of windows) {
      const members = this.wm.snapper.groupOf(w);
      if (members && !groups.some((g) => g.includes(w))) groups.push(members);
    }
    const groupCards = groups.map((members) => h('div.tbp-item.tbp-group', {
      role: 'button', tabindex: '0', 'aria-label': `Snap group: ${members.map((m) => m.title).join(', ')}`,
      onclick: () => { this.closePreview(); this.wm.snapper.focusGroup(members[0]); },
    }, h('div.tbp-head', icon('view', { size: 14 }), h('span', 'Group')), this.groupThumb(members)));
    mount(this.preview, ...groupCards, windows.map((w) => h('div.tbp-item', {
      role: 'button', tabindex: '0', 'aria-label': w.title,
      onclick: () => { this.closePreview(); this.wm.focus(w); },
      onkeydown: (e) => { if (e.key === 'Enter') { this.closePreview(); this.wm.focus(w); } },
    },
    h('div.tbp-head', h('img', { src: w.icon, alt: '' }), h('span', w.title),
      h('button.tbp-close', { type: 'button', 'aria-label': `Close ${w.title}`, onclick: (e) => { e.stopPropagation(); w.close().then(() => { if (!this.wm.forApp(item.appId).length) this.closePreview(); else this.showPreview(item, this.wm.forApp(item.appId), anchor, sticky); }); } }, icon('close', { size: 12 }))),
    this.wm.snapshot(w))));
    this.preview.hidden = false;
    const a = anchor.getBoundingClientRect();
    const r = this.preview.getBoundingClientRect();
    this.preview.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, a.left + a.width / 2 - r.width / 2))}px`;
    this.preview.style.bottom = `${innerHeight - a.top + 8}px`;
    if (sticky) setTimeout(() => document.addEventListener('pointerdown', this.outside = (e) => { if (!this.preview.contains(e.target)) this.closePreview(); }, { capture: true, once: true }));
  }

  /** A miniature of a snap group: each member's snapshot in its place on the screen. */
  groupThumb(members) {
    const a = this.wm.workArea();
    const W = 220, H = Math.round(W * (a.h / a.w));
    return h('div.tbp-groupthumb', { style: { width: `${W}px`, height: `${H}px` } }, members.map((m) => {
      const r = m.bounds;
      const shot = this.wm.snapshot(m, (r.w / a.w) * W, (r.h / a.h) * H);
      return h('div', { style: { position: 'absolute', left: `${((r.x - a.x) / a.w) * W}px`, top: `${((r.y - a.y) / a.h) * H}px` } }, shot);
    }));
  }

  closePreview() {
    clearTimeout(this.previewTimer);
    this.preview.hidden = true;
    this.previewSticky = false;
    if (this.outside) document.removeEventListener('pointerdown', this.outside, { capture: true });
    this.preview.replaceChildren();
  }

  // ── Tray & clock ─────────────────────────────────────────────────────
  async renderTray() {
    const s = this.settings;
    const [net, bat] = await Promise.all([this.kernel.platform.system.network(), this.kernel.platform.system.battery()]);
    const offline = s.get('qs.airplane') || !s.get('qs.wifi') || !net.online;
    const netIcon = s.get('qs.airplane') ? airplane() : icon(offline ? 'wifiOff' : net.type === 'ethernet' ? 'ethernet' : net.type === 'wifi' ? 'wifi' : 'globe', { size: 16 });
    const realBattery = bat.supported && !(bat.charging && bat.level === 1 && bat.chargingTime === 0);
    mount(this.trayBtn, netIcon, volumeIcon(s.get('qs.volume'), s.get('qs.muted')), realBattery ? batteryIcon(bat.level, bat.charging, { size: 16 }) : null);
    this.trayBtn.title = `${s.get('qs.airplane') ? 'Airplane mode' : offline ? 'Not connected' : 'Connected'} · Volume ${s.get('qs.muted') ? 'muted' : `${s.get('qs.volume')}%`}${realBattery ? ` · Battery ${Math.round(bat.level * 100)}%` : ''}`;
  }

  tickClock() {
    const now = new Date();
    const s = this.settings;
    this.clockText ||= h('span.tb-time');
    this.clockExtras ||= h('span.tb-extras');
    mount(this.clockText, h('div', formatTime(now, s, { seconds: s.get('taskbar.showSeconds') })), h('div', formatDate(now, s)));
    if (!this.clockBtn.contains(this.clockText)) mount(this.clockBtn, this.clockText, this.clockExtras);
    this.clockBtn.title = formatDate(now, s, 'long');
    this.renderClockExtras();
  }

  renderClockExtras() {
    if (!this.clockExtras) return;
    const s = this.settings;
    const unread = this.kernel.notifications.list().filter((n) => !n.read).length;
    const quiet = s.get('notifications.dnd') || s.get('qs.focus');
    mount(this.clockExtras, quiet ? h('span.tb-dnd', { title: 'Do not disturb is on', html: iconMarkup('moon', { size: 14 }) }) : unread ? h('span.tb-badge', { title: `${unread} new notification${unread > 1 ? 's' : ''}` }, unread > 9 ? '9+' : String(unread)) : null);
  }

  renderWeather() {
    const d = this.s.weather.data;
    if (!d) { mount(this.weatherBtn, icon('sun', { size: 18 }), h('span', h('b', 'Widgets'))); return; }
    mount(this.weatherBtn, weatherIcon(d.current.code, { night: !d.current.day, size: 22 }),
      h('span', h('b', `${Math.round(d.current.temp)}°`), h('small', this.s.weather.location?.name || '')));
  }

  destroy() {
    this.disposers.forEach((d) => d());
    this.stopClock?.();
    this.closePreview();
  }
}

function svgSearch() {
  const t = document.createElement('template');
  t.innerHTML = '<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/></svg>';
  return t.content.firstElementChild;
}

function taskViewIcon() {
  const t = document.createElement('template');
  t.innerHTML = '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="M18 7.5h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2"/><path d="M15 3.5h-9"/></svg>';
  return t.content.firstElementChild;
}

function airplane() {
  const t = document.createElement('template');
  t.innerHTML = '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10.5 3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v6l7.5 4.5v2l-7.5-2.3v4.5l2.5 2v1.8L12 20.5 8 22v-1.8l2.5-2v-4.5L3 16v-2l7.5-4.5z"/></svg>';
  return t.content.firstElementChild;
}
