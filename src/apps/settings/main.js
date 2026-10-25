// Settings: navigation, search, and page routing. Pages are in pages.js.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { avatar } from '../../ui/avatar.js';
import { SECTIONS, PAGES, SETTINGS_INDEX } from './index-data.js';
import { renderPage } from './pages.js';
import { liveToggles } from './controls.js';

export default function main(ctx) {
  const k = ctx.privileged;
  const uid = ctx.system.user().id;
  const s = k.settings.forUser(uid);
  const win = ctx.windows.create({ title: 'Settings' });
  let page = PAGES[ctx.args.page] ? ctx.args.page : 'system';
  let pageArgs = { appId: ctx.args.appId };
  let stopPage = null;
  const history = [];

  const nav = h('nav.set-nav', { 'aria-label': 'Settings sections' });
  const content = h('div.set-content', { tabindex: '-1' });
  const main = h('main.set-main', content);
  mount(win.body, h('div.set-app', nav, main));
  liveToggles(content);

  const search = h('input.input', { type: 'search', placeholder: 'Find a setting', 'aria-label': 'Find a setting',
    oninput: () => renderNav(), onkeydown: (e) => { if (e.key === 'Enter') nav.querySelector('.set-hit')?.click(); } });

  function go(id, { push = true, args } = {}) {
    if (!PAGES[id]) return;
    if (id === 'appinfo' && !k.registry.get(args?.appId ?? pageArgs.appId)) id = 'apps';
    if (push && id !== page) history.push(page);
    page = id;
    if (args) pageArgs = args;
    renderNav();
    renderContent();
  }

  function renderNav() {
    const me = k.sessions.get(uid)?.user || k.accounts.get(uid);
    const q = search.value.trim().toLowerCase();
    const hits = q ? SETTINGS_INDEX.filter((e) => e.title.toLowerCase().includes(q) || e.keywords.includes(q)).filter((e, i, a) => a.findIndex((x) => x.title === e.title) === i).slice(0, 12) : [];
    mount(nav,
      h('button.set-me', { type: 'button', onclick: () => go('accounts') }, avatar(me, 56), h('div', h('b', me.name), h('small', me.isGuest ? 'Guest' : me.type === 'admin' ? 'Local account · Administrator' : 'Local account'))),
      h('div.set-search', search),
      q ? h('div.set-hits', hits.length ? hits.map((e) => h('button.set-hit.set-item', { type: 'button', onclick: () => { search.value = ''; go(e.page); } }, h('span', e.title, h('small', PAGES[e.page].title)))) : h('div.hint', { style: { padding: '8px 12px' } }, 'No settings match.'))
        : SECTIONS.map((sec) => h('button.set-item', { type: 'button', 'aria-current': PAGES[page].section === sec.id ? 'page' : undefined, onclick: () => go(SECTION_HOME[sec.id]) },
          icon(sec.icon, { size: 18 }), h('span', sec.title))));
  }

  function renderContent() {
    stopPage?.();
    const p = PAGES[page];
    const sec = SECTIONS.find((x) => x.id === p.section);
    const crumbs = h('h1.set-title',
      history.length ? h('button.tb-btn', { type: 'button', 'aria-label': 'Back', onclick: () => go(history.pop(), { push: false }) }, icon('arrowLeft', { size: 16 })) : null,
      p.title !== sec.title && page !== sec.id ? [h('button.set-crumb', { type: 'button', onclick: () => go(SECTION_HOME[sec.id] || sec.id) }, sec.title), h('span.set-crumb-sep', '›')] : null,
      h('span', page === 'appinfo' ? k.registry.get(pageArgs.appId)?.name || p.title : p.title));
    const body = h('div.set-page');
    mount(content, crumbs, body);
    content.scrollTop = 0;
    win.setTitle(`Settings — ${p.title}`);
    stopPage = renderPage(page, body, { ctx, k, s, uid, go, win, args: pageArgs }) || null;
  }

  ctx.onActivate((args) => { win.focus(); if (args?.page) go(args.page, { args: { appId: args.appId } }); });
  ctx.onExit(() => stopPage?.());
  if (page === 'appinfo' && !k.registry.get(pageArgs.appId)) page = 'apps';
  renderNav();
  renderContent();
}

const SECTION_HOME = { system: 'system', personalization: 'personalization', apps: 'apps', accounts: 'accounts', time: 'datetime', privacy: 'privacy', update: 'update' };
