// The web file system: every file and folder is a record in IndexedDB.
//
//   nodes: { path, parent, name, type, size, mtime, ctime }   keyPath "path", index "parent"
//   blobs: path -> ArrayBuffer (file contents)
//
// Each operation runs in a single read-write transaction, so it either fully happens or
// not at all — a crash can never leave half a folder moved.

import { req, tx } from './idb.js';
import { FsError } from '../../core/errors.js';
import * as P from '../../core/path.js';

const descendants = (path) => IDBKeyRange.bound(path + '/', path + '/￿');

export class IdbFileSystem {
  constructor(db) { this.db = db; }

  async ensureRoot() {
    await tx(this.db, ['nodes'], 'readwrite', async ({ nodes }) => {
      if (!(await req(nodes.get('/')))) {
        const now = Date.now();
        nodes.put({ path: '/', parent: '', name: '', type: 'dir', size: 0, mtime: now, ctime: now });
      }
    });
  }

  async stat(path) {
    const n = await tx(this.db, ['nodes'], 'readonly', ({ nodes }) => req(nodes.get(path)));
    return n ? out(n) : null;
  }

  async readdir(path) {
    return tx(this.db, ['nodes'], 'readonly', async ({ nodes }) => {
      const dir = await req(nodes.get(path));
      if (!dir) throw new FsError('ENOENT', path);
      if (dir.type !== 'dir') throw new FsError('ENOTDIR', path);
      const list = await req(nodes.index('parent').getAll(path));
      return list.map(out);
    });
  }

  async readFile(path) {
    return tx(this.db, ['nodes', 'blobs'], 'readonly', async ({ nodes, blobs }) => {
      const n = await req(nodes.get(path));
      if (!n) throw new FsError('ENOENT', path);
      if (n.type === 'dir') throw new FsError('EISDIR', path);
      const data = await req(blobs.get(path));
      return new Uint8Array(data || new ArrayBuffer(0));
    });
  }

  async writeFile(path, bytes) {
    // Copy into a standalone ArrayBuffer so callers can't mutate stored data afterwards.
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    try {
      await tx(this.db, ['nodes', 'blobs'], 'readwrite', async ({ nodes, blobs }) => {
        const parent = P.dirname(path);
        await requireDir(nodes, parent);
        const existing = await req(nodes.get(path));
        if (existing?.type === 'dir') throw new FsError('EISDIR', path);
        const now = Date.now();
        nodes.put({ path, parent, name: P.basename(path), type: 'file', size: buf.byteLength, mtime: now, ctime: existing?.ctime ?? now });
        blobs.put(buf, path);
        touch(nodes, parent, now);
      });
    } catch (err) {
      throw mapQuota(err, path);
    }
  }

  async mkdir(path) {
    await tx(this.db, ['nodes'], 'readwrite', async ({ nodes }) => {
      const parent = P.dirname(path);
      await requireDir(nodes, parent);
      if (await req(nodes.get(path))) throw new FsError('EEXIST', path);
      const now = Date.now();
      nodes.put({ path, parent, name: P.basename(path), type: 'dir', size: 0, mtime: now, ctime: now });
      touch(nodes, parent, now);
    });
  }

  async remove(path, { recursive = false } = {}) {
    if (path === '/') throw new FsError('EACCES', path);
    await tx(this.db, ['nodes', 'blobs'], 'readwrite', async ({ nodes, blobs }) => {
      const n = await req(nodes.get(path));
      if (!n) throw new FsError('ENOENT', path);
      if (n.type === 'dir') {
        const childCount = await req(nodes.index('parent').count(path));
        if (childCount && !recursive) throw new FsError('ENOTEMPTY', path);
        nodes.delete(descendants(path));
        blobs.delete(descendants(path));
      }
      nodes.delete(path);
      blobs.delete(path);
      touch(nodes, n.parent, Date.now());
    });
  }

  async rename(from, to) {
    if (from === '/' || P.isInside(from, to)) throw new FsError('EINVAL', to);
    await tx(this.db, ['nodes', 'blobs'], 'readwrite', async ({ nodes, blobs }) => {
      const n = await req(nodes.get(from));
      if (!n) throw new FsError('ENOENT', from);
      const parent = P.dirname(to);
      await requireDir(nodes, parent);
      if (from !== to && (await req(nodes.get(to)))) throw new FsError('EEXIST', to);
      const now = Date.now();
      const moveOne = async (node, newPath) => {
        const data = node.type === 'file' ? await req(blobs.get(node.path)) : null;
        nodes.delete(node.path);
        blobs.delete(node.path);
        nodes.put({ ...node, path: newPath, parent: P.dirname(newPath), name: P.basename(newPath) });
        if (node.type === 'file') blobs.put(data || new ArrayBuffer(0), newPath);
      };
      if (n.type === 'dir') {
        const kids = await req(nodes.getAll(descendants(from)));
        for (const k of kids) await moveOne(k, to + k.path.slice(from.length));
      }
      await moveOne(n, to);
      touch(nodes, n.parent, now);
      touch(nodes, parent, now);
    });
  }

  async copy(from, to) {
    try {
      await tx(this.db, ['nodes', 'blobs'], 'readwrite', async ({ nodes, blobs }) => {
        const n = await req(nodes.get(from));
        if (!n) throw new FsError('ENOENT', from);
        const parent = P.dirname(to);
        await requireDir(nodes, parent);
        if (await req(nodes.get(to))) throw new FsError('EEXIST', to);
        const now = Date.now();
        const copyOne = async (node, newPath) => {
          nodes.put({ ...node, path: newPath, parent: P.dirname(newPath), name: P.basename(newPath), mtime: now, ctime: now });
          if (node.type === 'file') blobs.put((await req(blobs.get(node.path))) || new ArrayBuffer(0), newPath);
        };
        await copyOne(n, to);
        if (n.type === 'dir') {
          const kids = await req(nodes.getAll(descendants(from)));
          for (const k of kids) await copyOne(k, to + k.path.slice(from.length));
        }
        touch(nodes, parent, now);
      });
    } catch (err) {
      throw mapQuota(err, to);
    }
  }

  async usage() {
    const est = (await navigator.storage?.estimate?.()) || {};
    return { used: est.usage ?? 0, total: est.quota ?? 0 };
  }
}

function out(n) {
  return { path: n.path, name: n.name, type: n.type, size: n.size, mtime: n.mtime, ctime: n.ctime };
}

async function requireDir(nodes, path) {
  const p = await req(nodes.get(path));
  if (!p) throw new FsError('ENOENT', path);
  if (p.type !== 'dir') throw new FsError('ENOTDIR', path);
}

function touch(nodes, path, now) {
  const r = nodes.get(path);
  r.onsuccess = () => { if (r.result) nodes.put({ ...r.result, mtime: now }); };
}

function mapQuota(err, path) {
  if (err?.name === 'QuotaExceededError') return new FsError('ENOSPC', path);
  return err;
}
