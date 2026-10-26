// A classic menu bar (File  Edit  View …). Each menu's items are built when it opens, so
// checkmarks and disabled states are always current. While a menu is open, hovering another
// title or pressing ←/→ switches menus.

import { h } from './h.js';
import { showMenu, closeMenu } from './menu.js';

export function menubar(menus) {
  let openIndex = -1;
  const buttons = menus.map((m, i) => h('button.mb-item', {
    type: 'button', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', tabindex: i === 0 ? '0' : '-1',
    onclick: (e) => (openIndex === i ? close() : openAt(i, { keyboard: e.detail === 0 })),
    onpointerenter: () => { if (openIndex >= 0 && openIndex !== i) openAt(i); },
  }, m.label));
  // One Tab stop; ←/→ move along the bar, ↓ opens a menu.
  const bar = h('div.menubar', { role: 'menubar', onkeydown: (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons.forEach((b, k) => { b.tabIndex = k === j ? 0 : -1; });
      buttons[j].focus();
    } else if (e.key === 'ArrowDown') { e.preventDefault(); openAt(i, { keyboard: true }); }
  } }, buttons);

  function close() { closeMenu(); }

  function openAt(i, { keyboard = false } = {}) {
    openIndex = i;
    buttons.forEach((b, j) => { b.classList.toggle('open', j === i); b.setAttribute('aria-expanded', String(j === i)); });
    const items = typeof menus[i].items === 'function' ? menus[i].items() : menus[i].items;
    const done = showMenu(items, {
      anchor: buttons[i], align: 'start',
      onKey: (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          openAt((i + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length, { keyboard: true });
          return true;
        }
        return false;
      },
    });
    if (keyboard) document.querySelector('.menu button:not(:disabled)')?.focus();
    // showMenu returns its close function; watch for it closing to reset the bar.
    const watcher = new MutationObserver(() => {
      if (!document.querySelector('.menu')) { watcher.disconnect(); if (openIndex === i) { openIndex = -1; buttons.forEach((b) => { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); }); } }
    });
    watcher.observe(document.body, { childList: true });
    return done;
  }
  return bar;
}
