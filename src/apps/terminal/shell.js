// DonutOS shell language: a small POSIX-like interpreter over the DonutOS file system.
//
//   words, 'single' and "double" quotes, \escapes
//   $VAR ${VAR} $? ~   (expanded outside single quotes)
//   * ? [abc] globs    (expanded against the file system, unquoted words only)
//   a | b              pipes (text flows from one command to the next)
//   > file  >> file  < file  2> file
//   a && b   a || b   a ; b
//
// The interpreter knows nothing about the screen: commands write through `io.out` /
// `io.err`, and the Terminal app decides how to show it.

import * as P from '../../core/path.js';

export class ShellSyntaxError extends Error {}

/** Splits a line into tokens: { t: 'word', parts: [{ text, quoted }] } | { t: 'op', v }. */
export function tokenize(line) {
  const out = [];
  let i = 0;
  let word = null;
  const push = () => { if (word) { out.push(word); word = null; } };
  const part = (text, quoted) => { (word ||= { t: 'word', parts: [] }).parts.push({ text, quoted }); };
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') { push(); i++; continue; }
    if (c === '#' && !word) break; // comment
    if (c === '|' || c === '&' || c === ';' || c === '>' || c === '<') {
      push();
      const two = line.slice(i, i + 2);
      if (two === '&&' || two === '||' || two === '>>') { out.push({ t: 'op', v: two }); i += 2; continue; }
      if (c === '&') throw new ShellSyntaxError('Background jobs (&) aren’t supported');
      out.push({ t: 'op', v: c }); i++; continue;
    }
    if (c === '2' && line[i + 1] === '>' && !word) { push(); out.push({ t: 'op', v: '2>' }); i += 2; continue; }
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new ShellSyntaxError('Missing closing quote (\')');
      part(line.slice(i + 1, end), 'single');
      i = end + 1; continue;
    }
    if (c === '"') {
      let j = i + 1, text = '';
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && '"\\$`'.includes(line[j + 1])) { text += line[j + 1]; j += 2; } else text += line[j++];
      }
      if (j >= line.length) throw new ShellSyntaxError('Missing closing quote (")');
      part(text, 'double');
      i = j + 1; continue;
    }
    if (c === '\\') { part(line[i + 1] ?? '', 'single'); i += 2; continue; }
    let j = i;
    while (j < line.length && !' \t|&;<>\'"\\'.includes(line[j])) j++;
    part(line.slice(i, j), false);
    i = j;
  }
  push();
  return out;
}

/** Groups tokens into a list: [{ op: null|'&&'|'||'|';', pipeline: [{ argv: wordTokens, redirects }] }]. */
export function parse(tokens) {
  const list = [];
  let pipeline = [];
  let cmd = { words: [], redirects: [] };
  let nextOp = null;
  const endCmd = () => {
    if (!cmd.words.length && !cmd.redirects.length) throw new ShellSyntaxError('Missing command');
    pipeline.push(cmd);
    cmd = { words: [], redirects: [] };
  };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'word') { cmd.words.push(tk); continue; }
    if (['>', '>>', '<', '2>'].includes(tk.v)) {
      const target = tokens[++i];
      if (!target || target.t !== 'word') throw new ShellSyntaxError(`Expected a file name after ${tk.v}`);
      cmd.redirects.push({ op: tk.v, target });
      continue;
    }
    if (tk.v === '|') { endCmd(); continue; }
    // && || ;
    endCmd();
    list.push({ op: nextOp, pipeline });
    pipeline = [];
    nextOp = tk.v;
  }
  if (cmd.words.length || cmd.redirects.length) endCmd();
  if (pipeline.length) list.push({ op: nextOp, pipeline });
  else if (nextOp && nextOp !== ';') throw new ShellSyntaxError(`Missing command after ${nextOp}`);
  return list;
}

const globRe = (pat) => new RegExp(`^${pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`, 'i');
const hasGlob = (s) => /[*?]|\[[^\]]+\]/.test(s);

export class Shell {
  /**
   * fs: DonutOS file API (permission-checked), env: initial variables, commands: name -> fn,
   * home: the user's home folder.
   */
  constructor({ fs, env = {}, commands = {}, home = '/' }) {
    this.fs = fs;
    this.home = home;
    this.cwd = home;
    this.env = { HOME: home, PWD: home, ...env };
    this.aliases = {};
    this.commands = commands;
    this.status = 0;
  }

  resolve(p) {
    if (!p) return this.cwd;
    if (p === '~' || p.startsWith('~/')) p = this.home + p.slice(1);
    return P.resolve(this.cwd, p);
  }

  display(p) {
    if (P.isSameOrInside(this.home, p)) return `~${p.slice(this.home.length)}`;
    return p;
  }

  expandVars(text) {
    return text.replace(/\$(\?|#|@|\*|\d|\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
      if (name === '?') return String(this.status);
      if (name === '@' || name === '*') return Array.from({ length: Number(this.env['#'] || 0) }, (_, i) => this.env[String(i + 1)] ?? '').join(' ');
      const n = name.replace(/[{}]/g, '');
      return n === 'PWD' ? this.cwd : this.env[n] ?? '';
    });
  }

  /** Expands one word token into zero or more argument strings. */
  async expandWord(word) {
    let text = '';
    let globbable = '';
    word.parts.forEach((part, idx) => {
      let v = part.text;
      if (part.quoted !== 'single') v = this.expandVars(v);
      if (!part.quoted && idx === 0 && (v === '~' || v.startsWith('~/'))) v = this.home + v.slice(1);
      text += v;
      globbable += part.quoted ? v.replace(/[*?[\]]/g, '\\$&') : v;
    });
    if (word.parts.every((p) => !p.quoted) && hasGlob(globbable)) {
      const matches = await this.glob(globbable);
      if (matches.length) return matches;
    }
    return [text];
  }

  async glob(pattern) {
    const abs = pattern.startsWith('/');
    const segs = pattern.split('/').filter(Boolean);
    let bases = [abs ? '/' : this.cwd];
    for (const seg of segs) {
      const next = [];
      for (const b of bases) {
        if (!hasGlob(seg)) { next.push(P.join(b, seg)); continue; }
        const re = globRe(seg);
        const entries = await this.fs.readdir(b, { hidden: seg.startsWith('.') }).catch(() => []);
        for (const e of entries) if (re.test(e.name)) next.push(e.path);
      }
      bases = next;
    }
    const existing = [];
    for (const b of bases) if (await this.fs.exists(b).catch(() => false)) existing.push(b);
    existing.sort();
    // Show results the way they were asked for (relative if the pattern was relative).
    return existing.map((p) => (abs ? p : P.isInside(this.cwd, p) ? p.slice(this.cwd === '/' ? 1 : this.cwd.length + 1) : p));
  }

  /**
   * Runs a command line. io: { out(text, cls), err(text), signal, input() }.
   * Returns the exit status of the last command.
   */
  async run(line, io) {
    let list;
    try { list = parse(tokenize(line)); }
    catch (err) { io.err(`${err.message}\n`); this.status = 2; return 2; }
    for (const { op, pipeline } of list) {
      if (op === '&&' && this.status !== 0) continue;
      if (op === '||' && this.status === 0) continue;
      if (io.signal?.aborted) break;
      this.status = await this.runPipeline(pipeline, io);
    }
    return this.status;
  }

  async runPipeline(pipeline, io) {
    let input = null;
    let status = 0;
    for (let i = 0; i < pipeline.length; i++) {
      const cmd = pipeline[i];
      const last = i === pipeline.length - 1;
      let argv = [];
      for (const w of cmd.words) argv.push(...(await this.expandWord(w)));
      if (argv.length && this.aliases[argv[0]]) {
        const aliasTokens = tokenize(this.aliases[argv[0]]).filter((t) => t.t === 'word');
        const expanded = [];
        for (const w of aliasTokens) expanded.push(...(await this.expandWord(w)));
        argv = [...expanded, ...argv.slice(1)];
      }
      let stdin = input;
      let outFile = null, append = false, errFile = null;
      for (const r of cmd.redirects) {
        const [target] = await this.expandWord(r.target);
        const path = this.resolve(target);
        if (r.op === '<') {
          try { stdin = await this.fs.readText(path); } catch (e) { io.err(`${target}: ${e.code === 'ENOENT' ? 'No such file' : e.message}\n`); return 1; }
        } else if (r.op === '2>') errFile = path;
        else { outFile = path; append = r.op === '>>'; }
      }
      let captured = '';
      let errCaptured = '';
      const toScreen = last && !outFile;
      const sub = {
        ...io,
        stdin,
        piped: !toScreen,
        out: (text, cls) => { if (toScreen) io.out(text, cls); else captured += text; },
        err: (text) => { if (errFile) errCaptured += text; else io.err(text); },
      };
      if (!argv.length) { input = stdin; continue; }
      status = await this.exec(argv, sub);
      if (errFile) await this.fs.writeText(errFile, errCaptured).catch((e) => io.err(`${e.message}\n`));
      if (outFile) {
        try {
          if (append) await this.fs.appendText(outFile, captured);
          else await this.fs.writeText(outFile, captured);
        } catch (e) { io.err(`${P.basename(outFile)}: ${e.message}\n`); status = 1; }
      }
      input = captured;
    }
    return status;
  }

  async exec(argv, io) {
    const [name, ...args] = argv;
    const fn = this.commands[name];
    if (!fn) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(name)) { const eq = name.indexOf('='); this.env[name.slice(0, eq)] = name.slice(eq + 1); return 0; }
      io.err(`${name}: command not found. Type “help” to see what you can run.\n`);
      return 127;
    }
    try {
      const r = await fn.call(this, args, io, this);
      return typeof r === 'number' ? r : 0;
    } catch (err) {
      if (err?.name === 'AbortError') return 130;
      const msg = err?.code === 'ENOENT' ? 'No such file or folder' : err?.name === 'PermissionError' ? 'Permission denied' : err?.message || String(err);
      io.err(`${name}: ${msg}${err?.path ? ` (${this.display(err.path)})` : ''}\n`);
      return 1;
    }
  }
}

/** Parses "-abc --long value" style flags. spec: { flagName: 'boolean' | 'string' }, short aliases via map. */
export function getopts(args, { bool = '', str = '', long = {} } = {}) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { rest.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--') && a.length > 2) {
      const [k, v] = a.slice(2).split('=');
      const key = long[k] || k;
      flags[key] = v ?? (str.includes(key) ? args[++i] : true);
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        const f = a[j];
        if (str.includes(f)) { flags[f] = a.slice(j + 1) || args[++i]; break; }
        if (bool.includes(f)) flags[f] = true;
        else throw new Error(`unknown option -${f}`);
      }
      continue;
    }
    rest.push(a);
  }
  return { flags, args: rest };
}
