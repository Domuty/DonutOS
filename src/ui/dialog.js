// Modal dialogs. dialog() resolves with the value of the button pressed
// (or `cancelValue` on Escape / backdrop click).

import { h, settle } from './h.js';

export function dialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], width, cancelValue = null, onOpen, parent = document.body, dismissible = true } = {}) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    let closed = false;
    const close = async (value) => {
      if (closed) return;
      if (value !== cancelValue) {
        const btn = buttons.find((b) => b.value === value);
        if (btn?.validate) {
          const ok = await btn.validate();
          if (!ok) return;
        }
      }
      closed = true;
      backdrop.classList.add('closing'); box.classList.add('closing');
      await settle(box, 200);
      backdrop.remove();
      previouslyFocused?.focus?.();
      resolve(value);
    };
    const box = h('div.dlg', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog', style: width ? { '--w': `${width}px` } : null },
      h('div.dlg-body', title ? h('h2', title) : null, body),
      buttons.length ? h('div.dlg-foot', buttons.map((b) => h('button.btn', {
        class: [b.primary && 'primary', b.danger && 'danger'], type: 'button', onclick: () => close(b.value), dataset: { value: String(b.value) },
      }, b.label))) : null,
    );
    const backdrop = h('div.dlg-backdrop', { onmousedown: (e) => { if (e.target === backdrop && dismissible) close(cancelValue); } }, box);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(cancelValue); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const primary = buttons.find((b) => b.primary);
        if (primary) { e.preventDefault(); close(primary.value); }
      }
      if (e.key === 'Tab') trapFocus(box, e);
    });
    parent.append(backdrop);
    // Focus the first text field; otherwise the default button (not a random control).
    const first = box.querySelector('[autofocus], input:not([type=checkbox]):not([type=radio]):not([type=color]), textarea') || box.querySelector('.dlg-foot .primary') || box.querySelector('button');
    first?.focus();
    onOpen?.({ box, close });
  });
}

function trapFocus(box, e) {
  const items = [...box.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export const alertDialog = (title, message, opts = {}) =>
  dialog({ title, body: h('p', message), buttons: [{ label: opts.ok || 'OK', value: true, primary: true }], ...opts });

export const confirmDialog = (title, message, { ok = 'OK', cancel = 'Cancel', danger = false, ...opts } = {}) =>
  dialog({ title, body: typeof message === 'string' ? h('p', message) : message, cancelValue: false,
    buttons: [{ label: ok, value: true, primary: !danger, danger }, { label: cancel, value: false }], ...opts });

/** Asks for one line of text. Resolves with the text, or null when cancelled. */
export async function promptDialog(title, { label = '', value = '', placeholder = '', ok = 'OK', validate } = {}) {
  const input = h('input.input', { value, placeholder, 'aria-label': label || title, autofocus: true });
  const err = h('div.error-text');
  const res = await dialog({
    title, cancelValue: null,
    body: h('div.field', label ? h('label', label) : null, input, err),
    buttons: [{ label: ok, value: 'ok', primary: true, validate: async () => {
      const msg = validate ? await validate(input.value) : null;
      err.textContent = msg || '';
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      return !msg;
    } }, { label: 'Cancel', value: null }],
    onOpen: () => input.select(),
  });
  return res === 'ok' ? input.value : null;
}
