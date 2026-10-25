// Process manager.
//
// Every running app is a Process with a PID. An app module exports
//   export default async function main(ctx) { ... }
// and receives a context object (ctx) that is its whole view of the system. Everything the
// app acquires through ctx — bus subscriptions, timers, DOM listeners, windows, open
// devices — is tracked by the process, so kill(pid) can always clean it up completely.
//
// CPU: time spent inside the app's tracked callbacks (timers, listeners, bus handlers,
//      main) as a percentage of wall time. This is the app's share of the DonutOS UI thread.
// Memory: an estimate — a fixed base cost, plus the DOM nodes in its windows, plus bytes
//      the app reports with ctx.trackMemory() (images, audio buffers...). Browsers do not
//      expose per-script heap usage, so this is the closest real measurement available.

import { ProcessError } from './errors.js';
import { log } from './log.js';

const BASE_MEMORY = 1.5 * 1024 * 1024;
const BYTES_PER_NODE = 640;
const SAMPLE_MS = 1000;

export class Process {
  constructor({ pid, app, args, parentPid, critical, user }) {
    this.pid = pid;
    this.appId = app.id;
    this.name = app.name;
    this.icon = app.icon;
    this.app = app;
    this.args = args || {};
    this.parentPid = parentPid ?? null;
    this.critical = !!critical;
    this.user = user || null;
    this.startTime = Date.now();
    this.state = 'starting';  // starting | running | exiting | exited
    this.exitCode = null;
    this.windows = new Set();     // window ids, maintained by the window manager
    this.elements = new Set();    // root DOM elements owned by the process
    this.cpuTime = 0;             // ms spent in tracked callbacks since start
    this.cpu = 0;                 // % over the last sample interval
    this.memory = BASE_MEMORY;
    this.trackedBytes = 0;
    this.status = 'Running';      // human-readable (Running | Not responding | Suspended)
    this.launchMs = null;         // time from spawn until main(ctx) finished
    this._disposers = [];
    this._exitHandlers = [];
    this._activateHandlers = [];
    this._lastCpu = 0;
  }

  /** Runs `fn` while charging its time to this process. */
  run(fn, thisArg, args) {
    if (this.state === 'exited') return undefined;
    const t0 = performance.now();
    try { return fn.apply(thisArg, args); }
    catch (err) {
      log.error(this.appId, `Uncaught error in process ${this.pid}: ${err?.message || err}`, { stack: err?.stack });
      throw err;
    }
    finally { this.cpuTime += performance.now() - t0; }
  }

  /** Wraps a callback so its execution is tracked and errors are logged (not thrown into the shell). */
  wrap(fn) {
    const proc = this;
    return function tracked(...args) {
      try { return proc.run(fn, this, args); } catch { return undefined; }
    };
  }

  addDisposer(fn) { this._disposers.push(fn); return fn; }

  info() {
    return {
      pid: this.pid, appId: this.appId, name: this.name, icon: this.icon, parentPid: this.parentPid,
      critical: this.critical, user: this.user, startTime: this.startTime, state: this.state,
      status: this.status, cpu: this.cpu, memory: this.memory, windows: this.windows.size,
      cpuTime: this.cpuTime, launchMs: this.launchMs,
    };
  }
}

export class ProcessManager {
  #procs = new Map();
  #nextPid = 1;
  #registry; #bus;
  #providers = new Map(); // name -> (proc, ctx) => api   (window manager, notifications, ...)
  #sampler = null;
  #lastSample = performance.now();
  #starting = new Map();  // appId -> Promise (single-instance apps being started)

  constructor({ registry, bus }) {
    this.#registry = registry;
    this.#bus = bus;
  }

  /**
   * Lets a subsystem add a field to every app's ctx. The factory runs once per process.
   * Example: the window manager registers "windows" so apps can call ctx.windows.create().
   */
  provide(name, factory) {
    if (this.#providers.has(name)) throw new Error(`Context provider "${name}" already registered`);
    this.#providers.set(name, factory);
  }

  start() {
    if (this.#sampler) return;
    this.#lastSample = performance.now();
    this.#sampler = setInterval(() => this.#sample(), SAMPLE_MS);
  }

  stop() { clearInterval(this.#sampler); this.#sampler = null; }

  /** Registers a process that represents a core service (no app module is loaded). */
  spawnSystem({ id, name, icon }) {
    const app = this.#registry.get(id) || { id, name, icon, permissions: [] };
    const proc = new Process({ pid: this.#nextPid++, app, critical: true });
    proc.state = 'running';
    this.#procs.set(proc.pid, proc);
    this.#bus.emit('process:start', proc.info());
    return proc;
  }

  /**
   * Starts an app. Resolves with its Process once main(ctx) has returned.
   * Single-instance apps that are already running are activated instead.
   */
  async spawn(appId, { args = {}, parentPid = null, user = null } = {}) {
    const app = this.#registry.get(appId);
    if (!app) throw new ProcessError('ENOAPP', `App "${appId}" is not installed`);

    if (app.singleInstance) {
      const existing = this.byApp(appId).find((p) => p.state === 'running' || p.state === 'starting');
      if (existing || this.#starting.has(appId)) {
        const proc = existing || (await this.#starting.get(appId));
        this.#activate(proc, args);
        return proc;
      }
    }

    const proc = new Process({ pid: this.#nextPid++, app, args, parentPid, user });
    this.#procs.set(proc.pid, proc);
    const job = this.#launch(proc);
    if (app.singleInstance) this.#starting.set(appId, job.then(() => proc, () => proc));
    try { await job; } finally { this.#starting.delete(appId); }
    return proc;
  }

  async #launch(proc) {
    const app = proc.app;
    const t0 = performance.now();
    this.#bus.emit('process:start', proc.info());
    try {
      const mod = app.module
        || (app.sandboxed ? (await import('../sandbox/host.js')).sandboxModule(app) : await import(new URL(app.entry, document.baseURI).href));
      const main = mod.default || mod.main;
      if (typeof main !== 'function') throw new ProcessError('ENOMAIN', `${app.id} does not export a main(ctx) function`);
      const ctx = this.#createContext(proc);
      proc.ctx = ctx;
      const result = proc.run(main, null, [ctx]);
      // Time spent awaiting inside an async main is idle, so only its sync slices were charged.
      if (result && typeof result.then === 'function') await result;
      if (proc.state === 'starting') {
        proc.launchMs = Math.round(performance.now() - t0);
        proc.state = 'running';
        this.#bus.emit('process:running', proc.info());
      }
    } catch (err) {
      log.error('process', `${app.id} failed to start: ${err?.message || err}`, { stack: err?.stack });
      this.#bus.emit('process:crash', { pid: proc.pid, appId: app.id, name: app.name, error: String(err?.message || err) });
      if (proc.state !== 'exited') await this.kill(proc.pid, { force: true, code: 1 });
      throw err instanceof ProcessError ? err : new ProcessError('ECRASH', `${app.name} could not start: ${err?.message || err}`);
    }
  }

  /** Ends a process and frees everything it owned. Critical processes need { force: true }. */
  async kill(pid, { force = false, code = 0 } = {}) {
    const proc = this.#procs.get(pid);
    if (!proc) throw new ProcessError('ESRCH', `No process with PID ${pid}`);
    if (proc.critical && !force) throw new ProcessError('EPERM', `${proc.name} is a critical system process`);
    if (proc.state === 'exiting' || proc.state === 'exited') return;
    proc.state = 'exiting';
    proc.exitCode = code;
    this.#bus.emit('process:exiting', proc.info());

    // Exit handlers may be async (e.g. saving); a misbehaving one cannot block the kill.
    const handlers = proc._exitHandlers.splice(0);
    await Promise.race([
      Promise.allSettled(handlers.map((h) => { try { return h(code); } catch (e) { return Promise.reject(e); } })),
      new Promise((r) => setTimeout(r, force ? 300 : 2000)),
    ]);

    for (const d of proc._disposers.splice(0).reverse()) {
      try { d(); } catch (err) { log.warn('process', `Cleanup failed for ${proc.appId}: ${err.message}`); }
    }
    this.#bus.offOwner(pid);
    for (const el of proc.elements) el.remove();
    proc.elements.clear();
    proc.state = 'exited';
    this.#procs.delete(pid);
    this.#bus.emit('process:exit', { ...proc.info(), code });
    // Child processes go with their parent, like closing a console.
    for (const child of this.list().filter((p) => p.parentPid === pid)) await this.kill(child.pid, { force, code });
  }

  /** Kills every non-critical process (sign-out, restart). */
  async killAll({ user } = {}) {
    const targets = this.list().filter((p) => !p.critical && (!user || p.user === user));
    await Promise.allSettled(targets.map((p) => this.kill(p.pid, { force: true })));
  }

  get(pid) { return this.#procs.get(pid) || null; }
  list() { return [...this.#procs.values()]; }
  byApp(appId) { return this.list().filter((p) => p.appId === appId); }
  isRunning(appId) { return this.byApp(appId).some((p) => p.state === 'running' || p.state === 'starting'); }
  snapshot() { return this.list().map((p) => p.info()); }

  #activate(proc, args) {
    for (const h of proc._activateHandlers) { try { proc.run(h, null, [args]); } catch { /* logged by run */ } }
    this.#bus.emit('process:activate', { pid: proc.pid, appId: proc.appId, args });
  }

  #sample() {
    const now = performance.now();
    const dt = now - this.#lastSample;
    this.#lastSample = now;
    if (dt <= 0) return;
    for (const p of this.#procs.values()) {
      p.cpu = Math.min(100, ((p.cpuTime - p._lastCpu) / dt) * 100);
      p._lastCpu = p.cpuTime;
      let nodes = 0;
      for (const el of p.elements) nodes += 1 + el.getElementsByTagName('*').length;
      p.memory = (p.critical && !p.elements.size ? 0.5 * 1024 * 1024 : BASE_MEMORY) + nodes * BYTES_PER_NODE + p.trackedBytes;
    }
    this.#bus.emit('process:sample', this.snapshot());
  }

  #createContext(proc) {
    const bus = this.#bus;
    const pm = this;
    const pid = proc.pid;

    const timers = new Set();
    const intervals = new Set();
    const frames = new Set();
    proc.addDisposer(() => {
      for (const t of timers) clearTimeout(t);
      for (const t of intervals) clearInterval(t);
      for (const f of frames) cancelAnimationFrame(f);
    });

    const ctx = {
      pid,
      app: Object.freeze({ id: proc.app.id, name: proc.app.name, version: proc.app.version, icon: proc.app.icon, permissions: [...(proc.app.permissions || [])] }),
      args: proc.args,

      bus: {
        on: (event, fn) => bus.on(event, proc.wrap(fn), { owner: pid }),
        once: (event, fn) => bus.once(event, proc.wrap(fn), { owner: pid }),
        emit: (event, payload) => {
          if (/^(process|kernel|settings|fs|session|permissions|apps):/.test(event)) {
            throw new ProcessError('EPERM', `Apps cannot emit system events ("${event}")`);
          }
          return bus.emit(event, payload);
        },
      },

      setTimeout(fn, ms, ...a) {
        const id = setTimeout(() => { timers.delete(id); proc.wrap(fn)(...a); }, ms);
        timers.add(id); return id;
      },
      clearTimeout(id) { clearTimeout(id); timers.delete(id); },
      setInterval(fn, ms, ...a) {
        const id = setInterval(proc.wrap(fn), ms, ...a);
        intervals.add(id); return id;
      },
      clearInterval(id) { clearInterval(id); intervals.delete(id); },
      requestAnimationFrame(fn) {
        const id = requestAnimationFrame((t) => { frames.delete(id); proc.wrap(fn)(t); });
        frames.add(id); return id;
      },
      cancelAnimationFrame(id) { cancelAnimationFrame(id); frames.delete(id); },

      /** addEventListener that is tracked for CPU and removed automatically on exit. */
      listen(target, type, fn, opts) {
        const w = proc.wrap(fn);
        target.addEventListener(type, w, opts);
        const off = () => target.removeEventListener(type, w, opts);
        proc.addDisposer(off);
        return off;
      },

      /** Registers cleanup to run when the process exits (closing devices, saving...). */
      onExit(fn) { proc._exitHandlers.push(fn); },
      /** Called when a single-instance app is launched again (e.g. to open another file). */
      onActivate(fn) { proc._activateHandlers.push(fn); },
      /** Runs `fn` when the process exits; for resources like MediaStreams or object URLs. */
      own(dispose) { proc.addDisposer(dispose); return dispose; },
      /** Claims a DOM element so it is removed when the process exits and counted as its memory. */
      ownElement(el) { proc.elements.add(el); return el; },
      trackMemory(bytes) { proc.trackedBytes = Math.max(0, proc.trackedBytes + bytes); },
      exit(code = 0) { return pm.kill(pid, { code, force: true }); },
    };

    for (const [name, factory] of this.#providers) {
      try { ctx[name] = factory(proc, ctx); }
      catch (err) { log.error('process', `Context provider "${name}" failed: ${err.message}`); }
    }
    return Object.freeze(ctx);
  }
}
