// Shared "document" behaviour for editor apps (Notepad, Writer, Paint): the current file,
// unsaved-changes tracking, the window title, Save / Save As, and asking before closing.

import { h } from '../../ui/h.js';
import { dialog, alertDialog } from '../../ui/dialog.js';
import { openFileDialog, saveFileDialog } from '../../ui/file-dialog.js';
import * as P from '../../core/path.js';

export class Document {
  /**
   * opts: {
   *   appName, untitled = 'Untitled', filters, defaultExt,
   *   serialize(path) -> string | Uint8Array | Blob,   (may be async; path tells the chosen format)
   *   load(path) -> void                              (reads the file into the editor)
   *   onChange()                                      (title/dirty changed)
   * }
   */
  constructor(ctx, win, opts) {
    this.ctx = ctx;
    this.win = win;
    this.opts = opts;
    this.path = null;
    this.dirty = false;
    this.updateTitle();
  }

  get name() { return this.path ? P.basename(this.path) : `${this.opts.untitled || 'Untitled'}${this.opts.defaultExt || ''}`; }

  updateTitle() {
    this.win.setTitle(`${this.dirty ? '• ' : ''}${this.name} — ${this.opts.appName}`);
    this.opts.onChange?.();
  }

  setDirty(on = true) {
    if (this.dirty === on) return;
    this.dirty = on;
    this.updateTitle();
  }

  /** "Save changes to X?" Resolves true when it's fine to continue (saved or discarded). */
  async confirmDiscard() {
    if (!this.dirty) return true;
    const choice = await dialog({
      title: this.opts.appName,
      parent: this.win.body,
      body: h('p', `Do you want to save changes to ${this.name}?`),
      cancelValue: 'cancel',
      buttons: [{ label: 'Save', value: 'save', primary: true }, { label: 'Don’t save', value: 'discard' }, { label: 'Cancel', value: 'cancel' }],
    });
    if (choice === 'cancel') return false;
    if (choice === 'discard') return true;
    return this.save();
  }

  async open(path) {
    try {
      await this.opts.load(path);
      this.path = path;
      this.dirty = false;
      this.ctx.addRecent(path);
      this.updateTitle();
      return true;
    } catch (err) {
      await alertDialog(`Couldn’t open ${P.basename(path)}`, err.message, { parent: this.win.body });
      return false;
    }
  }

  async openWithDialog() {
    if (!(await this.confirmDiscard())) return false;
    const path = await openFileDialog(this.ctx, this.win, { title: 'Open', filters: this.opts.filters });
    return path ? this.open(path) : false;
  }

  async save() {
    if (!this.path || this.opts.readOnly?.(this.path)) return this.saveAs();
    return this.#write(this.path);
  }

  async saveAs() {
    const startIn = this.path ? P.dirname(this.path) : undefined;
    const filters = this.opts.saveFilters || this.opts.filters;
    const current = this.path ? P.extname(this.path).toLowerCase() : this.opts.defaultExt;
    const ordered = [...filters].sort((a, b) => (b.exts.includes(current) ? 1 : 0) - (a.exts.includes(current) ? 1 : 0));
    const path = await saveFileDialog(this.ctx, this.win, { title: 'Save as', filters: ordered, suggestedName: this.name, startIn });
    if (!path) return false;
    return this.#write(path);
  }

  async #write(path) {
    try {
      const data = await this.opts.serialize(path);
      if (typeof data === 'string') await this.ctx.fs.writeText(path, data);
      else await this.ctx.fs.writeFile(path, data);
      this.path = path;
      this.dirty = false;
      this.ctx.addRecent(path);
      this.updateTitle();
      return true;
    } catch (err) {
      await alertDialog(`Couldn’t save ${P.basename(path)}`, err.message, { parent: this.win.body });
      return false;
    }
  }

  /** Clears to a new, untitled document (after asking about unsaved changes). */
  async reset(clear) {
    if (!(await this.confirmDiscard())) return false;
    await clear();
    this.path = null;
    this.dirty = false;
    this.updateTitle();
    return true;
  }
}

/** Ctrl+N/O/S/Shift+S shortcuts for a document window. */
export function documentKeys(ctx, win, handlers) {
  ctx.listen(win.body, 'keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const fn = key === 's' ? (e.shiftKey ? handlers.saveAs : handlers.save) : key === 'o' && !e.shiftKey ? handlers.open : key === 'n' && !e.shiftKey ? handlers.new : key === 'p' && !e.shiftKey ? handlers.print : null;
    if (fn) { e.preventDefault(); fn(); }
  });
}
