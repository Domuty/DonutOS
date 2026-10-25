// Snipping Tool: take a screenshot (rectangle, window or full screen, with an optional
// delay), mark it up with a pen or highlighter, then copy, save or export it.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { showMenu } from '../../ui/menu.js';
import { promptDialog, alertDialog, confirmDialog } from '../../ui/dialog.js';
import { pickRegion, screenshotName } from '../../shell/snip.js';
import * as P from '../../core/path.js';

const COLORS = ['#111111', '#ffffff', '#e5484d', '#f5a524', '#2fbf71', '#3e8ef7', '#a259ff'];

export default function main(ctx) {
  const k = ctx.privileged;
  const win = ctx.windows.create({ title: 'Snipping Tool' });
  const state = { mode: 'rect', delay: 0, tool: 'pen', color: COLORS[2], size: 4, path: null, dirty: false };
  const canvas = h('canvas.snip-canvas');
  const g = canvas.getContext('2d');
  let base = null;          // ImageBitmap of the capture
  const strokes = [];       // [{ tool, color, size, points: [[x,y]] }]

  const toolbar = h('div.app-toolbar');
  const stage = h('div.snip-stage');
  const status = h('div.app-status');
  mount(win.body, toolbar, stage, status);

  // What the snipping overlay needs from the user's session (their windows and home).
  const session = () => {
    const user = ctx.system.user();
    return { wm: k.windowHost(user.id), flyouts: { close() {} }, user, uid: user.id };
  };

  async function newSnip(mode = state.mode) {
    if (state.dirty && !(await confirmDiscard())) return;
    win.minimize();
    if (state.delay) await new Promise((r) => ctx.setTimeout(r, state.delay * 1000));
    await new Promise((r) => ctx.setTimeout(r, 260)); // let the minimise animation finish
    const png = await pickRegion(k, session(), { mode });
    win.restore();
    if (!png) return;
    await load(new Blob([png], { type: 'image/png' }), null);
    state.dirty = true;
  }

  function confirmDiscard() {
    return confirmDialog('Discard this snip?', 'Your current snip and markup haven’t been saved.', { ok: 'Discard' });
  }

  async function load(blob, path) {
    base = await createImageBitmap(blob);
    strokes.length = 0;
    state.path = path;
    state.dirty = false;
    canvas.width = base.width;
    canvas.height = base.height;
    ctx.trackMemory(base.width * base.height * 4);
    redraw();
    win.setTitle(path ? `${P.basename(path)} — Snipping Tool` : 'Snipping Tool');
    render();
  }

  function redraw() {
    if (!base) return;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(base, 0, 0);
    for (const s of strokes) drawStroke(s);
  }

  function drawStroke(s) {
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = s.color;
    g.lineWidth = s.tool === 'highlighter' ? s.size * 4 : s.size;
    g.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;
    g.beginPath();
    s.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    if (s.points.length === 1) g.lineTo(s.points[0][0] + 0.1, s.points[0][1]);
    g.stroke();
    g.restore();
  }

  const toPng = () => new Promise((r) => canvas.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/png'));

  async function copy() {
    const png = await toPng();
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
      ctx.notify({ title: 'Copied', body: 'The snip is on the clipboard. Paste it anywhere with Ctrl+V.' });
    } catch (err) { alertDialog('Couldn’t copy', err.message); }
  }

  async function save(asNew) {
    const dir = P.join(ctx.fs.home(), 'Pictures', 'Screenshots');
    let path = state.path;
    if (asNew || !path) {
      const name = await promptDialog('Save snip as', { label: 'File name (saved in Pictures › Screenshots)', value: screenshotName(), validate: (v) => (P.validateName(v.trim()) || null) });
      if (!name) return;
      await ctx.fs.mkdir(dir, { recursive: true });
      const file = /\.png$/i.test(name.trim()) ? name.trim() : `${name.trim()}.png`;
      path = P.join(dir, await ctx.fs.uniqueName(dir, file));
    }
    await ctx.fs.writeFile(path, await toPng());
    state.path = path;
    state.dirty = false;
    win.setTitle(`${P.basename(path)} — Snipping Tool`);
    render();
  }

  async function exportPng() {
    await ctx.host.exportFile(state.path ? P.basename(state.path) : screenshotName(), await toPng(), 'image/png');
  }

  async function openFile(path) {
    try { await load(await ctx.fs.readBlob(path), path); } catch (err) { alertDialog('Couldn’t open the image', err.message); }
  }

  // Drawing
  let current = null;
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };
  ctx.listen(canvas, 'pointerdown', (e) => {
    if (!base || e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    current = { tool: state.tool, color: state.color, size: state.size * (canvas.width / canvas.getBoundingClientRect().width), points: [pt(e)] };
    strokes.push(current);
    drawStroke(current);
  });
  ctx.listen(canvas, 'pointermove', (e) => {
    if (!current) return;
    current.points.push(pt(e));
    redraw();
  });
  ctx.listen(canvas, 'pointerup', () => { if (current) { current = null; state.dirty = true; render(); } });

  function render() {
    const swatch = (c) => h('button.swatch.small', { type: 'button', 'aria-label': c, 'aria-pressed': String(state.color === c), style: { background: c }, onclick: () => { state.color = c; render(); } });
    mount(toolbar,
      h('button.btn.primary', { type: 'button', onclick: () => newSnip() }, icon('plus', { size: 16 }), 'New'),
      h('button.btn.subtle', { type: 'button', onclick: (e) => showMenu([
        { label: 'Rectangle', checked: state.mode === 'rect', onSelect: () => { state.mode = 'rect'; render(); } },
        { label: 'Window', checked: state.mode === 'window', onSelect: () => { state.mode = 'window'; render(); } },
        { label: 'Full screen', checked: state.mode === 'full', onSelect: () => { state.mode = 'full'; render(); } },
      ], { anchor: e.currentTarget }) }, icon('view', { size: 16 }), { rect: 'Rectangle', window: 'Window', full: 'Full screen' }[state.mode]),
      h('button.btn.subtle', { type: 'button', onclick: (e) => showMenu([0, 3, 5, 10].map((d) => ({ label: d ? `${d} second delay` : 'No delay', checked: state.delay === d, onSelect: () => { state.delay = d; render(); } })), { anchor: e.currentTarget }) },
        icon('restart', { size: 16 }), state.delay ? `${state.delay}s delay` : 'No delay'),
      h('span.tb-sep'),
      base ? [
        h('button.btn.subtle', { type: 'button', 'aria-pressed': String(state.tool === 'pen'), class: state.tool === 'pen' && 'on', onclick: () => { state.tool = 'pen'; render(); } }, icon('edit', { size: 16 }), 'Pen'),
        h('button.btn.subtle', { type: 'button', 'aria-pressed': String(state.tool === 'highlighter'), class: state.tool === 'highlighter' && 'on', onclick: () => { state.tool = 'highlighter'; render(); } }, icon('sparkle', { size: 16 }), 'Highlighter'),
        COLORS.map(swatch),
        h('input.slider', { type: 'range', min: 1, max: 20, value: state.size, style: { width: '90px', '--p': `${((state.size - 1) / 19) * 100}%` }, 'aria-label': 'Pen size', oninput: (e) => { state.size = Number(e.target.value); e.target.style.setProperty('--p', `${((state.size - 1) / 19) * 100}%`); } }),
        h('button.btn.subtle', { type: 'button', title: 'Undo', 'aria-label': 'Undo', disabled: !strokes.length, onclick: () => { strokes.pop(); redraw(); render(); } }, icon('arrowLeft', { size: 16 })),
        h('button.btn.subtle', { type: 'button', title: 'Clear markup', 'aria-label': 'Clear markup', disabled: !strokes.length, onclick: () => { strokes.length = 0; redraw(); render(); } }, icon('trash', { size: 16 })),
        h('span.tb-sep'),
        h('button.btn.subtle', { type: 'button', onclick: copy }, icon('copy', { size: 16 }), 'Copy'),
        h('button.btn.subtle', { type: 'button', onclick: () => save(false) }, icon('download', { size: 16 }), 'Save'),
        h('button.btn.subtle', { type: 'button', onclick: () => save(true) }, 'Save as…'),
        h('button.btn.subtle', { type: 'button', onclick: exportPng }, icon('upload', { size: 16 }), 'Export'),
      ] : null);
    mount(stage, base ? canvas : h('div.empty-state', icon('scissors', { size: 56 }), h('b', 'Take a snip'), h('p', 'Select New to capture part of your screen, a window, or the whole screen. Shortcut: Win+Shift+S or Ctrl+Alt+Shift+S.')));
    mount(status, base ? [h('span', `${canvas.width} × ${canvas.height}px`), h('span', state.path ? P.basename(state.path) : 'Not saved'), state.dirty ? h('span', 'Unsaved changes') : null] : h('span', 'Ready'));
  }

  win.onBeforeClose(async () => !state.dirty || confirmDiscard());
  ctx.onNotification((n) => { if (n.data?.path) openFile(n.data.path); win.focus(); });
  ctx.onActivate((args) => { win.focus(); if (args?.path) openFile(args.path); if (args?.snip) newSnip(args.snip); });

  render();
  const startPath = ctx.args.path || ctx.args.notification?.data?.path;
  if (startPath) openFile(startPath);
  else if (ctx.args.snip) newSnip(ctx.args.snip);
}
