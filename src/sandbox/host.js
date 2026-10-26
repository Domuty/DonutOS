// Runs a Store (installed) app in a sandboxed frame inside its window.
//
// The frame has an opaque origin and a strict Content-Security-Policy: no network, no access
// to DonutOS's page, cookies or databases. The SDK inside (src/sdk/donut-sdk.js) sends calls
// here; each one goes through the app's own ctx, so the permission system decides exactly as
// it does for built-in apps.

import { h } from '../ui/h.js';
import { showMenu, closeMenu } from '../ui/menu.js';
import { alertDialog, confirmDialog, promptDialog } from '../ui/dialog.js';
import { openFileDialog, saveFileDialog } from '../ui/file-dialog.js';
import { PERMISSIONS } from '../core/permissions.js';
import { a11yChannel } from '../shell/a11y/channel.js';

const TOKENS = ['--bg', '--surface', '--surface-2', '--surface-3', '--surface-raised', '--surface-solid', '--text', '--text-2', '--text-3', '--border', '--border-strong',
  '--hover', '--press', '--input-bg', '--input-border', '--accent', '--accent-hover', '--accent-soft', '--accent-text', '--accent-contrast', '--ok', '--warn', '--danger',
  '--radius', '--radius-s', '--radius-l', '--shadow', '--shadow-s', '--font', '--font-display', '--font-mono', '--ease-out', '--ease-in', '--dur',
  '--hc-button-text', '--hc-button-bg', '--danger-fill',
  '--cur-default', '--cur-pointer', '--cur-text', '--cur-move', '--cur-crosshair', '--cur-ns', '--cur-ew', '--cur-nwse', '--cur-nesw', '--cur-grab', '--cur-grabbing', '--cur-cell'];

let sdkCache = null;
async function sdkAssets() {
  const text = (path) => fetch(new URL(path, import.meta.url)).then((r) => r.text());
  // The SDK, its styles, and two DonutOS modules it uses for Narrator and the on-screen keyboard.
  sdkCache ||= Promise.all([text('../sdk/donut-sdk.js'), text('../sdk/sdk.css'), text('../ui/a11y-name.js'), text('../shell/a11y/edit-actions.js')]);
  return sdkCache;
}

const b64 = (text) => { const b = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

export function themeSnapshot() {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  return {
    mode: root.dataset.theme === 'light' ? 'light' : 'dark',
    contrast: root.dataset.contrast || null, focusRing: root.dataset.focusRing || 'normal', scrollbars: root.dataset.scrollbars || 'auto', cursor: root.dataset.cursor || null,
    tokens: Object.fromEntries(TOKENS.map((t) => [t, cs.getPropertyValue(t).trim()]).filter(([, v]) => v)),
  };
}

export function sandboxModule(app) {
  return { default: (ctx) => runSandboxed(app, ctx) };
}

async function runSandboxed(app, ctx) {
  const win = ctx.windows.create({ title: app.name, ...(app.window || {}) });
  win.body.classList.add('sandboxed-app');
  const [sdk, sdkCss, a11yName, editActions] = await sdkAssets();
  const frame = h('iframe.sandbox-frame', { sandbox: 'allow-scripts allow-forms allow-pointer-lock', title: app.name, allow: 'clipboard-write; autoplay; fullscreen' });
  const csp = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; media-src data: blob:; font-src data:; connect-src data: blob:; worker-src blob: data:";
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  frame.srcdoc = `<!doctype html><html lang="${esc(document.documentElement.lang || navigator.language || 'en')}"><head><meta charset="utf-8"><title>${esc(app.name)}</title><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${sdkCss}</style>
<script type="importmap">${JSON.stringify({ imports: {
    '@donut/sdk': `data:text/javascript;base64,${b64(sdk)}`,
    '@donut/a11y-name': `data:text/javascript;base64,${b64(a11yName)}`,
    '@donut/edit-actions': `data:text/javascript;base64,${b64(editActions)}`,
  } })}</script>
<script type="module">import '@donut/sdk';</script></head><body><main id="app" aria-label="${esc(app.name)}"></main></body></html>`;
  win.body.append(frame);

  const me = ctx.accounts.current();
  const storagePrefix = () => ctx.storage.keys();
  let started = false;
  const post = (msg) => frame.contentWindow?.postMessage(msg, '*');
  const event = (name, data) => post({ type: 'event', name, data });

  // ── Calls from the app ───────────────────────────────────────────────
  const fsMethods = ['readText', 'readFile', 'readJSON', 'writeText', 'writeFile', 'writeJSON', 'appendText', 'readdir', 'stat', 'exists', 'mkdir', 'remove', 'trash', 'rename', 'move', 'copy'];
  const plain = (e) => (e && typeof e === 'object' ? { name: e.name, path: e.path, type: e.type, size: e.size, mtime: e.mtime, ctime: e.ctime, ext: e.ext, mime: e.mime, kind: e.kind } : e);
  const frameOffset = () => frame.getBoundingClientRect();
  // [{ label, exts: ['.md'] }] (also accepts { name, extensions: ['md'] }).
  const filters = (list) => (Array.isArray(list) && list.length ? list.slice(0, 20).map((f) => ({
    label: String(f?.label ?? f?.name ?? 'Files').slice(0, 60),
    exts: [...(f?.exts ?? f?.extensions ?? ['*'])].map((x) => (x === '*' ? '*' : `.${String(x).replace(/^\.+/, '').toLowerCase()}`)),
  })) : undefined);
  const methods = {
    'window.setTitle': (t) => win.setTitle(String(t).slice(0, 200)),
    'window.setSize': (w, hh) => win.setBounds({ w: Number(w) || undefined, h: Number(hh) || undefined }),
    'window.minimize': () => win.minimize(),
    'window.maximize': () => win.maximize(),
    'window.restore': () => win.restore(),
    'window.close': () => win.close(),
    'window.focus': () => win.focus(),
    'storage.set': (k, v) => ctx.storage.set(String(k), v),
    'storage.remove': (k) => ctx.storage.remove(String(k)),
    'net.fetch': async (url, opts = {}) => {
      const res = await ctx.net.fetch(url, { method: opts.method || 'GET', headers: opts.headers, body: opts.body, credentials: 'omit', redirect: 'follow' });
      return { status: res.status, statusText: res.statusText, headers: [...res.headers], body: await res.arrayBuffer(), url: res.url };
    },
    'net.online': () => ctx.net.online(),
    notify: (o = {}) => ctx.notify({ title: String(o.title || app.name), body: String(o.body || ''), actions: (o.actions || []).slice(0, 3), data: o.data ?? null }).then((n) => !!n),
    'clipboard.writeText': (t) => ctx.clipboard.writeText(t),
    'clipboard.readText': () => ctx.clipboard.readText(),
    'location.get': async () => {
      if (!(await ctx.permissions.request('location'))) throw Object.assign(new Error('Location access was not allowed'), { code: 'EPERM' });
      return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
        (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
        (err) => reject(Object.assign(new Error(err.message || 'Location unavailable'), { code: 'ELOCATION' })), { timeout: 15000 }));
    },
    launch: (id, args) => ctx.launch(String(id), args).then(() => true),
    open: (p) => ctx.open(String(p)).then(() => true),
    openExternal: async (url) => { if (!(await ctx.permissions.request('network'))) throw Object.assign(new Error('Internet access was not allowed'), { code: 'EPERM' }); return ctx.host.openExternal(url); },
    exportFile: (name, data, mime) => ctx.host.exportFile(String(name), data, mime),
    'permissions.request': (p) => ctx.permissions.request(p),
    'permissions.status': (p) => ctx.permissions.status(p),
    'ui.alert': (t, m) => alertDialog(String(t), String(m ?? ''), { parent: win.body }).then(() => true),
    'ui.confirm': (t, m, o = {}) => confirmDialog(String(t), String(m ?? ''), { ok: o.ok, cancel: o.cancel, danger: !!o.danger, parent: win.body }),
    'ui.prompt': (t, o = {}) => promptDialog(String(t), { label: o.label, value: o.value, placeholder: o.placeholder, ok: o.ok, parent: win.body }),
    'ui.openFile': (o = {}) => openFileDialog(ctx, win, { title: o.title, filters: filters(o.filters), multiple: !!o.multiple }),
    'ui.saveFile': (o = {}) => saveFileDialog(ctx, win, { title: o.title, filters: filters(o.filters), suggestedName: o.suggestedName }),
    'ui.menu': (items, at = {}) => new Promise((resolve) => {
      const r = frameOffset();
      let chosen = null;
      const close = showMenu((items || []).slice(0, 60).map((it) => (it.separator ? { separator: true } : it.header ? { header: String(it.header) } : {
        label: String(it.label), checked: it.checked, disabled: !!it.disabled, danger: !!it.danger, hint: it.hint, onSelect: () => { chosen = it.id ?? it.label; },
      })), { x: r.left + (Number(at.x) || 0), y: r.top + (Number(at.y) || 0) });
      // Resolve when the menu goes away (chosen item or dismissed).
      const watch = new MutationObserver(() => { if (!document.querySelector('.menu')) { watch.disconnect(); setTimeout(() => resolve(chosen)); } });
      watch.observe(document.body, { childList: true });
      void close;
    }),
    exit: () => ctx.exit(),
  };
  for (const m of fsMethods) methods[`fs.${m}`] = async (...args) => { const v = await ctx.fs[m](...args); return Array.isArray(v) ? v.map(plain) : m === 'stat' ? plain(v) : v; };

  // ── Messages ─────────────────────────────────────────────────────────
  const closeWaits = new Map();
  ctx.listen(window, 'message', async (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'ready') {
      post({ type: 'init', app: publicManifest(app), args: ctx.args, source: b64(app.source), storage: Object.fromEntries(storagePrefix().map((k) => [k, ctx.storage.get(k)])),
        user: { name: me?.name || 'User', home: me?.home || '/Users/Public' }, theme: themeSnapshot(), a11y: a11yState() });
    } else if (m.type === 'call') {
      const fn = Object.hasOwn(methods, m.method) ? methods[m.method] : null;
      try {
        if (!fn) throw Object.assign(new Error(`Unknown SDK call ${m.method}`), { code: 'EINVAL' });
        const value = await fn(...(Array.isArray(m.args) ? m.args : []));
        post({ type: 'result', id: m.id, ok: true, value: value === undefined ? null : value });
      } catch (err) {
        post({ type: 'result', id: m.id, ok: false, error: { code: err.name === 'PermissionError' ? 'EPERM' : err.code || 'EIO', message: err.message || String(err) } });
      }
    } else if (m.type === 'key') {
      // System shortcuts pressed inside the app go to the shell.
      document.dispatchEvent(new KeyboardEvent(m.kind === 'keyup' ? 'keyup' : 'keydown', { ...m.event, bubbles: true, cancelable: true }));
    } else if (m.type === 'activity') {
      // A click inside the app: menus close, as they do for clicks anywhere else.
      closeMenu();
      if (!win.active) win.focus();
    } else if (m.type === 'started') {
      started = true;
    } else if (m.type === 'crashed') {
      showCrash(m.message);
    } else if (m.type === 'error') {
      ctx.system.log(`Error in ${app.name}: ${m.message}`);
    } else if (m.type === 'pointer') {
      // Magnifier follows the pointer inside the app too: frame coordinates → screen.
      const r = frame.getBoundingClientRect();
      const k = frame.clientWidth ? r.width / frame.clientWidth : 1;
      a11yChannel.emit('pointer', { x: r.left + Number(m.x) * k, y: r.top + Number(m.y) * k });
    } else if (m.type === 'say') {
      a11yChannel.emit('say', { text: String(m.text || '').slice(0, 1000), interrupt: !!m.interrupt });
    } else if (m.type === 'beforeCloseResult') {
      closeWaits.get(m.id)?.(m.ok);
      closeWaits.delete(m.id);
    }
  });

  function showCrash(message) {
    const box = h('div.sandbox-crash', h('b', `${app.name} stopped working`), h('p', message), h('div.wr-row', h('button.btn.primary', { type: 'button', onclick: () => { ctx.exit(); ctx.launch(app.id, ctx.args); } }, 'Restart'), h('button.btn', { type: 'button', onclick: () => ctx.exit() }, 'Close')));
    win.body.append(box);
  }

  // Ask the app before closing (it can keep the window open to save work).
  let closeSeq = 0;
  win.onBeforeClose(() => {
    if (!started) return true;
    const id = ++closeSeq;
    return new Promise((resolve) => {
      closeWaits.set(id, resolve);
      post({ type: 'beforeClose', id });
      setTimeout(() => { if (closeWaits.has(id)) { closeWaits.delete(id); resolve(true); } }, 3000);
    });
  });
  win.on('resize', (b) => event('resize', { width: b.w, height: b.h }));
  win.on('focus', () => { event('focus', {}); frame.focus(); });
  win.on('blur', () => event('blur', {}));
  ctx.onActivate((args) => { win.focus(); event('activate', args || {}); });
  ctx.onNotification((n) => event('notification', { actionId: n.actionId, data: n.data }));
  ctx.own(ctx.settings.watch('appearance.*', () => setTimeout(() => event('theme', themeSnapshot()), 50)));
  // Accessibility: theme-like changes (contrast, pointer, focus indicator), and whether
  // Magnifier and Narrator need the app's pointer moves and focus changes.
  const a11yState = () => ({ pointer: !!ctx.settings.get('a11y.magnifier'), narrator: !!ctx.settings.get('a11y.narrator'), echo: ctx.settings.get('a11y.narratorKeyEcho') });
  ctx.own(ctx.settings.watch('a11y.*', () => setTimeout(() => { event('theme', themeSnapshot()); post({ type: 'a11y', ...a11yState() }); }, 50)));
  ctx.own(a11yChannel.on('key', ({ frame: f, key, code, mods }) => { if (f === frame) post({ type: 'oskKey', key, code, mods }); }));
}

function publicManifest(app) {
  const { source, module, entry, ...rest } = app;
  void source; void module; void entry;
  return { ...rest, permissions: [...(app.permissions || [])], permissionInfo: (app.permissions || []).map((p) => ({ id: p, ...PERMISSIONS[p] })) };
}
