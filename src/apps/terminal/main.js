// Terminal: a shell over the DonutOS file system, with tabs, history, completion,
// scripts (.dsh) and an isolated JavaScript prompt.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { Shell } from './shell.js';
import { createCommands } from './commands.js';
import * as P from '../../core/path.js';

const MAX_NODES = 6000;
const WORKER_URL = new URL('./js-worker.js', import.meta.url);

export default function main(ctx) {
  const k = ctx.privileged;
  const me = ctx.accounts.current();
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'Terminal', width: 880, height: 540, minWidth: 380, minHeight: 220, showTitle: false });
  win.body.classList.add('terminal-app');
  const tabStrip = h('div.ex-tabs.drag', { role: 'tablist', 'aria-label': 'Terminal tabs' });
  win.titlebar.append(tabStrip);
  const stage = h('div.term-stage');
  mount(win.body, stage);
  let fontSize = store.get('fontSize', 14);
  win.body.style.setProperty('--term-size', `${fontSize}px`);

  const sessions = [];
  let active = null;

  function newSession({ cwd, script } = {}) {
    const s = createSession({ cwd });
    sessions.push(s);
    activate(s);
    if (script) s.runLine(`sh ${quote(script)}`, { echo: true });
    return s;
  }

  function activate(s) {
    active = s;
    for (const x of sessions) x.el.hidden = x !== s;
    renderTabs();
    s.focus();
  }

  function closeSession(s) {
    s.dispose();
    sessions.splice(sessions.indexOf(s), 1);
    s.el.remove();
    if (!sessions.length) { win.close({ force: true }); return; }
    if (active === s) activate(sessions[sessions.length - 1]); else renderTabs();
  }

  function renderTabs() {
    mount(tabStrip, sessions.map((s) => h('div.ex-tab', {
      role: 'tab', 'aria-selected': String(s === active), class: s === active && 'active', tabindex: '0', title: s.shell.cwd,
      onclick: () => activate(s), onauxclick: (e) => { if (e.button === 1) closeSession(s); },
    }, h('img', { src: 'assets/icons/apps/terminal.svg', alt: '' }), h('span', s.title()),
      h('button.ex-tab-x', { type: 'button', 'aria-label': 'Close tab', onclick: (e) => { e.stopPropagation(); closeSession(s); } }, icon('close', { size: 10 })))),
    h('button.ex-tab-new', { type: 'button', title: 'New tab (Ctrl+Shift+T or Alt+T)', 'aria-label': 'New tab', onclick: () => newSession({ cwd: active?.shell.cwd }) }, icon('plus', { size: 14 })));
    if (active) win.setTitle(`${active.title()} — Terminal`);
  }

  function quote(s) { return /[\s'"\\$*?|&;<>]/.test(s) ? `'${s.replace(/'/g, "'\\''")}'` : s; }

  // ── One shell session (a tab) ────────────────────────────────────────
  function createSession({ cwd } = {}) {
    const out = h('pre.term-out', { 'aria-live': 'polite' });
    const prompt = h('span.term-prompt');
    const input = h('input.term-input', { type: 'text', spellcheck: false, autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Command' });
    const line = h('div.term-line', prompt, input);
    const statusBar = h('div.term-status', { hidden: true });
    const el = h('div.term', { tabindex: '-1', onclick: (e) => { if (!getSelection().toString() && e.target.tagName !== 'A') input.focus(); } }, out, line, statusBar);
    stage.append(el);

    let history = store.get('history', []);
    let hIndex = history.length;
    let draft = '';
    let running = null;     // AbortController of the running command
    let jsMode = false;
    let worker = null;
    let workerReady = null;
    const jsPending = new Map();
    let jsSeq = 0;
    let nodes = 0;

    const term = {
      clearScreen: () => { out.replaceChildren(); nodes = 0; },
      history: () => history,
      clearHistory: () => { history = []; hIndex = 0; store.set('history', []); },
      saveEnv: () => { store.set('env', exported()); store.set('aliases', shell.aliases); },
      status: (text) => { statusBar.hidden = !text; statusBar.textContent = text; },
      closeTab: () => setTimeout(() => closeSession(session)),
      runScript,
      js: runJs,
    };

    const home = me.home;
    const shell = new Shell({ fs: ctx.fs, home, commands: createCommands({ ctx, term }), env: { USER: me.name, HOSTNAME: k.settings.get('system.deviceName'), SHELL: 'donutsh', TERM: 'donut-terminal', ...store.get('env', {}) } });
    shell.aliases = { ll: 'ls -l', la: 'ls -la', ...store.get('aliases', {}) };
    if (cwd && P.isInside('/', cwd)) shell.cwd = shell.env.PWD = P.normalize(cwd);
    const exported = () => Object.fromEntries(Object.entries(shell.env).filter(([key]) => !['HOME', 'PWD', 'OLDPWD', 'USER', 'HOSTNAME', 'SHELL', 'TERM'].includes(key)));

    function write(text, cls) {
      if (!text) return;
      const span = document.createElement('span');
      if (cls) span.className = cls;
      span.textContent = text;
      out.append(span);
      if (++nodes > MAX_NODES) { out.firstChild?.remove(); nodes--; }
      el.scrollTop = el.scrollHeight;
    }
    const io = (signal) => ({ out: (t, cls) => write(t, cls), err: (t) => write(t, 't-err'), stdin: null, piped: false, signal });

    function renderPrompt() {
      if (jsMode) { mount(prompt, h('span.t-js', 'js› ')); return; }
      mount(prompt, h('span.t-user', `${me.name.split(' ')[0].toLowerCase()}@${k.settings.get('system.deviceName').toLowerCase()}`), ' ', h('span.t-path', shell.display(shell.cwd)), h('span.t-sym', ' $ '));
    }

    function echoLine(text) {
      const p = prompt.cloneNode(true);
      out.append(p, document.createTextNode(`${text}\n`));
      nodes += 2;
    }

    async function runLine(text, { echo = true } = {}) {
      if (echo) echoLine(text);
      const trimmed = text.trim();
      if (trimmed && !jsMode) {
        history = [...history.filter((x) => x !== trimmed), trimmed].slice(-500);
        store.set('history', history);
      }
      hIndex = history.length;
      if (!trimmed) return;
      running = new AbortController();
      line.classList.add('busy');
      el.focus({ preventScroll: true }); // keeps Ctrl+C inside this window while the input is hidden
      try {
        if (jsMode) {
          if (trimmed === '.exit' || trimmed === 'exit') { jsMode = false; write('Left JavaScript mode.\n', 't-dim'); }
          else if (trimmed === '.help') write('Type JavaScript and press Enter. donut.fs, donut.launch(), donut.notify(), donut.fetch(), donut.exec() and print() are available. .exit leaves.\n', 't-dim');
          else await evalJs(text, running.signal);
        } else {
          await shell.run(text, io(running.signal));
        }
      } finally {
        running = null;
        line.classList.remove('busy');
        renderPrompt();
        renderTabs();
        el.scrollTop = el.scrollHeight;
        if (session === active) input.focus();
      }
    }

    async function runScript(path, args, sio, { subshell, shell: sh }) {
      if (!path) { sio.err('usage: sh script.dsh [args]\n'); return 2; }
      const file = sh.resolve(path);
      const text = await ctx.fs.readText(file);
      const target = subshell ? Object.assign(new Shell({ fs: ctx.fs, home: sh.home, commands: sh.commands }), { cwd: sh.cwd, env: { ...sh.env }, aliases: { ...sh.aliases } }) : sh;
      args.forEach((a, i) => { target.env[String(i + 1)] = a; });
      target.env['0'] = path;
      target.env['#'] = String(args.length);
      let status = 0;
      for (const raw of text.split('\n')) {
        if (sio.signal?.aborted) return 130;
        const l = raw.trim();
        if (!l || l.startsWith('#')) continue;
        status = await target.run(l, sio);
      }
      return status;
    }

    // ── JavaScript (isolated worker) ─────────────────────────────────
    function ensureWorker() {
      if (worker) return workerReady;
      worker = new Worker(WORKER_URL);
      workerReady = new Promise((resolve) => {
        worker.onmessage = async (e) => {
          const m = e.data;
          if (m.type === 'ready') { resolve(); return; }
          if (m.type === 'print') { write(m.text, m.stream === 'err' ? 't-err' : null); return; }
          if (m.type === 'result') { const p = jsPending.get(m.id); jsPending.delete(m.id); p?.(m); return; }
          if (m.type === 'rpc') {
            try { worker?.postMessage({ type: 'rpcResult', id: m.id, ok: true, value: await jsApi(m.method, m.args) }); }
            catch (err) { worker?.postMessage({ type: 'rpcResult', id: m.id, ok: false, error: err.message || String(err) }); }
          }
        };
        worker.onerror = (e) => { write(`JavaScript error: ${e.message}\n`, 't-err'); e.preventDefault(); };
      });
      ctx.own(() => worker?.terminate());
      return workerReady;
    }

    async function jsApi(method, args) {
      const r = (p) => shell.resolve(p);
      switch (method) {
        case 'cwd': return shell.cwd;
        case 'readText': return ctx.fs.readText(r(args[0]));
        case 'writeText': await ctx.fs.writeText(r(args[0]), args[1]); return true;
        case 'appendText': await ctx.fs.appendText(r(args[0]), args[1]); return true;
        case 'readdir': return (await ctx.fs.readdir(r(args[0]))).map(({ name, path, type, size, mtime }) => ({ name, path, type, size, mtime }));
        case 'exists': return ctx.fs.exists(r(args[0]));
        case 'stat': { const s = await ctx.fs.stat(r(args[0])); return s && { name: s.name, path: s.path, type: s.type, size: s.size, mtime: s.mtime, ctime: s.ctime }; }
        case 'mkdir': await ctx.fs.mkdir(r(args[0]), { recursive: true }); return true;
        case 'remove': await ctx.fs.remove(r(args[0]), { recursive: true }); return true;
        case 'launch': await ctx.launch(args[0], args[1]); return true;
        case 'open': return !!(await ctx.open(r(args[0])));
        case 'notify': return !!(await ctx.notify({ title: args[0], body: args[1] }));
        case 'fetch': { const res = await ctx.net.fetch(args[0], args[1]); return { status: res.status, ok: res.ok, text: await res.text() }; }
        case 'exec': {
          let text = '';
          await shell.run(args[0], { out: (t) => { text += t; }, err: (t) => { text += t; }, stdin: null, piped: true, signal: running?.signal });
          return text;
        }
        default: throw new Error(`Unknown method ${method}`);
      }
    }

    async function evalJs(code, signal) {
      await ensureWorker();
      const id = ++jsSeq;
      const result = await new Promise((resolve) => {
        jsPending.set(id, resolve);
        worker.postMessage({ type: 'eval', id, code, quietUndefined: false });
        signal?.addEventListener('abort', () => {
          // A script that never yields can only be stopped by ending its worker.
          worker?.terminate(); worker = null; workerReady = null; jsPending.clear();
          resolve({ ok: false, text: 'Stopped (the JavaScript session was reset).' });
        }, { once: true });
      });
      if (result.text) write(`${result.text}\n`, result.ok ? 't-js-out' : 't-err');
      return result.ok ? 0 : 1;
    }

    async function runJs(args, sio, sh) {
      if (!args.length) { jsMode = true; write('JavaScript mode — runs in an isolated worker. Type .help for help, .exit to leave.\n', 't-dim'); return 0; }
      if (args[0] === '-e') return evalJs(args.slice(1).join(' '), sio.signal);
      const file = sh.resolve(args[0]);
      return evalJs(await ctx.fs.readText(file), sio.signal);
    }

    // ── Completion ───────────────────────────────────────────────────
    async function complete() {
      const v = input.value.slice(0, input.selectionStart);
      const after = input.value.slice(input.selectionStart);
      const m = /(?:^|[\s|;&<>])((?:\\ |[^\s|;&<>])*)$/.exec(v);
      const word = (m?.[1] || '').replace(/\\ /g, ' ');
      const isCommand = !/\S\s/.test(v.replace(/[|;&]\s*\S*$/, (x) => x)) && !/\s/.test(v.trim()) || /[|;&]\s*[^\s]*$/.test(v);
      let candidates = [];
      if (isCommand && !word.includes('/')) {
        candidates = [...Object.keys(shell.commands), ...Object.keys(shell.aliases)].filter((c) => c.startsWith(word)).sort().map((c) => ({ text: c, final: `${c} ` }));
      } else {
        const expanded = word.startsWith('~') ? shell.home + word.slice(1) : word;
        const slash = expanded.lastIndexOf('/');
        const dirPart = slash >= 0 ? expanded.slice(0, slash + 1) : '';
        const prefix = slash >= 0 ? expanded.slice(slash + 1) : expanded;
        const dir = shell.resolve(dirPart || '.');
        const list = await ctx.fs.readdir(dir, { hidden: prefix.startsWith('.') }).catch(() => []);
        const shownDir = slash >= 0 ? word.slice(0, word.lastIndexOf('/') + 1) : '';
        candidates = list.filter((e) => e.name.toLowerCase().startsWith(prefix.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name))
          .map((e) => ({ text: e.name + (e.type === 'dir' ? '/' : ''), final: `${shownDir}${e.name}${e.type === 'dir' ? '/' : ' '}`.replace(/ (?=.)/g, '\\ ') }));
      }
      if (!candidates.length) return;
      const start = v.length - (m?.[1] || '').length;
      if (candidates.length === 1) {
        input.value = v.slice(0, start) + candidates[0].final + after;
      } else {
        const finals = candidates.map((c) => c.final.trimEnd());
        let common = finals[0];
        for (const f of finals) while (!f.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1);
        if (common.length > (m?.[1] || '').length) input.value = v.slice(0, start) + common + after;
        else { echoLine(input.value); write(`${candidates.map((c) => c.text).join('  ')}\n`, 't-dim'); }
      }
      const caret = input.value.length - after.length;
      input.setSelectionRange(caret, caret);
    }

    // ── Keys ─────────────────────────────────────────────────────────
    input.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'Enter') { e.preventDefault(); if (running) return; const t = input.value; input.value = ''; runLine(t); return; }
      if (ctrl && e.code === 'KeyC' && !e.shiftKey && !(input.selectionStart !== input.selectionEnd)) {
        e.preventDefault();
        if (!session.interrupt()) { echoLine(`${input.value}^C`); input.value = ''; }
        return;
      }
      if (ctrl && e.code === 'KeyL') { e.preventDefault(); term.clearScreen(); return; }
      if (ctrl && e.code === 'KeyD' && !input.value) { e.preventDefault(); if (jsMode) { jsMode = false; renderPrompt(); } else closeSession(session); return; }
      if (e.key === 'Tab') { e.preventDefault(); if (!jsMode) complete(); return; }
      if (e.key === 'ArrowUp' && history.length && !jsMode) { e.preventDefault(); if (hIndex === history.length) draft = input.value; hIndex = Math.max(0, hIndex - 1); input.value = history[hIndex]; return; }
      if (e.key === 'ArrowDown' && !jsMode) { e.preventDefault(); hIndex = Math.min(history.length, hIndex + 1); input.value = hIndex === history.length ? draft : history[hIndex]; return; }
      if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); setFont(fontSize + 1); return; }
      if (ctrl && e.key === '-') { e.preventDefault(); setFont(fontSize - 1); return; }
      if (ctrl && e.key === '0') { e.preventDefault(); setFont(14); return; }
    });

    const session = {
      el, shell,
      title: () => (jsMode ? 'JavaScript' : shell.cwd === shell.home ? '~' : P.basename(shell.cwd) || '/'),
      focus: () => setTimeout(() => input.focus()),
      runLine,
      interrupt: () => { if (!running) return false; running.abort(); write('^C\n', 't-dim'); return true; },
      dispose: () => { running?.abort(); worker?.terminate(); worker = null; },
    };
    write(`DonutOS Terminal — ${k.settings.get('system.deviceName')}\nType “help” for commands, “js” for JavaScript. Tab completes names; ↑/↓ recall history.\n\n`, 't-dim');
    renderPrompt();
    return session;
  }

  function setFont(px) {
    fontSize = Math.max(9, Math.min(28, px));
    store.set('fontSize', fontSize);
    win.body.style.setProperty('--term-size', `${fontSize}px`);
  }

  ctx.listen(win.body, 'keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyC' && !e.shiftKey && e.target.tagName !== 'INPUT' && !getSelection().toString()) { if (active?.interrupt()) e.preventDefault(); }
    else if ((ctrl && e.shiftKey && e.code === 'KeyT') || (e.altKey && e.code === 'KeyT')) { e.preventDefault(); newSession({ cwd: active?.shell.cwd }); }
    else if ((ctrl && e.shiftKey && e.code === 'KeyW') || (e.altKey && e.code === 'KeyW')) { e.preventDefault(); closeSession(active); }
    else if (ctrl && e.key === 'Tab') { e.preventDefault(); const i = sessions.indexOf(active); activate(sessions[(i + (e.shiftKey ? -1 : 1) + sessions.length) % sessions.length]); }
  });
  win.on('focus', () => active?.focus());
  ctx.onActivate((args) => newSession({ cwd: args?.cwd, script: args?.path }));
  newSession({ cwd: ctx.args.cwd, script: ctx.args.path });
}
