// Reads and writes .eml files (RFC 5322 messages with MIME parts), so mail can be imported
// from and exported to any other email program.

const dec = new TextDecoder();

function b64ToBytes(s) { const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
export function bytesToB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }

function decodeQP(s) {
  const bytes = [];
  const str = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '=' && /^[0-9A-F]{2}$/i.test(str.slice(i + 1, i + 3))) { bytes.push(parseInt(str.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(str.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(bytes);
}

function charsetDecode(bytes, charset = 'utf-8') { try { return new TextDecoder(charset.toLowerCase()).decode(bytes); } catch { return dec.decode(bytes); } }

/** =?utf-8?B?…?= and =?iso-8859-1?Q?…?= words in headers. */
function decodeWords(s) {
  return s.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=(\s+(?==\?))?/gi, (_, cs, enc, text) =>
    charsetDecode(enc.toUpperCase() === 'B' ? b64ToBytes(text) : decodeQP(text.replace(/_/g, ' ')), cs));
}

function splitHeaders(raw) {
  const i = raw.search(/\r?\n\r?\n/);
  const head = i < 0 ? raw : raw.slice(0, i);
  const body = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const c = line.indexOf(':');
    if (c > 0) headers[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
  }
  return { headers, body };
}
const param = (h, name) => { const m = new RegExp(`${name}\\*?=(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(h || ''); return m ? decodeURIComponent((m[1] ?? m[2]).replace(/^utf-8''/i, '')) : null; };

function decodeBody(body, headers) {
  const enc = (headers['content-transfer-encoding'] || '').toLowerCase();
  if (enc === 'base64') return b64ToBytes(body);
  if (enc === 'quoted-printable') return decodeQP(body);
  return new Uint8Array([...body].map((c) => c.charCodeAt(0) & 0xff));
}

function walk(part, out) {
  const { headers, body } = splitHeaders(part);
  const type = (headers['content-type'] || 'text/plain').toLowerCase();
  if (type.startsWith('multipart/')) {
    const boundary = param(headers['content-type'], 'boundary');
    if (!boundary) return;
    const pieces = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\s*`));
    for (const p of pieces) if (p.trim()) walk(p, out);
    return;
  }
  const disposition = headers['content-disposition'] || '';
  const filename = param(disposition, 'filename') || param(headers['content-type'], 'name');
  const bytes = decodeBody(body, headers);
  if (filename || /^attachment/i.test(disposition) || !/^text\//.test(type)) {
    out.attachments.push({ name: decodeWords(filename || 'attachment'), type: type.split(';')[0], size: bytes.length, data: bytesToB64(bytes) });
  } else if (type.startsWith('text/html') && !out.html) out.html = charsetDecode(bytes, param(headers['content-type'], 'charset') || 'utf-8');
  else if (type.startsWith('text/plain') && !out.text) out.text = charsetDecode(bytes, param(headers['content-type'], 'charset') || 'utf-8');
}

function parseAddress(s) {
  if (!s) return { name: '', address: '' };
  const d = decodeWords(s);
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>/.exec(d);
  return m ? { name: m[1].trim(), address: m[2].trim() } : { name: '', address: d.trim() };
}
const parseList = (s) => (s ? decodeWords(s).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.trim()).filter(Boolean) : []);

export function parseEml(bytes) {
  // Headers are ASCII; bodies are decoded per part, so read as Latin-1 to keep bytes intact.
  const raw = new TextDecoder('latin1').decode(bytes);
  const out = { html: '', text: '', attachments: [] };
  const { headers } = splitHeaders(raw);
  walk(raw, out);
  const date = Date.parse(headers.date || '');
  return {
    from: parseAddress(headers.from), to: parseList(headers.to), cc: parseList(headers.cc),
    subject: decodeWords(headers.subject || ''), date: Number.isNaN(date) ? Date.now() : date,
    html: out.html, text: out.text || (out.html ? '' : ''), attachments: out.attachments,
  };
}

const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${bytesToB64(new TextEncoder().encode(s))}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');

export function buildEml(m) {
  const boundary = `donut-${Math.random().toString(36).slice(2)}`;
  const alt = `${boundary}-alt`;
  const text = m.text || htmlToText(m.html);
  const lines = [
    `From: ${m.from.name ? `${encWord(m.from.name)} <${m.from.address}>` : m.from.address}`,
    `To: ${(m.to || []).join(', ')}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.join(', ')}`] : []),
    `Subject: ${encWord(m.subject || '')}`,
    `Date: ${new Date(m.date).toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '', `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap76(bytesToB64(new TextEncoder().encode(text))),
    `--${alt}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap76(bytesToB64(new TextEncoder().encode(m.html || ''))),
    `--${alt}--`,
  ];
  for (const a of m.attachments || []) {
    lines.push(`--${boundary}`, `Content-Type: ${a.type || 'application/octet-stream'}; name="${encWord(a.name)}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encWord(a.name)}"`, '', wrap76(a.data));
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

export function htmlToText(html) {
  const d = document.createElement('div');
  d.innerHTML = (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '$&\n');
  return d.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
