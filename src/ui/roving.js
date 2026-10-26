// Arrow-key navigation inside a group (taskbar buttons, Start's pinned apps…): the group is
// one stop in the Tab order and ←/→ (↑/↓ in grids and lists), Home and End move between
// its items. Call refresh() after re-rendering the items.

export function roving(container, selector, { grid = false, vertical = false } = {}) {
  let current = 0;
  // (Visibility needs layout, so it's only checked when a key is pressed.)
  const items = ({ visible = false } = {}) => [...container.querySelectorAll(selector)].filter((el) => !el.disabled && (!visible || el.offsetParent !== null));
  const columns = (list) => {
    if (!grid || !list.length) return vertical ? 1 : list.length;
    const top = list[0].offsetTop;
    const n = list.findIndex((el) => el.offsetTop !== top);
    return n < 0 ? list.length : n;
  };
  const refresh = () => {
    const list = items();
    const focused = list.indexOf(document.activeElement);
    if (focused >= 0) current = focused;
    current = Math.max(0, Math.min(current, list.length - 1));
    list.forEach((el, i) => { el.tabIndex = i === current ? 0 : -1; });
  };
  container.addEventListener('keydown', (e) => {
    const list = items({ visible: true });
    const i = list.indexOf(document.activeElement);
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const cols = columns(list);
    const step = { ArrowRight: vertical ? 0 : 1, ArrowLeft: vertical ? 0 : -1, ArrowDown: grid ? cols : vertical ? 1 : 0, ArrowUp: grid ? -cols : vertical ? -1 : 0 }[e.key];
    let to = null;
    if (step) to = Math.max(0, Math.min(list.length - 1, i + step));
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list.length - 1;
    if (to === null) return;
    e.preventDefault();
    current = to;
    list.forEach((el, k) => { el.tabIndex = k === to ? 0 : -1; });
    list[to].focus();
  });
  container.addEventListener('focusin', () => refresh());
  refresh();
  return { refresh };
}
