// The relation between the physical screen and DonutOS's page while Magnifier zooms in.
// Magnifier (shell/a11y/magnifier.js) keeps it up to date; popups use it to place
// themselves inside the part of the page that's visible.

let view = { z: 1, px: 0, py: 0 };

export function setScreenView(v) { view = v; }
/** The magnification (1 when Magnifier is off). */
export function screenZoom() { return view.z; }
/** A point on the physical screen → page coordinates. */
export function screenToPage(x, y) {
  if (view.z === 1) return { x, y };
  return { x: view.px + (x - view.px) / view.z, y: view.py + (y - view.py) / view.z };
}
/** The visible part of the page, in page coordinates. */
export function visiblePage() {
  const a = screenToPage(0, 0), b = screenToPage(innerWidth, innerHeight);
  return { left: a.x, top: a.y, right: b.x, bottom: b.y };
}
