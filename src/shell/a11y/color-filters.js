// Colour filters for the whole screen: grayscale and inverted (CSS filters), and
// colour-blindness filters (SVG colour matrices) that move colour differences a person can't
// see into ones they can. That is "daltonisation": simulate the colour vision deficiency,
// take the difference to the real colour, and add it back into the channels still seen.

export const COLOR_FILTERS = {
  grayscale: 'Grayscale',
  invert: 'Inverted',
  grayscaleInvert: 'Grayscale inverted',
  deuteranopia: 'Red-green (green weak, deuteranopia)',
  protanopia: 'Red-green (red weak, protanopia)',
  tritanopia: 'Blue-yellow (tritanopia)',
};

// Simulation matrices (RGB), as used by common colour-blindness simulators.
const SIM = {
  protanopia: [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
  deuteranopia: [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
  tritanopia: [[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]],
};
// Where the lost difference goes: red/green errors into green and blue; blue/yellow errors into red and green.
const SHIFT = {
  protanopia: [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]],
  deuteranopia: [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]],
  tritanopia: [[1, 0, 0.7], [0, 1, 0.7], [0, 0, 0]],
};

const mul = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** 3×3 correction matrix: M = I + E·(I − S). */
export function correctionMatrix(type) {
  const s = SIM[type], e = SHIFT[type];
  const diff = I.map((row, i) => row.map((v, j) => v - s[i][j]));
  const es = mul(e, diff);
  return I.map((row, i) => row.map((v, j) => v + es[i][j]));
}

/** Adds the SVG filter definitions the CSS refers to (url(#a11y-…)). */
export function installColorFilterDefs() {
  if (document.getElementById('a11y-filters')) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.id = 'a11y-filters';
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  const defs = document.createElementNS(ns, 'defs');
  for (const type of Object.keys(SIM)) {
    const f = document.createElementNS(ns, 'filter');
    f.id = `a11y-${type}`;
    f.setAttribute('color-interpolation-filters', 'sRGB');
    const cm = document.createElementNS(ns, 'feColorMatrix');
    cm.setAttribute('type', 'matrix');
    const m = correctionMatrix(type);
    cm.setAttribute('values', [...m.map((r) => [...r.map((v) => v.toFixed(4)), 0, 0]), [0, 0, 0, 1, 0]].flat().join(' '));
    f.append(cm);
    defs.append(f);
  }
  svg.append(defs);
  document.documentElement.append(svg);
}
