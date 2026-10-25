// Scrolling history graphs for Task Manager's Performance page. Each graph keeps the last
// `points` samples and redraws on a canvas sized for the screen's pixel density.

export class History {
  constructor(points = 60) { this.points = points; this.values = []; }
  push(v) { this.values.push(v); if (this.values.length > this.points) this.values.shift(); }
  get last() { return this.values[this.values.length - 1] ?? 0; }
  get max() { return this.values.reduce((a, b) => Math.max(a, b), 0); }
}

const cssColor = (el, name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

/**
 * Draws `series` (arrays of numbers) into `canvas`.
 * opts: { max: number | 'auto', grid: boolean, colors: [css], fill: boolean, minMax }
 */
export function drawGraph(canvas, series, { max = 100, grid = true, colors, fill = true, minMax = 1, points = 60 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const hgt = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, w, hgt);
  const accent = cssColor(canvas, '--graph', cssColor(canvas, '--accent', '#e0568a'));
  const line = colors || [accent];
  let top = max;
  if (max === 'auto') {
    top = Math.max(minMax, ...series.flat());
    top *= 1.15;
  }
  if (grid) {
    g.strokeStyle = cssColor(canvas, '--graph-grid', 'rgba(128,128,128,.18)');
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < 4; i++) { const y = Math.round((hgt * i) / 4) + 0.5; g.moveTo(0, y); g.lineTo(w, y); }
    for (let i = 1; i < 6; i++) { const x = Math.round((w * i) / 6) + 0.5; g.moveTo(x, 0); g.lineTo(x, hgt); }
    g.stroke();
  }
  series.forEach((values, si) => {
    if (!values.length) return;
    const step = w / (points - 1);
    const x0 = w - (values.length - 1) * step;
    const y = (v) => hgt - (Math.max(0, Math.min(top, v)) / top) * (hgt - 2 * dpr) - dpr;
    g.beginPath();
    values.forEach((v, i) => { if (i) g.lineTo(x0 + i * step, y(v)); else g.moveTo(x0, y(v)); });
    const color = line[si % line.length];
    g.strokeStyle = color;
    g.lineWidth = 1.5 * dpr;
    g.lineJoin = 'round';
    g.stroke();
    if (fill && si === 0) {
      g.lineTo(w, hgt); g.lineTo(x0, hgt); g.closePath();
      g.globalAlpha = 0.16; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    }
  });
  return top;
}
