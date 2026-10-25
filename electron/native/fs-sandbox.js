// Real-disk file system for the desktop build, confined to one folder
// (Documents/DonutOS by default). Every virtual path is resolved inside the root;
// anything that would escape it — "..", absolute host paths, symlinks — is refused.

'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const TMP_SUFFIX = '.donut-tmp';
const KNOWN = new Set(['ENOENT', 'EEXIST', 'ENOTDIR', 'EISDIR', 'ENOTEMPTY', 'EACCES', 'EINVAL', 'ENOSPC', 'EIO']);

class SandboxError extends Error {
  constructor(code, vpath, message) {
    super(message || code);
    this.code = code;
    this.path = vpath;
  }
}

function mapError(err, vpath) {
  if (err instanceof SandboxError) return err;
  let code = err && err.code;
  if (code === 'EPERM' || code === 'EBUSY') code = 'EACCES';
  if (code === 'EXDEV' || code === 'ELOOP') code = 'EINVAL';
  if (!KNOWN.has(code)) code = 'EIO';
  return new SandboxError(code, vpath, err && err.message);
}

/** Normalises a DonutOS path ("/Users/a/../b") to its canonical form ("/Users/b"). */
function normalizeVirtual(p) {
  if (typeof p !== 'string' || p.includes('\0')) throw new SandboxError('EINVAL', String(p), 'Invalid path');
  const parts = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return '/' + parts.join('/');
}

class FsSandbox {
  constructor(root) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    this.realRoot = fs.realpathSync(this.root);
  }

  /** Virtual path -> absolute host path, guaranteed to be inside the root. */
  resolve(vpath) {
    const v = normalizeVirtual(vpath);
    const segs = v.split('/').filter(Boolean);
    for (const s of segs) {
      // Windows-reserved characters would otherwise be interpreted by the host (e.g. "C:").
      if (/[<>:"|?*\u0000-\u001f]/.test(s)) throw new SandboxError('EINVAL', v, 'Invalid character in name');
    }
    const host = path.join(this.root, ...segs);
    const rel = path.relative(this.root, host);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new SandboxError('EACCES', v, 'Path escapes the DonutOS folder');
    return { v, host };
  }

  /** Refuses paths whose existing part runs through a symlink pointing outside the root. */
  async guard(host, v) {
    let probe = host;
    for (;;) {
      try {
        const real = await fsp.realpath(probe);
        const rel = path.relative(this.realRoot, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw new SandboxError('EACCES', v, 'Path escapes the DonutOS folder');
        return;
      } catch (err) {
        if (err instanceof SandboxError) throw err;
        if (err.code !== 'ENOENT') throw mapError(err, v);
        const up = path.dirname(probe);
        if (up === probe) return;
        probe = up;
      }
    }
  }

  async run(vpath, fn) {
    const { v, host } = this.resolve(vpath);
    await this.guard(host, v);
    try { return await fn(host, v); } catch (err) { throw mapError(err, v); }
  }

  statOut(v, st) {
    return {
      path: v,
      name: v === '/' ? '' : v.slice(v.lastIndexOf('/') + 1),
      type: st.isDirectory() ? 'dir' : 'file',
      size: st.isDirectory() ? 0 : st.size,
      mtime: Math.round(st.mtimeMs),
      ctime: Math.round(st.birthtimeMs || st.ctimeMs),
    };
  }

  async stat(vpath) {
    const { v, host } = this.resolve(vpath);
    let st;
    try { st = await fsp.lstat(host); } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
      throw mapError(err, v);
    }
    if (st.isSymbolicLink()) return null; // links are not part of DonutOS
    try { await this.guard(host, v); } catch { return null; } // reached through an escaping link
    return this.statOut(v, st);
  }

  readdir(vpath) {
    return this.run(vpath, async (host, v) => {
      const st = await fsp.stat(host);
      if (!st.isDirectory()) throw new SandboxError('ENOTDIR', v);
      const names = await fsp.readdir(host);
      const out = [];
      for (const name of names) {
        if (name.endsWith(TMP_SUFFIX)) continue;
        try {
          const cst = await fsp.lstat(path.join(host, name));
          if (cst.isSymbolicLink() || (!cst.isFile() && !cst.isDirectory())) continue;
          out.push(this.statOut(v === '/' ? `/${name}` : `${v}/${name}`, cst));
        } catch { /* vanished while listing */ }
      }
      return out;
    });
  }

  readFile(vpath) {
    return this.run(vpath, async (host, v) => {
      const st = await fsp.stat(host);
      if (st.isDirectory()) throw new SandboxError('EISDIR', v);
      return new Uint8Array(await fsp.readFile(host));
    });
  }

  writeFile(vpath, data) {
    return this.run(vpath, async (host, v) => {
      await this.requireDir(path.dirname(host), v);
      try {
        if ((await fsp.stat(host)).isDirectory()) throw new SandboxError('EISDIR', v);
      } catch (err) { if (err.code !== 'ENOENT') throw err; }
      // Write to a temporary file and rename, so a crash never leaves a half-written file.
      const tmp = `${host}.${crypto.randomBytes(4).toString('hex')}${TMP_SUFFIX}`;
      await fsp.writeFile(tmp, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
      try { await fsp.rename(tmp, host); } catch (err) { await fsp.rm(tmp, { force: true }); throw err; }
    });
  }

  mkdir(vpath) {
    return this.run(vpath, async (host, v) => {
      await this.requireDir(path.dirname(host), v);
      await fsp.mkdir(host); // throws EEXIST if present
    });
  }

  remove(vpath, { recursive = false } = {}) {
    return this.run(vpath, async (host, v) => {
      if (v === '/') throw new SandboxError('EACCES', v);
      const st = await fsp.lstat(host);
      if (st.isDirectory()) {
        if (recursive) await fsp.rm(host, { recursive: true, force: false });
        else await fsp.rmdir(host); // ENOTEMPTY if not empty
      } else {
        await fsp.unlink(host);
      }
    });
  }

  async rename(fromV, toV) {
    const from = this.resolve(fromV), to = this.resolve(toV);
    await this.guard(from.host, from.v);
    await this.guard(to.host, to.v);
    if (from.v === '/' || to.v.startsWith(from.v + '/')) throw new SandboxError('EINVAL', to.v);
    try {
      await fsp.lstat(from.host);
      await this.requireDir(path.dirname(to.host), to.v);
      // Case-only renames are allowed on case-insensitive disks (Windows, macOS).
      if (from.v !== to.v && from.v.toLowerCase() !== to.v.toLowerCase() && (await exists(to.host))) throw new SandboxError('EEXIST', to.v);
      await fsp.rename(from.host, to.host);
    } catch (err) { throw mapError(err, from.v); }
  }

  async copy(fromV, toV) {
    const from = this.resolve(fromV), to = this.resolve(toV);
    await this.guard(from.host, from.v);
    await this.guard(to.host, to.v);
    if (to.v === from.v || to.v.startsWith(from.v + '/')) throw new SandboxError('EINVAL', to.v);
    try {
      await fsp.lstat(from.host);
      await this.requireDir(path.dirname(to.host), to.v);
      if (await exists(to.host)) throw new SandboxError('EEXIST', to.v);
      await fsp.cp(from.host, to.host, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true,
        filter: (src) => !src.endsWith(TMP_SUFFIX) });
    } catch (err) { throw mapError(err, to.v); }
  }

  async usage() {
    const st = await fsp.statfs(this.root);
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    return { used: total - free, total };
  }

  async requireDir(hostDir, v) {
    let st;
    try { st = await fsp.stat(hostDir); } catch (err) { if (err.code === 'ENOENT') throw new SandboxError('ENOENT', v); throw err; }
    if (!st.isDirectory()) throw new SandboxError('ENOTDIR', v);
  }
}

async function exists(p) {
  try { await fsp.lstat(p); return true; } catch { return false; }
}

module.exports = { FsSandbox, SandboxError, normalizeVirtual };
