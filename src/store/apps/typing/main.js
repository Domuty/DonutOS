// Typing Test — timed passages, live WPM and accuracy, history.
import { h, mount, css } from '@donut/sdk';

const PASSAGES = [
  'The quick brown fox jumps over the lazy dog while the sun sets slowly behind the quiet hills.',
  'A good habit is easier to keep than to start, so begin with something small and do it every day.',
  'Fresh bread from the corner bakery filled the street with a warm smell that made everyone slow down.',
  'Rivers do not hurry, yet they carve canyons; patience and steady effort can move almost anything.',
  'When the power went out, the family gathered around a single candle and told stories until midnight.',
  'Learning to type well is like learning an instrument: accuracy first, and the speed follows on its own.',
  'The library was silent except for the soft turning of pages and the distant ticking of an old clock.',
  'She packed a map, a flask of tea and a notebook, then set off to find the waterfall from the postcard.',
  'Every winter the lake froze so thick that the whole town came out to skate under the bright stars.',
  'Good software feels invisible: you stop thinking about the tool and start thinking about your work.',
  'The market opened at dawn, and by seven the stalls were bright with oranges, peppers and spring flowers.',
  'He planted an apple tree for his granddaughter, knowing he would never see it bear its first fruit.',
];

css(`
.ty { height: 100%; overflow: auto; padding: 20px 26px; display: grid; gap: 16px; align-content: start; }
.ty-text { font: 22px/1.7 var(--font-mono); padding: 18px 20px; border-radius: 12px; background: var(--surface-2); cursor: text; outline: none; min-height: 130px; }
.ty-text:focus { box-shadow: 0 0 0 2px var(--accent); }
.ty-text span.ok { color: var(--text); } .ty-text span.bad { color: var(--danger); background: color-mix(in srgb, var(--danger) 18%, transparent); border-radius: 2px; }
.ty-text span.todo { color: var(--text-3); } .ty-text span.cur { border-left: 2px solid var(--accent); margin-left: -2px; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { border-color: transparent; } }
.ty-stats { display: flex; gap: 12px; flex-wrap: wrap; } .ty-stat { padding: 10px 16px; border-radius: 10px; background: var(--surface-2); min-width: 110px; } .ty-stat b { font: 600 26px var(--font-display); display: block; }
.ty-hist { display: flex; align-items: flex-end; gap: 4px; height: 90px; padding: 6px; border-radius: 10px; background: var(--surface-2); }
.ty-hist i { flex: 1; background: var(--accent); border-radius: 3px 3px 0 0; min-width: 6px; }
`);

export default function main(app) {
  let length = app.storage.get('length', 30);
  let history = app.storage.get('history', []);
  let target = '', typed = '', started = 0, timer = null, finished = false, errors = 0;
  const textEl = h('div.ty-text', { tabindex: '0', 'aria-label': 'Type the passage', role: 'textbox' });
  const stats = h('div.ty-stats');
  const hist = h('div');
  const lengthSel = h('select.input', { style: { width: '140px' }, 'aria-label': 'Test length', onchange: (e) => { length = Number(e.target.value); app.storage.set('length', length); reset(); } }, [15, 30, 60].map((s) => h('option', { value: s, selected: s === length }, `${s} seconds`)));
  mount(app.root, h('div.ty', h('div.row', h('h1.grow', 'Typing Test'), lengthSel, h('button.btn.primary', { type: 'button', onclick: reset }, 'New test')),
    h('small.muted', 'Click the passage (or just start typing). The clock starts with your first key.'), textEl, stats, h('h3', 'Your progress'), hist));

  function nextPassage() { let t = ''; while (t.length < length * 7) t += `${PASSAGES[Math.floor(Math.random() * PASSAGES.length)]} `; return t.trim(); }
  function reset() { clearInterval(timer); target = nextPassage(); typed = ''; started = 0; finished = false; errors = 0; render(); textEl.focus(); }
  const elapsed = () => (started ? Math.min(length, (Date.now() - started) / 1000) : 0);
  function metrics() {
    const correct = [...typed].filter((c, i) => c === target[i]).length;
    const mins = Math.max(elapsed(), 1) / 60;
    return { wpm: Math.round(correct / 5 / mins), acc: typed.length ? Math.round(((typed.length - errors) / typed.length) * 100) : 100, left: Math.ceil(length - elapsed()) };
  }
  function render() {
    const spans = [];
    const show = Math.min(target.length, Math.max(typed.length + 120, 200));
    for (let i = 0; i < show; i++) spans.push(h('span', { class: i < typed.length ? (typed[i] === target[i] ? 'ok' : 'bad') : i === typed.length ? 'cur todo' : 'todo' }, target[i]));
    mount(textEl, spans);
    const m = metrics();
    mount(stats, h('div.ty-stat', h('small', 'Words per minute'), h('b', String(started ? m.wpm : 0))), h('div.ty-stat', h('small', 'Accuracy'), h('b', `${m.acc}%`)),
      h('div.ty-stat', h('small', 'Time left'), h('b', `${finished ? 0 : m.left}s`)), finished ? h('div.ty-stat', h('small', 'Best'), h('b', String(Math.max(0, ...history.map((x) => x.wpm))))) : null);
    const recent = history.slice(-30), top = Math.max(40, ...recent.map((x) => x.wpm));
    mount(hist, recent.length ? h('div.ty-hist', recent.map((x) => h('i', { style: { height: `${(x.wpm / top) * 100}%` }, title: `${x.wpm} WPM · ${x.acc}% · ${new Date(x.time).toLocaleDateString()}` })))
      : h('small.hint', 'Finish a test to see your progress here.'));
  }
  function finish() {
    finished = true; clearInterval(timer);
    const m = metrics();
    history = [...history, { wpm: m.wpm, acc: m.acc, length, time: Date.now() }].slice(-200);
    app.storage.set('history', history);
    render();
  }
  addEventListener('keydown', (e) => {
    if (e.target.matches?.('select, button') || e.ctrlKey || e.metaKey || e.altKey || finished) return;
    if (e.key === 'Backspace') { e.preventDefault(); typed = typed.slice(0, -1); render(); return; }
    if (e.key.length !== 1) return;
    e.preventDefault();
    if (!started) { started = Date.now(); timer = setInterval(() => { if (elapsed() >= length) finish(); else render(); }, 200); }
    if (e.key !== target[typed.length]) errors++;
    typed += e.key;
    if (typed.length >= target.length) finish(); else render();
  });
  reset();
}
