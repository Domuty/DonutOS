// Screenshots: PrintScreen saves the whole screen; Win+Shift+S lets you pick a rectangle,
// a window, or the full screen. The result is copied to the clipboard and saved to
// Pictures/Screenshots, and a notification opens it in Snipping Tool.
// (The web version asks the browser for permission to capture the tab each time.)

import { h, settle } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { alertDialog } from '../ui/dialog.js';
import { closeMenu } from '../ui/menu.js';
import * as P from '../core/path.js';

const pad = (n) => String(n).padStart(2, '0');
export function screenshotName(d = new Date()) {
  return `Screenshot ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
}

/** Captures the screen as an ImageBitmap plus PNG bytes. Menus/flyouts are closed first. */
export async function captureScreen(kernel, session) {
  closeMenu();
  session?.flyouts.close();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const shot = await kernel.platform.capture.screen();
  const bitmap = await createImageBitmap(new Blob([shot.data], { type: 'image/png' }));
  return { ...shot, bitmap };
}

async function cropToPng(bitmap, rect, scale) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(rect.w * scale));
  c.height = Math.max(1, Math.round(rect.h * scale));
  c.getContext('2d').drawImage(bitmap, rect.x * scale, rect.y * scale, c.width, c.height, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Saves PNG bytes to Pictures/Screenshots, copies them to the clipboard, and notifies. */
export async function deliverScreenshot(kernel, session, png) {
  const dir = P.join(session.user.home, 'Pictures', 'Screenshots');
  await kernel.fs.mkdir(dir, { recursive: true });
  const path = P.join(dir, await kernel.fs.uniqueName(dir, screenshotName()));
  await kernel.fs.writeFile(path, png);
  let copied = false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
    copied = true;
  } catch { /* clipboard images unavailable: the file is still saved */ }
  kernel.notifications.post({
    appId: 'snipping', appName: 'Snipping Tool', icon: kernel.registry.get('snipping')?.icon,
    title: copied ? 'Screenshot copied to clipboard' : 'Screenshot saved',
    body: `Saved to Pictures › Screenshots as ${P.basename(path)}. Select to mark up and share.`,
    data: { path }, uid: session.uid,
  });
  return path;
}

async function capture(kernel, session) {
  try {
    return await captureScreen(kernel, session);
  } catch (err) {
    if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') await alertDialog('Couldn’t take a screenshot', err.message || String(err));
    return null;
  }
}

export async function fullScreenshot(kernel, session) {
  const shot = await capture(kernel, session);
  if (!shot) return null;
  return deliverScreenshot(kernel, session, shot.data);
}

/**
 * Shows the captured screen frozen under a dimmed overlay and lets the user choose an
 * area. Resolves with PNG bytes, or null if cancelled.
 */
export async function pickRegion(kernel, session, { mode = 'rect' } = {}) {
  const shot = await capture(kernel, session);
  if (!shot) return null;
  const scale = shot.width / innerWidth;
  const canvas = h('canvas.snip-img', { width: shot.width, height: shot.height });
  canvas.getContext('2d').drawImage(shot.bitmap, 0, 0);
  const sel = h('div.snip-sel', { hidden: true });
  const modes = [['rect', 'Rectangle', 'view'], ['window', 'Window', 'apps'], ['full', 'Full screen', 'monitor']];
  let current = mode;
  const bar = h('div.snip-bar.acrylic', modes.map(([id, label, ic]) => h('button.tb-btn', { type: 'button', title: label, 'aria-label': `${label} mode`, 'aria-pressed': String(current === id), onclick: () => setMode(id) }, icon(ic, { size: 18 }))),
    h('span.snip-sep'), h('button.tb-btn', { type: 'button', title: 'Close', 'aria-label': 'Cancel', onclick: () => finish(null) }, icon('close', { size: 18 })));
  const overlay = h('div.snip-overlay', { tabindex: '-1' }, canvas, h('div.snip-dim'), sel, bar);
  document.getElementById('root').append(overlay);
  overlay.focus();

  let resolveFn;
  const done = new Promise((r) => { resolveFn = r; });
  async function finish(rect) {
    overlay.removeEventListener('keydown', onKey);
    const png = rect && rect.w > 2 && rect.h > 2 ? await cropToPng(shot.bitmap, rect, scale) : null;
    overlay.classList.add('out');
    await settle(overlay, 200);
    overlay.remove();
    resolveFn(png);
  }
  function setMode(id) {
    current = id;
    bar.querySelectorAll('[aria-pressed]').forEach((b, i) => b.setAttribute('aria-pressed', String(modes[i][0] === id)));
    if (id === 'full') finish({ x: 0, y: 0, w: innerWidth, h: innerHeight });
  }
  const onKey = (e) => { if (e.key === 'Escape') finish(null); if (e.key === 'Enter' && current === 'full') finish({ x: 0, y: 0, w: innerWidth, h: innerHeight }); };
  overlay.addEventListener('keydown', onKey);

  const windows = session.wm.list().filter((w) => w.state !== 'minimized').sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex));
  const windowAt = (x, y) => windows.find((w) => x >= w.bounds.x && x <= w.bounds.x + w.bounds.w && y >= w.bounds.y && y <= w.bounds.y + w.bounds.h);
  const show = (r) => { Object.assign(sel.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); sel.hidden = false; };

  overlay.addEventListener('pointermove', (e) => {
    if (current !== 'window' || e.target.closest('.snip-bar')) return;
    const w = windowAt(e.clientX, e.clientY);
    if (w) show({ x: w.bounds.x, y: w.bounds.y, w: w.bounds.w, h: w.bounds.h }); else sel.hidden = true;
  });
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.snip-bar') || e.button !== 0) return;
    if (current === 'window') {
      const w = windowAt(e.clientX, e.clientY);
      if (w) finish({ x: Math.max(0, w.bounds.x), y: Math.max(0, w.bounds.y), w: Math.min(w.bounds.w, innerWidth - w.bounds.x), h: Math.min(w.bounds.h, innerHeight - w.bounds.y) });
      return;
    }
    if (current !== 'rect') return;
    const sx = e.clientX, sy = e.clientY;
    overlay.setPointerCapture(e.pointerId);
    const rectFrom = (ev) => ({ x: Math.min(sx, ev.clientX), y: Math.min(sy, ev.clientY), w: Math.abs(ev.clientX - sx), h: Math.abs(ev.clientY - sy) });
    const move = (ev) => show(rectFrom(ev));
    const up = (ev) => {
      overlay.removeEventListener('pointermove', move);
      overlay.removeEventListener('pointerup', up);
      const r = rectFrom(ev);
      if (r.w < 4 || r.h < 4) { sel.hidden = true; return; }
      finish(r);
    };
    overlay.addEventListener('pointermove', move);
    overlay.addEventListener('pointerup', up);
  });
  return done;
}

export async function snipToClipboard(kernel, session) {
  const png = await pickRegion(kernel, session);
  if (png) await deliverScreenshot(kernel, session, png);
}
