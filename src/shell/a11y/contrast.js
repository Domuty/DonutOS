// Contrast themes: a few strong, solid colours instead of translucent surfaces, so text and
// edges stand out for people with low vision. Each theme names the roles a high-contrast
// palette needs (like a desktop OS's contrast themes); theme.js maps them onto DonutOS's
// design tokens.

export const CONTRAST_THEMES = {
  aquatic: { name: 'Aquatic', mode: 'dark', bg: '#202020', text: '#ffffff', link: '#75e9fc', disabled: '#a6a6a6', selBg: '#8ee3f0', selText: '#263b50', btnBg: '#202020', btnText: '#ffffff' },
  desert: { name: 'Desert', mode: 'light', bg: '#fffaef', text: '#3d3d3d', link: '#1c5e75', disabled: '#676767', selBg: '#903909', selText: '#fff5e3', btnBg: '#fffaef', btnText: '#202020' },
  dusk: { name: 'Dusk', mode: 'dark', bg: '#2d3236', text: '#ffffff', link: '#70ebde', disabled: '#a6a6a6', selBg: '#a1bfde', selText: '#212d3b', btnBg: '#2d3236', btnText: '#b6f6f0' },
  night: { name: 'Night sky', mode: 'dark', bg: '#000000', text: '#ffffff', link: '#8080ff', disabled: '#a6a6a6', selBg: '#d6b4fd', selText: '#2b2b2b', btnBg: '#000000', btnText: '#ffee32' },
};

/** Design-token values for a contrast theme. */
export function contrastTokens(t) {
  const dark = t.mode === 'dark';
  return {
    '--bg': t.bg, '--surface': t.bg, '--surface-solid': t.bg, '--surface-raised': t.bg,
    '--surface-2': t.bg, '--surface-3': t.bg,
    '--hover': dark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
    '--press': dark ? 'rgba(255, 255, 255, 0.24)' : 'rgba(0, 0, 0, 0.18)',
    '--border': t.text, '--border-strong': t.text,
    '--input-bg': t.bg, '--input-border': t.text,
    '--text': t.text, '--text-2': t.text, '--text-3': t.disabled,
    '--accent': t.selBg, '--accent-hover': t.selBg, '--accent-text': t.link, '--accent-contrast': t.selText,
    '--accent-soft': dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.1)',
    '--hc-button-text': t.btnText, '--hc-button-bg': t.btnBg,
    '--ok': dark ? '#3ff23f' : '#006b00', '--warn': dark ? '#ffee32' : '#7a4f00', '--danger': dark ? '#ff7a7a' : '#a00000',
    '--shadow': 'none', '--shadow-s': 'none', '--blur': 'none',
  };
}
