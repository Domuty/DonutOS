// 2048 — arrows/WASD or swipe; Ctrl+Z undoes the last move.
import { h, mount, css, ui } from '@donut/sdk';

css(`
.g2 { height: 100%; display: flex; flex-direction: column; align-items: center; padding: 14px; gap: 12px; }
.g2-head { display: flex; gap: 8px; align-items: center; width: min(100%, 440px); }
.g2-box { background: var(--surface-2); border-radius: 8px; padding: 6px 14px; text-align: center; } .g2-box small { display: block; } .g2-box b { font-size: 18px; }
.g2-board { position: relative; width: min(100%, 440px); aspect-ratio: 1; background: #bbada0; border-radius: 10px; padding: 2%; touch-action: none; }
.g2-cell, .g2-tile { position: absolute; width: 21.5%; height: 21.5%; border-radius: 6px; }
.g2-cell { background: rgba(238,228,218,.35); }
.g2-tile { display: grid; place-items: center; font: 700 clamp(18px, 6vw, 40px) var(--font-display); transition: left .1s, top .1s; color: #776e65; }
.g2-tile.new { animation: pop .18s; } .g2-tile.merged { animation: pop .18s; }
@keyframes pop { 0% { transform: scale(.4); } 70% { transform: scale(1.1); } 100% { transform: scale(1); } }
.g2-over { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 10px; background: rgba(238,228,218,.75); border-radius: 10px; color: #776e65; }
`);
const COLORS = { 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };

export default function main(app) {
  let st = app.storage.get('game', null);
  let best = app.storage.get('best', 0);
  let prev = null;
  let seq = 1;
  const board = h('div.g2-board');
  const scoreEl = h('b'), bestEl = h('b');
  mount(app.root, h('div.g2',
    h('div.g2-head', h('h1.grow', '2048'), h('div.g2-box', h('small', 'Score'), scoreEl), h('div.g2-box', h('small', 'Best'), bestEl)),
    h('div.g2-head', h('small.grow.muted', 'Join the numbers to get to 2048!'), h('button.btn', { type: 'button', onclick: undo }, '↶ Undo'), h('button.btn.primary', { type: 'button', onclick: newGame }, 'New game')),
    board));

  function empty() { const out = []; st.grid.forEach((row, y) => row.forEach((v, x) => { if (!v) out.push([x, y]); })); return out; }
  function addTile() { const e = empty(); if (!e.length) return; const [x, y] = e[Math.floor(Math.random() * e.length)]; st.grid[y][x] = { v: Math.random() < 0.9 ? 2 : 4, id: seq++, isNew: true }; }
  function fresh() { st = { grid: Array.from({ length: 4 }, () => [null, null, null, null]), score: 0, won: false, keepGoing: false }; addTile(); addTile(); }
  function newGame() { prev = null; fresh(); save(); render(); }
  const save = () => app.storage.set('game', st);
  const clone = (s) => JSON.parse(JSON.stringify(s));

  function move(dx, dy) {
    if (over() && !canMove()) return;
    const before = clone(st);
    let moved = false;
    for (const row of st.grid) for (const c of row) if (c) { c.isNew = false; c.merged = false; }
    const range = [0, 1, 2, 3];
    const xs = dx > 0 ? [...range].reverse() : range, ys = dy > 0 ? [...range].reverse() : range;
    for (const y of ys) for (const x of xs) {
      const c = st.grid[y][x];
      if (!c) continue;
      let nx = x, ny = y;
      while (true) {
        const tx = nx + dx, ty = ny + dy;
        if (tx < 0 || ty < 0 || tx > 3 || ty > 3) break;
        const t = st.grid[ty][tx];
        if (!t) { nx = tx; ny = ty; continue; }
        if (t.v === c.v && !t.merged) { nx = tx; ny = ty; }
        break;
      }
      if (nx === x && ny === y) continue;
      const target = st.grid[ny][nx];
      st.grid[y][x] = null;
      if (target) { target.v *= 2; target.merged = true; st.score += target.v; if (target.v === 2048 && !st.won) st.won = true; }
      else st.grid[ny][nx] = c;
      moved = true;
    }
    if (!moved) return;
    prev = before;
    addTile();
    if (st.score > best) { best = st.score; app.storage.set('best', best); }
    save(); render();
  }
  function canMove() {
    if (empty().length) return true;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const v = st.grid[y][x]?.v; if ((x < 3 && st.grid[y][x + 1]?.v === v) || (y < 3 && st.grid[y + 1][x]?.v === v)) return true; }
    return false;
  }
  const over = () => !canMove();
  function undo() { if (!prev) { ui.alert('Nothing to undo', 'You can undo one move at a time.'); return; } st = prev; prev = null; save(); render(); }

  function render() {
    const pos = (i) => `${2 + i * 24.5}%`;
    const cells = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) cells.push(h('div.g2-cell', { style: { left: pos(x), top: pos(y) } }));
    const tiles = [];
    st.grid.forEach((row, y) => row.forEach((c, x) => { if (c) tiles.push(h('div.g2-tile', { class: [c.isNew && 'new', c.merged && 'merged'], style: { left: pos(x), top: pos(y), background: COLORS[c.v] || '#3c3a32', color: c.v > 4 ? '#f9f6f2' : '#776e65', fontSize: c.v >= 1024 ? 'clamp(14px, 4.5vw, 30px)' : null } }, String(c.v))); }));
    let msg = null;
    if (st.won && !st.keepGoing) msg = h('div.g2-over', h('h2', 'You made 2048!'), h('div.row', h('button.btn.primary', { type: 'button', onclick: () => { st.keepGoing = true; save(); render(); } }, 'Keep going'), h('button.btn', { type: 'button', onclick: newGame }, 'New game')));
    else if (!canMove()) msg = h('div.g2-over', h('h2', 'Game over'), h('p', `Score ${st.score}`), h('div.row', prev ? h('button.btn', { type: 'button', onclick: undo }, 'Undo') : null, h('button.btn.primary', { type: 'button', onclick: newGame }, 'Try again')));
    mount(board, cells, tiles, msg);
    scoreEl.textContent = String(st.score); bestEl.textContent = String(best);
  }

  const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    const k = KEYS[e.key] || KEYS[e.key.toLowerCase()];
    if (k && !e.ctrlKey && !e.altKey) { e.preventDefault(); move(...k); }
  });
  let start = null;
  board.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; });
  board.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y; start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) move(Math.sign(dx), 0); else move(0, Math.sign(dy));
  });
  if (!st?.grid) fresh();
  render();
}
