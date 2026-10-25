// Store: find, install, update and uninstall apps. Apps come from the DonutOS catalog
// (shipped with DonutOS, so it works offline), from other catalogs you add by web address,
// from .dapp files, or from a direct link to a .dapp. Every Store app runs sandboxed and
// only gets the permissions shown before you install it.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { dialog, confirmDialog, alertDialog, promptDialog } from '../../ui/dialog.js';
import { openFileDialog } from '../../ui/file-dialog.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { parseDapp, compareVersions } from '../../core/dapp.js';
import { formatBytes } from '../../core/util.js';
import { setPinned, isPinned, uninstallApp } from '../../shell/apps.js';

const BUILTIN_CATALOG = new URL('../../store/catalog/index.json', import.meta.url).href;

export default function main(ctx) {
  const k = ctx.privileged;
  const me = ctx.accounts.current();
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'Store', width: 1120, height: 740, minWidth: 520, minHeight: 420 });
  win.body.classList.add('storeapp');

  let page = { name: 'home' };
  const history = [];
  let catalog = [];          // [{ ...entry, source: { name, url } }]
  let loadErrors = [];
  let query = '';
  let category = null;
  const busy = new Set();    // app ids being installed

  const nav = h('nav.st-nav');
  const content = h('main.st-content');
  mount(win.body, nav, content);

  // ── Catalogs ─────────────────────────────────────────────────────────
  const catalogs = () => [{ name: 'DonutOS Store', url: BUILTIN_CATALOG, builtin: true }, ...store.get('catalogs', [])];
  async function loadCatalogs() {
    loadErrors = [];
    const out = [];
    for (const c of catalogs()) {
      try {
        const res = c.builtin ? await fetch(c.url) : await ctx.net.fetch(c.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        for (const a of json.apps || []) {
          if (!a?.id || !a.package) continue;
          out.push({ ...a, packageUrl: new URL(a.package, c.url).href, source: { name: json.name || c.name, url: c.url, builtin: !!c.builtin } });
        }
      } catch (err) { loadErrors.push(`${c.name}: ${err.name === 'PermissionError' ? 'internet access is off for Store' : err.message}`); }
    }
    // The first catalog to list an id wins (the DonutOS catalog comes first).
    const seen = new Set();
    catalog = out.filter((a) => !seen.has(a.id) && seen.add(a.id));
    render();
  }

  const installed = (id) => { const a = k.registry.get(id); return a && a.installed ? a : null; };
  const updateFor = (a) => { const cur = installed(a.id); return cur && compareVersions(a.version, cur.version) > 0; };

  // ── Install / update / uninstall ─────────────────────────────────────
  async function fetchPackage(url, { builtin = false } = {}) {
    const res = builtin ? await fetch(url) : await ctx.net.fetch(url);
    if (!res.ok) throw new Error(`The package couldn’t be downloaded (HTTP ${res.status})`);
    return parseDapp(await res.text());
  }

  function permissionList(perms) {
    if (!perms.length) return h('p.hint', 'This app doesn’t ask for any permissions.');
    return h('ul.st-perms', perms.map((p) => h('li', icon(PERMISSIONS[p]?.sensitive ? 'shield' : 'check', { size: 14 }), h('div', h('b', PERMISSIONS[p]?.label || p), h('small', PERMISSIONS[p]?.description || '')))));
  }

  /** Installs a parsed manifest after showing what it will be allowed to ask for. */
  async function install(manifest, origin) {
    const existing = k.registry.get(manifest.id);
    if (existing?.builtin) { alertDialog('Can’t install', `“${manifest.name}” uses the same ID as a built-in app.`, { parent: win.body }); return false; }
    const updating = !!existing;
    if (updating && compareVersions(manifest.version, existing.version) < 0
      && !(await confirmDialog('Install an older version?', `Version ${existing.version} is installed; this package is ${manifest.version}.`, { ok: 'Install anyway', parent: win.body }))) return false;
    const fromOutside = !origin.builtin;
    const ok = await dialog({
      title: updating ? `Update ${manifest.name}?` : `Install ${manifest.name}?`, parent: win.body, width: 480, cancelValue: false,
      body: h('div.st-confirm',
        h('div.row', h('img', { src: manifest.icon || k.registry.get('store')?.icon, alt: '', width: 48, height: 48 }), h('div', h('b', manifest.name), h('div.hint', `${manifest.author} · version ${manifest.version}`))),
        h('p', 'It can ask for:'), permissionList(manifest.permissions || []),
        h('p.hint', 'Store apps run in a sandbox: they can’t see other apps or your files unless you allow it. You’ll be asked before an app first uses a permission.'),
        fromOutside ? h('p.st-warn', icon('warning', { size: 14 }), `From ${origin.label}. Only install apps from people you trust.`) : null),
      buttons: [{ label: updating ? 'Update' : 'Install', value: true, primary: true }, { label: 'Cancel', value: false }],
    });
    if (!ok) return false;
    busy.add(manifest.id); render();
    try {
      // Close the running app so the new version starts fresh.
      for (const p of k.processes.byApp(manifest.id)) await k.processes.kill(p.pid, { force: true });
      await k.registry.install({ ...manifest, store: { from: origin.label, catalog: origin.catalog || null, url: origin.url || null } });
      ctx.notify({ title: updating ? `${manifest.name} was updated` : `${manifest.name} is installed`, body: 'Find it in Start.', actions: [{ id: 'open', label: 'Open' }], data: { open: manifest.id } }).catch(() => {});
      return true;
    } catch (err) {
      alertDialog(`Couldn’t install ${manifest.name}`, err.message, { parent: win.body });
      return false;
    } finally { busy.delete(manifest.id); render(); }
  }

  async function installEntry(a) {
    busy.add(a.id); render();
    let manifest;
    try { manifest = await fetchPackage(a.packageUrl, { builtin: a.source.builtin }); }
    catch (err) { busy.delete(a.id); render(); alertDialog(`Couldn’t get ${a.name}`, err.name === 'PermissionError' ? 'Store needs internet access for this catalog.' : err.message, { parent: win.body }); return; }
    busy.delete(a.id);
    if (manifest.id !== a.id) { alertDialog('Package mismatch', `The catalog lists “${a.id}” but the package contains “${manifest.id}”.`, { parent: win.body }); render(); return; }
    await install(manifest, { label: a.source.name, builtin: a.source.builtin, catalog: a.source.url, url: a.packageUrl });
  }

  async function uninstall(app) {
    if (!(await confirmDialog(`Uninstall ${app.name}?`, 'The app and its settings for your account are removed. Files you saved with it stay where they are.', { ok: 'Uninstall', danger: true, parent: win.body }))) return;
    try {
      await uninstallApp(k, app.id, me.id);
    } catch (err) { alertDialog('Couldn’t uninstall', err.message, { parent: win.body }); }
    render();
  }

  async function installFromFile(path) {
    if (typeof path !== 'string') path = await openFileDialog(ctx, win, { title: 'Install an app from a file', filters: [{ label: 'DonutOS apps', exts: ['.dapp'] }] });
    if (!path) return;
    try { const m = parseDapp(await ctx.fs.readText(path)); show({ name: 'package', manifest: m, origin: { label: `the file ${path.split('/').pop()}`, url: null } }); }
    catch (err) { alertDialog('This file can’t be installed', err.message, { parent: win.body }); }
  }
  async function installFromUrl() {
    const url = await promptDialog('Install from a web address', { label: 'Link to a .dapp file (https://…)', value: 'https://', parent: win.body,
      validate: (v) => (/^https:\/\/\S+$/.test(v.trim()) ? '' : 'Use a full https:// address') });
    if (!url) return;
    try { const m = await fetchPackage(url.trim()); show({ name: 'package', manifest: m, origin: { label: new URL(url).hostname, url: url.trim() } }); }
    catch (err) { alertDialog('Couldn’t get the app', err.name === 'PermissionError' ? 'Store needs internet access to download apps. You can allow it in Settings › Privacy & security.' : err.message, { parent: win.body }); }
  }
  async function addCatalog() {
    const url = await promptDialog('Add a catalog', { label: 'Address of a catalog (index.json)', value: 'https://', parent: win.body,
      validate: (v) => (/^https:\/\/\S+$/.test(v.trim()) ? (catalogs().some((c) => c.url === v.trim()) ? 'That catalog is already added' : '') : 'Use a full https:// address') });
    if (!url) return;
    try {
      const res = await ctx.net.fetch(url.trim());
      const json = await res.json();
      if (!Array.isArray(json.apps)) throw new Error('This address isn’t a DonutOS catalog (no "apps" list).');
      store.set('catalogs', [...store.get('catalogs', []), { name: String(json.name || new URL(url).hostname).slice(0, 60), url: url.trim() }]);
      loadCatalogs();
    } catch (err) { alertDialog('Couldn’t add the catalog', err.name === 'PermissionError' ? 'Store needs internet access for this.' : err.message, { parent: win.body }); }
  }

  // ── Navigation ───────────────────────────────────────────────────────
  function show(p, { push = true } = {}) { if (push) history.push(page); page = p; render(); content.scrollTop = 0; }
  function back() { page = history.pop() || { name: 'home' }; render(); }
  function renderNav() {
    const updates = catalog.filter(updateFor).length;
    const item = (name, label, ic, badge) => h('button.st-navitem', { type: 'button', 'aria-current': page.name === name ? 'page' : undefined, onclick: () => { history.length = 0; category = null; show({ name }, { push: false }); } },
      icon(ic, { size: 18 }), h('span', label), badge ? h('b.st-badge', { title: `${badge} update${badge === 1 ? '' : 's'}` }, String(badge)) : null);
    mount(nav, item('home', 'Home', 'apps'), item('library', 'Library', 'list', updates), item('sources', 'Sources', 'globe'));
  }

  function actionButton(a, { big = false } = {}) {
    const cur = installed(a.id);
    const cls = big ? 'button.btn.primary.st-big' : 'button.btn';
    if (busy.has(a.id)) return h(cls, { type: 'button', disabled: true }, h('span.br-spin'), 'Installing…');
    if (cur && updateFor(a)) return h(`${cls}.primary`, { type: 'button', onclick: (e) => { e.stopPropagation(); installEntry(a); } }, 'Update');
    if (cur) return h(cls.replace('.primary', ''), { type: 'button', onclick: (e) => { e.stopPropagation(); k.launch(a.id).catch((err) => alertDialog('Couldn’t open', err.message, { parent: win.body })); } }, 'Open');
    return h(cls, { type: 'button', onclick: (e) => { e.stopPropagation(); installEntry(a); } }, 'Install');
  }
  const card = (a) => h('div.st-card', { role: 'button', tabindex: '0', onclick: () => show({ name: 'app', id: a.id }), onkeydown: (e) => { if (e.key === 'Enter') show({ name: 'app', id: a.id }); } },
    h('img', { src: a.icon, alt: '', width: 56, height: 56 }),
    h('div.st-cardtext', h('b', a.name), h('small', a.category), h('p', a.summary || a.description)),
    h('div.st-cardfoot', installed(a.id) ? h('small.st-ok', icon('check', { size: 12 }), updateFor(a) ? 'Update available' : 'Installed') : h('small', a.author), actionButton(a)));

  // ── Pages ────────────────────────────────────────────────────────────
  function render() {
    renderNav();
    win.setTitle('Store');
    ({ home: renderHome, app: renderApp, package: renderPackage, library: renderLibrary, sources: renderSources })[page.name]();
  }

  function renderHome() {
    const search = h('input.input.st-search', { type: 'search', placeholder: 'Search apps and games', value: query, 'aria-label': 'Search apps and games',
      oninput: (e) => { query = e.target.value.trim().toLowerCase(); paint(); } });
    const cats = [...new Set(catalog.map((a) => a.category))].sort();
    const grid = h('div.st-grid');
    const paint = () => {
      const list = catalog.filter((a) => (!category || a.category === category) && (!query || `${a.name} ${a.summary} ${a.description} ${a.author} ${a.category}`.toLowerCase().includes(query)));
      mount(grid, list.length ? list.map(card) : h('div.ph-empty', icon('search', { size: 36 }), h('b', catalog.length ? 'No apps match' : 'No apps to show'), h('p', loadErrors.join(' · ') || 'Add a catalog in Sources to see more apps.')));
    };
    const featured = catalog.find((a) => !installed(a.id)) || catalog[0];
    mount(content,
      h('div.st-top', h('h1', 'Store'), search),
      featured && !query && !category ? h('div.st-hero', { onclick: () => show({ name: 'app', id: featured.id }) },
        h('img', { src: featured.icon, alt: '', width: 96, height: 96 }), h('div', h('small', 'Featured'), h('h2', featured.name), h('p', featured.description), actionButton(featured, { big: true }))) : null,
      h('div.st-cats', h('button.btn', { type: 'button', 'aria-pressed': String(!category), onclick: () => { category = null; renderHome(); } }, 'All'),
        cats.map((c) => h('button.btn', { type: 'button', 'aria-pressed': String(category === c), onclick: () => { category = c; renderHome(); } }, c))),
      loadErrors.length && catalog.length ? h('p.st-warn', icon('warning', { size: 14 }), loadErrors.join(' · ')) : null,
      grid);
    paint();
  }

  function detailsBlock(m, origin) {
    return [
      h('h3', 'About this app'), h('p.st-desc', m.description || 'No description.'),
      m.features?.length ? [h('h3', 'Features'), h('ul.st-features', m.features.map((f) => h('li', f)))] : null,
      h('h3', 'Permissions'), permissionList(m.permissions || []),
      h('h3', 'Information'),
      h('dl.tm-props', h('dt', 'Developer'), h('dd', m.author || '—'), h('dt', 'Version'), h('dd', m.version), h('dt', 'Category'), h('dd', m.category || '—'),
        m.size ? [h('dt', 'Size'), h('dd', formatBytes(m.size))] : null, h('dt', 'Source'), h('dd', origin),
        m.fileTypes?.length ? [h('dt', 'Opens'), h('dd', m.fileTypes.join(', '))] : null),
    ];
  }

  function renderApp() {
    const a = catalog.find((x) => x.id === page.id);
    const cur = installed(page.id);
    if (!a && !cur) { mount(content, h('div.ph-empty', h('b', 'This app isn’t available'), h('button.btn', { type: 'button', onclick: back }, 'Back'))); return; }
    const m = a || cur;
    win.setTitle(`${m.name} — Store`);
    mount(content,
      h('button.btn.subtle.st-back', { type: 'button', onclick: back }, icon('arrowLeft', { size: 14 }), 'Back'),
      h('div.st-apphead', h('img', { src: m.icon, alt: '', width: 112, height: 112 }),
        h('div.st-appinfo', h('h1', m.name), h('div.hint', `${m.author || 'Unknown developer'} · ${m.category || 'Other'}`),
          cur ? h('div.st-ok', icon('check', { size: 14 }), `Installed · version ${cur.version}`, a && updateFor(a) ? ` · version ${a.version} available` : '') : null,
          h('div.row', a ? actionButton(a, { big: true }) : h('button.btn.primary.st-big', { type: 'button', onclick: () => k.launch(cur.id) }, 'Open'),
            cur ? [h('button.btn', { type: 'button', onclick: () => pinToggle(cur.id, 'start') }, isPinned(k, 'start', cur.id) ? 'Unpin from Start' : 'Pin to Start'),
              h('button.btn', { type: 'button', onclick: () => pinToggle(cur.id, 'taskbar') }, isPinned(k, 'taskbar', cur.id) ? 'Unpin from taskbar' : 'Pin to taskbar'),
              h('button.btn.subtle', { type: 'button', onclick: () => uninstall(cur) }, 'Uninstall')] : null))),
      detailsBlock(m, a ? a.source.name : cur.store?.from || 'Installed'));
  }
  function pinToggle(id, where) { setPinned(k, where, id, !isPinned(k, where, id)); render(); }

  function renderPackage() {
    const m = page.manifest;
    const cur = k.registry.get(m.id);
    mount(content,
      h('button.btn.subtle.st-back', { type: 'button', onclick: back }, icon('arrowLeft', { size: 14 }), 'Back'),
      h('div.st-apphead', h('img', { src: m.icon || k.registry.get('store')?.icon, alt: '', width: 112, height: 112 }),
        h('div.st-appinfo', h('h1', m.name), h('div.hint', `${m.author} · ${m.category}`),
          cur ? h('div.hint', `Version ${cur.version} is installed.`) : null,
          h('p.st-warn', icon('warning', { size: 14 }), `This app comes from ${page.origin.label}, not from a catalog.`),
          h('div.row', h('button.btn.primary.st-big', { type: 'button', disabled: busy.has(m.id), onclick: async () => { if (await install(m, page.origin)) show({ name: 'app', id: m.id }, { push: false }); } }, cur ? 'Install this version' : 'Install')))),
      detailsBlock({ ...m, size: m.source.length }, page.origin.label));
  }

  function renderLibrary() {
    const apps = k.registry.list({ includeHidden: true }).filter((a) => a.installed);
    const updates = catalog.filter(updateFor);
    mount(content,
      h('div.st-top', h('h1', 'Library'),
        h('button.btn', { type: 'button', onclick: loadCatalogs }, icon('refresh', { size: 14 }), 'Check for updates'),
        updates.length ? h('button.btn.primary', { type: 'button', onclick: async () => { for (const a of updates) await installEntry(a); } }, `Update all (${updates.length})`) : null),
      apps.length ? h('div.st-lib', apps.map((a) => {
        const entry = catalog.find((x) => x.id === a.id);
        return h('div.st-libitem', h('img', { src: a.icon, alt: '', width: 36, height: 36 }),
          h('div.grow', h('b', a.name), h('small', `Version ${a.version} · ${a.store?.from || 'Installed'} · installed ${new Date(a.installedAt).toLocaleDateString()}`)),
          entry && updateFor(entry) ? h('button.btn.primary', { type: 'button', onclick: () => installEntry(entry) }, `Update to ${entry.version}`) : null,
          h('button.btn', { type: 'button', onclick: () => k.launch(a.id) }, 'Open'),
          h('button.btn.subtle', { type: 'button', onclick: () => show({ name: 'app', id: a.id }) }, 'Details'),
          h('button.btn.subtle', { type: 'button', onclick: () => uninstall(a) }, 'Uninstall'));
      })) : h('div.ph-empty', icon('apps', { size: 36 }), h('b', 'No apps installed from the Store yet'), h('button.btn.primary', { type: 'button', onclick: () => show({ name: 'home' }, { push: false }) }, 'Browse apps')));
  }

  function renderSources() {
    mount(content, h('div.st-top', h('h1', 'Sources')),
      h('h3', 'Catalogs'),
      h('div.st-lib', catalogs().map((c) => h('div.st-libitem', icon(c.builtin ? 'apps' : 'globe', { size: 22 }),
        h('div.grow', h('b', c.name), h('small', c.builtin ? 'Comes with DonutOS · works offline' : c.url)),
        c.builtin ? null : h('button.btn.subtle', { type: 'button', onclick: () => { store.set('catalogs', store.get('catalogs', []).filter((x) => x.url !== c.url)); loadCatalogs(); } }, 'Remove')))),
      h('div.row', h('button.btn', { type: 'button', onclick: addCatalog }, icon('plus', { size: 14 }), 'Add a catalog…')),
      h('h3', 'Install an app directly'),
      h('div.row', h('button.btn', { type: 'button', onclick: () => installFromFile() }, icon('folder', { size: 14 }), 'From a .dapp file…'), h('button.btn', { type: 'button', onclick: installFromUrl }, icon('download', { size: 14 }), 'From a web address…')),
      h('p.hint', 'Developers: see docs/SDK.md, or run “dapp new MyApp” in Terminal to start an app and “dapp install” to try it.'),
      loadErrors.length ? h('p.st-warn', icon('warning', { size: 14 }), loadErrors.join(' · ')) : null);
  }

  // ── Wiring ───────────────────────────────────────────────────────────
  ctx.bus.on('apps:*', () => render());
  ctx.onNotification((n) => { if (n.data?.open) k.launch(n.data.open).catch(() => {}); });
  ctx.listen(win.body, 'keydown', (e) => {
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); show({ name: 'home' }, { push: false }); setTimeout(() => content.querySelector('.st-search')?.focus()); }
  });
  const handle = (args) => {
    if (args?.path) installFromFile(args.path);
    else if (args?.app) show({ name: 'app', id: args.app });
    else if (args?.page) show({ name: args.page }, { push: false });
  };
  ctx.onActivate((args) => { win.focus(); handle(args); });
  render();
  loadCatalogs().then(() => handle(ctx.args));
}
