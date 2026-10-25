// Paint: raster image editor. Pencil, brush, eraser, fill, colour picker, text, line and
// shapes, rectangular selection (move, copy, cut, crop), resize/rotate/flip, undo/redo,
// zoom, and open/save PNG, JPEG and WebP.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { menubar } from '../../ui/menubar.js';
import { dialog } from '../../ui/dialog.js';
import { Document, documentKeys } from '../common/document.js';
import * as P from '../../core/path.js';

const FILTERS = [
  { label: 'PNG picture', exts: ['.png'] },
  { label: 'JPEG picture', exts: ['.jpg', '.jpeg'] },
  { label: 'WebP picture', exts: ['.webp'] },
  { label: 'All pictures', exts: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif'] },
];
const OPEN_FILTERS = [FILTERS[3], { label: 'All files', exts: ['*'] }];
const PALETTE = ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
  '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'];
const TOOLS = [
  ['select', 'Select', 'selectRect', 'S'], ['pencil', 'Pencil', 'edit', 'P'], ['brush', 'Brush', 'brush', 'B'], ['eraser', 'Eraser', 'eraser', 'E'],
  ['fill', 'Fill with colour', 'bucket', 'K'], ['picker', 'Colour picker', 'dropper', 'I'], ['text', 'Text', 'textA', 'T'],
  ['line', 'Line', 'line', 'L'], ['rect', 'Rectangle', 'square', 'R'], ['ellipse', 'Ellipse', 'circle', 'O'], ['roundrect', 'Rounded rectangle', 'roundSquare', 'U'],
];
const MAX_UNDO = 40;
const MAX_SIDE = 8000;

export default function main(ctx) {
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'Paint', width: 1100, height: 740, minWidth: 560, minHeight: 400 });
  win.body.classList.add('paint');

  let tool = store.get('tool', 'brush');
  let size = store.get('size', 4);
  let primary = store.get('primary', '#000000');
  let secondary = store.get('secondary', '#ffffff');
  let shapeFill = store.get('shapeFill', 'outline'); // outline | fill | both
  let fontSize = store.get('fontSize', 24);
  let zoom = 1;
  let custom = store.get('customColors', []);

  const canvas = h('canvas.pt-canvas', { width: 1152, height: 648, 'aria-label': 'Picture' });
  const overlay = h('canvas.pt-overlay', { width: 1152, height: 648, 'aria-hidden': 'true' });
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const og = overlay.getContext('2d');
  const sizer = h('div.pt-sizer', canvas, overlay, h('div.pt-handle', { title: 'Drag to resize the canvas', onpointerdown: (e) => resizeDrag(e) }));
  const stage = h('div.pt-stage', sizer);
  const status = h('footer.pt-status');
  const ribbon = h('div.pt-ribbon', { role: 'toolbar', 'aria-label': 'Tools' });
  const textBox = h('textarea.pt-textbox', { hidden: true, spellcheck: false, 'aria-label': 'Text' });
  sizer.append(textBox);

  const undo = [];
  const redo = [];
  let cursor = null;
  let sel = null;       // { x, y, w, h, float: canvas | null, dx, dy }

  function blank(w = canvas.width, hh = canvas.height) {
    canvas.width = overlay.width = w; canvas.height = overlay.height = hh;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, hh);
    applyZoom();
  }

  const doc = new Document(ctx, win, {
    appName: 'Paint', untitled: 'Untitled', defaultExt: '.png', filters: OPEN_FILTERS, saveFilters: FILTERS.slice(0, 3),
    load: async (path) => {
      const blob = await ctx.fs.readBlob(path);
      commitSelection();
      if (!blob.size) { blank(1152, 648); undo.length = 0; redo.length = 0; zoomToFit(); return; } // a brand-new empty picture file
      const img = await loadImage(blob);
      canvas.width = overlay.width = Math.min(MAX_SIDE, img.naturalWidth || img.width || 800);
      canvas.height = overlay.height = Math.min(MAX_SIDE, img.naturalHeight || img.height || 600);
      g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(img, 0, 0);
      undo.length = 0; redo.length = 0;
      zoomToFit();
    },
    serialize: async (path) => {
      commitSelection();
      const ext = P.extname(path).toLowerCase();
      const type = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
      const blob = await new Promise((r) => canvas.toBlob(r, type, 0.92));
      return new Uint8Array(await blob.arrayBuffer());
    },
    // Formats Paint can't write (GIF, BMP, SVG…) go through Save as.
    readOnly: (path) => !['.png', '.jpg', '.jpeg', '.webp'].includes(P.extname(path).toLowerCase()),
  });

  async function loadImage(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  // ── History ──────────────────────────────────────────────────────────
  function snapshot() {
    undo.push({ w: canvas.width, h: canvas.height, data: g.getImageData(0, 0, canvas.width, canvas.height) });
    if (undo.length > MAX_UNDO) undo.shift();
    redo.length = 0;
    doc.setDirty(true);
  }
  function restore(from, to) {
    const s = from.pop();
    if (!s) return;
    commitSelection({ record: false });
    to.push({ w: canvas.width, h: canvas.height, data: g.getImageData(0, 0, canvas.width, canvas.height) });
    if (canvas.width !== s.w || canvas.height !== s.h) { canvas.width = overlay.width = s.w; canvas.height = overlay.height = s.h; applyZoom(); }
    g.putImageData(s.data, 0, 0);
    doc.setDirty(true);
    updateStatus();
  }

  // ── Coordinates & zoom ───────────────────────────────────────────────
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * canvas.width), y: Math.floor(((e.clientY - r.top) / r.height) * canvas.height) };
  };
  function applyZoom() {
    const w = Math.round(canvas.width * zoom), hh = Math.round(canvas.height * zoom);
    for (const c of [canvas, overlay]) { c.style.width = `${w}px`; c.style.height = `${hh}px`; }
    sizer.style.width = `${w}px`; sizer.style.height = `${hh}px`;
    canvas.style.imageRendering = zoom >= 2 ? 'pixelated' : 'auto';
    updateStatus();
  }
  function setZoom(z, focus) {
    const old = zoom;
    zoom = Math.max(0.1, Math.min(8, z));
    applyZoom();
    if (focus) {
      stage.scrollLeft = (stage.scrollLeft + focus.x) * (zoom / old) - focus.x;
      stage.scrollTop = (stage.scrollTop + focus.y) * (zoom / old) - focus.y;
    }
  }
  function zoomToFit() {
    const avail = { w: stage.clientWidth - 48, h: stage.clientHeight - 48 };
    zoom = Math.min(1, avail.w / canvas.width, avail.h / canvas.height) || 1;
    applyZoom();
  }

  // ── Drawing ──────────────────────────────────────────────────────────
  let drag = null;
  const colorFor = (e) => (e.button === 2 ? secondary : primary);

  overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    const p = pt(e);
    if (tool !== 'text') commitText();
    if (tool === 'select') {
      if (sel && inside(p, sel)) { liftSelection(); drag = { kind: 'move', start: p, ox: sel.x, oy: sel.y }; }
      else { commitSelection(); drag = { kind: 'select', start: p }; }
      overlay.setPointerCapture(e.pointerId);
      return;
    }
    commitSelection();
    if (tool === 'picker') {
      const d = g.getImageData(Math.min(canvas.width - 1, Math.max(0, p.x)), Math.min(canvas.height - 1, Math.max(0, p.y)), 1, 1).data;
      const hex = `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      if (e.button === 2) secondary = hex; else primary = hex;
      saveColors();
      setTool(store.get('lastTool', 'brush'));
      return;
    }
    if (tool === 'fill') { snapshot(); floodFill(p.x, p.y, colorFor(e)); return; }
    if (tool === 'text') { placeText(p); return; }
    snapshot();
    const color = tool === 'eraser' ? secondary : colorFor(e);
    drag = { kind: tool, start: p, last: p, color, alt: e.button === 2 ? primary : secondary };
    if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') stroke(p, p, drag);
    overlay.setPointerCapture(e.pointerId);
  });

  overlay.addEventListener('pointermove', (e) => {
    const p = pt(e);
    cursor = p;
    updateStatus();
    if (tool === 'eraser' || tool === 'brush') previewCursor(p);
    if (!drag) return;
    if (drag.kind === 'pencil' || drag.kind === 'brush' || drag.kind === 'eraser') {
      // Coalesced events keep fast strokes smooth.
      const pts = e.getCoalescedEvents ? e.getCoalescedEvents().map(pt) : [p];
      for (const q of pts) { stroke(drag.last, q, drag); drag.last = q; }
      if (tool === 'eraser' || tool === 'brush') previewCursor(p);
      return;
    }
    let q = p;
    if (e.shiftKey && drag.kind !== 'select' && drag.kind !== 'move') q = constrain(drag.start, p, drag.kind === 'line');
    if (drag.kind === 'select') { sel = normRect(drag.start, p); drawSelection(); return; }
    if (drag.kind === 'move') { sel.x = drag.ox + p.x - drag.start.x; sel.y = drag.oy + p.y - drag.start.y; drawSelection(); return; }
    clearOverlay();
    drawShape(og, drag.kind, drag.start, q, drag.color, drag.alt);
    drag.end = q;
  });

  overlay.addEventListener('pointerup', () => {
    if (!drag) return;
    if (['line', 'rect', 'ellipse', 'roundrect'].includes(drag.kind)) {
      clearOverlay();
      if (drag.end) drawShape(g, drag.kind, drag.start, drag.end, drag.color, drag.alt);
      else undo.pop();
    }
    if (drag.kind === 'select' && sel && (sel.w < 2 || sel.h < 2)) { sel = null; clearOverlay(); }
    drag = null;
    updateStatus();
  });
  overlay.addEventListener('pointerleave', () => { cursor = null; if (!drag && !sel) clearOverlay(); updateStatus(); });

  function stroke(a, b, d) {
    g.save();
    g.strokeStyle = d.color;
    g.fillStyle = d.color;
    g.lineCap = d.kind === 'eraser' ? 'square' : 'round';
    g.lineJoin = 'round';
    if (d.kind === 'pencil') {
      // Hard-edged pixels, like a real pencil tool.
      g.imageSmoothingEnabled = false;
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
      for (let i = 0; i <= n; i++) g.fillRect(Math.round(a.x + ((b.x - a.x) * i) / n), Math.round(a.y + ((b.y - a.y) * i) / n), Math.max(1, Math.round(size / 4)), Math.max(1, Math.round(size / 4)));
    } else {
      g.lineWidth = d.kind === 'eraser' ? size * 2 : size;
      g.beginPath(); g.moveTo(a.x + 0.5, a.y + 0.5); g.lineTo(b.x + 0.5, b.y + 0.5); g.stroke();
    }
    g.restore();
  }

  function drawShape(c, kind, a, b, color, alt) {
    c.save();
    c.lineWidth = size;
    c.strokeStyle = color;
    c.fillStyle = shapeFill === 'both' ? alt : color;
    c.lineCap = 'round';
    const x = Math.min(a.x, b.x) + 0.5, y = Math.min(a.y, b.y) + 0.5, w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y);
    c.beginPath();
    if (kind === 'line') { c.moveTo(a.x + 0.5, a.y + 0.5); c.lineTo(b.x + 0.5, b.y + 0.5); c.stroke(); c.restore(); return; }
    if (kind === 'rect') c.rect(x, y, w, hh);
    else if (kind === 'ellipse') c.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
    else if (kind === 'roundrect') c.roundRect(x, y, w, hh, Math.min(w, hh) * 0.2);
    if (shapeFill !== 'outline') c.fill();
    if (shapeFill !== 'fill') c.stroke();
    c.restore();
  }

  function constrain(a, b, line) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (line) {
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      return { x: Math.round(a.x + Math.cos(ang) * len), y: Math.round(a.y + Math.sin(ang) * len) };
    }
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + Math.sign(dx || 1) * m, y: a.y + Math.sign(dy || 1) * m };
  }

  function previewCursor(p) {
    if (sel || (drag && drag.kind === 'select')) return;
    clearOverlay();
    og.save();
    og.strokeStyle = 'rgba(0,0,0,.6)';
    og.lineWidth = 1;
    const r = tool === 'eraser' ? size : size / 2;
    og.beginPath();
    if (tool === 'eraser') og.rect(p.x - r + 0.5, p.y - r + 0.5, r * 2, r * 2); else og.arc(p.x + 0.5, p.y + 0.5, Math.max(1, r), 0, Math.PI * 2);
    og.stroke();
    og.restore();
  }

  function clearOverlay() { og.clearRect(0, 0, overlay.width, overlay.height); }

  function floodFill(x, y, hex) {
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    const W = canvas.width, H = canvas.height;
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    const i0 = (y * W + x) * 4;
    const target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    const fill = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
    if (target.every((v, i) => v === fill[i])) { undo.pop(); return; }
    const tol = 32;
    const match = (i) => Math.abs(d[i] - target[0]) <= tol && Math.abs(d[i + 1] - target[1]) <= tol && Math.abs(d[i + 2] - target[2]) <= tol && Math.abs(d[i + 3] - target[3]) <= tol;
    const seen = new Uint8Array(W * H);
    const stack = [[x, y]];
    while (stack.length) {
      let [cx, cy] = stack.pop();
      while (cx >= 0 && !seen[cy * W + cx] && match((cy * W + cx) * 4)) cx--;
      cx++;
      let up = false, down = false;
      while (cx < W && !seen[cy * W + cx] && match((cy * W + cx) * 4)) {
        const i = (cy * W + cx) * 4;
        seen[cy * W + cx] = 1;
        d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = 255;
        if (cy > 0) { const m = !seen[(cy - 1) * W + cx] && match(((cy - 1) * W + cx) * 4); if (m && !up) { stack.push([cx, cy - 1]); up = true; } else if (!m) up = false; }
        if (cy < H - 1) { const m = !seen[(cy + 1) * W + cx] && match(((cy + 1) * W + cx) * 4); if (m && !down) { stack.push([cx, cy + 1]); down = true; } else if (!m) down = false; }
        cx++;
      }
    }
    g.putImageData(img, 0, 0);
  }

  // ── Text ─────────────────────────────────────────────────────────────
  let textAt = null;
  function placeText(p) {
    commitText();
    textAt = p;
    textBox.hidden = false;
    textBox.value = '';
    Object.assign(textBox.style, { left: `${p.x * zoom}px`, top: `${p.y * zoom}px`, fontSize: `${fontSize * zoom}px`, color: primary, minWidth: `${Math.max(120, fontSize * 6) * zoom}px` });
    setTimeout(() => textBox.focus());
  }
  function commitText() {
    if (!textAt || textBox.hidden) return;
    const text = textBox.value;
    textBox.hidden = true;
    if (text.trim()) {
      snapshot();
      g.save();
      g.fillStyle = primary;
      g.font = `${fontSize}px ${getComputedStyle(win.body).fontFamily}`;
      g.textBaseline = 'top';
      text.split('\n').forEach((line, i) => g.fillText(line, textAt.x, textAt.y + i * fontSize * 1.25));
      g.restore();
    }
    textAt = null;
  }
  textBox.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { textBox.hidden = true; textAt = null; e.stopPropagation(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText(); }
    e.stopPropagation();
  });
  textBox.addEventListener('blur', () => setTimeout(commitText, 0));

  // ── Selection ────────────────────────────────────────────────────────
  const inside = (p, r) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
  function normRect(a, b) {
    const x = Math.max(0, Math.min(a.x, b.x)), y = Math.max(0, Math.min(a.y, b.y));
    return { x, y, w: Math.min(canvas.width, Math.max(a.x, b.x)) - x, h: Math.min(canvas.height, Math.max(a.y, b.y)) - y, float: null };
  }
  function liftSelection() {
    if (sel.float) return;
    snapshot();
    const f = document.createElement('canvas');
    f.width = sel.w; f.height = sel.h;
    f.getContext('2d').drawImage(canvas, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
    g.fillStyle = secondary;
    g.fillRect(sel.x, sel.y, sel.w, sel.h);
    sel.float = f;
    drawSelection();
  }
  function drawSelection() {
    clearOverlay();
    if (!sel) return;
    if (sel.float) og.drawImage(sel.float, sel.x, sel.y);
    og.save();
    og.setLineDash([4 / zoom, 3 / zoom]);
    og.lineWidth = 1 / zoom;
    og.strokeStyle = '#0078d4';
    og.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w - 1, sel.h - 1);
    og.restore();
    updateStatus();
  }
  function commitSelection({ record = true } = {}) {
    if (!sel) return;
    if (sel.float) g.drawImage(sel.float, sel.x, sel.y);
    if (sel.float && record) doc.setDirty(true);
    sel = null;
    clearOverlay();
  }
  function selectAll() { commitSelection(); setTool('select'); sel = { x: 0, y: 0, w: canvas.width, h: canvas.height, float: null }; drawSelection(); }
  function selectionCanvas() {
    if (!sel) return null;
    if (sel.float) return sel.float;
    const f = document.createElement('canvas');
    f.width = sel.w; f.height = sel.h;
    f.getContext('2d').drawImage(canvas, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
    return f;
  }
  async function copySel() {
    const c = selectionCanvas() || canvas;
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch { /* clipboard unavailable: in-app copy still works */ }
    clip = c;
  }
  let clip = null;
  async function cutSel() { if (!sel) return; await copySel(); deleteSel(); }
  function deleteSel() {
    if (!sel) return;
    if (!sel.float) { snapshot(); g.fillStyle = secondary; g.fillRect(sel.x, sel.y, sel.w, sel.h); }
    sel = null;
    clearOverlay();
    doc.setDirty(true);
  }
  async function pasteImage(source) {
    let c = source || null;
    if (!c) {
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const type = it.types.find((t) => t.startsWith('image/'));
          if (type) { c = await loadImage(await it.getType(type)); break; }
        }
      } catch { /* fall back to the in-app clipboard */ }
      c ||= clip;
    }
    if (!c) return;
    commitSelection();
    const w = c.naturalWidth || c.width, hh = c.naturalHeight || c.height;
    if (w > canvas.width || hh > canvas.height) {
      snapshot();
      const keep = g.getImageData(0, 0, canvas.width, canvas.height);
      const nw = Math.max(canvas.width, w), nh = Math.max(canvas.height, hh);
      canvas.width = overlay.width = nw; canvas.height = overlay.height = nh;
      g.fillStyle = secondary; g.fillRect(0, 0, nw, nh);
      g.putImageData(keep, 0, 0);
      applyZoom();
    } else snapshot();
    const f = document.createElement('canvas');
    f.width = w; f.height = hh;
    f.getContext('2d').drawImage(c, 0, 0);
    setTool('select');
    const x = Math.max(0, Math.round(stage.scrollLeft / zoom)), y = Math.max(0, Math.round(stage.scrollTop / zoom));
    sel = { x: Math.min(x, canvas.width - w), y: Math.min(y, canvas.height - hh), w, h: hh, float: f };
    drawSelection();
    doc.setDirty(true);
  }
  function cropToSelection() {
    if (!sel) return;
    const c = selectionCanvas();
    snapshot();
    sel = null;
    canvas.width = overlay.width = c.width; canvas.height = overlay.height = c.height;
    g.drawImage(c, 0, 0);
    clearOverlay();
    applyZoom();
  }

  // ── Image operations ─────────────────────────────────────────────────
  function transform(fn, { swap = false } = {}) {
    commitSelection();
    snapshot();
    const src = document.createElement('canvas');
    src.width = canvas.width; src.height = canvas.height;
    src.getContext('2d').drawImage(canvas, 0, 0);
    if (swap) { canvas.width = overlay.width = src.height; canvas.height = overlay.height = src.width; }
    g.save();
    fn(g, src);
    g.restore();
    applyZoom();
  }
  const rotate = (deg) => transform((c, s) => {
    if (deg === 180) { c.translate(s.width, s.height); c.rotate(Math.PI); }
    else if (deg === 90) { c.translate(s.height, 0); c.rotate(Math.PI / 2); }
    else { c.translate(0, s.width); c.rotate(-Math.PI / 2); }
    c.drawImage(s, 0, 0);
  }, { swap: deg !== 180 });
  const flip = (horizontal) => transform((c, s) => { if (horizontal) { c.translate(s.width, 0); c.scale(-1, 1); } else { c.translate(0, s.height); c.scale(1, -1); } c.drawImage(s, 0, 0); });
  function invert() {
    commitSelection(); snapshot();
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 255 - img.data[i]; img.data[i + 1] = 255 - img.data[i + 1]; img.data[i + 2] = 255 - img.data[i + 2]; }
    g.putImageData(img, 0, 0);
  }

  async function resizeDialog() {
    const byPct = h('input', { type: 'radio', name: 'by', checked: true });
    const byPx = h('input', { type: 'radio', name: 'by' });
    const wIn = h('input.input', { type: 'number', min: 1, value: 100, 'aria-label': 'Horizontal' });
    const hIn = h('input.input', { type: 'number', min: 1, value: 100, 'aria-label': 'Vertical' });
    const keep = h('input', { type: 'checkbox', checked: true });
    const stretch = h('input', { type: 'radio', name: 'mode', checked: true });
    const canvasOnly = h('input', { type: 'radio', name: 'mode' });
    const ratio = canvas.width / canvas.height;
    const sync = (from) => {
      if (!keep.checked) return;
      if (byPct.checked) { if (from === 'w') hIn.value = wIn.value; else wIn.value = hIn.value; }
      else if (from === 'w') hIn.value = Math.round(Number(wIn.value) / ratio); else wIn.value = Math.round(Number(hIn.value) * ratio);
    };
    wIn.oninput = () => sync('w'); hIn.oninput = () => sync('h');
    byPct.onchange = () => { wIn.value = 100; hIn.value = 100; };
    byPx.onchange = () => { wIn.value = canvas.width; hIn.value = canvas.height; };
    const ok = await dialog({ title: 'Resize', parent: win.body, cancelValue: false, body: h('div.pt-form',
      h('div.pt-radios', h('label', byPct, 'Percentage'), h('label', byPx, 'Pixels')),
      h('label', 'Horizontal', wIn), h('label', 'Vertical', hIn), h('label.pt-check', keep, 'Maintain aspect ratio'),
      h('div.pt-radios', h('label', stretch, 'Resize the picture'), h('label', canvasOnly, 'Change only the canvas size'))),
    buttons: [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    let w = Number(wIn.value), hh = Number(hIn.value);
    if (byPct.checked) { w = Math.round((canvas.width * w) / 100); hh = Math.round((canvas.height * hh) / 100); }
    w = Math.max(1, Math.min(MAX_SIDE, w || canvas.width)); hh = Math.max(1, Math.min(MAX_SIDE, hh || canvas.height));
    if (canvasOnly.checked) { setCanvasSize(w, hh); return; }
    commitSelection();
    snapshot();
    const src = document.createElement('canvas');
    src.width = canvas.width; src.height = canvas.height;
    src.getContext('2d').drawImage(canvas, 0, 0);
    canvas.width = overlay.width = w; canvas.height = overlay.height = hh;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, hh);
    applyZoom();
  }
  function setCanvasSize(w, hh, record = true) {
    commitSelection();
    if (record) snapshot();
    const keep = g.getImageData(0, 0, Math.min(w, canvas.width), Math.min(hh, canvas.height));
    canvas.width = overlay.width = w; canvas.height = overlay.height = hh;
    g.fillStyle = secondary; g.fillRect(0, 0, w, hh);
    g.putImageData(keep, 0, 0);
    applyZoom();
  }
  function resizeDrag(e) {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, w: canvas.width, h: canvas.height };
    const guide = h('div.pt-guide');
    sizer.append(guide);
    const move = (ev) => {
      const w = Math.max(1, Math.round(start.w + (ev.clientX - start.x) / zoom)), hh = Math.max(1, Math.round(start.h + (ev.clientY - start.y) / zoom));
      Object.assign(guide.style, { width: `${w * zoom}px`, height: `${hh * zoom}px` });
      guide.dataset.size = `${w} × ${hh}`;
    };
    const up = (ev) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      guide.remove();
      const w = Math.max(1, Math.min(MAX_SIDE, Math.round(start.w + (ev.clientX - start.x) / zoom))), hh = Math.max(1, Math.min(MAX_SIDE, Math.round(start.h + (ev.clientY - start.y) / zoom)));
      if (w !== canvas.width || hh !== canvas.height) setCanvasSize(w, hh);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  // ── UI ───────────────────────────────────────────────────────────────
  function setTool(t) {
    if (t !== 'select') commitSelection();
    if (t !== 'text') commitText();
    if (t !== 'picker') store.set('lastTool', t);
    tool = t;
    store.set('tool', t);
    win.body.dataset.tool = t;
    renderRibbon();
    updateStatus();
  }
  function saveColors() { store.set('primary', primary); store.set('secondary', secondary); renderRibbon(); }

  function renderRibbon() {
    const group = (label, ...kids) => h('div.pt-group', h('div.pt-group-body', kids), h('div.pt-group-label', label));
    const toolBtn = ([id, label, ic, key]) => h('button.tb-btn.pt-tool', { type: 'button', 'aria-pressed': String(tool === id), title: `${label} (${key})`, 'aria-label': label, onclick: () => setTool(id) }, icon(ic, { size: 18 }));
    mount(ribbon,
      group('Clipboard',
        h('button.btn.pt-big', { type: 'button', onclick: () => pasteImage(), title: 'Paste (Ctrl+V)' }, icon('paste', { size: 18 }), 'Paste'),
        h('div.pt-col', h('button.btn.subtle', { type: 'button', disabled: !sel, onclick: cutSel }, icon('cut', { size: 14 }), 'Cut'), h('button.btn.subtle', { type: 'button', onclick: copySel }, icon('copy', { size: 14 }), 'Copy'))),
      group('Image',
        h('div.pt-col',
          h('button.btn.subtle', { type: 'button', disabled: !sel, onclick: cropToSelection }, 'Crop'),
          h('button.btn.subtle', { type: 'button', onclick: resizeDialog }, 'Resize'),
          h('button.btn.subtle', { type: 'button', onclick: (e) => import('../../ui/menu.js').then(({ showMenu }) => showMenu([
            { label: 'Rotate right 90°', onSelect: () => rotate(90) }, { label: 'Rotate left 90°', onSelect: () => rotate(-90) }, { label: 'Rotate 180°', onSelect: () => rotate(180) },
            { separator: true }, { label: 'Flip horizontal', onSelect: () => flip(true) }, { label: 'Flip vertical', onSelect: () => flip(false) },
            { separator: true }, { label: 'Invert colours', onSelect: invert },
          ], { anchor: e.currentTarget, align: 'start' })) }, 'Rotate ▾'))),
      group('Tools', h('div.pt-grid', TOOLS.slice(0, 7).map(toolBtn))),
      group('Shapes', h('div.pt-grid', TOOLS.slice(7).map(toolBtn)),
        h('select.input.pt-small', { 'aria-label': 'Shape style', onchange: (e) => { shapeFill = e.target.value; store.set('shapeFill', shapeFill); } },
          [['outline', 'Outline'], ['fill', 'Fill'], ['both', 'Outline + fill']].map(([v, l]) => h('option', { value: v, selected: v === shapeFill }, l)))),
      group('Size',
        h('div.pt-col',
          h('input.pt-range', { type: 'range', min: 1, max: 60, value: size, 'aria-label': 'Brush size', oninput: (e) => { size = Number(e.target.value); store.set('size', size); e.target.nextSibling.textContent = `${size}px`; } }), h('small', `${size}px`),
          tool === 'text' ? h('select.input.pt-small', { 'aria-label': 'Text size', onchange: (e) => { fontSize = Number(e.target.value); store.set('fontSize', fontSize); } }, [12, 16, 20, 24, 32, 48, 64, 96].map((v) => h('option', { value: v, selected: v === fontSize }, `${v}px text`))) : null)),
      group('Colours',
        h('div.pt-colors',
          h('button.pt-swatch.big', { type: 'button', style: { background: primary }, title: 'Colour 1 (left click)', 'aria-label': 'Colour 1', onclick: () => pick('primary') }),
          h('button.pt-swatch.big.second', { type: 'button', style: { background: secondary }, title: 'Colour 2 (right click)', 'aria-label': 'Colour 2', onclick: () => pick('secondary') }),
          h('button.tb-btn', { type: 'button', title: 'Swap colours (X)', 'aria-label': 'Swap colours', onclick: () => { [primary, secondary] = [secondary, primary]; saveColors(); } }, '⇄')),
        h('div.pt-palette', [...PALETTE, ...custom].map((c) => h('button.pt-swatch', { type: 'button', style: { background: c }, title: c, 'aria-label': c,
          onclick: () => { primary = c; saveColors(); }, oncontextmenu: (e) => { e.preventDefault(); secondary = c; saveColors(); } }))),
        h('label.pt-edit', { title: 'Edit colours' }, icon('palette', { size: 18 }), h('input', { type: 'color', value: primary, 'aria-label': 'Edit colours', onchange: (e) => {
          primary = e.target.value; custom = [primary, ...custom.filter((x) => x !== primary)].slice(0, 10); store.set('customColors', custom); saveColors();
        } }))));
  }
  function pick(which) {
    const input = h('input', { type: 'color', value: which === 'primary' ? primary : secondary, style: { position: 'fixed', opacity: 0, pointerEvents: 'none' } });
    win.body.append(input);
    input.addEventListener('change', () => { if (which === 'primary') primary = input.value; else secondary = input.value; saveColors(); input.remove(); });
    input.addEventListener('blur', () => setTimeout(() => input.remove(), 500));
    input.click();
  }

  function updateStatus() {
    mount(status,
      h('span', cursor ? `${cursor.x}, ${cursor.y}px` : ''),
      h('span', sel ? `${sel.w} × ${sel.h}px selected` : ''),
      h('span', `${canvas.width} × ${canvas.height}px`),
      h('span.np-grow'),
      h('button.wr-stbtn', { type: 'button', 'aria-label': 'Zoom out', onclick: () => setZoom(zoom / 1.25) }, '−'),
      h('input.pt-zoom', { type: 'range', min: 10, max: 800, value: Math.round(zoom * 100), 'aria-label': 'Zoom', oninput: (e) => setZoom(Number(e.target.value) / 100) }),
      h('button.wr-stbtn', { type: 'button', 'aria-label': 'Zoom in', onclick: () => setZoom(zoom * 1.25) }, '+'),
      h('span.pt-zoomv', `${Math.round(zoom * 100)}%`),
      h('button.wr-stbtn', { type: 'button', onclick: zoomToFit }, 'Fit'));
  }

  const bar = menubar([
    { label: 'File', items: () => [
      { label: 'New', hint: 'Ctrl+N', onSelect: () => doc.reset(() => { commitSelection({ record: false }); undo.length = 0; redo.length = 0; blank(1152, 648); zoomToFit(); }) },
      { label: 'Open…', hint: 'Ctrl+O', onSelect: () => doc.openWithDialog() },
      { label: 'Save', hint: 'Ctrl+S', onSelect: () => doc.save() },
      { label: 'Save as…', hint: 'Ctrl+Shift+S', onSelect: () => doc.saveAs() },
      { separator: true },
      { label: 'Print…', hint: 'Ctrl+P', onSelect: print },
      { separator: true },
      { label: 'Close', onSelect: () => win.close() },
    ] },
    { label: 'Edit', items: () => [
      { label: 'Undo', hint: 'Ctrl+Z', disabled: !undo.length, onSelect: () => restore(undo, redo) },
      { label: 'Redo', hint: 'Ctrl+Y', disabled: !redo.length, onSelect: () => restore(redo, undo) },
      { separator: true },
      { label: 'Cut', hint: 'Ctrl+X', disabled: !sel, onSelect: cutSel },
      { label: 'Copy', hint: 'Ctrl+C', onSelect: copySel },
      { label: 'Paste', hint: 'Ctrl+V', onSelect: () => pasteImage() },
      { label: 'Delete selection', hint: 'Del', disabled: !sel, onSelect: deleteSel },
      { label: 'Select all', hint: 'Ctrl+A', onSelect: selectAll },
      { label: 'Crop to selection', hint: 'Ctrl+Shift+X', disabled: !sel, onSelect: cropToSelection },
    ] },
    { label: 'Image', items: () => [
      { label: 'Resize…', hint: 'Ctrl+W', onSelect: resizeDialog },
      { label: 'Rotate right 90°', onSelect: () => rotate(90) }, { label: 'Rotate left 90°', onSelect: () => rotate(-90) }, { label: 'Rotate 180°', onSelect: () => rotate(180) },
      { label: 'Flip horizontal', onSelect: () => flip(true) }, { label: 'Flip vertical', onSelect: () => flip(false) },
      { label: 'Invert colours', hint: 'Ctrl+Shift+I', onSelect: invert },
      { separator: true },
      { label: 'Clear image', hint: 'Ctrl+Shift+N', onSelect: () => { commitSelection(); snapshot(); g.fillStyle = secondary; g.fillRect(0, 0, canvas.width, canvas.height); } },
    ] },
    { label: 'View', items: () => [
      { label: 'Zoom in', hint: 'Ctrl+Plus', onSelect: () => setZoom(zoom * 1.25) },
      { label: 'Zoom out', hint: 'Ctrl+Minus', onSelect: () => setZoom(zoom / 1.25) },
      { label: 'Actual size (100%)', hint: 'Ctrl+0', onSelect: () => setZoom(1) },
      { label: 'Fit to window', onSelect: zoomToFit },
    ] },
  ]);
  mount(win.body, bar, ribbon, stage, status);

  async function print() {
    const { printDocument } = await import('../common/print.js');
    commitSelection();
    await printDocument({ title: doc.name, html: `<img src="${canvas.toDataURL('image/png')}" style="max-width:100%">` });
  }

  // ── Keys ─────────────────────────────────────────────────────────────
  ctx.listen(win.body, 'keydown', (e) => {
    if (e.target === textBox || e.target.matches('input, select')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); restore(undo, redo); }
    else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); restore(redo, undo); }
    else if (ctrl && key === 'a') { e.preventDefault(); selectAll(); }
    else if (ctrl && key === 'c') { e.preventDefault(); copySel(); }
    else if (ctrl && key === 'x' && e.shiftKey) { e.preventDefault(); cropToSelection(); }
    else if (ctrl && key === 'x') { e.preventDefault(); cutSel(); }
    else if (ctrl && key === 'v') { /* handled by the paste event below */ }
    else if (ctrl && key === 'w') { e.preventDefault(); resizeDialog(); }
    else if (ctrl && e.shiftKey && key === 'i') { e.preventDefault(); invert(); }
    else if (ctrl && (key === '=' || key === '+')) { e.preventDefault(); setZoom(zoom * 1.25); }
    else if (ctrl && key === '-') { e.preventDefault(); setZoom(zoom / 1.25); }
    else if (ctrl && key === '0') { e.preventDefault(); setZoom(1); }
    else if (e.key === 'Delete') { e.preventDefault(); deleteSel(); }
    else if (e.key === 'Escape') { if (sel?.float) commitSelection(); else { sel = null; clearOverlay(); } updateStatus(); }
    else if (!ctrl && !e.altKey && key === 'x') { [primary, secondary] = [secondary, primary]; saveColors(); }
    else if (!ctrl && !e.altKey && key === '[') { size = Math.max(1, size - 1); store.set('size', size); renderRibbon(); }
    else if (!ctrl && !e.altKey && key === ']') { size = Math.min(60, size + 1); store.set('size', size); renderRibbon(); }
    else if (!ctrl && !e.altKey) { const t = TOOLS.find((x) => x[3].toLowerCase() === key); if (t) setTool(t[0]); }
    else if (e.key.startsWith('Arrow') && sel) {
      e.preventDefault(); liftSelection();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') sel.x -= step; if (e.key === 'ArrowRight') sel.x += step; if (e.key === 'ArrowUp') sel.y -= step; if (e.key === 'ArrowDown') sel.y += step;
      drawSelection();
    }
  });
  ctx.listen(win.body, 'paste', (e) => {
    if (e.target === textBox) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (file) loadImage(file).then((img) => pasteImage(img)); else pasteImage();
  });
  ctx.listen(stage, 'wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });
  documentKeys(ctx, win, { new: () => doc.reset(() => { undo.length = 0; redo.length = 0; blank(1152, 648); zoomToFit(); }), open: () => doc.openWithDialog(), save: () => doc.save(), saveAs: () => doc.saveAs(), print });
  win.onBeforeClose(() => doc.confirmDiscard());

  // Dropping a picture file onto Paint opens it.
  ctx.listen(win.body, 'dragover', (e) => { if (e.dataTransfer.types.includes('application/x-donut-paths')) e.preventDefault(); });
  ctx.listen(win.body, 'drop', async (e) => {
    const data = e.dataTransfer.getData('application/x-donut-paths');
    if (!data) return;
    e.preventDefault();
    const [first] = JSON.parse(data);
    if (first && (await doc.confirmDiscard())) doc.open(first);
  });

  blank(1152, 648);
  win.body.dataset.tool = tool;
  renderRibbon();
  requestAnimationFrame(() => { zoomToFit(); if (ctx.args.path) doc.open(ctx.args.path); });
}
