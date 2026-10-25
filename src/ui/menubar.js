// A classic menu bar (File  Edit  View …). Each menu's items are built when it opens, so
// checkmarks and disabled states are always current. While a menu is open, hovering another
// title or pressing ←/→ switches menus.

import { h } from './h.js';
import { showMenu, closeMenu } from './menu.js';

export function menubar(menus) {
  let openIndex = -1;
  const buttons = menus.map((m, i) => h('button.mb-item', {
    type: 'button', 'aria-haspopup': 'menu',
    onclick: () => (openIndex === i ? close() : openAt(i)),
    onpointerenter: () => { if (openIndex >= 0 && openIndex !== i) openAt(i); },
  }, m.label));
  const bar = h('div.menubar', { role: 'menubar' }, buttons);

  function close() { closeMenu(); }

  function openAt(i) {
    openIndex = i;
    buttons.forEach((b, j) => b.classList.toggle('open', j === i));
    const items = typeof menus[i].items === 'function' ? menus[i].items() : menus[i].items;
    const done = showMenu(items, {
      anchor: buttons[i], align: 'start',
      onKey: (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          openAt((i + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length);
          return true;
        }
        return false;
      },
    });
    // showMenu returns its close function; watch for it closing to reset the bar.
    const watcher = new MutationObserver(() => {
      if (!document.querySelector('.menu')) { watcher.disconnect(); if (openIndex === i) { openIndex = -1; buttons.forEach((b) => b.classList.remove('open')); } }
    });
    watcher.observe(document.body, { childList: true });
    return done;
  }
  return bar;
}
