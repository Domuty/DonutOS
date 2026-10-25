// Lock screen: wallpaper, big clock and date, network/battery status.
// Dismiss by clicking, pressing a key, scrolling, or dragging it upwards.

import { h, settle } from '../ui/h.js';
import { paintWallpaper } from './wallpaper.js';
import { formatClock, formatDate, everyTick } from './format.js';
import { mountStatusIcons } from './status-icons.js';
import { prefsFor, lockWallpaperOf } from './prefs.js';

export async function showLockScreen(layer, { kernel, uid, onDismiss, entering = false }) {
  const prefs = await prefsFor(kernel, uid);
  const time = h('div.lock-time');
  const date = h('div.lock-date');
  const wp = h('div.wp');
  const status = h('div.lock-status');
  const el = h('div.screen.lock', { class: entering && 'entering', role: 'region', 'aria-label': 'Lock screen. Press any key to sign in.', tabindex: '0' },
    wp, h('div.lock-clock', time, date), status, h('div.lock-hint', 'Click or press any key to sign in'));
  layer.append(el);
  await paintWallpaper(wp, lockWallpaperOf(prefs, kernel), kernel.fs, prefs.get('appearance.wallpaperFit'));

  const stopClock = everyTick(() => {
    const now = new Date();
    time.textContent = formatClock(now, prefs);
    date.textContent = formatDate(now, prefs, 'full');
  });
  const stopStatus = prefs.get('lock.showStatus') ? mountStatusIcons(status, kernel.platform, { size: 22 }) : () => {};

  let done = false;
  const dismiss = async (initialKey = '') => {
    if (done) return;
    done = true;
    cleanup();
    el.classList.remove('dragging');
    el.style.transform = '';
    el.classList.add('leaving');
    onDismiss?.(initialKey);
    await settle(el, 600);
    destroy();
  };

  // Drag the curtain up.
  let startY = null, lastY = 0, lastT = 0, velocity = 0, moved = false;
  const onDown = (e) => {
    if (e.button !== 0) return;
    startY = e.clientY; lastY = e.clientY; lastT = performance.now(); moved = false; velocity = 0;
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (startY === null) return;
    const dy = Math.min(0, e.clientY - startY);
    if (Math.abs(e.clientY - startY) > 6) { moved = true; el.classList.add('dragging'); }
    const now = performance.now();
    velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY; lastT = now;
    if (moved) el.style.transform = `translateY(${dy}px)`;
  };
  const onUp = (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (!moved || dy < -innerHeight * 0.2 || velocity < -0.6) { dismiss(); return; }
    el.classList.remove('dragging');
    el.style.transform = '';
  };
  const onKey = (e) => {
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) return;
    e.preventDefault();
    dismiss(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey ? e.key : '');
  };
  const onWheel = (e) => { if (e.deltaY > 0) dismiss(); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: true });
  document.addEventListener('keydown', onKey);
  el.focus({ preventScroll: true });

  function cleanup() {
    stopClock();
    document.removeEventListener('keydown', onKey);
  }
  function destroy() {
    cleanup();
    stopStatus();
    el.remove();
  }
  return { el, dismiss, destroy };
}
