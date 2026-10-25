// Minimal promise wrapper around IndexedDB.

export function openDb(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion, req.transaction);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The DonutOS database is open in an older tab. Close other DonutOS tabs and reload.'));
  });
}

export const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

/**
 * Runs `fn(stores)` inside one transaction and resolves with its result once the
 * transaction has committed. Only IndexedDB requests may be awaited inside `fn`.
 */
export function tx(db, names, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode, { durability: 'strict' });
    const stores = Object.fromEntries([].concat(names).map((n) => [n, t.objectStore(n)]));
    let result, failed = null;
    t.oncomplete = () => (failed ? reject(failed) : resolve(result));
    t.onerror = () => reject(failed || t.error);
    t.onabort = () => reject(failed || t.error || new Error('Transaction aborted'));
    Promise.resolve()
      .then(() => fn(stores, t))
      .then((r) => { result = r; })
      .catch((err) => { failed = err; try { t.abort(); } catch { /* already finished */ } });
  });
}
