// The Terminal's JavaScript runtime. It runs in a Web Worker, so scripts can't touch
// DonutOS's page, its kernel, or its databases directly. Everything goes through the
// `donut` object, which asks the Terminal (and so the permission system) to do the work.
// Ctrl+C in the Terminal terminates this worker, even in the middle of an endless loop.

// Remove direct ways out of the sandbox: storage, network and other contexts.
for (const name of ['indexedDB', 'caches', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'BroadcastChannel', 'SharedWorker', 'Worker']) {
  try { delete self[name]; } catch { /* ignore */ }
  try { Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false }); } catch { /* ignore */ }
}
try { Object.defineProperty(navigator, 'storage', { value: undefined }); } catch { /* ignore */ }

let seq = 0;
const pending = new Map();
const rpc = (method, ...args) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  postMessage({ type: 'rpc', id, method, args });
});

function inspect(v, depth = 0, seen = new WeakSet()) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v) + (typeof v === 'bigint' ? 'n' : '');
  if (typeof v === 'symbol') return v.toString();
  if (typeof v === 'function') return `[Function ${v.name || '(anonymous)'}]`;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof RegExp) return String(v);
  if (seen.has(v)) return '[Circular]';
  seen.add(v);
  if (depth > 3) return Array.isArray(v) ? '[Array]' : '[Object]';
  if (v instanceof Map) return `Map(${v.size}) { ${[...v].slice(0, 50).map(([a, b]) => `${inspect(a, depth + 1, seen)} => ${inspect(b, depth + 1, seen)}`).join(', ')} }`;
  if (v instanceof Set) return `Set(${v.size}) { ${[...v].slice(0, 50).map((x) => inspect(x, depth + 1, seen)).join(', ')} }`;
  if (ArrayBuffer.isView(v)) return `${v.constructor.name}(${v.length}) [${Array.from(v.slice(0, 20)).join(', ')}${v.length > 20 ? ', …' : ''}]`;
  if (Array.isArray(v)) return `[ ${v.slice(0, 100).map((x) => inspect(x, depth + 1, seen)).join(', ')}${v.length > 100 ? `, … ${v.length - 100} more` : ''} ]`;
  const keys = Object.keys(v);
  if (!keys.length) return v.constructor && v.constructor !== Object ? `${v.constructor.name} {}` : '{}';
  return `{ ${keys.slice(0, 50).map((key) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${inspect(v[key], depth + 1, seen)}`).join(', ')}${keys.length > 50 ? ', …' : ''} }`;
}

const print = (stream) => (...args) => postMessage({ type: 'print', stream, text: `${args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ')}\n` });
self.console = { log: print('out'), info: print('out'), debug: print('out'), warn: print('err'), error: print('err'), table: print('out'), dir: print('out') };
self.print = print('out');

self.donut = Object.freeze({
  print: print('out'),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  cwd: () => rpc('cwd'),
  fs: Object.freeze({
    readText: (p) => rpc('readText', p),
    writeText: (p, text) => rpc('writeText', p, String(text)),
    appendText: (p, text) => rpc('appendText', p, String(text)),
    readdir: (p = '.') => rpc('readdir', p),
    exists: (p) => rpc('exists', p),
    stat: (p) => rpc('stat', p),
    mkdir: (p) => rpc('mkdir', p),
    remove: (p) => rpc('remove', p),
  }),
  launch: (appId, args) => rpc('launch', appId, args || {}),
  open: (p) => rpc('open', p),
  notify: (title, body = '') => rpc('notify', String(title), String(body)),
  /** fetch() through DonutOS: obeys the network permission and offline mode. Resolves { status, ok, text }. */
  fetch: (url, opts = {}) => rpc('fetch', String(url), { method: opts.method, body: opts.body, headers: opts.headers }),
  exec: (line) => rpc('exec', String(line)),
});

async function evaluate(code) {
  // Top-level let/const would vanish between prompts; make them globals instead.
  const src = code.replace(/^(\s*)(?:let|const)\s+/gm, '$1var ');
  let fn;
  try {
    // Expressions return their value; `await` works at the top level.
    fn = new Function(`return (async () => (${src}\n))()`);
  } catch {
    fn = new Function(`return (async () => {\n${src}\n})()`);
  }
  if (!/\bawait\b/.test(src)) {
    // Plain statements run as a global script, so `var`/functions persist between prompts.
    try { return (0, eval)(src); } catch (err) { if (!(err instanceof SyntaxError)) throw err; }
  }
  return fn();
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'rpcResult') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error));
    return;
  }
  if (m.type === 'eval') {
    try {
      const value = await evaluate(m.code);
      postMessage({ type: 'result', id: m.id, ok: true, text: value === undefined && m.quietUndefined ? '' : inspect(value, 1) });
    } catch (err) {
      postMessage({ type: 'result', id: m.id, ok: false, text: err instanceof Error ? `${err.name}: ${err.message}` : inspect(err) });
    }
  }
};
postMessage({ type: 'ready' });
