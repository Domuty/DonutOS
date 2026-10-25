// Writer's format helpers: an allow-list HTML sanitiser, and Markdown import/export.

const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sub', 'sup', 'span', 'font', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'a', 'img', 'hr',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'mark', 'small', 'big']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'title', 'head', 'video', 'audio', 'canvas']);
const ATTRS = { a: ['href', 'title'], img: ['src', 'alt', 'width', 'height', 'title'], font: ['color', 'face', 'size'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], col: ['span'], ol: ['start', 'type'] };
const SAFE_STYLE = /^(color|background-color|font-weight|font-style|font-size|font-family|text-decoration(-line)?|text-align|margin-left|padding-left|vertical-align|border|border-top|page-break-after|width)$/;

/** Returns HTML containing only formatting: no scripts, event handlers or remote code. */
export function sanitizeHtml(html, { stripStyles = false } = {}) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  clean(doc.body, stripStyles);
  return doc.body.innerHTML;
}

function clean(node, stripStyles) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8) { child.remove(); continue; } // comments
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) { child.remove(); continue; }
    clean(child, stripStyles);
    if (!ALLOWED.has(tag)) { child.replaceWith(...child.childNodes); continue; }
    // Editors sometimes put lists or tables inside a paragraph; unwrap so the HTML stays valid.
    if (tag === 'p' && child.querySelector(':scope > ul, :scope > ol, :scope > table, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > pre, :scope > blockquote, :scope > div')) { child.replaceWith(...child.childNodes); continue; }
    const keep = ATTRS[tag] || [];
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      if (name === 'style' && !stripStyles) {
        const safe = attr.value.split(';').map((d) => d.trim()).filter((d) => {
          const [prop, ...v] = d.split(':');
          const val = v.join(':');
          return prop && SAFE_STYLE.test(prop.trim().toLowerCase()) && !/url\(|expression|javascript:/i.test(val);
        }).join('; ');
        if (safe) child.setAttribute('style', safe); else child.removeAttribute('style');
        continue;
      }
      if (!keep.includes(name)) { child.removeAttribute(attr.name); continue; }
      if (name === 'href' && !/^(https?:|mailto:|#)/i.test(attr.value.trim())) child.removeAttribute(attr.name);
      if (name === 'src' && !/^(data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);|https?:|blob:)/i.test(attr.value.trim())) child.removeAttribute(attr.name);
    }
    if (tag === 'a' && child.hasAttribute('href')) child.setAttribute('rel', 'noopener noreferrer');
  }
}

// ── Markdown ───────────────────────────────────────────────────────────

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function inline(md) {
  let s = esc(md);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${src}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${href}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
  s = s.replace(/(^|[^*])\*([^*]+)\*|(^|[^_\w])_([^_]+)_/g, (m, p1, a, p3, b) => (a ? `${p1}<em>${a}</em>` : `${p3}<em>${b}</em>`));
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

export function markdownToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      out.push(`<pre>${esc(buf.join('\n'))}</pre>`);
      continue;
    }
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) { const lvl = Math.min(4, hm[1].length); out.push(`<h${lvl}>${inline(hm[2])}</h${lvl}>`); i++; continue; }
    if (/^(\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s*_)[\s*_-]*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) buf.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdownToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((it) => `<li>${inline(it.replace(/^\[( |x)\]\s*/i, (m, x) => (x.trim() ? '☑ ' : '☐ ')))}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-+/.test(lines[i + 1] || '')) {
      const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = row(line);
      i += 2;
      const body = [];
      for (; i < lines.length && /^\|.*\|\s*$/.test(lines[i]); i++) body.push(row(lines[i]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]); i++) buf.push(lines[i]);
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
  }
  return sanitizeHtml(out.join('\n'));
}

export function htmlToMarkdown(root) {
  const walk = (node, ctx = {}) => {
    if (node.nodeType === 3) return ctx.pre ? node.nodeValue : node.nodeValue.replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    const kids = (c = ctx) => [...node.childNodes].map((n) => walk(n, c)).join('');
    const st = node.getAttribute('style') || '';
    switch (tag) {
      case 'h1': return `\n# ${kids().trim()}\n\n`;
      case 'h2': return `\n## ${kids().trim()}\n\n`;
      case 'h3': return `\n### ${kids().trim()}\n\n`;
      case 'h4': case 'h5': case 'h6': return `\n#### ${kids().trim()}\n\n`;
      case 'p': case 'div': return `${kids().trim()}\n\n`;
      case 'br': return '  \n';
      case 'hr': return '\n---\n\n';
      case 'b': case 'strong': return `**${kids()}**`;
      case 'i': case 'em': return `*${kids()}*`;
      case 's': case 'strike': case 'del': return `~~${kids()}~~`;
      case 'code': return ctx.pre ? kids() : `\`${kids()}\``;
      case 'pre': return `\n\`\`\`\n${kids({ ...ctx, pre: true }).replace(/\n$/, '')}\n\`\`\`\n\n`;
      case 'blockquote': return `${kids().trim().split('\n').map((l) => `> ${l}`).join('\n')}\n\n`;
      case 'a': return `[${kids()}](${node.getAttribute('href') || ''})`;
      case 'img': return `![${node.getAttribute('alt') || ''}](${node.getAttribute('src') || ''})`;
      case 'ul': case 'ol': {
        let n = 0;
        return `${[...node.children].filter((c) => c.tagName === 'LI').map((li) => `${'  '.repeat(ctx.depth || 0)}${tag === 'ol' ? `${++n}.` : '-'} ${walk(li, { ...ctx, depth: (ctx.depth || 0) + 1 }).trim()}`).join('\n')}\n\n`;
      }
      case 'li': return kids();
      case 'table': {
        const rows = [...node.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => walk(c).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')));
        if (!rows.length) return '';
        const w = Math.max(...rows.map((r) => r.length));
        const line = (r) => `| ${Array.from({ length: w }, (_, j) => r[j] || '').join(' | ')} |`;
        return `\n${line(rows[0])}\n| ${Array(w).fill('---').join(' | ')} |\n${rows.slice(1).map(line).join('\n')}\n\n`;
      }
      case 'span': case 'font':
        if (/font-weight:\s*(bold|[6-9]00)/.test(st)) return `**${kids()}**`;
        if (/font-style:\s*italic/.test(st)) return `*${kids()}*`;
        return kids();
      default: return kids();
    }
  };
  return `${walk(root).replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
