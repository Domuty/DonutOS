// Search: apps, settings and files (names and text contents) in your user folder,
// plus a web search link. Keyboard: ↑/↓ to move, Enter to open.

import { h, mount } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { launchApp, openPath, rememberRecentApp } from './apps.js';
import { iconForEntry, typeName, appIconUrl } from './file-icons.js';
import { svgSearch, relTime } from './start-menu.js';
import { SETTINGS_INDEX, PAGES } from '../apps/settings/index-data.js';
import { dirname } from '../core/path.js';

const score = (text, q) => {
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  return 0;
};

export class Search {
  constructor(session) {
    this.s = session;
    this.kernel = session.kernel;
    this.settings = session.settings;
    this.results = [];
    this.selected = 0;
    this.abort = null;
    this.f = session.flyouts.add('search', {
      className: 'fly-search', label: 'Search',
      onOpen: (args) => this.open(args?.query || ''),
      onClose: () => { this.abort?.abort(); },
    });
    this.input = h('input.start-search', {
      type: 'search', placeholder: 'Type here to search', 'aria-label': 'Search', 'aria-controls': 'search-results', autocomplete: 'off', spellcheck: false,
      oninput: () => this.run(),
      onkeydown: (e) => this.onKey(e),
    });
    this.list = h('div.search-list', { id: 'search-results', role: 'listbox', 'aria-label': 'Results' });
    this.detail = h('div.search-detail');
    mount(this.f.el, h('div.start-top', h('div.start-searchbox', svgSearch(), this.input)), h('div.search-cols', this.list, this.detail));
  }

  open(query) {
    this.input.value = query;
    this.input.focus();
    this.input.setSelectionRange(query.length, query.length);
    this.run();
  }

  onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); this.select(Math.min(this.results.length - 1, this.selected + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.select(Math.max(0, this.selected - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); this.results[this.selected]?.open(); }
  }

  close() { this.s.flyouts.close('search'); }

  remember(q) {
    if (!this.settings.get('privacy.searchHistory') || !q) return;
    const hist = this.settings.get('search.history').filter((x) => x !== q);
    this.settings.set('search.history', [q, ...hist].slice(0, 10));
  }

  async run() {
    const q = this.input.value.trim().toLowerCase();
    this.abort?.abort();
    if (!q) { this.renderHome(); return; }
    const ctrl = (this.abort = new AbortController());
    const wrap = (r) => ({ ...r, open: () => { this.remember(this.input.value.trim()); this.close(); r.run(); } });

    const apps = this.kernel.registry.list()
      .map((a) => ({ a, sc: Math.max(score(a.name, q), score(a.id, q) - 10, a.description && a.description.toLowerCase().includes(q) ? 20 : 0) }))
      .filter((x) => x.sc > 0).sort((x, y) => y.sc - x.sc).slice(0, 6)
      .map(({ a, sc }) => wrap({ group: 'Apps', score: sc + 5, title: a.name, sub: 'App', icon: a.icon, app: a, run: () => { rememberRecentApp(this.kernel, a.id); launchApp(this.kernel, a.id); } }));

    const settings = SETTINGS_INDEX
      .map((e) => ({ e, sc: Math.max(score(e.title, q), e.keywords.includes(q) ? 30 : 0) }))
      .filter((x) => x.sc > 0).sort((x, y) => y.sc - x.sc)
      .filter((x, i, arr) => arr.findIndex((y) => y.e.title === x.e.title) === i).slice(0, 5)
      .map(({ e, sc }) => wrap({ group: 'Settings', score: sc, title: e.title, sub: `Settings › ${PAGES[e.page].title}`, icon: appIconUrl('settings'), run: () => launchApp(this.kernel, 'settings', { page: e.page }) }));

    const web = this.settings.get('search.web') ? [wrap({
      group: 'Search the web', score: 1, title: this.input.value.trim(), sub: 'See web results', iconName: 'globe',
      run: async () => {
        const q = this.input.value.trim();
        // The Browser searches with the engine chosen in its settings.
        if (this.kernel.registry.has('browser')) launchApp(this.kernel, 'browser', { search: q });
        else this.kernel.platform.host.openExternal(`https://www.google.com/search?q=${encodeURIComponent(q)}`);
      },
    })] : [];

    this.render([...apps, ...settings], web, true);

    // Files: names first (fast), then contents; streamed in as found.
    const home = this.s.user.home;
    const found = await this.kernel.fs.search(home, q, { content: true, limit: 30, signal: ctrl.signal }).catch(() => []);
    if (ctrl.signal.aborted) return;
    const files = found.map(({ entry, match, snippet }) => wrap({
      group: 'Documents', score: match === 'name' ? score(entry.name, q) : 10,
      title: entry.name, sub: match === 'content' ? `…${snippet}…` : `${typeName(entry)} · ${dirname(entry.path).replace(home, 'Home')}`,
      icon: iconForEntry(entry), entry, run: () => openPath(this.kernel, entry.path),
    }));
    this.render([...apps, ...settings, ...files], web, false);
  }

  render(local, web, searchingFiles) {
    const best = [...local].sort((a, b) => b.score - a.score)[0];
    const groups = new Map();
    if (best) groups.set('Best match', [best]);
    for (const r of local) {
      if (r === best) continue;
      if (!groups.has(r.group)) groups.set(r.group, []);
      groups.get(r.group).push(r);
    }
    for (const r of web) groups.set(r.group, [r]);
    this.results = [...groups.values()].flat();
    this.selected = 0;
    const rows = [];
    let i = 0;
    for (const [g, items] of groups) {
      rows.push(h('div.search-group', g));
      for (const r of items) {
        const idx = i++;
        rows.push(h('div.search-row', { role: 'option', id: `sr-${idx}`, 'aria-selected': String(idx === 0), dataset: { idx },
          onclick: () => r.open(), onpointerenter: () => this.select(idx, false) },
        r.icon ? h('img', { src: r.icon, alt: '' }) : icon(r.iconName || 'info', { size: 24 }),
        h('span', h('b', r.title), h('small', r.sub))));
      }
    }
    if (searchingFiles) rows.push(h('div.search-note', 'Searching your files…'));
    if (!this.results.length && !searchingFiles) rows.push(h('div.search-note', 'No results. Try different words.'));
    mount(this.list, rows);
    this.select(0, false);
  }

  select(i, scroll = true) {
    this.selected = i;
    this.list.querySelectorAll('.search-row').forEach((r) => r.setAttribute('aria-selected', String(+r.dataset.idx === i)));
    if (scroll) this.list.querySelector(`#sr-${i}`)?.scrollIntoView({ block: 'nearest' });
    this.input.setAttribute('aria-activedescendant', `sr-${i}`);
    const r = this.results[i];
    if (!r) { mount(this.detail); return; }
    const actions = [h('button.btn', { type: 'button', onclick: () => r.open() }, icon('arrowRight', { size: 16 }), r.group === 'Search the web' ? 'Open in browser' : 'Open')];
    if (r.entry) {
      actions.push(h('button.btn', { type: 'button', onclick: () => { this.close(); openPath(this.kernel, dirname(r.entry.path)); } }, icon('folder', { size: 16 }), 'Open file location'));
      actions.push(h('button.btn', { type: 'button', onclick: async () => { await navigator.clipboard.writeText(r.entry.path); this.kernel.clipboard.record(r.entry.path); } }, icon('edit', { size: 16 }), 'Copy path'));
    }
    mount(this.detail,
      r.icon ? h('img.search-big', { src: r.icon, alt: '' }) : h('div.search-big', icon(r.iconName || 'info', { size: 48 })),
      h('h3', r.title), h('p', r.entry ? `${typeName(r.entry)} · Modified ${relTime(r.entry.mtime)}` : r.sub),
      h('div.search-actions', actions));
  }

  renderHome() {
    const hist = this.settings.get('privacy.searchHistory') ? this.settings.get('search.history') : [];
    const top = this.settings.get('start.recentApps').map((r) => this.kernel.registry.get(r.id)).filter(Boolean).slice(0, 6);
    const fallback = top.length ? top : this.kernel.registry.list().slice(0, 6);
    this.results = [];
    mount(this.list,
      h('div.search-group', 'Top apps'),
      h('div.search-top', fallback.map((a) => h('button.start-app', { type: 'button', onclick: () => { this.close(); rememberRecentApp(this.kernel, a.id); launchApp(this.kernel, a.id); } }, h('img', { src: a.icon, alt: '' }), h('span', a.name)))),
      hist.length ? [h('div.search-group', 'Recent searches'), hist.map((q) => h('div.search-row', { onclick: () => this.open(q) }, icon('restart', { size: 18 }), h('span', h('b', q))))] : null);
    mount(this.detail, h('div.search-hello', h('img', { src: 'assets/brand/logo.svg', alt: '' }), h('p', 'Search apps, settings and the files in your folder — including what’s written inside them.')));
  }
}
