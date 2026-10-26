// Tab strips for File Explorer, Terminal, Notepad and Browser.
//
// The strip is one stop in the Tab order: ←/→ (and Home/End) move between tabs and select
// them, Delete closes the focused tab. The × on each tab is for the mouse; a control inside
// a tab can't also be its own keyboard stop.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';

export function createTabStrip(label) {
  const list = h('div.ex-tablist', { role: 'tablist', 'aria-label': label });
  const el = h('div.ex-tabs.drag', list);
  list.addEventListener('keydown', (e) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      const t = tabs[(to + tabs.length) % tabs.length];
      t.click();
      // The strip re-renders on select; focus the new copy of that tab.
      requestAnimationFrame(() => list.querySelectorAll('[role="tab"]')[(to + tabs.length) % tabs.length]?.focus());
    } else if (e.key === 'Delete') {
      e.preventDefault();
      tabs[i].querySelector('.ex-tab-x')?.click();
      requestAnimationFrame(() => list.querySelector('[role="tab"][aria-selected="true"]')?.focus());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      tabs[i].click();
    }
  });
  return el;
}

/** Fills a strip made by createTabStrip: the tabs, then the "new tab" button after the list. */
export function renderTabStrip(strip, tabEls, newButton) {
  const list = strip.querySelector('.ex-tablist');
  const hadFocus = list.contains(document.activeElement);
  for (const t of tabEls) t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
  mount(list, tabEls);
  if (newButton) { strip.querySelector('.ex-tab-new')?.remove(); strip.append(newButton); }
  if (hadFocus) list.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
}

/** The × on a tab (mouse); Delete does the same from the keyboard. */
export function tabCloser(label, onClose) {
  return h('span.ex-tab-x', { 'aria-hidden': 'true', title: label, onclick: (e) => { e.stopPropagation(); onClose(); } }, icon('close', { size: 10 }));
}
