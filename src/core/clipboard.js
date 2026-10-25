// Clipboard history (per user). The shell records text that is copied anywhere in DonutOS;
// the clipboard panel (Win+V) lists it. Pinned items survive "Clear all".

import { uid as makeId } from './util.js';

const MAX = 25;
const MAX_LEN = 20_000;

export class ClipboardHistory {
  #settings; #bus;
  constructor({ settings, bus }) { this.#settings = settings; this.#bus = bus; }

  enabled() { return !!this.#settings.currentUser && this.#settings.get('privacy.clipboardHistory'); }

  list() { return this.#settings.currentUser ? this.#settings.get('clipboard.history') : []; }

  record(text) {
    if (!this.enabled() || typeof text !== 'string' || !text.trim()) return;
    text = text.slice(0, MAX_LEN);
    const list = this.list();
    const existing = list.find((i) => i.text === text);
    const rest = list.filter((i) => i.text !== text);
    const item = existing ? { ...existing, time: Date.now() } : { id: makeId('c'), text, time: Date.now(), pinned: false };
    const pinned = rest.filter((i) => i.pinned);
    const unpinned = rest.filter((i) => !i.pinned);
    this.#save([item, ...pinned, ...unpinned].slice(0, MAX + pinned.length));
  }

  pin(id, on = true) { this.#save(this.list().map((i) => (i.id === id ? { ...i, pinned: on } : i))); }
  remove(id) { this.#save(this.list().filter((i) => i.id !== id)); }
  clear() { this.#save(this.list().filter((i) => i.pinned)); }

  #save(list) {
    this.#settings.set('clipboard.history', list);
    this.#bus.emit('clipboard:changed', {});
  }
}
