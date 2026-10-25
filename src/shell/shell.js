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
import { applyTheme, watchTheme } from './theme.js';
import { installPermissionPrompt } from './permission-prompt.js';
import { playSound } from './sounds.js';
import { closeMenu } from '../ui/menu.js';

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
  }

  async start() {
    applyTheme(null);
    const done = await runBoot(this.root, this.kernel);
    installPermissionPrompt(this.kernel);
    watchTheme(this.kernel.settings);
    this.kernel.bus.on('session:changed', () => applyTheme(this.kernel.settings));
    this.#installShortcuts();
    this.#installAutoLock();
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
    if (!view) { view = new SessionView(this, user); this.views.set(user.id, view); }
    else view.show();
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

  #installShortcuts() {
    document.addEventListener('keydown', (e) => {
      const inSession = this.kernel.session.user && !this.lockUi;
      // Lock: Win+L where the host OS lets it through, Ctrl+Alt+L everywhere.
      if (inSession && e.code === 'KeyL' && ((e.metaKey && !e.ctrlKey) || (e.ctrlKey && e.altKey))) {
        e.preventDefault();
        this.lock();
      }
    });
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
