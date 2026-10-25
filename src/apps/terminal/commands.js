// Terminal commands. Each is `async (args, io, sh) => exitCode`.
// io: { out(text, cls), err(text), stdin (piped text or null), piped, signal }

import { getopts } from './shell.js';
import { formatBytes } from '../../core/util.js';
import { zipPaths, unzipTo, listZip } from '../../lib/zip.js';
import * as P from '../../core/path.js';

const pad = (s, n) => String(s).padStart(n);
const dateStr = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const lines = (text) => (text ?? '').replace(/\n$/, '').split('\n');
const checkAbort = (io) => { if (io.signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };

/** Reads the inputs of a filter command: named files, or the piped text. */
async function inputs(sh, files, io) {
  if (!files.length) return [{ name: '-', text: io.stdin ?? '' }];
  const out = [];
  for (const f of files) out.push({ name: f, text: await sh.fs.readText(sh.resolve(f)) });
  return out;
}

export function createCommands({ ctx, term }) {
  const k = ctx.privileged;
  const user = () => ctx.system.user();
  const deviceName = () => k.settings.get('system.deviceName');

  const HELP = {
    help: 'help [command] — list commands or show help for one',
    ls: 'ls [-l] [-a] [-h] [paths…] — list a folder', cd: 'cd [folder] — change folder (cd - goes back)', pwd: 'pwd — show the current folder',
    mkdir: 'mkdir [-p] folders… — create folders', rmdir: 'rmdir folders… — remove empty folders',
    rm: 'rm [-r] [-f] paths… — delete permanently', del: 'del paths… — move to the Recycle Bin', trash: 'trash [list|restore id|empty] — manage the Recycle Bin',
    cp: 'cp [-r] source… dest — copy', mv: 'mv source… dest — move or rename', touch: 'touch files… — create files or update their time',
    cat: 'cat [-n] files… — print files', echo: 'echo [-n] [-e] text… — print text', tree: 'tree [folder] — show a folder tree',
    find: 'find [folder] [-name pattern] [-type f|d] — find files', grep: 'grep [-i] [-n] [-v] [-c] [-r] pattern [files…] — search text',
    head: 'head [-n N] [files…]', tail: 'tail [-n N] [files…]', wc: 'wc [-l] [-w] [-c] [files…]', sort: 'sort [-r] [-n] [-u] [files…]', uniq: 'uniq [-c] [files…]',
    stat: 'stat paths… — file details', du: 'du [-h] [-s] [paths…] — disk usage', df: 'df [-h] — free space',
    basename: 'basename path', dirname: 'dirname path', realpath: 'realpath path',
    date: 'date — current date and time', whoami: 'whoami', hostname: 'hostname', uname: 'uname [-a]', uptime: 'uptime',
    ps: 'ps — list running apps (processes)', kill: 'kill PID… — end processes', apps: 'apps — list installed apps',
    open: 'open path — open a file or folder with its app', start: 'start app [args] — start an app by id or name',
    history: 'history [-c] — previous commands', clear: 'clear — clear the screen', env: 'env — list variables',
    export: 'export NAME=value', unset: 'unset NAME', alias: 'alias [name=command]', unalias: 'unalias name', which: 'which command',
    zip: 'zip archive.zip paths… — compress', unzip: 'unzip [-l] archive.zip [-d folder] — extract',
    curl: 'curl [-o file] URL — download (respects DonutOS network settings)', notify: 'notify title [body] — post a notification',
    sleep: 'sleep seconds', seq: 'seq [first] last', true: 'true', false: 'false', exit: 'exit — close this tab',
    sh: 'sh script.dsh [args] — run a DonutOS script', source: 'source script — run a script in this shell',
    js: 'js [-e code] [file.js] — JavaScript (in an isolated worker); just “js” starts a JS prompt',
    calc: 'calc expression — quick arithmetic', base64: 'base64 [-d] [files…]', edit: 'edit file — open a file in its app',
  };

  const c = {
    async help(args, io) {
      if (args[0]) { io.out(`${HELP[args[0]] || `No help for “${args[0]}”.`}\n`); return HELP[args[0]] ? 0 : 1; }
      io.out('DonutOS Terminal — commands:\n\n', 't-head');
      const names = Object.keys(HELP).sort();
      const width = Math.max(...names.map((n) => n.length)) + 2;
      for (const n of names) { io.out(n.padEnd(width), 't-cmd'); io.out(`${HELP[n].split(' — ')[1] || ''}\n`); }
      io.out('\nPipes (|), redirects (> >> < 2>), && || ; quotes, $VARS, ~ and * ? globs work as in other shells.\n', 't-dim');
      return 0;
    },

    async ls(args, io, sh) {
      const { flags, args: paths } = getopts(args, { bool: 'lah1Rt' });
      let status = 0;
      // Like other shells: file arguments are listed together first, then each folder under a heading.
      const files = [];
      const dirs = [];
      for (const t of paths.length ? paths : ['.']) {
        const st = await sh.fs.stat(sh.resolve(t));
        if (!st) { io.err(`ls: ${t}: No such file or folder\n`); status = 1; continue; }
        if (st.type === 'dir') dirs.push([t, st]); else files.push({ ...st, name: t });
      }
      const groups = [...(files.length ? [[null, files]] : []), ...dirs];
      const headings = groups.length > 1;
      for (const [i, [t, st]] of groups.entries()) {
        const list = t === null ? st : await sh.fs.readdir(st.path, { hidden: flags.a });
        list.sort(flags.t ? (a, b) => b.mtime - a.mtime : (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        if (headings && t !== null) io.out(`${i ? '\n' : ''}${t}:\n`, 't-head');
        if (!list.length) continue;
        if (flags.l) {
          for (const e of list) {
            const size = e.type === 'dir' ? '-' : flags.h ? formatBytes(e.size) : String(e.size);
            io.out(`${e.type === 'dir' ? 'd' : '-'}  ${pad(size, flags.h ? 9 : 10)}  ${dateStr(e.mtime)}  `);
            io.out(`${e.name}${e.type === 'dir' ? '/' : ''}\n`, e.type === 'dir' ? 't-dir' : e.kind === 'archive' ? 't-zip' : e.kind === 'image' ? 't-img' : null);
          }
        } else if (io.piped || flags['1']) {
          for (const e of list) io.out(`${e.name}\n`);
        } else {
          list.forEach((e, j) => io.out(`${e.name}${e.type === 'dir' ? '/' : ''}${j < list.length - 1 ? '  ' : '\n'}`, e.type === 'dir' ? 't-dir' : e.kind === 'archive' ? 't-zip' : e.kind === 'image' ? 't-img' : null));
        }
      }
      return status;
    },

    async cd(args, io, sh) {
      const target = args[0] === '-' ? sh.env.OLDPWD || sh.cwd : sh.resolve(args[0] || '~');
      const st = await sh.fs.stat(target);
      if (!st) { io.err(`cd: ${args[0]}: No such folder\n`); return 1; }
      if (st.type !== 'dir') { io.err(`cd: ${args[0]}: Not a folder\n`); return 1; }
      sh.env.OLDPWD = sh.cwd;
      sh.cwd = target;
      sh.env.PWD = target;
      return 0;
    },

    async pwd(args, io, sh) { io.out(`${sh.cwd}\n`); return 0; },

    async mkdir(args, io, sh) {
      const { flags, args: dirs } = getopts(args, { bool: 'p' });
      if (!dirs.length) { io.err('mkdir: missing folder name\n'); return 1; }
      for (const d of dirs) await sh.fs.mkdir(sh.resolve(d), { recursive: !!flags.p });
      return 0;
    },

    async rmdir(args, io, sh) {
      for (const d of args) {
        const p = sh.resolve(d);
        if (!(await sh.fs.isDir(p))) { io.err(`rmdir: ${d}: Not a folder\n`); return 1; }
        await sh.fs.remove(p, { recursive: false });
      }
      return 0;
    },

    async rm(args, io, sh) {
      const { flags, args: paths } = getopts(args, { bool: 'rRfiv' });
      if (!paths.length) { io.err('rm: missing operand\n'); return 1; }
      let status = 0;
      for (const t of paths) {
        const p = sh.resolve(t);
        const st = await sh.fs.stat(p);
        if (!st) { if (!flags.f) { io.err(`rm: ${t}: No such file or folder\n`); status = 1; } continue; }
        if (st.type === 'dir' && !(flags.r || flags.R)) { io.err(`rm: ${t}: Is a folder (use rm -r)\n`); status = 1; continue; }
        if (p === '/' || p === sh.home) { io.err(`rm: refusing to remove ${sh.display(p)}\n`); status = 1; continue; }
        await sh.fs.remove(p, { recursive: true });
        if (flags.v) io.out(`removed ${t}\n`);
      }
      return status;
    },

    async del(args, io, sh) {
      if (!args.length) { io.err('del: missing operand\n'); return 1; }
      for (const t of args) await sh.fs.trash(sh.resolve(t));
      return 0;
    },

    async trash(args, io, sh) {
      const [sub, id] = args;
      const items = await k.fs.listTrash(sh.home);
      if (!sub || sub === 'list') {
        if (!items.length) { io.out('The Recycle Bin is empty.\n'); return 0; }
        for (const it of items) io.out(`${it.id}  ${dateStr(it.deletedAt)}  ${sh.display(it.originalPath)}\n`);
        return 0;
      }
      if (sub === 'restore') {
        const it = items.find((x) => x.id === id || x.name === id);
        if (!it) { io.err(`trash: ${id}: not in the Recycle Bin\n`); return 1; }
        io.out(`restored to ${sh.display(await k.fs.restoreFromTrash(sh.home, it.id))}\n`);
        return 0;
      }
      if (sub === 'empty') { await k.fs.emptyTrash(sh.home); io.out(`Deleted ${items.length} item${items.length === 1 ? '' : 's'}.\n`); return 0; }
      io.err('usage: trash [list | restore ID | empty]\n');
      return 2;
    },

    async cp(args, io, sh) {
      const { flags, args: paths } = getopts(args, { bool: 'rRfv' });
      if (paths.length < 2) { io.err('cp: need a source and a destination\n'); return 1; }
      const dest = sh.resolve(paths.pop());
      const destIsDir = await sh.fs.isDir(dest);
      if (paths.length > 1 && !destIsDir) { io.err('cp: destination must be a folder when copying several items\n'); return 1; }
      for (const s of paths) {
        const src = sh.resolve(s);
        const st = await sh.fs.stat(src);
        if (!st) { io.err(`cp: ${s}: No such file or folder\n`); return 1; }
        if (st.type === 'dir' && !(flags.r || flags.R)) { io.err(`cp: ${s}: Is a folder (use cp -r)\n`); return 1; }
        const target = destIsDir ? P.join(dest, P.basename(src)) : dest;
        await sh.fs.copy(src, target, { overwrite: true });
        if (flags.v) io.out(`${s} -> ${sh.display(target)}\n`);
      }
      return 0;
    },

    async mv(args, io, sh) {
      const { flags, args: paths } = getopts(args, { bool: 'fvn' });
      if (paths.length < 2) { io.err('mv: need a source and a destination\n'); return 1; }
      const dest = sh.resolve(paths.pop());
      const destIsDir = await sh.fs.isDir(dest);
      if (paths.length > 1 && !destIsDir) { io.err('mv: destination must be a folder when moving several items\n'); return 1; }
      for (const s of paths) {
        const src = sh.resolve(s);
        const target = destIsDir ? P.join(dest, P.basename(src)) : dest;
        if (flags.n && (await sh.fs.exists(target))) continue;
        await sh.fs.move(src, target, { overwrite: true });
        if (flags.v) io.out(`${s} -> ${sh.display(target)}\n`);
      }
      return 0;
    },

    async touch(args, io, sh) {
      for (const f of args) {
        const p = sh.resolve(f);
        if (await sh.fs.exists(p)) await sh.fs.writeFile(p, await sh.fs.readFile(p));
        else await sh.fs.writeText(p, '');
      }
      return 0;
    },

    async cat(args, io, sh) {
      const { flags, args: files } = getopts(args, { bool: 'n' });
      for (const { text } of await inputs(sh, files, io)) {
        if (flags.n) lines(text).forEach((l, i) => io.out(`${pad(i + 1, 6)}  ${l}\n`));
        else io.out(text);
      }
      return 0;
    },

    async echo(args, io) {
      const { flags, args: words } = getopts(args, { bool: 'ne' });
      let text = words.join(' ');
      if (flags.e) text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
      io.out(flags.n ? text : `${text}\n`);
      return 0;
    },

    async tree(args, io, sh) {
      const root = sh.resolve(args[0] || '.');
      let dirs = 0, files = 0;
      io.out(`${sh.display(root)}\n`, 't-dir');
      const walk = async (dir, prefix) => {
        checkAbort(io);
        const list = (await sh.fs.readdir(dir)).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
        for (const [i, e] of list.entries()) {
          const lastOne = i === list.length - 1;
          io.out(`${prefix}${lastOne ? '└── ' : '├── '}`);
          io.out(`${e.name}\n`, e.type === 'dir' ? 't-dir' : null);
          if (e.type === 'dir') { dirs++; await walk(e.path, prefix + (lastOne ? '    ' : '│   ')); } else files++;
        }
      };
      await walk(root, '');
      io.out(`\n${dirs} folder${dirs === 1 ? '' : 's'}, ${files} file${files === 1 ? '' : 's'}\n`, 't-dim');
      return 0;
    },

    async find(args, io, sh) {
      let root = '.';
      const opts = { name: null, type: null };
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-name' || args[i] === '-iname') opts.name = args[++i];
        else if (args[i] === '-type') opts.type = args[++i];
        else root = args[i];
      }
      const base = sh.resolve(root);
      const re = opts.name ? new RegExp(`^${opts.name.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i') : null;
      const show = (p) => (root.startsWith('/') ? p : `./${P.isInside(sh.cwd, p) ? p.slice(sh.cwd === '/' ? 1 : sh.cwd.length + 1) : p}`);
      await sh.fs.walk(base, (e) => {
        checkAbort(io);
        if (re && !re.test(e.name)) return;
        if (opts.type === 'f' && e.type !== 'file') return;
        if (opts.type === 'd' && e.type !== 'dir') return;
        io.out(`${show(e.path)}\n`);
      });
      return 0;
    },

    async grep(args, io, sh) {
      const { flags, args: rest } = getopts(args, { bool: 'invcrlE' });
      const [pattern, ...files] = rest;
      if (pattern === undefined) { io.err('usage: grep [-invcr] pattern [files…]\n'); return 2; }
      let re;
      try { re = new RegExp(pattern, flags.i ? 'i' : ''); } catch { re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags.i ? 'i' : ''); }
      let sources;
      if (flags.r) {
        sources = [];
        for (const f of files.length ? files : ['.']) {
          const p = sh.resolve(f);
          if (await sh.fs.isDir(p)) await sh.fs.walk(p, (e) => { if (e.type === 'file' && e.kind === 'text') sources.push(e.path); });
          else sources.push(p);
        }
        sources = await Promise.all(sources.map(async (p) => ({ name: sh.display(p), text: await sh.fs.readText(p).catch(() => '') })));
      } else sources = await inputs(sh, files, io);
      const multi = sources.length > 1;
      let found = 0;
      for (const s of sources) {
        checkAbort(io);
        let count = 0;
        lines(s.text).forEach((l, i) => {
          const hit = re.test(l) !== !!flags.v;
          if (!hit) return;
          count++; found++;
          if (flags.c || flags.l) return;
          if (multi) io.out(`${s.name}:`, 't-dir');
          if (flags.n) io.out(`${i + 1}:`, 't-dim');
          io.out(`${l}\n`);
        });
        if (flags.c) io.out(`${multi ? `${s.name}:` : ''}${count}\n`);
        if (flags.l && count) io.out(`${s.name}\n`);
      }
      return found ? 0 : 1;
    },

    async head(args, io, sh) {
      const { flags, args: files } = getopts(args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a)), { str: 'n' });
      const n = Number(flags.n ?? 10);
      for (const { text } of await inputs(sh, files, io)) io.out(lines(text).slice(0, n).join('\n') + '\n');
      return 0;
    },

    async tail(args, io, sh) {
      const { flags, args: files } = getopts(args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a)), { str: 'n' });
      const n = Number(flags.n ?? 10);
      for (const { text } of await inputs(sh, files, io)) io.out(lines(text).slice(-n).join('\n') + '\n');
      return 0;
    },

    async wc(args, io, sh) {
      const { flags, args: files } = getopts(args, { bool: 'lwc' });
      const all = !flags.l && !flags.w && !flags.c;
      for (const { name, text } of await inputs(sh, files, io)) {
        const parts = [];
        if (all || flags.l) parts.push(pad(text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0, 7));
        if (all || flags.w) parts.push(pad(text.split(/\s+/).filter(Boolean).length, 7));
        if (all || flags.c) parts.push(pad(new TextEncoder().encode(text).length, 7));
        io.out(`${parts.join(' ')}${name !== '-' ? ` ${name}` : ''}\n`);
      }
      return 0;
    },

    async sort(args, io, sh) {
      const { flags, args: files } = getopts(args, { bool: 'rnuf' });
      let all = (await inputs(sh, files, io)).flatMap((s) => lines(s.text));
      all.sort(flags.n ? (a, b) => parseFloat(a) - parseFloat(b) : (a, b) => (flags.f ? a.toLowerCase().localeCompare(b.toLowerCase()) : a < b ? -1 : a > b ? 1 : 0));
      if (flags.r) all.reverse();
      if (flags.u) all = all.filter((l, i) => i === 0 || l !== all[i - 1]);
      io.out(all.join('\n') + '\n');
      return 0;
    },

    async uniq(args, io, sh) {
      const { flags, args: files } = getopts(args, { bool: 'c' });
      const all = (await inputs(sh, files, io)).flatMap((s) => lines(s.text));
      const out = [];
      for (const l of all) { if (out.length && out[out.length - 1][0] === l) out[out.length - 1][1]++; else out.push([l, 1]); }
      io.out(out.map(([l, n]) => (flags.c ? `${pad(n, 7)} ${l}` : l)).join('\n') + '\n');
      return 0;
    },

    async stat(args, io, sh) {
      for (const t of args) {
        const st = await sh.fs.stat(sh.resolve(t));
        if (!st) { io.err(`stat: ${t}: No such file or folder\n`); return 1; }
        io.out(`  File: ${st.path}\n  Type: ${st.type === 'dir' ? 'folder' : `${st.mime}`}\n  Size: ${st.size} bytes (${formatBytes(st.size)})\nCreated: ${new Date(st.ctime).toLocaleString()}\nModified: ${new Date(st.mtime).toLocaleString()}\n`);
      }
      return 0;
    },

    async du(args, io, sh) {
      const { flags, args: paths } = getopts(args, { bool: 'hs' });
      for (const t of paths.length ? paths : ['.']) {
        const p = sh.resolve(t);
        if (flags.s || !(await sh.fs.isDir(p))) {
          const d = await sh.fs.du(p);
          io.out(`${pad(flags.h ? formatBytes(d.size) : Math.ceil(d.size / 1024), 9)}  ${t}\n`);
          continue;
        }
        for (const e of await sh.fs.readdir(p)) {
          const d = e.type === 'dir' ? await sh.fs.du(e.path) : { size: e.size };
          io.out(`${pad(flags.h ? formatBytes(d.size) : Math.ceil(d.size / 1024), 9)}  ${t === '.' ? '' : `${t.replace(/\/+$/, '')}/`}${e.name}\n`);
        }
      }
      return 0;
    },

    async df(args, io) {
      const u = await k.fs.usage();
      const h = args.includes('-h');
      const f = (n) => (h ? formatBytes(n) : String(Math.round(n / 1024)));
      io.out(`${'Size'.padStart(10)} ${'Used'.padStart(10)} ${'Free'.padStart(10)}  Use%  Mounted on\n`, 't-head');
      io.out(`${f(u.total).padStart(10)} ${f(u.used).padStart(10)} ${f(u.total - u.used).padStart(10)}  ${pad(u.total ? Math.round((u.used / u.total) * 100) : 0, 3)}%  /\n`);
      return 0;
    },

    async basename(args, io) { io.out(`${P.basename(args[0] || '', args[1])}\n`); return 0; },
    async dirname(args, io) { io.out(`${P.dirname(args[0] || '.')}\n`); return 0; },
    async realpath(args, io, sh) { io.out(`${sh.resolve(args[0] || '.')}\n`); return 0; },
    async date(args, io) { io.out(`${new Date().toString()}\n`); return 0; },
    async whoami(args, io) { io.out(`${user().name}\n`); return 0; },
    async hostname(args, io) { io.out(`${deviceName()}\n`); return 0; },
    async uname(args, io) {
      const info = k.info;
      io.out(args.includes('-a') ? `${['DonutOS', deviceName(), k.version, info.platform, info.os, info.arch].filter(Boolean).join(' ')}\n` : 'DonutOS\n');
      return 0;
    },
    async uptime(args, io) {
      const s = Math.floor((Date.now() - k.bootTime) / 1000);
      io.out(`up ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s, ${k.sessions.size} user${k.sessions.size === 1 ? '' : 's'} signed in\n`);
      return 0;
    },

    async ps(args, io) {
      const list = await ctx.processes.list();
      io.out(`${'PID'.padStart(5)}  ${'CPU%'.padStart(5)}  ${'MEM'.padStart(9)}  NAME\n`, 't-head');
      for (const p of list) io.out(`${pad(p.pid, 5)}  ${pad(p.cpu.toFixed(1), 5)}  ${pad(formatBytes(p.memory), 9)}  ${p.name}${p.critical ? ' (system)' : ''}${p.pid === ctx.pid ? ' (this terminal)' : ''}\n`);
      return 0;
    },

    async kill(args, io) {
      if (!args.length) { io.err('usage: kill PID…\n'); return 2; }
      let status = 0;
      for (const a of args.filter((x) => !x.startsWith('-'))) {
        try { await ctx.processes.kill(Number(a)); } catch (e) { io.err(`kill: ${a}: ${e.message}\n`); status = 1; }
      }
      return status;
    },

    async apps(args, io) {
      for (const a of k.registry.list()) io.out(`${a.id.padEnd(16)} ${a.name}\n`);
      return 0;
    },

    async open(args, io, sh) {
      if (!args[0]) { io.err('usage: open path\n'); return 2; }
      const p = sh.resolve(args[0]);
      if (!(await sh.fs.exists(p))) { io.err(`open: ${args[0]}: No such file or folder\n`); return 1; }
      const proc = await ctx.open(p).catch((e) => { io.err(`open: ${e.message}\n`); return undefined; });
      if (proc === null) io.err(`open: no app can open ${P.extname(p) || 'this file'} files\n`);
      return proc ? 0 : 1;
    },

    async start(args, io) {
      const [name, ...rest] = args;
      if (!name) { io.err('usage: start app [args]\n'); return 2; }
      const app = k.registry.get(name) || k.registry.list().find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (!app) { io.err(`start: no app called “${name}”. Try “apps”.\n`); return 1; }
      await ctx.launch(app.id, rest.length ? { argv: rest } : {});
      return 0;
    },

    async edit(args, io, sh) { return c.open(args, io, sh); },

    async history(args, io) {
      if (args.includes('-c')) { term.clearHistory(); return 0; }
      term.history().forEach((h, i) => io.out(`${pad(i + 1, 5)}  ${h}\n`));
      return 0;
    },
    async clear() { term.clearScreen(); return 0; },
    async cls() { term.clearScreen(); return 0; },
    async env(args, io, sh) { for (const [kk, v] of Object.entries(sh.env)) io.out(`${kk}=${v}\n`); return 0; },
    async export(args, io, sh) {
      for (const a of args) { const i = a.indexOf('='); if (i > 0) sh.env[a.slice(0, i)] = a.slice(i + 1); }
      term.saveEnv();
      return 0;
    },
    async unset(args, io, sh) { for (const a of args) delete sh.env[a]; term.saveEnv(); return 0; },
    async alias(args, io, sh) {
      if (!args.length) { for (const [n, v] of Object.entries(sh.aliases)) io.out(`alias ${n}='${v}'\n`); return 0; }
      for (const a of args) {
        const i = a.indexOf('=');
        if (i < 0) { io.out(sh.aliases[a] ? `alias ${a}='${sh.aliases[a]}'\n` : `alias: ${a}: not found\n`); continue; }
        sh.aliases[a.slice(0, i)] = a.slice(i + 1);
      }
      term.saveEnv();
      return 0;
    },
    async unalias(args, io, sh) { for (const a of args) delete sh.aliases[a]; term.saveEnv(); return 0; },
    async which(args, io, sh) {
      let status = 0;
      for (const a of args) {
        if (sh.aliases[a]) io.out(`${a}: alias for “${sh.aliases[a]}”\n`);
        else if (sh.commands[a]) io.out(`${a}: built-in command\n`);
        else { io.err(`${a}: not found\n`); status = 1; }
      }
      return status;
    },

    async zip(args, io, sh) {
      // Folders are always included with everything inside them, so -r/-q are accepted and ignored.
      const [archive, ...paths] = args.filter((a) => a !== '-r' && a !== '-q' && a !== '-rq');
      if (!archive || !paths.length) { io.err('usage: zip archive.zip paths…\n'); return 2; }
      const bytes = await zipPaths(sh.fs, paths.map((p) => sh.resolve(p)), { signal: io.signal, onProgress: (d, t) => term.status(`zip: ${d}/${t}`) });
      await sh.fs.writeFile(sh.resolve(archive.endsWith('.zip') ? archive : `${archive}.zip`), bytes);
      term.status('');
      io.out(`created ${archive} (${formatBytes(bytes.length)})\n`);
      return 0;
    },

    async unzip(args, io, sh) {
      const { flags, args: rest } = getopts(args, { bool: 'l', str: 'd' });
      const [archive] = rest;
      if (!archive) { io.err('usage: unzip [-l] archive.zip [-d folder]\n'); return 2; }
      const bytes = await sh.fs.readFile(sh.resolve(archive));
      if (flags.l) {
        for (const e of await listZip(bytes)) io.out(`${pad(e.dir ? '' : e.size, 10)}  ${e.name}${e.dir ? '/' : ''}\n`);
        return 0;
      }
      const dest = sh.resolve(flags.d || P.basename(archive).replace(/\.zip$/i, ''));
      const n = await unzipTo(sh.fs, bytes, dest, { signal: io.signal, onProgress: (d, t) => term.status(`unzip: ${d}/${t}`) });
      term.status('');
      io.out(`extracted ${n} item${n === 1 ? '' : 's'} to ${sh.display(dest)}\n`);
      return 0;
    },

    async curl(args, io, sh) {
      const { flags, args: rest } = getopts(args, { bool: 'sIL', str: 'o' });
      const url = rest[0];
      if (!url) { io.err('usage: curl [-o file] URL\n'); return 2; }
      if (!ctx.net.online()) { io.err('curl: DonutOS is offline (Quick Settings › Wi-Fi / Airplane mode)\n'); return 6; }
      let res;
      try { res = await ctx.net.fetch(url, { signal: io.signal }); }
      catch (e) { io.err(`curl: ${e.name === 'TypeError' ? 'the site couldn’t be reached, or it doesn’t allow downloads from other sites (CORS)' : e.message}\n`); return 7; }
      if (flags.I) { io.out(`HTTP ${res.status} ${res.statusText}\n`); res.headers.forEach((v, kk) => io.out(`${kk}: ${v}\n`)); return 0; }
      if (flags.o) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        await sh.fs.writeFile(sh.resolve(flags.o), bytes);
        if (!flags.s) io.out(`saved ${formatBytes(bytes.length)} to ${flags.o}\n`);
      } else io.out(await res.text());
      return res.ok ? 0 : 22;
    },
    async wget(args, io, sh) {
      const url = args.find((a) => !a.startsWith('-'));
      const name = (url || '').split('?')[0].split('/').filter(Boolean).pop() || 'index.html';
      return c.curl(['-o', name, ...args], io, sh);
    },

    async notify(args, io) {
      const n = await ctx.notify({ title: args[0] || 'Terminal', body: args.slice(1).join(' ') });
      if (!n) io.err('notify: notifications are turned off\n');
      return n ? 0 : 1;
    },

    async sleep(args, io) {
      const ms = Number(args[0] || 1) * 1000;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        io.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
      });
      return 0;
    },

    async seq(args, io) {
      const nums = args.map(Number);
      const [first, last] = nums.length > 1 ? nums : [1, nums[0] ?? 1];
      const out = [];
      for (let i = first; first <= last ? i <= last : i >= last; i += first <= last ? 1 : -1) { out.push(i); if (out.length > 100000) break; }
      io.out(out.join('\n') + '\n');
      return 0;
    },

    async true() { return 0; },
    async false() { return 1; },
    async exit(args) { term.closeTab(); return Number(args[0] || 0); },

    async calc(args, io) {
      const expr = args.join(' ');
      if (!/^[\d\s+\-*/%().,^e]+$/i.test(expr)) { io.err('calc: only numbers and + - * / % ^ ( ) are allowed\n'); return 1; }
      // eslint-disable-next-line no-new-func
      const v = Function(`"use strict"; return (${expr.replace(/\^/g, '**').replace(/,/g, '.')})`)();
      io.out(`${Number.isFinite(v) ? +v.toPrecision(15) : v}\n`);
      return 0;
    },

    async base64(args, io, sh) {
      const { flags, args: files } = getopts(args, { bool: 'd' });
      for (const { text } of await inputs(sh, files, io)) {
        if (flags.d) io.out(new TextDecoder().decode(Uint8Array.from(atob(text.trim()), (ch) => ch.charCodeAt(0))));
        else io.out(`${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}\n`);
      }
      return 0;
    },

    async sh(args, io, shell) { return term.runScript(args[0], args.slice(1), io, { subshell: true, shell }); },
    async source(args, io, shell) { return term.runScript(args[0], args.slice(1), io, { subshell: false, shell }); },
    async js(args, io, shell) { return term.js(args, io, shell); },
  };
  c['.'] = c.source;
  c.dir = c.ls;
  c.copy = c.cp;
  c.move = c.mv;
  c.type = c.cat;
  return c;
}
