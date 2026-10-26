// Start: pinned apps (pin/unpin/reorder), All apps A–Z, recommended recent files and apps,
// account and power menus. Typing anywhere in Start jumps to Search.

import { roving } from '../ui/roving.js';
import { h, mount } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { avatar } from '../ui/avatar.js';
import { showMenu } from '../ui/menu.js';
import { confirmDialog, alertDialog } from '../ui/dialog.js';
import { launchApp, openPath, pinned, isPinned, setPinned, movePin, rememberRecentApp } from './apps.js';
import { iconForEntry } from './file-icons.js';
import { basename, extname } from '../core/path.js';
import { kindFor } from '../core/mime.js';

export function relTime(t) {
  const d = Date.now() - t;
  if (d < 60_000) return 'Just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return new Date(t).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export class StartMenu {
  constructor(session) {
    this.s = session;
    this.kernel = session.kernel;
    this.settings = session.settings;
    this.view = 'home';
    this.f = session.flyouts.add('start', {
      className: 'fly-start', label: 'Start',
      onOpen: () => { this.view = 'home'; this.render(); this.searchInput.focus(); },
    });
    this.el = this.f.el;
    this.el.addEventListener('keydown', (e) => {
      if (e.target === this.searchInput) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
        e.preventDefault();
        session.flyouts.open('search', { query: e.key });
      }
    });
  }

  launch(appId, args) {
    this.s.flyouts.close('start');
    rememberRecentApp(this.kernel, appId);
    return launchApp(this.kernel, appId, args);
  }

  render() {
    this.searchInput = h('input.start-search', {
      type: 'search', placeholder: 'Search for apps, settings, and documents', 'aria-label': 'Search',
      oninput: (e) => { if (e.target.value) this.s.flyouts.open('search', { query: e.target.value }); },
    });
    const body = this.view === 'all' ? this.allApps() : this.home();
    const u = this.s.user;
    mount(this.el,
      h('div.start-top', h('div.start-searchbox', svgSearch(), this.searchInput)),
      body,
      h('div.start-foot',
        h('button.start-user', { type: 'button', 'aria-label': `${u.name}. Account options`, onclick: (e) => this.userMenu(e.currentTarget) }, avatar(u, 32), h('span', u.name)),
        h('button.tb-btn', { type: 'button', title: 'Power', 'aria-label': 'Power', onclick: (e) => this.powerMenu(e.currentTarget) }, icon('power'))));
  }

  home() {
    const pins = pinned(this.kernel, 'start');
    const grid = h('div.start-pins', { role: 'group', 'aria-label': 'Pinned apps' }, pins.map((id) => this.pinTile(id)));
    // One Tab stop; arrow keys move around the grid.
    requestAnimationFrame(() => roving(grid, '.start-app', { grid: true }));
    const rec = this.recommended();
    return h('div.start-body',
      h('div.start-head', h('h2', 'Pinned'), h('button.btn.small', { type: 'button', onclick: () => { this.view = 'all'; this.render(); } }, 'All apps', icon('chevronRight', { size: 14 }))),
      pins.length ? grid : h('p.start-empty', 'Right-click an app in All apps to pin it here.'),
      this.settings.get('start.showRecent') || this.settings.get('start.showRecentApps') ? [
        h('div.start-head', h('h2', 'Recommended')),
        rec.length ? h('div.start-rec', rec) : h('p.start-empty', 'Files you open and apps you install recently will show up here.'),
      ] : null);
  }

  pinTile(id) {
    const app = this.kernel.registry.get(id);
    const tile = h('button.start-app', {
      type: 'button', draggable: 'true', title: app.description || app.name,
      onclick: () => this.launch(id),
      oncontextmenu: (e) => { e.preventDefault(); this.appMenu(app, e, true); },
    }, h('img', { src: app.icon, alt: '', draggable: 'false' }), h('span', app.name));
    tile.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-donut-startpin', id); e.dataTransfer.effectAllowed = 'move'; tile.classList.add('dragging'); });
    tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
    tile.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-donut-startpin')) { e.preventDefault(); tile.classList.add('drop-before'); } });
    tile.addEventListener('dragleave', () => tile.classList.remove('drop-before'));
    tile.addEventListener('drop', (e) => {
      tile.classList.remove('drop-before');
      const dragged = e.dataTransfer.getData('application/x-donut-startpin');
      if (dragged && dragged !== id) { e.preventDefault(); movePin(this.kernel, 'start', dragged, id); this.render(); }
    });
    return tile;
  }

  recommended() {
    const out = [];
    if (this.settings.get('start.showRecent')) {
      for (const r of this.settings.get('start.recentFiles').slice(0, 6)) {
        const name = basename(r.path);
        const ext = extname(name);
        const entry = { type: 'file', name, ext, kind: kindFor(ext) };
        out.push({ time: r.time, el: h('button.start-recitem', { type: 'button', title: r.path, onclick: () => { this.s.flyouts.close('start'); openPath(this.kernel, r.path); } },
          h('img', { src: iconForEntry(entry), alt: '' }), h('span', h('b', name), h('small', relTime(r.time)))) });
      }
    }
    if (this.settings.get('start.showRecentApps')) {
      const installed = this.kernel.registry.list().filter((a) => a.installed && a.installedAt).map((a) => ({ id: a.id, time: a.installedAt, label: 'Recently added' }));
      for (const r of installed.slice(0, 3)) {
        const app = this.kernel.registry.get(r.id);
        out.push({ time: r.time, el: h('button.start-recitem', { type: 'button', onclick: () => this.launch(app.id) }, h('img', { src: app.icon, alt: '' }), h('span', h('b', app.name), h('small', r.label))) });
      }
    }
    return out.sort((a, b) => b.time - a.time).slice(0, 6).map((x) => x.el);
  }

  allApps() {
    const apps = this.kernel.registry.list();
    const groups = new Map();
    for (const a of apps) {
      const ch = a.name[0].toUpperCase();
      const key = /[A-Z]/.test(ch) ? ch : '#';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    const list = h('div.start-all', { role: 'group', 'aria-label': 'All apps' });
    for (const [letter, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      list.append(h('div.start-letter', { id: `start-letter-${letter}` }, letter));
      for (const a of items) {
        list.append(h('button.start-row', { type: 'button', onclick: () => this.launch(a.id), oncontextmenu: (e) => { e.preventDefault(); this.appMenu(a, e, false); } },
          h('img', { src: a.icon, alt: '' }), h('span', a.name, a.description ? h('small', a.description) : null)));
      }
    }
    requestAnimationFrame(() => roving(list, '.start-row', { vertical: true }));
    return h('div.start-body',
      h('div.start-head', h('h2', 'All apps'), h('button.btn.small', { type: 'button', onclick: () => { this.view = 'home'; this.render(); } }, icon('chevronDown', { size: 14 }), 'Back')),
      list);
  }

  appMenu(app, e, fromPins) {
    const k = this.kernel;
    const onStart = isPinned(k, 'start', app.id);
    const onBar = isPinned(k, 'taskbar', app.id);
    const items = [
      { label: 'Open', icon: app.icon, onSelect: () => this.launch(app.id) },
      { separator: true },
      { label: onStart ? 'Unpin from Start' : 'Pin to Start', icon: onStart ? 'minus' : 'plus', onSelect: () => { setPinned(k, 'start', app.id, !onStart); this.render(); } },
      { label: onBar ? 'Unpin from taskbar' : 'Pin to taskbar', icon: onBar ? 'minus' : 'plus', onSelect: () => setPinned(k, 'taskbar', app.id, !onBar) },
    ];
    if (fromPins) items.push({ label: 'Move to front', icon: 'chevronUp', onSelect: () => { const first = pinned(k, 'start')[0]; if (first !== app.id) movePin(k, 'start', app.id, first); this.render(); } });
    if (app.installed) {
      items.push({ separator: true }, { label: 'Uninstall', icon: 'trash', danger: true, onSelect: async () => {
        if (!(await confirmDialog(`Uninstall ${app.name}?`, 'This app and its settings will be removed. Your files stay where they are.', { ok: 'Uninstall', danger: true }))) return;
        try {
          for (const p of k.processes.byApp(app.id)) await k.processes.kill(p.pid, { force: true });
          await k.registry.uninstall(app.id);
          for (const where of ['start', 'taskbar']) setPinned(k, where, app.id, false);
          k.settings.resetPrefix(`app.${app.id}.`);
          this.render();
        } catch (err) { alertDialog('Couldn’t uninstall', err.message); }
      } });
    }
    showMenu(items, { x: e.clientX, y: e.clientY });
  }

  userMenu(anchor) {
    const sh = this.s.shell;
    showMenu([
      { label: 'Change account settings', icon: 'settings', onSelect: () => this.launch('settings', { page: 'accounts' }) },
      { separator: true },
      { label: 'Lock', icon: 'lock', onSelect: () => { this.s.flyouts.close(); sh.lock(); } },
      { label: 'Switch user', icon: 'switchUser', onSelect: () => { this.s.flyouts.close(); sh.switchUser(); } },
      { label: 'Sign out', icon: 'signOut', onSelect: () => { this.s.flyouts.close(); sh.power.signOut(); } },
    ], { anchor, placement: 'above' });
  }

  powerMenu(anchor) {
    const p = this.s.shell.power;
    showMenu([
      { label: 'Sleep', icon: 'sleep', onSelect: () => { this.s.flyouts.close(); p.sleep(); } },
      { label: 'Shut down', icon: 'power', onSelect: () => { this.s.flyouts.close(); p.shutdown(); } },
      { label: 'Restart', icon: 'restart', onSelect: () => { this.s.flyouts.close(); p.restart(); } },
    ], { anchor, placement: 'above' });
  }
}

export function svgSearch(size = 16) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/></svg>`;
  return t.content.firstElementChild;
}
