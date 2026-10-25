// Kernel log: an in-memory ring buffer that Task Manager / Terminal can read.
// Messages are mirrored to the developer console at debug level only, so normal
// operation never prints errors to the console.

const MAX = 1000;

export class KernelLog {
  #entries = [];
  #listeners = new Set();

  write(level, source, message, data) {
    const entry = { time: Date.now(), level, source, message: String(message), data };
    this.#entries.push(entry);
    if (this.#entries.length > MAX) this.#entries.splice(0, this.#entries.length - MAX);
    for (const l of this.#listeners) { try { l(entry); } catch { /* listeners must not break logging */ } }
    if (globalThis.DONUT_DEBUG) console.debug(`[${level}] ${source}: ${entry.message}`, data ?? '');
    return entry;
  }

  info(source, msg, data) { return this.write('info', source, msg, data); }
  warn(source, msg, data) { return this.write('warn', source, msg, data); }
  error(source, msg, data) { return this.write('error', source, msg, data); }

  entries({ level, source, limit = MAX } = {}) {
    return this.#entries
      .filter((e) => (!level || e.level === level) && (!source || e.source === source))
      .slice(-limit);
  }

  subscribe(fn) { this.#listeners.add(fn); return () => this.#listeners.delete(fn); }
  clear() { this.#entries.length = 0; }
}

export const log = new KernelLog();
