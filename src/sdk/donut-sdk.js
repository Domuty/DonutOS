// DonutOS SDK — the runtime inside every Store app.
//
// Store apps run in their own sandboxed frame with no origin of their own: they can't see
// DonutOS's page, its storage or other apps. Everything goes through `app`, which asks
// DonutOS over a message channel, and DonutOS checks the app's permissions each time.
//
//   import { h, mount, css } from '@donut/sdk';
//   export default function main(app) {
//     app.window.setTitle('Hello');
//     mount(app.root, h('h1', 'Hello, ', app.user.name));
//   }
//
// Full reference: docs/SDK.md.

const pending = new Map();
let seq = 0;
const listeners = new Map();

function call(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    parent.postMessage({ type: 'call', id, method, args }, '*');
  });
}
function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}
function emit(name, data) { for (const fn of listeners.get(name) || []) { try { fn(data); } catch (err) { console.error(err); } } }

export class DonutError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = code === 'EPERM' ? 'PermissionError' : 'DonutError'; }
}

// ── DOM helpers (the same h() DonutOS's own apps use) ──────────────────
/** h('div.card#main', { onclick, style: {…}, dataset: {…} }, ...children) */
export function h(tag, props, ...children) {
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { children.unshift(props); props = null; }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) { if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1); }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') for (const c of [v].flat()) { if (c) el.classList.add(...String(c).split(' ').filter(Boolean)); }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}
function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
/** Replaces an element's children. */
export function mount(el, ...children) { el.replaceChildren(); append(el, children); return el; }
/** Adds CSS to the app. Returns the <style> element. */
export function css(text) { const s = document.createElement('style'); s.textContent = text; document.head.append(s); return s; }

// ── The app object ─────────────────────────────────────────────────────
const bytes = (v) => (v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new TextEncoder().encode(String(v)));

function makeApp(init) {
  let store = { ...init.storage };
  const beforeClose = [];
  const app = {
    id: init.app.id,
    name: init.app.name,
    version: init.app.version,
    manifest: init.app,
    args: init.args || {},
    user: init.user,
    /** The element your app draws into (fills the window). */
    root: document.getElementById('app'),

    window: {
      setTitle: (t) => call('window.setTitle', String(t)),
      setSize: (w, hh) => call('window.setSize', w, hh),
      minimize: () => call('window.minimize'),
      maximize: () => call('window.maximize'),
      restore: () => call('window.restore'),
      close: () => call('window.close'),
      focus: () => call('window.focus'),
      /** fn() may return false (or a Promise of false) to keep the window open, e.g. to save first. */
      onBeforeClose: (fn) => { beforeClose.push(fn); },
      onResize: (fn) => on('resize', fn),
      onFocus: (fn) => on('focus', fn),
      onBlur: (fn) => on('blur', fn),
    },

    /** Private storage for your app, per user. get() is instant; values must be JSON. */
    storage: {
      get: (key, fallback = null) => (key in store ? structuredClone(store[key]) : fallback),
      set: (key, value) => { store[key] = structuredClone(value); return call('storage.set', key, value); },
      remove: (key) => { delete store[key]; return call('storage.remove', key); },
      keys: () => Object.keys(store),
    },

    /** Files (needs files.read / files.write; outside your home folder: system.fs). */
    fs: {
      home: () => init.user.home,
      readText: (p) => call('fs.readText', p),
      readFile: (p) => call('fs.readFile', p),
      readJSON: (p, fallback) => call('fs.readJSON', p, fallback),
      writeText: (p, text) => call('fs.writeText', p, String(text)),
      writeFile: (p, data) => call('fs.writeFile', p, bytes(data)),
      writeJSON: (p, v) => call('fs.writeJSON', p, v),
      appendText: (p, text) => call('fs.appendText', p, String(text)),
      readdir: (p, o) => call('fs.readdir', p, o),
      stat: (p) => call('fs.stat', p),
      exists: (p) => call('fs.exists', p),
      mkdir: (p, o) => call('fs.mkdir', p, o),
      remove: (p, o) => call('fs.remove', p, o),
      trash: (p) => call('fs.trash', p),
      rename: (p, name) => call('fs.rename', p, name),
      move: (a, b, o) => call('fs.move', a, b, o),
      copy: (a, b, o) => call('fs.copy', a, b, o),
    },

    net: {
      /** fetch() through DonutOS (needs network; follows Wi-Fi and airplane mode). Returns a Response. */
      async fetch(url, opts = {}) {
        const body = opts.body instanceof Blob ? new Uint8Array(await opts.body.arrayBuffer()) : opts.body;
        const r = await call('net.fetch', String(url), { method: opts.method, headers: opts.headers instanceof Headers ? Object.fromEntries(opts.headers) : opts.headers, body });
        return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
      },
      online: () => call('net.online'),
    },

    /** notify({ title, body, actions: [{ id, label }], data }) — needs notifications. */
    notify: (opts) => call('notify', opts),
    /** fn({ actionId, data }) when the user selects one of your notifications. */
    onNotification: (fn) => on('notification', fn),
    clipboard: {
      writeText: (t) => call('clipboard.writeText', String(t)),
      readText: () => call('clipboard.readText'),
    },
    location: {
      /** Resolves { latitude, longitude, accuracy } — needs location. */
      get: () => call('location.get'),
    },
    launch: (appId, args) => call('launch', appId, args || {}),
    open: (path) => call('open', path),
    openExternal: (url) => call('openExternal', String(url)),
    /** Saves data as a file on the real computer (download / save dialog). */
    exportFile: (name, data, mime) => call('exportFile', name, bytes(data), mime),
    permissions: {
      request: (p) => call('permissions.request', p),
      status: (p) => call('permissions.status', p),
    },
    theme: init.theme,
    onThemeChange: (fn) => on('theme', fn),
    /** fn(args) when your app is launched again while open (single-instance apps). */
    onActivate: (fn) => on('activate', fn),
    exit: () => call('exit'),
  };
  app._beforeClose = beforeClose;
  return app;
}

/** DonutOS-styled dialogs and menus, shown by DonutOS on top of your window. */
export const ui = {
  alert: (title, message) => call('ui.alert', title, message),
  confirm: (title, message, opts) => call('ui.confirm', title, message, opts),
  prompt: (title, opts) => call('ui.prompt', title, opts),
  openFile: (opts) => call('ui.openFile', opts),
  saveFile: (opts) => call('ui.saveFile', opts),
  /** items: [{ id, label, checked?, disabled?, danger? } | { separator: true } | { header }]. Resolves the chosen id or null. */
  menu: (items, at) => {
    const pt = at instanceof Event ? { x: at.clientX, y: at.clientY } : at instanceof Element ? (() => { const r = at.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; })() : at || { x: 20, y: 20 };
    return call('ui.menu', items.map((it) => ({ ...it, onSelect: undefined })), pt);
  },
};

export let app = null;

// ── Boot ────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.tokens)) root.style.setProperty(k, v);
  // Pointer variables only exist when a bigger pointer is chosen; clear them otherwise.
  for (const k of [...root.style].filter((p) => p.startsWith('--cur-'))) if (!(k in theme.tokens)) root.style.removeProperty(k);
  root.dataset.theme = theme.mode;
  root.style.colorScheme = theme.mode;
  for (const [attr, v] of [['contrast', theme.contrast], ['focusRing', theme.focusRing], ['scrollbars', theme.scrollbars], ['cursor', theme.cursor]]) {
    if (v) root.dataset[attr] = v; else delete root.dataset[attr];
  }
}

// ── Accessibility: Narrator, Magnifier and the on-screen keyboard reach into the app ──
let a11y = { pointer: false, narrator: false, echo: 'chars' };
let describe = null;
let editActions = null;
const say = (text, interrupt = true) => { if (text) parent.postMessage({ type: 'say', text, interrupt }, '*'); };
let pointerFrame = 0, lastPointer = null;
addEventListener('pointermove', (e) => {
  if (!a11y.pointer) return;
  lastPointer = { x: e.clientX, y: e.clientY };
  if (!pointerFrame) pointerFrame = requestAnimationFrame(() => { pointerFrame = 0; parent.postMessage({ type: 'pointer', ...lastPointer }, '*'); });
}, { capture: true, passive: true });
addEventListener('focusin', async (e) => {
  if (!a11y.narrator) return;
  describe ||= (await import('@donut/a11y-name')).describe;
  say(describe(e.target));
}, true);
addEventListener('change', async (e) => {
  if (!a11y.narrator || !['checkbox', 'radio', 'select-one'].includes(e.target.type)) return;
  describe ||= (await import('@donut/a11y-name')).describe;
  say(describe(e.target));
}, true);
addEventListener('input', (e) => {
  if (!a11y.narrator || a11y.echo === 'none' || !e.inputType?.startsWith('insert') || e.data == null) return;
  if (a11y.echo === 'chars') say(e.target.type === 'password' ? 'star' : e.data === ' ' ? 'space' : e.data);
}, true);
async function oskKey({ key, code, mods }) {
  editActions ||= await import('@donut/edit-actions');
  const target = document.activeElement || document.body;
  const init = { key, code, ctrlKey: mods.ctrl, altKey: mods.alt, shiftKey: mods.shift, metaKey: mods.meta, bubbles: true, cancelable: true };
  if (target.dispatchEvent(new KeyboardEvent('keydown', init))) await editActions.performKey(target, { key, mods }).catch(() => {});
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}

// Shortcuts that belong to DonutOS (Start, Task View, Alt+Tab…) still work inside the app.
const systemKey = (e) => e.key === 'Meta' || e.metaKey || (e.ctrlKey && e.altKey) || (e.altKey && ['Tab', 'F4', 'Escape'].includes(e.key)) || (e.ctrlKey && e.shiftKey && e.key === 'Escape');
const keyInfo = (e) => ({ key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey, repeat: e.repeat });
addEventListener('keydown', (e) => { if (systemKey(e)) { parent.postMessage({ type: 'key', kind: 'keydown', event: keyInfo(e) }, '*'); if (e.key !== 'Meta' && !e.ctrlKey) e.preventDefault(); } }, true);
addEventListener('keyup', (e) => { if (e.key === 'Meta') parent.postMessage({ type: 'key', kind: 'keyup', event: keyInfo(e) }, '*'); }, true);
addEventListener('pointerdown', () => parent.postMessage({ type: 'activity' }, '*'), true);
addEventListener('focus', () => parent.postMessage({ type: 'activity' }, '*'));

addEventListener('message', async (e) => {
  if (e.source !== parent) return;
  const m = e.data;
  if (m.type === 'result') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.value); else p.reject(new DonutError(m.error.code, m.error.message));
  } else if (m.type === 'event') {
    if (m.name === 'theme') { applyTheme(m.data); if (app) app.theme = m.data; }
    emit(m.name, m.data);
  } else if (m.type === 'beforeClose') {
    let ok = true;
    for (const fn of app?._beforeClose || []) { try { if ((await fn()) === false) { ok = false; break; } } catch { /* a failing handler doesn't block closing */ } }
    parent.postMessage({ type: 'beforeCloseResult', id: m.id, ok }, '*');
  } else if (m.type === 'a11y') {
    a11y = { ...a11y, ...m };
  } else if (m.type === 'oskKey') {
    oskKey(m);
  } else if (m.type === 'init') {
    applyTheme(m.theme);
    if (m.a11y) a11y = { ...a11y, ...m.a11y };
    app = makeApp(m);
    try {
      const mod = await import(`data:text/javascript;base64,${m.source}`);
      const main = mod.default || mod.main;
      if (typeof main !== 'function') throw new Error('The app has no default export main(app)');
      await main(app);
      parent.postMessage({ type: 'started' }, '*');
    } catch (err) {
      console.error(err);
      parent.postMessage({ type: 'crashed', message: err?.message || String(err) }, '*');
    }
  }
});

window.onerror = (msg) => { parent.postMessage({ type: 'error', message: String(msg) }, '*'); };
window.onunhandledrejection = (e) => { parent.postMessage({ type: 'error', message: String(e.reason?.message || e.reason) }, '*'); };
parent.postMessage({ type: 'ready' }, '*');
