// Markdown Studio — edit Markdown with a live, safe preview (no HTML from the document runs).
import { h, mount, css, ui } from '@donut/sdk';

css(`
.md { height: 100%; display: flex; flex-direction: column; }
.md-panes { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; }
.md-panes.edit-only { grid-template-columns: 1fr 0; } .md-panes.preview-only { grid-template-columns: 0 1fr; }
textarea.md-src { border: 0; outline: 0; resize: none; padding: 16px 18px; font: 14px/1.6 var(--font-mono); background: var(--surface-solid); color: var(--text); tab-size: 2; }
.md-view { overflow: auto; padding: 16px 28px; border-left: 1px solid var(--border); background: var(--surface-2); line-height: 1.6; }
.md-view h1 { font-size: 28px; } .md-view h2 { font-size: 22px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.md-view code { font-family: var(--font-mono); background: var(--surface-3); padding: 1px 5px; border-radius: 4px; font-size: .92em; }
.md-view pre { background: var(--surface-3); padding: 12px 14px; border-radius: 8px; overflow: auto; } .md-view pre code { background: none; padding: 0; }
.md-view blockquote { border-left: 4px solid var(--accent); margin: 0 0 12px; padding: 2px 14px; color: var(--text-2); }
.md-view table { border-collapse: collapse; margin-bottom: 12px; } .md-view td, .md-view th { border: 1px solid var(--border-strong); padding: 5px 10px; }
.md-view img { max-width: 100%; } .md-view li.task { list-style: none; margin-left: -1.3em; }
.md-status { display: flex; gap: 16px; padding: 4px 12px; font-size: 12px; color: var(--text-2); border-top: 1px solid var(--border); }
`);

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeUrl = (u) => (/^(https?:|mailto:|#|data:image\/)/i.test(u.trim()) ? u.trim() : '#');
function inline(s) {
  const codes = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => `<img alt="${a}" src="${safeUrl(u)}">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`)
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}
export function render(md) {
  const L = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < L.length;) {
    const l = L[i];
    if (/^```/.test(l)) { const buf = []; for (i++; i < L.length && !/^```/.test(L[i]); i++) buf.push(L[i]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
    const hm = /^(#{1,6})\s+(.*)$/.exec(l); if (hm) { out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`); i++; continue; }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(l)) { const buf = []; for (; i < L.length && /^>\s?/.test(L[i]); i++) buf.push(L[i].replace(/^>\s?/, '')); out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`); continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l); const items = [];
      for (; i < L.length && /^\s*([-*+]|\d+[.)])\s+/.test(L[i]); i++) items.push(L[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => { const tm = /^\[( |x)\]\s*(.*)$/i.exec(t); return tm ? `<li class="task"><input type="checkbox" disabled${tm[1].trim() ? ' checked' : ''}> ${inline(tm[2])}</li>` : `<li>${inline(t)}</li>`; }).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(l) && /^\|?\s*:?-+/.test(L[i + 1] || '')) {
      const row = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = row(l); i += 2; const body = [];
      for (; i < L.length && /^\|.*\|\s*$/.test(L[i]); i++) body.push(row(L[i]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf = []; for (; i < L.length && L[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(L[i]); i++) buf.push(L[i]);
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

const SAMPLE = '# Welcome to Markdown Studio\n\nWrite on the left, see it on the right.\n\n## Things you can do\n\n- **Bold**, *italic*, ~~strike~~ and `code`\n- [Links](https://example.com)\n- [x] Task lists\n- [ ] And tables:\n\n| Feature | Works |\n| --- | --- |\n| Preview | Yes |\n| Export | Yes |\n\n> Quotes look like this.\n\n```\nfunction hello() { return "world"; }\n```\n';

export default async function main(app) {
  let path = null, dirty = false, layout = app.storage.get('layout', 'split');
  const src = h('textarea.md-src', { spellcheck: true, 'aria-label': 'Markdown' });
  const view = h('article.md-view');
  const panes = h('div.md-panes', src, view);
  const status = h('div.md-status');
  const btn = (label, fn, title) => h('button.btn.subtle', { type: 'button', onclick: fn, title }, label);
  const bar = h('div.toolbar', btn('New', () => confirmDiscard().then((ok) => ok && setDoc(null, ''))), btn('Open…', openDoc, 'Ctrl+O'), btn('Save', () => saveDoc(false), 'Ctrl+S'), btn('Save as…', () => saveDoc(true), 'Ctrl+Shift+S'), btn('Export HTML…', exportHtml),
    h('div.grow'), ...['edit', 'split', 'preview'].map((v) => h('button.btn.subtle', { type: 'button', 'aria-pressed': String(layout === v), onclick: () => setLayout(v) }, { edit: 'Editor', split: 'Both', preview: 'Preview' }[v])));
  mount(app.root, h('div.md', bar, panes, status));

  const name = () => (path ? path.split('/').pop() : 'Untitled.md');
  const title = () => app.window.setTitle(`${dirty ? '• ' : ''}${name()} — Markdown Studio`);
  function update() {
    view.innerHTML = render(src.value);
    const words = (src.value.match(/[\p{L}\p{N}’'-]+/gu) || []).length;
    mount(status, h('span', `${words} words`), h('span', `${src.value.length} characters`), h('span', `${Math.max(1, Math.round(words / 230))} min read`), h('span.grow'), h('span', path || 'Not saved yet'));
  }
  function setDoc(p, text) { path = p; src.value = text; dirty = false; update(); title(); }
  function setLayout(v) { layout = v; app.storage.set('layout', v); panes.className = `md-panes${v === 'edit' ? ' edit-only' : v === 'preview' ? ' preview-only' : ''}`; bar.querySelectorAll('[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === { edit: 'Editor', split: 'Both', preview: 'Preview' }[v]))); }
  async function confirmDiscard() { return !dirty || ui.confirm('Discard changes?', `${name()} has unsaved changes.`, { ok: 'Discard', danger: true }); }
  async function openDoc(p) {
    if (typeof p !== 'string') { if (!(await confirmDiscard())) return; p = await ui.openFile({ title: 'Open Markdown', filters: [{ label: 'Markdown', exts: ['.md', '.markdown', '.txt'] }] }); }
    if (!p) return;
    try { setDoc(p, await app.fs.readText(p)); } catch (err) { ui.alert('Couldn’t open the file', err.message); }
  }
  async function saveDoc(as) {
    let p = path;
    if (as || !p) p = await ui.saveFile({ title: 'Save Markdown', suggestedName: name(), filters: [{ label: 'Markdown', exts: ['.md'] }] });
    if (!p) return false;
    try { await app.fs.writeText(p, src.value); path = p; dirty = false; title(); update(); return true; } catch (err) { ui.alert('Couldn’t save', err.message); return false; }
  }
  async function exportHtml() {
    const p = await ui.saveFile({ title: 'Export HTML', suggestedName: name().replace(/\.(md|markdown)$/i, '') + '.html', filters: [{ label: 'Web page', exts: ['.html'] }] });
    if (!p) return;
    await app.fs.writeText(p, `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(name())}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px}pre{background:#f4f4f6;padding:12px;border-radius:6px;overflow:auto}code{font-family:ui-monospace,monospace}blockquote{border-left:4px solid #ccc;margin:0;padding:2px 14px;color:#555}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:5px 10px}</style></head><body>\n${render(src.value)}\n</body></html>\n`);
  }
  src.addEventListener('input', () => { if (!dirty) { dirty = true; title(); } update(); app.storage.set('draft', path ? null : src.value); });
  src.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); src.setRangeText('  ', src.selectionStart, src.selectionEnd, 'end'); update(); } });
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (!(e.ctrlKey || e.metaKey)) return;
    if (k === 's') { e.preventDefault(); saveDoc(e.shiftKey); } else if (k === 'o') { e.preventDefault(); openDoc(); }
  });
  app.window.onBeforeClose(async () => (dirty ? (await ui.confirm('Close without saving?', `${name()} has unsaved changes.`, { ok: 'Close', danger: true })) : true));
  app.onActivate((args) => { if (args.path) confirmDiscard().then((ok) => ok && openDoc(args.path)); });
  setLayout(layout);
  if (app.args.path) await openDoc(app.args.path); else setDoc(null, app.storage.get('draft', null) ?? SAMPLE);
  src.focus();
}
