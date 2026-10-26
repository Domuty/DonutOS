// Solitaire (Klondike): draw one or three, drag or double-click cards, unlimited undo,
// hints, auto-complete, Standard or Vegas scoring, a timer, statistics, and the game in
// progress is kept when you close the app.

import { h, mount } from '../../ui/h.js';
import { showMenu } from '../../ui/menu.js';
import { dialog, confirmDialog } from '../../ui/dialog.js';

const SUITS = ['♠', '♥', '♦', '♣'];
const RED = new Set([1, 2]);
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export default function main(ctx) {
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'Solitaire', width: 1000, height: 720, minWidth: 520, minHeight: 420 });
  win.body.classList.add('solitaire');

  let opts = { draw: 1, scoring: 'standard', ...store.get('options', {}) };
  let st = null;          // game state
  let undo = [];
  let timer = null;
  let anim = new Set();

  const table = h('div.so-table', { tabindex: '0' });
  const bar = h('div.so-bar');
  mount(win.body, bar, table);

  // ── Game state ───────────────────────────────────────────────────────
  function deal() {
    const deck = [];
    for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) deck.push({ s, r, up: false, id: s * 13 + r });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const tableau = Array.from({ length: 7 }, (_, i) => deck.splice(0, i + 1));
    tableau.forEach((col) => { col[col.length - 1].up = true; });
    st = { stock: deck, waste: [], found: [[], [], [], []], tableau, score: opts.scoring === 'vegas' ? -52 : 0, moves: 0, time: 0, started: false, won: false, passes: 0, draw: opts.draw, scoring: opts.scoring };
    undo = [];
    const stats = getStats();
    stats.played++;
    stats.streak = stats.lastWon ? stats.streak : 0;
    saveStats(stats);
    save();
    render(true);
  }

  const snapshot = () => JSON.stringify({ ...st });
  function push() { undo.push(snapshot()); if (undo.length > 500) undo.shift(); }
  function save() { store.set('game', st && !st.won ? st : null); }
  const getStats = () => store.get('stats', { played: 0, won: 0, bestTime: null, bestScore: null, streak: 0, bestStreak: 0, lastWon: false });
  const saveStats = (s) => store.set('stats', s);

  const pileOf = (name) => {
    if (name === 'stock') return st.stock;
    if (name === 'waste') return st.waste;
    const [kind, i] = name.split(':');
    return kind === 'f' ? st.found[+i] : st.tableau[+i];
  };
  const top = (pile) => pile[pile.length - 1];
  const canFound = (card, f) => (f.length ? top(f).s === card.s && top(f).r === card.r - 1 : card.r === 0);
  const canTab = (card, col) => (col.length ? top(col).up && RED.has(top(col).s) !== RED.has(card.s) && top(col).r === card.r + 1 : card.r === 12);
  const addScore = (n) => { if (st.scoring === 'standard') st.score = Math.max(0, st.score + n); else if (st.scoring === 'vegas') st.score += n; };

  function startClock() {
    if (st.started) return;
    st.started = true;
    timer = ctx.setInterval(() => {
      if (st.won || win.state === 'minimized') return;
      st.time++;
      if (st.scoring === 'standard' && st.time % 10 === 0) addScore(-2);
      paintBar();
      if (st.time % 15 === 0) save();
    }, 1000);
  }

  function drawStock() {
    startClock();
    push();
    if (!st.stock.length) {
      if (!st.waste.length) { undo.pop(); return; }
      if (st.scoring === 'vegas' && st.passes >= (st.draw === 3 ? 2 : 0)) { undo.pop(); flashMsg(st.draw === 3 ? 'Vegas scoring allows three passes through the deck.' : 'Vegas scoring allows one pass through the deck.'); return; }
      st.stock = st.waste.reverse().map((c) => ({ ...c, up: false }));
      st.waste = [];
      st.passes++;
      if (st.scoring === 'standard') addScore(st.draw === 1 ? -100 : -20);
    } else {
      for (let i = 0; i < st.draw && st.stock.length; i++) { const c = st.stock.pop(); c.up = true; st.waste.push(c); }
    }
    st.moves++;
    after();
  }

  /** Moves cards from `from` (starting at index) to pile `to` if legal. */
  function move(from, index, to) {
    if (from === to) return false;
    const src = pileOf(from), dst = pileOf(to);
    const cards = src.slice(index);
    if (!cards.length || !cards[0].up) return false;
    if (to.startsWith('f:')) { if (cards.length !== 1 || !canFound(cards[0], dst)) return false; }
    else if (to.startsWith('t:')) { if (!canTab(cards[0], dst)) return false; }
    else return false;
    startClock();
    push();
    src.splice(index);
    dst.push(...cards);
    if (to.startsWith('f:')) addScore(st.scoring === 'vegas' ? 5 : 10);
    else if (from === 'waste') addScore(5);
    else if (from.startsWith('f:')) addScore(st.scoring === 'vegas' ? -5 : -15);
    if (from.startsWith('t:') && src.length && !top(src).up) { top(src).up = true; addScore(5); }
    st.moves++;
    after();
    return true;
  }

  function autoFound(from, index) {
    const src = pileOf(from);
    if (index !== src.length - 1) return false;
    for (let i = 0; i < 4; i++) if (move(from, index, `f:${i}`)) return true;
    return false;
  }

  function after() {
    save();
    render();
    if (st.found.every((f) => f.length === 13)) win_();
    else if (opts.autoFinish !== false && canAutoComplete()) autoComplete();
  }

  const canAutoComplete = () => !st.stock.length && !st.waste.length && st.tableau.every((c) => c.every((x) => x.up)) && !st.won && !autoRunning;
  let autoRunning = false;
  function autoComplete() {
    autoRunning = true;
    const step = () => {
      for (let t = 0; t < 7; t++) { const col = st.tableau[t]; if (col.length && autoFoundQuiet(`t:${t}`)) { render(); return setTimeout(step, 90); } }
      autoRunning = false;
      save();
      if (st.found.every((f) => f.length === 13)) win_();
      return null;
    };
    step();
  }
  function autoFoundQuiet(from) {
    const src = pileOf(from);
    const card = top(src);
    for (let i = 0; i < 4; i++) if (canFound(card, st.found[i])) { src.pop(); st.found[i].push(card); addScore(st.scoring === 'vegas' ? 5 : 10); st.moves++; return true; }
    return false;
  }

  function win_() {
    if (st.won) return;
    st.won = true;
    ctx.clearInterval(timer);
    if (st.scoring === 'standard' && st.time >= 30) addScore(Math.round(700000 / st.time));
    const s = getStats();
    s.won++;
    s.streak = (s.lastWon ? s.streak : 0) + 1;
    s.lastWon = true;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (s.bestTime === null || st.time < s.bestTime) s.bestTime = st.time;
    if (st.scoring !== 'none' && (s.bestScore === null || st.score > s.bestScore)) s.bestScore = st.score;
    saveStats(s);
    store.set('game', null);
    paintBar();
    celebrate();
  }

  function hint() {
    const tryMove = (from, index, to) => {
      const cards = pileOf(from).slice(index);
      if (!cards.length || !cards[0].up) return false;
      return to.startsWith('f:') ? cards.length === 1 && canFound(cards[0], pileOf(to)) : canTab(cards[0], pileOf(to)) && !(cards[0].r === 12 && index === 0 && from.startsWith('t:'));
    };
    const sources = [['waste', st.waste.length - 1], ...st.tableau.map((c, i) => [`t:${i}`, c.findIndex((x) => x.up)])].filter(([, i]) => i >= 0);
    for (const [from, i] of sources) {
      const last = pileOf(from).length - 1;
      for (let f = 0; f < 4; f++) if (tryMove(from, last, `f:${f}`)) return highlight(from, last, `f:${f}`);
      for (let t = 0; t < 7; t++) if (`t:${t}` !== from && tryMove(from, i, `t:${t}`)) return highlight(from, i, `t:${t}`);
    }
    if (st.stock.length || st.waste.length) return highlight('stock', 0, null);
    flashMsg('No moves left. Start a new game or undo.');
    return null;
  }
  function highlight(from, index, to) {
    const els = [...table.querySelectorAll(`[data-pile="${from}"]`)].filter((e) => Number(e.dataset.index) >= index);
    const target = to ? table.querySelector(`.so-slot[data-pile="${to}"]`) : null;
    for (const e of [...els, target].filter(Boolean)) { e.classList.add('hint'); setTimeout(() => e.classList.remove('hint'), 900); }
  }

  // ── Rendering ────────────────────────────────────────────────────────
  let geo = null;
  function layout() {
    const r = table.getBoundingClientRect();
    const w = Math.min((r.width - 16) / 7.5, (r.height - 16) / 4.8, 120);
    const gap = (r.width - w * 7) / 8;
    return { w, h: w * 1.4, gap, top: 12, fan: w * 0.26, fanDown: w * 0.09, x: (i) => gap + i * (w + gap) };
  }
  const cardEls = new Map();
  function cardEl(c) {
    let el = cardEls.get(c.id);
    if (!el) {
      el = h('div.so-card', { dataset: { id: c.id } },
        h('div.so-face', { class: RED.has(c.s) ? 'red' : '' }, h('span.so-tl', RANKS[c.r], h('i', SUITS[c.s])), h('span.so-mid', c.r >= 10 ? ['J', 'Q', 'K'][c.r - 10] : SUITS[c.s]), h('span.so-br', RANKS[c.r], h('i', SUITS[c.s]))),
        h('div.so-back'));
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('dblclick', onDbl);
      cardEls.set(c.id, el);
    }
    return el;
  }

  function render(fresh = false) {
    geo = layout();
    const g = geo;
    table.style.setProperty('--cw', `${g.w}px`);
    table.style.setProperty('--ch', `${g.h}px`);
    const slots = [];
    const place = [];
    const slot = (pile, x, y, label) => slots.push(h('div.so-slot', { dataset: { pile }, style: { left: `${x}px`, top: `${y}px` } }, label));
    slot('stock', g.x(0), g.top, st.stock.length ? '' : '↻');
    slot('waste', g.x(1), g.top, '');
    for (let i = 0; i < 4; i++) slot(`f:${i}`, g.x(3 + i), g.top, h('span', 'A'));
    const rowY = g.top + g.h + g.w * 0.25;
    for (let i = 0; i < 7; i++) slot(`t:${i}`, g.x(i), rowY, h('span', 'K'));
    st.stock.forEach((c, i) => place.push([c, 'stock', i, g.x(0) + Math.min(i, 5) * 0.4, g.top - Math.min(i, 5) * 0.4]));
    const wasteShow = st.draw === 3 ? 3 : 1;
    st.waste.forEach((c, i) => { const k = Math.max(0, i - (st.waste.length - wasteShow)); place.push([c, 'waste', i, g.x(1) + k * g.w * 0.22, g.top]); });
    st.found.forEach((f, fi) => f.forEach((c, i) => place.push([c, `f:${fi}`, i, g.x(3 + fi), g.top])));
    const maxH = table.clientHeight - rowY - g.h - 8;
    st.tableau.forEach((col, ti) => {
      const downs = col.filter((c) => !c.up).length, ups = col.length - downs;
      // Squeeze long columns so they fit.
      const need = downs * g.fanDown + Math.max(0, ups - 1) * g.fan;
      const k = need > maxH && need > 0 ? maxH / need : 1;
      let y = rowY;
      col.forEach((c, i) => { place.push([c, `t:${ti}`, i, g.x(ti), y]); y += (c.up ? g.fan : g.fanDown) * k; });
    });
    mount(table, slots);
    let z = 1;
    for (const [c, pile, i, x, y] of place) {
      const el = cardEl(c);
      el.dataset.pile = pile; el.dataset.index = i;
      el.classList.toggle('up', c.up);
      el.style.zIndex = String(z++);
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.classList.toggle('noanim', fresh);
      table.append(el);
    }
    if (fresh) requestAnimationFrame(() => table.querySelectorAll('.noanim').forEach((e) => e.classList.remove('noanim')));
    paintBar();
  }

  function paintBar() {
    const t = st.time;
    mount(bar,
      h('button.btn.subtle', { type: 'button', onclick: (e) => gameMenu(e.currentTarget) }, 'Game ▾'),
      h('button.btn.subtle', { type: 'button', disabled: !undo.length || st.won, onclick: doUndo, title: 'Undo (Ctrl+Z)' }, '↶ Undo'),
      h('button.btn.subtle', { type: 'button', disabled: st.won, onclick: hint, title: 'Hint (H)' }, '💡︎ Hint'),
      h('div.mp-grow'),
      st.scoring !== 'none' ? h('span.so-stat', `Score ${st.scoring === 'vegas' ? `$${st.score}` : st.score}`) : null,
      h('span.so-stat', `Moves ${st.moves}`),
      h('span.so-stat', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`));
  }

  function doUndo() {
    const prev = undo.pop();
    if (!prev) return;
    st = JSON.parse(prev);
    if (st.scoring === 'standard') st.score = Math.max(0, st.score - 2);
    save();
    render();
  }

  // ── Input ────────────────────────────────────────────────────────────
  let drag = null;
  function onDown(e) {
    if (e.button !== 0 || st.won) return;
    const el = e.currentTarget;
    const pile = el.dataset.pile, index = Number(el.dataset.index);
    if (pile === 'stock') { drawStock(); return; }
    const src = pileOf(pile);
    const card = src[index];
    if (!card?.up) return;
    if (pile === 'waste' && index !== src.length - 1) return;
    if (pile.startsWith('f:') && index !== src.length - 1) return;
    const els = src.slice(index).map((c) => cardEls.get(c.id));
    const r = table.getBoundingClientRect();
    const starts = els.map((x) => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(x.style.transform); return { x: +m[1], y: +m[2] }; });
    drag = { pile, index, els, starts, sx: e.clientX, sy: e.clientY, moved: false, r };
    el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp, { once: true });
  }
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    drag.els.forEach((el, i) => { el.classList.add('dragging', 'noanim'); el.style.zIndex = String(1000 + i); el.style.transform = `translate(${drag.starts[i].x + dx}px, ${drag.starts[i].y + dy}px)`; });
  }
  function onUp(e) {
    const el = e.currentTarget;
    el.removeEventListener('pointermove', onMove);
    const d = drag;
    drag = null;
    if (!d) return;
    d.els.forEach((x) => x.classList.remove('dragging', 'noanim'));
    if (!d.moved) {
      // A single click on the top card sends it to a foundation when possible.
      if (opts.clickToMove && autoFound(d.pile, d.index)) return;
      render();
      return;
    }
    // Drop target: the pile under the centre of the first card.
    const first = d.els[0].getBoundingClientRect();
    const cx = first.left + first.width / 2, cy = first.top + first.height / 3;
    let target = null, best = Infinity;
    const piles = [...[0, 1, 2, 3].map((i) => `f:${i}`), ...[0, 1, 2, 3, 4, 5, 6].map((i) => `t:${i}`)];
    for (const p of piles) {
      const slotEl = table.querySelector(`.so-slot[data-pile="${p}"]`);
      const pile = pileOf(p);
      const topEl = pile.length ? cardEls.get(top(pile).id) : slotEl;
      const rr = topEl.getBoundingClientRect();
      const dist = Math.hypot(rr.left + rr.width / 2 - cx, rr.top + rr.height / 2 - cy);
      const overlaps = cx > rr.left - rr.width * 0.4 && cx < rr.right + rr.width * 0.4 && cy > rr.top - rr.height * 0.5 && cy < rr.bottom + rr.height * 0.6;
      if (overlaps && dist < best) { best = dist; target = p; }
    }
    if (!target || !move(d.pile, d.index, target)) render();
  }
  function onDbl(e) {
    const el = e.currentTarget;
    if (el.dataset.pile === 'stock') return;
    autoFound(el.dataset.pile, Number(el.dataset.index));
  }
  table.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('so-slot') && e.target.dataset.pile === 'stock') drawStock(); });

  // ── Menus, options, statistics ───────────────────────────────────────
  function gameMenu(anchor) {
    showMenu([
      { label: 'New game', hint: 'F2', onSelect: newGame },
      { label: 'Restart this deal', onSelect: restart },
      { separator: true },
      { label: 'Options…', onSelect: options },
      { label: 'Statistics…', onSelect: statistics },
    ], { anchor, align: 'start' });
  }
  async function newGame() {
    if (st.moves && !st.won && !(await confirmDialog('Start a new game?', 'This game counts as a loss.', { ok: 'New game', parent: win.body }))) return;
    if (st.moves && !st.won) { const s = getStats(); s.lastWon = false; s.streak = 0; saveStats(s); }
    ctx.clearInterval(timer);
    deal();
  }
  function restart() {
    if (!undo.length) return;
    st = JSON.parse(undo[0]);
    undo = [];
    st.moves = 0; st.time = 0; st.started = false; st.score = st.scoring === 'vegas' ? -52 : 0;
    ctx.clearInterval(timer);
    save();
    render();
  }
  async function options() {
    const draw = h('select.input', { 'aria-label': 'Draw' }, h('option', { value: 1, selected: opts.draw === 1 }, 'Draw one card'), h('option', { value: 3, selected: opts.draw === 3 }, 'Draw three cards'));
    const scoring = h('select.input', { 'aria-label': 'Scoring' }, [['standard', 'Standard'], ['vegas', 'Vegas'], ['none', 'None']].map(([v, l]) => h('option', { value: v, selected: opts.scoring === v }, l)));
    const click = h('input', { type: 'checkbox', checked: !!opts.clickToMove });
    const auto = h('input', { type: 'checkbox', checked: opts.autoFinish !== false });
    const ok = await dialog({ title: 'Options', parent: win.body, cancelValue: false, body: h('div.cal-form', h('label.ck-field', 'Draw', draw), h('label.ck-field', 'Scoring', scoring),
      h('label.wr-check', click, 'Click a card to move it to the foundation'), h('label.wr-check', auto, 'Finish automatically when every card is face up'), h('p.hint', 'Draw and scoring changes start with your next game.')),
    buttons: [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    opts = { draw: Number(draw.value), scoring: scoring.value, clickToMove: click.checked, autoFinish: auto.checked };
    store.set('options', opts);
  }
  async function statistics() {
    const s = getStats();
    const fmt = (t) => (t === null ? '—' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    const res = await dialog({ title: 'Statistics', parent: win.body, cancelValue: null, body: h('dl.tm-props',
      h('dt', 'Games played'), h('dd', String(s.played)), h('dt', 'Games won'), h('dd', `${s.won} (${s.played ? Math.round((s.won / s.played) * 100) : 0}%)`),
      h('dt', 'Best time'), h('dd', fmt(s.bestTime)), h('dt', 'Best score'), h('dd', s.bestScore === null ? '—' : String(s.bestScore)),
      h('dt', 'Current streak'), h('dd', String(s.lastWon ? s.streak : 0)), h('dt', 'Longest streak'), h('dd', String(s.bestStreak))),
    buttons: [{ label: 'Close', value: null, primary: true }, { label: 'Reset', value: 'reset', danger: true }] });
    if (res === 'reset' && (await confirmDialog('Reset statistics?', 'All your Solitaire statistics are erased.', { ok: 'Reset', danger: true, parent: win.body }))) store.remove('stats');
  }

  function flashMsg(text) {
    const m = h('div.so-msg', text);
    table.append(m);
    setTimeout(() => m.remove(), 2400);
  }

  // Bouncing cards when you win.
  function celebrate() {
    const c = h('canvas.so-win', { width: table.clientWidth, height: table.clientHeight });
    const box = h('div.so-wonbox', h('h2', 'You won!'), h('p', `${st.moves} moves · ${Math.floor(st.time / 60)}:${String(st.time % 60).padStart(2, '0')}${st.scoring !== 'none' ? ` · score ${st.score}` : ''}`),
      h('button.btn.primary', { type: 'button', onclick: () => { c.remove(); box.remove(); deal(); } }, 'Play again'));
    table.append(c, box);
    const g = c.getContext('2d');
    const imgs = st.found.map((f) => f.map((card) => cardEls.get(card.id)));
    const W = geo.w, H = geo.h;
    let pile = 0, rank = 12;
    const parts = [];
    const shot = () => {
      if (!c.isConnected) return;
      if (rank >= 0) {
        const el = imgs[pile][rank];
        const r = el.getBoundingClientRect(), tr = table.getBoundingClientRect();
        parts.push({ x: r.left - tr.left, y: r.top - tr.top, vx: (Math.random() * 6 + 2) * (Math.random() < 0.5 ? -1 : 1), vy: -Math.random() * 8, s: st.found[pile][rank].s, r: st.found[pile][rank].r });
        el.style.visibility = 'hidden';
        pile = (pile + 1) % 4; if (pile === 0) rank--;
      }
    };
    let t = 0;
    const loop = () => {
      if (!c.isConnected) { table.querySelectorAll('.so-card').forEach((e) => { e.style.visibility = ''; }); return; }
      if (t++ % 6 === 0) shot();
      for (const p of parts) {
        p.vy += 0.5; p.x += p.vx; p.y += p.vy;
        if (p.y + H > c.height) { p.y = c.height - H; p.vy *= -0.75; }
        g.fillStyle = '#fff'; g.strokeStyle = '#888';
        g.beginPath(); g.roundRect(p.x, p.y, W, H, 6); g.fill(); g.stroke();
        g.fillStyle = RED.has(p.s) ? '#d32f2f' : '#111'; g.font = `600 ${W * 0.28}px system-ui`;
        g.fillText(`${RANKS[p.r]}${SUITS[p.s]}`, p.x + 6, p.y + W * 0.3);
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  ctx.listen(win.body, 'keydown', (e) => {
    if (win.body.querySelector('.dlg')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
    else if (e.key === 'F2' || (ctrl && e.key.toLowerCase() === 'n')) { e.preventDefault(); newGame(); }
    else if (e.key.toLowerCase() === 'h' && !ctrl) hint();
    else if ((e.key === ' ' || e.key.toLowerCase() === 'd') && !ctrl) { e.preventDefault(); if (!st.won) drawStock(); }
  });
  win.on('resize', () => render(true));
  ctx.onExit(() => save());

  const saved = store.get('game', null);
  if (saved && saved.tableau) { st = saved; st.started = false; render(true); if (st.moves) startClock(); }
  else deal();
}
