// Mail: email between the accounts on this device (delivered instantly, even to people who
// aren't signed in), with folders, search, flags, replies and forwards, attachments, drafts
// and a signature. Mail to outside addresses is handed to your computer's email app, and
// messages can be imported from and exported to .eml files.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { showMenu } from '../../ui/menu.js';
import { dialog, confirmDialog, alertDialog } from '../../ui/dialog.js';
import { openFileDialog, saveFileDialog } from '../../ui/file-dialog.js';
import { avatar } from '../../ui/avatar.js';
import { formatBytes } from '../../core/util.js';
import { sanitizeHtml } from '../writer/convert.js';
import { escapeHtml } from '../common/print.js';
import { parseEml, buildEml, htmlToText, bytesToB64 } from './eml.js';
import * as P from '../../core/path.js';

const FOLDERS = [['inbox', 'Inbox', 'download'], ['drafts', 'Drafts', 'edit'], ['sent', 'Sent', 'arrowRight'], ['archive', 'Archive', 'folder'], ['deleted', 'Deleted', 'trash']];

export default function main(ctx) {
  const k = ctx.privileged;
  const me = ctx.accounts.current();
  const uid = me.id;
  const mail = k.mail;
  const store = ctx.storage;
  const myAddress = mail.addressOf(me);
  const win = ctx.windows.create({ title: 'Mail', width: 1160, height: 740, minWidth: 560, minHeight: 400 });
  win.body.classList.add('mailapp');

  let folder = 'inbox';
  let selectedId = null;
  let query = '';
  let messages = [];
  let counts = {};

  const nav = h('nav.ml-nav');
  const listEl = h('section.ml-list');
  const reader = h('section.ml-reader');
  mount(win.body, nav, listEl, reader);

  async function refresh() {
    messages = await mail.list(uid, folder);
    const all = await mail.list(uid);
    // Inbox shows unread mail; Drafts shows how many are waiting.
    counts = { inbox: all.filter((m) => m.folder === 'inbox' && !m.read).length, drafts: all.filter((m) => m.folder === 'drafts').length };
    renderNav();
    renderList();
    if (selectedId && !messages.some((m) => m.id === selectedId)) selectedId = null;
    renderReader();
  }

  function renderNav() {
    mount(nav,
      h('button.btn.primary.ml-new', { type: 'button', onclick: () => compose() }, icon('plus', { size: 16 }), 'New mail'),
      h('div.ml-me', avatar(me, 32), h('span', h('b', me.name), h('small', myAddress))),
      FOLDERS.map(([id, label, ic]) => h('button.ml-folder', { type: 'button', 'aria-current': folder === id ? 'page' : undefined, onclick: () => { folder = id; selectedId = null; refresh(); },
        ondragover: (e) => { if (e.dataTransfer.types.includes('application/x-donut-mail')) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
        ondragleave: (e) => e.currentTarget.classList.remove('drop'),
        ondrop: async (e) => { e.currentTarget.classList.remove('drop'); const mid = e.dataTransfer.getData('application/x-donut-mail'); if (mid && id !== 'drafts') { await mail.update(uid, mid, { folder: id }); refresh(); } } },
      icon(ic, { size: 16 }), h('span', label), counts[id] ? h('b.ml-count', String(counts[id])) : null)),
      h('div.mp-grow'),
      h('button.ml-folder', { type: 'button', onclick: importEml }, icon('upload', { size: 16 }), h('span', 'Import .eml files')),
      h('button.ml-folder', { type: 'button', onclick: settingsDialog }, icon('settings', { size: 16 }), h('span', 'Settings')));
  }

  const nameOf = (m) => (folder === 'sent' || folder === 'drafts' ? (m.to || []).map((a) => mail.resolve(a)?.name || a).join(', ') || '(No recipients)' : m.from?.name || m.from?.address || 'Unknown');
  const preview = (m) => (m.text || htmlToText(m.html)).replace(/\s+/g, ' ').slice(0, 120);
  const when = (t) => { const d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.getFullYear() === now.getFullYear() ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : d.toLocaleDateString(); };

  function renderList() {
    const search = h('input.input', { type: 'search', placeholder: 'Search mail', value: query, 'aria-label': 'Search mail', oninput: (e) => { query = e.target.value.trim().toLowerCase(); paint(); } });
    const items = h('div.ml-items', { role: 'listbox', 'aria-label': 'Messages', tabindex: '0', onkeydown: (e) => {
      const shown = filtered();
      const i = shown.findIndex((m) => m.id === selectedId);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) select(n.id); }
      else if (e.key === 'Delete' && selectedId) del(selectedId);
      else if (e.key === 'Enter' && selectedId && folder === 'drafts') compose({ draft: messages.find((m) => m.id === selectedId) });
    } });
    const filtered = () => messages.filter((m) => !query || `${m.subject} ${m.from?.name} ${m.from?.address} ${(m.to || []).join(' ')} ${m.text || htmlToText(m.html)}`.toLowerCase().includes(query));
    const paint = () => {
      const shown = filtered();
      // A list box only while there are messages to choose from.
      items.setAttribute('role', shown.length ? 'listbox' : 'group');
      mount(items, shown.length ? shown.map((m) => h('div.ml-item', { role: 'option', 'aria-selected': String(m.id === selectedId), class: [!m.read && 'unread', m.flagged && 'flagged'], draggable: 'true',
        onclick: () => (folder === 'drafts' ? compose({ draft: m }) : select(m.id)),
        ondragstart: (e) => e.dataTransfer.setData('application/x-donut-mail', m.id),
        oncontextmenu: (e) => { e.preventDefault(); itemMenu(m, e); } },
      h('div.ml-item-top', h('b', nameOf(m)), h('small', when(m.date))),
      h('div.ml-item-subj', m.flagged ? h('span.ml-flag', '⚑') : null, m.attachments?.length ? h('span', '📎︎ ') : null, m.subject || '(No subject)'),
      h('div.ml-item-prev', preview(m))))
        : h('div.ph-empty', icon('file', { size: 36 }), h('b', query ? 'No messages match' : `Nothing in ${FOLDERS.find((f) => f[0] === folder)[1]}`), folder === 'inbox' && !query ? h('p', `Your address is ${myAddress}. People with accounts on this device can mail you here.`) : null));
    };
    mount(listEl, h('header.ml-listhead', h('h2', FOLDERS.find((f) => f[0] === folder)[1]),
      folder === 'deleted' && messages.length ? h('button.btn.subtle', { type: 'button', onclick: async () => { if (await confirmDialog('Empty Deleted?', 'Messages in Deleted are removed for good.', { ok: 'Empty', danger: true, parent: win.body })) { await mail.emptyDeleted(uid); refresh(); } } }, 'Empty') : null), h('div.ml-search', search), items);
    paint();
  }

  function itemMenu(m, e) {
    showMenu([
      { label: m.read ? 'Mark as unread' : 'Mark as read', onSelect: () => mail.update(uid, m.id, { read: !m.read }).then(refresh) },
      { label: m.flagged ? 'Remove flag' : 'Flag', onSelect: () => mail.update(uid, m.id, { flagged: !m.flagged }).then(refresh) },
      ...(m.folder !== 'archive' && m.folder !== 'drafts' ? [{ label: 'Archive', icon: 'folder', onSelect: () => mail.update(uid, m.id, { folder: 'archive' }).then(refresh) }] : []),
      ...(m.folder === 'deleted' || m.folder === 'archive' ? [{ label: 'Move to Inbox', onSelect: () => mail.update(uid, m.id, { folder: m.fromFolder === 'sent' ? 'sent' : 'inbox' }).then(refresh) }] : []),
      { label: 'Save as .eml…', icon: 'download', onSelect: () => exportEml(m) },
      { separator: true },
      { label: m.folder === 'deleted' ? 'Delete for good' : 'Delete', icon: 'trash', danger: true, onSelect: () => del(m.id) },
    ], { x: e.clientX, y: e.clientY });
  }

  async function select(id) {
    selectedId = id;
    const m = messages.find((x) => x.id === id);
    if (m && !m.read) { await mail.update(uid, id, { read: true }); m.read = true; refresh(); return; }
    renderList();
    renderReader();
  }
  async function del(id) {
    const m = messages.find((x) => x.id === id);
    if (m?.folder === 'deleted' && !(await confirmDialog('Delete for good?', 'This message can’t be recovered.', { ok: 'Delete', danger: true, parent: win.body }))) return;
    await mail.remove(uid, id);
    if (selectedId === id) selectedId = null;
    refresh();
  }

  function renderReader() {
    const m = messages.find((x) => x.id === selectedId);
    if (!m) { mount(reader, h('div.ph-empty', icon('file', { size: 40 }), h('b', 'Select a message to read it'))); return; }
    const frame = h('iframe.ml-body', { sandbox: 'allow-popups allow-popups-to-escape-sandbox', title: 'Message', referrerpolicy: 'no-referrer' });
    const css = `body{font:14px/1.55 system-ui,sans-serif;margin:16px 4px;color:${getComputedStyle(win.body).color};overflow-wrap:anywhere}a{color:#5b7cf0}img{max-width:100%}blockquote{border-left:3px solid #8884;margin:8px 0;padding-left:12px;color:inherit;opacity:.8}pre{white-space:pre-wrap}`;
    // Messages render in a sandboxed frame with no scripts; remote images are blocked unless asked.
    const showImages = store.get('remoteImages', false) || m.from?.address?.endsWith(`@${mail.domain()}`);
    let html = m.html ? sanitizeHtml(m.html) : `<pre>${escapeHtml(m.text || '')}</pre>`;
    let blocked = false;
    if (!showImages) html = html.replace(/<img\b([^>]*?)src="(https?:[^"]+)"/gi, (_, a) => { blocked = true; return `<img${a}data-blocked="1" alt="[image]"`; });
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${showImages ? 'https: http:' : ''}; style-src 'unsafe-inline'"><style>${css}</style>${html}`;
    const fromLocal = m.from && mail.resolve(m.from.address);
    mount(reader,
      h('div.ml-actions',
        h('button.btn.subtle', { type: 'button', onclick: () => compose({ reply: m }) }, icon('arrowLeft', { size: 14 }), 'Reply'),
        h('button.btn.subtle', { type: 'button', onclick: () => compose({ reply: m, all: true }) }, icon('users', { size: 14 }), 'Reply all'),
        h('button.btn.subtle', { type: 'button', onclick: () => compose({ forward: m }) }, icon('arrowRight', { size: 14 }), 'Forward'),
        h('div.mp-grow'),
        m.folder !== 'archive' ? h('button.tb-btn', { type: 'button', 'aria-label': 'Archive', title: 'Archive', onclick: () => mail.update(uid, m.id, { folder: 'archive' }).then(refresh) }, icon('folder', { size: 16 })) : null,
        h('button.tb-btn', { type: 'button', 'aria-label': m.flagged ? 'Remove flag' : 'Flag', title: 'Flag', onclick: () => mail.update(uid, m.id, { flagged: !m.flagged }).then(refresh) }, h('span', m.flagged ? '⚑' : '⚐')),
        h('button.tb-btn', { type: 'button', 'aria-label': 'Delete (Del)', title: 'Delete', onclick: () => del(m.id) }, icon('trash', { size: 16 })),
        h('button.tb-btn', { type: 'button', 'aria-label': 'More', onclick: (e) => itemMenu(m, e) }, '⋯')),
      h('h1.ml-subject', m.subject || '(No subject)'),
      h('div.ml-from', fromLocal ? avatar(k.accounts.get(fromLocal.uid) || { name: m.from.name }, 36) : h('span.ml-initial', (m.from?.name || m.from?.address || '?')[0].toUpperCase()),
        h('div', h('b', m.from?.name || m.from?.address), h('small', `${m.from?.address || ''}`), h('small', `To: ${(m.to || []).join(', ')}${m.cc?.length ? `  ·  Cc: ${m.cc.join(', ')}` : ''}`)),
        h('small.ml-date', new Date(m.date).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }))),
      m.external?.length ? h('div.ml-note', icon('info', { size: 14 }), `Handed to your email app for ${m.external.join(', ')}.`) : null,
      blocked ? h('div.ml-note', icon('shield', { size: 14 }), 'Pictures from the internet were blocked to protect your privacy.', h('button.btn.subtle', { type: 'button', onclick: () => { store.set('remoteImages', true); renderReader(); } }, 'Always show')) : null,
      m.attachments?.length ? h('div.ml-attach', m.attachments.map((a) => h('button.ml-file', { type: 'button', title: 'Save to Downloads', onclick: () => saveAttachment(a) }, icon('file', { size: 16 }), h('span', a.name), h('small', formatBytes(a.size))))) : null,
      frame);
  }

  async function saveAttachment(a) {
    const dir = P.join(me.home, 'Downloads');
    const path = P.join(dir, await ctx.fs.uniqueName(dir, a.name.replace(/[\\/:*?"<>|]/g, '_')));
    const bin = atob(a.data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await ctx.fs.writeFile(path, bytes);
    const choice = await dialog({ title: 'Saved to Downloads', parent: win.body, body: h('p', P.basename(path)), cancelValue: null, buttons: [{ label: 'Open', value: 'open', primary: true }, { label: 'Show in folder', value: 'folder' }, { label: 'Close', value: null }] });
    if (choice === 'open') ctx.open(path).catch((err) => alertDialog('Can’t open', err.message, { parent: win.body }));
    if (choice === 'folder') ctx.launch('explorer', { path: dir });
  }

  // ── Compose ──────────────────────────────────────────────────────────
  async function compose({ reply, all = false, forward, draft } = {}) {
    const sig = store.get('signature', `${me.name}`);
    let to = [], cc = [], subject = '', body = '';
    let attachments = [];
    const quote = (m) => `<p><br></p><p><br></p><hr><p><b>From:</b> ${escapeHtml(m.from?.name || '')} &lt;${escapeHtml(m.from?.address || '')}&gt;<br><b>Sent:</b> ${escapeHtml(new Date(m.date).toLocaleString())}<br><b>Subject:</b> ${escapeHtml(m.subject || '')}</p><blockquote>${m.html ? sanitizeHtml(m.html) : escapeHtml(m.text || '').replace(/\n/g, '<br>')}</blockquote>`;
    const sigHtml = sig ? `<p><br></p><p>${escapeHtml(sig).replace(/\n/g, '<br>')}</p>` : '';
    if (draft) { to = draft.to || []; cc = draft.cc || []; subject = draft.subject || ''; body = draft.html || ''; attachments = draft.attachments || []; }
    else if (reply) {
      to = [reply.folder === 'sent' ? (reply.to || [])[0] : reply.from?.address].filter(Boolean);
      if (all) cc = [...(reply.to || []), ...(reply.cc || [])].filter((a) => a && a.toLowerCase() !== myAddress && !to.includes(a));
      subject = /^re:/i.test(reply.subject) ? reply.subject : `Re: ${reply.subject || ''}`;
      body = sigHtml + quote(reply);
    } else if (forward) {
      subject = /^fw(d)?:/i.test(forward.subject) ? forward.subject : `Fw: ${forward.subject || ''}`;
      body = sigHtml + quote(forward);
      attachments = [...(forward.attachments || [])];
    } else body = sigHtml;

    const dir = mail.directory();
    const toIn = h('input.input', { value: to.join(', '), 'aria-label': 'To', list: 'ml-dir', placeholder: 'Names or addresses, separated by commas' });
    const ccIn = h('input.input', { value: cc.join(', '), 'aria-label': 'Cc', list: 'ml-dir' });
    const dl = h('datalist#ml-dir', dir.map((d) => h('option', { value: d.address }, d.name)));
    const subj = h('input.input', { value: subject, 'aria-label': 'Subject', placeholder: 'Subject' });
    const editor = h('div.ml-editor', { contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Message' });
    editor.innerHTML = body;
    const attachEl = h('div.ml-attach');
    const paintAttach = () => mount(attachEl, attachments.map((a, i) => h('span.ml-file', icon('file', { size: 14 }), h('span', a.name), h('small', formatBytes(a.size)), h('button.tb-btn', { type: 'button', 'aria-label': `Remove ${a.name}`, onclick: () => { attachments.splice(i, 1); paintAttach(); } }, icon('close', { size: 10 })))));
    paintAttach();
    const fmt = (cmd, label, glyph) => h('button.tb-btn', { type: 'button', title: label, 'aria-label': label, onmousedown: (e) => e.preventDefault(), onclick: () => document.execCommand(cmd) }, h('b.wr-glyph', glyph));
    const err = h('div.error-text');
    const split = (s) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean).map((x) => dir.find((d) => d.name.toLowerCase() === x.toLowerCase())?.address || x);
    const gather = () => ({ to: split(toIn.value), cc: split(ccIn.value), subject: subj.value.trim(), html: sanitizeHtml(editor.innerHTML), text: htmlToText(editor.innerHTML), attachments });
    let draftId = draft?.id || null;
    const choice = await dialog({
      title: draft ? 'Draft' : reply ? 'Reply' : forward ? 'Forward' : 'New message', width: 760, parent: win.body, cancelValue: 'close', dismissible: false,
      body: h('div.ml-compose', dl,
        h('label.ml-field', h('span', 'To'), toIn), h('label.ml-field', h('span', 'Cc'), ccIn), h('label.ml-field', h('span', 'Subject'), subj),
        h('div.ml-fmt', fmt('bold', 'Bold', 'B'), fmt('italic', 'Italic', 'I'), fmt('underline', 'Underline', 'U'), fmt('insertUnorderedList', 'Bullets', '•'), fmt('insertOrderedList', 'Numbering', '1.'),
          h('div.mp-grow'),
          h('button.btn.subtle', { type: 'button', onclick: async () => {
            const paths = await openFileDialog(ctx, win, { title: 'Attach files', multiple: true });
            for (const p of paths || []) {
              const st = await ctx.fs.stat(p);
              if (attachments.reduce((n, a) => n + a.size, 0) + st.size > 15 * 1024 * 1024) { err.textContent = 'Attachments can be up to 15 MB in total.'; break; }
              attachments.push({ name: st.name, type: st.mime, size: st.size, data: bytesToB64(await ctx.fs.readFile(p)) });
            }
            paintAttach();
          } }, icon('file', { size: 14 }), 'Attach')),
        attachEl, editor, err),
      buttons: [{ label: 'Send', value: 'send', primary: true, validate: async () => {
        const msg = gather();
        if (!msg.to.length && !msg.cc.length) { err.textContent = 'Add at least one recipient.'; return false; }
        try {
          const res = await mail.send(uid, { ...msg, draftId });
          if (res.external.length) await handOff(msg, res.external);
          return true;
        } catch (e) { err.textContent = e.message; return false; }
      } }, { label: 'Save draft', value: 'draft' }, { label: 'Discard', value: 'discard' }],
      onOpen: () => setTimeout(() => {
        if (!to.length) { toIn.focus(); return; }
        // Start typing above the signature / quoted message.
        editor.focus();
        const r = document.createRange(); r.setStart(editor, 0); r.collapse(true);
        getSelection().removeAllRanges(); getSelection().addRange(r);
      }),
    });
    if (choice === 'draft' || (choice === 'close' && (editor.textContent.trim() || subj.value.trim()))) { const d = await mail.saveDraft(uid, { ...gather(), id: draftId, from: { name: me.name, address: myAddress } }); draftId = d.id; }
    else if (choice === 'discard' && draftId) await mail.remove(uid, draftId);
    refresh();
  }

  // Outside addresses: open the computer's email app with the message filled in.
  async function handOff(msg, external) {
    const body = msg.text + (msg.attachments.length ? `\n\n[${msg.attachments.length} attachment(s) were not included — attach them in your email app.]` : '');
    const url = `mailto:${external.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
    await dialog({ title: 'Send with your email app', parent: win.body, body: h('p', `DonutOS delivers mail between accounts on this device. To reach ${external.join(', ')}, your computer’s email app will open with this message ready to send.`),
      buttons: [{ label: 'Open email app', value: true, primary: true }] });
    ctx.host.openExternal(url).catch(() => {});
  }

  // ── Import / export / settings ───────────────────────────────────────
  async function importEml() {
    const paths = await openFileDialog(ctx, win, { title: 'Import messages', multiple: true, filters: [{ label: 'Email messages', exts: ['.eml'] }] });
    if (!paths?.length) return;
    const msgs = [];
    for (const p of paths) { try { msgs.push(parseEml(await ctx.fs.readFile(p))); } catch (e) { alertDialog(`Couldn’t read ${P.basename(p)}`, e.message, { parent: win.body }); } }
    if (msgs.length) { await mail.addMessages(uid, msgs, 'inbox'); folder = 'inbox'; refresh(); }
  }
  async function exportEml(m) {
    const name = `${(m.subject || 'message').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.eml`;
    const path = await saveFileDialog(ctx, win, { title: 'Save message', filters: [{ label: 'Email message', exts: ['.eml'] }], suggestedName: name });
    if (path) await ctx.fs.writeText(path, buildEml(m));
  }
  async function settingsDialog() {
    const sig = h('textarea.input.cal-notes', { rows: 4, 'aria-label': 'Signature' }, store.get('signature', me.name));
    const imgs = h('input', { type: 'checkbox', checked: store.get('remoteImages', false) });
    const ok = await dialog({ title: 'Mail settings', parent: win.body, cancelValue: false,
      body: h('div.cal-form', h('p', `Your address: `, h('b', myAddress)), h('label.ck-field', 'Signature', sig), h('label.wr-check', imgs, 'Show pictures from the internet in messages'),
        h('p.hint', 'Mail between accounts on this device is delivered instantly. For outside addresses, Mail opens your computer’s email app — web pages can’t sign in to email servers directly.')),
      buttons: [{ label: 'Save', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    store.set('signature', sig.value);
    store.set('remoteImages', imgs.checked);
  }

  ctx.bus.on('mail:changed', (e) => { if (e.uid === uid) refresh(); });
  ctx.listen(win.body, 'keydown', (e) => {
    if (e.target.matches('input, textarea, [contenteditable]') || win.body.querySelector('.dlg')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const m = messages.find((x) => x.id === selectedId);
    if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); compose(); }
    else if (ctrl && e.key.toLowerCase() === 'r' && m) { e.preventDefault(); compose({ reply: m, all: e.shiftKey }); }
    else if (ctrl && e.key.toLowerCase() === 'f' && m) { e.preventDefault(); compose({ forward: m }); }
    else if (e.key === 'Delete' && m) del(m.id);
  });
  ctx.onActivate((args) => { win.focus(); if (args?.path) importPath(args.path); if (args?.compose) compose(); });
  async function importPath(p) { try { await mail.addMessages(uid, [parseEml(await ctx.fs.readFile(p))], 'inbox'); folder = 'inbox'; refresh(); } catch (e) { alertDialog('Couldn’t read the message', e.message, { parent: win.body }); } }

  refresh();
  if (ctx.args.path) importPath(ctx.args.path);
}
