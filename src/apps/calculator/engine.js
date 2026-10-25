// Calculator maths: a safe expression evaluator (no eval) for Scientific mode, integer
// arithmetic for Programmer mode, number formatting, and unit conversion tables.

export class CalcError extends Error {}

const FUNCS = {
  sin: (x, d) => Math.sin(d ? (x * Math.PI) / 180 : x), cos: (x, d) => Math.cos(d ? (x * Math.PI) / 180 : x), tan: (x, d) => {
    if (d && Math.abs(x % 180) === 90) throw new CalcError('Invalid input');
    return Math.tan(d ? (x * Math.PI) / 180 : x);
  },
  asin: (x, d) => { if (Math.abs(x) > 1) throw new CalcError('Invalid input'); const r = Math.asin(x); return d ? (r * 180) / Math.PI : r; },
  acos: (x, d) => { if (Math.abs(x) > 1) throw new CalcError('Invalid input'); const r = Math.acos(x); return d ? (r * 180) / Math.PI : r; },
  atan: (x, d) => { const r = Math.atan(x); return d ? (r * 180) / Math.PI : r; },
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  log: (x) => { if (x <= 0) throw new CalcError('Invalid input'); return Math.log10(x); },
  ln: (x) => { if (x <= 0) throw new CalcError('Invalid input'); return Math.log(x); },
  sqrt: (x) => { if (x < 0) throw new CalcError('Invalid input'); return Math.sqrt(x); },
  cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
  fact: (x) => factorial(x),
};

export function factorial(x) {
  if (x < 0 || !Number.isFinite(x)) throw new CalcError('Invalid input');
  if (!Number.isInteger(x)) return gamma(x + 1);
  if (x > 170) throw new CalcError('Overflow');
  let r = 1;
  for (let i = 2; i <= x; i++) r *= i;
  return r;
}
// Lanczos approximation, for factorials of non-integers.
function gamma(z) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
}

/**
 * Evaluates a token list: numbers, '+', '-', '*', '/', '^', 'mod', '(', ')', 'neg',
 * '!' (postfix factorial), { fn: 'sin' } and the constants 'pi' and 'e'.
 */
export function evaluate(tokens, { degrees = true } = {}) {
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, mod: 2, '^': 4 };
  function primary() {
    const t = next();
    if (t === undefined) throw new CalcError('Incomplete expression');
    if (typeof t === 'number') return postfix(t);
    if (t === 'pi') return postfix(Math.PI);
    if (t === 'e') return postfix(Math.E);
    if (t === 'neg' || t === '-') return -unary();
    if (t === '(') {
      const v = expr(0);
      if (peek() === ')') next();
      return postfix(v);
    }
    if (t && t.fn) {
      const v = unary();
      return postfix(FUNCS[t.fn](v, degrees));
    }
    throw new CalcError('Invalid expression');
  }
  function unary() { return primary(); }
  function postfix(v) { while (peek() === '!') { next(); v = factorial(v); } return v; }
  function expr(minPrec) {
    let left = unary();
    for (;;) {
      const op = peek();
      const p = prec[op];
      if (p === undefined || p < minPrec) break;
      next();
      // ^ is right-associative; the rest are left-associative.
      const right = expr(op === '^' ? p : p + 1);
      left = apply(op, left, right);
    }
    return left;
  }
  const v = expr(0);
  if (i < tokens.length && tokens[i] !== ')') throw new CalcError('Invalid expression');
  if (!Number.isFinite(v)) throw new CalcError(Number.isNaN(v) ? 'Result is undefined' : 'Overflow');
  return v;
}

export function apply(op, a, b) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': if (b === 0) throw new CalcError(a === 0 ? 'Result is undefined' : 'Cannot divide by zero'); return a / b;
    case 'mod': if (b === 0) throw new CalcError('Cannot divide by zero'); return a - b * Math.floor(a / b);
    case '^': return a ** b;
    default: throw new CalcError(`Unknown operator ${op}`);
  }
}

/** Rounds away binary noise (0.1 + 0.2 → 0.3) and formats for display. */
export function clean(v) {
  if (!Number.isFinite(v)) return v;
  return Number.parseFloat(v.toPrecision(15));
}

export function format(v, { group = true } = {}) {
  if (typeof v === 'string') return v;
  v = clean(v);
  if (Object.is(v, -0)) v = 0;
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e16 || abs < 1e-10)) return v.toExponential(10).replace(/\.?0+e/, 'e').replace('e+', 'e+');
  const [int, frac] = String(v).includes('e') ? v.toFixed(12).replace(/0+$/, '').split('.') : String(v).split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  const grouped = group ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : digits;
  return `${neg ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** Formats the number being typed (keeps a trailing point or zeros). */
export function formatEntry(text) {
  const neg = text.startsWith('-');
  const [int, frac] = (neg ? text.slice(1) : text).split('.');
  return `${neg ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac !== undefined ? `.${frac}` : ''}`;
}

// ── Programmer mode (two's complement integers) ─────────────────────────

export const WORDS = { QWORD: 64n, DWORD: 32n, WORD: 16n, BYTE: 8n };

export function wrap(v, bits) {
  const m = 1n << bits;
  let r = ((v % m) + m) % m;
  if (r >= m >> 1n) r -= m;
  return r;
}
export function unsigned(v, bits) { const m = 1n << bits; return ((v % m) + m) % m; }

export function progApply(op, a, b, bits) {
  let r;
  switch (op) {
    case '+': r = a + b; break;
    case '-': r = a - b; break;
    case '*': r = a * b; break;
    case '/': if (b === 0n) throw new CalcError('Cannot divide by zero'); r = a / b; break;
    case 'mod': if (b === 0n) throw new CalcError('Cannot divide by zero'); r = a % b; break;
    case 'and': r = a & b; break;
    case 'or': r = a | b; break;
    case 'xor': r = a ^ b; break;
    case 'nand': r = ~(a & b); break;
    case 'nor': r = ~(a | b); break;
    case 'lsh': r = a << (b & 63n); break;
    case 'rsh': r = a >> (b & 63n); break;
    default: throw new CalcError(`Unknown operator ${op}`);
  }
  return wrap(r, bits);
}

export function toBase(v, base, bits) {
  if (base === 10) return v.toString(10);
  const s = unsigned(v, bits).toString(base).toUpperCase();
  const size = base === 2 ? 4 : base === 16 ? 4 : 3;
  return s.replace(new RegExp(`\\B(?=(.{${size}})+(?!.))`, 'g'), ' ');
}

// ── Converter ──────────────────────────────────────────────────────────
// Each unit: [label, factor to the base unit] (temperature uses functions).

export const CONVERTERS = {
  Length: { defaults: ['Centimetres', 'Inches'], base: 'Metres', units: [['Nanometres', 1e-9], ['Micrometres', 1e-6], ['Millimetres', 1e-3], ['Centimetres', 1e-2], ['Metres', 1], ['Kilometres', 1e3], ['Inches', 0.0254], ['Feet', 0.3048], ['Yards', 0.9144], ['Miles', 1609.344], ['Nautical miles', 1852]] },
  Weight: { defaults: ['Kilograms', 'Pounds'], base: 'Kilograms', units: [['Milligrams', 1e-6], ['Grams', 1e-3], ['Kilograms', 1], ['Metric tonnes', 1000], ['Ounces', 0.028349523125], ['Pounds', 0.45359237], ['Stone', 6.35029318], ['Short tons (US)', 907.18474], ['Long tons (UK)', 1016.0469088]] },
  Temperature: { defaults: ['Celsius', 'Fahrenheit'], base: 'Celsius', units: [['Celsius', null], ['Fahrenheit', null], ['Kelvin', null]] },
  Area: { defaults: ['Square metres', 'Square feet'], base: 'Square metres', units: [['Square millimetres', 1e-6], ['Square centimetres', 1e-4], ['Square metres', 1], ['Hectares', 1e4], ['Square kilometres', 1e6], ['Square inches', 0.00064516], ['Square feet', 0.09290304], ['Square yards', 0.83612736], ['Acres', 4046.8564224], ['Square miles', 2589988.110336]] },
  Volume: { defaults: ['Litres', 'Gallons (US)'], base: 'Litres', units: [['Millilitres', 1e-3], ['Litres', 1], ['Cubic metres', 1000], ['Teaspoons (US)', 0.00492892159375], ['Tablespoons (US)', 0.01478676478125], ['Fluid ounces (US)', 0.0295735295625], ['Cups (US)', 0.2365882365], ['Pints (US)', 0.473176473], ['Quarts (US)', 0.946352946], ['Gallons (US)', 3.785411784], ['Pints (UK)', 0.56826125], ['Gallons (UK)', 4.54609]] },
  Speed: { defaults: ['Kilometres per hour', 'Miles per hour'], base: 'Metres per second', units: [['Metres per second', 1], ['Kilometres per hour', 1 / 3.6], ['Miles per hour', 0.44704], ['Feet per second', 0.3048], ['Knots', 1852 / 3600]] },
  Time: { defaults: ['Hours', 'Minutes'], base: 'Seconds', units: [['Milliseconds', 1e-3], ['Seconds', 1], ['Minutes', 60], ['Hours', 3600], ['Days', 86400], ['Weeks', 604800], ['Years (365 days)', 31536000]] },
  Data: { defaults: ['Megabytes', 'Gigabytes'], base: 'Bytes', units: [['Bits', 1 / 8], ['Bytes', 1], ['Kilobytes', 1e3], ['Kibibytes', 1024], ['Megabytes', 1e6], ['Mebibytes', 1024 ** 2], ['Gigabytes', 1e9], ['Gibibytes', 1024 ** 3], ['Terabytes', 1e12], ['Tebibytes', 1024 ** 4]] },
  Energy: { defaults: ['Kilocalories', 'Kilojoules'], base: 'Joules', units: [['Joules', 1], ['Kilojoules', 1e3], ['Calories', 4.184], ['Kilocalories', 4184], ['Watt-hours', 3600], ['Kilowatt-hours', 3.6e6], ['Electron volts', 1.602176634e-19], ['BTUs', 1055.05585262]] },
  Pressure: { defaults: ['Bars', 'PSI'], base: 'Pascals', units: [['Pascals', 1], ['Kilopascals', 1e3], ['Bars', 1e5], ['Atmospheres', 101325], ['PSI', 6894.757293168], ['Millimetres of mercury', 133.322387415]] },
  Angle: { defaults: ['Degrees', 'Radians'], base: 'Degrees', units: [['Degrees', 1], ['Radians', 180 / Math.PI], ['Gradians', 0.9], ['Turns', 360]] },
};

export function convert(category, from, to, value) {
  if (category === 'Temperature') {
    const c = from === 'Celsius' ? value : from === 'Fahrenheit' ? ((value - 32) * 5) / 9 : value - 273.15;
    return to === 'Celsius' ? c : to === 'Fahrenheit' ? (c * 9) / 5 + 32 : c + 273.15;
  }
  const units = CONVERTERS[category].units;
  const f = units.find((u) => u[0] === from)[1];
  const t = units.find((u) => u[0] === to)[1];
  return (value * f) / t;
}
