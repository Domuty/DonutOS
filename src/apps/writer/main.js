// Writer: a word processor. Documents are saved as HTML (they open in any web browser),
// with plain-text and Markdown export and PDF through Print. Opened files are sanitised so
// a document can never run code.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { menubar } from '../../ui/menubar.js';
import { dialog, promptDialog } from '../../ui/dialog.js';
import { openFileDialog } from '../../ui/file-dialog.js';
import { Document, documentKeys } from '../common/document.js';
import { printDocument, escapeHtml } from '../common/print.js';
import { sanitizeHtml, htmlToMarkdown, markdownToHtml } from './convert.js';
import * as P from '../../core/path.js';

const FILTERS = [
  { label: 'Writer document', exts: ['.ddoc'] },
  { label: 'Web page', exts: ['.html', '.htm'] },
  { label: 'Markdown', exts: ['.md'] },
  { label: 'Plain text', exts: ['.txt'] },
  { label: 'All files', exts: ['*'] },
];
const FONTS = [['', 'Default'], ['Georgia, serif', 'Georgia'], ['"Times New Roman", serif', 'Times'], ['Arial, Helvetica, sans-serif', 'Arial'], ['Verdana, sans-serif', 'Verdana'], ['"Trebuchet MS", sans-serif', 'Trebuchet'], ['ui-monospace, Menlo, Consolas, monospace', 'Monospace']];
const SIZES = [['1', '8'], ['2', '10'], ['3', '12'], ['4', '14'], ['5', '18'], ['6', '24'], ['7', '36']];
const BLOCKS = [['p', 'Normal text'], ['h1', 'Title'], ['h2', 'Heading 1'], ['h3', 'Heading 2'], ['h4', 'Heading 3'], ['blockquote', 'Quote'], ['pre', 'Code']];

const DOC_CSS = `
  .wr-page, body { font: 12pt/1.55 Georgia, "Times New Roman", serif; color: #1d1d1f; }
  h1 { font-size: 26pt; margin: .2em 0 .4em; } h2 { font-size: 18pt; margin: 1em 0 .4em; }
  h3 { font-size: 14pt; margin: 1em 0 .3em; } h4 { font-size: 12pt; margin: 1em 0 .3em; }
  p { margin: 0 0 .7em; } blockquote { margin: .8em 0; padding: .2em 1em; border-left: 3px solid #bbb; color: #555; }
  pre { font: 10pt/1.45 ui-monospace, Menlo, Consolas, monospace; background: #f3f3f5; padding: .7em 1em; border-radius: 4px; white-space: pre-wrap; }
  table { border-collapse: collapse; margin: .6em 0; } td, th { border: 1px solid #aaa; padding: 4px 8px; min-width: 40px; vertical-align: top; }
  img { max-width: 100%; } hr { border: 0; border-top: 1px solid #bbb; margin: 1.2em 0; } a { color: #2357c5; }`;

export default function main(ctx) {
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'Writer', width: 1040, height: 720, minWidth: 520, minHeight: 360 });
  win.body.classList.add('writer');
  let zoom = store.get('zoom', 100);
  let pageView = store.get('pageView', true);
  let spell = store.get('spell', true);

  const page = h('div.wr-page', { contenteditable: 'true', spellcheck: String(spell), role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Document' });
  const scroller = h('div.wr-scroll', h('div.wr-zoom', page));
  const status = h('footer.wr-status');
  const tb = h('div.wr-toolbar', { role: 'toolbar', 'aria-label': 'Formatting' });

  const doc = new Document(ctx, win, {
    appName: 'Writer', untitled: 'Document', defaultExt: '.ddoc', filters: FILTERS,
    load: async (path) => {
      const text = await ctx.fs.readText(path);
      const ext = P.extname(path).toLowerCase();
      setContent(ext === '.md' ? markdownToHtml(text) : ['.ddoc', '.html', '.htm'].includes(ext) ? extractBody(text) : textToHtml(text));
    },
    serialize: (path) => {
      const ext = P.extname(path).toLowerCase();
      if (ext === '.txt') return page.innerText;
      if (ext === '.md') return htmlToMarkdown(page);
      return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(P.basename(path, ext))}</title>\n<meta name="generator" content="DonutOS Writer">\n<style>body { max-width: 760px; margin: 40px auto; padding: 0 20px; }${DOC_CSS}</style></head>\n<body>\n${sanitizeHtml(page.innerHTML)}\n</body></html>\n`;
    },
  });

  const extractBody = (html) => { const d = new DOMParser().parseFromString(html, 'text/html'); return sanitizeHtml(d.body.innerHTML); };
  const textToHtml = (t) => t.split(/\n{2,}/).map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`).join('') || '<p><br></p>';
  function setContent(html) { page.innerHTML = html || '<p><br></p>'; updateStatus(); }

  // ── Commands ─────────────────────────────────────────────────────────
  const cmd = (name, value = null) => { page.focus(); restoreSel(); document.execCommand(name, false, value); doc.setDirty(true); refresh(); };
  let savedRange = null;
  const saveSel = () => { const s = getSelection(); if (s.rangeCount && page.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); };
  const restoreSel = () => { if (savedRange && !page.contains(getSelection().anchorNode)) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); } };

  async function insertLink() {
    saveSel();
    const url = await promptDialog('Insert link', { label: 'Web address', value: 'https://', parent: win.body, validate: (v) => (/^(https?:|mailto:)/i.test(v.trim()) ? '' : 'Start with https://, http:// or mailto:') });
    if (!url) return;
    if (getSelection().isCollapsed) cmd('insertHTML', `<a href="${escapeHtml(url.trim())}">${escapeHtml(url.trim())}</a>`);
    else cmd('createLink', url.trim());
  }

  async function insertImage() {
    saveSel();
    const path = await openFileDialog(ctx, win, { title: 'Insert picture', filters: [{ label: 'Pictures', exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'] }] });
    if (!path) return;
    const blob = await ctx.fs.readBlob(path);
    const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    cmd('insertHTML', `<img src="${url}" alt="${escapeHtml(P.basename(path))}">`);
  }

  async function insertTable() {
    saveSel();
    const rows = h('input.input', { type: 'number', min: 1, max: 50, value: 3, 'aria-label': 'Rows' });
    const cols = h('input.input', { type: 'number', min: 1, max: 12, value: 3, 'aria-label': 'Columns' });
    const header = h('input', { type: 'checkbox', checked: true });
    const ok = await dialog({ title: 'Insert table', parent: win.body, cancelValue: false, body: h('div.wr-form', h('label', 'Rows', rows), h('label', 'Columns', cols), h('label.wr-check', header, 'Header row')),
      buttons: [{ label: 'Insert', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    const r = Math.max(1, Math.min(50, Number(rows.value) || 3)), c = Math.max(1, Math.min(12, Number(cols.value) || 3));
    const cell = (tag) => `<${tag}><br></${tag}>`;
    const html = `<table><tbody>${Array.from({ length: r }, (_, i) => `<tr>${Array.from({ length: c }, () => cell(header.checked && i === 0 ? 'th' : 'td')).join('')}</tr>`).join('')}</tbody></table><p><br></p>`;
    cmd('insertHTML', html);
  }

  // Find & replace over the document's text nodes.
  async function findReplace(withReplace) {
    saveSel();
    const find = h('input.input', { 'aria-label': 'Find', value: getSelection().toString().slice(0, 100) });
    const repl = h('input.input', { 'aria-label': 'Replace with' });
    const mc = h('input', { type: 'checkbox' });
    const info = h('div.hint', { role: 'status' });
    const matches = () => {
      const q = find.value;
      if (!q) return [];
      const out = [];
      const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
      const norm = (s) => (mc.checked ? s : s.toLowerCase());
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = norm(n.nodeValue), needle = norm(q);
        for (let i = t.indexOf(needle); i >= 0; i = t.indexOf(needle, i + needle.length)) out.push([n, i, i + q.length]);
      }
      return out;
    };
    let idx = -1;
    const select = (m) => { const r = document.createRange(); r.setStart(m[0], m[1]); r.setEnd(m[0], m[2]); const s = getSelection(); s.removeAllRanges(); s.addRange(r); m[0].parentElement.scrollIntoView({ block: 'center' }); savedRange = r.cloneRange(); };
    const next = () => { const all = matches(); info.textContent = all.length ? '' : 'No results'; if (!all.length) return; idx = (idx + 1) % all.length; select(all[idx]); info.textContent = `${idx + 1} of ${all.length}`; };
    const replaceOne = () => {
      const s = getSelection();
      if (!s.isCollapsed && (mc.checked ? s.toString() === find.value : s.toString().toLowerCase() === find.value.toLowerCase())) { page.focus(); document.execCommand('insertText', false, repl.value); doc.setDirty(true); idx--; }
      next();
    };
    const replaceAll = () => {
      const all = matches().reverse();
      for (const [n, a, b] of all) n.nodeValue = n.nodeValue.slice(0, a) + repl.value + n.nodeValue.slice(b);
      if (all.length) doc.setDirty(true);
      info.textContent = `Replaced ${all.length}`;
      updateStatus();
    };
    find.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); next(); } });
    await dialog({ title: withReplace ? 'Find and replace' : 'Find', parent: win.body, width: 420, cancelValue: null,
      body: h('div.wr-form', h('label', 'Find', find), withReplace ? h('label', 'Replace with', repl) : null, h('label.wr-check', mc, 'Match case'), info,
        h('div.wr-row', h('button.btn', { type: 'button', onclick: next }, 'Find next'), withReplace ? [h('button.btn', { type: 'button', onclick: replaceOne }, 'Replace'), h('button.btn', { type: 'button', onclick: replaceAll }, 'Replace all')] : null)),
      buttons: [{ label: 'Close', value: null }] });
    page.focus();
  }

  async function print() { await printDocument({ title: doc.name, html: sanitizeHtml(page.innerHTML), css: DOC_CSS }); }

  async function exportAs(ext) {
    const { saveFileDialog } = await import('../../ui/file-dialog.js');
    const f = FILTERS.find((x) => x.exts.includes(ext));
    const base = doc.path ? P.basename(doc.path, P.extname(doc.path)) : 'Document';
    const path = await saveFileDialog(ctx, win, { title: `Export as ${f.label}`, filters: [f], suggestedName: base + ext, startIn: doc.path ? P.dirname(doc.path) : undefined });
    if (!path) return;
    await ctx.fs.writeText(path, ext === '.md' ? htmlToMarkdown(page) : page.innerText);
    ctx.notify({ title: 'Exported', body: P.basename(path) }).catch(() => {});
  }

  // ── Toolbar ──────────────────────────────────────────────────────────
  const btn = (ic, label, onclick, opts = {}) => h('button.tb-btn.wr-btn', { type: 'button', title: label, 'aria-label': label, onmousedown: (e) => e.preventDefault(), onclick, ...opts }, typeof ic === 'string' && ic.length > 2 ? icon(ic, { size: 16 }) : h('b.wr-glyph', ic));
  const blockSel = h('select.input.wr-sel', { 'aria-label': 'Paragraph style', onchange: () => cmd('formatBlock', blockSel.value) }, BLOCKS.map(([v, l]) => h('option', { value: v }, l)));
  const fontSel = h('select.input.wr-sel', { 'aria-label': 'Font', onchange: () => cmd('fontName', fontSel.value || 'Georgia, serif') }, FONTS.map(([v, l]) => h('option', { value: v }, l)));
  const sizeSel = h('select.input.wr-sel.wr-size', { 'aria-label': 'Font size', onchange: () => cmd('fontSize', sizeSel.value) }, SIZES.map(([v, l]) => h('option', { value: v, selected: v === '3' }, l)));
  const color = h('input.wr-color', { type: 'color', value: '#c2185b', 'aria-label': 'Text colour', title: 'Text colour', oninput: () => cmd('foreColor', color.value) });
  const hilite = h('input.wr-color', { type: 'color', value: '#fff176', 'aria-label': 'Highlight colour', title: 'Highlight', oninput: () => cmd('hiliteColor', hilite.value) });
  const states = {};
  const stateBtn = (name, glyph, label, hint) => (states[name] = btn(glyph, `${label} (${hint})`, () => cmd(name), { 'aria-pressed': 'false' }));
  mount(tb,
    btn('arrowLeft', 'Undo (Ctrl+Z)', () => cmd('undo')), btn('arrowRight', 'Redo (Ctrl+Y)', () => cmd('redo')), h('span.wr-sep'),
    blockSel, fontSel, sizeSel, h('span.wr-sep'),
    stateBtn('bold', 'B', 'Bold', 'Ctrl+B'), stateBtn('italic', 'I', 'Italic', 'Ctrl+I'), stateBtn('underline', 'U', 'Underline', 'Ctrl+U'), stateBtn('strikeThrough', 'S', 'Strikethrough', 'Ctrl+Shift+X'),
    h('label.wr-colorwrap', { title: 'Text colour' }, h('b.wr-glyph', 'A'), color), h('label.wr-colorwrap', { title: 'Highlight' }, h('b.wr-glyph.hl', 'H'), hilite), h('span.wr-sep'),
    stateBtn('justifyLeft', '⯇', 'Align left', 'Ctrl+L'), stateBtn('justifyCenter', '≡', 'Centre', 'Ctrl+E'), stateBtn('justifyRight', '⯈', 'Align right', 'Ctrl+R'), stateBtn('justifyFull', '☰', 'Justify', 'Ctrl+J'), h('span.wr-sep'),
    stateBtn('insertUnorderedList', '•', 'Bulleted list', 'Ctrl+Shift+8'), stateBtn('insertOrderedList', '1.', 'Numbered list', 'Ctrl+Shift+7'),
    btn('⇤', 'Decrease indent', () => cmd('outdent')), btn('⇥', 'Increase indent', () => cmd('indent')), h('span.wr-sep'),
    btn('globe', 'Link (Ctrl+K)', insertLink), btn('image', 'Picture', insertImage), btn('▦', 'Table', insertTable), btn('—', 'Horizontal line', () => cmd('insertHorizontalRule')),
    btn('Tx', 'Clear formatting', () => { cmd('removeFormat'); cmd('formatBlock', 'p'); }));

  function refresh() {
    for (const [name, b] of Object.entries(states)) {
      let on = false;
      try { on = document.queryCommandState(name); } catch { /* unsupported */ }
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
    }
    try {
      const block = String(document.queryCommandValue('formatBlock') || 'p').toLowerCase();
      blockSel.value = BLOCKS.some(([v]) => v === block) ? block : 'p';
      const size = String(document.queryCommandValue('fontSize') || '3');
      if (SIZES.some(([v]) => v === size)) sizeSel.value = size;
    } catch { /* unsupported */ }
    updateStatus();
  }

  function updateStatus() {
    const text = page.innerText || '';
    const words = (text.match(/[\p{L}\p{N}’'-]+/gu) || []).length;
    const sel = page.contains(getSelection().anchorNode) ? getSelection().toString() : '';
    const sw = sel ? (sel.match(/[\p{L}\p{N}’'-]+/gu) || []).length : 0;
    mount(status, h('span', sel ? `${sw} of ${words} words` : `${words} word${words === 1 ? '' : 's'}`), h('span', `${text.replace(/\n/g, '').length} characters`),
      h('span.np-grow'),
      h('button.wr-stbtn', { type: 'button', onclick: () => setPageView(!pageView), title: 'Switch layout' }, pageView ? 'Page layout' : 'Web layout'),
      h('button.wr-stbtn', { type: 'button', 'aria-label': 'Zoom out', onclick: () => setZoom(zoom - 10) }, '−'),
      h('span', `${zoom}%`),
      h('button.wr-stbtn', { type: 'button', 'aria-label': 'Zoom in', onclick: () => setZoom(zoom + 10) }, '+'));
  }
  function setZoom(z) { zoom = Math.max(30, Math.min(300, z)); store.set('zoom', zoom); applyView(); }
  function setPageView(on) { pageView = on; store.set('pageView', on); applyView(); }
  function applyView() {
    win.body.style.setProperty('--wr-zoom', zoom / 100);
    win.body.classList.toggle('web-layout', !pageView);
    page.spellcheck = spell;
    updateStatus();
  }

  const bar = menubar([
    { label: 'File', items: () => [
      { label: 'New', hint: 'Ctrl+N', onSelect: () => doc.reset(() => setContent('')) },
      { label: 'Open…', hint: 'Ctrl+O', onSelect: () => doc.openWithDialog() },
      { label: 'Save', hint: 'Ctrl+S', onSelect: () => doc.save() },
      { label: 'Save as…', hint: 'Ctrl+Shift+S', onSelect: () => doc.saveAs() },
      { separator: true },
      { label: 'Export as Markdown…', onSelect: () => exportAs('.md') },
      { label: 'Export as plain text…', onSelect: () => exportAs('.txt') },
      { label: 'Print or save as PDF…', hint: 'Ctrl+P', onSelect: print },
      { separator: true },
      { label: 'Close', onSelect: () => win.close() },
    ] },
    { label: 'Edit', items: () => [
      { label: 'Undo', hint: 'Ctrl+Z', onSelect: () => cmd('undo') },
      { label: 'Redo', hint: 'Ctrl+Y', onSelect: () => cmd('redo') },
      { separator: true },
      { label: 'Find…', hint: 'Ctrl+F', onSelect: () => findReplace(false) },
      { label: 'Replace…', hint: 'Ctrl+H', onSelect: () => findReplace(true) },
      { label: 'Select all', hint: 'Ctrl+A', onSelect: () => { page.focus(); cmd('selectAll'); } },
    ] },
    { label: 'Insert', items: () => [
      { label: 'Picture…', icon: 'image', onSelect: insertImage },
      { label: 'Table…', onSelect: insertTable },
      { label: 'Link…', hint: 'Ctrl+K', icon: 'globe', onSelect: insertLink },
      { label: 'Horizontal line', onSelect: () => cmd('insertHorizontalRule') },
      { label: 'Date and time', onSelect: () => cmd('insertText', new Date().toLocaleString()) },
      { label: 'Page break (for printing)', onSelect: () => cmd('insertHTML', '<hr style="page-break-after:always;border:0;border-top:1px dashed #bbb">') },
    ] },
    { label: 'View', items: () => [
      { label: 'Page layout', checked: pageView, onSelect: () => setPageView(true) },
      { label: 'Web layout', checked: !pageView, onSelect: () => setPageView(false) },
      { separator: true },
      { label: 'Zoom in', hint: 'Ctrl+Plus', onSelect: () => setZoom(zoom + 10) },
      { label: 'Zoom out', hint: 'Ctrl+Minus', onSelect: () => setZoom(zoom - 10) },
      { label: '100%', onSelect: () => setZoom(100) },
      { separator: true },
      { label: 'Check spelling as you type', checked: spell, onSelect: () => { spell = !spell; store.set('spell', spell); applyView(); } },
    ] },
  ]);
  mount(win.body, bar, tb, scroller, status);

  // ── Events ───────────────────────────────────────────────────────────
  page.addEventListener('input', () => { doc.setDirty(true); updateStatus(); });
  ctx.listen(document, 'selectionchange', () => { if (page.contains(getSelection().anchorNode)) { saveSel(); refresh(); } });
  page.addEventListener('paste', (e) => {
    // Paste as clean formatting: keep structure, drop scripts, foreign styles and classes.
    const html = e.clipboardData.getData('text/html');
    if (!html) return;
    e.preventDefault();
    document.execCommand('insertHTML', false, sanitizeHtml(extractBody(html), { stripStyles: true }));
  });
  page.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const inCell = getSelection().anchorNode?.parentElement?.closest('td, th');
      if (inCell) { const cells = [...page.querySelectorAll('td, th')]; const next = cells[cells.indexOf(inCell) + (e.shiftKey ? -1 : 1)]; if (next) { const r = document.createRange(); r.selectNodeContents(next); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); } return; }
      if (getSelection().anchorNode?.parentElement?.closest('li')) cmd(e.shiftKey ? 'outdent' : 'indent'); else cmd('insertText', ' ');
    }
  });
  ctx.listen(win.body, 'keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl || e.altKey) return;
    const key = e.key.toLowerCase();
    const map = { b: 'bold', i: 'italic', u: 'underline', l: 'justifyLeft', e: 'justifyCenter', r: 'justifyRight', j: 'justifyFull' };
    if (!e.shiftKey && map[key]) { e.preventDefault(); cmd(map[key]); }
    else if (e.shiftKey && key === 'x') { e.preventDefault(); cmd('strikeThrough'); }
    else if (e.shiftKey && (e.key === '*' || e.code === 'Digit8')) { e.preventDefault(); cmd('insertUnorderedList'); }
    else if (e.shiftKey && (e.key === '&' || e.code === 'Digit7')) { e.preventDefault(); cmd('insertOrderedList'); }
    else if (key === 'k') { e.preventDefault(); insertLink(); }
    else if (key === 'f') { e.preventDefault(); findReplace(false); }
    else if (key === 'h') { e.preventDefault(); findReplace(true); }
    else if (key === 'y') { e.preventDefault(); cmd('redo'); }
    else if (key === '=' || key === '+') { e.preventDefault(); setZoom(zoom + 10); }
    else if (key === '-') { e.preventDefault(); setZoom(zoom - 10); }
  });
  documentKeys(ctx, win, { new: () => doc.reset(() => setContent('')), open: () => doc.openWithDialog(), save: () => doc.save(), saveAs: () => doc.saveAs(), print });
  win.onBeforeClose(() => doc.confirmDiscard());
  win.on('focus', () => page.focus());

  try { document.execCommand('styleWithCSS', false, true); document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* unsupported */ }
  applyView();
  setContent('');
  if (ctx.args.path) doc.open(ctx.args.path);
  setTimeout(() => page.focus());
}
