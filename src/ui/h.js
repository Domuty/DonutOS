// A tiny hyperscript helper used by the shell and the apps.
//
//   h('button.btn.primary', { onclick: save, type: 'submit' }, 'Save')
//   h('div', { class: ['row', active && 'on'], style: { gap: '8px' }, dataset: { id: 3 } }, children)
//
// Props: class (string | array), style (object | string), dataset, on<event> handlers,
// ref (callback receiving the element), html (trusted innerHTML), and any attribute.
// Children may be strings, numbers, nodes, arrays, or null/false (skipped).

export function h(tag, props, ...children) {
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props); props = null;
  }
  const m = /^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m?.[1] || 'div');
  for (const part of (m?.[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') {
      for (const c of [].concat(v).flat()) if (c) el.classList.add(...String(c).split(/\s+/).filter(Boolean));
    } else if (k === 'style') {
      if (typeof v === 'string') el.style.cssText = v; else for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k === 'ref') {
      v(el);
    } else if (k === 'html') {
      el.innerHTML = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k in el && typeof v !== 'string' && k !== 'list') {
      el[k] = v;
    } else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') {
      el[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : v);
    }
  }
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Replaces all children. */
export function mount(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** Parses an SVG string into an element. */
export function svgEl(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

/** Resolves after the next paint — use before starting a CSS transition on a new element. */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** Resolves when the element's transition/animation ends (or after `max` ms). */
export function settle(el, max = 600) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    el.addEventListener('transitionend', finish, { once: true });
    el.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, max);
  });
}
