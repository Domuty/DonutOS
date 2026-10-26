// Browser: tabs, address bar with search, back/forward/reload, bookmarks and a bookmarks
// bar, history, downloads, zoom, find in page, private tabs, a new-tab page with your most
// visited sites, and opening HTML/PDF/SVG files from your folders.

import { createTabStrip, renderTabStrip, tabCloser } from '../common/tabs.js';
import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { showMenu } from '../../ui/menu.js';
import { promptDialog, confirmDialog, alertDialog } from '../../ui/dialog.js';
import { formatBytes } from '../../core/util.js';
import * as P from '../../core/path.js';

// Google's igu=1 mode allows its results to be shown inside other pages (useful on the web
// version without a relay).
const DEFAULT_ENGINE = 'duckduckgo';
const ENGINES = {
  duckduckgo: ['DuckDuckGo', 'https://duckduckgo.com/?q='],
  google: ['Google', 'https://www.google.com/search?igu=1&q='],
  bing: ['Bing', 'https://www.bing.com/search?q='],
  startpage: ['Startpage', 'https://www.startpage.com/do/search?q='],
  wikipedia: ['Wikipedia', 'https://en.wikipedia.org/w/index.php?search='],
};
const INTERNAL = { 'about:newtab': 'New tab', 'about:history': 'History', 'about:bookmarks': 'Bookmarks', 'about:downloads': 'Downloads', 'about:settings': 'Browser settings' };
const MAX_HISTORY = 3000;

export default function main(ctx) {
  const store = ctx.storage;
  const me = ctx.accounts.current();
  const B = ctx.browser;
  const win = ctx.windows.create({ title: 'Browser', width: 1180, height: 760, minWidth: 480, minHeight: 360, showTitle: false });
  win.body.classList.add('browser');
  const privateWindow = !!ctx.args.private;
  if (privateWindow) win.body.classList.add('private');

  const tabs = [];
  let active = null;
  let tabSeq = 1;
  let frameNoticeDismissed = store.get('frameNotice', false);
  const downloads = new Map(store.get('downloads', []).map((d) => [d.id, d]));
  const engine = () => ENGINES[store.get('engine', DEFAULT_ENGINE)] || ENGINES[DEFAULT_ENGINE];
  // Whether this host has the relay (web version on Vercel or serve.js), and whether it's in use.
  // How the web version shows websites (desktop webviews always show them directly):
  //   relay  — through DonutOS's relay where the host has one (default)
  //   check  — directly where sites allow it; others get "opens in its own tab"
  //   direct — always directly (for a browser extension that lets every site be framed)
  const siteMode = () => store.get('siteMode', store.get('relay', true) ? 'relay' : 'check');
  let relayHere = false, relayOn = false;
  B.relayAvailable().then((ok) => { relayHere = ok; relayOn = ok && siteMode() === 'relay'; }).catch(() => {});
  const bookmarks = () => store.get('bookmarks', []);
  const history = () => store.get('history', []);

  // ── Chrome ───────────────────────────────────────────────────────────
  const tabStrip = createTabStrip('Tabs');
  win.titlebar.append(tabStrip);
  const address = h('input.input.br-address', { spellcheck: false, autocomplete: 'off', 'aria-label': 'Address and search bar', placeholder: `Search ${engine()[0]} or type a web address`,
    onkeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); editing = false; navigate(active, address.value); active.view?.focus?.(); }
      else if (e.key === 'Escape') { editing = false; address.value = displayUrl(active); address.blur(); }
      else if (e.key === 'ArrowDown') { const first = suggest.querySelector('button'); if (first) { e.preventDefault(); first.focus(); } }
    },
    oninput: () => { editing = true; renderSuggest(); }, onfocus: () => { address.select(); renderSuggest(); }, onblur: () => setTimeout(() => { if (!suggest.contains(document.activeElement)) { suggest.hidden = true; editing = false; } }, 150) });
  let editing = false; // the user is typing in the address bar: don't overwrite it
  const suggest = h('div.br-suggest', { hidden: true, role: 'listbox' });
  const star = h('button.tb-btn.br-star', { type: 'button', 'aria-label': 'Bookmark this page (Ctrl+D)', title: 'Bookmark this page (Ctrl+D)', onclick: () => toggleBookmark() }, '☆');
  const lock = h('span.br-lock', { 'aria-hidden': 'true' });
  const btn = (label, ic, onclick) => h('button.tb-btn', { type: 'button', 'aria-label': label, title: label, onclick }, typeof ic === 'string' ? icon(ic, { size: 16 }) : ic);
  const backBtn = btn('Back (Alt+Left)', 'arrowLeft', () => goBack(active));
  const fwdBtn = btn('Forward (Alt+Right)', 'arrowRight', () => active.view?.forward());
  const reloadBtn = btn('Reload (Ctrl+R)', 'refresh', () => (active.loading ? active.view?.stop() : reload(active)));
  const toolbar = h('div.br-toolbar', backBtn, fwdBtn, reloadBtn, btn('Home', 'apps', () => navigate(active, store.get('home', 'about:newtab'))),
    h('div.br-addrwrap', lock, address, star, suggest),
    btn('Downloads (Ctrl+J)', 'download', () => openInternal('about:downloads')),
    btn('Menu', 'chevronDown', (e) => mainMenu(e.currentTarget)));
  const bookmarkBar = h('div.br-bookmarks', { role: 'toolbar', 'aria-label': 'Bookmarks bar' });
  const findBar = h('div.br-find', { hidden: true });
  const notice = h('div.br-notice', { hidden: true });
  const progress = h('div.br-progress');
  const stage = h('div.br-stage');
  mount(win.body, toolbar, bookmarkBar, findBar, notice, progress, stage);

  // ── Tabs ─────────────────────────────────────────────────────────────
  function newTab(url = 'about:newtab', { background = false } = {}) {
    const tab = { id: tabSeq++, url: '', title: 'New tab', favicon: null, loading: false, view: null, panel: h('div.br-panel'), zoom: store.get('zoom', 1), internal: null, error: null };
    stage.append(tab.panel);
    tabs.push(tab);
    if (!background || !active) activate(tab);
    navigate(tab, url);
    renderTabs();
    return tab;
  }

  function activate(tab) {
    active = tab;
    editing = false;
    for (const t of tabs) t.panel.hidden = t !== tab;
    renderChrome();
    renderTabs();
    if (tab.internal === 'about:newtab') setTimeout(() => address.focus());
  }

  function closeTab(tab) {
    const i = tabs.indexOf(tab);
    tabs.splice(i, 1);
    tab.view?.destroy();
    tab.panel.remove();
    if (!tabs.length) { win.close({ force: true }); return; }
    if (active === tab) activate(tabs[Math.max(0, i - 1)]); else renderTabs();
  }

  function renderTabs() {
    renderTabStrip(tabStrip, tabs.map((t) => h('div.ex-tab', {
      role: 'tab', tabindex: '0', 'aria-selected': String(t === active), class: t === active && 'active', title: t.title,
      onclick: () => activate(t), onauxclick: (e) => { if (e.button === 1) closeTab(t); },
      oncontextmenu: (e) => { e.preventDefault(); showMenu([
        { label: 'New tab', onSelect: () => newTab() }, { label: 'Reload', onSelect: () => reload(t) }, { label: 'Duplicate', onSelect: () => newTab(t.url) },
        { separator: true }, { label: 'Close tab', onSelect: () => closeTab(t) }, { label: 'Close other tabs', onSelect: () => [...tabs].filter((x) => x !== t).forEach(closeTab) },
      ], { x: e.clientX, y: e.clientY }); },
    }, t.loading ? h('span.br-spin') : t.favicon ? h('img', { src: t.favicon, alt: '', onerror: (e) => e.target.replaceWith(icon('globe', { size: 14 })) }) : icon(t.internal && t.internal !== 'about:blocked' ? 'apps' : 'globe', { size: 14 }),
    h('span', t.title || t.url),
    tabCloser('Close tab', () => closeTab(t)))),
    h('button.ex-tab-new', { type: 'button', title: 'New tab (Ctrl+T or Alt+T)', 'aria-label': 'New tab', onclick: () => newTab() }, icon('plus', { size: 14 })));
    win.setTitle(`${active?.title || 'Browser'} — Browser${privateWindow ? ' (private)' : ''}`);
  }

  const displayUrl = (t) => (!t || t.internal === 'about:newtab' ? '' : t.url);
  function renderChrome() {
    if (!active) return;
    if (!editing) address.value = displayUrl(active);
    const v = active.view;
    backBtn.disabled = !((v && v.canGoBack()) || (!active.internal && active.cameFrom));
    fwdBtn.disabled = !(v && v.canGoForward());
    mount(reloadBtn, icon(active.loading ? 'close' : 'refresh', { size: 16 }));
    reloadBtn.setAttribute('aria-label', active.loading ? 'Stop' : 'Reload (Ctrl+R)');
    const marked = bookmarks().some((b) => b.url === active.url);
    star.textContent = marked ? '★' : '☆';
    star.classList.toggle('on', marked);
    star.hidden = !!active.internal;
    let secure = 'none';
    try { const u = new URL(active.url); secure = u.protocol === 'https:' ? 'secure' : u.protocol === 'http:' ? 'insecure' : 'none'; } catch { /* internal */ }
    lock.className = `br-lock ${secure}`;
    lock.textContent = secure === 'secure' ? '🔒︎' : secure === 'insecure' ? '⚠' : '';
    lock.title = secure === 'secure' ? 'Connection is secure (HTTPS)' : secure === 'insecure' ? 'Not secure: this page doesn’t use HTTPS' : '';
    progress.classList.toggle('on', active.loading);
    renderBookmarkBar();
    notice.hidden = !(B.kind === 'frame' && !active.internal && !frameNoticeDismissed && /^https?:/.test(active.url));
  }

  // ── Navigation ───────────────────────────────────────────────────────
  function toUrl(input) {
    const s = input.trim();
    if (!s) return 'about:newtab';
    if (/^(about):/i.test(s)) return s.toLowerCase();
    if (/^(https?|file|data|blob):/i.test(s)) return s;
    if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)/.test(s)) return `http://${s}`;
    if (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return `https://${s}`;
    return searchUrl(s);
  }
  // DuckDuckGo's plain-HTML results page works through the relay (no scripts needed).
  function searchUrl(q) {
    const id = store.get('engine', DEFAULT_ENGINE);
    if (id === 'duckduckgo' && relayOn) return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    return engine()[1] + encodeURIComponent(q);
  }

  async function navigate(tab, input) {
    let url = toUrl(input);
    tab.error = null;
    if (INTERNAL[url]) { showInternal(tab, url); return; }
    if (url.startsWith('donut-file:')) { openLocal(tab, url.slice(11)); return; }
    if (tab.internal && tab.internal !== 'about:offline' && tab.internal !== 'about:error') tab.cameFrom = tab.internal;
    tab.internal = null;
    if (!B.online()) { tab.url = url; showOffline(tab); return; }
    const seq = tab.navSeq = (tab.navSeq || 0) + 1;
    tab.url = url;
    tab.loading = true;
    if (tab === active) { renderChrome(); renderTabs(); }
    // Web version: pages come through DonutOS's relay when the host has one (so sites that
    // refuse to be framed still show, and links inside them keep working). Without a relay,
    // sites that refuse get a page of ours instead of an empty frame.
    const mode = siteMode();
    const relay = mode === 'relay' && await B.relayAvailable().catch(() => false);
    if (relay && url.startsWith(ENGINES.duckduckgo[1])) { url = `https://html.duckduckgo.com/html/?q=${url.slice(ENGINES.duckduckgo[1].length)}`; tab.url = url; }
    const embeddable = relay || mode === 'direct' ? true : await B.canEmbed(url).catch(() => null);
    if (tab.navSeq !== seq) return; // the user went somewhere else meanwhile
    tab.loading = false;
    if (embeddable === false) { showBlocked(tab, url); return; }
    try {
      if (!tab.view || tab.fileView || !!tab.view.capabilities?.relay !== !!relay) await attachView(tab, { relay });
    } catch (err) {
      tab.internal = 'about:error';
      mount(tab.panel, h('div.br-page.br-center', icon('shield', { size: 44 }), h('h1', 'Browser can’t go online'), h('p', err.name === 'PermissionError' ? 'Internet access for Browser is turned off. You can allow it in Settings › Privacy & security.' : err.message)));
      return;
    }
    tab.url = url;
    tab.title = new URL(url).hostname.replace(/^www\./, '') || url;
    tab.view.load(url);
    tab.panel.replaceChildren(tab.view.el);
    if (tab === active) { renderChrome(); renderTabs(); }
  }

  async function attachView(tab, { relay = false } = {}) {
    tab.view?.destroy();
    tab.fileView = false;
    const v = await B.createView({ private: privateWindow, relay });
    v.on('open', ({ url }) => newTab(url, { background: false }));
    tab.view = v;
    v.setZoom(tab.zoom);
    v.on('loading', (on) => { tab.loading = on; if (tab === active) renderChrome(); renderTabs(); });
    v.on('navigate', ({ url, inPage }) => {
      tab.url = url;
      tab.error = null;
      if (!inPage) tab.favicon = null;
      if (tab === active) renderChrome();
      record(tab);
    });
    v.on('title', (t) => { tab.title = t || tab.title; renderTabs(); record(tab, { titleOnly: true }); });
    v.on('favicon', (f) => {
      tab.favicon = f;
      const o = originOf(tab.url);
      if (f && o && favicons[o] !== f && !privateWindow) { favicons[o] = f; store.set('favicons', favicons); }
      renderTabs();
    });
    v.on('error', (e) => showError(tab, e));
    v.on('found', ({ active: a, matches }) => { findCount.textContent = matches ? `${a} of ${matches}` : 'No results'; });
    v.on('contextmenu', (p) => pageMenu(tab, p));
  }

  // Back goes through the page's history, then to the Browser page the tab started on.
  function goBack(tab) {
    // From a "can't be shown here" page, back to the page that was showing before.
    if (tab.internal === 'about:blocked' && tab.view && tab.view.url()) {
      tab.internal = null; tab.url = tab.view.url(); tab.title = hostOf(tab.url).replace(/^www\./, '');
      tab.panel.replaceChildren(tab.view.el);
      if (tab === active) { renderChrome(); renderTabs(); }
      return;
    }
    if (tab.internal === 'about:blocked' && tab.cameFrom) { const to = tab.cameFrom; tab.cameFrom = null; showInternal(tab, to); return; }
    if (tab.view?.canGoBack()) tab.view.back();
    else if (!tab.internal && tab.cameFrom) { const to = tab.cameFrom; tab.cameFrom = null; showInternal(tab, to); }
  }

  function reload(tab) {
    if (tab.internal === 'about:offline' || tab.internal === 'about:blocked') { navigate(tab, tab.url); return; }
    if (tab.internal) { showInternal(tab, tab.internal); return; }
    tab.view?.reload();
  }

  function record(tab, { titleOnly = false } = {}) {
    if (privateWindow || !/^https?:/.test(tab.url)) return;
    const list = history();
    if (titleOnly) {
      if (list[0]?.url === tab.url) { list[0] = { ...list[0], title: tab.title }; store.set('history', list); }
      return;
    }
    if (list[0]?.url === tab.url && Date.now() - list[0].time < 3000) return;
    store.set('history', [{ url: tab.url, title: tab.title, time: Date.now() }, ...list].slice(0, MAX_HISTORY));
  }

  function showError(tab, e) {
    tab.error = e;
    const offline = e.code === -106;
    tab.panel.replaceChildren(h('div.br-page.br-center', icon(offline ? 'wifiOff' : 'warning', { size: 44 }),
      h('h1', offline ? 'You’re not connected' : e.code === -105 ? 'Hmm… can’t reach this page' : 'This page couldn’t load'),
      h('p', offline ? 'Check your network connection, then try again.' : e.code === -105 ? `Check that ${hostOf(e.url)} is spelled correctly.` : `${e.description || 'The site didn’t respond'} (${e.code}).`),
      h('button.btn.primary', { type: 'button', onclick: () => navigate(tab, e.url || tab.url) }, 'Try again')));
  }
  function showOffline(tab) {
    tab.internal = 'about:offline';
    tab.title = 'No internet';
    tab.panel.replaceChildren(h('div.br-page.br-center', icon('wifiOff', { size: 44 }), h('h1', 'You’re offline'),
      h('p', 'Wi-Fi or airplane mode is keeping DonutOS offline, or this device has no network. Turn Wi-Fi on in Quick Settings, then try again.'),
      h('button.btn.primary', { type: 'button', onclick: () => navigate(tab, tab.url) }, 'Try again')));
    if (tab === active) { renderChrome(); renderTabs(); }
  }
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return u; } };

  function showBlocked(tab, url) {
    const host = hostOf(url).replace(/^www\./, '');
    tab.internal = 'about:blocked';
    tab.url = url;
    tab.title = host;
    tab.favicon = null;
    const canBack = !!(tab.view && tab.view.url()) || !!tab.cameFrom;
    tab.panel.replaceChildren(h('div.br-page.br-center', icon('globe', { size: 44 }),
      h('h1', `${host} opens in its own tab`),
      h('p', `${host} doesn’t allow other apps to show it inside them, so it can’t appear in this window. Open it in a new tab of your web browser; DonutOS stays open here.`),
      h('div.br-actions',
        h('button.btn.primary', { type: 'button', onclick: () => ctx.host.openExternal(url).catch((err) => alertDialog('Couldn’t open the page', err.message, { parent: win.body })) }, icon('arrowRight', { size: 14 }), 'Open in a new tab'),
        canBack ? h('button.btn', { type: 'button', onclick: () => goBack(tab) }, 'Go back') : null),
      h('p.hint', url)));
    record(tab);
    if (tab === active) { renderChrome(); renderTabs(); }
  }

  async function openLocal(tab, path) {
    const st = await ctx.fs.stat(path).catch(() => null);
    if (!st) { tab.panel.replaceChildren(h('div.br-page.br-center', h('h1', 'File not found'), h('p', path))); return; }
    const pdf = st.ext === '.pdf';
    tab.view?.destroy();
    const v = B.createFileView({ pdf });
    tab.view = v; tab.fileView = true; tab.internal = null;
    const blob = await ctx.fs.readBlob(path);
    const url = URL.createObjectURL(blob);
    ctx.own(() => URL.revokeObjectURL(url));
    v.load(url);
    tab.url = `donut-file:${path}`;
    tab.title = st.name;
    tab.panel.replaceChildren(v.el);
    ctx.addRecent(path);
    if (tab === active) { renderChrome(); renderTabs(); }
  }

  // ── Internal pages ───────────────────────────────────────────────────
  function openInternal(url) {
    const existing = tabs.find((t) => t.internal === url);
    if (existing) { activate(existing); showInternal(existing, url); } else newTab(url);
  }
  function showInternal(tab, url) {
    tab.view?.destroy(); tab.view = null;
    tab.internal = url; tab.url = url; tab.title = INTERNAL[url]; tab.loading = false; tab.favicon = null;
    const page = { 'about:newtab': newTabPage, 'about:history': historyPage, 'about:bookmarks': bookmarksPage, 'about:downloads': downloadsPage, 'about:settings': settingsPage }[url];
    tab.panel.replaceChildren(page(tab));
    if (tab === active) { renderChrome(); renderTabs(); }
  }

  function topSites() {
    const counts = new Map();
    for (const e of history()) {
      let origin; try { origin = new URL(e.url).origin; } catch { continue; }
      const c = counts.get(origin) || { url: `${origin}/`, title: hostOf(e.url).replace(/^www\./, ''), n: 0 };
      c.n++; counts.set(origin, c);
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  }
  // Icons that pages reported themselves (no guessing URLs that may not exist).
  const favicons = store.get('favicons', {});
  const originOf = (url) => { try { return new URL(url).origin; } catch { return ''; } };
  const favIcon = (url) => favicons[originOf(url)] || null;
  const iconImg = (url, fallback) => (favIcon(url) ? h('img', { src: favIcon(url), alt: '', onerror: (e) => e.target.replaceWith(fallback()) }) : fallback());
  function siteTile(s, tab) {
    return h('button.br-tile', { type: 'button', title: s.url, onclick: () => navigate(tab, s.url) },
      h('span.br-tileicon', iconImg(s.url, () => h('b', (s.title || hostOf(s.url) || '?')[0].toUpperCase()))),
      h('span', s.title || hostOf(s.url)));
  }
  function newTabPage(tab) {
    const q = h('input.input.br-bigsearch', { placeholder: `Search ${engine()[0]} or type a web address`, 'aria-label': 'Search', onkeydown: (e) => { if (e.key === 'Enter') navigate(tab, q.value); } });
    const sites = topSites();
    const marks = bookmarks().slice(0, 8);
    return h('div.br-page.br-newtab',
      privateWindow ? h('div.br-private', icon('eyeOff', { size: 28 }), h('div', h('b', 'Private browsing'), h('p', B.kind === 'webview' ? 'Pages you visit aren’t saved to history, and cookies and site data are deleted when you close this window.' : 'Pages you visit in this window aren’t saved to Browser history.'))) : null,
      h('div.br-logo', '🍩'),
      q,
      sites.length ? [h('h3', 'Most visited'), h('div.br-tiles', sites.map((s) => siteTile(s, tab)))] : null,
      marks.length ? [h('h3', 'Bookmarks'), h('div.br-tiles', marks.map((b) => siteTile(b, tab)))] : null,
      !sites.length && !marks.length ? h('p.hint', 'Sites you visit often and your bookmarks will appear here.') : null);
  }

  function historyPage(tab) {
    const q = h('input.input', { type: 'search', placeholder: 'Search history', 'aria-label': 'Search history', oninput: () => paint() });
    const list = h('div.br-list');
    const paint = () => {
      const f = q.value.trim().toLowerCase();
      const items = history().filter((e) => !f || `${e.title} ${e.url}`.toLowerCase().includes(f)).slice(0, 500);
      const byDay = new Map();
      for (const e of items) { const d = new Date(e.time).toDateString(); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(e); }
      mount(list, byDay.size ? [...byDay].map(([d, arr]) => [h('h3', d === new Date().toDateString() ? 'Today' : new Date(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })),
        arr.map((e) => h('div.br-item', h('small', new Date(e.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })),
          h('button.br-link', { type: 'button', onclick: () => navigate(tab, e.url), title: e.url }, h('b', e.title || e.url), h('span', hostOf(e.url))),
          h('button.tb-btn', { type: 'button', 'aria-label': 'Remove from history', onclick: () => { store.set('history', history().filter((x) => x !== e && !(x.url === e.url && x.time === e.time))); paint(); } }, icon('close', { size: 12 }))))])
        : h('p.hint', f ? 'Nothing in history matches.' : 'Pages you visit appear here.'));
    };
    paint();
    return h('div.br-page', h('div.br-pagehead', h('h1', 'History'), q, h('button.btn', { type: 'button', onclick: async () => { if (await confirmDialog('Clear browsing history?', 'Every page in your history is removed.', { ok: 'Clear', danger: true, parent: win.body })) { store.set('history', []); paint(); } } }, 'Clear history')), list);
  }

  function bookmarksPage(tab) {
    const list = h('div.br-list');
    const paint = () => mount(list, bookmarks().length ? bookmarks().map((b) => h('div.br-item',
      h('span.br-tileicon.small', iconImg(b.url, () => icon('globe', { size: 14 }))),
      h('button.br-link', { type: 'button', onclick: () => navigate(tab, b.url), title: b.url }, h('b', b.title), h('span', b.url)),
      h('button.tb-btn', { type: 'button', 'aria-label': 'Edit', onclick: () => editBookmark(b).then(paint) }, icon('edit', { size: 14 })),
      h('button.tb-btn', { type: 'button', 'aria-label': 'Delete', onclick: () => { store.set('bookmarks', bookmarks().filter((x) => x.id !== b.id)); paint(); renderChrome(); } }, icon('trash', { size: 14 }))))
      : h('p.hint', 'Select ☆ in the address bar to bookmark a page.'));
    paint();
    return h('div.br-page', h('div.br-pagehead', h('h1', 'Bookmarks'),
      h('button.btn', { type: 'button', onclick: async () => { const u = await promptDialog('Add bookmark', { label: 'Web address', value: 'https://', parent: win.body, validate: (v) => (/^https?:\/\/\S+\.\S+/.test(v.trim()) ? '' : 'Type a full web address') }); if (u) { store.set('bookmarks', [...bookmarks(), { id: Date.now().toString(36), title: hostOf(u), url: u.trim() }]); paint(); renderChrome(); } } }, icon('plus', { size: 14 }), 'Add')), list);
  }

  function downloadsPage() {
    const list = h('div.br-list');
    const paint = () => mount(list, B.kind === 'frame'
      ? h('div.br-center', icon('download', { size: 40 }), h('p', 'In the web version, files you download from websites are saved by your web browser to your computer’s Downloads folder. To bring one into DonutOS, use File Explorer › Upload or drag it onto the desktop.'))
      : downloads.size ? [...downloads.values()].sort((a, b) => b.time - a.time).map((d) => h('div.br-item.br-dl',
        icon(d.state === 'completed' ? 'check' : d.state === 'progressing' ? 'download' : 'warning', { size: 18 }),
        h('div.br-dlinfo', h('b', d.name), h('small', d.state === 'progressing' ? `${formatBytes(d.received)}${d.total ? ` of ${formatBytes(d.total)}` : ''}` : d.state === 'completed' ? `${formatBytes(d.total || d.received)} · ${hostOf(d.url)}` : d.state === 'cancelled' ? 'Cancelled' : 'Failed — the download was interrupted'),
          d.state === 'progressing' && d.total ? h('div.br-dlbar', h('i', { style: { width: `${(d.received / d.total) * 100}%` } })) : null),
        d.state === 'completed' ? [h('button.btn', { type: 'button', onclick: () => ctx.open(d.path).catch(() => {}) }, 'Open'), h('button.btn.subtle', { type: 'button', onclick: () => ctx.launch('explorer', { path: P.dirname(d.path) }) }, 'Show in folder')]
          : d.state === 'progressing' ? h('button.btn', { type: 'button', onclick: () => B.cancelDownload(d.id) }, 'Cancel') : null))
        : h('p.hint', 'Files you download are saved to your Downloads folder.'));
    paint();
    dlPainters.add(paint);
    return h('div.br-page', h('div.br-pagehead', h('h1', 'Downloads'), B.kind === 'webview' && downloads.size ? h('button.btn', { type: 'button', onclick: () => { for (const [id, d] of downloads) if (d.state !== 'progressing') downloads.delete(id); saveDownloads(); paint(); } }, 'Clear list') : null), list);
  }
  const dlPainters = new Set();
  const saveDownloads = () => store.set('downloads', [...downloads.values()].slice(-100));

  function settingsPage() {
    const sel = h('select.input', { 'aria-label': 'Search engine', onchange: (e) => { store.set('engine', e.target.value); address.placeholder = `Search ${engine()[0]} or type a web address`; } },
      Object.entries(ENGINES).map(([id, [name]]) => h('option', { value: id, selected: store.get('engine', DEFAULT_ENGINE) === id }, name)));
    const home = h('input.input', { value: store.get('home', 'about:newtab'), 'aria-label': 'Home page', onchange: (e) => store.set('home', e.target.value.trim() || 'about:newtab') });
    const bar = h('input', { type: 'checkbox', checked: store.get('showBookmarks', true), onchange: (e) => { store.set('showBookmarks', e.target.checked); renderChrome(); } });
    const modeSel = h('select.input', { 'aria-label': 'How to show websites', onchange: (e) => { store.set('siteMode', e.target.value); relayOn = relayHere && e.target.value === 'relay'; } },
      [...(relayHere ? [['relay', 'Through DonutOS’s relay (recommended)']] : []), ['check', 'Directly where sites allow it; others open in a browser tab'], ['direct', 'Always directly (with a browser extension that allows it)']]
        .map(([v, l]) => h('option', { value: v, selected: (siteMode() === 'relay' && !relayHere ? 'check' : siteMode()) === v }, l)));
    const zoom = h('select.input', { 'aria-label': 'Default zoom', onchange: (e) => store.set('zoom', Number(e.target.value)) }, [0.75, 0.9, 1, 1.1, 1.25, 1.5].map((z) => h('option', { value: z, selected: store.get('zoom', 1) === z }, `${Math.round(z * 100)}%`)));
    return h('div.br-page.br-settings', h('h1', 'Browser settings'),
      h('label.ck-field', 'Search engine used in the address bar', sel),
      h('label.ck-field', 'Home page (about:newtab or a web address)', home),
      h('label.ck-field', 'Default page zoom', zoom),
      h('label.wr-check', bar, 'Show the bookmarks bar'),
      B.kind === 'frame' ? [h('label.ck-field', 'How to show websites', modeSel),
        h('p.hint', 'Relay: sites that don’t allow being shown inside other apps still open in this window, through the server DonutOS is hosted on (no sign-ins: cookies aren’t kept; some video and interactive sites may not work). Always directly: use this with a browser extension that removes sites’ “don’t show me in a frame” rule — sites then work fully, including signing in.')] : null,
      h('h3', 'Clear browsing data'),
      h('div.wr-row',
        h('button.btn', { type: 'button', onclick: () => { store.set('history', []); } }, 'Clear history'),
        B.kind === 'webview' ? h('button.btn', { type: 'button', onclick: () => B.clearData({ cache: true }) }, 'Clear cache') : null,
        B.kind === 'webview' ? h('button.btn', { type: 'button', onclick: async () => { if (await confirmDialog('Clear cookies and site data?', 'You’ll be signed out of most websites.', { ok: 'Clear', danger: true, parent: win.body })) B.clearData({ cookies: true, storage: true }); } }, 'Clear cookies and site data') : null),
      B.kind === 'frame' ? h('p.hint', 'In the web version, cookies and cached files belong to your web browser; clear them from its own settings.') : null);
  }

  // ── Bookmarks ────────────────────────────────────────────────────────
  async function toggleBookmark() {
    if (!active || active.internal) return;
    const existing = bookmarks().find((b) => b.url === active.url);
    if (existing) { store.set('bookmarks', bookmarks().filter((b) => b !== existing)); renderChrome(); return; }
    const name = await promptDialog('Bookmark added', { label: 'Name', value: active.title || hostOf(active.url), ok: 'Done', parent: win.body });
    if (name === null) return;
    store.set('bookmarks', [...bookmarks(), { id: Date.now().toString(36), title: name.trim() || hostOf(active.url), url: active.url }]);
    renderChrome();
  }
  async function editBookmark(b) {
    const name = await promptDialog('Edit bookmark', { label: 'Name', value: b.title, parent: win.body });
    if (name === null) return;
    store.set('bookmarks', bookmarks().map((x) => (x.id === b.id ? { ...x, title: name.trim() || x.title } : x)));
    renderChrome();
  }
  function renderBookmarkBar() {
    const show = store.get('showBookmarks', true) && bookmarks().length;
    bookmarkBar.hidden = !show;
    if (!show) return;
    mount(bookmarkBar, bookmarks().slice(0, 30).map((b) => h('button.br-bm', { type: 'button', title: b.url, onclick: (e) => (e.ctrlKey || e.metaKey ? newTab(b.url, { background: true }) : navigate(active, b.url)), onauxclick: (e) => { if (e.button === 1) newTab(b.url, { background: true }); },
      oncontextmenu: (e) => { e.preventDefault(); showMenu([{ label: 'Open in new tab', onSelect: () => newTab(b.url) }, { label: 'Edit', onSelect: () => editBookmark(b) }, { label: 'Delete', danger: true, onSelect: () => { store.set('bookmarks', bookmarks().filter((x) => x.id !== b.id)); renderChrome(); } }], { x: e.clientX, y: e.clientY }); } },
    iconImg(b.url, () => icon('globe', { size: 12 })), h('span', b.title))));
  }

  // ── Suggestions ──────────────────────────────────────────────────────
  function renderSuggest() {
    const q = address.value.trim().toLowerCase();
    if (!q || document.activeElement !== address) { suggest.hidden = true; return; }
    const seen = new Set();
    const items = [...bookmarks().map((b) => ({ ...b, kind: 'bookmark' })), ...history().map((e) => ({ ...e, kind: 'history' }))]
      .filter((e) => `${e.title} ${e.url}`.toLowerCase().includes(q) && !seen.has(e.url) && seen.add(e.url)).slice(0, 6);
    const looksUrl = toUrl(address.value).startsWith('http') && !toUrl(address.value).startsWith(engine()[1]);
    const rows = [{ kind: 'go', title: looksUrl ? toUrl(address.value) : `${address.value.trim()} — search ${engine()[0]}`, url: toUrl(address.value) }, ...items];
    mount(suggest, rows.map((r) => h('button.br-sug', { type: 'button', role: 'option', onclick: () => { navigate(active, r.url); suggest.hidden = true; },
      onkeydown: (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); e.target.nextSibling?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); (e.target.previousSibling || address).focus(); } else if (e.key === 'Escape') address.focus(); } },
    icon(r.kind === 'bookmark' ? 'sparkle' : r.kind === 'history' ? 'restart' : looksUrl ? 'globe' : 'search', { size: 14 }), h('span', r.title || r.url), r.kind !== 'go' ? h('small', hostOf(r.url)) : null)));
    suggest.hidden = false;
  }

  // ── Menus ────────────────────────────────────────────────────────────
  function mainMenu(anchor) {
    const v = active?.view;
    const z = active?.zoom || 1;
    showMenu([
      { label: 'New tab', hint: 'Ctrl+T', onSelect: () => newTab() },
      { label: 'New window', hint: 'Ctrl+N', onSelect: () => ctx.launch('browser', {}) },
      { label: 'New private window', hint: 'Ctrl+Shift+N', icon: 'eyeOff', onSelect: () => ctx.launch('browser', { private: true }) },
      { separator: true },
      { label: `Zoom: ${Math.round(z * 100)}%  (Ctrl +/−)`, disabled: true },
      { label: 'Zoom in', hint: 'Ctrl+Plus', onSelect: () => setZoom(z + 0.1) },
      { label: 'Zoom out', hint: 'Ctrl+Minus', onSelect: () => setZoom(z - 0.1) },
      { label: 'Reset zoom', hint: 'Ctrl+0', onSelect: () => setZoom(1) },
      { separator: true },
      { label: 'Bookmarks', hint: 'Ctrl+Shift+O', onSelect: () => openInternal('about:bookmarks') },
      { label: 'History', hint: 'Ctrl+H', onSelect: () => openInternal('about:history') },
      { label: 'Downloads', hint: 'Ctrl+J', onSelect: () => openInternal('about:downloads') },
      { separator: true },
      { label: v?.capabilities.find ? 'Find on page' : 'Find on page (use your web browser’s Ctrl+F)', hint: 'Ctrl+F', disabled: !v?.capabilities.find, onSelect: showFind },
      { label: 'Print…', hint: 'Ctrl+P', disabled: !v?.capabilities.print, onSelect: () => v.print() },
      { label: 'Open in my computer’s browser', disabled: !/^https?:/.test(active?.url || ''), onSelect: () => ctx.host.openExternal(active.url) },
      { label: 'Copy page address', disabled: !/^https?:/.test(active?.url || ''), onSelect: () => ctx.clipboard.writeText(active.url) },
      { separator: true },
      { label: 'Settings', icon: 'settings', onSelect: () => openInternal('about:settings') },
    ], { anchor, align: 'start' });
  }
  function pageMenu(tab, p) {
    const v = tab.view;
    const items = [];
    if (p.linkURL) items.push({ label: 'Open link in new tab', onSelect: () => newTab(p.linkURL, { background: true }) }, { label: 'Copy link address', onSelect: () => ctx.clipboard.writeText(p.linkURL) }, { separator: true });
    if (p.mediaType === 'image' && p.srcURL) items.push({ label: 'Save image', onSelect: () => v.downloadURL(p.srcURL) }, { label: 'Open image in new tab', onSelect: () => newTab(p.srcURL, { background: true }) }, { label: 'Copy image address', onSelect: () => ctx.clipboard.writeText(p.srcURL) }, { separator: true });
    if (p.selectionText) items.push({ label: 'Copy', hint: 'Ctrl+C', onSelect: () => v.copy() }, { label: `Search ${engine()[0]} for “${p.selectionText.slice(0, 30)}${p.selectionText.length > 30 ? '…' : ''}”`, onSelect: () => newTab(engine()[1] + encodeURIComponent(p.selectionText)) }, { separator: true });
    if (p.isEditable) items.push({ label: 'Cut', onSelect: () => v.cut() }, { label: 'Paste', onSelect: () => v.paste() }, { label: 'Select all', onSelect: () => v.selectAll() }, { separator: true });
    items.push({ label: 'Back', disabled: !v.canGoBack(), onSelect: () => v.back() }, { label: 'Forward', disabled: !v.canGoForward(), onSelect: () => v.forward() }, { label: 'Reload', onSelect: () => v.reload() },
      { label: 'Print…', onSelect: () => v.print() }, { label: 'Bookmark this page', onSelect: toggleBookmark });
    showMenu(items, { x: p.x, y: p.y });
  }

  function setZoom(z) {
    if (!active?.view) return;
    active.zoom = Math.max(0.3, Math.min(3, Math.round(z * 10) / 10));
    active.view.setZoom(active.zoom);
  }

  // ── Find ─────────────────────────────────────────────────────────────
  const findInput = h('input.input', { 'aria-label': 'Find on page', placeholder: 'Find on page', oninput: () => active.view?.find(findInput.value), onkeydown: (e) => {
    if (e.key === 'Enter') { e.preventDefault(); active.view?.find(findInput.value, { forward: !e.shiftKey, findNext: true }); }
    else if (e.key === 'Escape') hideFind();
  } });
  const findCount = h('span.np-count');
  mount(findBar, findInput, findCount,
    h('button.tb-btn', { type: 'button', 'aria-label': 'Previous', onclick: () => active.view?.find(findInput.value, { forward: false, findNext: true }) }, icon('chevronUp', { size: 14 })),
    h('button.tb-btn', { type: 'button', 'aria-label': 'Next', onclick: () => active.view?.find(findInput.value, { forward: true, findNext: true }) }, icon('chevronDown', { size: 14 })),
    h('button.tb-btn', { type: 'button', 'aria-label': 'Close find', onclick: hideFind }, icon('close', { size: 14 })));
  function showFind() { if (!active?.view?.capabilities.find) return; findBar.hidden = false; findInput.focus(); findInput.select(); }
  function hideFind() { findBar.hidden = true; active?.view?.stopFind(); findCount.textContent = ''; }

  mount(notice, icon('info', { size: 16 }), h('span', 'If a link inside this page leads to a site that doesn’t allow being shown inside other apps, the page stays blank. Open it in a tab of your web browser instead.'),
    h('button.btn', { type: 'button', onclick: () => ctx.host.openExternal(active.url) }, 'Open in browser tab'),
    h('button.tb-btn', { type: 'button', 'aria-label': 'Dismiss', onclick: () => { frameNoticeDismissed = true; store.set('frameNotice', true); notice.hidden = true; } }, icon('close', { size: 14 })));

  // ── Keys and host events ─────────────────────────────────────────────
  ctx.listen(win.body, 'keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if ((ctrl && k === 't') || (e.altKey && e.code === 'KeyT')) { e.preventDefault(); newTab(); }
    else if ((ctrl && k === 'w') || (e.altKey && e.code === 'KeyW')) { e.preventDefault(); closeTab(active); }
    else if ((ctrl && k === 'l') || (e.altKey && k === 'd') || e.key === 'F6') { e.preventDefault(); address.focus(); address.select(); }
    else if ((ctrl && k === 'r') || e.key === 'F5') { e.preventDefault(); reload(active); }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(active); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); active.view?.forward(); }
    else if (ctrl && k === 'f') { e.preventDefault(); showFind(); }
    else if (ctrl && k === 'd') { e.preventDefault(); toggleBookmark(); }
    else if (ctrl && k === 'h') { e.preventDefault(); openInternal('about:history'); }
    else if (ctrl && k === 'j') { e.preventDefault(); openInternal('about:downloads'); }
    else if (ctrl && e.shiftKey && k === 'o') { e.preventDefault(); openInternal('about:bookmarks'); }
    else if (ctrl && e.shiftKey && k === 'n') { e.preventDefault(); ctx.launch('browser', { private: true }); }
    else if (ctrl && k === 'n') { e.preventDefault(); ctx.launch('browser', {}); }
    else if (ctrl && k === 'p' && active.view?.capabilities.print) { e.preventDefault(); active.view.print(); }
    else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom((active.zoom || 1) + 0.1); }
    else if (ctrl && e.key === '-') { e.preventDefault(); setZoom((active.zoom || 1) - 0.1); }
    else if (ctrl && e.key === '0') { e.preventDefault(); setZoom(1); }
    else if (ctrl && e.key === 'Tab') { e.preventDefault(); const i = tabs.indexOf(active); activate(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]); }
    else if (ctrl && /^[1-9]$/.test(e.key)) { e.preventDefault(); activate(e.key === '9' ? tabs[tabs.length - 1] : tabs[Number(e.key) - 1] || active); }
  });
  // A page asked for a new window: open it as a tab in the window that page is in.
  B.onOpenRequest(({ url, from }) => { if (tabs.some((t) => t.view?.webContentsId?.() === from)) newTab(url); });
  B.onDownload((d) => {
    const prev = downloads.get(d.id);
    downloads.set(d.id, { ...prev, ...d, time: prev?.time || Date.now() });
    if (d.state !== 'progressing') saveDownloads();
    for (const p of dlPainters) p();
    if (d.state === 'completed' && !prev?.notified && win.active) {
      downloads.get(d.id).notified = true;
      ctx.notify({ title: 'Download complete', body: d.name, actions: [{ id: 'open', label: 'Open' }], data: { path: d.path } }).catch(() => {});
    }
  });
  ctx.onNotification((n) => { if (n.data?.path) ctx.open(n.data.path).catch(() => {}); });
  const setDir = () => B.setDownloadDir(P.join(me.home, 'Downloads')).catch(() => {});
  win.on('focus', setDir);
  setDir();

  function handleArgs(args) {
    if (args?.path) newTab(['.html', '.htm', '.pdf', '.svg'].includes(P.extname(args.path).toLowerCase()) ? `donut-file:${args.path}` : 'about:newtab');
    else if (args?.url) newTab(args.url);
    else if (typeof args?.search === 'string' && args.search.trim()) newTab(searchUrl(args.search.trim()));
    else if (!tabs.length) newTab(store.get('home', 'about:newtab'));
  }
  ctx.onActivate(handleArgs);
  handleArgs(ctx.args);
}
