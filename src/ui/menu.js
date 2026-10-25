// Context / dropdown menus.
// showMenu(items, { x, y } | { anchor, placement: 'above' | 'below' })
// items: { label, icon (name or image URL), checked, onSelect, disabled, danger, hint } | { separator: true } | { header: 'Text' }

import { h } from './h.js';
import { icon as makeIcon } from './icons.js';

let open = null;

export function closeMenu() { open?.(); }

export function showMenu(items, { x, y, anchor, placement = 'below', parent = document.body } = {}) {
  closeMenu();
  const previousFocus = document.activeElement;
  const previousWindow = previousFocus?.closest?.('.win');
  const menu = h('div.menu', { role: 'menu' }, items.map((it) => it.separator ? h('hr') : it.header ? h('div.menu-header', it.header) : h('button', {
    role: 'menuitem', type: 'button', disabled: !!it.disabled, class: it.danger && 'danger',
    onclick: () => { close(); it.onSelect?.(); },
  }, it.checked !== undefined ? h('span.menu-check', it.checked ? makeIcon('check', { size: 16 }) : null)
    : it.icon?.includes('/') ? h('img', { src: it.icon, alt: '', width: 16, height: 16 })
    : it.icon ? makeIcon(it.icon, { size: 16 }) : h('span', { style: { width: '16px' } }),
  h('span', { style: { flex: 1 } }, it.label), it.hint ? h('span.menu-hint', it.hint) : null)));
  parent.append(menu);

  const r = menu.getBoundingClientRect();
  let left = x, top = y;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    left = a.left + a.width / 2 - r.width / 2;
    top = placement === 'above' ? a.top - r.height - 8 : a.bottom + 8;
    if (placement === 'above') menu.classList.add('up');
  }
  left = Math.max(8, Math.min(left, innerWidth - r.width - 8));
  top = Math.max(8, Math.min(top, innerHeight - r.height - 8));
  Object.assign(menu.style, { left: `${left}px`, top: `${top}px` });

  const onDown = (e) => { if (!menu.contains(e.target) && !anchor?.contains(e.target)) close(); };
  const onKey = (e) => {
    const btns = [...menu.querySelectorAll('button:not(:disabled)')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); anchor?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  };
  setTimeout(() => document.addEventListener('pointerdown', onDown, true));
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeMenuSoon);
  function close() {
    const hadFocus = menu.contains(document.activeElement);
    menu.remove();
    // Give focus back to where it was (the app window), as a desktop OS does.
    if (hadFocus) {
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      else previousWindow?.querySelector('.win-body')?.focus({ preventScroll: true });
    }
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', closeMenuSoon);
    if (open === close) open = null;
  }
  open = close;
  menu.querySelector('button:not(:disabled)')?.focus();
  return close;
}

function closeMenuSoon() { closeMenu(); }
