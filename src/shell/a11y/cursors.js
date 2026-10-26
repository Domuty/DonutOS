// Bigger and recoloured mouse pointers. Each pointer shape is drawn as an SVG at the chosen
// size and colour and published as a --cur-* variable that every `cursor:` in DonutOS's
// styles uses (with the normal system pointer as the fallback).
// Browsers show pointers up to 128 px; DonutOS's biggest is 72 px.

const BASE = 24; // px at size 1

// Each shape: viewBox 24×24, path, hotspot (in viewBox units).
const SHAPES = {
  default: { hot: [3, 2], d: 'M3 2v17.5l4.4-4.2 2.9 6.6 2.9-1.3-2.9-6.4H17z' },
  pointer: { hot: [8, 2], d: 'M8 2.5c-1 0-1.8.8-1.8 1.8v8.9l-1.6-1.4c-.8-.7-2-.6-2.6.2-.6.8-.5 1.9.2 2.6l5 5.3c.9 1 2.2 1.6 3.6 1.6H15c2.8 0 5-2.2 5-5v-5c0-1-.8-1.8-1.8-1.8-.4 0-.8.1-1.1.4-.2-.8-1-1.4-1.8-1.4-.5 0-.9.2-1.3.5-.3-.7-1-1.2-1.8-1.2-.4 0-.8.1-1.1.3V4.3C9.8 3.3 9 2.5 8 2.5z' },
  text: { hot: [12, 12], d: 'M8 3h3v.4c.4-.3.6-.4 1-.4h4v2h-3v14h3v2h-4c-.4 0-.6-.1-1-.4v.4H8v-2h3V5H8z' },
  move: { hot: [12, 12], d: 'M12 1l4 4h-3v6h6V8l4 4-4 4v-3h-6v6h3l-4 4-4-4h3v-6H5v3l-4-4 4-4v3h6V5H8z' },
  crosshair: { hot: [12, 12], d: 'M11 1h2v9h9v2h-9v9h-2v-9H2v-2h9z' },
  ns: { hot: [12, 12], d: 'M12 1l5 6h-3.5v10H17l-5 6-5-6h3.5V7H7z' },
  ew: { hot: [12, 12], d: 'M1 12l6-5v3.5h10V7l6 5-6 5v-3.5H7V17z' },
  nwse: { hot: [12, 12], d: 'M3 3h7.5L8 5.5l10.5 10.5L21 13.5V21h-7.5l2.5-2.5L5.5 8 3 10.5z' },
  nesw: { hot: [12, 12], d: 'M21 3v7.5L18.5 8 8 18.5l2.5 2.5H3v-7.5L5.5 16 16 5.5 13.5 3z' },
};
// Shapes reused for other pointer names.
const ALIASES = { grab: 'pointer', grabbing: 'pointer', cell: 'crosshair' };

const COLOURS = { white: ['#ffffff', '#000000'], black: ['#000000', '#ffffff'] };

const svgText = (shape, px, fill, stroke) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="-1 -1 26 26"><path d="${SHAPES[shape].d}" fill="${fill}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const colours = (color, accent) => (color === 'accent' ? [accent, '#000000'] : COLOURS[color] || COLOURS.white);

/** A pointer picture (data URL), e.g. for previews in Settings. */
export function cursorImage(shape, px, color = 'white', accent = '#e8618c') {
  const [fill, stroke] = colours(color, accent);
  return `data:image/svg+xml,${encodeURIComponent(svgText(shape, px, fill, stroke))}`;
}

function svgCursor(shape, px, fill, stroke) {
  const s = SHAPES[shape];
  const svg = svgText(shape, px, fill, stroke);
  const k = px / 26;
  const hx = Math.round((s.hot[0] + 1) * k), hy = Math.round((s.hot[1] + 1) * k);
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}`;
}

/** Sets (or clears, at the default size and colour) the pointer variables on the root element. */
export function applyCursors({ size = 1, color = 'white', accent = '#e8618c' } = {}, root = document.documentElement) {
  const names = [...Object.keys(SHAPES), ...Object.keys(ALIASES)];
  if (size <= 1 && color === 'white') {
    for (const n of names) root.style.removeProperty(`--cur-${n}`);
    delete root.dataset.cursor;
    return;
  }
  const px = Math.min(72, Math.round(BASE * size));
  const [fill, stroke] = colours(color, accent);
  const fallback = { default: 'default', pointer: 'pointer', text: 'text', move: 'move', crosshair: 'crosshair', ns: 'ns-resize', ew: 'ew-resize', nwse: 'nwse-resize', nesw: 'nesw-resize' };
  for (const n of Object.keys(SHAPES)) root.style.setProperty(`--cur-${n}`, `${svgCursor(n, px, fill, stroke)}, ${fallback[n]}`);
  for (const [n, to] of Object.entries(ALIASES)) root.style.setProperty(`--cur-${n}`, root.style.getPropertyValue(`--cur-${to}`).replace(/, [a-z-]+$/, `, ${n}`));
  root.dataset.cursor = `${size}`;
}
