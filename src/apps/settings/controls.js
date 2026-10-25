// Building blocks for Settings pages: rows, toggles, selects, sliders, links.

import { h } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';

export const row = (ic, title, desc, ...controls) =>
  h('div.row', ic ? (typeof ic === 'string' ? icon(ic) : ic) : null, h('div.grow', h('div.t', title), desc ? h('div.d', desc) : null), ...controls);

export const section = (title) => h('div.section-title', title);

export function toggle(s, key, { onChange, label } = {}) {
  const input = h('input', { type: 'checkbox', checked: s.get(key), 'aria-label': label || key,
    onchange: (e) => { s.set(key, e.target.checked); onChange?.(e.target.checked); } });
  return h('label.toggle', h('small.toggle-state', s.get(key) ? 'On' : 'Off'), input, h('span'));
}

export function select(s, key, options, { width = 180, label, onChange } = {}) {
  return h('select.input', { style: { width: `${width}px` }, 'aria-label': label || key,
    onchange: (e) => { const v = typeof s.get(key) === 'number' ? Number(e.target.value) : e.target.value; s.set(key, v); onChange?.(v); } },
  options.map(([v, l]) => h('option', { value: String(v), selected: s.get(key) === v }, l)));
}

export function slider(s, key, { min = 0, max = 100, step = 1, label, format = (v) => `${v}` } = {}) {
  const value = s.get(key);
  const out = h('small.slider-value', format(value));
  const pct = (v) => `${((v - min) / (max - min)) * 100}%`;
  const input = h('input.slider', { type: 'range', min, max, step, value, 'aria-label': label || key, style: { width: '200px', '--p': pct(value) },
    oninput: (e) => { const v = Number(e.target.value); e.target.style.setProperty('--p', pct(v)); out.textContent = format(v); s.set(key, v); } });
  return h('div.slider-wrap', out, input);
}

export const link = (ic, title, desc, onClick) =>
  h('button.row.row-link', { type: 'button', onclick: onClick }, ic ? icon(ic) : null, h('div.grow', h('div.t', title), desc ? h('div.d', desc) : null), icon('chevronRight', { size: 16 }));

/** Rebuilds a toggle row's On/Off label when it changes (labels are static otherwise). */
export function liveToggles(container) {
  container.addEventListener('change', (e) => {
    const t = e.target.closest('.toggle');
    if (t && e.target.type === 'checkbox') t.querySelector('.toggle-state').textContent = e.target.checked ? 'On' : 'Off';
  });
}
