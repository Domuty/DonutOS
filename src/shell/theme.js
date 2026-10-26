// Applies a user's appearance settings (theme, accent, transparency, motion, font,
// text size) to the document. The shell calls applyTheme() whenever the active user
// changes and keeps it in sync with watchTheme().

const FONTS = {
  rounded: '"Nunito", "Varela Round", "Segoe UI Variable Text", system-ui, sans-serif',
  serif: '"Georgia", "Cambria", "Times New Roman", serif',
  mono: 'var(--font-mono)',
  humanist: '"Optima", "Candara", "Noto Sans", "Segoe UI", sans-serif',
};

import { CONTRAST_THEMES, contrastTokens } from './a11y/contrast.js';
import { a11yGet } from './a11y/prefs.js';
import { hexToRgb, textOn } from '../ui/contrast.js';

const media = matchMedia('(prefers-color-scheme: dark)');
let contrastKeys = [];

const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** The active contrast theme ({ name, mode, … }) or null. */
export function activeContrast(settings) {
  return settings && a11yGet(settings, 'highContrast') ? CONTRAST_THEMES[a11yGet(settings, 'contrastTheme')] || CONTRAST_THEMES.night : null;
}

export function resolvedTheme(settings) {
  const hc = activeContrast(settings);
  if (hc) return hc.mode;
  const t = settings ? settings.get('appearance.theme') : 'dark';
  return t === 'auto' ? (media.matches ? 'dark' : 'light') : t;
}

export function applyTheme(settings, root = document.documentElement) {
  for (const key of contrastKeys) root.style.removeProperty(key);
  contrastKeys = [];
  const theme = resolvedTheme(settings);
  const accent = settings ? settings.get('appearance.accent') : '#e8618c';
  const rgb = hexToRgb(accent);
  root.dataset.theme = theme;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-hover', toHex(mix(rgb, theme === 'dark' ? [255, 255, 255] : [0, 0, 0], 0.12)));
  root.style.setProperty('--accent-text', toHex(mix(rgb, theme === 'dark' ? [255, 255, 255] : [0, 0, 0], theme === 'dark' ? 0.35 : 0.25)));
  root.style.setProperty('--accent-soft', `rgba(${rgb.join(',')}, ${theme === 'dark' ? 0.2 : 0.14})`);
  // Text on accent-coloured fills: whichever of white or near-black reads better.
  root.style.setProperty('--accent-contrast', textOn(accent));
  root.dataset.transparency = settings && !settings.get('appearance.transparency') ? 'off' : 'on';
  // Contrast themes override colours (and turn transparency off) on top of everything else.
  const hc = activeContrast(settings);
  if (hc) {
    for (const [key, value] of Object.entries(contrastTokens(hc))) { root.style.setProperty(key, value); contrastKeys.push(key); }
    root.dataset.contrast = Object.keys(CONTRAST_THEMES).find((id) => CONTRAST_THEMES[id] === hc);
    root.dataset.transparency = 'off';
  } else delete root.dataset.contrast;
  root.dataset.focusRing = settings && a11yGet(settings, 'focusRing') ? 'thick' : 'normal';
  root.dataset.scrollbars = settings && a11yGet(settings, 'alwaysScrollbars') ? 'always' : 'auto';
  root.dataset.motion = settings && (!settings.get('appearance.animations') || settings.get('a11y.reduceMotion')) ? 'reduce' : 'full';
  const font = settings ? settings.get('appearance.font') : 'system';
  if (font === 'system') root.style.removeProperty('--font'); else root.style.setProperty('--font', FONTS[font]);
  root.style.fontSize = `${14 * ((settings ? settings.get('appearance.textScale') : 100) / 100)}px`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hc ? hc.bg : theme === 'dark' ? '#14101a' : '#eef0f4');
}

/** Re-applies the theme when any appearance setting (or the OS theme, for "auto") changes. */
export function watchTheme(settings) {
  const apply = () => applyTheme(settings);
  const offs = [
    settings.watch('appearance.*', apply),
    settings.watch('a11y.*', apply),
  ];
  media.addEventListener('change', apply);
  return () => { offs.forEach((f) => f()); media.removeEventListener('change', apply); };
}
