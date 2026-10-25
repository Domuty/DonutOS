// File-type associations: which app opens which kind of file.
// Handlers come from app manifests (fileTypes); each user's chosen default per extension is
// stored in "apps.defaults". With no explicit default, the first built-in handler wins.

import { extname } from './path.js';

export class FileAssociations {
  #registry; #settings; #bus;

  constructor({ registry, settings, bus }) {
    this.#registry = registry;
    this.#settings = settings;
    this.#bus = bus;
  }

  /** Apps able to open the extension: built-in first, then apps that prefer it, then by name. */
  handlersFor(ext) {
    ext = ext.toLowerCase();
    const prefers = (a) => ((a.preferredTypes || []).includes(ext) ? 1 : 0);
    return this.#registry.list({ includeHidden: true })
      .filter((a) => (a.fileTypes || []).includes(ext))
      .sort((a, b) => (b.builtin - a.builtin) || (prefers(b) - prefers(a)) || a.name.localeCompare(b.name));
  }

  /** The app id that opens `ext`, or null if nothing can. */
  defaultFor(ext) {
    ext = ext.toLowerCase();
    const chosen = this.#settings.currentUser ? this.#settings.get('apps.defaults')[ext] : null;
    if (chosen && this.#registry.get(chosen)?.fileTypes?.includes(ext)) return chosen;
    return this.handlersFor(ext)[0]?.id || null;
  }

  appForPath(path) { return this.defaultFor(extname(path)); }

  setDefault(ext, appId) {
    ext = ext.toLowerCase();
    const app = this.#registry.get(appId);
    if (!app || !(app.fileTypes || []).includes(ext)) throw new Error(`${appId} cannot open ${ext} files`);
    this.#settings.set('apps.defaults', { ...this.#settings.get('apps.defaults'), [ext]: appId });
    this.#bus?.emit('associations:changed', { ext, appId });
  }

  clearDefault(ext) {
    const d = this.#settings.get('apps.defaults');
    delete d[ext.toLowerCase()];
    this.#settings.set('apps.defaults', d);
    this.#bus?.emit('associations:changed', { ext, appId: null });
  }

  /** Every extension some app can open, with its current default — for Settings › Default apps. */
  table() {
    const exts = new Set();
    for (const a of this.#registry.list({ includeHidden: true })) for (const e of a.fileTypes || []) exts.add(e);
    return [...exts].sort().map((ext) => ({ ext, appId: this.defaultFor(ext), handlers: this.handlersFor(ext).map((a) => a.id) }));
  }
}
