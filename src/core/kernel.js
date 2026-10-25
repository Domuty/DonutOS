// The DonutOS kernel: creates every core service, wires them together, and builds the
// API (ctx) that apps receive. The shell and apps reach the system only through here.

import { EventBus } from './event-bus.js';
import { SettingsStore } from './settings.js';
import { AppRegistry } from './registry.js';
import { PermissionManager } from './permissions.js';
import { FileAssociations } from './file-associations.js';
import { NotificationService } from './notifications.js';
import { ProcessManager } from './process-manager.js';
import { VirtualFileSystem, HOME_FOLDERS } from './vfs.js';
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
    this.session = { user: null };   // { id, name, home, isGuest } once signed in (phase 2)
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

  #startServices() {
    this.kernelProcess = this.processes.spawnSystem({ id: 'kernel', name: 'DonutOS Kernel', icon: 'assets/brand/logo.svg' });
    this.#registerContextProviders();
    this.processes.start();
    const flush = () => { this.settings.flush().catch(() => {}); };
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  }

  // ── Session (accounts arrive in phase 2) ─────────────────────────────

  async setSessionUser(user) {
    if (user) {
      await this.settings.loadUser(user.id);
      await this.fs.mkdir(user.home, { recursive: true });
      for (const f of HOME_FOLDERS) await this.fs.mkdir(P.join(user.home, f), { recursive: true });
    } else {
      await this.processes.killAll();
      this.permissions.clearSessionGrants();
      await this.settings.unloadUser();
    }
    this.session.user = user ? Object.freeze({ ...user }) : null;
    this.bus.emit('session:changed', { user: this.session.user });
  }

  home() { return this.session.user?.home || '/Users/Public'; }

  // ── Launching ────────────────────────────────────────────────────────

  launch(appId, args = {}, opts = {}) {
    return this.processes.spawn(appId, { args, user: this.session.user?.id || null, ...opts });
  }

  /**
   * Opens a file with its default app. Resolves with the process, or null when no app
   * can open it — the shell then shows the "Open with" dialog (kernel:openWith).
   */
  async open(path, { appId } = {}) {
    const s = await this.fs.stat(path);
    if (!s) throw new ProcessError('ENOENT', `${path} does not exist`);
    if (s.type === 'dir') return this.launch('explorer', { path });
    const target = appId || this.associations.appForPath(path);
    if (!target) { this.bus.emit('kernel:openWith', { path }); return null; }
    this.#rememberRecent(path);
    return this.launch(target, { path });
  }

  #rememberRecent(path) {
    if (!this.session.user) return;
    const list = this.settings.get('start.recentFiles').filter((r) => r.path !== path);
    this.settings.set('start.recentFiles', [{ path, time: Date.now() }, ...list].slice(0, 30));
  }

  // ── Power ────────────────────────────────────────────────────────────

  async prepareForPowerOff() {
    this.bus.emit('kernel:powerOff', {});
    await this.processes.killAll();
    await this.settings.flush();
  }

  async shutdown() { await this.prepareForPowerOff(); return this.platform.power.shutdown(); }
  async restart() { await this.prepareForPowerOff(); return this.platform.power.restart(); }

  // ── App context ──────────────────────────────────────────────────────

  #registerContextProviders() {
    const k = this;
    const pm = this.processes;
    const need = async (proc, perm) => {
      if (!(await k.permissions.request(proc.appId, perm))) throw new PermissionError(proc.appId, perm);
    };

    pm.provide('fs', (proc) => k.fs.forApp(proc.appId, { permissions: k.permissions, getHome: () => k.home() }));

    // Free-form, per-user storage private to the app.
    pm.provide('storage', (proc) => {
      const prefix = `app.${proc.appId}.`;
      const check = (key) => { if (typeof key !== 'string' || !/^[\w.-]{1,100}$/.test(key)) throw new TypeError('Storage keys must be 1-100 letters, digits, "_", "-" or "."'); return prefix + key; };
      return Object.freeze({
        get: (key, fallback = null) => { const v = k.settings.currentUser ? k.settings.get(check(key)) : null; return v === null || v === undefined ? fallback : v; },
        set: (key, value) => k.settings.set(check(key), value),
        remove: (key) => k.settings.reset(check(key)),
        keys: () => k.settings.keys(prefix).map((x) => x.slice(prefix.length)),
        watch: (key, fn) => k.settings.watch(check(key), proc.wrap(fn), { owner: proc.pid }),
      });
    });

    pm.provide('settings', (proc) => Object.freeze({
      get: (key) => k.settings.get(key),
      watch: (pattern, fn) => k.settings.watch(pattern, proc.wrap(fn), { owner: proc.pid }),
      set: async (key, value) => { await need(proc, 'system.settings'); return k.settings.set(key, value); },
      reset: async (key) => { await need(proc, 'system.settings'); return k.settings.reset(key); },
    }));

    pm.provide('permissions', (proc) => Object.freeze({
      check: (perm) => k.permissions.check(proc.appId, perm),
      request: (perm) => k.permissions.request(proc.appId, perm),
      status: (perm) => k.permissions.status(proc.appId, perm),
      list: () => k.permissions.listForApp(proc.appId),
    }));

    pm.provide('notify', (proc) => async (opts) => {
      await need(proc, 'notifications');
      return k.notifications.post({ ...opts, appId: proc.appId, appName: proc.name, icon: opts.icon || proc.icon });
    });

    pm.provide('launch', () => (appId, args) => k.launch(appId, args));
    pm.provide('open', () => (path, opts) => k.open(path, opts));

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
      user: () => k.session.user,
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
