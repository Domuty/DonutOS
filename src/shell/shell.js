// The shell: drives the screens from power-on to the desktop.
//
//   boot ──► first-run setup ──► session
//        └─► lock screen ──► sign-in ──► session ──► lock / switch user / sign out / power
//
// Each signed-in user has their own SessionView; switching users hides one and shows
// another while both keep running.

import { h } from '../ui/h.js';
import { runBoot } from './boot-screen.js';
import { showLockScreen } from './lock-screen.js';
import { showSignIn } from './sign-in.js';
import { showOobe } from './oobe.js';
import { Power } from './power.js';
import { SessionView } from './session-view.js';
import { applyTheme, watchTheme, resolvedTheme } from './theme.js';
import { DisplayFilters } from './display-filters.js';
import { toggleFocus } from './focus.js';
import { launchApp } from './apps.js';
import { runDialog } from './run-dialog.js';
import { snipToClipboard, fullScreenshot } from './snip.js';
import { dialog } from '../ui/dialog.js';
import { installPermissionPrompt } from './permission-prompt.js';
import { playSound } from './sounds.js';
import { closeMenu } from '../ui/menu.js';
import { Accessibility } from './a11y/index.js';

export class Shell {
  constructor(kernel, root) {
    this.kernel = kernel;
    this.root = root;
    this.sessions = h('div.layer.sessions-layer');
    this.lockLayer = h('div.layer.lock-layer');
    this.overlay = h('div.layer.overlay-layer');
    root.append(this.sessions, this.lockLayer, this.overlay);
    this.views = new Map();   // uid -> SessionView
    this.lockUi = null;       // current lock or sign-in screen
    this.power = new Power(this);
    this.lastInput = Date.now();
    kernel.setWindowHost((uid) => this.views.get(uid)?.wm || null);
  }

  get view() { return this.views.get(this.kernel.session.user?.id) || null; }
  inSession() { return !!this.kernel.session.user && !this.lockUi && !!this.view; }
  resolvedTheme() { return resolvedTheme(this.kernel.settings.currentUser ? this.kernel.settings : null); }

  async start() {
    applyTheme(null);
    const done = await runBoot(this.root, this.kernel);
    installPermissionPrompt(this.kernel);
    watchTheme(this.kernel.settings);
    applyTheme(this.kernel.settings); // the sign-in screen's accessibility (contrast) before anyone signs in
    this.kernel.bus.on('session:changed', () => applyTheme(this.kernel.settings));
    // Requests from system apps (Task Manager) for things only the shell can do.
    this.kernel.bus.on('shell:signOutRequest', ({ uid }) => {
      if (uid === this.kernel.session.user?.id) this.power.signOut();
      else if (this.kernel.sessions.has(uid)) this.endSession(uid);
    });
    this.kernel.bus.on('shell:runDialog', () => { if (this.inSession()) runDialog(this.kernel, this.view); });
    this.filters = new DisplayFilters(this.kernel, this.root);
    this.a11y = new Accessibility(this.kernel, { openSettings: (page) => launchApp(this.kernel, 'settings', { page }), inSession: () => this.inSession() });
    this.#installShortcuts();
    this.#installAutoLock();
    this.#installFocusTimer();
    this.#installClipboardCapture();
    this.kernel.platform.power.onCloseRequest(() => this.#closeRequest());
    if (this.kernel.accounts.count === 0) {
      await this.#firstRun();
    } else {
      await this.showLock();
    }
    await done();
  }

  async #firstRun() {
    this.lockUi = await showOobe(this.lockLayer, { kernel: this.kernel, onDone: (account) => this.enterSession(account) });
  }

  // ── Lock & sign-in ───────────────────────────────────────────────────

  /** Shows the lock screen (for the active user if one is signed in). */
  async showLock({ animateIn = false } = {}) {
    this.#clearLockUi();
    const active = this.kernel.session.user;
    const uid = active?.id || this.kernel.settings.get('system.lastUser') || null;
    const ui = await showLockScreen(this.lockLayer, {
      kernel: this.kernel, uid, entering: animateIn,
      onDismiss: (key) => this.showSignIn({ preselect: active?.id, initialKey: key, behind: ui }),
    });
    this.lockUi = ui;
  }

  async showSignIn({ preselect, initialKey = '', behind } = {}) {
    const active = this.kernel.session.user;
    const ui = await showSignIn(this.lockLayer, {
      kernel: this.kernel,
      preselect,
      initialKey,
      lockedUid: active?.id,
      power: this.power,
      onSignedIn: (account) => this.enterSession(account),
      onCancel: () => this.showLock({ animateIn: true }),
    });
    // A lock screen that is sliding away removes itself; anything else is replaced now.
    if (this.lockUi && this.lockUi !== behind) this.lockUi.destroy?.();
    this.lockUi = ui;
  }

  #clearLockUi() {
    this.lockUi?.destroy?.();
    this.lockUi = null;
    this.lockLayer.replaceChildren();
  }

  /** Locks the active session: apps keep running behind the lock screen. */
  async lock({ animate = true } = {}) {
    if (!this.kernel.session.user) return;
    closeMenu();
    for (const v of this.views.values()) v.setInert(true);
    this.kernel.lock();
    await this.showLock({ animateIn: animate });
  }

  /** Locks and goes straight to the account picker. */
  async switchUser() {
    await this.lock({ animate: false });
    await this.showSignIn({ preselect: null });
  }

  // ── Sessions ─────────────────────────────────────────────────────────

  async enterSession(account) {
    const wasRunning = this.kernel.sessions.has(account.id);
    const user = await this.kernel.signIn(account);
    for (const [uid, v] of this.views) if (uid !== user.id) v.hide();
    let view = this.views.get(user.id);
    if (!view) {
      view = new SessionView(this, user);
      this.views.set(user.id, view);
      for (const appId of this.kernel.settings.get('apps.startup')) if (this.kernel.registry.has(appId)) launchApp(this.kernel, appId, { startup: true });
    } else view.show();
    view.setInert(false);
    applyTheme(this.kernel.settings);
    if (wasRunning) playSound('unlock', this.kernel.settings);
    else if (this.kernel.settings.get('sound.startup')) playSound('startup', this.kernel.settings);
    this.kernel.unlock();
    this.lastInput = Date.now();
    this.#clearLockUi();
  }

  /** Signs a user out and removes their screen. */
  async endSession(uid) {
    this.views.get(uid)?.destroy();
    this.views.delete(uid);
    await this.kernel.signOut(uid);
  }

  /** Removes every screen (used when DonutOS has shut down in a browser tab). */
  clearAll() {
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.#clearLockUi();
  }

  // ── Input ────────────────────────────────────────────────────────────

  // Each shortcut has the familiar Win-key combination and a Ctrl+Alt alternative, because
  // host operating systems keep many Win-key combinations for themselves.
  #installShortcuts() {
    const k = this.kernel;
    const sc = k.shortcuts;
    const when = () => this.inSession();
    const fly = (name, args) => () => this.view.flyouts.toggle(name, args);
    const wm = () => this.view.wm;
    const add = (id, keys, description, handler, group = 'Shell', extra = {}) => sc.register(id, { keys, description, handler, when, group, ...extra });
    add('shell.start', ['Meta', 'Ctrl+Escape'], 'Open or close Start', fly('start'));
    add('shell.search', ['Meta+S', 'Meta+Q', 'Ctrl+Alt+S'], 'Search', fly('search'));
    add('shell.quickSettings', ['Meta+A', 'Ctrl+Alt+A'], 'Quick Settings', fly('qs'));
    add('shell.notifications', ['Meta+N', 'Ctrl+Alt+N'], 'Notifications and calendar', fly('nc'));
    add('shell.widgets', ['Meta+W', 'Ctrl+Alt+W'], 'Widgets', fly('widgets'));
    add('shell.clipboard', ['Meta+V', 'Ctrl+Alt+V'], 'Clipboard history', () => this.view.clipboard.openFor('clipboard'));
    add('shell.emoji', ['Meta+Period', 'Ctrl+Alt+Period'], 'Emoji panel', () => this.view.clipboard.openFor('emoji'));
    add('shell.run', ['Meta+R', 'Ctrl+Alt+R'], 'Run', () => runDialog(k, this.view));
    add('shell.focusTaskbar', ['Meta+T', 'Ctrl+Alt+T'], 'Move focus to the taskbar apps (then ←/→)', () => {
      const btns = [...this.view.taskbar.appsEl.querySelectorAll('button')];
      (btns.find((b) => b.tabIndex === 0) || btns[0])?.focus();
    });
    add('shell.focusTray', ['Meta+B', 'Ctrl+Alt+B'], 'Move focus to the system tray', () => this.view.el.querySelector('.tb-tray')?.focus());
    add('shell.lock', ['Meta+L', 'Ctrl+Alt+L'], 'Lock', () => this.lock());
    add('shell.settings', ['Meta+I', 'Ctrl+Alt+I'], 'Settings', () => launchApp(k, 'settings'));
    add('shell.explorer', ['Meta+E', 'Ctrl+Alt+E'], 'File Explorer', () => launchApp(k, 'explorer'), 'Shell', { when: () => when() && k.registry.has('explorer') });
    add('shell.taskmanager', ['Ctrl+Shift+Escape', 'Ctrl+Alt+K'], 'Task Manager', () => launchApp(k, 'taskmanager'), 'Shell', { when: () => when() && k.registry.has('taskmanager') });
    add('shell.snip', ['Meta+Shift+S', 'Ctrl+Alt+Shift+S'], 'Screenshot of part of the screen', () => snipToClipboard(k, this.view));
    add('shell.printScreen', ['PrintScreen'], 'Screenshot of the whole screen', () => fullScreenshot(k, this.view));
    add('wm.desktop', ['Meta+D', 'Ctrl+Alt+D'], 'Show the desktop', () => wm().toggleDesktop(), 'Windows');
    add('wm.minimizeAll', ['Meta+M', 'Ctrl+Alt+M'], 'Minimize all windows', () => wm().minimizeAll(), 'Windows');
    add('wm.close', ['Alt+F4', 'Ctrl+Alt+Q'], 'Close the active window', () => this.#closeRequest(), 'Windows', { inInputs: true });
    const arrow = (dir) => () => wm().snapper.keyboard(wm().active, dir);
    add('wm.snapUp', ['Meta+ArrowUp', 'Ctrl+Alt+ArrowUp'], 'Maximize, or snap to the top', arrow('up'), 'Windows');
    add('wm.snapDown', ['Meta+ArrowDown', 'Ctrl+Alt+ArrowDown'], 'Restore, minimize, or snap to the bottom', arrow('down'), 'Windows');
    add('wm.snapLeft', ['Meta+ArrowLeft', 'Ctrl+Alt+ArrowLeft'], 'Snap the active window left', arrow('left'), 'Windows');
    add('wm.snapRight', ['Meta+ArrowRight', 'Ctrl+Alt+ArrowRight'], 'Snap the active window right', arrow('right'), 'Windows');
    add('wm.snapLayouts', ['Meta+Z', 'Ctrl+Alt+Z'], 'Snap layouts for the active window', () => { const a = wm().active; if (a) wm().snapper.showLayouts(a, a.maxBtn); }, 'Windows');
    add('wm.minimizeOthers', ['Meta+Home', 'Ctrl+Alt+Home'], 'Minimize all but the active window', () => { const a = wm().active; if (a) wm().snapper.toggleOthers(a); }, 'Windows');
    add('wm.altTab', ['Alt+Tab', 'Alt+Backquote'], 'Switch windows (hold Alt)', () => this.view.altTab.start(), 'Windows', { inInputs: true });
    add('wm.altTabBack', ['Alt+Shift+Tab', 'Alt+Shift+Backquote'], 'Switch windows backwards', () => this.view.altTab.start({ reverse: true }), 'Windows', { inInputs: true });
    add('wm.switcher', ['Ctrl+Alt+Tab'], 'Window switcher that stays open', () => this.view.altTab.start({ sticky: true }), 'Windows');
    add('wm.taskView', ['Meta+Tab', 'Ctrl+Alt+Space'], 'Task view', () => this.view.taskView.toggle(), 'Desktops');
    add('desk.new', ['Ctrl+Meta+D', 'Ctrl+Alt+Shift+D'], 'New virtual desktop', () => this.view.desktops.create({ switchTo: true }), 'Desktops');
    add('desk.close', ['Ctrl+Meta+F4', 'Ctrl+Alt+Shift+F4'], 'Close the current desktop', () => this.view.desktops.remove(this.view.desktops.current), 'Desktops');
    add('desk.next', ['Ctrl+Meta+ArrowRight', 'Ctrl+Alt+Shift+ArrowRight'], 'Next desktop', () => this.view.desktops.next(), 'Desktops');
    add('desk.prev', ['Ctrl+Meta+ArrowLeft', 'Ctrl+Alt+Shift+ArrowLeft'], 'Previous desktop', () => this.view.desktops.prev(), 'Desktops');
    for (let i = 1; i <= 9; i++) {
      add(`taskbar.app${i}`, [`Meta+${i}`, `Ctrl+Alt+${i}`], `Open taskbar app ${i}`, () => {
        const item = this.view.taskbar.items()[i - 1];
        if (!item) return;
        const btn = this.view.taskbar.appsEl.querySelector(`[data-app="${CSS.escape(item.appId)}"]`);
        this.view.taskbar.activate(item, item.windows, { shiftKey: false, currentTarget: btn });
      }, 'Taskbar');
    }
    sc.attach(window);
  }

  /** Alt+F4 / the host window's close button: close the active window, or offer power options. */
  async #closeRequest() {
    if (this.inSession() && this.view.wm.closeActive()) return;
    if (document.querySelector('.dlg')) return;
    const choice = await dialog({
      title: 'Shut down DonutOS',
      body: h('p', 'What do you want DonutOS to do?'),
      cancelValue: null,
      buttons: [
        { label: 'Shut down', value: 'shutdown', primary: true },
        { label: 'Restart', value: 'restart' },
        ...(this.kernel.session.user ? [{ label: 'Sign out', value: 'signout' }] : []),
        { label: 'Cancel', value: null },
      ],
    });
    if (choice === 'shutdown') this.power.shutdown();
    else if (choice === 'restart') this.power.restart();
    else if (choice === 'signout') this.power.signOut();
  }

  /** Focus sessions: Do-not-disturb for a set time, then a notification. */
  toggleFocus() { toggleFocus(this.kernel.settings); }

  #installFocusTimer() {
    setInterval(() => {
      for (const uid of this.kernel.settings.loadedUsers()) {
        const s = this.kernel.settings.forUser(uid);
        if (s.get('qs.focus') && s.get('qs.focusUntil') && Date.now() >= s.get('qs.focusUntil')) {
          s.set('qs.focus', false);
          s.set('qs.focusUntil', 0);
          this.kernel.notifications.post({ appId: 'shell', appName: 'Focus', title: 'Focus session complete', body: 'Nice work! Take a short break.', uid, urgent: true });
        }
      }
    }, 5000);
  }

  /** Clipboard history: remember text the active user copies anywhere in DonutOS. */
  #installClipboardCapture() {
    const record = () => {
      if (!this.inSession()) return;
      const el = document.activeElement;
      let text = '';
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && typeof el.selectionStart === 'number' && el.type !== 'password') text = el.value.slice(el.selectionStart, el.selectionEnd);
      else if (el?.type !== 'password') text = String(getSelection() || '');
      if (text) setTimeout(() => this.kernel.clipboard.record(text));
    };
    document.addEventListener('copy', record, true);
    document.addEventListener('cut', record, true);
  }

  /** Locks after the user's chosen idle time (Accounts › Sign-in options). */
  #installAutoLock() {
    const bump = () => { this.lastInput = Date.now(); };
    for (const t of ['pointermove', 'pointerdown', 'keydown', 'wheel']) document.addEventListener(t, bump, { passive: true, capture: true });
    setInterval(() => {
      if (!this.kernel.session.user || this.lockUi) return;
      const min = this.kernel.settings.get('lock.timeoutMin');
      if (min > 0 && Date.now() - this.lastInput > min * 60_000) this.lock();
    }, 15_000);
  }
}
