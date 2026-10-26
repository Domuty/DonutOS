// What a screen reader says for an element: its accessible name, role, state and value,
// following the ARIA rules in simplified form (aria-labelledby, aria-label, <label>, alt,
// title, text content, placeholder).

const ROLE_WORDS = {
  button: 'button', link: 'link', checkbox: 'check box', radio: 'radio button', switch: 'toggle switch', tab: 'tab',
  menuitem: 'menu item', menuitemcheckbox: 'menu item', menuitemradio: 'menu item', option: 'item', listbox: 'list box',
  dialog: 'dialog', alertdialog: 'alert dialog', slider: 'slider', searchbox: 'search box', textbox: 'edit', combobox: 'combo box',
  tree: 'tree', treeitem: 'tree item', grid: 'grid', gridcell: 'cell', row: 'row', columnheader: 'column header',
  img: 'image', image: 'image', region: 'region', navigation: 'navigation', toolbar: 'tool bar', menubar: 'menu bar', menu: 'menu',
  tablist: 'tab list', tabpanel: 'tab panel', progressbar: 'progress bar', status: 'status', alert: 'alert', list: 'list',
  listitem: 'list item', heading: 'heading', spinbutton: 'spin button', group: 'group', separator: 'separator', main: 'main',
};

const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const clip = (s, n = 250) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The element's role (explicit or implied by its tag). */
export function roleOf(el) {
  const explicit = el.getAttribute?.('role');
  if (explicit) return explicit.split(' ')[0];
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
  if (tag === 'A' && el.hasAttribute('href')) return 'link';
  if (tag === 'SELECT') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
  if (tag === 'TEXTAREA') return 'textbox';
  if (tag === 'IMG') return el.getAttribute('alt') === '' ? 'presentation' : 'img';
  if (/^H[1-6]$/.test(tag)) return 'heading';
  if (tag === 'LI') return 'listitem';
  if (tag === 'UL' || tag === 'OL') return 'list';
  if (tag === 'DIALOG') return 'dialog';
  if (tag === 'NAV') return 'navigation';
  if (tag === 'MAIN') return 'main';
  if (tag === 'PROGRESS') return 'progressbar';
  if (tag === 'OUTPUT') return 'status';
  if (tag === 'INPUT') {
    const t = (el.type || 'text').toLowerCase();
    if (t === 'checkbox') return el.closest('.toggle') ? 'switch' : 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'range') return 'slider';
    if (t === 'number') return 'spinbutton';
    if (t === 'search') return 'searchbox';
    if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
    if (t === 'hidden') return null;
    return 'textbox';
  }
  if (el.isContentEditable && el.contentEditable !== 'inherit') return 'textbox';
  return null;
}

const NAME_FROM_CONTENT = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'heading', 'listitem', 'treeitem', 'gridcell', 'columnheader', 'row', 'switch', 'checkbox', 'radio', 'cell', 'status', 'alert']);

/** The accessible name. */
export function nameOf(el) {
  const doc = el.ownerDocument;
  const by = el.getAttribute?.('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => textOf(doc.getElementById(id))).filter(Boolean).join(' ');
    if (t) return clip(t);
  }
  const label = el.getAttribute?.('aria-label');
  if (label?.trim()) return clip(label.trim());
  if (el.tagName === 'IMG' || (el.tagName === 'INPUT' && el.type === 'image')) { const alt = el.getAttribute('alt'); if (alt) return clip(alt); }
  if (el.labels?.length) {
    // The label's text without the control's own text (a toggle wraps its input).
    const t = [...el.labels].map((l) => { const c = l.cloneNode(true); c.querySelectorAll('input, select, textarea, .toggle-state').forEach((x) => x.remove()); return textOf(c); }).filter(Boolean).join(' ');
    if (t) return clip(t);
  }
  const role = roleOf(el);
  if (NAME_FROM_CONTENT.has(role) || el.tagName === 'BUTTON') {
    const c = el.cloneNode(true);
    c.querySelectorAll('[aria-hidden="true"], .sr-skip').forEach((x) => x.remove());
    for (const img of c.querySelectorAll('img[alt]')) img.replaceWith(` ${img.getAttribute('alt')} `);
    const t = textOf(c);
    if (t) return clip(t);
  }
  const title = el.getAttribute?.('title');
  if (title) return clip(title);
  if (el.placeholder) return clip(el.placeholder);
  return '';
}

/** State words: "checked", "expanded", "unavailable"… */
export function statesOf(el) {
  const out = [];
  const role = roleOf(el);
  const aria = (n) => el.getAttribute?.(`aria-${n}`);
  if (role === 'switch') out.push((el.checked ?? aria('checked') === 'true') ? 'on' : 'off');
  else if (role === 'checkbox' || role === 'menuitemcheckbox' || role === 'radio' || role === 'menuitemradio') {
    const c = el.tagName === 'INPUT' ? el.checked : aria('checked') === 'true';
    out.push(c ? 'checked' : 'not checked');
  }
  if (aria('pressed') !== null && aria('pressed') !== undefined) out.push(aria('pressed') === 'true' ? 'pressed' : 'not pressed');
  if (aria('expanded') !== null && aria('expanded') !== undefined) out.push(aria('expanded') === 'true' ? 'expanded' : 'collapsed');
  if (aria('selected') === 'true') out.push('selected');
  if (aria('current') && aria('current') !== 'false') out.push('current');
  if (el.disabled || aria('disabled') === 'true') out.push('unavailable');
  if (el.required || aria('required') === 'true') out.push('required');
  if (aria('invalid') === 'true') out.push('invalid entry');
  if (el.readOnly && role === 'textbox') out.push('read only');
  return out;
}

/** The value a control holds (text in an edit box, a slider's value…). */
export function valueOf(el) {
  const role = roleOf(el);
  if (el.getAttribute?.('aria-valuetext')) return el.getAttribute('aria-valuetext');
  if (role === 'slider' || role === 'spinbutton' || role === 'progressbar') return el.value ?? el.getAttribute('aria-valuenow') ?? '';
  if (role === 'combobox' && el.tagName === 'SELECT') return el.selectedOptions[0]?.textContent.trim() || '';
  if (role === 'textbox' || role === 'searchbox') {
    if (el.type === 'password') return el.value ? `${el.value.length} characters, protected` : '';
    const v = el.isContentEditable ? textOf(el) : el.value || '';
    return clip(v, 400);
  }
  return '';
}

/** One line for Narrator: "Wi-Fi, toggle switch, on". */
export function describe(el) {
  if (!el || el.nodeType !== 1) return '';
  const role = roleOf(el);
  const name = nameOf(el);
  const parts = [];
  const value = valueOf(el);
  if (name) parts.push(name);
  if (value && value !== name) parts.push(value);
  if (role === 'heading') parts.push(`heading level ${Number(el.getAttribute('aria-level')) || Number(el.tagName.slice(1)) || 2}`);
  else if (role === 'textbox') parts.push(el.tagName === 'TEXTAREA' || el.getAttribute('aria-multiline') === 'true' ? 'edit, multi-line' : 'edit');
  else if (role && ROLE_WORDS[role] && role !== 'presentation' && role !== 'none') parts.push(ROLE_WORDS[role]);
  parts.push(...statesOf(el));
  const desc = el.getAttribute?.('aria-describedby');
  if (desc) { const t = desc.split(/\s+/).map((id) => textOf(el.ownerDocument.getElementById(id))).filter(Boolean).join(' '); if (t) parts.push(clip(t, 200)); }
  if (!parts.length) return clip(textOf(el));
  return parts.join(', ');
}
