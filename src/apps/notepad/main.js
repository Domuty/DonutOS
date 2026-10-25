// Notepad: plain-text editor with tabs, find & replace, go to line, word wrap, zoom,
// font choice, and a status bar (line/column, characters, line endings, encoding).

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { menubar } from '../../ui/menubar.js';
import { dialog, promptDialog } from '../../ui/dialog.js';
import { Document } from '../common/document.js';
import { printDocument, escapeHtml } from '../common/print.js';
import * as P from '../../core/path.js';

const FILTERS = [
  { label: 'Text documents', exts: ['.txt'] },
  { label: 'All files', exts: ['*'] },
];
const FONTS = [['mono', 'Monospace', 'var(--font-mono)'], ['system', 'System', 'var(--font)'], ['serif', 'Serif', 'Georgia, "Times New Roman", serif']];

export default function main(ctx) {
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'Notepad', width: 860, height: 600, minWidth: 360, minHeight: 240, showTitle: false });
  win.body.classList.add('notepad');

  let wrap = store.get('wrap', true);
  let statusOn = store.get('status', true);
  let zoom = store.get('zoom', 100);
  let font = store.get('font', 'mono');
  let fontSize = store.get('fontSize', 14);

  const tabStrip = h('div.ex-tabs.drag', { role: 'tablist', 'aria-label': 'Notepad tabs' });
  win.titlebar.append(tabStrip);
  const stage = h('div.np-stage');
  const findBar = h('div.np-find', { hidden: true });
  const status = h('footer.np-status');
  const tabs = [];
  let active = null;

  const bar = menubar([
    { label: 'File', items: () => [
      { label: 'New tab', hint: 'Ctrl+N', onSelect: () => newTab() },
      { label: 'New window', hint: 'Ctrl+Shift+N', onSelect: () => ctx.launch('notepad', { newWindow: true }) },
      { label: 'Open…', hint: 'Ctrl+O', onSelect: () => openDialog() },
      { label: 'Save', hint: 'Ctrl+S', onSelect: () => active.doc.save() },
      { label: 'Save as…', hint: 'Ctrl+Shift+S', onSelect: () => active.doc.saveAs() },
      { label: 'Save all', hint: 'Ctrl+Alt+S', onSelect: () => saveAll() },
      { separator: true },
      { label: 'Print…', hint: 'Ctrl+P', onSelect: () => print() },
      { separator: true },
      { label: 'Close tab', hint: 'Ctrl+W', onSelect: () => closeTab(active) },
      { label: 'Close window', onSelect: () => win.close() },
    ] },
    { label: 'Edit', items: () => [
      { label: 'Undo', hint: 'Ctrl+Z', onSelect: () => exec('undo') },
      { label: 'Redo', hint: 'Ctrl+Y', onSelect: () => exec('redo') },
      { separator: true },
      { label: 'Cut', hint: 'Ctrl+X', disabled: !hasSelection(), onSelect: () => cut() },
      { label: 'Copy', hint: 'Ctrl+C', disabled: !hasSelection(), onSelect: () => copy() },
      { label: 'Paste', hint: 'Ctrl+V', onSelect: () => paste() },
      { label: 'Delete', hint: 'Del', disabled: !hasSelection(), onSelect: () => insert('') },
      { separator: true },
      { label: 'Find…', hint: 'Ctrl+F', onSelect: () => showFind(false) },
      { label: 'Find next', hint: 'F3', onSelect: () => findNext(1) },
      { label: 'Find previous', hint: 'Shift+F3', onSelect: () => findNext(-1) },
      { label: 'Replace…', hint: 'Ctrl+H', onSelect: () => showFind(true) },
      { label: 'Go to…', hint: 'Ctrl+G', onSelect: () => goTo() },
      { separator: true },
      { label: 'Select all', hint: 'Ctrl+A', onSelect: () => { active.ta.focus(); active.ta.select(); updateStatus(); } },
      { label: 'Time/Date', hint: 'F5', onSelect: () => insert(new Date().toLocaleString()) },
      { separator: true },
      { label: 'Font…', onSelect: () => chooseFont() },
    ] },
    { label: 'View', items: () => [
      { label: 'Zoom in', hint: 'Ctrl+Plus', onSelect: () => setZoom(zoom + 10) },
      { label: 'Zoom out', hint: 'Ctrl+Minus', onSelect: () => setZoom(zoom - 10) },
      { label: 'Restore default zoom', hint: 'Ctrl+0', onSelect: () => setZoom(100) },
      { separator: true },
      { label: 'Status bar', checked: statusOn, onSelect: () => { statusOn = !statusOn; store.set('status', statusOn); applyView(); } },
      { label: 'Word wrap', checked: wrap, onSelect: () => { wrap = !wrap; store.set('wrap', wrap); applyView(); } },
    ] },
  ]);
  mount(win.body, bar, findBar, stage, status);

  // ── Tabs ─────────────────────────────────────────────────────────────
  function newTab({ path, text = '' } = {}) {
    const ta = h('textarea.np-text', { spellcheck: false, 'aria-label': 'Text', wrap: wrap ? 'soft' : 'off' });
    ta.value = text;
    const tab = { ta, eol: '\n', title: '' };
    const fakeWin = { body: win.body, setTitle: (t) => { tab.title = t; if (tab === active) win.setTitle(t); renderTabs(); } };
    tab.doc = new Document(ctx, fakeWin, {
      appName: 'Notepad', untitled: 'Untitled', defaultExt: '.txt', filters: FILTERS,
      load: async (p) => {
        const raw = await ctx.fs.readText(p);
        tab.eol = /\r\n/.test(raw) ? '\r\n' : '\n';
        ta.value = raw.replace(/\r\n/g, '\n').replace(/^﻿/, '');
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
      },
      serialize: () => (tab.eol === '\r\n' ? ta.value.replace(/\n/g, '\r\n') : ta.value),
    });
    ta.addEventListener('input', () => { tab.doc.setDirty(true); updateStatus(); });
    for (const ev of ['keyup', 'mouseup', 'select', 'focus']) ta.addEventListener(ev, updateStatus);
    tabs.push(tab);
    stage.append(ta);
    activate(tab);
    if (path) tab.doc.open(path).then((ok) => { if (!ok && tabs.length > 1) closeTab(tab, { force: true }); updateStatus(); });
    return tab;
  }

  function activate(tab) {
    active = tab;
    for (const t of tabs) t.ta.hidden = t !== tab;
    win.setTitle(tab.title || 'Notepad');
    renderTabs();
    applyView();
    updateStatus();
    setTimeout(() => tab.ta.focus());
  }

  async function closeTab(tab, { force = false } = {}) {
    if (!force && !(await tab.doc.confirmDiscard())) return false;
    const i = tabs.indexOf(tab);
    tabs.splice(i, 1);
    tab.ta.remove();
    if (!tabs.length) { closing = true; win.close({ force: true }); return true; }
    if (active === tab) activate(tabs[Math.max(0, i - 1)]); else renderTabs();
    return true;
  }

  function renderTabs() {
    mount(tabStrip, tabs.map((t) => h('div.ex-tab', {
      role: 'tab', tabindex: '0', 'aria-selected': String(t === active), class: t === active && 'active', title: t.doc?.path || t.doc?.name,
      onclick: () => activate(t), onauxclick: (e) => { if (e.button === 1) closeTab(t); },
    }, h('span', `${t.doc?.dirty ? '• ' : ''}${t.doc?.name || 'Untitled.txt'}`),
    h('button.ex-tab-x', { type: 'button', 'aria-label': 'Close tab', onclick: (e) => { e.stopPropagation(); closeTab(t); } }, icon('close', { size: 10 })))),
    h('button.ex-tab-new', { type: 'button', title: 'New tab (Ctrl+N)', 'aria-label': 'New tab', onclick: () => newTab() }, icon('plus', { size: 14 })));
  }

  async function openDialog() {
    const { openFileDialog } = await import('../../ui/file-dialog.js');
    const path = await openFileDialog(ctx, win, { filters: FILTERS });
    if (path) openPath(path);
  }

  function openPath(path) {
    const existing = tabs.find((t) => t.doc.path === path);
    if (existing) { activate(existing); return; }
    // Reuse an empty, untouched tab instead of leaving it behind.
    if (active && !active.doc.path && !active.doc.dirty && !active.ta.value) { active.doc.open(path).then(updateStatus); return; }
    newTab({ path });
  }

  async function saveAll() { for (const t of tabs) if (t.doc.dirty) { activate(t); if (!(await t.doc.save())) return; } }

  // ── Editing ──────────────────────────────────────────────────────────
  const hasSelection = () => active.ta.selectionStart !== active.ta.selectionEnd;
  function exec(cmd) { active.ta.focus(); document.execCommand(cmd); }
  /** Replaces the selection, keeping the textarea's own undo history. */
  function insert(text) {
    const ta = active.ta;
    ta.focus();
    if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    active.doc.setDirty(true);
    updateStatus();
  }
  async function copy() { const ta = active.ta; await ctx.clipboard.writeText(ta.value.slice(ta.selectionStart, ta.selectionEnd)); ta.focus(); }
  async function cut() { await copy(); insert(''); }
  async function paste() { try { insert(await ctx.clipboard.readText()); } catch { active.ta.focus(); } }

  // ── Find & replace ───────────────────────────────────────────────────
  const findInput = h('input.input', { 'aria-label': 'Find', placeholder: 'Find', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') hideFind(); }, oninput: () => countMatches() });
  const replaceInput = h('input.input', { 'aria-label': 'Replace with', placeholder: 'Replace with', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } else if (e.key === 'Escape') hideFind(); } });
  const matchCase = h('input', { type: 'checkbox', onchange: () => countMatches() });
  const wrapAround = h('input', { type: 'checkbox', checked: true });
  const count = h('span.np-count');
  const replaceRow = h('div.np-find-row', replaceInput,
    h('button.btn', { type: 'button', onclick: () => replaceOne() }, 'Replace'),
    h('button.btn', { type: 'button', onclick: () => replaceAll() }, 'Replace all'));
  mount(findBar,
    h('div.np-find-row', findInput,
      h('button.tb-btn', { type: 'button', 'aria-label': 'Previous match', title: 'Previous (Shift+F3)', onclick: () => findNext(-1) }, icon('chevronUp', { size: 14 })),
      h('button.tb-btn', { type: 'button', 'aria-label': 'Next match', title: 'Next (F3)', onclick: () => findNext(1) }, icon('chevronDown', { size: 14 })),
      count,
      h('label.np-opt', matchCase, 'Match case'), h('label.np-opt', wrapAround, 'Wrap around'),
      h('button.tb-btn', { type: 'button', 'aria-label': 'Close find', onclick: () => hideFind() }, icon('close', { size: 14 }))),
    replaceRow);

  function showFind(withReplace) {
    findBar.hidden = false;
    replaceRow.hidden = !withReplace;
    const ta = active.ta;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel && !sel.includes('\n')) findInput.value = sel;
    findInput.focus(); findInput.select();
    countMatches();
  }
  function hideFind() { findBar.hidden = true; active.ta.focus(); }
  const norm = (s) => (matchCase.checked ? s : s.toLowerCase());
  function countMatches() {
    const q = findInput.value;
    if (!q) { count.textContent = ''; return 0; }
    const text = norm(active.ta.value), needle = norm(q);
    let n = 0;
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) n++;
    count.textContent = n ? `${n} match${n === 1 ? '' : 'es'}` : 'No results';
    return n;
  }
  function findNext(dir = 1) {
    const q = findInput.value;
    if (!q) { showFind(false); return false; }
    const ta = active.ta;
    const text = norm(ta.value), needle = norm(q);
    let i = dir > 0 ? text.indexOf(needle, ta.selectionEnd) : text.lastIndexOf(needle, Math.max(0, ta.selectionStart - 1));
    if (i < 0 && wrapAround.checked) i = dir > 0 ? text.indexOf(needle) : text.lastIndexOf(needle);
    if (i < 0) { count.textContent = `Can’t find “${q}”`; return false; }
    ta.focus();
    ta.setSelectionRange(i, i + q.length);
    scrollToSelection(ta);
    updateStatus();
    if (!findBar.hidden) setTimeout(() => findInput.focus());
    return true;
  }
  function replaceOne() {
    const ta = active.ta;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel && norm(sel) === norm(findInput.value)) insert(replaceInput.value);
    findNext(1);
    countMatches();
  }
  function replaceAll() {
    const q = findInput.value;
    if (!q) return;
    const ta = active.ta;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase.checked ? 'g' : 'gi');
    const n = (ta.value.match(re) || []).length;
    if (!n) { count.textContent = 'No results'; return; }
    ta.focus();
    ta.select();
    insert(ta.value.replace(re, () => replaceInput.value));
    ta.setSelectionRange(0, 0);
    count.textContent = `Replaced ${n}`;
  }
  function scrollToSelection(ta) {
    const line = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const y = line * lh;
    if (y < ta.scrollTop || y > ta.scrollTop + ta.clientHeight - lh * 2) ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
  }

  async function goTo() {
    const ta = active.ta;
    const lines = ta.value.split('\n');
    const cur = ta.value.slice(0, ta.selectionStart).split('\n').length;
    const v = await promptDialog('Go to line', { label: `Line number (1–${lines.length})`, value: String(cur), ok: 'Go to', parent: win.body,
      validate: (x) => (/^\d+$/.test(x.trim()) && Number(x) >= 1 && Number(x) <= lines.length ? '' : `Type a number from 1 to ${lines.length}`) });
    if (!v) return;
    const n = Number(v);
    const pos = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(pos, pos);
    scrollToSelection(ta);
    updateStatus();
  }

  async function chooseFont() {
    const fam = h('select.input', { 'aria-label': 'Font' }, FONTS.map(([id, label]) => h('option', { value: id, selected: id === font }, label)));
    const size = h('input.input', { type: 'number', min: 8, max: 48, value: fontSize, 'aria-label': 'Size' });
    const sample = h('div.np-sample', 'The quick brown fox jumps over the lazy dog');
    const upd = () => { sample.style.fontFamily = FONTS.find((f) => f[0] === fam.value)[2]; sample.style.fontSize = `${size.value}px`; };
    fam.onchange = upd; size.oninput = upd; upd();
    const ok = await dialog({ title: 'Font', parent: win.body, body: h('div.np-font', h('label', 'Font', fam), h('label', 'Size', size), sample),
      cancelValue: false, buttons: [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    font = fam.value; fontSize = Math.max(8, Math.min(48, Number(size.value) || 14));
    store.set('font', font); store.set('fontSize', fontSize);
    applyView();
  }

  async function print() {
    await printDocument({ title: active.doc.name, html: `<pre>${escapeHtml(active.ta.value)}</pre>`, css: `pre { white-space: pre-wrap; font: ${fontSize * 0.75}pt/1.4 ui-monospace, monospace; margin: 0; }` });
  }

  // ── View ─────────────────────────────────────────────────────────────
  function setZoom(z) { zoom = Math.max(10, Math.min(500, Math.round(z / 10) * 10)); store.set('zoom', zoom); applyView(); }
  function applyView() {
    win.body.style.setProperty('--np-size', `${(fontSize * zoom) / 100}px`);
    win.body.style.setProperty('--np-font', FONTS.find((f) => f[0] === font)?.[2] || 'var(--font-mono)');
    for (const t of tabs) { t.ta.wrap = wrap ? 'soft' : 'off'; t.ta.classList.toggle('nowrap', !wrap); }
    status.hidden = !statusOn;
    updateStatus();
  }
  function updateStatus() {
    if (!active || status.hidden) return;
    const ta = active.ta;
    const before = ta.value.slice(0, ta.selectionStart);
    const ln = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    const sel = ta.selectionEnd - ta.selectionStart;
    mount(status,
      h('span', `Ln ${ln}, Col ${col}`),
      h('span', sel ? `${sel} of ${ta.value.length} characters` : `${ta.value.length} characters`),
      h('span.np-grow'),
      h('span', `${zoom}%`),
      h('span', active.eol === '\r\n' ? 'Windows (CRLF)' : 'Unix (LF)'),
      h('span', 'UTF-8'));
  }

  // ── Keys and lifecycle ───────────────────────────────────────────────
  ctx.listen(win.body, 'keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === 'F3') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
    else if (e.key === 'F5') { e.preventDefault(); insert(new Date().toLocaleString()); }
    else if (e.key === 'Tab' && e.target === active.ta && !ctrl) { e.preventDefault(); insert('\t'); }
    else if (!ctrl) return;
    else if (key === 'n' && e.shiftKey) { e.preventDefault(); ctx.launch('notepad', { newWindow: true }); }
    else if (key === 'n') { e.preventDefault(); newTab(); }
    else if (key === 'o') { e.preventDefault(); openDialog(); }
    else if (key === 's' && e.altKey) { e.preventDefault(); saveAll(); }
    else if (key === 's' && e.shiftKey) { e.preventDefault(); active.doc.saveAs(); }
    else if (key === 's') { e.preventDefault(); active.doc.save(); }
    else if (key === 'p') { e.preventDefault(); print(); }
    else if (key === 'w' || (e.altKey && key === 'w')) { e.preventDefault(); closeTab(active); }
    else if (key === 'f') { e.preventDefault(); showFind(false); }
    else if (key === 'h') { e.preventDefault(); showFind(true); }
    else if (key === 'g') { e.preventDefault(); goTo(); }
    else if (key === 'y') { e.preventDefault(); exec('redo'); }
    else if (key === '=' || key === '+') { e.preventDefault(); setZoom(zoom + 10); }
    else if (key === '-') { e.preventDefault(); setZoom(zoom - 10); }
    else if (key === '0') { e.preventDefault(); setZoom(100); }
    else if (key === 'tab') { e.preventDefault(); const i = tabs.indexOf(active); activate(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]); }
  });
  // Ctrl+W is kept by browsers; Alt+W also closes the tab.
  ctx.listen(win.body, 'keydown', (e) => { if (e.altKey && !e.ctrlKey && e.code === 'KeyW') { e.preventDefault(); closeTab(active); } });
  ctx.listen(win.body, 'wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });

  let closing = false;
  win.onBeforeClose(async () => {
    if (closing) return true;
    for (const t of [...tabs]) { if (t.doc.dirty) { activate(t); if (!(await t.doc.confirmDiscard())) return false; } }
    return true;
  });
  win.on('focus', () => active?.ta.focus());
  ctx.onActivate((args) => { win.focus(); if (args?.path) openPath(args.path); else if (!args?.newWindow) newTab(); });

  // Dropping a file from Explorer or the desktop opens it.
  ctx.listen(win.body, 'dragover', (e) => { if (e.dataTransfer.types.includes('application/x-donut-paths')) e.preventDefault(); });
  ctx.listen(win.body, 'drop', (e) => {
    const data = e.dataTransfer.getData('application/x-donut-paths');
    if (!data) return;
    e.preventDefault();
    for (const p of JSON.parse(data)) if (P.extname(p)) openPath(p);
  });

  newTab(ctx.args.path ? { path: ctx.args.path } : {});
}
