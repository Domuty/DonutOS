// App permission system.
//
// Every app declares the permissions it needs in its manifest. A permission that is not
// declared is always denied. Built-in ("system") apps are granted their declared
// permissions automatically; other apps are asked once per user, and the answer is stored
// in the user setting "privacy.grants" where Settings › Privacy can change it later.
// Sensitive device permissions also obey a per-user master switch (privacy.camera, ...).

import { PermissionError } from './errors.js';

export const PERMISSIONS = Object.freeze({
  'files.read':       { label: 'Read your files', description: 'Open files in your user folder.', sensitive: false },
  'files.write':      { label: 'Change your files', description: 'Create, modify and delete files in your user folder.', sensitive: false },
  'system.fs':        { label: 'Access all files', description: 'Read and write files outside your user folder, including system files.', sensitive: true },
  'notifications':    { label: 'Notifications', description: 'Show notifications.', sensitive: false, master: 'privacy.notifications' },
  'camera':           { label: 'Camera', description: 'Use your camera.', sensitive: true, master: 'privacy.camera' },
  'microphone':       { label: 'Microphone', description: 'Use your microphone.', sensitive: true, master: 'privacy.microphone' },
  'location':         { label: 'Location', description: 'Know your approximate location.', sensitive: true, master: 'privacy.location' },
  'network':          { label: 'Internet', description: 'Connect to the internet.', sensitive: false },
  'clipboard':        { label: 'Clipboard', description: 'Read what you copied.', sensitive: true },
  'system.processes': { label: 'Manage apps', description: 'See and end other running apps.', sensitive: true },
  'system.settings':  { label: 'Change system settings', description: 'Change settings that affect the whole device and every user.', sensitive: true },
  'system.apps':      { label: 'Install apps', description: 'Install and uninstall apps.', sensitive: true },
  'system.users':     { label: 'Manage accounts', description: 'Create, change and remove user accounts.', sensitive: true },
  'system.power':     { label: 'Power', description: 'Restart or shut down DonutOS.', sensitive: false },
  'screen':           { label: 'Screen capture', description: 'Capture what is on your screen.', sensitive: true },
});

export class PermissionManager {
  #settings; #registry; #bus;
  #prompter = null;
  #pending = new Map(); // `${appId}|${perm}` -> Promise<boolean>
  #onceGrants = new Set();

  constructor({ settings, registry, bus }) {
    this.#settings = settings;
    this.#registry = registry;
    this.#bus = bus;
  }

  /**
   * The shell installs the dialog that asks the user. It receives
   * { appId, appName, appIcon, permission, info } and resolves to
   * "granted" | "denied" | "once".
   */
  setPrompter(fn) { this.#prompter = fn; }

  /** 'granted' | 'denied' | 'prompt' | 'undeclared' | 'blocked' (master switch off) */
  status(appId, perm) {
    const info = PERMISSIONS[perm];
    if (!info) return 'undeclared';
    const app = this.#registry.get(appId);
    if (!app || !(app.permissions || []).includes(perm)) return 'undeclared';
    if (info.master && this.#settings.currentUser && this.#settings.get(info.master) === false) return 'blocked';
    if (app.system) return 'granted';
    if (this.#onceGrants.has(`${appId}|${perm}`)) return 'granted';
    if (!this.#settings.currentUser) return 'prompt';
    const g = this.#settings.get('privacy.grants')[appId]?.[perm];
    return g === 'granted' || g === 'denied' ? g : 'prompt';
  }

  /** Synchronous check that never prompts. */
  check(appId, perm) { return this.status(appId, perm) === 'granted'; }

  /** Asks the user if needed. Resolves true when the permission is granted. */
  async request(appId, perm) {
    const s = this.status(appId, perm);
    if (s === 'granted') return true;
    if (s !== 'prompt') return false;
    const key = `${appId}|${perm}`;
    if (this.#pending.has(key)) return this.#pending.get(key);
    const p = this.#ask(appId, perm).finally(() => this.#pending.delete(key));
    this.#pending.set(key, p);
    return p;
  }

  /** Like request() but throws PermissionError when denied. */
  async require(appId, perm) {
    if (!(await this.request(appId, perm))) throw new PermissionError(appId, perm);
  }

  /** Throws synchronously if not already granted. */
  assert(appId, perm) {
    if (!this.check(appId, perm)) throw new PermissionError(appId, perm);
  }

  grant(appId, perm) { this.#store(appId, perm, 'granted'); }
  deny(appId, perm) { this.#store(appId, perm, 'denied'); }

  /** Forgets the decision so the user is asked again next time. */
  reset(appId, perm) {
    const grants = this.#settings.get('privacy.grants');
    if (!grants[appId]) return;
    if (perm) delete grants[appId][perm]; else delete grants[appId];
    if (grants[appId] && !Object.keys(grants[appId]).length) delete grants[appId];
    this.#settings.set('privacy.grants', grants);
    for (const k of [...this.#onceGrants]) if (k.startsWith(`${appId}|`) && (!perm || k.endsWith(`|${perm}`))) this.#onceGrants.delete(k);
    this.#bus?.emit('permissions:changed', { appId, permission: perm || null, state: 'prompt' });
  }

  /** Session-only grants ("Allow once") end when the user signs out. */
  clearSessionGrants() { this.#onceGrants.clear(); }

  /** [{ permission, label, description, state }] for Settings › Privacy. */
  listForApp(appId) {
    const app = this.#registry.get(appId);
    return (app?.permissions || []).filter((p) => PERMISSIONS[p]).map((p) => ({
      permission: p, ...PERMISSIONS[p], state: this.status(appId, p),
    }));
  }

  /** Apps that declared a permission, with their state — "Which apps can use my camera?". */
  appsUsing(perm) {
    return this.#registry.list({ includeHidden: true })
      .filter((a) => (a.permissions || []).includes(perm))
      .map((a) => ({ appId: a.id, name: a.name, system: !!a.system, state: this.status(a.id, perm) }));
  }

  async #ask(appId, perm) {
    const app = this.#registry.get(appId);
    const answer = this.#prompter
      ? await this.#prompter({ appId, appName: app.name, appIcon: app.icon, permission: perm, info: PERMISSIONS[perm] })
      : 'denied'; // no UI available to ask: fail closed
    if (answer === 'once') {
      this.#onceGrants.add(`${appId}|${perm}`);
      this.#bus?.emit('permissions:changed', { appId, permission: perm, state: 'granted', once: true });
      return true;
    }
    this.#store(appId, perm, answer === 'granted' ? 'granted' : 'denied');
    return answer === 'granted';
  }

  #store(appId, perm, state) {
    if (!PERMISSIONS[perm]) throw new PermissionError(appId, perm);
    const grants = this.#settings.get('privacy.grants');
    grants[appId] = { ...(grants[appId] || {}), [perm]: state };
    this.#settings.set('privacy.grants', grants);
    this.#bus?.emit('permissions:changed', { appId, permission: perm, state });
  }
}
