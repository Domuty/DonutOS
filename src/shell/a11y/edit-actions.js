// Text editing done on someone's behalf, for key presses that don't come from the physical
// keyboard (the on-screen keyboard) or whose modifiers were added afterwards (Sticky Keys).
// A web page can't fake a real key press, so the edit itself is performed here: typing,
// deleting, moving the caret, select all, cut, copy, paste, undo and redo.

export function isEditable(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
  if (el.tagName !== 'INPUT') return false;
  return ['text', 'search', 'email', 'url', 'password', 'tel', 'number', ''].includes((el.getAttribute('type') || '').toLowerCase()) && !el.readOnly && !el.disabled;
}

const hasRange = (el) => typeof el.selectionStart === 'number' && el.type !== 'number' && el.type !== 'email';

export function insertText(el, text) {
  if (document.execCommand('insertText', false, text)) return true;
  // Fallback for fields where execCommand isn't supported.
  if (hasRange(el)) {
    const { selectionStart: a, selectionEnd: b, value } = el;
    el.value = value.slice(0, a) + text + value.slice(b);
    el.selectionStart = el.selectionEnd = a + text.length;
  } else el.value += text;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return true;
}

function moveCaret(el, key, shift) {
  if (el.isContentEditable) {
    const dir = { ArrowLeft: ['backward', 'character'], ArrowRight: ['forward', 'character'], ArrowUp: ['backward', 'line'], ArrowDown: ['forward', 'line'], Home: ['backward', 'lineboundary'], End: ['forward', 'lineboundary'] }[key];
    if (dir) getSelection().modify(shift ? 'extend' : 'move', ...dir);
    return !!dir;
  }
  if (!hasRange(el)) return false;
  const v = el.value;
  let pos = el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd;
  const anchor = el.selectionDirection === 'backward' ? el.selectionEnd : el.selectionStart;
  const lineStart = (p) => v.lastIndexOf('\n', p - 1) + 1;
  const lineEnd = (p) => { const i = v.indexOf('\n', p); return i < 0 ? v.length : i; };
  if (key === 'ArrowLeft') pos = !shift && el.selectionStart !== el.selectionEnd ? el.selectionStart : Math.max(0, pos - 1);
  else if (key === 'ArrowRight') pos = !shift && el.selectionStart !== el.selectionEnd ? el.selectionEnd : Math.min(v.length, pos + 1);
  else if (key === 'Home') pos = lineStart(pos);
  else if (key === 'End') pos = lineEnd(pos);
  else if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (el.tagName !== 'TEXTAREA') pos = key === 'ArrowUp' ? 0 : v.length;
    else {
      const col = pos - lineStart(pos);
      if (key === 'ArrowUp') { const s = lineStart(pos); if (s === 0) pos = 0; else { const ps = lineStart(s - 1); pos = Math.min(ps + col, s - 1); } }
      else { const e = lineEnd(pos); if (e === v.length) pos = v.length; else { const ns = e + 1; pos = Math.min(ns + col, lineEnd(ns)); } }
    }
  } else return false;
  if (shift) el.setSelectionRange(Math.min(anchor, pos), Math.max(anchor, pos), pos < anchor ? 'backward' : 'forward');
  else el.setSelectionRange(pos, pos);
  return true;
}

function focusables(root = document) {
  return [...root.querySelectorAll('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"], iframe')]
    .filter((e) => !e.disabled && e.tabIndex >= 0 && !e.closest('[inert], [hidden]') && e.getClientRects().length);
}

/** Moves focus like Tab / Shift+Tab, inside the active window or dialog. */
export function tabFocus(backward) {
  const scope = document.activeElement?.closest?.('[role="dialog"], .win') || document.querySelector('.dlg, .win.active') || document;
  const list = focusables(scope);
  if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  const next = list[(i + (backward ? -1 : 1) + list.length) % list.length];
  next.focus();
}

/**
 * Performs the default action of a key on the focused element when the browser can't
 * (the key press wasn't real). `mods` is { ctrl, alt, shift, meta }. Returns true if handled.
 */
export async function performKey(el, { key, mods }) {
  const editable = isEditable(el);
  if (mods.ctrl || mods.meta) {
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (k === 'a') { if (editable && el.select) el.select(); else document.execCommand('selectAll'); return true; }
    if (k === 'c') return document.execCommand('copy');
    if (k === 'x') return editable && document.execCommand('cut');
    if (k === 'v' && editable) {
      try { const t = await navigator.clipboard.readText(); if (t) insertText(el, t); return true; } catch { return false; }
    }
    if (k === 'z') return document.execCommand(mods.shift ? 'redo' : 'undo');
    if (k === 'y') return document.execCommand('redo');
    if (k === 'Backspace' && editable) return document.execCommand('delete'); // a character; word-delete isn't available
    return false;
  }
  if (mods.alt) return false;
  if (key === 'Tab') { tabFocus(mods.shift); return true; }
  if (!editable) {
    // Space and Enter press buttons and toggles, as a real key would.
    if ((key === ' ' || key === 'Enter') && el?.matches?.('button, [role="button"], a[href], input[type="checkbox"], input[type="radio"], summary, [role="menuitem"], [role="tab"], [role="option"]')) { el.click(); return true; }
    return false;
  }
  if (key.length === 1) return insertText(el, key);
  if (key === 'Backspace') return document.execCommand('delete') || true;
  if (key === 'Delete') return document.execCommand('forwardDelete') || true;
  if (key === 'Enter') {
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return insertText(el, '\n');
    el.form?.requestSubmit?.();
    return true;
  }
  return moveCaret(el, key, mods.shift);
}

/** Shifted characters on a US keyboard (for Shift with the on-screen keyboard / Sticky Keys). */
export const SHIFTED = { '`': '~', 1: '!', 2: '@', 3: '#', 4: '$', 5: '%', 6: '^', 7: '&', 8: '*', 9: '(', 0: ')', '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?' };
