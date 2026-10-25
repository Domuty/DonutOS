// App registry: every app DonutOS knows about, built-in or installed from the Store.
//
// A manifest looks like:
// {
//   id: 'notepad', name: 'Notepad', version: '1.0.0', icon: 'assets/icons/apps/notepad.svg',
//   entry: 'apps/notepad/main.js',          // ES module URL, relative to /src
//   permissions: ['files.read', 'files.write'],
//   fileTypes: ['.txt', '.md'],              // extensions it can open
//   singleInstance: false, category: 'Productivity', description: '...',
//   window: { width: 800, height: 600, minWidth: 320, minHeight: 200 },
//   hidden: false                             // hide from Start / search (system services)
// }
// Instead of `entry`, an in-memory `module` ({ default(ctx) }) may be passed (tests, SDK),
// and Store apps persist their code as `source` which is loaded from a Blob URL.

import { DonutError } from './errors.js';
import { PERMISSIONS } from './permissions.js';
import { deepClone } from './util.js';

const INSTALLED_KEY = 'apps:installed';
const ID_RE = /^[a-z0-9][a-z0-9.-]{0,62}[a-z0-9]$/;
const VERSION_RE = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['Manifest must be an object'];
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) errors.push('id must be 2-64 lowercase letters, digits, dots or dashes');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 60) errors.push('name is required (max 60 characters)');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) errors.push('version must look like 1.0.0');
  if (!m.entry && !m.module && !m.source) errors.push('one of entry, module or source is required');
  if (m.entry !== undefined && typeof m.entry !== 'string') errors.push('entry must be a string');
  if (m.source !== undefined && typeof m.source !== 'string') errors.push('source must be a string of JavaScript');
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) errors.push('permissions must be an array');
    else for (const p of m.permissions) if (!PERMISSIONS[p]) errors.push(`unknown permission "${p}"`);
  }
  if (m.fileTypes !== undefined) {
    if (!Array.isArray(m.fileTypes)) errors.push('fileTypes must be an array');
    else for (const t of m.fileTypes) if (typeof t !== 'string' || !/^\.[a-z0-9]+$/.test(t)) errors.push(`fileTypes entry "${t}" must look like ".txt"`);
  }
  if (m.window !== undefined && (typeof m.window !== 'object' || m.window === null)) errors.push('window must be an object');
  return errors;
}

export class AppRegistry {
  #apps = new Map();
  #kv; #bus;
  #blobUrls = new Map();

  constructor({ kv, bus }) {
    this.#kv = kv;
    this.#bus = bus;
  }

  /** Registers a manifest for this session (built-in apps call this at boot). */
  register(manifest, { builtin = false, installed = false } = {}) {
    const errors = validateManifest(manifest);
    if (errors.length) throw new DonutError('EMANIFEST', `Invalid manifest for "${manifest?.id}": ${errors.join('; ')}`, { errors });
    const m = {
      permissions: [], fileTypes: [], singleInstance: false, hidden: false,
      category: 'Other', description: '', icon: 'assets/brand/logo.svg',
      ...manifest,
      builtin, installed,
      system: builtin && manifest.system !== false,
    };
    if (m.source) m.entry = this.#blobUrlFor(m.id, m.source);
    this.#apps.set(m.id, m);
    this.#bus?.emit('apps:registered', { id: m.id });
    return m;
  }

  unregister(id) {
    const m = this.#apps.get(id);
    if (!m) return false;
    this.#apps.delete(id);
    const url = this.#blobUrls.get(id);
    if (url) { URL.revokeObjectURL(url); this.#blobUrls.delete(id); }
    this.#bus?.emit('apps:unregistered', { id });
    return true;
  }

  get(id) { return this.#apps.get(id) || null; }
  has(id) { return this.#apps.has(id); }

  list({ includeHidden = false } = {}) {
    return [...this.#apps.values()]
      .filter((a) => includeHidden || !a.hidden)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /** Installs an app permanently (Store / sideloading). `manifest.source` holds the code. */
  async install(manifest) {
    const existing = this.#apps.get(manifest.id);
    if (existing?.builtin) throw new DonutError('EEXIST', `"${manifest.id}" is a built-in app`);
    const record = deepClone({ ...manifest, installedAt: Date.now() });
    delete record.module;
    const list = (await this.#kv.get(INSTALLED_KEY)) || [];
    const next = list.filter((r) => r.id !== manifest.id).concat(record);
    if (existing) this.unregister(manifest.id);
    const m = this.register(record, { installed: true });
    await this.#kv.set(INSTALLED_KEY, next);
    this.#bus?.emit('apps:installed', { id: m.id, version: m.version, updated: !!existing });
    return m;
  }

  async uninstall(id) {
    const m = this.#apps.get(id);
    if (!m) throw new DonutError('ENOENT', `App "${id}" is not installed`);
    if (m.builtin) throw new DonutError('EACCES', `"${m.name}" is a built-in app and cannot be uninstalled`);
    const list = (await this.#kv.get(INSTALLED_KEY)) || [];
    await this.#kv.set(INSTALLED_KEY, list.filter((r) => r.id !== id));
    this.unregister(id);
    this.#bus?.emit('apps:uninstalled', { id });
    return true;
  }

  /** Re-registers apps installed in previous sessions. Broken records are skipped and reported. */
  async loadInstalled() {
    const list = (await this.#kv.get(INSTALLED_KEY)) || [];
    const failed = [];
    for (const rec of list) {
      try { if (!this.#apps.get(rec.id)?.builtin) this.register(rec, { installed: true }); }
      catch (err) { failed.push({ id: rec.id, error: err.message }); }
    }
    return { loaded: list.length - failed.length, failed };
  }

  #blobUrlFor(id, source) {
    const old = this.#blobUrls.get(id);
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    this.#blobUrls.set(id, url);
    return url;
  }
}
