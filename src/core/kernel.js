// The DonutOS kernel: creates every core service, wires them together, and builds the
// API (ctx) that apps receive. The shell and apps reach the system only through here.

import { MailService } from './mail.js';
import { createFrameView } from '../platform/common/web-view.js';
import { EventBus } from './event-bus.js';
import { SettingsStore } from './settings.js';
import { AppRegistry } from './registry.js';
import { PermissionManager } from './permissions.js';
import { FileAssociations } from './file-associations.js';
import { NotificationService } from './notifications.js';
import { ProcessManager } from './process-manager.js';
import { VirtualFileSystem, HOME_FOLDERS } from './vfs.js';
import { AccountService, GUEST_ID } from './accounts.js';
import { ShortcutRegistry } from './shortcuts.js';
import { ClipboardHistory } from './clipboard.js';
import { PermissionError, ProcessError } from './errors.js';
import { log } from './log.js';
import * as P from './path.js';

export const VERSION = '0.1.0';

export class Kernel {
  constructor({ platform }) {
    this.version = VERSION;
    this.platform = platform;
    this.log = log;
    this.bus = new EventBus();
    this.settings = new SettingsStore({ kv: platform.kv, bus: this.bus });
    this.registry = new AppRegistry({ kv: platform.kv, bus: this.bus });
    this.permissions = new PermissionManager({ settings: this.settings, registry: this.registry, bus: this.bus });
    this.associations = new FileAssociations({ registry: this.registry, settings: this.settings, bus: this.bus });
    this.notifications = new NotificationService({ settings: this.settings, bus: this.bus });
    this.processes = new ProcessManager({ registry: this.registry, bus: this.bus });
    this.fs = new VirtualFileSystem({ fs: platform.fs, bus: this.bus });
    this.accounts = new AccountService({ kv: platform.kv, fs: this.fs, settings: this.settings, bus: this.bus });
    this.session = { user: null };   // the active (foreground) user
    this.sessions = new Map();       // uid -> { user, startedAt } for everyone signed in
    this.shortcuts = new ShortcutRegistry();
    this.clipboard = new ClipboardHistory({ settings: this.settings, bus: this.bus });
    this.mail = new MailService({ kv: platform.kv, accounts: this.accounts, settings: this.settings, bus: this.bus, notifications: this.notifications });
    this.bus.on('accounts:changed', ({ id, op }) => { if (op === 'remove') this.mail.dropMailbox(id).catch(() => {}); });
    this.windowHost = null;          // set by the shell: (uid) => WindowManager
    this.booted = false;
    this.bootTime = null;
    this.info = null;
    log.subscribe((e) => this.bus.emit('kernel:log', e));
  }

  /** Boots the core. `onProgress(fraction, label)` drives the boot animation. */
  async boot({ onProgress = () => {} } = {}) {
    const t0 = performance.now();
    const steps = [
      ['Starting platform', () => this.platform.init()],
      ['Reading device information', async () => { this.info = await this.platform.info(); }],
      ['Loading settings', () => this.settings.loadSystem()],
      ['Loading accounts', () => this.accounts.load()],
      ['Preparing file system', () => this.#ensureLayout()],
      ['Loading apps', () => this.#loadApps()],
      ['Starting services', () => this.#startServices()],
    ];
    for (let i = 0; i < steps.length; i++) {
      const [label, fn] = steps[i];
      onProgress(i / steps.length, label);
      try { await fn(); }
      catch (err) {
        log.error('kernel', `Boot step "${label}" failed: ${err.message}`, { stack: err.stack });
        throw err;
      }
    }
    onProgress(1, 'Ready');
    this.booted = true;
    this.bootTime = Date.now();
    log.info('kernel', `DonutOS ${VERSION} booted on ${this.platform.name} in ${Math.round(performance.now() - t0)} ms`);
    this.bus.emit('kernel:ready', { platform: this.platform.name, ms: performance.now() - t0 });
    return this;
  }

  async #ensureLayout() {
    for (const dir of ['/System', '/Users', '/Users/Public']) await this.fs.mkdir(dir, { recursive: true });
    for (const f of HOME_FOLDERS) await this.fs.mkdir(P.join('/Users/Public', f), { recursive: true });
    const versionFile = '/System/version.json';
    const current = await this.fs.readJSON(versionFile, null);
    if (current?.version !== VERSION) {
      await this.fs.writeJSON(versionFile, { name: 'DonutOS', version: VERSION, installedAt: current?.installedAt || Date.now(), updatedAt: Date.now() });
    }
  }

  async #loadApps() {
    const { BUILTIN_APPS } = await import('../apps/index.js');
    for (const m of BUILTIN_APPS) this.registry.register(m, { builtin: true });
    const { failed } = await this.registry.loadInstalled();
    for (const f of failed) log.warn('kernel', `Installed app "${f.id}" could not be loaded: ${f.error}`);
  }

  /** The shell tells the kernel how to reach each user's window manager. */
  setWindowHost(fn) { this.windowHost = fn; }

  #startServices() {
    this.#routeNotifications();
    this.kernelProcess = this.processes.spawnSystem({ id: 'kernel', name: 'DonutOS Kernel', icon: 'assets/brand/logo.svg' });
    this.#registerContextProviders();
    this.processes.start();
    // Browser downloads are written by the host; announce them like any other new file.
    this.platform.browser.onDownload((d) => { if (d.state === 'completed' && d.path) this.fs.noteExternalChange(d.path); });
    const flush = () => { this.settings.flush().catch(() => {}); };
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  }

  // ── Sessions ─────────────────────────────────────────────────────────
  // Several users can be signed in at once. One session is active (on screen); the others
  // keep running in the background until their user switches back or signs out.

  /** Starts a session for `user` (or resumes it if already signed in) and makes it active. */
  async signIn(user) {
    if (!this.sessions.has(user.id)) {
      if (user.isGuest) await this.accounts.wipeGuest(); // never inherit a previous guest's data
      await this.settings.loadUser(user.id);
      await this.fs.mkdir(user.home, { recursive: true });
      for (const f of HOME_FOLDERS) await this.fs.mkdir(P.join(user.home, f), { recursive: true });
      this.sessions.set(user.id, { user: Object.freeze({ ...user }), startedAt: Date.now() });
      this.bus.emit('session:started', { user: this.sessions.get(user.id).user });
    }
    this.#activate(user.id);
    if (!user.isGuest) this.settings.set('system.lastUser', user.id);
    return this.session.user;
  }

  /** Ends a user's session: their apps are closed and their settings saved. */
  async signOut(uid = this.session.user?.id) {
    const s = this.sessions.get(uid);
    if (!s) return;
    this.bus.emit('session:ending', { user: s.user });
    await this.processes.killAll({ user: uid });
    this.permissions.clearSessionGrants(uid);
    await this.settings.unloadUser(uid);
    this.sessions.delete(uid);
    if (uid === GUEST_ID) await this.accounts.wipeGuest();
    if (this.session.user?.id === uid) {
      this.session.user = null;
      this.bus.emit('session:changed', { user: null });
    }
    this.bus.emit('session:ended', { user: s.user });
  }

  /** Brings an already signed-in session to the foreground. */
  #activate(uid) {
    const s = this.sessions.get(uid);
    this.settings.activateUser(uid);
    if (this.session.user?.id === uid) return;
    this.session.user = s.user;
    this.bus.emit('session:changed', { user: s.user });
  }

  /** Re-reads the active user's public record after an account change (name, picture). */
  refreshSessionUser(uid) {
    const s = this.sessions.get(uid);
    const fresh = this.accounts.get(uid);
    if (!s || !fresh) return;
    s.user = Object.freeze({ ...fresh });
    if (this.session.user?.id === uid) this.session.user = s.user;
    this.bus.emit('session:userUpdated', { user: s.user });
  }

  /** Compatibility helper used by tests: sign in `user`, or sign the active user out. */
  async setSessionUser(user) {
    if (user) await this.signIn(user);
    else await this.signOut();
  }

  home() { return this.session.user?.home || '/Users/Public'; }
  homeFor(uid) { return this.sessions.get(uid)?.user.home || '/Users/Public'; }

  /** Erases every account, file and setting and restarts into first-time setup. */
  async factoryReset() {
    this.bus.emit('kernel:powerOff', { reason: 'reset' });
    await this.processes.killAll();
    for (const uid of [...this.sessions.keys()]) await this.settings.unloadUser(uid);
    this.sessions.clear();
    for (const e of await this.fs.readdir('/', { hidden: true })) await this.fs.remove(e.path, { recursive: true });
    for (const key of await this.platform.kv.keys('')) await this.platform.kv.delete(key);
    return this.platform.power.restart();
  }

  // ── Launching ────────────────────────────────────────────────────────

  launch(appId, args = {}, opts = {}) {
    return this.processes.spawn(appId, { args, user: this.session.user?.id || null, ...opts });
  }

  /** Puts the active user's apps on hold while the screen is locked (shell decides UI). */
  lock() { this.bus.emit('session:locked', { user: this.session.user }); }
  unlock() { this.bus.emit('session:unlocked', { user: this.session.user }); }

  /**
   * Opens a file with its default app. Resolves with the process, or null when no app
   * can open it — the shell then shows the "Open with" dialog (kernel:openWith).
   */
  async open(path, { appId, user } = {}) {
    const s = await this.fs.stat(path);
    if (!s) throw new ProcessError('ENOENT', `${path} does not exist`);
    const opts = user ? { user } : {};
    if (s.type === 'dir') return this.launch('explorer', { path }, opts);
    const target = appId || this.associations.appForPath(path);
    if (!target) { this.bus.emit('kernel:openWith', { path }); return null; }
    this.rememberRecent(path, user);
    return this.launch(target, { path }, opts);
  }

  /** Adds a file to the user's recent items (Start, Explorer Home, taskbar jump lists). */
  rememberRecent(path, uid = this.session.user?.id) {
    if (!uid || !this.settings.isLoaded(uid)) return;
    const list = this.settings.get('start.recentFiles', uid).filter((r) => r.path !== path);
    this.settings.set('start.recentFiles', [{ path, time: Date.now() }, ...list].slice(0, 30), uid);
  }

  // ── Power ────────────────────────────────────────────────────────────

  async prepareForPowerOff() {
    this.bus.emit('kernel:powerOff', {});
    await this.processes.killAll();
    await this.settings.flush();
  }

  async shutdown() { await this.prepareForPowerOff(); return this.platform.power.shutdown(); }
  async restart() { await this.prepareForPowerOff(); return this.platform.power.restart(); }

  /**
   * Clicking a notification: the app's running process gets it via ctx.onNotification();
   * if the app isn't running it is started with { notification } in its args.
   */
  #routeNotifications() {
    this.bus.on('notification:activated', (n) => {
      // Notifications posted by a shell service (alarms, reminders) are answered by that service.
      if (n.data?.service) return;
      if (!this.registry.has(n.appId)) return;
      const procs = this.processes.byApp(n.appId).filter((p) => p.user === n.uid && p._notificationHandlers?.length);
      const payload = { id: n.id, actionId: n.actionId, data: n.data, title: n.title };
      if (procs.length) {
        for (const h of procs[0]._notificationHandlers) { try { procs[0].run(h, null, [payload]); } catch { /* logged */ } }
        return;
      }
      this.processes.spawn(n.appId, { args: { notification: payload }, user: n.uid }).catch(() => {});
    });
  }

  // ── App context ──────────────────────────────────────────────────────

  #registerContextProviders() {
    const k = this;
    const pm = this.processes;
    const need = async (proc, perm) => {
      if (!(await k.permissions.request(proc.appId, perm, proc.user))) throw new PermissionError(proc.appId, perm);
    };
    // A process belongs to the user who started it, even when another user is on screen.
    const permsFor = (proc) => ({ request: (appId, perm) => k.permissions.request(appId, perm, proc.user) });

    pm.provide('fs', (proc) => k.fs.forApp(proc.appId, { permissions: permsFor(proc), getHome: () => k.homeFor(proc.user) }));

    // Free-form, per-user storage private to the app.
    pm.provide('storage', (proc) => {
      const prefix = `app.${proc.appId}.`;
      const check = (key) => { if (typeof key !== 'string' || !/^[\w.-]{1,100}$/.test(key)) throw new TypeError('Storage keys must be 1-100 letters, digits, "_", "-" or "."'); return prefix + key; };
      const loaded = () => proc.user && k.settings.isLoaded(proc.user);
      return Object.freeze({
        get: (key, fallback = null) => { const v = loaded() ? k.settings.get(check(key), proc.user) : null; return v === null || v === undefined ? fallback : v; },
        set: (key, value) => k.settings.set(check(key), value, proc.user),
        remove: (key) => k.settings.reset(check(key), proc.user),
        keys: () => k.settings.keys(prefix, proc.user).filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length)),
        watch: (key, fn) => k.settings.watch(check(key), proc.wrap(fn), { owner: proc.pid, uid: proc.user }),
      });
    });

    pm.provide('settings', (proc) => Object.freeze({
      get: (key) => k.settings.get(key, proc.user),
      watch: (pattern, fn) => k.settings.watch(pattern, proc.wrap(fn), { owner: proc.pid, uid: proc.user }),
      set: async (key, value) => { await need(proc, 'system.settings'); return k.settings.set(key, value, proc.user); },
      reset: async (key) => { await need(proc, 'system.settings'); return k.settings.reset(key, proc.user); },
    }));

    pm.provide('permissions', (proc) => Object.freeze({
      check: (perm) => k.permissions.check(proc.appId, perm, proc.user),
      request: (perm) => k.permissions.request(proc.appId, perm, proc.user),
      status: (perm) => k.permissions.status(proc.appId, perm, proc.user),
      list: () => k.permissions.listForApp(proc.appId, proc.user),
    }));

    pm.provide('notify', (proc) => async (opts) => {
      await need(proc, 'notifications');
      return k.notifications.post({ ...opts, appId: proc.appId, appName: proc.name, icon: opts.icon || proc.icon, uid: proc.user });
    });

    pm.provide('onNotification', (proc) => (fn) => { (proc._notificationHandlers ||= []).push(fn); });

    pm.provide('windows', (proc) => Object.freeze({
      create: (opts = {}) => {
        const wm = k.windowHost?.(proc.user);
        if (!wm) throw new ProcessError('ENOWM', 'No desktop is available for this app');
        return wm.create(proc, opts);
      },
      list: () => (k.windowHost?.(proc.user)?.forPid(proc.pid) || []),
    }));

    pm.provide('net', (proc) => Object.freeze({
      /** fetch() that respects the network permission and Wi-Fi/airplane mode. */
      fetch: async (url, opts) => { await need(proc, 'network'); return fetch(url, opts); },
      online: () => k.permissions.status(proc.appId, 'network', proc.user) !== 'blocked' && navigator.onLine,
    }));

    pm.provide('clipboard', (proc) => Object.freeze({
      writeText: async (text) => {
        await navigator.clipboard.writeText(String(text));
        if (proc.user === k.session.user?.id) k.clipboard.record(String(text));
      },
      readText: async () => { await need(proc, 'clipboard'); return navigator.clipboard.readText(); },
    }));

    // Built-in system apps (Settings, Recycle Bin, Task Manager, File Explorer) manage the
    // system itself, so they get the kernel. Installed apps never do.
    pm.provide('privileged', (proc) => (proc.app.builtin && proc.app.privileged ? k : null));

    pm.provide('accounts', (proc) => Object.freeze({
      current: () => k.sessions.get(proc.user)?.user || null,
      list: () => k.accounts.list(),
    }));

    // Camera and microphone, behind their permissions. Streams stop when the app exits.
    pm.provide('media', (proc, ctx) => Object.freeze({
      getUserMedia: async (constraints = {}) => {
        if (constraints.video) await need(proc, 'camera');
        if (constraints.audio) await need(proc, 'microphone');
        if (!navigator.mediaDevices?.getUserMedia) throw new ProcessError('ENODEV', 'This device has no camera or microphone access');
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const kinds = stream.getTracks().map((t) => t.kind);
        k.bus.emit('media:active', { pid: proc.pid, appId: proc.appId, name: proc.name, uid: proc.user, kinds });
        const stop = () => {
          stream.getTracks().forEach((t) => t.stop());
          k.bus.emit('media:inactive', { pid: proc.pid, appId: proc.appId, uid: proc.user, kinds });
        };
        let stopped = false;
        const once = () => { if (!stopped) { stopped = true; stop(); } };
        stream.getTracks().forEach((t) => t.addEventListener('ended', () => { if (stream.getTracks().every((x) => x.readyState === 'ended')) once(); }));
        ctx.own(once);
        return Object.assign(stream, { release: once });
      },
      devices: async () => (await navigator.mediaDevices?.enumerateDevices?.() || []).map((d) => ({ kind: d.kind, label: d.label, deviceId: d.deviceId })),
    }));

    // Web pages for the Browser app. Opening pages needs the network permission.
    pm.provide('browser', (proc, ctx) => {
      const b = k.platform.browser;
      return Object.freeze({
        kind: b.kind,
        createView: async ({ private: incognito = false } = {}) => {
          await need(proc, 'network');
          const v = b.createView({ partition: incognito ? 'donut-private' : 'persist:donut-browser' });
          ctx.own(() => v.destroy());
          return v;
        },
        online: () => k.permissions.status(proc.appId, 'network', proc.user) !== 'blocked' && navigator.onLine,
        setDownloadDir: (path) => {
          const home = k.homeFor(proc.user);
          if (!P.isSameOrInside(home, P.normalize(path))) throw new ProcessError('EACCES', 'Downloads must go inside your user folder');
          return b.setDownloadDir(P.normalize(path));
        },
        /** A view for the user's own files (HTML, SVG, PDF), isolated from DonutOS on both platforms. */
        createFileView: ({ pdf = false } = {}) => { const v = createFrameView({ sandbox: pdf ? 'none' : 'strict' }); ctx.own(() => v.destroy()); return v; },
        onDownload: (fn) => ctx.own(b.onDownload(proc.wrap(fn))),
        cancelDownload: (id) => b.cancelDownload(id),
        onOpenRequest: (fn) => ctx.own(b.onOpenRequest(proc.wrap(fn))),
        clearData: (what) => b.clearData(what),
      });
    });

    pm.provide('addRecent', (proc) => (path) => this.rememberRecent(path, proc.user));

    pm.provide('launch', (proc) => (appId, args) => k.launch(appId, args, { user: proc.user }));
    pm.provide('open', (proc) => (path, opts = {}) => k.open(path, { ...opts, user: proc.user }));

    pm.provide('processes', (proc) => Object.freeze({
      list: async () => { await need(proc, 'system.processes'); return pm.snapshot(); },
      kill: async (pid) => {
        if (pid !== proc.pid) await need(proc, 'system.processes');
        return pm.kill(pid);
      },
      self: () => proc.info(),
    }));

    pm.provide('system', (proc, ctx) => Object.freeze({
      platform: () => k.platform.name,         // informational only; apps must not branch on it
      version: () => VERSION,
      info: () => k.info,
      stats: () => k.platform.system.stats(),
      battery: () => k.platform.system.battery(),
      network: () => k.platform.system.network(),
      onBatteryChange: (fn) => ctx.own(k.platform.system.onBatteryChange(proc.wrap(fn))),
      onNetworkChange: (fn) => ctx.own(k.platform.system.onNetworkChange(proc.wrap(fn))),
      user: () => k.sessions.get(proc.user)?.user || null,
      log: (msg, data) => log.info(proc.appId, msg, data),
    }));

    pm.provide('host', (proc) => Object.freeze({
      importFiles: (opts) => k.platform.host.importFiles(opts),
      exportFile: (name, data, mime) => k.platform.host.exportFile(name, data, mime),
      openExternal: async (url) => { await need(proc, 'network'); return k.platform.host.openExternal(url); },
    }));

    pm.provide('power', (proc) => Object.freeze({
      shutdown: async () => { await need(proc, 'system.power'); return k.shutdown(); },
      restart: async () => { await need(proc, 'system.power'); return k.restart(); },
    }));
  }
}

export function createKernel({ platform }) {
  return new Kernel({ platform });
}
