// File Explorer: browse, organise, search, compress and move files.

import { createTabStrip, renderTabStrip, tabCloser } from '../common/tabs.js';
import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { showMenu } from '../../ui/menu.js';
import { alertDialog } from '../../ui/dialog.js';
import { debounce, formatBytes } from '../../core/util.js';
import { HOME_FOLDERS } from '../../core/vfs.js';
import { iconForEntry, fileIconUrl, appIconUrl } from '../../shell/file-icons.js';
import { openPath, openWith, launchApp } from '../../shell/apps.js';
import {
  fileClipboard, setFileClipboard, pasteInto, moveInto, trashPaths, deletePermanently, newFolder, newFile,
  renamePath, showProperties, importHostFiles, filesFromDataTransfer, hasHostFiles, DRAG_TYPE,
} from '../../shell/file-ops.js';
import { FolderView, VIEWS } from './view.js';
import { compress, extractAll, openZip, exportToHost, importFromHost } from './actions.js';
import * as P from '../../core/path.js';

const HOME = '::home';
const SEARCH = '::search';
let tabSeq = 1;

export default function main(ctx) {
  const k = ctx.privileged;
  const me = ctx.accounts.current();
  const home = me.home;
  const isAdmin = me.type === 'admin';
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'File Explorer', width: 1080, height: 680, minWidth: 520, minHeight: 360, showTitle: false });
  win.body.classList.add('explorer');

  // ── Access rules: your home and Public are yours; other users' homes need an administrator.
  const otherHome = (p) => P.isSameOrInside('/Users', p) && p !== '/Users' && !P.isSameOrInside(home, p) && !P.isSameOrInside('/Users/Public', p);
  const mine = (p) => P.isSameOrInside(home, p) || P.isSameOrInside('/Users/Public', p);
  const canRead = (p) => mine(p) || isAdmin || !otherHome(p);
  const canWrite = (p) => mine(p) || isAdmin;

  const ex = {
    ctx, k, home,
    tabs: [],
    tab: null,
    view: null,
    get settings() { return { view: store.get('view', 'details'), hidden: store.get('showHidden', false), ext: store.get('showExt', true) }; },
    cutSet: () => (fileClipboard().mode === 'cut' ? new Set(fileClipboard().paths) : new Set()),
    displayName: (e) => (ex.settings.ext || e.type === 'dir' || !e.ext ? e.name : e.name.slice(0, -e.ext.length)),
    prettyPath: (p) => (P.isSameOrInside(home, p) ? `Home${p.slice(home.length)}` : p),
    currentDir: () => (ex.tab.path.startsWith('::') ? null : ex.tab.path),
    canDropHere: () => !!ex.currentDir() && canWrite(ex.currentDir()),
  };

  // ── Layout ───────────────────────────────────────────────────────────
  const tabStrip = createTabStrip('Tabs');
  win.titlebar.append(tabStrip);
  const cmd = h('div.ex-cmd', { role: 'toolbar', 'aria-label': 'Commands' });
  const backBtn = h('button.tb-btn', { type: 'button', title: 'Back (Alt+Left)', 'aria-label': 'Back', onclick: () => goBack() }, icon('arrowLeft', { size: 16 }));
  const fwdBtn = h('button.tb-btn', { type: 'button', title: 'Forward (Alt+Right)', 'aria-label': 'Forward', onclick: () => goForward() }, icon('arrowRight', { size: 16 }));
  const upBtn = h('button.tb-btn', { type: 'button', title: 'Up (Alt+Up)', 'aria-label': 'Up', onclick: () => goUp() }, icon('chevronUp', { size: 16 }));
  const refreshBtn = h('button.tb-btn', { type: 'button', title: 'Refresh (F5)', 'aria-label': 'Refresh', onclick: () => ex.refresh() }, icon('refresh', { size: 16 }));
  const crumbs = h('div.ex-crumbs', { onclick: (e) => { if (e.target === crumbs) editAddress(); } });
  const search = h('input.ex-search', { type: 'search', 'aria-label': 'Search', spellcheck: false });
  const addr = h('div.ex-addr', backBtn, fwdBtn, upBtn, refreshBtn, crumbs, h('div.ex-searchbox', icon('search', { size: 14 }), search));
  const nav = h('nav.ex-nav', { 'aria-label': 'Navigation' });
  const content = h('div.ex-content');
  const status = h('div.app-status.ex-status');
  mount(win.body, cmd, addr, h('div.ex-main', nav, content), status);
  ex.view = new FolderView(ex);

  // ── Tabs ─────────────────────────────────────────────────────────────
  function newTab(path = HOME, { activate = true } = {}) {
    const t = { id: tabSeq++, path, back: [], fwd: [], sort: store.get('sort', { key: 'name', dir: 1 }), query: '', entries: [] };
    ex.tabs.push(t);
    if (activate) selectTab(t); else renderTabs();
    return t;
  }
  ex.newTab = (path) => newTab(path);

  function closeTab(t) {
    const i = ex.tabs.indexOf(t);
    ex.tabs.splice(i, 1);
    if (!ex.tabs.length) { win.close(); return; }
    if (ex.tab === t) selectTab(ex.tabs[Math.min(i, ex.tabs.length - 1)]); else renderTabs();
  }

  function selectTab(t) {
    ex.tab = t;
    ex.view.selected.clear();
    search.value = t.path === SEARCH ? t.query : '';
    renderTabs();
    load();
  }

  function tabTitle(t) {
    if (t.path === HOME) return 'Home';
    if (t.path === SEARCH) return `Search results in ${t.scope === home ? 'Home' : P.basename(t.scope) || 'This device'}`;
    if (t.path === '/') return 'This device';
    if (t.path === home) return 'Home';
    return P.basename(t.path);
  }

  function renderTabs() {
    renderTabStrip(tabStrip, ex.tabs.map((t) => h('div.ex-tab', {
      role: 'tab', 'aria-selected': String(t === ex.tab), class: t === ex.tab && 'active', tabindex: '0',
      onclick: () => selectTab(t), onauxclick: (e) => { if (e.button === 1) closeTab(t); },
      ondragover: (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE) && t !== ex.tab) { e.preventDefault(); clearTimeout(t.hover); t.hover = setTimeout(() => selectTab(t), 600); } },
      ondragleave: () => clearTimeout(t.hover),
    }, h('img', { src: t.path === HOME || t.path === home ? appIconUrl('explorer') : fileIconUrl('folder'), alt: '' }), h('span', tabTitle(t)),
      tabCloser(`Close ${tabTitle(t)}`, () => closeTab(t)))),
    h('button.ex-tab-new', { type: 'button', title: 'New tab (Ctrl+T or Alt+T)', 'aria-label': 'New tab', onclick: () => newTab() }, icon('plus', { size: 14 })));
    win.setTitle(`${tabTitle(ex.tab)} — File Explorer`);
  }

  // ── Navigation ───────────────────────────────────────────────────────
  async function navigate(path, { push = true } = {}) {
    if (path !== HOME && path !== SEARCH) {
      path = P.normalize(path);
      if (!canRead(path)) { await alertDialog('Access denied', 'You don’t have permission to open this folder. Ask an administrator.'); return; }
      const st = await ctx.fs.stat(path).catch(() => null);
      if (!st) { await alertDialog('Location not available', `${ex.prettyPath(path)} isn’t available. It may have been moved or deleted.`); return; }
      if (st.type !== 'dir') { ex.openEntry(st); return; }
    }
    const t = ex.tab;
    if (push && t.path !== path) { t.back.push(t.path); t.fwd = []; }
    t.path = path;
    if (path !== SEARCH) search.value = '';
    ex.view.selected.clear();
    renderTabs();
    await load();
  }
  ex.navigate = navigate;
  const goBack = () => { const t = ex.tab; if (!t.back.length) return; t.fwd.push(t.path); navigate(t.back.pop(), { push: false }); };
  const goForward = () => { const t = ex.tab; if (!t.fwd.length) return; t.back.push(t.path); navigate(t.fwd.pop(), { push: false }); };
  const goUp = () => { const d = ex.currentDir(); if (d && d !== '/') navigate(P.dirname(d)); else if (ex.tab.path === SEARCH) navigate(ex.tab.scope); };

  // ── Loading & sorting ────────────────────────────────────────────────
  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    date: (a, b) => (a.mtime || 0) - (b.mtime || 0),
    type: (a, b) => (a.ext || '').localeCompare(b.ext || '') || a.name.localeCompare(b.name),
    size: (a, b) => (a.size || 0) - (b.size || 0),
    location: (a, b) => a.path.localeCompare(b.path),
  };
  function sortEntries(list) {
    const { key, dir } = ex.tab.sort;
    const cmp = sorters[key] || sorters.name;
    // Folders always come first, like a desktop OS.
    return [...list].sort((a, b) => (a.type === b.type ? cmp(a, b) * dir : a.type === 'dir' ? -1 : 1));
  }
  ex.setSort = (key) => {
    const s = ex.tab.sort;
    ex.tab.sort = { key, dir: s.key === key ? -s.dir : key === 'date' || key === 'size' ? -1 : 1 };
    store.set('sort', ex.tab.sort);
    render();
  };

  let loadSeq = 0;
  async function load() {
    const t = ex.tab;
    const seq = ++loadSeq;
    updateNavButtons();
    renderCrumbs();
    renderNav();
    if (t.path === HOME) { renderHome(); return; }
    if (t.path === SEARCH) { await runSearch(seq); return; }
    try {
      t.entries = (await ctx.fs.readdir(t.path, { hidden: ex.settings.hidden })).filter((e) => !(t.path === '/Users' && !canRead(e.path)));
    } catch (err) {
      t.entries = [];
      if (seq === loadSeq) mount(content, h('div.empty-state', icon('warning', { size: 40 }), h('b', 'Can’t open this folder'), h('p', err.message)));
      return;
    }
    if (seq === loadSeq) render();
  }

  function render() {
    const t = ex.tab;
    if (t.path === HOME) { renderHome(); return; }
    if (!content.contains(ex.view.wrap)) mount(content, ex.view.wrap);
    const view = ex.settings.view;
    ex.view.render(sortEntries(t.entries), { view, extraColumn: t.path === SEARCH, emptyText: t.path === SEARCH ? (t.searching ? 'Searching…' : 'No items match your search.') : 'This folder is empty.' });
    renderCommands();
    renderStatus();
  }

  ex.refresh = debounce(() => load(), 60);
  ex.selectionChanged = () => { renderCommands(); renderStatus(); };

  // React to changes made anywhere (other windows, the desktop, apps).
  ctx.bus.on('fs:changed', (e) => {
    const t = ex.tab;
    if (!t) return;
    if (t.path === HOME || [e.dir, e.fromDir, e.path].includes(t.path)) ex.refresh();
    refreshNavSoon();
  });
  ctx.bus.on('shell:fileClipboard', () => { if (!ex.tab.path.startsWith('::') || ex.tab.path === SEARCH) render(); });

  // ── Search ───────────────────────────────────────────────────────────
  let searchCtrl = null;
  const startSearch = debounce(() => {
    const q = search.value.trim();
    const t = ex.tab;
    if (!q) { if (t.path === SEARCH) navigate(t.scope || home, { push: false }); return; }
    if (t.path !== SEARCH) { t.scope = t.path === HOME ? home : t.path; t.back.push(t.path); t.fwd = []; }
    t.path = SEARCH;
    t.query = q;
    renderTabs();
    load();
  }, 350);
  search.addEventListener('input', startSearch);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') startSearch.flush(); if (e.key === 'Escape') { search.value = ''; startSearch.flush(); ex.view.el.focus(); } });

  async function runSearch(seq) {
    const t = ex.tab;
    searchCtrl?.abort();
    searchCtrl = new AbortController();
    t.entries = [];
    t.searching = true;
    render();
    const found = await ctx.fs.search(t.scope, t.query, { content: true, limit: 500, hidden: ex.settings.hidden, signal: searchCtrl.signal }).catch(() => []);
    if (seq !== loadSeq) return;
    t.searching = false;
    t.entries = found.map((r) => r.entry).filter((e) => canRead(e.path));
    render();
  }

  // ── Address bar ──────────────────────────────────────────────────────
  function renderCrumbs() {
    const t = ex.tab;
    search.placeholder = `Search ${tabTitle(t.path === SEARCH ? { path: t.scope } : t)}`;
    if (t.path === HOME || t.path === SEARCH) {
      mount(crumbs, h('img', { src: appIconUrl('explorer'), alt: '' }), h('button.ex-crumb', { type: 'button', onclick: () => navigate(HOME) }, 'Home'),
        t.path === SEARCH ? [h('span.ex-sep', '›'), h('span.ex-crumb.static', `Search results for “${t.query}”`)] : null);
      return;
    }
    const inHome = P.isSameOrInside(home, t.path);
    const base = inHome ? home : '/';
    const parts = P.split(t.path.slice(base.length === 1 ? 0 : base.length));
    const items = [h('img', { src: inHome ? appIconUrl('explorer') : fileIconUrl('folder'), alt: '' }),
      h('button.ex-crumb', { type: 'button', onclick: () => navigate(base), ...crumbDrop(base) }, inHome ? 'Home' : 'This device')];
    let cur = base;
    for (const seg of parts) {
      const parent = cur;
      cur = P.join(cur, seg);
      const here = cur;
      items.push(h('button.ex-sep', { type: 'button', 'aria-label': `Folders in ${P.basename(parent) || 'This device'}`, onclick: (e) => crumbMenu(parent, e.currentTarget) }, '›'),
        h('button.ex-crumb', { type: 'button', onclick: () => navigate(here), ...crumbDrop(here) }, seg));
    }
    mount(crumbs, items);
  }

  function crumbDrop(path) {
    return {
      ondragover: (e) => { if ((e.dataTransfer.types.includes(DRAG_TYPE) || hasHostFiles(e.dataTransfer)) && canWrite(path)) { e.preventDefault(); e.currentTarget.classList.add('drop-target'); } },
      ondragleave: (e) => e.currentTarget.classList.remove('drop-target'),
      ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drop-target'); ex.dropInto(path, e); },
    };
  }

  async function crumbMenu(parent, anchor) {
    const dirs = (await ctx.fs.readdir(parent).catch(() => [])).filter((e) => e.type === 'dir' && canRead(e.path)).sort(sorters.name);
    showMenu(dirs.length ? dirs.slice(0, 40).map((d) => ({ label: d.name, icon: fileIconUrl('folder'), onSelect: () => navigate(d.path) })) : [{ label: 'No folders', disabled: true }], { anchor });
  }

  function editAddress() {
    const input = h('input.ex-addr-input', { value: ex.tab.path.startsWith('::') ? '' : ex.tab.path, 'aria-label': 'Address', spellcheck: false, list: 'ex-addr-list' });
    const list = h('datalist#ex-addr-list');
    mount(crumbs, input, list);
    input.focus(); input.select();
    const fill = debounce(async () => {
      const v = input.value;
      const dir = v.endsWith('/') ? v : P.dirname(v || '/');
      const kids = (await ctx.fs.readdir(P.normalize(dir.startsWith('/') ? dir : P.join(home, dir))).catch(() => [])).filter((e) => e.type === 'dir');
      mount(list, kids.slice(0, 50).map((e) => h('option', { value: e.path })));
    }, 150);
    input.addEventListener('input', fill);
    let done = false;
    const finish = (go) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (go && v) {
        const target = v === '~' ? home : v.startsWith('~/') ? P.join(home, v.slice(2)) : v.startsWith('/') ? v : P.join(ex.currentDir() || home, v);
        navigate(target);
      } else renderCrumbs();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
    input.addEventListener('blur', () => finish(false));
  }

  function updateNavButtons() {
    backBtn.disabled = !ex.tab.back.length;
    fwdBtn.disabled = !ex.tab.fwd.length;
    upBtn.disabled = ex.tab.path === HOME || ex.tab.path === '/';
  }

  // ── Navigation pane ──────────────────────────────────────────────────
  const expanded = new Set(store.get('expanded', []));
  const navNode = (label, path, iconUrl, { depth = 0, special } = {}) => {
    const active = ex.tab.path === (special || path);
    const isOpen = path && expanded.has(path);
    const node = h('div.ex-node', { role: 'treeitem', 'aria-selected': String(active), 'aria-expanded': path ? String(isOpen) : undefined },
      h('div.ex-nav-row', {
        class: active && 'active', style: { paddingLeft: `${8 + depth * 14}px` }, tabindex: '0',
        onclick: () => { if (special === 'bin') launchApp(k, 'recyclebin'); else navigate(special || path); },
        onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); },
        oncontextmenu: (e) => { if (path) { e.preventDefault(); navMenu(path, e); } },
        ...(path ? crumbDrop(path) : {}),
      },
      path ? h('button.ex-twisty', { type: 'button', tabindex: '-1', 'aria-label': isOpen ? 'Collapse' : 'Expand', onclick: (e) => { e.stopPropagation(); if (isOpen) expanded.delete(path); else expanded.add(path); store.set('expanded', [...expanded]); renderNav(); } }, icon(isOpen ? 'chevronDown' : 'chevronRight', { size: 12 })) : h('span.ex-twisty'),
      h('img', { src: iconUrl, alt: '' }), h('span', label)));
    if (isOpen) {
      const kids = h('div.ex-kids', { role: 'group' });
      node.append(kids);
      ctx.fs.readdir(path, { hidden: ex.settings.hidden }).then((list) => {
        mount(kids, list.filter((e) => e.type === 'dir' && canRead(e.path)).sort(sorters.name).map((e) => navNode(e.name, e.path, fileIconUrl('folder'), { depth: depth + 1 })));
      }).catch(() => {});
    }
    return node;
  };

  function renderNav() {
    const pins = store.get('pins', []).filter((p) => !HOME_FOLDERS.some((f) => P.join(home, f) === p));
    // Three trees (home, quick access, places) separated by lines.
    const tree = (label, ...nodes) => h('div.ex-tree', { role: 'tree', 'aria-label': label }, nodes);
    mount(nav,
      tree('Home', navNode('Home', null, appIconUrl('explorer'), { special: HOME })),
      h('div.ex-nav-sep', { role: 'separator' }),
      tree('Quick access', HOME_FOLDERS.map((f) => navNode(f, P.join(home, f), fileIconUrl('folder'))), pins.map((p) => navNode(P.basename(p), p, fileIconUrl('folder')))),
      h('div.ex-nav-sep', { role: 'separator' }),
      tree('Places',
        navNode(me.name, home, fileIconUrl('folder')),
        navNode('Public', '/Users/Public', fileIconUrl('folder')),
        navNode('This device', '/', iconUrlDevice()),
        navNode('Recycle Bin', null, appIconUrl('recyclebin'), { special: 'bin' })));
  }
  const refreshNavSoon = debounce(() => renderNav(), 300);
  const iconUrlDevice = () => 'assets/brand/logo.svg';

  function navMenu(path, e) {
    const pinnedNow = store.get('pins', []).includes(path);
    showMenu([
      { label: 'Open in new tab', icon: 'plus', onSelect: () => newTab(path) },
      { label: 'Open in new window', icon: 'view', onSelect: () => ctx.launch('explorer', { path }) },
      { label: pinnedNow ? 'Unpin from Quick access' : 'Pin to Quick access', icon: 'pin', onSelect: () => togglePin(path) },
      { separator: true },
      { label: 'Properties', icon: 'info', onSelect: () => showProperties(k, path) },
    ], { x: e.clientX, y: e.clientY });
  }

  function togglePin(path) {
    const pins = store.get('pins', []);
    store.set('pins', pins.includes(path) ? pins.filter((p) => p !== path) : [...pins, path]);
    renderNav();
    if (ex.tab.path === HOME) renderHome();
  }

  // ── Home ─────────────────────────────────────────────────────────────
  async function renderHome() {
    const pins = [...HOME_FOLDERS.map((f) => P.join(home, f)), ...store.get('pins', [])].filter((p, i, a) => a.indexOf(p) === i);
    const recent = [];
    for (const r of k.settings.get('start.recentFiles', ctx.system.user().id).slice(0, 20)) {
      const st = await ctx.fs.stat(r.path).catch(() => null);
      if (st && canRead(st.path)) recent.push({ ...st, opened: r.time });
    }
    mount(content, h('div.ex-home',
      h('h3', 'Quick access'),
      h('div.ex-quick', pins.map((p) => h('button.ex-quick-item', { type: 'button', onclick: () => navigate(p), oncontextmenu: (e) => { e.preventDefault(); navMenu(p, e); }, ...crumbDrop(p) },
        h('img', { src: fileIconUrl('folder'), alt: '' }), h('span', h('b', P.basename(p)), h('small', ex.prettyPath(P.dirname(p))))))),
      h('h3', 'Recent'),
      recent.length ? h('div.ex-recent', recent.map((e) => h('button.ex-recent-row', { type: 'button', onclick: () => ex.openEntry(e) },
        h('img', { src: iconForEntry(e), alt: '' }), h('span.c-name', e.name), h('span', new Date(e.opened).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })), h('span', ex.prettyPath(P.dirname(e.path))))))
        : h('p.hint', 'Files you open will show up here.')));
    renderCommands();
    mount(status, h('span', `${pins.length} pinned folders`));
  }

  // ── Opening ──────────────────────────────────────────────────────────
  ex.openEntry = (e) => {
    if (e.type === 'dir') { navigate(e.path); return; }
    if (e.ext === '.zip') { openZip(k, e.path).then((dest) => { if (dest) navigate(dest); }); return; }
    openPath(k, e.path);
  };

  // ── Commands ─────────────────────────────────────────────────────────
  const sel = () => ex.view.selectedEntries();
  const selPaths = () => sel().map((e) => e.path);

  ex.deleteSelected = async (permanent = false) => {
    const paths = selPaths().filter((p) => canWrite(p));
    if (!paths.length) return;
    if (permanent) await deletePermanently(k, paths);
    else {
      // Items outside your home (Public, system folders) can't go to your Recycle Bin.
      const binnable = paths.filter((p) => P.isSameOrInside(home, p));
      const other = paths.filter((p) => !binnable.includes(p));
      if (binnable.length) await trashPaths(k, home, binnable);
      if (other.length) await deletePermanently(k, other);
    }
  };

  ex.renameEntry = (entry, name) => (canWrite(entry.path) ? renamePath(k, entry.path, name) : alertDialog('Access denied', 'You can’t rename items here.').then(() => null));

  async function createFolder() {
    const dir = ex.currentDir();
    if (!dir || !canWrite(dir)) return;
    const p = await newFolder(k, dir);
    await load();
    const e = ex.tab.entries.find((x) => x.path === p);
    if (e) { ex.view.setSelection([p], { focus: p }); ex.view.startRename(e); }
  }

  async function createFile(base, template = '') {
    const dir = ex.currentDir();
    if (!dir || !canWrite(dir)) return;
    const p = await newFile(k, dir, base, template);
    await load();
    const e = ex.tab.entries.find((x) => x.path === p);
    if (e) { ex.view.setSelection([p], { focus: p }); ex.view.startRename(e); }
  }

  const newMenu = (anchor) => {
    const extra = k.registry.list({ includeHidden: true }).flatMap((a) => (a.newFiles || []).map((n) => ({ ...n, app: a })));
    showMenu([
      { label: 'Folder', icon: 'newFolder', hint: 'Ctrl+Shift+N', onSelect: createFolder },
      { label: 'Text document', icon: 'file', onSelect: () => createFile('New text document.txt') },
      ...extra.map((n) => ({ label: n.label, icon: n.app.icon, onSelect: () => createFile(`New ${n.label.toLowerCase()}${n.ext}`, n.template || '') })),
    ], anchor.x !== undefined ? anchor : { anchor });
  };

  const paste = async () => {
    const dir = ex.currentDir();
    if (!dir || !canWrite(dir)) return;
    const created = await pasteInto(k, dir);
    if (created.length) { await load(); ex.view.setSelection(created); }
  };

  const viewMenu = (anchor) => {
    const s = ex.settings;
    showMenu([
      ...VIEWS.map(([id, label]) => ({ label, checked: s.view === id, onSelect: () => { store.set('view', id); render(); } })),
      { separator: true },
      { label: 'Show hidden items', checked: s.hidden, onSelect: () => { store.set('showHidden', !s.hidden); load(); } },
      { label: 'Show file name extensions', checked: s.ext, onSelect: () => { store.set('showExt', !s.ext); render(); } },
    ], { anchor });
  };

  const sortMenu = (anchor) => {
    const s = ex.tab.sort;
    showMenu([
      ...[['name', 'Name'], ['date', 'Date modified'], ['type', 'Type'], ['size', 'Size']].map(([key, label]) => ({ label, checked: s.key === key, onSelect: () => { ex.tab.sort = { key, dir: s.dir }; store.set('sort', ex.tab.sort); render(); } })),
      { separator: true },
      { label: 'Ascending', checked: s.dir > 0, onSelect: () => { ex.tab.sort = { ...s, dir: 1 }; render(); } },
      { label: 'Descending', checked: s.dir < 0, onSelect: () => { ex.tab.sort = { ...s, dir: -1 }; render(); } },
    ], { anchor });
  };

  const moreMenu = (anchor) => {
    const dir = ex.currentDir();
    const s = sel();
    const zipSel = s.length === 1 && s[0].ext === '.zip';
    showMenu([
      { label: 'Select all', icon: 'check', hint: 'Ctrl+A', onSelect: () => ex.view.setSelection(ex.view.entries.map((e) => e.path)) },
      { label: 'Select none', icon: 'close', onSelect: () => ex.view.setSelection([]) },
      { label: 'Invert selection', icon: 'refresh', onSelect: () => ex.view.setSelection(ex.view.entries.map((e) => e.path).filter((p) => !ex.view.selected.has(p))) },
      { separator: true },
      { label: 'Compress to ZIP file', icon: 'file', disabled: !s.length || !dir || !canWrite(dir), onSelect: async () => { const z = await compress(k, dir, selPaths()); if (z) { await load(); ex.view.setSelection([z], { focus: z }); } } },
      { label: 'Extract all…', icon: 'folder', disabled: !zipSel, onSelect: async () => { const d = await extractAll(k, s[0].path); if (d) navigate(d); } },
      { separator: true },
      { label: 'Import files from this computer…', icon: 'upload', disabled: !dir || !canWrite(dir), onSelect: async () => { const c = await importFromHost(k, dir); if (c.length) { await load(); ex.view.setSelection(c); } } },
      { label: 'Import a folder from this computer…', icon: 'upload', disabled: !dir || !canWrite(dir), onSelect: async () => { const c = await importFromHost(k, dir, { directory: true }); if (c.length) { await load(); ex.view.setSelection(c); } } },
      { label: 'Export to this computer', icon: 'download', disabled: !s.length, onSelect: () => exportToHost(k, selPaths()) },
      { separator: true },
      { label: 'Open in Terminal', icon: 'terminal', disabled: !dir || !k.registry.has('terminal'), onSelect: () => launchApp(k, 'terminal', { cwd: dir }) },
      { label: 'Properties', icon: 'info', disabled: !dir && !s.length, onSelect: () => showProperties(k, s.length === 1 ? s[0].path : dir) },
    ], { anchor });
  };

  function renderCommands() {
    const dir = ex.currentDir();
    const s = sel();
    const writable = !!dir && canWrite(dir);
    const any = s.length > 0;
    const btn = (ic, label, fn, disabled, hint) => h('button.btn.subtle.ex-cmdbtn', { type: 'button', disabled, title: hint ? `${label} (${hint})` : label, 'aria-label': label, onclick: fn }, icon(ic, { size: 16 }), h('span', label));
    mount(cmd,
      h('button.btn.subtle.ex-cmdbtn.ex-new', { type: 'button', disabled: !writable, onclick: (e) => newMenu(e.currentTarget) }, icon('plus', { size: 16 }), h('span', 'New'), icon('chevronDown', { size: 12 })),
      h('span.tb-sep'),
      btn('cut', 'Cut', () => setFileClipboard(k, 'cut', selPaths()), !any || !s.every((e) => canWrite(e.path)), 'Ctrl+X'),
      btn('copy', 'Copy', () => setFileClipboard(k, 'copy', selPaths()), !any, 'Ctrl+C'),
      btn('paste', 'Paste', paste, !writable || !fileClipboard().paths.length, 'Ctrl+V'),
      btn('edit', 'Rename', () => { const e = s[0]; if (e) ex.view.startRename(e); }, s.length !== 1 || !canWrite(s[0]?.path || ''), 'F2'),
      btn('download', 'Export', () => exportToHost(k, selPaths()), !any),
      btn('trash', 'Delete', () => ex.deleteSelected(false), !any || !s.every((e) => canWrite(e.path)), 'Del'),
      h('span.tb-sep'),
      h('button.btn.subtle.ex-cmdbtn', { type: 'button', disabled: ex.tab.path === HOME, onclick: (e) => sortMenu(e.currentTarget) }, icon('sort', { size: 16 }), h('span', 'Sort'), icon('chevronDown', { size: 12 })),
      h('button.btn.subtle.ex-cmdbtn', { type: 'button', onclick: (e) => viewMenu(e.currentTarget) }, icon('view', { size: 16 }), h('span', 'View'), icon('chevronDown', { size: 12 })),
      h('button.btn.subtle.ex-cmdbtn', { type: 'button', title: 'See more', 'aria-label': 'See more', onclick: (e) => moreMenu(e.currentTarget) }, h('span', '···')));
  }

  function renderStatus() {
    const s = sel();
    const total = s.reduce((n, e) => n + (e.type === 'file' ? e.size : 0), 0);
    const v = ex.settings.view;
    mount(status,
      h('span', `${ex.view.entries.length} item${ex.view.entries.length === 1 ? '' : 's'}`),
      s.length ? h('span', `${s.length} item${s.length === 1 ? '' : 's'} selected${total ? `  ${formatBytes(total)}` : ''}`) : null,
      h('span', { style: { flex: 1 } }),
      h('button.tb-btn', { type: 'button', title: 'Details', 'aria-label': 'Details view', class: v === 'details' && 'on', onclick: () => { store.set('view', 'details'); render(); } }, icon('sort', { size: 14 })),
      h('button.tb-btn', { type: 'button', title: 'Large icons', 'aria-label': 'Large icons view', class: v === 'large' && 'on', onclick: () => { store.set('view', 'large'); render(); } }, icon('view', { size: 14 })));
  }

  // ── Context menus ────────────────────────────────────────────────────
  ex.itemMenu = (e) => {
    const s = sel();
    const one = s.length === 1 ? s[0] : null;
    const dir = ex.currentDir() || (one ? P.dirname(one.path) : null);
    const writable = s.every((x) => canWrite(x.path));
    showMenu([
      { label: 'Open', icon: 'arrowRight', onSelect: () => s.forEach((x) => ex.openEntry(x)) },
      ...(one?.type === 'file' ? [{ label: 'Open with…', icon: 'apps', onSelect: () => openWith(k, one.path) }] : []),
      ...(one?.type === 'dir' ? [
        { label: 'Open in new tab', icon: 'plus', onSelect: () => newTab(one.path) },
        { label: 'Open in new window', icon: 'view', onSelect: () => ctx.launch('explorer', { path: one.path }) },
        { label: store.get('pins', []).includes(one.path) ? 'Unpin from Quick access' : 'Pin to Quick access', icon: 'pin', onSelect: () => togglePin(one.path) },
      ] : []),
      ...(ex.tab.path === SEARCH && one ? [{ label: 'Open file location', icon: 'folder', onSelect: () => navigate(P.dirname(one.path)) }] : []),
      { separator: true },
      { label: 'Cut', icon: 'cut', hint: 'Ctrl+X', disabled: !writable, onSelect: () => setFileClipboard(k, 'cut', selPaths()) },
      { label: 'Copy', icon: 'copy', hint: 'Ctrl+C', onSelect: () => setFileClipboard(k, 'copy', selPaths()) },
      ...(one?.type === 'dir' && fileClipboard().paths.length ? [{ label: 'Paste into folder', icon: 'paste', onSelect: () => pasteInto(k, one.path) }] : []),
      { label: 'Copy as path', icon: 'clipboard', onSelect: () => ctx.clipboard.writeText(selPaths().join('\n')) },
      { separator: true },
      { label: 'Compress to ZIP file', icon: 'file', disabled: !dir || !canWrite(dir), onSelect: async () => { const z = await compress(k, dir, selPaths()); if (z) { await load(); ex.view.setSelection([z], { focus: z }); } } },
      ...(one?.ext === '.zip' ? [{ label: 'Extract all…', icon: 'folder', onSelect: async () => { const d = await extractAll(k, one.path); if (d) navigate(d); } }] : []),
      { label: 'Export to this computer', icon: 'download', onSelect: () => exportToHost(k, selPaths()) },
      { separator: true },
      { label: 'Rename', icon: 'edit', hint: 'F2', disabled: !one || !writable, onSelect: () => ex.view.startRename(one) },
      { label: 'Delete', icon: 'trash', hint: 'Del', disabled: !writable, onSelect: () => ex.deleteSelected(false) },
      { separator: true },
      { label: 'Properties', icon: 'info', disabled: !one, onSelect: () => showProperties(k, one.path) },
    ], { x: e.clientX, y: e.clientY });
  };

  ex.backgroundMenu = (e) => {
    const dir = ex.currentDir();
    if (!dir) return;
    const writable = canWrite(dir);
    const s = ex.settings;
    showMenu([
      { header: 'View' },
      ...VIEWS.map(([id, label]) => ({ label, checked: s.view === id, onSelect: () => { store.set('view', id); render(); } })),
      { header: 'Sort by' },
      ...[['name', 'Name'], ['date', 'Date modified'], ['type', 'Type'], ['size', 'Size']].map(([key, label]) => ({ label, checked: ex.tab.sort.key === key, onSelect: () => ex.setSort(key) })),
      { separator: true },
      { label: 'Refresh', icon: 'refresh', hint: 'F5', onSelect: () => load() },
      { label: 'Paste', icon: 'paste', hint: 'Ctrl+V', disabled: !writable || !fileClipboard().paths.length, onSelect: paste },
      { label: 'New', icon: 'plus', disabled: !writable, onSelect: () => newMenu({ x: e.clientX, y: e.clientY }) },
      { label: 'Import from this computer…', icon: 'upload', disabled: !writable, onSelect: async () => { const c = await importFromHost(k, dir); if (c.length) { await load(); ex.view.setSelection(c); } } },
      { label: 'Open in Terminal', icon: 'terminal', disabled: !k.registry.has('terminal'), onSelect: () => launchApp(k, 'terminal', { cwd: dir }) },
      { separator: true },
      { label: 'Properties', icon: 'info', onSelect: () => showProperties(k, dir) },
    ], { x: e.clientX, y: e.clientY });
  };

  // ── Drag and drop ────────────────────────────────────────────────────
  ex.dropInto = async (dir, e) => {
    if (!canWrite(dir)) { await alertDialog('Access denied', 'You can’t add items to this folder.'); return; }
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (raw) {
      const paths = JSON.parse(raw);
      const moved = await moveInto(k, paths, dir, { copy: e.ctrlKey || !paths.every((p) => canWrite(p)) });
      if (dir === ex.currentDir() && moved.length) { await load(); ex.view.setSelection(moved); }
      return;
    }
    if (hasHostFiles(e.dataTransfer)) {
      const created = await importHostFiles(k, dir, await filesFromDataTransfer(e.dataTransfer));
      if (dir === ex.currentDir() && created.length) { await load(); ex.view.setSelection(created); }
    }
  };

  // Chromium lets a drag carry a file out to the real desktop ("DownloadURL").
  ex.prepareHostDrag = (e, paths) => {
    if (paths.length !== 1) return;
    const entry = ex.view.entries.find((x) => x.path === paths[0]);
    if (!entry || entry.type !== 'file' || entry.size > 50 * 1024 * 1024) return;
    const url = ex.hostUrls?.get(entry.path);
    if (url) e.dataTransfer.setData('DownloadURL', `${entry.mime}:${entry.name}:${url}`);
  };
  ex.hostUrls = new Map();
  // Prepare object URLs for files as they're hovered, so a drag can use them synchronously.
  ctx.listen(ex.view.el, 'pointerover', async (e) => {
    const entry = ex.view.entryFor(e.target);
    if (!entry || entry.type !== 'file' || entry.size > 50 * 1024 * 1024 || ex.hostUrls.has(entry.path)) return;
    try {
      const url = URL.createObjectURL(await ctx.fs.readBlob(entry.path));
      ex.hostUrls.set(entry.path, url);
      if (ex.hostUrls.size > 40) { const [first, u] = ex.hostUrls.entries().next().value; URL.revokeObjectURL(u); ex.hostUrls.delete(first); }
    } catch { /* unreadable */ }
  });
  ctx.onExit(() => { for (const u of ex.hostUrls.values()) URL.revokeObjectURL(u); });

  // ── Keyboard ─────────────────────────────────────────────────────────
  ctx.listen(win.body, 'keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const inField = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.altKey && e.key === 'ArrowLeft') { handled(); goBack(); }
    else if (e.altKey && e.key === 'ArrowRight') { handled(); goForward(); }
    else if (e.altKey && e.key === 'ArrowUp') { handled(); goUp(); }
    else if (e.key === 'Backspace' && !inField) { handled(); goBack(); }
    else if (e.key === 'F5') { handled(); load(); }
    else if ((ctrl && (e.code === 'KeyL')) || (e.altKey && e.code === 'KeyD')) { handled(); editAddress(); }
    else if (ctrl && (e.code === 'KeyF' || e.code === 'KeyE')) { handled(); search.focus(); search.select(); }
    // Browsers keep Ctrl+T/W/N for themselves outside full screen, so Alt+T/W/N work too.
    else if ((ctrl || e.altKey) && e.code === 'KeyT' && !e.shiftKey) { handled(); newTab(); }
    else if ((ctrl || e.altKey) && e.code === 'KeyW' && !e.shiftKey) { handled(); closeTab(ex.tab); }
    else if ((ctrl || e.altKey) && e.code === 'KeyN' && !e.shiftKey) { handled(); ctx.launch('explorer', { path: ex.currentDir() || HOME }); }
    else if (ctrl && e.shiftKey && e.code === 'KeyN') { handled(); createFolder(); }
    else if (ctrl && e.key === 'Tab') { handled(); const i = ex.tabs.indexOf(ex.tab); selectTab(ex.tabs[(i + (e.shiftKey ? -1 : 1) + ex.tabs.length) % ex.tabs.length]); }
    else if (!inField && ctrl && e.code === 'KeyC' && sel().length) { handled(); setFileClipboard(k, 'copy', selPaths()); }
    else if (!inField && ctrl && e.code === 'KeyX' && sel().length) { handled(); setFileClipboard(k, 'cut', selPaths()); }
    else if (!inField && ctrl && e.code === 'KeyV') { handled(); paste(); }
  });

  // ── Start ────────────────────────────────────────────────────────────
  const expand = (p) => (p && p.startsWith('~') ? P.join(home, p.slice(1)) : p);
  ctx.onActivate((args) => { win.focus(); if (args?.path) newTab(expand(args.path)); });
  const start = expand(ctx.args.path);
  newTab(HOME);
  if (start) {
    if (start.endsWith('.zip')) openZip(k, start).then((d) => { if (d) navigate(d); });
    else navigate(start, { push: false });
  }
}
