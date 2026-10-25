// Calculator: Standard, Scientific, Programmer, Date calculation and unit converters, with
// history and memory that persist between sessions. Full keyboard support.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { CalcError, apply, evaluate, clean, format, formatEntry, factorial, WORDS, wrap, progApply, toBase, CONVERTERS, convert } from './engine.js';

const MODES = [['standard', 'Standard'], ['scientific', 'Scientific'], ['programmer', 'Programmer'], ['date', 'Date calculation']];
const SYM = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^', mod: 'mod', and: 'AND', or: 'OR', xor: 'XOR', nand: 'NAND', nor: 'NOR', lsh: '<<', rsh: '>>' };
const MAX_DIGITS = 16;

export default function main(ctx) {
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'Calculator', width: 400, height: 620, minWidth: 320, minHeight: 480 });
  win.body.classList.add('calculator');

  let mode = store.get('mode', 'standard');
  if (!MODES.some(([m]) => m === mode) && !CONVERTERS[mode]) mode = 'standard';
  let history = store.get('history', []);
  let memory = store.get('memory', []);
  let panel = 'history';
  let degrees = store.get('degrees', true);
  let second = false;
  let fe = false;

  const navEl = h('nav.calc-nav', { hidden: true, 'aria-label': 'Calculator modes' });
  const head = h('header.calc-head');
  const main = h('div.calc-main');
  const side = h('aside.calc-side');
  mount(win.body, head, h('div.calc-wrap', main, side), navEl);

  // ── Shared state for the arithmetic modes ────────────────────────────
  // items: committed tokens ({ num, label } | { op } | '(' | ')'); cur: the operand being typed/shown.
  let items = [];
  let cur = { text: '0', typing: true };
  let error = null;
  let last = null;           // { op, value } for repeated "="
  let justEvaluated = false;
  let parens = 0;
  // Programmer
  let base = store.get('base', 10);
  let word = store.get('word', 'QWORD');

  const bits = () => WORDS[word];
  const curValue = () => {
    if (mode === 'programmer') return cur.big ?? parseBig(cur.text);
    return cur.value ?? Number(cur.text);
  };
  const parseBig = (t) => {
    const s = t.replace(/\s/g, '') || '0';
    const neg = s.startsWith('-');
    const body = neg ? s.slice(1) : s;
    let v = 0n;
    for (const ch of body) v = v * BigInt(base) + BigInt(parseInt(ch, 16));
    return wrap(neg ? -v : v, bits());
  };

  function reset() { items = []; cur = { text: '0', typing: true }; error = null; parens = 0; justEvaluated = false; }
  function fail(err) { error = err instanceof CalcError ? err.message : 'Invalid input'; items = []; parens = 0; }

  // ── Input actions ────────────────────────────────────────────────────
  function digit(d) {
    if (error) reset();
    if (!cur.typing || justEvaluated) { if (justEvaluated) { items = []; } cur = { text: '0', typing: true }; justEvaluated = false; }
    const raw = cur.text;
    if (d === '.') { if (mode === 'programmer' || raw.includes('.')) return; cur.text = `${raw}.`; render(); return; }
    if (mode === 'programmer') {
      if (parseInt(d, 16) >= base) return;
      const next = raw === '0' ? d : raw + d;
      const v = parseBigRaw(next);
      if (v === null) return;
      cur.text = next;
    } else {
      if (raw.replace(/[-.]/g, '').length >= MAX_DIGITS) return;
      cur.text = raw === '0' ? d : raw === '-0' ? `-${d}` : raw + d;
    }
    delete cur.value; delete cur.big;
    render();
  }
  // In programmer mode digits are refused once they no longer fit the word size.
  const parseBigRaw = (t) => {
    let v = 0n;
    for (const ch of t) v = v * BigInt(base) + BigInt(parseInt(ch, 16));
    return v >= (1n << bits()) ? null : v;
  };

  function commitOperand() {
    if (mode === 'programmer') { const v = curValue(); items.push({ num: v, label: toBase(v, base, bits()) }); }
    else { const v = curValue(); items.push({ num: v, label: cur.label || format(v, { group: false }) }); }
  }
  const lastItem = () => items[items.length - 1];
  const needsOperand = () => !lastItem() || lastItem().op || lastItem() === '(';

  // Commits what's on the display as the next operand, unless the display is only showing a
  // running total after an operator or a closing parenthesis.
  function commitIfNeeded() {
    if (cur.pending && lastItem() === ')') return;
    commitOperand();
  }

  function operator(op) {
    if (error) return;
    justEvaluated = false;
    if (cur.pending && lastItem()?.op) { lastItem().op = op; render(); return; }
    commitIfNeeded();
    items.push({ op });
    try {
      const v = mode === 'standard' ? evalItems(items.slice(0, -1)) : evalItems(trimForPreview(items.slice(0, -1)));
      cur = { ...displayFor(v), typing: false, pending: true };
    } catch (err) {
      if (mode === 'standard') fail(err); else cur = { ...cur, typing: false, pending: true };
    }
    render();
  }
  const displayFor = (v) => (mode === 'programmer' ? { text: toBase(v, base, bits()), big: v } : { text: format(v, { group: false }), value: v });
  // Close open parentheses so a running total can be shown.
  const trimForPreview = (list) => { const l = [...list]; let open = 0; for (const t of l) { if (t === '(') open++; if (t === ')') open--; } while (open-- > 0) l.push(')'); return l; };

  function evalItems(list) {
    if (mode === 'standard') {
      let acc = null, op = null;
      for (const t of list) {
        if (t.op) op = t.op;
        else if (t.num !== undefined) acc = acc === null ? t.num : apply(op, acc, t.num);
      }
      return acc ?? 0;
    }
    if (mode === 'programmer') return evalBig(list);
    return evaluate(list.map((t) => (t.num !== undefined ? t.num : t.op ? t.op : t)), { degrees });
  }

  function evalBig(list) {
    const prec = { or: 1, nor: 1, xor: 2, and: 3, nand: 3, lsh: 4, rsh: 4, '+': 5, '-': 5, '*': 6, '/': 6, mod: 6 };
    let i = 0;
    const toks = list.map((t) => (t.num !== undefined ? t.num : t.op ? t.op : t));
    const prim = () => {
      const t = toks[i++];
      if (typeof t === 'bigint') return t;
      if (t === '(') { const v = ex(0); if (toks[i] === ')') i++; return v; }
      throw new CalcError('Incomplete expression');
    };
    const ex = (min) => {
      let l = prim();
      for (;;) {
        const op = toks[i];
        const p = prec[op];
        if (p === undefined || p < min) break;
        i++;
        l = progApply(op, l, ex(p + 1), bits());
      }
      return l;
    };
    return ex(0);
  }

  function equals() {
    if (error) { reset(); render(); return; }
    try {
      if (justEvaluated && last) {
        const a = curValue();
        const list = [{ num: a, label: labelOf(a) }, { op: last.op }, { num: last.value, label: labelOf(last.value) }];
        const v = evalItems(list);
        pushHistory(list, v);
        cur = { ...displayFor(v), typing: false };
        render();
        return;
      }
      commitIfNeeded();
      while (parens > 0) { items.push(')'); parens--; }
      const list = items;
      const v = evalItems(list);
      const ops = list.filter((t) => t.op);
      const lastOp = ops[ops.length - 1];
      const lastNum = [...list].reverse().find((t) => t.num !== undefined);
      last = lastOp ? { op: lastOp.op, value: lastNum.num } : null;
      pushHistory(list, v);
      items = [];
      cur = { ...displayFor(v), typing: false };
      justEvaluated = true;
    } catch (err) { fail(err); }
    render();
  }
  const labelOf = (v) => (mode === 'programmer' ? toBase(v, base, bits()) : format(v, { group: false }));

  function pushHistory(list, v) {
    const expr = list.map((t) => (t.num !== undefined ? t.label : t.op ? SYM[t.op] : t)).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    history = [{ mode, expr: `${expr} =`, result: mode === 'programmer' ? toBase(v, base, bits()) : format(v), value: mode === 'programmer' ? v.toString() : v, base }, ...history].slice(0, 60);
    store.set('history', history);
    if (panel === 'history') renderSide();
  }

  /** Applies a function to the current operand immediately (sqr(5) shows 25). */
  function unaryFn(fn, labelFn) {
    if (error) return;
    try {
      const x = curValue();
      const v = clean(fn(x));
      if (!Number.isFinite(v)) throw new CalcError(Number.isNaN(v) ? 'Invalid input' : 'Overflow');
      const label = labelFn(cur.label || format(x, { group: false }));
      if (justEvaluated) { items = []; justEvaluated = false; }
      cur = { text: format(v, { group: false }), value: v, label, typing: false, fresh: true };
    } catch (err) { fail(err); }
    render();
  }

  function percent() {
    if (error) return;
    const x = curValue();
    const opItem = lastItem();
    let v;
    if (mode === 'standard' && opItem?.op && (opItem.op === '+' || opItem.op === '-')) v = evalItems(items.slice(0, -1)) * (x / 100);
    else if (opItem?.op) v = x / 100;
    else v = mode === 'standard' ? 0 : x / 100;
    cur = { text: format(clean(v), { group: false }), value: clean(v), typing: false, fresh: true };
    render();
  }

  function negate() {
    if (error) return;
    if (mode === 'programmer') { const v = wrap(-curValue(), bits()); cur = { text: toBase(v, base, bits()), big: v, typing: false, fresh: true }; render(); return; }
    if (cur.typing && !justEvaluated) { cur.text = cur.text.startsWith('-') ? cur.text.slice(1) : cur.text === '0' ? '0' : `-${cur.text}`; delete cur.value; }
    else unaryFn((x) => -x, (l) => `negate(${l})`);
    render();
  }

  function backspace() {
    if (error) { reset(); render(); return; }
    if (!cur.typing || justEvaluated) { if (justEvaluated) { items = []; justEvaluated = false; } return render(); }
    cur.text = cur.text.length > 1 && cur.text !== '-0' ? cur.text.slice(0, -1) : '0';
    if (cur.text === '-') cur.text = '0';
    delete cur.value; delete cur.big;
    render();
  }
  function clearEntry() { if (error) reset(); else cur = { text: '0', typing: true }; render(); }
  function clearAll() { reset(); render(); }

  function paren(open) {
    if (error) reset();
    if (open) {
      if (justEvaluated) { items = []; justEvaluated = false; }
      else if (!needsOperand()) items.push({ op: '*' });                                  // 2(3) and (1)(2)
      else if (!cur.pending && !(cur.typing && cur.text === '0')) { commitOperand(); items.push({ op: '*' }); }
      items.push('('); parens++;
      cur = { text: '0', typing: true };
    } else {
      if (parens <= 0) return;
      commitIfNeeded();
      items.push(')'); parens--;
      try { cur = { ...displayFor(evalItems(sub())), typing: false, pending: true }; } catch { cur = { ...cur, typing: false, pending: true }; }
    }
    render();
  }
  // Value of the innermost group that was just closed (for the display).
  function sub() {
    let depth = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i] === ')') depth++;
      if (items[i] === '(') { depth--; if (depth === 0) return items.slice(i); }
    }
    return items;
  }

  // ── Memory ───────────────────────────────────────────────────────────
  const saveMem = () => { store.set('memory', memory); if (panel === 'memory') renderSide(); render(); };
  const memVal = () => (mode === 'programmer' ? Number(curValue()) : curValue());
  const mem = {
    MC: () => { memory = []; saveMem(); },
    MR: () => { if (!memory.length) return; const v = memory[0]; cur = mode === 'programmer' ? { text: toBase(BigInt(Math.trunc(v)), base, bits()), big: wrap(BigInt(Math.trunc(v)), bits()), typing: false, fresh: true } : { text: format(v, { group: false }), value: v, typing: false, fresh: true }; render(); },
    'M+': () => { if (!memory.length) memory.unshift(0); memory[0] = clean(memory[0] + memVal()); saveMem(); },
    'M-': () => { if (!memory.length) memory.unshift(0); memory[0] = clean(memory[0] - memVal()); saveMem(); },
    MS: () => { memory.unshift(memVal()); memory = memory.slice(0, 30); saveMem(); },
  };

  // ── Rendering ────────────────────────────────────────────────────────
  function setMode(m) {
    mode = m;
    store.set('mode', m);
    reset();
    last = null;
    navEl.hidden = true;
    win.body.dataset.mode = m;
    renderAll();
  }

  function renderAll() {
    const title = MODES.find(([id]) => id === mode)?.[1] || mode;
    mount(head,
      h('button.tb-btn.calc-menu', { type: 'button', 'aria-label': 'Open navigation', 'aria-expanded': String(!navEl.hidden), onclick: () => { navEl.hidden = !navEl.hidden; renderNav(); } }, h('span.calc-burger', h('i'), h('i'), h('i'))),
      h('h1.calc-title', title),
      ['standard', 'scientific', 'programmer'].includes(mode) ? h('button.tb-btn.calc-histbtn', { type: 'button', 'aria-label': 'History and memory', title: 'History (Ctrl+H)', onclick: () => win.body.classList.toggle('side-open') }, icon('restart', { size: 16 })) : null);
    if (CONVERTERS[mode]) renderConverter();
    else if (mode === 'date') renderDate();
    else renderPad();
    renderSide();
  }

  function renderNav() {
    mount(navEl,
      h('div.calc-nav-head', 'Calculator'),
      MODES.map(([id, label]) => h('button.calc-nav-item', { type: 'button', 'aria-current': mode === id ? 'page' : undefined, onclick: () => setMode(id) }, label)),
      h('div.calc-nav-head', 'Converter'),
      Object.keys(CONVERTERS).map((c) => h('button.calc-nav-item', { type: 'button', 'aria-current': mode === c ? 'page' : undefined, onclick: () => setMode(c) }, c)));
    navEl.querySelector('[aria-current]')?.focus();
  }

  let exprEl, displayEl, progEl;
  function renderPad() {
    exprEl = h('div.calc-expr', { 'aria-live': 'polite' });
    displayEl = h('div.calc-display', { role: 'status', 'aria-live': 'polite' });
    const b = (label, fn, cls = '', aria) => h(`button.calc-key${cls}`, { type: 'button', onclick: fn, 'aria-label': aria || label }, label);
    const num = (d) => b(d, () => digit(d), '.num');
    const op = (o) => b(SYM[o], () => operator(o), '.op', { '+': 'Plus', '-': 'Minus', '*': 'Multiply by', '/': 'Divide by', '^': 'To the power of', mod: 'Modulo' }[o] || SYM[o]);
    const memRow = h('div.calc-mem', ['MC', 'MR', 'M+', 'M-', 'MS'].map((m) => h('button.calc-memkey', { type: 'button', disabled: (m === 'MC' || m === 'MR') && !memory.length, onclick: () => mem[m](), 'aria-label': { MC: 'Clear all memory', MR: 'Memory recall', 'M+': 'Memory add', 'M-': 'Memory subtract', MS: 'Memory store' }[m] }, m.replace('-', '−'))),
      h('button.calc-memkey', { type: 'button', onclick: () => { panel = 'memory'; win.body.classList.add('side-open'); renderSide(); }, 'aria-label': 'Open memory' }, 'M˅'));
    let keys;
    if (mode === 'standard') {
      keys = [b('%', percent, '.fn', 'Percent'), b('CE', clearEntry, '.fn', 'Clear entry'), b('C', clearAll, '.fn', 'Clear'), b('⌫', backspace, '.fn', 'Backspace'),
        b('¹⁄ₓ', () => unaryFn((x) => { if (x === 0) throw new CalcError('Cannot divide by zero'); return 1 / x; }, (l) => `1/(${l})`), '.fn', 'Reciprocal'),
        b('x²', () => unaryFn((x) => x * x, (l) => `sqr(${l})`), '.fn', 'Square'), b('²√x', () => unaryFn((x) => { if (x < 0) throw new CalcError('Invalid input'); return Math.sqrt(x); }, (l) => `√(${l})`), '.fn', 'Square root'), op('/'),
        num('7'), num('8'), num('9'), op('*'), num('4'), num('5'), num('6'), op('-'), num('1'), num('2'), num('3'), op('+'),
        b('+/−', negate, '.num', 'Positive negative'), num('0'), b('.', () => digit('.'), '.num', 'Decimal separator'), b('=', equals, '.eq', 'Equals')];
    } else if (mode === 'scientific') {
      const trig = (name, inv) => b(second ? `${name}⁻¹` : name, () => unaryFn((x) => (second ? FN[inv](x) : FN[name](x)), (l) => `${second ? inv : name}${degrees ? '₀' : 'ᵣ'}(${l})`), '.fn');
      const FN = {
        sin: (x) => Math.sin(degrees ? (x * Math.PI) / 180 : x), cos: (x) => Math.cos(degrees ? (x * Math.PI) / 180 : x),
        tan: (x) => { if (degrees && Math.abs(x % 180) === 90) throw new CalcError('Invalid input'); return Math.tan(degrees ? (x * Math.PI) / 180 : x); },
        asin: (x) => { if (Math.abs(x) > 1) throw new CalcError('Invalid input'); return degrees ? (Math.asin(x) * 180) / Math.PI : Math.asin(x); },
        acos: (x) => { if (Math.abs(x) > 1) throw new CalcError('Invalid input'); return degrees ? (Math.acos(x) * 180) / Math.PI : Math.acos(x); },
        atan: (x) => (degrees ? (Math.atan(x) * 180) / Math.PI : Math.atan(x)),
      };
      const constant = (label, v) => b(label, () => { if (justEvaluated) { items = []; justEvaluated = false; } cur = { text: format(v, { group: false }), value: v, label, typing: false, fresh: true }; render(); }, '.fn');
      keys = [
        h('button.calc-key.fn.small', { type: 'button', 'aria-pressed': String(second), onclick: () => { second = !second; renderPad(); } }, '2ⁿᵈ'),
        h('button.calc-key.fn.small', { type: 'button', onclick: () => { degrees = !degrees; store.set('degrees', degrees); renderPad(); }, title: 'Angle unit' }, degrees ? 'DEG' : 'RAD'),
        h('button.calc-key.fn.small', { type: 'button', 'aria-pressed': String(fe), onclick: () => { fe = !fe; render(); }, title: 'Scientific notation' }, 'F-E'),
        b('C', clearAll, '.fn', 'Clear'), b('⌫', backspace, '.fn', 'Backspace'),
        constant('π', Math.PI), constant('e', Math.E), trig('sin', 'asin'), trig('cos', 'acos'), trig('tan', 'atan'),
        second ? b('x³', () => unaryFn((x) => x ** 3, (l) => `cube(${l})`), '.fn', 'Cube') : b('x²', () => unaryFn((x) => x * x, (l) => `sqr(${l})`), '.fn', 'Square'),
        b('¹⁄ₓ', () => unaryFn((x) => { if (x === 0) throw new CalcError('Cannot divide by zero'); return 1 / x; }, (l) => `1/(${l})`), '.fn', 'Reciprocal'),
        b('|x|', () => unaryFn(Math.abs, (l) => `abs(${l})`), '.fn', 'Absolute value'),
        b('exp', () => unaryFn(Math.exp, (l) => `e^(${l})`), '.fn', 'e to the power of'), op('mod'),
        second ? b('∛x', () => unaryFn(Math.cbrt, (l) => `cuberoot(${l})`), '.fn', 'Cube root') : b('²√x', () => unaryFn((x) => { if (x < 0) throw new CalcError('Invalid input'); return Math.sqrt(x); }, (l) => `√(${l})`), '.fn', 'Square root'),
        b('(', () => paren(true), '.fn', 'Open parenthesis'), b(')', () => paren(false), '.fn', 'Close parenthesis'), b('n!', () => unaryFn(factorial, (l) => `fact(${l})`), '.fn', 'Factorial'), op('/'),
        op('^'), num('7'), num('8'), num('9'), op('*'),
        second ? b('2ˣ', () => unaryFn((x) => 2 ** x, (l) => `2^(${l})`), '.fn', 'Two to the power of') : b('10ˣ', () => unaryFn((x) => 10 ** x, (l) => `10^(${l})`), '.fn', 'Ten to the power of'),
        num('4'), num('5'), num('6'), op('-'),
        b('log', () => unaryFn((x) => { if (x <= 0) throw new CalcError('Invalid input'); return Math.log10(x); }, (l) => `log(${l})`), '.fn', 'Log'),
        num('1'), num('2'), num('3'), op('+'),
        b('ln', () => unaryFn((x) => { if (x <= 0) throw new CalcError('Invalid input'); return Math.log(x); }, (l) => `ln(${l})`), '.fn', 'Natural log'),
        b('+/−', negate, '.num', 'Positive negative'), num('0'), b('.', () => digit('.'), '.num', 'Decimal separator'), b('=', equals, '.eq', 'Equals')];
    } else {
      progEl = h('div.calc-bases');
      const hex = 'ABCDEF'.split('').map((d) => b(d, () => digit(d), '.num', `Hex ${d}`));
      keys = [
        b('A', () => digit('A'), '.num'), b('<<', () => operator('lsh'), '.op', 'Left shift'), b('>>', () => operator('rsh'), '.op', 'Right shift'), b('C', clearAll, '.fn', 'Clear'), b('⌫', backspace, '.fn', 'Backspace'),
        b('B', () => digit('B'), '.num'), b('(', () => paren(true), '.fn'), b(')', () => paren(false), '.fn'), b('%', () => operator('mod'), '.op', 'Modulo'), op('/'),
        b('C', () => digit('C'), '.num', 'Hex C'), num('7'), num('8'), num('9'), op('*'),
        b('D', () => digit('D'), '.num'), num('4'), num('5'), num('6'), op('-'),
        b('E', () => digit('E'), '.num'), num('1'), num('2'), num('3'), op('+'),
        b('F', () => digit('F'), '.num'), b('+/−', negate, '.num', 'Positive negative'), num('0'), b('.', () => {}, '.num.disabled', 'Decimal separator (not used)'), b('=', equals, '.eq', 'Equals')];
      void hex;
      const bit = h('div.calc-bitops',
        ['and', 'or', 'not', 'nand', 'nor', 'xor'].map((o) => h('button.calc-memkey', { type: 'button', onclick: () => (o === 'not' ? notOp() : operator(o)) }, o.toUpperCase())),
        h('select.input.calc-word', { 'aria-label': 'Word size', onchange: (e) => { word = e.target.value; store.set('word', word); const v = wrap(curValue(), bits()); cur = { text: toBase(v, base, bits()), big: v, typing: false }; render(); } },
          Object.keys(WORDS).map((w) => h('option', { value: w, selected: w === word }, w))));
      mount(main, exprEl, displayEl, progEl, bit, h('div.calc-keys.cols5', keys));
      render();
      return;
    }
    mount(main, exprEl, displayEl, mode === 'standard' || mode === 'scientific' ? memRow : null, h(`div.calc-keys${mode === 'scientific' ? '.cols5' : ''}`, keys));
    render();
  }

  function notOp() {
    const v = wrap(~curValue(), bits());
    cur = { text: toBase(v, base, bits()), big: v, typing: false, fresh: true, label: `NOT(${toBase(curValue(), base, bits())})` };
    render();
  }

  function render() {
    if (!displayEl) return;
    const expr = items.map((t) => (t.num !== undefined ? t.label : t.op ? SYM[t.op] : t)).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    exprEl.textContent = error ? '' : justEvaluated && history[0] ? history[0].expr : expr + (cur.fresh && cur.label && !justEvaluated ? ` ${cur.label}` : '');
    let text;
    if (error) text = error;
    else if (mode === 'programmer') text = cur.typing ? groupProg(cur.text) : cur.text;
    else if (cur.typing) text = formatEntry(cur.text);
    else text = fe ? curValue().toExponential(Math.min(15, Math.max(0, String(clean(curValue())).replace(/^-|\.|e.*$/g, '').length - 1))) : format(curValue());
    displayEl.textContent = text;
    displayEl.classList.toggle('error', !!error);
    displayEl.style.fontSize = text.length > 22 ? '24px' : text.length > 16 ? '32px' : text.length > 12 ? '40px' : '';
    win.body.querySelectorAll('.calc-key').forEach((k) => { if (!k.classList.contains('eq') && !['C', '⌫', 'CE'].includes(k.textContent)) k.disabled = !!error && !k.classList.contains('num'); });
    if (mode === 'programmer' && progEl) {
      let v;
      try { v = error ? 0n : curValue(); } catch { v = 0n; }
      mount(progEl, [[16, 'HEX'], [10, 'DEC'], [8, 'OCT'], [2, 'BIN']].map(([bs, label]) => h('button.calc-base', { type: 'button', 'aria-pressed': String(base === bs), onclick: () => setBase(bs) },
        h('b', label), h('span', toBase(v, bs, bits())))));
      win.body.querySelectorAll('.calc-key.num').forEach((k) => {
        const d = k.textContent;
        if (/^[0-9A-F]$/.test(d)) k.disabled = parseInt(d, 16) >= base;
      });
    }
    win.body.querySelectorAll('.calc-memkey').forEach((k) => { if (k.textContent === 'MC' || k.textContent === 'MR') k.disabled = !memory.length; });
  }
  const groupProg = (t) => (base === 10 ? t.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : t.replace(new RegExp(`\\B(?=(.{${base === 8 ? 3 : 4}})+(?!.))`, 'g'), ' '));

  function setBase(bs) {
    const v = curValue();
    base = bs;
    store.set('base', bs);
    cur = { text: toBase(v, base, bits()), big: v, typing: false };
    items = items.map((t) => (t.num !== undefined ? { ...t, label: toBase(t.num, base, bits()) } : t));
    render();
  }

  // ── History & memory panel ───────────────────────────────────────────
  function renderSide() {
    if (!['standard', 'scientific', 'programmer'].includes(mode)) { mount(side); win.body.classList.add('no-side'); return; }
    win.body.classList.remove('no-side');
    const list = panel === 'history' ? history.filter((x) => x.mode === mode) : memory;
    mount(side,
      h('div.calc-side-tabs', { role: 'tablist' },
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(panel === 'history'), onclick: () => { panel = 'history'; renderSide(); } }, 'History'),
        mode !== 'programmer' ? h('button', { type: 'button', role: 'tab', 'aria-selected': String(panel === 'memory'), onclick: () => { panel = 'memory'; renderSide(); } }, 'Memory') : null,
        h('button.tb-btn.calc-side-close', { type: 'button', 'aria-label': 'Close panel', onclick: () => win.body.classList.remove('side-open') }, icon('close', { size: 14 }))),
      h('div.calc-side-list', list.length ? (panel === 'history'
        ? list.map((x) => h('button.calc-hist', { type: 'button', onclick: () => { recall(x); win.body.classList.remove('side-open'); } }, h('small', x.expr), h('b', x.result)))
        : memory.map((v, i) => h('div.calc-memitem', h('b', format(v)), h('div.calc-memacts',
          h('button.calc-memkey', { type: 'button', onclick: () => { memory.splice(i, 1); saveMem(); } }, 'MC'),
          h('button.calc-memkey', { type: 'button', onclick: () => { memory[i] = clean(memory[i] + memVal()); saveMem(); } }, 'M+'),
          h('button.calc-memkey', { type: 'button', onclick: () => { memory[i] = clean(memory[i] - memVal()); saveMem(); } }, 'M−')))))
        : h('p.calc-empty', panel === 'history' ? 'There’s no history yet.' : 'There’s nothing saved in memory.')),
      list.length ? h('button.tb-btn.calc-trash', { type: 'button', 'aria-label': panel === 'history' ? 'Clear history' : 'Clear memory', title: 'Clear', onclick: () => {
        if (panel === 'history') { history = history.filter((x) => x.mode !== mode); store.set('history', history); renderSide(); } else mem.MC();
      } }, icon('trash', { size: 16 })) : null);
  }

  function recall(x) {
    reset();
    if (mode === 'programmer') { const v = wrap(BigInt(x.value), bits()); cur = { text: toBase(v, base, bits()), big: v, typing: false }; }
    else cur = { text: format(x.value, { group: false }), value: x.value, typing: false };
    justEvaluated = false;
    render();
  }

  // ── Date calculation ─────────────────────────────────────────────────
  function renderDate() {
    const today = new Date().toISOString().slice(0, 10);
    let kind = 'diff';
    const out = h('div.calc-date-out', { 'aria-live': 'polite' });
    const from = h('input.input', { type: 'date', value: today, 'aria-label': 'From' });
    const to = h('input.input', { type: 'date', value: today, 'aria-label': 'To' });
    const start = h('input.input', { type: 'date', value: today, 'aria-label': 'Start date' });
    const op = h('select.input', { 'aria-label': 'Add or subtract' }, h('option', { value: '1' }, 'Add'), h('option', { value: '-1' }, 'Subtract'));
    const num = (label) => h('input.input', { type: 'number', min: 0, max: 9999, value: 0, 'aria-label': label });
    const yy = num('Years'), mm = num('Months'), dd = num('Days');
    const body = h('div.calc-date-body');
    const calc = () => {
      if (kind === 'diff') {
        const a = new Date(`${from.value}T00:00:00`), b = new Date(`${to.value}T00:00:00`);
        if (Number.isNaN(+a) || Number.isNaN(+b)) { mount(out, h('p', 'Choose two dates.')); return; }
        const [s, e] = a <= b ? [a, b] : [b, a];
        let y = e.getFullYear() - s.getFullYear(), m = e.getMonth() - s.getMonth(), d = e.getDate() - s.getDate();
        if (d < 0) { m--; d += new Date(e.getFullYear(), e.getMonth(), 0).getDate(); }
        if (m < 0) { y--; m += 12; }
        const total = Math.round((e - s) / 86400000);
        const w = Math.floor(d / 7), rd = d % 7;
        const parts = [[y, 'year'], [m, 'month'], [w, 'week'], [rd, 'day']].filter(([n]) => n).map(([n, u]) => `${n} ${u}${n === 1 ? '' : 's'}`);
        mount(out, h('small', 'Difference'), h('b', total === 0 ? 'Same dates' : parts.join(', ')), total ? h('span', `${total.toLocaleString()} day${total === 1 ? '' : 's'}`) : null);
      } else {
        const s = new Date(`${start.value}T00:00:00`);
        if (Number.isNaN(+s)) { mount(out, h('p', 'Choose a date.')); return; }
        const sign = Number(op.value);
        const r = new Date(s);
        r.setFullYear(r.getFullYear() + sign * (Number(yy.value) || 0));
        r.setMonth(r.getMonth() + sign * (Number(mm.value) || 0));
        r.setDate(r.getDate() + sign * (Number(dd.value) || 0));
        mount(out, h('small', 'Date'), h('b', r.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })));
      }
    };
    const draw = () => {
      mount(body, kind === 'diff'
        ? [h('label', 'From', from), h('label', 'To', to)]
        : [h('label', 'From', start), h('div.calc-date-row', op), h('div.calc-date-row', h('label', 'Years', yy), h('label', 'Months', mm), h('label', 'Days', dd))]);
      calc();
    };
    for (const el of [from, to, start, op, yy, mm, dd]) el.addEventListener('input', calc);
    const kindSel = h('select.input', { 'aria-label': 'Calculation', onchange: () => { kind = kindSel.value; draw(); } },
      h('option', { value: 'diff' }, 'Difference between dates'), h('option', { value: 'add' }, 'Add or subtract days'));
    mount(main, h('div.calc-date', kindSel, body, out));
    draw();
  }

  // ── Converter ────────────────────────────────────────────────────────
  function renderConverter() {
    const cat = CONVERTERS[mode];
    const saved = store.get(`conv.${mode}`, {});
    const units = cat.units.map((u) => u[0]);
    let fromU = units.includes(saved.from) ? saved.from : cat.defaults[0];
    let toU = units.includes(saved.to) ? saved.to : cat.defaults[1];
    const a = h('input.input.calc-conv-in', { inputmode: 'decimal', value: saved.value ?? '1', 'aria-label': 'Value to convert' });
    const b = h('input.input.calc-conv-in', { inputmode: 'decimal', 'aria-label': 'Converted value' });
    const sel = (v, on) => h('select.input', { onchange: (e) => on(e.target.value), 'aria-label': 'Unit' }, units.map((u) => h('option', { value: u, selected: u === v }, u)));
    const note = h('p.calc-conv-note');
    const num = (s) => Number(String(s).replace(/,/g, ''));
    const run = (dir = 1) => {
      const src = dir > 0 ? a : b, dst = dir > 0 ? b : a;
      const v = num(src.value);
      if (src.value.trim() === '' || Number.isNaN(v)) { dst.value = ''; note.textContent = ''; return; }
      const r = dir > 0 ? convert(mode, fromU, toU, v) : convert(mode, toU, fromU, v);
      dst.value = format(clean(r), { group: false });
      const one = convert(mode, fromU, toU, 1);
      note.textContent = mode === 'Temperature' ? '' : `1 ${fromU.toLowerCase()} = ${format(clean(one))} ${toU.toLowerCase()}`;
      store.set(`conv.${mode}`, { from: fromU, to: toU, value: a.value });
    };
    a.addEventListener('input', () => run(1));
    b.addEventListener('input', () => run(-1));
    const draw = () => {
      mount(main, h('div.calc-conv',
        h('div.calc-conv-row', a, sel(fromU, (v) => { fromU = v; run(1); })),
        h('button.btn.calc-swap', { type: 'button', 'aria-label': 'Swap units', onclick: () => { [fromU, toU] = [toU, fromU]; a.value = b.value || a.value; draw(); } }, '⇅ Swap'),
        h('div.calc-conv-row', b, sel(toU, (v) => { toU = v; run(1); })),
        note));
      run(1);
    };
    draw();
    setTimeout(() => a.focus());
  }

  // ── Keyboard ─────────────────────────────────────────────────────────
  ctx.listen(win.body, 'keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.altKey && /^Digit[1-4]$/.test(e.code)) { e.preventDefault(); setMode(MODES[Number(e.code.slice(5)) - 1][0]); return; }
    if (!['standard', 'scientific', 'programmer'].includes(mode)) return;
    const k = e.key;
    let handled = true;
    if (ctrl) {
      const key = k.toLowerCase();
      if (key === 'c') navigator.clipboard?.writeText(displayEl.textContent.replace(/[,\s]/g, '')).catch(() => {});
      else if (key === 'v') navigator.clipboard?.readText().then((t) => { const v = Number(t.replace(/[,\s]/g, '')); if (!Number.isNaN(v) && mode !== 'programmer') { cur = { text: String(v), typing: true }; justEvaluated = false; render(); } }).catch(() => {});
      else if (key === 'h') win.body.classList.toggle('side-open');
      else if (key === 'm') mem.MS(); else if (key === 'r') mem.MR(); else if (key === 'p') mem['M+'](); else if (key === 'q') mem['M-'](); else if (key === 'l') mem.MC();
      else handled = false;
    } else if (/^[0-9]$/.test(k) || (k === '.' || k === ',')) digit(k === ',' ? '.' : k);
    else if (mode === 'programmer' && /^[a-fA-F]$/.test(k)) digit(k.toUpperCase());
    else if (k === '+' || k === '-' || k === '*' || k === '/') operator(k);
    else if (k === '^' && mode === 'scientific') operator('^');
    else if (k === '%') { if (mode === 'programmer') operator('mod'); else percent(); }
    else if (k === '(' && mode !== 'standard') paren(true);
    else if (k === ')' && mode !== 'standard') paren(false);
    else if (k === 'Enter' || k === '=') equals();
    else if (k === 'Backspace') backspace();
    else if (k === 'Escape') clearAll();
    else if (k === 'Delete') clearEntry();
    else if (k === 'F9') negate();
    else if (k === 'r' && mode !== 'programmer') unaryFn((x) => { if (x === 0) throw new CalcError('Cannot divide by zero'); return 1 / x; }, (l) => `1/(${l})`);
    else if (k === '@' && mode !== 'programmer') unaryFn((x) => { if (x < 0) throw new CalcError('Invalid input'); return Math.sqrt(x); }, (l) => `√(${l})`);
    else if (k === 'q' && mode !== 'programmer') unaryFn((x) => x * x, (l) => `sqr(${l})`);
    else if (k === '!' && mode === 'scientific') unaryFn(factorial, (l) => `fact(${l})`);
    else if (k === '&' && mode === 'programmer') operator('and');
    else if (k === '|' && mode === 'programmer') operator('or');
    else if (k === '<' && mode === 'programmer') operator('lsh');
    else if (k === '>' && mode === 'programmer') operator('rsh');
    else handled = false;
    if (handled) {
      e.preventDefault();
      const btn = [...win.body.querySelectorAll('.calc-key')].find((x) => x.textContent === (k === 'Enter' ? '=' : k === '*' ? '×' : k === '/' ? '÷' : k === '-' ? '−' : k));
      if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 110); }
    }
  });
  ctx.listen(win.body, 'pointerdown', (e) => { if (!navEl.hidden && !navEl.contains(e.target) && !e.target.closest('.calc-menu')) navEl.hidden = true; });

  win.body.dataset.mode = mode;
  renderAll();
  win.on('focus', () => { if (!win.body.contains(document.activeElement) || document.activeElement === win.body) win.body.focus({ preventScroll: true }); });
}
