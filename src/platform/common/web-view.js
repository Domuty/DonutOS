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
export function createFrameView({ sandbox = 'web' } = {}) {
  const ev = new Emitter();
  const el = document.createElement('iframe');
  el.className = 'web-view';
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

export function hostTitle(url) {
  try { const u = new URL(url); return u.protocol === 'blob:' ? 'File' : u.hostname.replace(/^www\./, '') || url; } catch { return url; }
}
