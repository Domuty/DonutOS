// DonutOS virtual file system.
//
// The platform adapter supplies a small set of primitive operations (stat, readdir,
// readFile, writeFile, mkdir, remove, rename, copy). This layer adds everything apps
// need on top: text/JSON helpers, recursive mkdir, overwrite-aware move/copy, unique
// names, tree walking, content search, the Recycle Bin, change events, and per-process
// permission checks.
//
// Layout:
//   /System                 read-only to normal apps (system.fs permission required)
//   /Users/<user>/...       each user's home (Desktop, Documents, Downloads, Pictures,
//                           Music, Videos, .Trash)
//   /Users/Public           shared between all users

import * as P from './path.js';
import { FsError, PermissionError } from './errors.js';
import { toBytes, uid } from './util.js';
import { mimeFor, kindFor, isTextExt } from './mime.js';

export const HOME_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'];
export const TRASH = '.Trash';

const enc = new TextEncoder();
const dec = new TextDecoder();

export class VirtualFileSystem {
  #fs; #bus;

  constructor({ fs, bus }) {
    this.#fs = fs;
    this.#bus = bus;
  }

  // ── Queries ──────────────────────────────────────────────────────────

  async stat(path) {
    const s = await this.#fs.stat(P.normalize(path));
    return s ? this.#decorate(s) : null;
  }

  async exists(path) { return !!(await this.#fs.stat(P.normalize(path))); }

  async isDir(path) { return (await this.#fs.stat(P.normalize(path)))?.type === 'dir'; }

  /** Entries in a folder. Hidden entries (names starting with ".") are skipped unless `hidden`. */
  async readdir(path, { hidden = false } = {}) {
    const list = await this.#fs.readdir(P.normalize(path));
    return list.filter((e) => hidden || !e.name.startsWith('.')).map((e) => this.#decorate(e));
  }

  async readFile(path) { return this.#fs.readFile(P.normalize(path)); }

  async readText(path) { return dec.decode(await this.readFile(path)); }

  async readJSON(path, fallback) {
    try { return JSON.parse(await this.readText(path)); }
    catch (err) { if (fallback !== undefined) return fallback; throw err; }
  }

  async readBlob(path) {
    const bytes = await this.readFile(path);
    return new Blob([bytes], { type: mimeFor(P.extname(path)) });
  }

  // ── Mutations ────────────────────────────────────────────────────────

  async writeFile(path, data, { mkdirp = false } = {}) {
    path = P.normalize(path);
    this.#checkName(path);
    if (mkdirp) await this.mkdir(P.dirname(path), { recursive: true });
    const existed = await this.exists(path);
    await this.#fs.writeFile(path, await toBytes(data));
    this.#changed(existed ? 'modify' : 'create', path);
  }

  writeText(path, text, opts) { return this.writeFile(path, enc.encode(String(text)), opts); }
  writeJSON(path, value, opts) { return this.writeText(path, JSON.stringify(value, null, 2), opts); }

  async appendText(path, text) {
    const prev = (await this.exists(path)) ? await this.readText(path) : '';
    return this.writeText(path, prev + text);
  }

  async mkdir(path, { recursive = false } = {}) {
    path = P.normalize(path);
    if (path === '/') return;
    if (!recursive) {
      this.#checkName(path);
      await this.#fs.mkdir(path);
      this.#changed('create', path);
      return;
    }
    let cur = '';
    for (const seg of P.split(path)) {
      cur += '/' + seg;
      const s = await this.#fs.stat(cur);
      if (s?.type === 'dir') continue;
      if (s) throw new FsError('ENOTDIR', cur);
      this.#checkName(cur);
      await this.#fs.mkdir(cur);
      this.#changed('create', cur);
    }
  }

  /** Permanently deletes. Use moveToTrash for user-facing deletes. */
  async remove(path, { recursive = false } = {}) {
    path = P.normalize(path);
    if (path === '/') throw new FsError('EACCES', path, 'The root folder cannot be removed');
    await this.#fs.remove(path, { recursive });
    this.#changed('delete', path);
  }

  /** Moves/renames. With `overwrite`, an existing file at the destination is replaced. */
  async move(from, to, { overwrite = false } = {}) {
    from = P.normalize(from); to = P.normalize(to);
    if (from === to) return to;
    if (P.isInside(from, to)) throw new FsError('EINVAL', to, 'A folder cannot be moved into itself');
    this.#checkName(to);
    const dest = await this.#fs.stat(to);
    if (dest) {
      if (!overwrite) throw new FsError('EEXIST', to);
      // Renaming only the letter case of a name is not an overwrite.
      if (to.toLowerCase() !== from.toLowerCase()) await this.#fs.remove(to, { recursive: true });
    }
    await this.#fs.rename(from, to);
    this.#changed('move', to, from);
    return to;
  }

  rename(path, newName) {
    const err = P.validateName(newName);
    if (err) return Promise.reject(new FsError('EINVAL', newName, err));
    return this.move(path, P.join(P.dirname(path), newName));
  }

  async copy(from, to, { overwrite = false } = {}) {
    from = P.normalize(from); to = P.normalize(to);
    if (P.isSameOrInside(from, to)) throw new FsError('EINVAL', to, 'A folder cannot be copied into itself');
    this.#checkName(to);
    if (await this.#fs.stat(to)) {
      if (!overwrite) throw new FsError('EEXIST', to);
      await this.#fs.remove(to, { recursive: true });
    }
    await this.#fs.copy(from, to);
    this.#changed('create', to, from);
    return to;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** "Report.txt" -> "Report (2).txt" if needed, so a new item never collides. */
  async uniqueName(dir, name) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name, n = 2;
    while (await this.exists(P.join(dir, candidate))) candidate = `${stem} (${n++})${ext}`;
    return candidate;
  }

  /** Depth-first walk. `visit(entry)` may return false to skip a folder's contents. */
  async walk(root, visit, { hidden = false, maxDepth = 64 } = {}) {
    const go = async (dir, depth) => {
      if (depth > maxDepth) return;
      let list;
      try { list = await this.readdir(dir, { hidden }); } catch { return; }
      for (const e of list) {
        const r = await visit(e);
        if (e.type === 'dir' && r !== false) await go(e.path, depth + 1);
      }
    };
    await go(P.normalize(root), 0);
  }

  /** Total size in bytes and item counts under a path. */
  async du(path) {
    const s = await this.stat(path);
    if (!s) throw new FsError('ENOENT', path);
    if (s.type === 'file') return { size: s.size, files: 1, dirs: 0 };
    const t = { size: 0, files: 0, dirs: 0 };
    await this.walk(path, (e) => { if (e.type === 'dir') t.dirs++; else { t.files++; t.size += e.size; } }, { hidden: true });
    return t;
  }

  /**
   * Searches names and (for text files under 1 MB) contents.
   * Returns [{ entry, match: 'name' | 'content', snippet }].
   */
  async search(root, query, { content = true, limit = 200, hidden = false, signal } = {}) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    await this.walk(root, async (e) => {
      if (signal?.aborted || out.length >= limit) return false;
      if (e.name.toLowerCase().includes(q)) { out.push({ entry: e, match: 'name', snippet: '' }); return; }
      if (content && e.type === 'file' && e.size < 1024 * 1024 && isTextExt(e.ext)) {
        try {
          const text = await this.readText(e.path);
          const i = text.toLowerCase().indexOf(q);
          if (i >= 0) out.push({ entry: e, match: 'content', snippet: text.slice(Math.max(0, i - 30), i + q.length + 50).replace(/\s+/g, ' ') });
        } catch { /* unreadable file: skip */ }
      }
    }, { hidden });
    return out;
  }

  async usage() { return this.#fs.usage(); }

  // ── Recycle Bin ──────────────────────────────────────────────────────
  // Deleted items move to <home>/.Trash/files/<id>; their original location is kept
  // in <home>/.Trash/info/<id>.json so they can be restored.

  trashPath(home) { return P.join(home, TRASH); }

  async moveToTrash(path, home) {
    path = P.normalize(path);
    const s = await this.stat(path);
    if (!s) throw new FsError('ENOENT', path);
    const trash = this.trashPath(home);
    if (P.isSameOrInside(trash, path)) {               // already in the bin: delete for good
      await this.remove(path, { recursive: true });
      return null;
    }
    await this.mkdir(P.join(trash, 'files'), { recursive: true });
    await this.mkdir(P.join(trash, 'info'), { recursive: true });
    const id = uid('t');
    const size = s.type === 'dir' ? (await this.du(path)).size : s.size;
    await this.#fs.rename(path, P.join(trash, 'files', id));
    const info = { id, name: s.name, originalPath: path, type: s.type, size, deletedAt: Date.now() };
    await this.#fs.writeFile(P.join(trash, 'info', `${id}.json`), enc.encode(JSON.stringify(info)));
    this.#changed('delete', path);
    this.#bus?.emit('trash:changed', { home });
    return info;
  }

  async listTrash(home) {
    const dir = P.join(this.trashPath(home), 'info');
    if (!(await this.exists(dir))) return [];
    const items = [];
    for (const e of await this.readdir(dir, { hidden: true })) {
      try { items.push(await this.readJSON(e.path)); } catch { /* corrupt record: ignore */ }
    }
    return items.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  /** Restores to the original location (or a unique name next to it). Returns the final path. */
  async restoreFromTrash(home, id) {
    const trash = this.trashPath(home);
    const infoPath = P.join(trash, 'info', `${id}.json`);
    const info = await this.readJSON(infoPath);
    const dir = P.dirname(info.originalPath);
    await this.mkdir(dir, { recursive: true });
    const target = P.join(dir, await this.uniqueName(dir, info.name));
    await this.#fs.rename(P.join(trash, 'files', id), target);
    await this.#fs.remove(infoPath, {});
    this.#changed('create', target);
    this.#bus?.emit('trash:changed', { home });
    return target;
  }

  async deleteFromTrash(home, id) {
    const trash = this.trashPath(home);
    await this.#fs.remove(P.join(trash, 'files', id), { recursive: true }).catch((e) => { if (e.code !== 'ENOENT') throw e; });
    await this.#fs.remove(P.join(trash, 'info', `${id}.json`), {}).catch((e) => { if (e.code !== 'ENOENT') throw e; });
    this.#bus?.emit('trash:changed', { home });
  }

  async emptyTrash(home) {
    const trash = this.trashPath(home);
    if (await this.exists(trash)) await this.#fs.remove(trash, { recursive: true });
    this.#bus?.emit('trash:changed', { home });
  }

  // ── Per-process access control ───────────────────────────────────────

  /**
   * A copy of this API for one app. Paths inside the signed-in user's home (and
   * /Users/Public) need files.read / files.write; anything else needs system.fs.
   * Relative paths resolve against the user's home.
   */
  forApp(appId, { permissions, getHome }) {
    const self = this;
    const need = async (path, write) => {
      const home = getHome();
      const abs = P.resolve(home || '/', path);
      const inUserSpace = home && (P.isSameOrInside(home, abs) || P.isSameOrInside('/Users/Public', abs));
      const perm = inUserSpace ? (write ? 'files.write' : 'files.read') : 'system.fs';
      if (!(await permissions.request(appId, perm))) throw new PermissionError(appId, perm);
      return abs;
    };
    const r = (fn) => async (p, ...a) => fn(await need(p, false), ...a);
    const w = (fn) => async (p, ...a) => fn(await need(p, true), ...a);
    const w2 = (fn) => async (a, b, ...rest) => fn(await need(a, true), await need(b, true), ...rest);
    return Object.freeze({
      stat: r((p) => self.stat(p)),
      exists: r((p) => self.exists(p)),
      isDir: r((p) => self.isDir(p)),
      readdir: r((p, o) => self.readdir(p, o)),
      readFile: r((p) => self.readFile(p)),
      readText: r((p) => self.readText(p)),
      readJSON: r((p, f) => self.readJSON(p, f)),
      readBlob: r((p) => self.readBlob(p)),
      writeFile: w((p, d, o) => self.writeFile(p, d, o)),
      writeText: w((p, t, o) => self.writeText(p, t, o)),
      writeJSON: w((p, v, o) => self.writeJSON(p, v, o)),
      appendText: w((p, t) => self.appendText(p, t)),
      mkdir: w((p, o) => self.mkdir(p, o)),
      remove: w((p, o) => self.remove(p, o)),
      trash: w((p) => self.moveToTrash(p, getHome())),
      rename: w((p, n) => self.rename(p, n)),
      move: w2((a, b, o) => self.move(a, b, o)),
      copy: async (a, b, o) => self.copy(await need(a, false), await need(b, true), o),
      uniqueName: r((d, n) => self.uniqueName(d, n)),
      walk: r((p, v, o) => self.walk(p, v, o)),
      search: r((p, q, o) => self.search(p, q, o)),
      du: r((p) => self.du(p)),
      home: () => getHome(),
      path: P,
    });
  }

  /** Tells File Explorer & co. that the host changed a file directly (e.g. a finished download). */
  noteExternalChange(path, op = 'create') { this.#changed(op, P.normalize(path)); }

  // ── Internals ────────────────────────────────────────────────────────

  #decorate(s) {
    const ext = s.type === 'dir' ? '' : P.extname(s.name);
    return { ...s, ext, mime: s.type === 'dir' ? 'inode/directory' : mimeFor(ext), kind: s.type === 'dir' ? 'folder' : kindFor(ext) };
  }

  #checkName(path) {
    const name = P.basename(path);
    const err = P.validateName(name);
    if (err) throw new FsError('EINVAL', path, err);
  }

  #changed(op, path, from) {
    this.#bus?.emit('fs:changed', { op, path, from: from || null, dir: P.dirname(path), fromDir: from ? P.dirname(from) : null });
  }
}
