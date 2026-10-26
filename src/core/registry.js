// App registry: every app DonutOS knows about, built-in or installed from the Store.
//
// A manifest looks like:
// {
//   id: 'notepad', name: 'Notepad', version: '1.0.0', icon: 'assets/icons/apps/notepad.svg',
//   entry: 'apps/notepad/main.js',          // ES module URL, relative to /src
//   permissions: ['files.read', 'files.write'],
//   fileTypes: ['.txt', '.md'],              // extensions it can open
//   preferredTypes: ['.txt'],                // of those, the ones it should open by default
//   singleInstance: false, category: 'Productivity', description: '...',
//   window: { width: 800, height: 600, minWidth: 320, minHeight: 200 },
//   hidden: false                             // hide from Start / search (system services)
// }
// Instead of `entry`, an in-memory `module` ({ default(ctx) }) may be passed (tests, SDK),
// and Store apps persist their code as `source`, which runs sandboxed (src/sandbox/host.js).

import { DonutError } from './errors.js';
import { PERMISSIONS, SANDBOX_PERMISSIONS } from './permissions.js';
import { deepClone } from './util.js';

const INSTALLED_KEY = 'apps:installed';
// Each installed app's code is stored on its own and read when the app starts, so the list
// of installed apps stays small however big the apps are.
const codeKey = (id) => `apps:code:${id}`;
const ID_RE = /^[a-z0-9][a-z0-9.-]{0,62}[a-z0-9]$/;
const VERSION_RE = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['Manifest must be an object'];
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) errors.push('id must be 2-64 lowercase letters, digits, dots or dashes');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 60) errors.push('name is required (max 60 characters)');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) errors.push('version must look like 1.0.0');
  if (!m.entry && !m.module && !m.source && !m.codeStored) errors.push('one of entry, module or source is required');
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
  if (m.source !== undefined || m.codeStored) {
    // Store apps run sandboxed; these powers aren't available to them.
    for (const p of m.permissions || []) if (PERMISSIONS[p] && !SANDBOX_PERMISSIONS.includes(p)) errors.push(`Store apps can't use the "${p}" permission`);
    if (m.privileged) errors.push('Store apps can’t be privileged');
    if (typeof m.source === 'string' && m.source.length > 4 * 1024 * 1024) errors.push('source is larger than 4 MB');
  }
  if (m.preferredTypes !== undefined && !Array.isArray(m.preferredTypes)) errors.push('preferredTypes must be an array');
  return errors;
}

export class AppRegistry {
  #apps = new Map();
  #kv; #bus;

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
      category: 'Other', description: '', icon: new URL('../assets/brand/logo.svg', import.meta.url).href,
      ...manifest,
      builtin, installed,
      system: builtin && manifest.system !== false,
      // Code from the Store runs in a sandboxed frame (src/sandbox/host.js), never in DonutOS's page.
      sandboxed: !!(manifest.source || manifest.codeStored),
    };
    if (m.sandboxed) { delete m.entry; m.privileged = false; }
    this.#apps.set(m.id, m);
    this.#bus?.emit('apps:registered', { id: m.id });
    return m;
  }

  unregister(id) {
    const m = this.#apps.get(id);
    if (!m) return false;
    this.#apps.delete(id);
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
    const errors = validateManifest(manifest);
    if (errors.length) throw new DonutError('EMANIFEST', `Invalid manifest for "${manifest?.id}": ${errors.join('; ')}`, { errors });
    const { source, module, ...rest } = manifest;
    void module;
    const record = deepClone({ ...rest, installedAt: Date.now(), ...(typeof source === 'string' ? { codeStored: true, codeSize: source.length } : {}) });
    if (typeof source === 'string') await this.#kv.set(codeKey(manifest.id), source);
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
    await this.#kv.delete(codeKey(id));
    this.unregister(id);
    this.#bus?.emit('apps:uninstalled', { id });
    return true;
  }

  /** An installed app's code (read from storage the first time it's needed). */
  async code(id) {
    const m = this.#apps.get(id);
    if (!m) throw new DonutError('ENOENT', `App "${id}" is not installed`);
    if (typeof m.source === 'string') return m.source;
    const code = await this.#kv.get(codeKey(id));
    if (typeof code !== 'string') throw new DonutError('ENOENT', `The code of “${m.name}” is missing. Reinstall it from the Store.`);
    return code;
  }

  /** Re-registers apps installed in previous sessions. Broken records are skipped and reported. */
  async loadInstalled() {
    let list = (await this.#kv.get(INSTALLED_KEY)) || [];
    // Older versions kept the code inside the list: move it to its own record, once.
    if (list.some((r) => typeof r.source === 'string')) {
      for (const r of list) if (typeof r.source === 'string') { await this.#kv.set(codeKey(r.id), r.source); r.codeStored = true; r.codeSize = r.source.length; delete r.source; }
      await this.#kv.set(INSTALLED_KEY, list);
    }
    const failed = [];
    for (const rec of list) {
      try { if (!this.#apps.get(rec.id)?.builtin) this.register(rec, { installed: true }); }
      catch (err) { failed.push({ id: rec.id, error: err.message }); }
    }
    return { loaded: list.length - failed.length, failed };
  }

}
