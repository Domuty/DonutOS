// Desktop build: an Electron <webview>. It is a separate, sandboxed browser process with its
// own storage partition, so every site loads (frame restrictions don't apply), and DonutOS
// gets titles, favicons, real history, find-in-page, printing and context menus.

import { Emitter } from '../common/web-view.js';

export function createWebviewView({ partition = 'persist:donut-browser', native } = {}) {
  const ev = new Emitter();
  const el = document.createElement('webview');
  el.className = 'web-view';
  el.setAttribute('partition', partition);
  el.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, nodeIntegration=no, javascript=yes');
  el.setAttribute('allowpopups', '');
  el.setAttribute('plugins', ''); // the built-in PDF viewer
  let ready = false;
  const queue = [];
  const whenReady = (fn) => (ready ? fn() : queue.push(fn));
  let zoom = 1;
  let wcId = null;

  el.addEventListener('dom-ready', () => {
    if (!ready) { ready = true; wcId = el.getWebContentsId(); for (const fn of queue.splice(0)) fn(); }
    el.setZoomFactor(zoom);
  });
  el.addEventListener('did-start-loading', () => ev.emit('loading', true));
  el.addEventListener('did-stop-loading', () => ev.emit('loading', false));
  el.addEventListener('did-navigate', (e) => ev.emit('navigate', { url: e.url, inPage: false }));
  el.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) ev.emit('navigate', { url: e.url, inPage: true }); });
  el.addEventListener('page-title-updated', (e) => ev.emit('title', e.title));
  // Pages often only suggest /favicon.ico; check inside the page that it exists before showing it.
  el.addEventListener('page-favicon-updated', async (e) => {
    const url = e.favicons?.[0];
    if (!url) { ev.emit('favicon', null); return; }
    const ok = await el.executeJavaScript(`fetch(${JSON.stringify(url)}, { method: 'HEAD', cache: 'force-cache' }).then((r) => r.ok && /^image\\//.test(r.headers.get('content-type') || 'image/')).catch(() => false)`).catch(() => false);
    ev.emit('favicon', ok ? url : null);
  });
  el.addEventListener('found-in-page', (e) => ev.emit('found', { active: e.result.activeMatchOrdinal, matches: e.result.matches }));
  el.addEventListener('did-fail-load', (e) => { if (e.isMainFrame && e.errorCode !== -3) ev.emit('error', { code: e.errorCode, description: e.errorDescription, url: e.validatedURL }); });
  el.addEventListener('media-started-playing', () => ev.emit('audio', true));
  el.addEventListener('media-paused', () => ev.emit('audio', false));
  const offMenu = native?.on('browser:contextMenu', (p) => {
    if (p.webContentsId !== wcId) return;
    const r = el.getBoundingClientRect();
    ev.emit('contextmenu', { ...p, x: r.left + p.x, y: r.top + p.y });
  });

  return {
    el,
    capabilities: { title: true, find: true, print: true, history: true, contextMenu: true },
    load: (url) => { if (ready) el.loadURL(url).catch(() => {}); else el.setAttribute('src', url); },
    back: () => whenReady(() => el.canGoBack() && el.goBack()),
    forward: () => whenReady(() => el.canGoForward() && el.goForward()),
    reload: () => whenReady(() => el.reload()),
    stop: () => whenReady(() => el.stop()),
    canGoBack: () => ready && el.canGoBack(),
    canGoForward: () => ready && el.canGoForward(),
    url: () => (ready ? el.getURL() : el.getAttribute('src') || ''),
    title: () => (ready ? el.getTitle() : ''),
    setZoom: (f) => { zoom = f; whenReady(() => el.setZoomFactor(f)); },
    getZoom: () => zoom,
    find: (text, opts = {}) => whenReady(() => { if (text) el.findInPage(text, { forward: opts.forward !== false, findNext: !!opts.findNext }); }),
    stopFind: () => whenReady(() => el.stopFindInPage('clearSelection')),
    print: () => whenReady(() => el.print().catch(() => {})),
    copy: () => whenReady(() => el.copy()), paste: () => whenReady(() => el.paste()), cut: () => whenReady(() => el.cut()), selectAll: () => whenReady(() => el.selectAll()),
    downloadURL: (url) => whenReady(() => el.downloadURL(url)),
    focus: () => el.focus(),
    webContentsId: () => wcId,
    on: (e, fn) => ev.on(e, fn),
    destroy: () => { offMenu?.(); el.remove(); },
  };
}
