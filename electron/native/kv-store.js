// Key-value store for the desktop build: one JSON file per key in the app's data folder.
// Values are cached in memory; writes are atomic (temp file + rename).

'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

class KvStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cache = new Map();
    this.queue = new Map(); // key -> Promise chain, so writes to one key never interleave
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        this.cache.set(decodeURIComponent(file.slice(0, -5)), JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
      } catch { /* a corrupt file is ignored, its key reads as missing */ }
    }
  }

  file(key) { return path.join(this.dir, `${encodeURIComponent(key)}.json`); }

  get(key) { return this.cache.has(key) ? structuredClone(this.cache.get(key)) : undefined; }

  set(key, value) {
    if (typeof key !== 'string' || !key) throw new Error('Key must be a non-empty string');
    const json = JSON.stringify(value);
    this.cache.set(key, JSON.parse(json));
    return this.enqueue(key, async () => {
      const tmp = this.file(key) + '.tmp';
      await fsp.writeFile(tmp, json);
      await fsp.rename(tmp, this.file(key));
    });
  }

  delete(key) {
    this.cache.delete(key);
    return this.enqueue(key, () => fsp.rm(this.file(key), { force: true }));
  }

  keys(prefix = '') { return [...this.cache.keys()].filter((k) => k.startsWith(prefix)); }

  enqueue(key, job) {
    const prev = this.queue.get(key) || Promise.resolve();
    const next = prev.then(job, job);
    this.queue.set(key, next);
    next.finally(() => { if (this.queue.get(key) === next) this.queue.delete(key); }).catch(() => {});
    return next;
  }

  /** Waits for every queued write (called before quitting). */
  flush() { return Promise.allSettled([...this.queue.values()]); }
}

module.exports = { KvStore };
