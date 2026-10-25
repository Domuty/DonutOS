// Shell helpers for launching apps and opening files, with user-facing error handling,
// plus pin management for Start and the taskbar.

import { h } from '../ui/h.js';
import { dialog, alertDialog } from '../ui/dialog.js';
import { extname } from '../core/path.js';

export async function launchApp(kernel, appId, args = {}) {
  try {
    return await kernel.launch(appId, args);
  } catch (err) {
    await alertDialog('Couldn’t open the app', err.message);
    return null;
  }
}

/** Opens a file or folder with its default app; asks "Open with" when there isn't one. */
export async function openPath(kernel, path, { appId } = {}) {
  try {
    const s = await kernel.fs.stat(path);
    if (!s) { await alertDialog('Item not found', `${path} no longer exists. It may have been moved or deleted.`); return null; }
    if (s.type === 'dir' && !appId && !kernel.registry.has('explorer')) {
      await alertDialog('No app can open folders', 'Install a file manager to browse folders.');
      return null;
    }
    const target = appId || (s.type === 'dir' ? 'explorer' : kernel.associations.appForPath(path));
    if (!target) return openWith(kernel, path);
    return await kernel.open(path, { appId: target });
  } catch (err) {
    await alertDialog('Couldn’t open this item', err.message);
    return null;
  }
}

/** Lets the user pick any installed app to open a file, optionally making it the default. */
export async function openWith(kernel, path) {
  const ext = extname(path);
  const handlers = ext ? kernel.associations.handlersFor(ext) : [];
  const others = kernel.registry.list().filter((a) => !handlers.includes(a) && (a.fileTypes || []).length);
  const choices = [...handlers, ...others];
  if (!choices.length) {
    await alertDialog('No app can open this file', `No installed app can open ${ext ? `${ext} files` : 'this file'}. You can look for one in the Store.`);
    return null;
  }
  let chosen = choices[0].id;
  const always = h('input', { type: 'checkbox', id: 'ow-always' });
  const list = h('div', { role: 'listbox', style: { display: 'grid', gap: '2px', maxHeight: '300px', overflow: 'auto' } }, choices.map((a) =>
    h('button.btn.subtle', { type: 'button', role: 'option', 'aria-selected': String(a.id === chosen), style: { justifyContent: 'flex-start', gap: '12px', padding: '8px 12px' },
      onclick: (e) => { chosen = a.id; list.querySelectorAll('[role=option]').forEach((b) => { b.setAttribute('aria-selected', 'false'); b.style.background = ''; }); e.currentTarget.setAttribute('aria-selected', 'true'); e.currentTarget.style.background = 'var(--accent-soft)'; },
      ondblclick: () => document.querySelector('.dlg-foot .primary')?.click() },
    h('img', { src: a.icon, alt: '', width: 28, height: 28 }), h('span', a.name, handlers.includes(a) ? '' : h('small', { style: { color: 'var(--text-3)', marginLeft: '8px' } }, '(may not support this file)')))));
  setTimeout(() => list.querySelector('[aria-selected=true]')?.style.setProperty('background', 'var(--accent-soft)'));
  const ok = await dialog({
    title: `How do you want to open ${path.split('/').pop()}?`,
    body: h('div', { style: { display: 'grid', gap: '12px' } }, list,
      ext && handlers.length ? h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, always, `Always use this app to open ${ext} files`) : null),
    cancelValue: false, buttons: [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }],
  });
  if (!ok) return null;
  if (always.checked && kernel.registry.get(chosen)?.fileTypes?.includes(ext)) kernel.associations.setDefault(ext, chosen);
  return kernel.open(path, { appId: chosen });
}

// ── Pins ──────────────────────────────────────────────────────────────

export function pinned(kernel, where) {
  return kernel.settings.get(`${where}.pinned`).filter((id) => kernel.registry.has(id));
}

export function isPinned(kernel, where, appId) { return kernel.settings.get(`${where}.pinned`).includes(appId); }

export function setPinned(kernel, where, appId, on) {
  const list = kernel.settings.get(`${where}.pinned`).filter((id) => id !== appId);
  if (on) list.push(appId);
  kernel.settings.set(`${where}.pinned`, list);
}

/** Uninstalls a Store app for good: ends it, removes it, and clears its settings, permissions and pins for `uid`. */
export async function uninstallApp(kernel, appId, uid) {
  for (const p of kernel.processes.byApp(appId)) await kernel.processes.kill(p.pid, { force: true });
  await kernel.registry.uninstall(appId);
  kernel.settings.forUser(uid).resetPrefix(`app.${appId}.`);
  kernel.permissions.reset(appId, null, uid);
  for (const where of ['start', 'taskbar']) setPinned(kernel, where, appId, false);
}

/** Moves `appId` before `beforeId` (or to the end) among the pins. */
export function movePin(kernel, where, appId, beforeId) {
  const list = kernel.settings.get(`${where}.pinned`).filter((id) => id !== appId);
  const i = beforeId ? list.indexOf(beforeId) : -1;
  list.splice(i < 0 ? list.length : i, 0, appId);
  kernel.settings.set(`${where}.pinned`, list);
}

export function rememberRecentApp(kernel, appId) {
  if (!kernel.settings.currentUser) return;
  const list = kernel.settings.get('start.recentApps').filter((r) => r.id !== appId);
  kernel.settings.set('start.recentApps', [{ id: appId, time: Date.now() }, ...list].slice(0, 12));
}
