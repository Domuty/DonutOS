// Snake — arrow keys / WASD / swipe; P or Space pauses.
import { h, mount, css } from '@donut/sdk';

css(`
.sn { height: 100%; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 12px; }
.sn-bar { display: flex; gap: 14px; align-items: center; width: 100%; max-width: 520px; }
.sn-score { font: 600 18px var(--font-display); }
canvas { border-radius: 10px; background: #182018; touch-action: none; max-width: 100%; }
.sn-over { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 8px; background: rgba(0,0,0,.55); color: #fff; border-radius: 10px; text-align: center; }
.sn-wrap { position: relative; }
`);

const N = 20;
export default function main(app) {
  let speed = app.storage.get('speed', 'normal');
  let wrap = app.storage.get('wrap', false);
  let best = app.storage.get('best', {});
  const SPEEDS = { slow: 140, normal: 95, fast: 60 };
  let snake, dir, queue, food, score, state, timer;

  const canvas = h('canvas', { width: 480, height: 480, 'aria-label': 'Game board' });
  const g = canvas.getContext('2d');
  const scoreEl = h('span.sn-score');
  const overlay = h('div.sn-over');
  const sel = h('select.input', { 'aria-label': 'Speed', style: { width: '120px' }, onchange: (e) => { speed = e.target.value; app.storage.set('speed', speed); reset(); } },
    ['slow', 'normal', 'fast'].map((s) => h('option', { value: s, selected: s === speed }, s[0].toUpperCase() + s.slice(1))));
  const wrapBox = h('label.row', h('input', { type: 'checkbox', checked: wrap, onchange: (e) => { wrap = e.target.checked; app.storage.set('wrap', wrap); reset(); } }), 'Wrap around');
  mount(app.root, h('div.sn', h('div.sn-bar', scoreEl, h('div.grow'), sel, wrapBox), h('div.sn-wrap', canvas, overlay), h('small.muted', 'Arrows or WASD to move · Space to pause')));

  const key = () => `${speed}${wrap ? '-wrap' : ''}`;
  function reset() {
    snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    dir = { x: 1, y: 0 }; queue = []; score = 0; state = 'ready';
    placeFood(); draw(); show('Snake', 'Press an arrow key or Space to start');
    clearInterval(timer); timer = setInterval(step, SPEEDS[speed]);
  }
  function placeFood() {
    do { food = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) }; } while (snake.some((s) => s.x === food.x && s.y === food.y));
  }
  function show(title, sub) { overlay.hidden = false; mount(overlay, h('h2', title), h('p', sub)); }
  function step() {
    if (state !== 'play') return;
    if (queue.length) dir = queue.shift();
    let head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (wrap) head = { x: (head.x + N) % N, y: (head.y + N) % N };
    const hit = head.x < 0 || head.y < 0 || head.x >= N || head.y >= N || snake.slice(0, -1).some((s) => s.x === head.x && s.y === head.y);
    if (hit) return over();
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) { score += 10; placeFood(); } else snake.pop();
    draw();
  }
  function over() {
    state = 'over';
    const record = score > (best[key()] || 0);
    if (record) { best = { ...best, [key()]: score }; app.storage.set('best', best); }
    show(record && score ? 'New high score!' : 'Game over', `Score ${score} · press Space to play again`);
    draw();
  }
  function draw() {
    const c = canvas.width / N;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#1d281d';
    for (let y = 0; y < N; y++) for (let x = (y % 2); x < N; x += 2) g.fillRect(x * c, y * c, c, c);
    g.fillStyle = '#ff5d5d'; g.beginPath(); g.arc(food.x * c + c / 2, food.y * c + c / 2, c * 0.38, 0, Math.PI * 2); g.fill();
    snake.forEach((s, i) => { g.fillStyle = i ? '#4cb782' : '#6ad38f'; g.beginPath(); g.roundRect(s.x * c + 1, s.y * c + 1, c - 2, c - 2, c * 0.3); g.fill(); });
    scoreEl.textContent = `Score ${score}   ·   Best ${best[key()] || 0}`;
  }
  function turn(d) {
    const last = queue[queue.length - 1] || dir;
    if (d.x === -last.x && d.y === -last.y) return;
    if (queue.length < 3) queue.push(d);
    if (state === 'ready') { state = 'play'; overlay.hidden = true; }
  }
  const DIRS = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 } };
  addEventListener('keydown', (e) => {
    if (e.target.matches?.('select, input')) return;
    const d = DIRS[e.key] || DIRS[e.key.toLowerCase()];
    if (d) { e.preventDefault(); if (state !== 'over') { if (state === 'pause') { state = 'play'; overlay.hidden = true; } turn(d); } return; }
    if (e.key === ' ' || e.key.toLowerCase() === 'p') {
      e.preventDefault();
      if (state === 'over') { reset(); state = 'play'; overlay.hidden = true; }
      else if (state === 'play') { state = 'pause'; show('Paused', 'Press Space to continue'); }
      else { state = 'play'; overlay.hidden = true; }
    }
  });
  let touch = null;
  canvas.addEventListener('pointerdown', (e) => { touch = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!touch) return;
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    touch = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) { if (state === 'over') reset(); return; }
    turn(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
  });
  app.window.onBlur(() => { if (state === 'play') { state = 'pause'; show('Paused', 'Press Space to continue'); } });
  reset();
}
