// Central settings store.
//
// - Reads are synchronous (served from memory) so UI code can call get() freely.
// - Writes are validated against SCHEMA, applied immediately in memory, broadcast on the
//   bus as "settings:changed", and persisted through the platform key-value store
//   (IndexedDB on the web, JSON files on the desktop) after a short debounce.
// - Several users can be signed in at once (fast user switching). One of them is the
//   "active" user whose values get()/set() use by default; pass `uid` to address another,
//   or use forUser(uid) for a view bound to one user.
// - flush() forces pending writes to disk; the kernel calls it on shutdown and page hide.

import { lookup } from './settings-schema.js';
import { SettingsError } from './errors.js';
import { deepClone, deepEqual, debounce } from './util.js';
import { log } from './log.js';

const SYSTEM_KEY = 'settings:system';
const userKey = (uid) => `settings:user:${uid}`;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export class SettingsStore {
  #kv; #bus;
  #system = {};
  #users = new Map();   // uid -> values, for every signed-in user
  #uid = null;          // the active user
  #dirty = new Set();   // 'system' | uid
  #persistSoon;

  constructor({ kv, bus }) {
    this.#kv = kv;
    this.#bus = bus;
    this.#persistSoon = debounce(() => this.flush(), 200);
  }

  async loadSystem() {
    this.#system = (await this.#kv.get(SYSTEM_KEY)) || {};
  }

  /** Loads a user's settings (if not loaded yet) and makes them the active user. */
  async loadUser(uid) {
    if (!this.#users.has(uid)) this.#users.set(uid, (await this.#kv.get(userKey(uid))) || {});
    this.#uid = uid;
    this.#bus?.emit('settings:userLoaded', { uid });
  }

  /** Switches the active user to one that is already loaded. */
  activateUser(uid) {
    if (!this.#users.has(uid)) throw new SettingsError('user', `User ${uid} is not loaded`);
    this.#uid = uid;
    this.#bus?.emit('settings:userActivated', { uid });
  }

  async unloadUser(uid = this.#uid) {
    if (!uid || !this.#users.has(uid)) return;
    await this.flush();
    this.#users.delete(uid);
    if (this.#uid === uid) this.#uid = null;
    this.#bus?.emit('settings:userUnloaded', { uid });
  }

  get currentUser() { return this.#uid; }
  loadedUsers() { return [...this.#users.keys()]; }
  isLoaded(uid) { return this.#users.has(uid); }

  /** Value of `key` (for `uid`, default: the active user), or its default. Unknown keys throw. */
  get(key, uid = this.#uid) {
    const def = this.#def(key);
    const store = this.#storeFor(def, key, false, uid);
    return deepClone(store && own(store, key) ? store[key] : def.default);
  }

  has(key, uid = this.#uid) {
    const def = lookup(key);
    if (!def) return false;
    const store = this.#storeFor(def, key, false, uid);
    return !!store && own(store, key);
  }

  set(key, value, uid = this.#uid) {
    const def = this.#def(key);
    this.#validate(key, def, value);
    const store = this.#storeFor(def, key, true, uid);
    const old = this.get(key, uid);
    if (deepEqual(old, value) && own(store, key)) return value;
    store[key] = deepClone(value);
    this.#markDirty(def, uid);
    this.#bus?.emit('settings:changed', { key, value: deepClone(value), old, scope: def.scope, uid: def.scope === 'system' ? null : uid });
    return value;
  }

  /** Applies several values atomically (all validated before any is written). */
  setMany(values, uid = this.#uid) {
    for (const [k, v] of Object.entries(values)) this.#validate(k, this.#def(k), v);
    for (const [k, v] of Object.entries(values)) this.set(k, v, uid);
  }

  reset(key, uid = this.#uid) {
    const def = this.#def(key);
    const store = this.#storeFor(def, key, true, uid);
    if (!own(store, key)) return;
    const old = store[key];
    delete store[key];
    this.#markDirty(def, uid);
    this.#bus?.emit('settings:changed', { key, value: deepClone(def.default), old, scope: def.scope, uid: def.scope === 'system' ? null : uid });
  }

  /** Every stored (non-default) key starting with `prefix`, system keys plus the user's. */
  keys(prefix = '', uid = this.#uid) {
    const out = new Set();
    for (const k of Object.keys(this.#system)) if (k.startsWith(prefix)) out.add(k);
    const u = this.#users.get(uid);
    if (u) for (const k of Object.keys(u)) if (k.startsWith(prefix)) out.add(k);
    return [...out];
  }

  /** Removes every stored key with the prefix (used when an app is uninstalled). */
  resetPrefix(prefix, uid = this.#uid) {
    for (const k of this.keys(prefix, uid)) this.reset(k, uid);
  }

  /**
   * Calls `fn(value, key, old)` whenever a key changes. `pattern` is an exact key or a
   * prefix ending in "*" ("appearance.*"). User-scope changes are reported for `uid`
   * only (default: whoever is active when the change happens). Returns an unsubscribe.
   */
  watch(pattern, fn, { owner, immediate = false, uid } = {}) {
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null;
    const off = this.#bus.on('settings:changed', (e) => {
      if (e.uid !== null && e.uid !== (uid ?? this.#uid)) return;
      if (prefix !== null ? e.key.startsWith(prefix) : e.key === pattern) fn(e.value, e.key, e.old);
    }, { owner });
    if (immediate && prefix === null) fn(this.get(pattern, uid ?? this.#uid), pattern, undefined);
    return off;
  }

  /** A settings API bound to one user — what a user's apps and shell use. */
  forUser(uid) {
    return Object.freeze({
      uid,
      get: (k) => this.get(k, uid),
      has: (k) => this.has(k, uid),
      set: (k, v) => this.set(k, v, uid),
      setMany: (vals) => this.setMany(vals, uid),
      reset: (k) => this.reset(k, uid),
      keys: (p) => this.keys(p, uid),
      resetPrefix: (p) => { for (const key of this.keys(p, uid)) this.reset(key, uid); },
      watch: (p, fn, o = {}) => this.watch(p, fn, { ...o, uid }),
    });
  }

  async flush() {
    this.#persistSoon.cancel();
    const jobs = [];
    for (const target of this.#dirty) {
      if (target === 'system') jobs.push(this.#kv.set(SYSTEM_KEY, this.#system));
      else if (this.#users.has(target)) jobs.push(this.#kv.set(userKey(target), this.#users.get(target)));
    }
    this.#dirty.clear();
    try {
      await Promise.all(jobs);
    } catch (err) {
      log.error('settings', `Failed to persist settings: ${err.message}`);
      throw err;
    }
  }

  /** Reads a user's stored setting without signing them in (e.g. their lock-screen wallpaper). */
  async peekUser(uid, key) {
    const def = this.#def(key);
    if (this.#users.has(uid)) return this.get(key, uid);
    const data = (await this.#kv.get(userKey(uid))) || {};
    return deepClone(own(data, key) ? data[key] : def.default);
  }

  /** Writes a setting for a user who is not signed in (used when creating an account). */
  async pokeUser(uid, values) {
    for (const [k, v] of Object.entries(values)) this.#validate(k, this.#def(k), v);
    if (this.#users.has(uid)) { this.setMany(values, uid); return; }
    const data = (await this.#kv.get(userKey(uid))) || {};
    await this.#kv.set(userKey(uid), { ...data, ...deepClone(values) });
  }

  async deleteUser(uid) {
    if (this.#users.has(uid)) throw new SettingsError('user', 'Cannot delete the settings of a signed-in user');
    await this.#kv.delete(userKey(uid));
  }

  #def(key) {
    if (typeof key !== 'string' || !key) throw new SettingsError(String(key), 'Key must be a non-empty string');
    const def = lookup(key);
    if (!def) throw new SettingsError(key, 'Unknown setting');
    return def;
  }

  #storeFor(def, key, forWrite, uid) {
    if (def.scope === 'system') return this.#system;
    const store = uid ? this.#users.get(uid) : null;
    if (!store) {
      if (forWrite) throw new SettingsError(key, 'No user is signed in');
      return null;
    }
    return store;
  }

  #markDirty(def, uid) {
    this.#dirty.add(def.scope === 'system' ? 'system' : uid);
    this.#persistSoon();
  }

  #validate(key, def, v) {
    const fail = (msg) => { throw new SettingsError(key, msg); };
    if (v === undefined) fail('Value cannot be undefined');
    if (v === null && def.default === null) return;
    switch (def.type) {
      case 'boolean': if (typeof v !== 'boolean') fail('Expected true or false'); break;
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) fail('Expected a number');
        if (def.min !== undefined && v < def.min) fail(`Must be at least ${def.min}`);
        if (def.max !== undefined && v > def.max) fail(`Must be at most ${def.max}`);
        break;
      case 'string':
        if (typeof v !== 'string') fail('Expected text');
        if (def.maxLength && v.length > def.maxLength) fail(`Must be at most ${def.maxLength} characters`);
        if (def.pattern && !def.pattern.test(v)) fail('Invalid format');
        break;
      case 'array': if (!Array.isArray(v)) fail('Expected a list'); break;
      case 'object': if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('Expected an object'); break;
      case 'any': break;
      default: fail(`Unsupported schema type ${def.type}`);
    }
    if (def.enum && !def.enum.includes(v)) fail(`Must be one of: ${def.enum.join(', ')}`);
    if (def.type === 'any' || def.type === 'object' || def.type === 'array') {
      try { JSON.stringify(v); } catch { fail('Value must be serialisable'); }
    }
  }
}
