// Global keyboard shortcuts.
//
// Each shortcut has one or more key combinations. The first is the "native" one
// (e.g. Meta+E, like a desktop OS); the others are alternatives that work where the host
// OS or browser keeps the native combination for itself (e.g. Ctrl+Alt+E).
// Combination syntax: modifiers in any order joined with "+": Ctrl, Alt, Shift, Meta,
// then a key: a letter, digit, F1-F12, or a key name (Escape, Tab, ArrowLeft, Period,
// PrintScreen...). "Meta" alone means "press and release the Windows/Command key".

const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'];
// Punctuation keys are named by their physical key so shortcuts work on every layout.
const PUNCT = { '.': 'Period', ',': 'Comma', '/': 'Slash', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight' };
const PUNCT_CODES = new Set(Object.values(PUNCT));

/** Normalises a written combination ("alt+ctrl+e") to canonical form ("Ctrl+Alt+E"). */
export function normalizeCombo(combo) {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  const mods = new Set();
  let key = '';
  for (const p of parts) {
    const m = MODS.find((x) => x.toLowerCase() === p.toLowerCase() || (x === 'Meta' && /^(win|cmd|super)$/i.test(p)) || (x === 'Ctrl' && /^control$/i.test(p)));
    if (m) mods.add(m); else key = p.length === 1 ? p.toUpperCase() : p;
  }
  if (PUNCT[key]) key = PUNCT[key];
  return [...MODS.filter((m) => mods.has(m)), key].filter(Boolean).join('+');
}

/** The canonical combination for a keyboard event (layout-independent for letters/digits). */
export function comboFromEvent(e) {
  let key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (PUNCT_CODES.has(e.code)) key = e.code;
  else if (e.code === 'NumpadDecimal') key = 'Period';
  else if (e.code === 'Space') key = 'Space';
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (MODS.includes(key) || ['Control', 'Shift', 'Alt', 'Meta', 'OS'].includes(e.key)) key = '';
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  return [...mods, key].filter(Boolean).join('+');
}

/** Human-readable label: "Ctrl+Alt+E", "Win+E" (uses ⌘ on macOS). */
export function labelFor(combo) {
  const mac = /Mac/.test(navigator.platform);
  const symbol = Object.fromEntries(Object.entries(PUNCT).map(([k, v]) => [v, k]));
  return combo.split('+').map((p) => (p === 'Meta' ? (mac ? '⌘' : 'Win') : symbol[p] || p.replace(/^Arrow/, ''))).join('+');
}

export class ShortcutRegistry {
  #items = new Map();
  #metaAlone = false;
  #attached = null;

  /**
   * register('shell.search', { keys: ['Meta+S', 'Ctrl+Alt+S'], description: 'Search',
   *   group: 'Shell', handler: (e) => ..., when: () => boolean, inInputs: true })
   * A handler may return false to let the key event continue as normal.
   */
  register(id, def) {
    this.#items.set(id, { ...def, id, keys: def.keys.map(normalizeCombo) });
    return () => this.#items.delete(id);
  }

  unregister(id) { this.#items.delete(id); }

  list() {
    return [...this.#items.values()].map(({ id, keys, description, group }) => ({ id, keys, description, group, labels: keys.map(labelFor) }));
  }

  /** Which shortcut a combination belongs to (for conflict checks). */
  find(combo) {
    const c = normalizeCombo(combo);
    return [...this.#items.values()].find((i) => i.keys.includes(c)) || null;
  }

  attach(target = window) {
    if (this.#attached) return;
    const down = (e) => this.#onDown(e);
    const up = (e) => this.#onUp(e);
    const blur = () => { this.#metaAlone = false; };
    target.addEventListener('keydown', down, true);
    target.addEventListener('keyup', up, true);
    target.addEventListener('blur', blur);
    this.#attached = () => { target.removeEventListener('keydown', down, true); target.removeEventListener('keyup', up, true); target.removeEventListener('blur', blur); };
  }

  detach() { this.#attached?.(); this.#attached = null; }

  #onDown(e) {
    if (e.key === 'Meta' || e.key === 'OS') { if (!e.repeat) this.#metaAlone = true; return; }
    this.#metaAlone = false;
    if (e.getModifierState?.('AltGraph')) return; // AltGr+key types characters on many layouts
    const combo = comboFromEvent(e);
    if (!combo) return;
    // PrintScreen often only produces keyup on Windows; handled there.
    if (combo === 'PrintScreen') return;
    this.#dispatch(combo, e);
  }

  #onUp(e) {
    if ((e.key === 'Meta' || e.key === 'OS') && this.#metaAlone) {
      this.#metaAlone = false;
      this.#dispatch('Meta', e);
      return;
    }
    if (e.key === 'PrintScreen') this.#dispatch(comboFromEvent(e) || 'PrintScreen', e);
  }

  #dispatch(combo, e) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
    for (const item of this.#items.values()) {
      if (!item.keys.includes(combo)) continue;
      if (typing && item.inInputs === false) continue;
      if (item.when && !item.when()) continue;
      let r;
      try { r = item.handler(e); } catch { r = undefined; }
      if (r !== false) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
  }
}
