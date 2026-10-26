// Minesweeper: Beginner, Intermediate, Expert and custom boards; the first click is always
// safe; flags, question marks, chording, keyboard play, a timer and best times.

import { h, mount } from '../../ui/h.js';
import { showMenu } from '../../ui/menu.js';
import { dialog, confirmDialog } from '../../ui/dialog.js';

const LEVELS = { beginner: ['Beginner', 9, 9, 10], intermediate: ['Intermediate', 16, 16, 40], expert: ['Expert', 30, 16, 99] };

export default function main(ctx) {
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'Minesweeper', width: 520, height: 600, minWidth: 300, minHeight: 360 });
  win.body.classList.add('minesweeper');

  let level = store.get('level', 'beginner');
  let custom = store.get('custom', { w: 20, h: 12, m: 40 });
  let marks = store.get('marks', true);
  let W, H, M, cells, state, flags, opened, time, timer, focus, firstClick;

  const counter = h('div.ms-led');
  const clock = h('div.ms-led');
  const face = h('button.ms-face', { type: 'button', 'aria-label': 'New game (F2)', onclick: () => reset() }, '🙂');
  const grid = h('div.ms-grid', { role: 'grid', tabindex: '0', 'aria-label': 'Minefield' });
  let cellEls = [];
  const status = h('div.ms-status', { 'aria-live': 'polite' });
  mount(win.body,
    h('header.ms-bar', h('button.btn.subtle', { type: 'button', onclick: (e) => menu(e.currentTarget) }, 'Game ▾'), h('div.mp-grow'), status),
    h('div.ms-board', h('div.ms-top', counter, face, clock), h('div.ms-gridwrap', grid)));

  function dims() {
    if (level === 'custom') return [custom.w, custom.h, custom.m];
    const [, w, hh, m] = LEVELS[level];
    return [w, hh, m];
  }

  function reset() {
    [W, H, M] = dims();
    cells = Array.from({ length: W * H }, () => ({ mine: false, n: 0, open: false, mark: 0 })); // mark: 0 none, 1 flag, 2 question
    state = 'ready'; flags = 0; opened = 0; time = 0; firstClick = true;
    focus = Math.floor(H / 2) * W + Math.floor(W / 2);
    ctx.clearInterval(timer); timer = null;
    face.textContent = '🙂';
    grid.style.setProperty('--cols', W);
    grid.style.setProperty('--rows', H);
    // Rows (display: contents, for screen readers) of cells; cellEls keeps them by index.
    cellEls = cells.map((c, i) => h('button.ms-cell', { type: 'button', role: 'gridcell', tabindex: '-1', dataset: { i }, 'aria-label': `Row ${Math.floor(i / W) + 1}, column ${(i % W) + 1}, hidden` }));
    mount(grid, Array.from({ length: H }, (_, r) => h('div.ms-row', { role: 'row' }, cellEls.slice(r * W, r * W + W))));
    status.textContent = `${LEVELS[level]?.[0] || `Custom ${W}×${H}`} · ${M} mines`;
    paint();
    fit();
  }

  const neighbours = (i) => {
    const x = i % W, y = Math.floor(i / W), out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.push(ny * W + nx);
    }
    return out;
  };

  function plant(safe) {
    // The first cell and its neighbours never hold a mine.
    const keepOut = new Set([safe, ...neighbours(safe)]);
    const free = cells.map((_, i) => i).filter((i) => !keepOut.has(i));
    const pool = free.length >= M ? free : cells.map((_, i) => i).filter((i) => i !== safe);
    for (let k = 0; k < M; k++) { const j = k + Math.floor(Math.random() * (pool.length - k)); [pool[k], pool[j]] = [pool[j], pool[k]]; cells[pool[k]].mine = true; }
    cells.forEach((c, i) => { c.n = neighbours(i).filter((j) => cells[j].mine).length; });
  }

  function start() {
    state = 'playing';
    timer = ctx.setInterval(() => { if (time < 999) time++; paintLeds(); }, 1000);
  }

  function open(i) {
    if (state === 'won' || state === 'lost') return;
    const c = cells[i];
    if (c.open || c.mark === 1) return;
    if (firstClick) { plant(i); firstClick = false; start(); }
    if (c.mine) { lose(i); return; }
    // Flood-fill empty areas.
    const stack = [i];
    while (stack.length) {
      const j = stack.pop();
      const d = cells[j];
      if (d.open || d.mark === 1) continue;
      d.open = true; d.mark = 0; opened++;
      if (d.n === 0) for (const k of neighbours(j)) if (!cells[k].open && !cells[k].mine) stack.push(k);
    }
    if (opened === W * H - M) winGame();
    paint();
  }

  function chord(i) {
    const c = cells[i];
    if (!c.open || !c.n || state !== 'playing') return;
    const ns = neighbours(i);
    if (ns.filter((j) => cells[j].mark === 1).length !== c.n) { flashNeighbours(ns); return; }
    for (const j of ns) if (!cells[j].open && cells[j].mark !== 1) { if (cells[j].mine) { lose(j); return; } open(j); }
  }
  function flashNeighbours(ns) {
    for (const j of ns) if (!cells[j].open && !cells[j].mark) cellEls[j].classList.add('press');
    setTimeout(() => grid.querySelectorAll('.press').forEach((e) => e.classList.remove('press')), 160);
  }

  function toggleMark(i) {
    const c = cells[i];
    if (c.open || state === 'won' || state === 'lost') return;
    c.mark = c.mark === 0 ? 1 : c.mark === 1 && marks ? 2 : 0;
    flags = cells.filter((x) => x.mark === 1).length;
    paint();
  }

  function lose(i) {
    state = 'lost';
    ctx.clearInterval(timer);
    cells[i].boom = true;
    for (const c of cells) if (c.mine && c.mark !== 1) c.open = true;
    face.textContent = '😵';
    status.textContent = 'Boom! Select the face to try again.';
    paint();
  }

  function winGame() {
    state = 'won';
    ctx.clearInterval(timer);
    for (const c of cells) if (c.mine) c.mark = 1;
    flags = M;
    face.textContent = '😎';
    paint();
    const best = store.get('best', {});
    const key = level === 'custom' ? `custom:${W}x${H}x${M}` : level;
    const record = best[key] === undefined || time < best[key];
    if (record) { best[key] = time; store.set('best', best); }
    const s = store.get('stats', {}); s[key] = { played: (s[key]?.played || 0), won: (s[key]?.won || 0) + 1 }; store.set('stats', s);
    status.textContent = record ? `New best time: ${time} s!` : `Cleared in ${time} s.`;
  }

  // ── Rendering ────────────────────────────────────────────────────────
  function paintLeds() {
    counter.textContent = String(Math.max(-99, M - flags)).padStart(3, '0');
    clock.textContent = String(time).padStart(3, '0');
  }
  function paint() {
    cells.forEach((c, i) => {
      const el = cellEls[i];
      el.className = 'ms-cell';
      el.textContent = '';
      if (c.open) {
        el.classList.add('open');
        if (c.mine) { el.classList.add('mine'); el.textContent = '✹'; if (c.boom) el.classList.add('boom'); }
        else if (c.n) { el.textContent = String(c.n); el.classList.add(`n${c.n}`); }
      } else if (c.mark === 1) {
        el.textContent = '⚑'; el.classList.add('flag');
        if (state === 'lost' && !c.mine) { el.classList.add('wrong'); el.textContent = '✕'; }
      } else if (c.mark === 2) el.textContent = '?';
      if (i === focus && document.activeElement === grid) el.classList.add('focus');
      el.setAttribute('aria-label', `Row ${Math.floor(i / W) + 1}, column ${(i % W) + 1}, ${c.open ? (c.mine ? 'mine' : c.n ? `${c.n} mines nearby` : 'empty') : c.mark === 1 ? 'flagged' : 'hidden'}`);
    });
    paintLeds();
  }
  function fit() {
    const wrap = grid.parentElement;
    const r = wrap.getBoundingClientRect();
    const size = Math.max(16, Math.min(40, Math.floor(Math.min((r.width - 8) / W, (r.height - 8) / H))));
    grid.style.setProperty('--cell', `${size}px`);
  }

  // ── Input ────────────────────────────────────────────────────────────
  let buttons = 0;
  let longPress = null;
  grid.addEventListener('contextmenu', (e) => e.preventDefault());
  grid.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.ms-cell');
    if (!el) return;
    buttons = e.buttons;
    const i = Number(el.dataset.i);
    focus = i;
    if (state === 'won' || state === 'lost') return;
    if (e.button === 2 && !(e.buttons & 1)) { toggleMark(i); return; }
    face.textContent = '😮';
    if (e.pointerType === 'touch') longPress = setTimeout(() => { longPress = 'fired'; toggleMark(i); navigator.vibrate?.(30); }, 450);
  });
  grid.addEventListener('pointerup', (e) => {
    const el = e.target.closest('.ms-cell');
    if (state === 'playing' || state === 'ready') face.textContent = '🙂';
    if (longPress === 'fired') { longPress = null; return; }
    clearTimeout(longPress); longPress = null;
    if (!el) return;
    const i = Number(el.dataset.i);
    // Left+right together, middle click, or clicking a revealed number chords.
    if ((buttons & 3) === 3 || e.button === 1 || cells[i].open) chord(i);
    else if (e.button === 0) open(i);
    buttons = 0;
  });

  grid.addEventListener('keydown', (e) => {
    const x = focus % W, y = Math.floor(focus / W);
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[e.key]) { e.preventDefault(); const [dx, dy] = moves[e.key]; focus = Math.min(H - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx)); paint(); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (cells[focus].open) chord(focus); else open(focus); }
    else if (e.key.toLowerCase() === 'f' || e.key === 'Shift') { e.preventDefault(); toggleMark(focus); }
  });
  grid.addEventListener('focus', paint);
  grid.addEventListener('blur', paint);

  function menu(anchor) {
    showMenu([
      { label: 'New game', hint: 'F2', onSelect: reset },
      { separator: true },
      ...Object.entries(LEVELS).map(([id, [label, w, hh, m]]) => ({ label: `${label} (${w}×${hh}, ${m} mines)`, checked: level === id, onSelect: () => setLevel(id) })),
      { label: 'Custom…', checked: level === 'custom', onSelect: customDialog },
      { separator: true },
      { label: 'Question marks', checked: marks, onSelect: () => { marks = !marks; store.set('marks', marks); } },
      { label: 'Best times…', onSelect: bestTimes },
    ], { anchor, align: 'start' });
  }
  async function setLevel(id) {
    if (state === 'playing' && !(await confirmDialog('Start a new game?', 'The game in progress will end.', { ok: 'New game', parent: win.body }))) return;
    level = id; store.set('level', id);
    const [w, hh] = dims();
    const cell = 28;
    win.setBounds?.({ w: Math.max(300, w * cell + 60), h: Math.max(360, hh * cell + 170) });
    reset();
  }
  async function customDialog() {
    const num = (v, min, max, label) => h('input.input', { type: 'number', min, max, value: v, 'aria-label': label });
    const w = num(custom.w, 5, 50, 'Width'), hh = num(custom.h, 5, 30, 'Height'), m = num(custom.m, 1, 999, 'Mines');
    const err = h('div.error-text');
    const ok = await dialog({ title: 'Custom field', parent: win.body, cancelValue: false, body: h('div.cal-form', h('label.ck-field', 'Width (5–50)', w), h('label.ck-field', 'Height (5–30)', hh), h('label.ck-field', 'Mines', m), err),
      buttons: [{ label: 'Play', value: true, primary: true, validate: () => {
        const cw = Number(w.value), ch = Number(hh.value), cm = Number(m.value);
        const msg = !(cw >= 5 && cw <= 50) ? 'Width must be 5 to 50' : !(ch >= 5 && ch <= 30) ? 'Height must be 5 to 30' : !(cm >= 1 && cm <= cw * ch - 9) ? `Use 1 to ${cw * ch - 9} mines` : '';
        err.textContent = msg; return !msg;
      } }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    custom = { w: Number(w.value), h: Number(hh.value), m: Number(m.value) };
    store.set('custom', custom);
    setLevel('custom');
  }
  async function bestTimes() {
    const best = store.get('best', {});
    const res = await dialog({ title: 'Best times', parent: win.body, cancelValue: null, body: h('dl.tm-props', Object.entries(LEVELS).flatMap(([id, [label]]) => [h('dt', label), h('dd', best[id] !== undefined ? `${best[id]} seconds` : '—')])),
      buttons: [{ label: 'Close', value: null, primary: true }, { label: 'Reset', value: 'reset', danger: true }] });
    if (res === 'reset') store.remove('best');
  }

  ctx.listen(win.body, 'keydown', (e) => { if (e.key === 'F2') { e.preventDefault(); reset(); } });
  win.on('resize', fit);
  reset();
  setTimeout(() => grid.focus());
}
