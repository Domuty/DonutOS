// A web page view for the Browser app, shared interface for both platforms:
//   view.el                      element to put on screen
//   view.load(url) back() forward() reload() stop()
//   view.canGoBack() canGoForward() url() title()
//   view.setZoom(factor) find(text, { forward, findNext }) stopFind() print()
//   view.on(event, fn)           'navigate' {url, inPage} | 'title' | 'loading' bool | 'favicon' url
//                                 | 'error' {code, description, url} | 'found' {active, matches}
//                                 | 'contextmenu' {x, y, linkURL, srcURL, mediaType, selectionText, isEditable}
//   view.destroy()
//   view.capabilities            { title, find, print, history, contextMenu }

export class Emitter {
  constructor() { this.handlers = new Map(); }
  on(ev, fn) { if (!this.handlers.has(ev)) this.handlers.set(ev, new Set()); this.handlers.get(ev).add(fn); return () => this.handlers.get(ev)?.delete(fn); }
  emit(ev, data) { for (const fn of this.handlers.get(ev) || []) { try { fn(data); } catch (err) { console.error(err); } } }
}

/**
 * Web build: an <iframe>. Browsers isolate cross-origin frames, so the page's own title,
 * in-page navigation and text search can't be read, and sites that send
 * X-Frame-Options/frame-ancestors refuse to load inside it. History covers the pages
 * opened from the address bar, links DonutOS opens and the Browser's own pages.
 */
export function createFrameView({ sandbox = 'web', relayBase = null } = {}) {
  const ev = new Emitter();
  const el = document.createElement('iframe');
  el.className = 'web-view';
  if (sandbox === 'relay') return relayView(ev, el, relayBase);
  // 'web': a site's own origin (it can use its cookies). 'strict': local files get an opaque
  // origin so they can never reach DonutOS. 'none': PDFs (the viewer refuses sandboxed frames).
  if (sandbox === 'web') el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-pointer-lock allow-presentation');
  else if (sandbox === 'strict') el.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals');
  el.setAttribute('allow', 'fullscreen; clipboard-write; autoplay; picture-in-picture');
  el.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  const history = [];
  let index = -1;
  let loading = false;
  let zoom = 1;
  const go = (url) => {
    loading = true;
    ev.emit('loading', true);
    el.src = url;
    ev.emit('navigate', { url, inPage: false });
    ev.emit('title', hostTitle(url));
  };
  el.addEventListener('load', () => {
    if (!loading) return;
    loading = false;
    ev.emit('loading', false);
    // Same-origin and blob pages can be read; others stay opaque.
    try { const t = el.contentDocument?.title; if (t) ev.emit('title', t); } catch { /* cross-origin */ }
    ev.emit('loaded', {});
  });
  return {
    el,
    capabilities: { title: false, find: false, print: false, history: false, contextMenu: false },
    load(url) { history.splice(index + 1); history.push(url); index = history.length - 1; go(url); },
    back() { if (index > 0) go(history[--index]); },
    forward() { if (index < history.length - 1) go(history[++index]); },
    reload() { go(history[index] || el.src); },
    stop() { if (loading) { loading = false; try { el.contentWindow.stop(); } catch { /* cross-origin */ } ev.emit('loading', false); } },
    canGoBack: () => index > 0,
    canGoForward: () => index < history.length - 1,
    url: () => history[index] || '',
    title: () => hostTitle(history[index] || ''),
    setZoom(f) { zoom = f; Object.assign(el.style, { width: `${100 / f}%`, height: `${100 / f}%`, transform: `scale(${f})`, transformOrigin: '0 0' }); },
    getZoom: () => zoom,
    find() {}, stopFind() {}, print() {},
    focus() { el.focus(); },
    webContentsId: () => null,
    on: (e, fn) => ev.on(e, fn),
    destroy() { el.src = 'about:blank'; el.remove(); },
  };
}

/**
 * Web build, sites that refuse frames: pages come through DonutOS's relay (api/relay), which
 * serves them with an opaque origin (no allow-same-origin here, and a CSP sandbox from the
 * relay). The relay's page script reports each page's real address and title, and asks for
 * new tabs, by postMessage. History is kept here, so Back/Forward work.
 */
function relayView(ev, el, relayBase) {
  el.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-pointer-lock allow-presentation');
  el.setAttribute('allow', 'fullscreen; autoplay; picture-in-picture');
  el.setAttribute('referrerpolicy', 'no-referrer');
  const history = [];
  let index = -1;
  let loading = false;
  let zoom = 1;
  let title = '';
  let expectUrl = null;
  const go = (url) => {
    loading = true;
    expectUrl = url;
    ev.emit('loading', true);
    el.src = relayBase + encodeURIComponent(url);
    ev.emit('navigate', { url, inPage: false });
    ev.emit('title', hostTitle(url));
  };
  const onMessage = (e) => {
    if (e.source !== el.contentWindow || !e.data || typeof e.data !== 'object' || !e.data.donutRelay) return;
    const m = e.data;
    let url;
    try { url = new URL(String(m.url)).href; } catch { return; }
    if (!/^https?:/.test(url)) return;
    if (m.donutRelay === 'open') { ev.emit('open', { url }); return; }
    if (m.donutRelay === 'loaded') {
      // A link or form inside the page went somewhere new: that's a new history entry.
      const cur = history[index];
      const same = (a, b) => a && b && a.split('#')[0] === b.split('#')[0];
      if (!same(url, cur) && !same(url, expectUrl)) { history.splice(index + 1); history.push(url); index = history.length - 1; }
      else if (same(url, cur)) history[index] = url;
      expectUrl = null;
      ev.emit('navigate', { url, inPage: same(url, cur) });
      title = String(m.title || '').slice(0, 300);
      ev.emit('title', title || hostTitle(url));
      if (m.favicon) ev.emit('favicon', String(m.favicon));
    }
  };
  addEventListener('message', onMessage);
  el.addEventListener('load', () => { if (!loading) return; loading = false; ev.emit('loading', false); ev.emit('loaded', {}); });
  return {
    el,
    capabilities: { title: true, find: false, print: false, history: true, contextMenu: false, relay: true },
    load(url) { history.splice(index + 1); history.push(url); index = history.length - 1; go(url); },
    back() { if (index > 0) go(history[--index]); },
    forward() { if (index < history.length - 1) go(history[++index]); },
    reload() { if (history[index]) go(history[index]); },
    stop() { if (loading) { loading = false; el.src = 'about:blank'; ev.emit('loading', false); } },
    canGoBack: () => index > 0,
    canGoForward: () => index < history.length - 1,
    url: () => history[index] || '',
    title: () => title || hostTitle(history[index] || ''),
    setZoom(f) { zoom = f; Object.assign(el.style, { width: `${100 / f}%`, height: `${100 / f}%`, transform: `scale(${f})`, transformOrigin: '0 0' }); },
    getZoom: () => zoom,
    find() {}, stopFind() {}, print() {},
    focus() { el.focus(); },
    webContentsId: () => null,
    on: (e, fn) => ev.on(e, fn),
    destroy() { removeEventListener('message', onMessage); el.src = 'about:blank'; el.remove(); },
  };
}

export function hostTitle(url) {
  try { const u = new URL(url); return u.protocol === 'blob:' ? 'File' : u.hostname.replace(/^www\./, '') || url; } catch { return url; }
}
