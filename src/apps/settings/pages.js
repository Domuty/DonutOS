// Every Settings page. Each renderer fills `el` and may return a cleanup function.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { alertDialog, confirmDialog, promptDialog } from '../../ui/dialog.js';
import { formatBytes } from '../../core/util.js';
import { row, section, toggle, select, slider, link } from './controls.js';
import { PAGES } from './index-data.js';
import { renderAccounts } from '../../shell/accounts-panel.js';
import { toggleFocus } from '../../shell/focus.js';
import { BUILTIN_WALLPAPERS, SOLID_COLORS, builtinUrl, resolveWallpaper } from '../../shell/wallpaper.js';
import { ACCENTS } from '../../shell/oobe.js';
import { playSound } from '../../shell/sounds.js';
import { labelFor } from '../../core/shortcuts.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { HOME_FOLDERS } from '../../core/vfs.js';
import * as P from '../../core/path.js';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg']);

export function renderPage(id, el, env) {
  const fn = RENDER[id];
  return fn ? fn(el, env) : null;
}

const hub = (el, env, ids) => mount(el, ids.map((id) => link(ICONS[id] || 'chevronRight', PAGES[id].title, PAGES[id].description, () => env.go(id))));
const ICONS = {
  display: 'monitor', sound: 'volume', notifications: 'info', focus: 'sparkle', power: 'power', storage: 'folder', clipboard: 'clipboard', shortcuts: 'keypad', about: 'info',
  background: 'image', colors: 'palette', lockscreen: 'lock', taskbar: 'apps', start: 'view', fonts: 'edit', desktop: 'monitor',
};

const RENDER = {
  // ── System ───────────────────────────────────────────────────────────
  system(el, env) {
    const { k } = env;
    mount(el,
      h('div.set-hero', h('img', { src: 'assets/brand/logo.svg', alt: '' }), h('div', h('b', k.settings.get('system.deviceName')), h('small', `DonutOS ${k.version} · ${k.platform.name === 'desktop' ? 'Desktop app' : 'Web'}`),
        h('button.link', { type: 'button', onclick: () => env.go('about') }, 'Rename'))),
      h('div.panel'));
    hub(el.lastChild, env, ['display', 'sound', 'notifications', 'focus', 'power', 'storage', 'clipboard', 'shortcuts', 'about']);
  },

  display(el, { s, k }) {
    const fs = h('input', { type: 'checkbox', checked: k.platform.display.isFullscreen(), 'aria-label': 'Full screen', onchange: async (e) => { e.target.checked = await k.platform.display.setFullscreen(e.target.checked); } });
    const off = k.platform.display.onFullscreenChange((on) => { fs.checked = on; });
    mount(el, h('div.panel',
      section('Brightness & colour'),
      row('sun', 'Brightness', 'Dims the DonutOS picture (the monitor’s own backlight isn’t changed)', slider(s, 'qs.brightness', { min: 20, label: 'Brightness', format: (v) => `${v}%` })),
      row('moon', 'Night light', 'Use warmer colours to help you sleep', toggle(s, 'qs.nightLight')),
      row(null, 'Night light strength', null, slider(s, 'qs.nightLightStrength', { min: 5, label: 'Night light strength', format: (v) => `${v}%` })),
      section('Scale & layout'),
      row('edit', 'Text size', 'Makes text and controls bigger everywhere', slider(s, 'appearance.textScale', { min: 100, max: 225, step: 25, label: 'Text size', format: (v) => `${v}%` })),
      row('monitor', 'Full screen', 'Use DonutOS without the browser’s or app window’s frame', h('label.toggle', h('small.toggle-state', ''), fs, h('span')))));
    return off;
  },

  sound(el, { s, k }) {
    mount(el, h('div.panel',
      row('volume', 'Volume', 'For system sounds and apps', slider(s, 'qs.volume', { label: 'Volume', format: (v) => `${v}%` })),
      row('mute', 'Mute', null, toggle(s, 'qs.muted')),
      row('sparkle', 'System sounds', 'Sign-in, notification and error sounds', toggle(s, 'sound.enabled')),
      row('power', 'Play the startup sound', 'For everyone on this device', toggle(k.settings, 'sound.startup')),
      row('info', 'Test', null, h('button.btn', { type: 'button', onclick: () => playSound('notify', s) }, 'Play a sound'))));
  },

  notifications(el, { s, k }) {
    const apps = k.registry.list({ includeHidden: true }).filter((a) => (a.permissions || []).includes('notifications'));
    const perApp = s.get('notifications.perApp');
    mount(el, h('div.panel',
      row('info', 'Notifications', 'Get notifications from apps and other senders', toggle(s, 'notifications.enabled')),
      row('moon', 'Do not disturb', 'Notifications go straight to the notification center', toggle(s, 'notifications.dnd')),
      row('volume', 'Play a sound for notifications', null, toggle(s, 'notifications.sounds')),
      row('trash', 'Notification history', `${k.notifications.list().length} saved`, h('button.btn', { type: 'button', onclick: () => { k.notifications.clear(); RENDER.notifications(el, { s, k }); } }, 'Clear')),
      section('Notifications from apps'),
      apps.map((a) => row(h('img', { src: a.icon, alt: '', width: 24 }), a.name, null,
        h('label.toggle', h('small.toggle-state', perApp[a.id] === false ? 'Off' : 'On'), h('input', { type: 'checkbox', checked: perApp[a.id] !== false, 'aria-label': `Notifications from ${a.name}`,
          onchange: (e) => s.set('notifications.perApp', { ...s.get('notifications.perApp'), [a.id]: e.target.checked }) }), h('span'))))));
  },

  focus(el, env) {
    const { s } = env;
    const paint = () => {
      const on = s.get('qs.focus');
      const left = Math.max(0, Math.ceil((s.get('qs.focusUntil') - Date.now()) / 60000));
      mount(el, h('div.panel',
        row('sparkle', on ? `Focus session: ${left} minute${left === 1 ? '' : 's'} left` : 'Focus session', 'Turns on do not disturb and hides notification badges for a while',
          h('button.btn', { type: 'button', class: !on && 'primary', onclick: () => toggleFocus(s) }, on ? 'Stop focus session' : 'Start focus session')),
        row(null, 'Session length', null, select(s, 'qs.focusMinutes', [5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240].map((m) => [m, `${m} minutes`])))));
    };
    paint();
    const off = s.watch('qs.*', paint);
    const t = setInterval(paint, 15000);
    return () => { off(); clearInterval(t); };
  },

  power(el, { s, k }) {
    mount(el, h('div.panel',
      row('lock', 'Lock the screen when I’m away', 'After this much time without using the keyboard or mouse', select(s, 'lock.timeoutMin', [[0, 'Never'], [1, '1 minute'], [3, '3 minutes'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']])),
      row('power', 'Boot animation', 'Show the donut while DonutOS starts (for everyone)', toggle(k.settings, 'system.bootAnimation')),
      row('lock', 'Lock now', 'Shortcut: Win+L or Ctrl+Alt+L', h('button.btn', { type: 'button', onclick: () => k.shortcuts.find('Ctrl+Alt+L')?.handler() }, 'Lock'))));
  },

  storage(el, { k, uid }) {
    const home = k.homeFor(uid);
    const list = h('div.panel', h('div.hint', 'Calculating…'));
    mount(el, list);
    let alive = true;
    (async () => {
      const usage = await k.fs.usage();
      const parts = [];
      for (const f of HOME_FOLDERS) parts.push([f, (await k.fs.du(P.join(home, f)).catch(() => ({ size: 0 }))).size]);
      const trash = (await k.fs.listTrash(home)).reduce((n, i) => n + i.size, 0);
      parts.push(['Recycle Bin', trash]);
      const other = (await k.fs.du(home).catch(() => ({ size: 0 }))).size - parts.reduce((n, [, v]) => n + v, 0);
      if (other > 0) parts.push(['Other files in your folder', other]);
      if (!alive) return;
      const max = Math.max(1, ...parts.map(([, v]) => v));
      const pct = usage.total ? Math.min(100, (usage.used / usage.total) * 100) : 0;
      mount(list,
        h('div.storage-total', h('b', `${formatBytes(usage.used)} used`), h('small', usage.total ? `of ${formatBytes(usage.total)} (${formatBytes(usage.total - usage.used)} free)` : ''),
          h('div.kc-meter', h('i', { style: { width: `${pct}%` } }))),
        h('p.hint', k.platform.name === 'desktop' ? 'Shows the disk that holds your DonutOS folder.' : 'Shows the space your browser lets DonutOS use on this device.'),
        section('Your files'),
        parts.sort((a, b) => b[1] - a[1]).map(([name, size]) => row(name === 'Recycle Bin' ? 'trash' : 'folder', name, formatBytes(size),
          h('div.bar', h('i', { style: { width: `${(size / max) * 100}%` } })),
          name === 'Recycle Bin' && size ? h('button.btn', { type: 'button', onclick: async () => { if (await confirmDialog('Empty the Recycle Bin?', 'Everything in it will be permanently deleted.', { ok: 'Empty', danger: true })) { await k.fs.emptyTrash(home); RENDER.storage(el, { k, uid }); } } }, 'Empty') : null)));
    })();
    return () => { alive = false; };
  },

  clipboard(el, { s, k }) {
    mount(el, h('div.panel',
      row('clipboard', 'Clipboard history', 'Keep a list of what you copy. Open it with Win+V or Ctrl+Alt+V', toggle(s, 'privacy.clipboardHistory')),
      row('trash', 'Clear clipboard data', 'Pinned items are kept', h('button.btn', { type: 'button', onclick: () => k.clipboard.clear() }, 'Clear'))));
  },

  shortcuts(el, { k }) {
    const groups = new Map();
    for (const sc of k.shortcuts.list()) {
      if (!groups.has(sc.group)) groups.set(sc.group, []);
      groups.get(sc.group).push(sc);
    }
    mount(el, h('p.hint', 'Your computer keeps some Win-key shortcuts for itself (for example Win+L on Windows). Every shortcut also has a Ctrl+Alt alternative that always works in DonutOS.'),
      [...groups].map(([g, list]) => [section(g), h('div.panel', list.map((sc) => row(null, sc.description, null, h('div.kbd-list', sc.labels.map((l) => h('kbd', l))))))]));
  },

  about(el, { k }) {
    const info = k.info;
    const specs = h('div.panel', h('div.hint', 'Loading…'));
    mount(el, h('div.set-hero', h('img', { src: 'assets/brand/logo.svg', alt: '' }), h('div', h('b', k.settings.get('system.deviceName')), h('small', `DonutOS ${k.version}`),
      h('button.btn', { type: 'button', onclick: async () => {
        const name = await promptDialog('Rename your device', { label: 'Device name', value: k.settings.get('system.deviceName'), validate: (v) => (/^[A-Za-z0-9-]{1,15}$/.test(v.trim()) ? null : 'Use 1–15 letters, numbers or hyphens.') });
        if (name) { k.settings.set('system.deviceName', name.trim()); RENDER.about(el, { k }); }
      } }, 'Rename this device'))), specs);
    k.platform.system.stats().then((st) => {
      const lines = [
        ['Device name', k.settings.get('system.deviceName')], ['DonutOS version', k.version], ['Running as', info.platform === 'desktop' ? 'Desktop app' : 'Web app'],
        ['Host system', `${info.os} ${info.osVersion} ${info.arch}`.trim()], ['Processor', `${info.cpuModel} (${info.cores} cores)`],
        ['Memory', st.memory.total ? `${formatBytes(st.memory.total)} ${st.estimated ? '(as reported by the browser)' : ''}` : 'Not reported'],
        ['Engine', info.engine], ['Files are stored', info.sandboxRoot || 'In this browser (IndexedDB)'],
      ];
      mount(specs, section('Device specifications'), lines.map(([a, b]) => row(null, a, null, h('span.spec', b))),
        h('button.btn', { type: 'button', style: { justifySelf: 'start', marginTop: '8px' }, onclick: () => { const t = lines.map(([a, b]) => `${a}: ${b}`).join('\n'); navigator.clipboard.writeText(t); k.clipboard.record(t); } }, icon('copy', { size: 16 }), 'Copy'));
    });
  },

  // ── Personalization ──────────────────────────────────────────────────
  personalization(el, env) {
    const { s, k } = env;
    const preview = h('div.set-preview');
    resolveWallpaper(s.get('appearance.wallpaper'), k.fs, { thumb: true }).then((r) => { preview.style.background = r.url ? `center/cover url("${r.url}")` : r.color; });
    mount(el, preview, h('div.panel'));
    hub(el.lastChild, env, ['background', 'colors', 'lockscreen', 'taskbar', 'start', 'fonts', 'desktop']);
  },

  background(el, { s, k, uid }) {
    const home = k.homeFor(uid);
    const folder = P.join(home, 'Pictures', 'Wallpapers');
    const render = async () => {
      mount(el, h('div.panel',
        section('Choose a background'),
        await wallpaperGrid(k, s, 'appearance.wallpaper', folder, render, { colors: true }),
        row('image', 'Choose a photo', 'Copies an image from your computer into Pictures › Wallpapers', h('button.btn', { type: 'button', onclick: () => browse(k, s, folder, render) }, 'Browse photos')),
        row('view', 'Choose a fit for your desktop image', null, select(s, 'appearance.wallpaperFit', [['fill', 'Fill'], ['fit', 'Fit'], ['stretch', 'Stretch'], ['center', 'Centre'], ['tile', 'Tile']], { width: 140 }))));
    };
    render();
    return k.bus.on('fs:changed', (e) => { if (e.dir === folder) render(); });
  },

  colors(el, { s }) {
    const render = () => {
      const accent = s.get('appearance.accent');
      mount(el, h('div.panel',
        row('moon', 'Choose your mode', 'Auto follows your computer’s light/dark setting', select(s, 'appearance.theme', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']], { width: 140 })),
        row('palette', 'Accent colour', null,
          h('div.swatches', ACCENTS.map((c) => h('button.swatch', { type: 'button', 'aria-label': c, 'aria-pressed': String(accent === c), style: { background: c }, onclick: () => { s.set('appearance.accent', c); render(); } })),
            h('input', { type: 'color', value: accent, 'aria-label': 'Custom accent colour', class: 'color-pick', onchange: (e) => { s.set('appearance.accent', e.target.value); render(); } }))),
        row('sparkle', 'Transparency effects', 'Windows and surfaces appear slightly see-through', toggle(s, 'appearance.transparency')),
        row('restart', 'Animation effects', null, toggle(s, 'appearance.animations'))));
    };
    render();
  },

  lockscreen(el, { s, k, uid }) {
    const folder = P.join(k.homeFor(uid), 'Pictures', 'Wallpapers');
    const render = async () => mount(el, h('div.panel',
      section('Lock screen picture'),
      await wallpaperGrid(k, s, 'appearance.lockWallpaper', folder, render, { same: true }),
      row('wifi', 'Show network and battery status on the lock screen', null, toggle(s, 'lock.showStatus'))));
    render();
  },

  taskbar(el, { s }) {
    mount(el, h('div.panel',
      section('Taskbar items'),
      row('globe', 'Search', null, select(s, 'taskbar.showSearch', [['hidden', 'Hide'], ['icon', 'Search icon only'], ['box', 'Search box']])),
      row('sun', 'Widgets', 'Weather and the widgets board', toggle(s, 'taskbar.showWidgets')),
      section('Taskbar behaviours'),
      row('apps', 'Taskbar alignment', null, select(s, 'taskbar.alignment', [['center', 'Centre'], ['left', 'Left']], { width: 140 })),
      row('chevronDown', 'Automatically hide the taskbar', 'Point at the bottom of the screen to show it', toggle(s, 'taskbar.autoHide')),
      row('restart', 'Show seconds in the clock', null, toggle(s, 'taskbar.showSeconds')),
      row('view', 'Combine taskbar buttons', 'Off shows one labelled button per window', toggle(s, 'taskbar.combine'))));
  },

  start(el, { s }) {
    mount(el, h('div.panel',
      row('view', 'Show recently added apps', null, toggle(s, 'start.showRecentApps')),
      row('file', 'Show recently opened items in Start and the taskbar', null, toggle(s, 'start.showRecent')),
      row('trash', 'Clear recent items', null, h('button.btn', { type: 'button', onclick: () => { s.set('start.recentFiles', []); s.set('start.recentApps', []); } }, 'Clear'))));
  },

  fonts(el, { s }) {
    const fonts = [['system', 'System (default)'], ['rounded', 'Rounded'], ['humanist', 'Humanist'], ['serif', 'Serif'], ['mono', 'Monospace']];
    mount(el, h('div.panel',
      row('edit', 'Font', 'Used by DonutOS and its apps', select(s, 'appearance.font', fonts)),
      row(null, 'Text size', null, slider(s, 'appearance.textScale', { min: 100, max: 225, step: 25, label: 'Text size', format: (v) => `${v}%` })),
      h('div.font-preview', h('b', 'The quick brown fox jumps over the lazy dog'), h('p', 'Pack my box with five dozen liquor jugs. 0123456789'))));
  },

  desktop(el, { s }) {
    mount(el, h('div.panel',
      row('view', 'Icon size', null, select(s, 'desktop.iconSize', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], { width: 140 })),
      row('sort', 'Auto arrange icons', null, toggle(s, 'desktop.autoArrange')),
      row('monitor', 'Show desktop icons', null, toggle(s, 'desktop.showIcons')),
      row('refresh', 'Reset icon positions', null, h('button.btn', { type: 'button', onclick: () => s.set('desktop.iconPositions', {}) }, 'Reset'))));
  },

  // ── Apps ─────────────────────────────────────────────────────────────
  apps(el, { k, s }) {
    const q = h('input.input', { type: 'search', placeholder: 'Search apps', 'aria-label': 'Search apps', style: { maxWidth: '320px' }, oninput: () => paint() });
    const list = h('div.panel');
    const paint = () => {
      const f = q.value.trim().toLowerCase();
      const apps = k.registry.list({ includeHidden: true }).filter((a) => !f || a.name.toLowerCase().includes(f));
      mount(list, apps.map((a) => row(h('img', { src: a.icon, alt: '', width: 28 }), a.name, `${a.builtin ? 'Built-in' : 'Installed'} · version ${a.version}${a.description ? ` · ${a.description}` : ''}`,
        a.installed ? h('button.btn', { type: 'button', onclick: async () => {
          if (!(await confirmDialog(`Uninstall ${a.name}?`, 'This app and its settings will be removed. Your files stay where they are.', { ok: 'Uninstall', danger: true }))) return;
          try {
            for (const p of k.processes.byApp(a.id)) await k.processes.kill(p.pid, { force: true });
            await k.registry.uninstall(a.id);
            s.resetPrefix(`app.${a.id}.`);
            for (const where of ['start.pinned', 'taskbar.pinned']) s.set(where, s.get(where).filter((x) => x !== a.id));
            paint();
          } catch (err) { alertDialog('Couldn’t uninstall', err.message); }
        } }, 'Uninstall') : null)));
    };
    mount(el, q, list);
    paint();
    return k.bus.on('apps:*', paint);
  },

  defaultapps(el, { k }) {
    const table = k.associations.table();
    mount(el, h('p.hint', 'Choose which app opens each kind of file.'), h('div.panel', table.length
      ? table.map(({ ext, appId, handlers }) => row('file', ext, null, h('select.input', { style: { width: '220px' }, 'aria-label': `Default app for ${ext}`, onchange: (e) => k.associations.setDefault(ext, e.target.value) },
        handlers.map((id) => h('option', { value: id, selected: id === appId }, k.registry.get(id).name)))))
      : row('info', 'No apps that open files are installed yet', null)));
  },

  startup(el, { k, s }) {
    const apps = k.registry.list().filter((a) => a.id !== 'settings');
    const on = new Set(s.get('apps.startup'));
    mount(el, h('p.hint', 'These apps start automatically when you sign in.'), h('div.panel', apps.map((a) => row(h('img', { src: a.icon, alt: '', width: 24 }), a.name, null,
      h('label.toggle', h('small.toggle-state', on.has(a.id) ? 'On' : 'Off'), h('input', { type: 'checkbox', checked: on.has(a.id), 'aria-label': `Start ${a.name} when I sign in`,
        onchange: (e) => { const cur = new Set(s.get('apps.startup')); if (e.target.checked) cur.add(a.id); else cur.delete(a.id); s.set('apps.startup', [...cur]); } }), h('span'))))));
  },

  // ── Accounts ─────────────────────────────────────────────────────────
  accounts(el, { k, uid }) {
    const host = h('div.panel');
    mount(el, host);
    return renderAccounts(host, { kernel: k, uid });
  },

  // ── Time & language ──────────────────────────────────────────────────
  datetime(el, { s }) {
    const zones = (Intl.supportedValuesOf?.('timeZone') || ['UTC']);
    const tzOpts = [['auto', `Automatic (${Intl.DateTimeFormat().resolvedOptions().timeZone})`], ...zones.map((z) => [z, z.replace(/_/g, ' ')])];
    const render = () => {
      const clocks = s.get('time.worldClocks');
      const add = h('select.input', { style: { width: '220px' }, 'aria-label': 'Add a clock' }, h('option', { value: '' }, 'Add a clock…'), zones.filter((z) => !clocks.includes(z)).map((z) => h('option', { value: z }, z.replace(/_/g, ' '))));
      add.addEventListener('change', () => { if (add.value) { s.set('time.worldClocks', [...clocks, add.value].slice(0, 6)); render(); } });
      mount(el, h('div.panel',
        row('globe', 'Time zone', null, select(s, 'time.timezone', tzOpts, { width: 260 })),
        row('restart', '24-hour clock', null, toggle(s, 'time.format24h')),
        row('calendar', 'Short date format', null, select(s, 'time.dateFormat', [['short', new Date().toLocaleDateString()], ['medium', new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })], ['long', new Date().toLocaleDateString(undefined, { dateStyle: 'full' })], ['iso', new Date().toISOString().slice(0, 10)]], { width: 260 })),
        row('calendar', 'First day of the week', null, select(s, 'time.firstDayOfWeek', [0, 1, 2, 3, 4, 5, 6].map((d) => [d, new Date(2023, 0, 1 + d).toLocaleDateString(undefined, { weekday: 'long' })]), { width: 160 })),
        section('Additional clocks'),
        clocks.map((z) => row('globe', z.replace(/_/g, ' '), null, h('button.btn', { type: 'button', onclick: () => { s.set('time.worldClocks', clocks.filter((x) => x !== z)); render(); } }, 'Remove'))),
        clocks.length < 6 ? row('plus', 'Add a clock', 'Shown in the Clocks widget', add) : null));
    };
    render();
  },

  language(el, { s }) {
    const locales = ['auto', 'en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN', 'de-DE', 'fr-FR', 'es-ES', 'es-MX', 'it-IT', 'pt-BR', 'pt-PT', 'nl-NL', 'sv-SE', 'nb-NO', 'da-DK', 'fi-FI', 'pl-PL', 'cs-CZ', 'tr-TR', 'ru-RU', 'uk-UA', 'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW', 'hi-IN', 'ar-EG', 'he-IL'];
    const name = (l) => { try { return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(l); } catch { return l; } };
    mount(el, h('div.panel',
      row('globe', 'Regional format', 'How dates, times and numbers look', select(s, 'language.locale', locales.map((l) => [l, l === 'auto' ? `Match my computer (${navigator.language})` : `${name(l)} (${l})`]), { width: 280 })),
      row('sun', 'Weather units', null, select(s, 'weather.units', [['auto', 'Automatic'], ['metric', 'Celsius, km/h'], ['imperial', 'Fahrenheit, mph']], { width: 200 })),
      h('p.hint', 'DonutOS is currently available in English. Regional formats change how dates, times and numbers are shown.')));
  },

  // ── Privacy ──────────────────────────────────────────────────────────
  privacy(el, { k, s, uid }) {
    const render = () => {
      const master = ['camera', 'microphone', 'location', 'notifications'];
      const other = ['files.read', 'files.write', 'clipboard', 'screen', 'network', 'system.fs'];
      const appsFor = (perm) => k.permissions.appsUsing(perm, uid).filter((a) => !a.system);
      const permRows = (perm) => {
        const apps = appsFor(perm);
        return apps.length ? apps.map((a) => row(h('img', { src: k.registry.get(a.appId).icon, alt: '', width: 22 }), a.name, a.state === 'prompt' ? 'Will ask' : a.state === 'blocked' ? 'Blocked by the switch above' : a.state === 'granted' ? 'Allowed' : 'Denied',
          h('select.input', { style: { width: '130px' }, 'aria-label': `${PERMISSIONS[perm].label} for ${a.name}`, onchange: (e) => {
            if (e.target.value === 'prompt') k.permissions.reset(a.appId, perm, uid); else if (e.target.value === 'granted') k.permissions.grant(a.appId, perm, uid); else k.permissions.deny(a.appId, perm, uid);
            render();
          } }, [['prompt', 'Ask'], ['granted', 'Allow'], ['denied', 'Deny']].map(([v, l]) => h('option', { value: v, selected: a.state === v || (v === 'prompt' && a.state === 'blocked') }, l)))))
          : [h('div.hint.indent', 'No installed apps have asked for this. Built-in apps use it as needed.')];
      };
      mount(el,
        h('p.hint', 'Switches turn a capability off for every app, including built-in ones. Below each, choose what installed apps may do.'),
        master.map((perm) => [section(PERMISSIONS[perm].label), h('div.panel', row(null, `${PERMISSIONS[perm].label} access`, PERMISSIONS[perm].description, toggle(s, `privacy.${perm}`, { onChange: render })), permRows(perm))]),
        section('Other permissions'),
        h('div.panel', other.flatMap((perm) => {
          const apps = appsFor(perm);
          return apps.length ? [h('div.sub-title', PERMISSIONS[perm].label), ...permRows(perm)] : [];
        }), other.every((p) => !appsFor(p).length) ? h('div.hint.indent', 'No installed apps have asked for other permissions.') : null));
    };
    render();
    return k.bus.on('permissions:changed', render);
  },

  history(el, { s }) {
    mount(el, h('div.panel',
      row('globe', 'Search history', 'Remember what you search for on this device', toggle(s, 'privacy.searchHistory')),
      row('trash', 'Clear search history', `${s.get('search.history').length} saved`, h('button.btn', { type: 'button', onclick: (e) => { s.set('search.history', []); e.currentTarget.closest('.row').querySelector('.d').textContent = '0 saved'; } }, 'Clear')),
      row('clipboard', 'Clipboard history', null, toggle(s, 'privacy.clipboardHistory')),
      row('file', 'Recent files and apps', 'Shown in Start and on taskbar jump lists', toggle(s, 'start.showRecent'))));
  },

  // ── Update ───────────────────────────────────────────────────────────
  update(el, { k }) {
    const u = k.platform.updates;
    const paint = (st = u.status()) => {
      const msg = { idle: 'Not checked yet', checking: 'Checking for updates…', available: 'An update is available', downloading: `Downloading${st.progress ? ` (${Math.round(st.progress * 100)}%)` : '…'}`, ready: 'An update is ready', 'up-to-date': 'You’re up to date', error: 'Couldn’t check for updates', unsupported: 'Updates' }[st.state];
      mount(el, h('div.set-hero', icon(st.state === 'ready' ? 'download' : st.state === 'error' ? 'warning' : 'check', { size: 40 }), h('div', h('b', msg), h('small', st.message || `DonutOS ${k.version}`),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '6px' } },
          st.state === 'ready' ? h('button.btn.primary', { type: 'button', onclick: () => u.install() }, 'Restart now') : h('button.btn.primary', { type: 'button', disabled: st.state === 'checking' || st.state === 'downloading' || st.state === 'unsupported', onclick: async () => paint(await u.check()) }, 'Check for updates')))),
      h('div.panel', row('restart', 'Get updates automatically', 'Download new versions in the background (for everyone)', toggle(k.settings, 'system.updates.auto'))));
    };
    paint();
    return u.onStatus(paint);
  },
};

async function browse(k, s, folder, done) {
  const files = await k.platform.host.importFiles({ multiple: false, accept: 'image/*' });
  if (!files.length) return;
  const f = files[0];
  if (!IMAGE_EXT.has(P.extname(f.name))) { await alertDialog('Can’t use that file', 'Choose a PNG, JPEG, WebP, GIF, BMP, AVIF or SVG image.'); return; }
  await k.fs.mkdir(folder, { recursive: true });
  const name = await k.fs.uniqueName(folder, f.name);
  await k.fs.writeFile(P.join(folder, name), f.data);
  s.set('appearance.wallpaper', `file:${P.join(folder, name)}`);
  done();
}

async function wallpaperGrid(k, s, key, folder, rerender, { colors = false, same = false } = {}) {
  const current = s.get(key);
  const pick = (spec) => { s.set(key, spec); rerender(); };
  const btn = (spec, label, content) => h('button.choice', { type: 'button', role: 'radio', title: label, 'aria-label': label, 'aria-checked': String(current === spec), 'aria-pressed': String(current === spec), onclick: () => pick(spec) }, content);
  const items = [];
  if (same) items.push(btn('same', 'Same as desktop', h('div.wp-solid', { style: { display: 'grid', placeItems: 'center', background: 'var(--surface-3)', fontSize: '12px' } }, 'Same as desktop')));
  for (const w of BUILTIN_WALLPAPERS) items.push(btn(w.id, w.name, h('img', { src: builtinUrl(w.id.slice(8), true), alt: '' })));
  const custom = (await k.fs.exists(folder)) ? (await k.fs.readdir(folder)).filter((e) => e.type === 'file' && IMAGE_EXT.has(e.ext)) : [];
  for (const e of custom) {
    const { url } = await resolveWallpaper(`file:${e.path}`, k.fs);
    items.push(btn(`file:${e.path}`, e.name, h('img', { src: url, alt: '' })));
  }
  if (colors) for (const c of SOLID_COLORS) items.push(btn(`color:${c}`, `Solid colour ${c}`, h('div.wp-solid', { style: { background: c } })));
  return h('div.wp-grid', { role: 'radiogroup' }, items);
}
