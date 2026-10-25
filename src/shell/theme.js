// Applies a user's appearance settings (theme, accent, transparency, motion, font,
// text size) to the document. The shell calls applyTheme() whenever the active user
// changes and keeps it in sync with watchTheme().

const FONTS = {
  rounded: '"Nunito", "Varela Round", "Segoe UI Variable Text", system-ui, sans-serif',
  serif: '"Georgia", "Cambria", "Times New Roman", serif',
  mono: 'var(--font-mono)',
  humanist: '"Optima", "Candara", "Noto Sans", "Segoe UI", sans-serif',
};

const media = matchMedia('(prefers-color-scheme: dark)');

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const luminance = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export function resolvedTheme(settings) {
  const t = settings ? settings.get('appearance.theme') : 'dark';
  return t === 'auto' ? (media.matches ? 'dark' : 'light') : t;
}

export function applyTheme(settings, root = document.documentElement) {
  const theme = resolvedTheme(settings);
  const accent = settings ? settings.get('appearance.accent') : '#e8618c';
  const rgb = hexToRgb(accent);
  root.dataset.theme = theme;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-hover', toHex(mix(rgb, theme === 'dark' ? [255, 255, 255] : [0, 0, 0], 0.12)));
  root.style.setProperty('--accent-text', toHex(mix(rgb, theme === 'dark' ? [255, 255, 255] : [0, 0, 0], theme === 'dark' ? 0.35 : 0.25)));
  root.style.setProperty('--accent-soft', `rgba(${rgb.join(',')}, ${theme === 'dark' ? 0.2 : 0.14})`);
  root.style.setProperty('--accent-contrast', luminance(rgb) > 0.45 ? '#1a1a1a' : '#ffffff');
  root.dataset.transparency = settings && !settings.get('appearance.transparency') ? 'off' : 'on';
  root.dataset.motion = settings && (!settings.get('appearance.animations') || settings.get('a11y.reduceMotion')) ? 'reduce' : 'full';
  const font = settings ? settings.get('appearance.font') : 'system';
  if (font === 'system') root.style.removeProperty('--font'); else root.style.setProperty('--font', FONTS[font]);
  root.style.fontSize = `${14 * ((settings ? settings.get('appearance.textScale') : 100) / 100)}px`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#14101a' : '#eef0f4');
}

/** Re-applies the theme when any appearance setting (or the OS theme, for "auto") changes. */
export function watchTheme(settings) {
  const apply = () => applyTheme(settings);
  const offs = [
    settings.watch('appearance.*', apply),
    settings.watch('a11y.reduceMotion', apply),
  ];
  media.addEventListener('change', apply);
  return () => { offs.forEach((f) => f()); media.removeEventListener('change', apply); };
}
