// Central settings store.
//
// - Reads are synchronous (served from memory) so UI code can call get() freely.
// - Writes are validated against SCHEMA, applied immediately in memory, broadcast on the
//   bus as "settings:changed", and persisted through the platform key-value store
//   (IndexedDB on the web, JSON files on the desktop) after a short debounce.
// - flush() forces pending writes to disk; the kernel calls it on shutdown and page hide.

import { lookup } from './settings-schema.js';
import { SettingsError } from './errors.js';
import { deepClone, deepEqual, debounce } from './util.js';
import { log } from './log.js';

const SYSTEM_KEY = 'settings:system';
const userKey = (uid) => `settings:user:${uid}`;

export class SettingsStore {
  #kv; #bus;
  #system = {};
  #user = null;      // values for the signed-in user, or null before sign-in
  #uid = null;
  #dirty = new Set(); // 'system' | uid
  #persistSoon;

  constructor({ kv, bus }) {
    this.#kv = kv;
    this.#bus = bus;
    this.#persistSoon = debounce(() => this.flush(), 200);
  }

  async loadSystem() {
    this.#system = (await this.#kv.get(SYSTEM_KEY)) || {};
  }

  async loadUser(uid) {
    if (this.#uid && this.#uid !== uid) await this.unloadUser();
    this.#uid = uid;
    this.#user = (await this.#kv.get(userKey(uid))) || {};
    this.#bus?.emit('settings:userLoaded', { uid });
  }

  async unloadUser() {
    await this.flush();
    const uid = this.#uid;
    this.#uid = null;
    this.#user = null;
    if (uid) this.#bus?.emit('settings:userUnloaded', { uid });
  }

  get currentUser() { return this.#uid; }

  /** Value of `key`, or its default. Unknown keys throw so typos are caught early. */
  get(key) {
    const def = this.#def(key);
    const store = this.#storeFor(def, key, false);
    const v = store && Object.prototype.hasOwnProperty.call(store, key) ? store[key] : def.default;
    return deepClone(v);
  }

  has(key) {
    const def = lookup(key);
    if (!def) return false;
    const store = this.#storeFor(def, key, false);
    return !!store && Object.prototype.hasOwnProperty.call(store, key);
  }

  set(key, value) {
    const def = this.#def(key);
    this.#validate(key, def, value);
    const store = this.#storeFor(def, key, true);
    const old = this.get(key);
    if (deepEqual(old, value) && Object.prototype.hasOwnProperty.call(store, key)) return value;
    store[key] = deepClone(value);
    this.#markDirty(def);
    this.#bus?.emit('settings:changed', { key, value: deepClone(value), old, scope: def.scope });
    return value;
  }

  /** Applies several values atomically (all validated before any is written). */
  setMany(values) {
    for (const [k, v] of Object.entries(values)) this.#validate(k, this.#def(k), v);
    for (const [k, v] of Object.entries(values)) this.set(k, v);
  }

  reset(key) {
    const def = this.#def(key);
    const store = this.#storeFor(def, key, true);
    if (!Object.prototype.hasOwnProperty.call(store, key)) return;
    const old = store[key];
    delete store[key];
    this.#markDirty(def);
    this.#bus?.emit('settings:changed', { key, value: deepClone(def.default), old, scope: def.scope });
  }

  /** Every stored (non-default) key starting with `prefix` in the relevant scopes. */
  keys(prefix = '') {
    const out = new Set();
    for (const k of Object.keys(this.#system)) if (k.startsWith(prefix)) out.add(k);
    if (this.#user) for (const k of Object.keys(this.#user)) if (k.startsWith(prefix)) out.add(k);
    return [...out];
  }

  /** Removes every stored key with the prefix (used when an app is uninstalled). */
  resetPrefix(prefix) {
    for (const k of this.keys(prefix)) this.reset(k);
  }

  /**
   * Calls `fn(value, key, old)` whenever a key changes. `pattern` is an exact key or a
   * prefix ending in "*" ("appearance.*"). Returns an unsubscribe function.
   */
  watch(pattern, fn, { owner, immediate = false } = {}) {
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null;
    const off = this.#bus.on('settings:changed', ({ key, value, old }) => {
      if (prefix !== null ? key.startsWith(prefix) : key === pattern) fn(value, key, old);
    }, { owner });
    if (immediate && prefix === null) fn(this.get(pattern), pattern, undefined);
    return off;
  }

  async flush() {
    this.#persistSoon.cancel();
    const jobs = [];
    for (const target of this.#dirty) {
      if (target === 'system') jobs.push(this.#kv.set(SYSTEM_KEY, this.#system));
      else if (target === this.#uid && this.#user) jobs.push(this.#kv.set(userKey(target), this.#user));
    }
    this.#dirty.clear();
    try {
      await Promise.all(jobs);
    } catch (err) {
      log.error('settings', `Failed to persist settings: ${err.message}`);
      throw err;
    }
  }

  /** Reads another user's stored settings without loading them (e.g. their lock-screen wallpaper). */
  async peekUser(uid, key) {
    const def = this.#def(key);
    if (uid === this.#uid) return this.get(key);
    const data = (await this.#kv.get(userKey(uid))) || {};
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : deepClone(def.default);
  }

  async deleteUser(uid) {
    if (uid === this.#uid) throw new SettingsError('user', 'Cannot delete the signed-in user\'s settings');
    await this.#kv.delete(userKey(uid));
  }

  #def(key) {
    if (typeof key !== 'string' || !key) throw new SettingsError(String(key), 'Key must be a non-empty string');
    const def = lookup(key);
    if (!def) throw new SettingsError(key, 'Unknown setting');
    return def;
  }

  #storeFor(def, key, forWrite) {
    if (def.scope === 'system') return this.#system;
    if (!this.#user) {
      if (forWrite) throw new SettingsError(key, 'No user is signed in');
      return null;
    }
    return this.#user;
  }

  #markDirty(def) {
    this.#dirty.add(def.scope === 'system' ? 'system' : this.#uid);
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
