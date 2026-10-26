// WCAG colour contrast helpers.

const channel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** Contrast ratio between two colours (1–21). */
export function contrastRatio(a, b) {
  const la = luminance(typeof a === 'string' ? hexToRgb(a) : a), lb = luminance(typeof b === 'string' ? hexToRgb(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or near-black, whichever is easier to read on `bg`. */
export function textOn(bg) {
  return contrastRatio('#ffffff', bg) >= contrastRatio('#1a1a1a', bg) ? '#ffffff' : '#1a1a1a';
}
