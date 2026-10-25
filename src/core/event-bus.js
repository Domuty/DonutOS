// Synchronous publish/subscribe bus.
//
// Event names are namespaced with colons ("fs:changed", "process:exit").
// Subscribe to an exact name, to a whole namespace with "fs:*", or to everything with "*".
// Every subscription may carry an `owner` (usually a PID) so all of a process's
// listeners can be removed in one call when it exits.

import { log } from './log.js';

export class EventBus {
  #subs = new Map(); // pattern -> Set<{ handler, owner, once }>

  on(pattern, handler, { owner = null, once = false } = {}) {
    if (typeof handler !== 'function') throw new TypeError('Event handler must be a function');
    let set = this.#subs.get(pattern);
    if (!set) this.#subs.set(pattern, (set = new Set()));
    const sub = { handler, owner, once };
    set.add(sub);
    return () => this.#remove(pattern, sub);
  }

  once(pattern, handler, opts = {}) {
    return this.on(pattern, handler, { ...opts, once: true });
  }

  off(pattern, handler) {
    const set = this.#subs.get(pattern);
    if (!set) return;
    for (const sub of set) if (sub.handler === handler) this.#remove(pattern, sub);
  }

  /** Removes every subscription registered with this owner. Returns how many were removed. */
  offOwner(owner) {
    let n = 0;
    for (const [pattern, set] of this.#subs) {
      for (const sub of set) if (sub.owner === owner) { set.delete(sub); n++; }
      if (!set.size) this.#subs.delete(pattern);
    }
    return n;
  }

  /** Calls matching handlers in subscription order. Returns the number of handlers called. */
  emit(event, payload) {
    const targets = [];
    const collect = (pattern) => { const s = this.#subs.get(pattern); if (s) targets.push([pattern, s]); };
    collect(event);
    const parts = event.split(':');
    for (let i = parts.length - 1; i > 0; i--) collect(parts.slice(0, i).join(':') + ':*');
    collect('*');

    let called = 0;
    for (const [pattern, set] of targets) {
      for (const sub of [...set]) {
        if (sub.once) this.#remove(pattern, sub);
        called++;
        try {
          sub.handler(payload, event);
        } catch (err) {
          log.error('bus', `Handler for "${event}" threw: ${err?.message || err}`, { stack: err?.stack, owner: sub.owner });
        }
      }
    }
    return called;
  }

  /** Resolves with the payload of the next matching event. */
  waitFor(pattern, { timeout = 0, filter } = {}) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const off = this.on(pattern, (payload) => {
        if (filter && !filter(payload)) return;
        off(); clearTimeout(timer); resolve(payload);
      });
      if (timeout > 0) timer = setTimeout(() => { off(); reject(new Error(`Timed out waiting for "${pattern}"`)); }, timeout);
    });
  }

  /** A view of the bus whose subscriptions are all owned by `owner`. */
  scope(owner) {
    return {
      on: (p, h, o = {}) => this.on(p, h, { ...o, owner }),
      once: (p, h, o = {}) => this.once(p, h, { ...o, owner }),
      off: (p, h) => this.off(p, h),
      emit: (e, payload) => this.emit(e, payload),
      waitFor: (p, o) => this.waitFor(p, o),
      dispose: () => this.offOwner(owner),
    };
  }

  listenerCount(pattern) {
    if (pattern) return this.#subs.get(pattern)?.size || 0;
    let n = 0; for (const s of this.#subs.values()) n += s.size; return n;
  }

  #remove(pattern, sub) {
    const set = this.#subs.get(pattern);
    if (!set) return;
    set.delete(sub);
    if (!set.size) this.#subs.delete(pattern);
  }
}

export const bus = new EventBus();
