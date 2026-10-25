// Sticky Notes: quick notes, each in its own small window. Notes reopen where you left
// them, support basic formatting and seven colours, and the notes list searches them all.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { showMenu } from '../../ui/menu.js';
import { confirmDialog } from '../../ui/dialog.js';
import { sanitizeHtml } from '../writer/convert.js';

const COLORS = [['yellow', 'Yellow', '#fff3a8', '#f7e36b'], ['green', 'Green', '#d4f5c7', '#a8e494'], ['pink', 'Pink', '#ffd6ea', '#f8afd2'], ['purple', 'Purple', '#e8dcff', '#cdb8fb'],
  ['blue', 'Blue', '#d6ecff', '#a9d3fb'], ['grey', 'Grey', '#ececec', '#d2d2d2'], ['charcoal', 'Charcoal', '#4a4a4f', '#3a3a3e']];
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export default function main(ctx) {
  const store = ctx.storage;
  const notes = () => store.get('notes', []);
  const save = (list) => store.set('notes', list);
  const update = (id, patch) => save(notes().map((n) => (n.id === id ? { ...n, ...patch, updated: patch.html !== undefined ? Date.now() : n.updated } : n)));
  const open = new Map(); // note id -> window api
  let listWin = null;

  // ── Notes list ───────────────────────────────────────────────────────
  function showList() {
    if (listWin) { listWin.focus(); return; }
    listWin = ctx.windows.create({ title: 'Sticky Notes', width: 360, height: 540, minWidth: 280, minHeight: 300 });
    listWin.body.classList.add('sn-list');
    let q = '';
    const search = h('input.input', { type: 'search', placeholder: 'Search…', 'aria-label': 'Search notes', oninput: (e) => { q = e.target.value.trim().toLowerCase(); paint(); } });
    const items = h('div.sn-items');
    const paint = () => {
      const all = notes().slice().sort((a, b) => b.updated - a.updated).filter((n) => !q || textOf(n.html).toLowerCase().includes(q));
      mount(items, all.length ? all.map((n) => {
        const c = COLORS.find((x) => x[0] === n.color) || COLORS[0];
        return h('div.sn-item', { style: { '--bg': c[2], '--bar': c[3] }, class: n.color === 'charcoal' && 'dark', role: 'button', tabindex: '0',
          onclick: () => openNote(n.id), onkeydown: (e) => { if (e.key === 'Enter') openNote(n.id); },
          oncontextmenu: (e) => { e.preventDefault(); showMenu([{ label: open.has(n.id) ? 'Close note' : 'Open note', onSelect: () => (open.has(n.id) ? open.get(n.id).close() : openNote(n.id)) }, { label: 'Delete note', icon: 'trash', danger: true, onSelect: () => removeNote(n.id) }], { x: e.clientX, y: e.clientY }); } },
        h('small', new Date(n.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })), h('div.sn-preview', textOf(n.html).slice(0, 200) || 'Empty note'));
      }) : h('p.calc-empty', q ? 'No notes match.' : 'Select + to create your first note.'));
    };
    mount(listWin.body,
      h('header.sn-list-head', h('button.tb-btn', { type: 'button', 'aria-label': 'New note', title: 'New note (Ctrl+N)', onclick: () => newNote() }, icon('plus', { size: 18 })), h('b', 'Sticky Notes')),
      h('div.sn-search', search), items);
    paint();
    const off = store.watch('notes', paint);
    listWin.on('close', () => { off(); listWin = null; store.set('listOpen', false); });
    store.set('listOpen', true);
    ctx.listen(listWin.body, 'keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); } });
  }
  const textOf = (html) => { const d = document.createElement('div'); d.innerHTML = sanitizeHtml(html || ''); return d.innerText.trim(); };

  // ── A note window ────────────────────────────────────────────────────
  function newNote(near) {
    const n = { id: uid(), html: '', color: store.get('lastColor', 'yellow'), created: Date.now(), updated: Date.now(), open: true, bounds: near ? { x: near.x + 30, y: near.y + 30, w: near.w, h: near.h } : null };
    save([...notes(), n]);
    openNote(n.id);
  }

  function openNote(id) {
    if (open.has(id)) { open.get(id).focus(); return; }
    const n = notes().find((x) => x.id === id);
    if (!n) return;
    const b = n.bounds || {};
    const w = ctx.windows.create({ title: 'Note', width: b.w || 320, height: b.h || 320, minWidth: 220, minHeight: 160, showTitle: false, ...(b.x !== undefined ? { x: b.x, y: b.y } : {}) });
    open.set(id, w);
    w.body.classList.add('sn-note');
    const editor = h('div.sn-editor', { contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note text', spellcheck: 'true' });
    editor.innerHTML = sanitizeHtml(n.html || '');
    const fmtBar = h('div.sn-format', { role: 'toolbar', 'aria-label': 'Formatting' },
      [['bold', 'B', 'Bold (Ctrl+B)'], ['italic', 'I', 'Italic (Ctrl+I)'], ['underline', 'U', 'Underline (Ctrl+U)'], ['strikeThrough', 'S', 'Strikethrough (Ctrl+T)'], ['insertUnorderedList', '•', 'Bullets (Ctrl+Shift+L)']]
        .map(([cmd, label, title]) => h('button.tb-btn', { type: 'button', title, 'aria-label': title, onmousedown: (e) => e.preventDefault(), onclick: () => { document.execCommand(cmd); persist(); } }, h('b.wr-glyph', label))));
    const applyColor = (c) => {
      const col = COLORS.find((x) => x[0] === c) || COLORS[0];
      w.body.style.setProperty('--bg', col[2]); w.body.style.setProperty('--bar', col[3]);
      w.body.classList.toggle('dark', c === 'charcoal');
      const winEl = w.body.closest('.win');
      winEl?.style.setProperty('--note-bg', col[2]);
      winEl?.style.setProperty('--note-bar', col[3]);
      winEl?.classList.add('sn-win');
      winEl?.classList.toggle('sn-dark', c === 'charcoal');
    };
    w.titlebar.append(h('div.sn-tb.drag',
      h('button.tb-btn', { type: 'button', 'aria-label': 'New note', title: 'New note (Ctrl+N)', onclick: () => newNote(w.getBounds()) }, icon('plus', { size: 16 })),
      h('div.sn-grow.drag'),
      h('button.tb-btn', { type: 'button', 'aria-label': 'Menu', title: 'Colour, notes list, delete', onclick: (e) => showMenu([
        { header: 'Colour' },
        ...COLORS.map(([c, label]) => ({ label, checked: (notes().find((x) => x.id === id)?.color || 'yellow') === c, onSelect: () => { update(id, { color: c }); store.set('lastColor', c); applyColor(c); } })),
        { separator: true },
        { label: 'Notes list', icon: 'list', onSelect: showList },
        { label: 'Delete note', icon: 'trash', danger: true, onSelect: () => removeNote(id) },
      ], { anchor: e.currentTarget, align: 'start' }) }, icon('chevronDown', { size: 16 }))));
    mount(w.body, editor, fmtBar);
    applyColor(n.color);

    let t = null;
    const persist = () => { clearTimeout(t); t = setTimeout(() => update(id, { html: sanitizeHtml(editor.innerHTML) }), 300); };
    editor.addEventListener('input', persist);
    editor.addEventListener('paste', (e) => {
      const html = e.clipboardData.getData('text/html');
      e.preventDefault();
      if (html) document.execCommand('insertHTML', false, sanitizeHtml(html, { stripStyles: true }));
      else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    editor.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 't') { e.preventDefault(); document.execCommand('strikeThrough'); persist(); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); document.execCommand('insertUnorderedList'); persist(); }
      else if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(w.getBounds()); }
      else if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); removeNote(id); }
    });
    let bt = null;
    w.on('resize', (bounds) => { clearTimeout(bt); bt = setTimeout(() => update(id, { bounds }), 400); });
    w.on('focus', () => editor.focus());
    w.on('close', () => {
      clearTimeout(t);
      if (open.get(id) === w) open.delete(id);
      const cur = notes().find((x) => x.id === id);
      // Closing an empty note throws it away, like a real pad.
      if (cur && !textOf(sanitizeHtml(editor.innerHTML)) && !editor.querySelector('img')) save(notes().filter((x) => x.id !== id));
      else if (cur) update(id, { html: sanitizeHtml(editor.innerHTML), open: closingAll });
    });
    update(id, { open: true });
    setTimeout(() => { editor.focus(); placeCaretAtEnd(editor); });
  }
  let closingAll = false;

  function placeCaretAtEnd(el) {
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  async function removeNote(id) {
    const n = notes().find((x) => x.id === id);
    if (!n) return;
    const parent = (open.get(id) || listWin)?.body;
    if (textOf(n.html) && !(await confirmDialog('Delete this note?', 'It can’t be recovered.', { ok: 'Delete', danger: true, parent }))) return;
    save(notes().filter((x) => x.id !== id));
    open.get(id)?.close({ force: true });
  }

  // When DonutOS shuts down or the user signs out, remember which notes were open.
  ctx.onExit(() => { closingAll = true; });

  ctx.onActivate((args) => { if (args?.newNote) newNote(); else showList(); });
  const reopen = notes().filter((n) => n.open);
  if (ctx.args.newNote) newNote();
  else if (reopen.length) { for (const n of reopen) openNote(n.id); if (store.get('listOpen', false)) showList(); }
  else if (notes().length) showList();
  else newNote();
}
