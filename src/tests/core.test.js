// Core test suite. Runs against whichever platform adapter is active (web or desktop),
// so the same tests prove both builds behave identically. All data is written under a
// throw-away folder and "test:" keys, and removed afterwards.

import { test, assert, run } from './harness.js';
import { createPlatform } from '../platform/index.js';
import { assertAdapter } from '../platform/adapter.js';
import { createKernel } from '../core/kernel.js';
import { EventBus } from '../core/event-bus.js';
import { SettingsStore } from '../core/settings.js';
import { validateManifest, AppRegistry } from '../core/registry.js';
import * as P from '../core/path.js';
import { sleep } from '../core/util.js';
import { tokenize, parse, Shell, getopts, ShellSyntaxError } from '../apps/terminal/shell.js';
import { describe as a11yDescribe } from '../ui/a11y-name.js';
import { correctionMatrix } from '../shell/a11y/color-filters.js';
import { a11yGet } from '../shell/a11y/prefs.js';
import { performKey } from '../shell/a11y/edit-actions.js';
import { setScreenView, screenToPage, visiblePage } from '../ui/screen.js';
import { applyTheme } from '../shell/theme.js';
import { CONTRAST_THEMES } from '../shell/a11y/contrast.js';

globalThis.DONUT_NO_SW = true;
const platform = createPlatform({ dbName: 'donutos-tests' });
const kernel = createKernel({ platform });
const RUN = Math.random().toString(36).slice(2, 8);
const T = `/__tests__${RUN}`;          // scratch folder
const USER = { id: `test-${RUN}`, name: 'Test User', home: `${T}/home`, isGuest: false };
const prefixedKv = {
  get: (k) => platform.kv.get(`test:${RUN}:${k}`),
  set: (k, v) => platform.kv.set(`test:${RUN}:${k}`, v),
  delete: (k) => platform.kv.delete(`test:${RUN}:${k}`),
  keys: async (p = '') => (await platform.kv.keys(`test:${RUN}:${p}`)).map((k) => k.slice(`test:${RUN}:`.length)),
};
const testApps = [];
const app = (id, extra = {}) => {
  const full = `test.${RUN}.${id}`;
  testApps.push(full);
  return { id: full, name: `Test ${id}`, version: '1.0.0', ...extra };
};

// ── Platform adapter ───────────────────────────────────────────────────

test('adapter implements the full interface', () => { assertAdapter(platform); });

test('kernel boots', async () => {
  await kernel.boot();
  assert.ok(kernel.booted);
  assert.ok(await kernel.fs.isDir('/Users/Public/Documents'), 'standard folders exist');
  const v = await kernel.fs.readJSON('/System/version.json');
  assert.equal(v.version, kernel.version);
  await kernel.fs.mkdir(T);
});

test('adapter info has the documented shape', async () => {
  const i = await platform.info();
  assert.equal(i.platform, platform.name);
  for (const k of ['os', 'arch', 'hostname', 'cpuModel', 'engine', 'appVersion']) assert.equal(typeof i[k], 'string', k);
  assert.ok(i.cores >= 1);
});

test('system stats report cpu, memory, disk and uptime', async () => {
  const s = await platform.system.stats();
  assert.equal(typeof s.estimated, 'boolean');
  assert.ok(s.cpu.usage >= 0 && s.cpu.usage <= 100, 'cpu 0-100');
  assert.ok(s.cpu.cores >= 1);
  assert.ok(s.memory.used >= 0 && typeof s.memory.label === 'string');
  assert.ok(s.disk.total >= 0 && s.disk.used >= 0);
  assert.ok(s.uptime >= 0);
});

test('battery and network have the documented shape', async () => {
  const b = await platform.system.battery();
  assert.equal(typeof b.supported, 'boolean');
  assert.ok(b.level >= 0 && b.level <= 1);
  const n = await platform.system.network();
  assert.equal(typeof n.online, 'boolean');
  assert.ok(['wifi', 'ethernet', 'cellular', 'none', 'unknown'].includes(n.type), n.type);
  assert.ok(Array.isArray(n.interfaces));
  const off = platform.system.onNetworkChange(() => {}); off();
});

test('update channel reports a status', () => {
  const u = platform.updates.status();
  assert.ok(['idle', 'checking', 'available', 'downloading', 'ready', 'up-to-date', 'error', 'unsupported'].includes(u.state), u.state);
});

test('key-value store round-trips JSON', async () => {
  await prefixedKv.set('a', { x: [1, 2, { y: 'z' }] });
  assert.deepEqual(await prefixedKv.get('a'), { x: [1, 2, { y: 'z' }] });
  assert.deepEqual(await prefixedKv.keys(''), ['a']);
  await prefixedKv.delete('a');
  assert.equal(await prefixedKv.get('a'), undefined);
});

// ── Paths ─────────────────────────────────────────────────────────────

test('path utilities', () => {
  assert.equal(P.normalize('/a/./b/../c//d/'), '/a/c/d');
  assert.equal(P.normalize('../../x'), '/x');
  assert.equal(P.join('/a', 'b', '../c'), '/a/c');
  assert.equal(P.resolve('/home/u', 'docs/x.txt'), '/home/u/docs/x.txt');
  assert.equal(P.resolve('/home/u', '/etc'), '/etc');
  assert.equal(P.dirname('/a/b/c.txt'), '/a/b');
  assert.equal(P.dirname('/a'), '/');
  assert.equal(P.basename('/a/b/c.txt'), 'c.txt');
  assert.equal(P.basename('/a/b/c.txt', '.txt'), 'c');
  assert.equal(P.extname('/a/Photo.JPG'), '.jpg');
  assert.equal(P.extname('/a/.hidden'), '');
  assert.ok(P.isInside('/a', '/a/b'));
  assert.ok(!P.isInside('/a', '/ab'));
  assert.ok(P.validateName('bad/name'));
  assert.ok(P.validateName('trailing.'));
  assert.equal(P.validateName('Good name (2).txt'), null);
});

// ── Event bus ─────────────────────────────────────────────────────────

test('event bus: exact, namespace and global subscriptions', () => {
  const b = new EventBus();
  const seen = [];
  b.on('fs:changed', () => seen.push('exact'));
  b.on('fs:*', () => seen.push('ns'));
  b.on('*', () => seen.push('all'));
  b.on('process:exit', () => seen.push('other'));
  assert.equal(b.emit('fs:changed', {}), 3);
  assert.deepEqual(seen, ['exact', 'ns', 'all']);
});

test('event bus: once, unsubscribe, owners and error isolation', () => {
  const b = new EventBus();
  let n = 0;
  b.once('x:y', () => n++);
  b.emit('x:y'); b.emit('x:y');
  assert.equal(n, 1);
  const off = b.on('x:y', () => n++); off(); b.emit('x:y');
  assert.equal(n, 1);
  b.on('x:y', () => { throw new Error('boom'); });
  b.on('x:y', () => n++, { owner: 42 });
  b.on('x:z', () => n++, { owner: 42 });
  b.emit('x:y');
  assert.equal(n, 2, 'a throwing handler does not stop the others');
  assert.equal(b.offOwner(42), 2);
  b.emit('x:y'); b.emit('x:z');
  assert.equal(n, 2);
});

test('event bus: waitFor resolves with the payload', async () => {
  const b = new EventBus();
  setTimeout(() => b.emit('a:b', 7), 5);
  assert.equal(await b.waitFor('a:b', { timeout: 500 }), 7);
  await assert.rejects(b.waitFor('never:happens', { timeout: 20 }));
});

// ── File system primitives (adapter) ──────────────────────────────────

test('fs: create, read, stat and list', async () => {
  const fs = platform.fs;
  await fs.mkdir(`${T}/p`);
  await fs.writeFile(`${T}/p/hello.txt`, new TextEncoder().encode('héllo 🍩'));
  const s = await fs.stat(`${T}/p/hello.txt`);
  assert.equal(s.type, 'file');
  assert.equal(s.name, 'hello.txt');
  assert.equal(s.size, new TextEncoder().encode('héllo 🍩').length);
  assert.ok(s.mtime > 0);
  assert.equal(new TextDecoder().decode(await fs.readFile(`${T}/p/hello.txt`)), 'héllo 🍩');
  const list = await fs.readdir(`${T}/p`);
  assert.deepEqual(list.map((e) => e.name), ['hello.txt']);
  assert.equal(await fs.stat(`${T}/p/missing`), null);
});

test('fs: binary data survives a round trip', async () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 31) % 256);
  await platform.fs.writeFile(`${T}/p/bin.dat`, bytes);
  const back = await platform.fs.readFile(`${T}/p/bin.dat`);
  assert.equal(back.length, bytes.length);
  assert.ok(back.every((v, i) => v === bytes[i]));
});

test('fs: error codes match on every platform', async () => {
  const fs = platform.fs;
  await assert.rejects(fs.readFile(`${T}/nope.txt`), 'ENOENT');
  await assert.rejects(fs.mkdir(`${T}/p`), 'EEXIST');
  await assert.rejects(fs.mkdir(`${T}/no/such/parent`), 'ENOENT');
  await assert.rejects(fs.readFile(`${T}/p`), 'EISDIR');
  await assert.rejects(fs.readdir(`${T}/p/hello.txt`), 'ENOTDIR');
  await assert.rejects(fs.writeFile(`${T}/p/hello.txt/x`, new Uint8Array(1)), 'ENOTDIR');
  await assert.rejects(fs.remove(`${T}/p`, { recursive: false }), 'ENOTEMPTY');
  await assert.rejects(fs.rename(`${T}/p/hello.txt`, `${T}/p/bin.dat`), 'EEXIST');
  await assert.rejects(fs.copy(`${T}/p/hello.txt`, `${T}/p/bin.dat`), 'EEXIST');
});

test('fs: renaming a folder moves everything inside it', async () => {
  const fs = platform.fs;
  await fs.mkdir(`${T}/r`); await fs.mkdir(`${T}/r/sub`);
  await fs.writeFile(`${T}/r/sub/a.txt`, new TextEncoder().encode('A'));
  await fs.rename(`${T}/r`, `${T}/r2`);
  assert.equal(await fs.stat(`${T}/r`), null);
  assert.equal(new TextDecoder().decode(await fs.readFile(`${T}/r2/sub/a.txt`)), 'A');
  await assert.rejects(fs.rename(`${T}/r2`, `${T}/r2/sub/inside`), 'EINVAL');
});

test('fs: recursive copy and remove', async () => {
  const fs = platform.fs;
  await fs.copy(`${T}/r2`, `${T}/r3`);
  assert.equal(new TextDecoder().decode(await fs.readFile(`${T}/r3/sub/a.txt`)), 'A');
  assert.ok(await fs.stat(`${T}/r2/sub/a.txt`), 'source kept');
  await fs.remove(`${T}/r3`, { recursive: true });
  assert.equal(await fs.stat(`${T}/r3/sub/a.txt`), null);
  assert.equal(await fs.stat(`${T}/r3`), null);
});

test('fs: usage reports numbers', async () => {
  const u = await platform.fs.usage();
  assert.ok(u.used >= 0 && u.total >= 0);
});

// ── VFS ───────────────────────────────────────────────────────────────

test('vfs: text, JSON, recursive mkdir and change events', async () => {
  const events = [];
  const off = kernel.bus.on('fs:changed', (e) => events.push(e.op));
  await kernel.fs.writeText(`${T}/v/deep/note.txt`, 'one', { mkdirp: true });
  await kernel.fs.appendText(`${T}/v/deep/note.txt`, ' two');
  assert.equal(await kernel.fs.readText(`${T}/v/deep/note.txt`), 'one two');
  await kernel.fs.writeJSON(`${T}/v/data.json`, { a: 1 });
  assert.deepEqual(await kernel.fs.readJSON(`${T}/v/data.json`), { a: 1 });
  assert.equal(await kernel.fs.readJSON(`${T}/v/missing.json`, 'fallback'), 'fallback');
  off();
  assert.ok(events.includes('create') && events.includes('modify'));
  const e = await kernel.fs.stat(`${T}/v/data.json`);
  assert.equal(e.kind, 'text'); assert.equal(e.mime, 'application/json');
});

test('vfs: invalid names are rejected', async () => {
  await assert.rejects(kernel.fs.writeText(`${T}/v/bad:name.txt`, 'x'), 'EINVAL');
  await assert.rejects(kernel.fs.rename(`${T}/v/data.json`, 'a/b'), 'EINVAL');
});

test('vfs: unique names, move with overwrite, copy into itself refused', async () => {
  assert.equal(await kernel.fs.uniqueName(`${T}/v`, 'data.json'), 'data (2).json');
  assert.equal(await kernel.fs.uniqueName(`${T}/v`, 'fresh.txt'), 'fresh.txt');
  await kernel.fs.writeText(`${T}/v/a.txt`, 'A');
  await kernel.fs.writeText(`${T}/v/b.txt`, 'B');
  await assert.rejects(kernel.fs.move(`${T}/v/a.txt`, `${T}/v/b.txt`), 'EEXIST');
  await kernel.fs.move(`${T}/v/a.txt`, `${T}/v/b.txt`, { overwrite: true });
  assert.equal(await kernel.fs.readText(`${T}/v/b.txt`), 'A');
  await assert.rejects(kernel.fs.copy(`${T}/v`, `${T}/v/deep/v`), 'EINVAL');
  await assert.rejects(kernel.fs.move(`${T}/v`, `${T}/v/deep/v`), 'EINVAL');
});

test('vfs: hidden files are skipped unless asked for', async () => {
  await kernel.fs.writeText(`${T}/v/.secret`, 's');
  assert.ok(!(await kernel.fs.readdir(`${T}/v`)).some((e) => e.name === '.secret'));
  assert.ok((await kernel.fs.readdir(`${T}/v`, { hidden: true })).some((e) => e.name === '.secret'));
});

test('vfs: search finds names and contents', async () => {
  await kernel.fs.writeText(`${T}/v/deep/recipe.md`, 'Mix flour with sugar and fry the donut dough.');
  const byName = await kernel.fs.search(T, 'recipe');
  assert.ok(byName.some((r) => r.match === 'name' && r.entry.name === 'recipe.md'));
  const byContent = await kernel.fs.search(T, 'donut dough');
  assert.equal(byContent.length, 1);
  assert.equal(byContent[0].match, 'content');
  assert.ok(byContent[0].snippet.includes('donut dough'));
});

test('vfs: disk usage of a folder', async () => {
  const d = await kernel.fs.du(`${T}/v`);
  assert.ok(d.files >= 4 && d.dirs >= 1 && d.size > 0);
});

test('recycle bin: delete, list, restore and empty', async () => {
  const home = `${T}/binhome`;
  await kernel.fs.writeText(`${home}/Documents/plan.txt`, 'secret plan', { mkdirp: true });
  await kernel.fs.mkdir(`${home}/Documents/Folder/Inner`, { recursive: true });
  const info = await kernel.fs.moveToTrash(`${home}/Documents/plan.txt`, home);
  await kernel.fs.moveToTrash(`${home}/Documents/Folder`, home);
  assert.ok(!(await kernel.fs.exists(`${home}/Documents/plan.txt`)));
  const items = await kernel.fs.listTrash(home);
  assert.equal(items.length, 2);
  assert.equal(items.find((i) => i.id === info.id).originalPath, `${home}/Documents/plan.txt`);
  // Something new now occupies the old name: restore must not overwrite it.
  await kernel.fs.writeText(`${home}/Documents/plan.txt`, 'new');
  const restored = await kernel.fs.restoreFromTrash(home, info.id);
  assert.equal(restored, `${home}/Documents/plan (2).txt`);
  assert.equal(await kernel.fs.readText(restored), 'secret plan');
  assert.equal((await kernel.fs.listTrash(home)).length, 1);
  await kernel.fs.emptyTrash(home);
  assert.equal((await kernel.fs.listTrash(home)).length, 0);
});

// ── Settings ──────────────────────────────────────────────────────────

test('settings: defaults, validation and persistence', async () => {
  const bus = new EventBus();
  const s = new SettingsStore({ kv: prefixedKv, bus });
  await s.loadSystem();
  assert.equal(s.get('system.deviceName'), 'DONUT-PC');
  assert.throws(() => s.get('no.such.key'), 'ESETTING');
  assert.throws(() => s.set('system.deviceName', 5), 'ESETTING');
  assert.throws(() => s.set('appearance.theme', 'dark'), 'ESETTING'); // no user signed in yet
  s.set('system.deviceName', 'KITCHEN');
  await s.loadUser('u1');
  assert.equal(s.get('appearance.theme'), 'dark');
  assert.throws(() => s.set('appearance.theme', 'purple'), 'ESETTING');
  assert.throws(() => s.set('qs.volume', 101), 'ESETTING');
  assert.throws(() => s.set('appearance.accent', 'red'), 'ESETTING');
  s.set('appearance.theme', 'light');
  s.set('wm.bounds.notepad', { x: 1, y: 2, w: 300, h: 200 });
  await s.flush();
  const again = new SettingsStore({ kv: prefixedKv, bus: new EventBus() });
  await again.loadSystem();
  await again.loadUser('u1');
  assert.equal(again.get('system.deviceName'), 'KITCHEN');
  assert.equal(again.get('appearance.theme'), 'light');
  assert.deepEqual(again.get('wm.bounds.notepad'), { x: 1, y: 2, w: 300, h: 200 });
  await again.loadUser('u2');
  assert.equal(again.get('appearance.theme'), 'dark', 'each user has their own settings');
  assert.equal(await again.peekUser('u1', 'appearance.theme'), 'light');
  await prefixedKv.delete('settings:system');
  await prefixedKv.delete('settings:user:u1');
});

test('settings: watch, reset and returned copies are isolated', async () => {
  const bus = new EventBus();
  const s = new SettingsStore({ kv: prefixedKv, bus });
  await s.loadSystem(); await s.loadUser('w');
  const seen = [];
  const off = s.watch('qs.*', (v, k) => seen.push(`${k}=${v}`));
  s.set('qs.volume', 30);
  s.set('qs.volume', 30); // unchanged: no event
  s.set('appearance.theme', 'light');
  s.reset('qs.volume');
  off();
  assert.deepEqual(seen, ['qs.volume=30', 'qs.volume=70']);
  const pinned = s.get('taskbar.pinned');
  pinned.push('mutated');
  assert.ok(!s.get('taskbar.pinned').includes('mutated'));
  await s.flush();
  await prefixedKv.delete('settings:user:w');
});

// ── Registry, permissions, associations ───────────────────────────────

test('manifest validation explains what is wrong', () => {
  assert.deepEqual(validateManifest({ id: 'good.app', name: 'Good', version: '1.2.3', entry: 'x.js' }), []);
  const errs = validateManifest({ id: 'Bad ID', name: '', version: 'one', permissions: ['teleport'], fileTypes: ['txt'] });
  assert.ok(errs.length >= 5, errs.join('; '));
});

test('session: signing in loads the user and creates their folders', async () => {
  await kernel.setSessionUser(USER);
  assert.equal(kernel.settings.currentUser, USER.id);
  for (const f of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']) assert.ok(await kernel.fs.isDir(`${USER.home}/${f}`), f);
});

test('permissions: undeclared, system, prompted and master switch', async () => {
  const sys = kernel.registry.register(app('sys', { module: { default() {} }, permissions: ['camera', 'files.read'] }), { builtin: true });
  const third = kernel.registry.register(app('third', { module: { default() {} }, permissions: ['files.read', 'camera', 'notifications'] }));
  assert.equal(kernel.permissions.status(sys.id, 'files.read'), 'granted');
  assert.equal(kernel.permissions.status(sys.id, 'network'), 'undeclared');
  assert.equal(await kernel.permissions.request(sys.id, 'network'), false);
  assert.equal(kernel.permissions.status(third.id, 'files.read'), 'prompt');

  const asked = [];
  kernel.permissions.setPrompter(async (q) => { asked.push(q.permission); return q.permission === 'files.read' ? 'granted' : q.permission === 'notifications' ? 'once' : 'denied'; });
  assert.equal(await kernel.permissions.request(third.id, 'files.read'), true);
  assert.equal(await kernel.permissions.request(third.id, 'files.read'), true);
  assert.equal(await kernel.permissions.request(third.id, 'camera'), false);
  assert.equal(await kernel.permissions.request(third.id, 'camera'), false);
  assert.deepEqual(asked, ['files.read', 'camera'], 'each permission is asked only once');
  assert.equal(await kernel.permissions.request(third.id, 'notifications'), true);
  assert.equal(kernel.settings.get('privacy.grants')[third.id].notifications, undefined, '"allow once" is not stored');

  kernel.permissions.reset(third.id, 'camera');
  assert.equal(kernel.permissions.status(third.id, 'camera'), 'prompt');
  kernel.settings.set('privacy.camera', false);
  assert.equal(kernel.permissions.status(sys.id, 'camera'), 'blocked', 'master switch beats system grants');
  kernel.settings.set('privacy.camera', true);
  kernel.permissions.setPrompter(null);
  assert.equal(await kernel.permissions.request(third.id, 'camera'), false, 'no prompter: fail closed');
});

test('file associations pick a default and honour user choice', () => {
  const a = kernel.registry.register(app('viewer-a', { module: { default() {} }, fileTypes: ['.zzq'] }), { builtin: true });
  const b = kernel.registry.register(app('viewer-b', { module: { default() {} }, fileTypes: ['.zzq'] }));
  assert.equal(kernel.associations.defaultFor('.zzq'), a.id, 'built-in wins by default');
  kernel.associations.setDefault('.ZZQ', b.id);
  assert.equal(kernel.associations.appForPath('/x/file.zzq'), b.id);
  assert.throws(() => kernel.associations.setDefault('.zzq', 'nonexistent'));
  kernel.associations.clearDefault('.zzq');
  assert.equal(kernel.associations.defaultFor('.zzq'), a.id);
  assert.equal(kernel.associations.defaultFor('.nothingopensthis'), null);
});

// ── Processes ─────────────────────────────────────────────────────────

test('processes: spawn, PIDs, ctx and clean kill', async () => {
  let ticks = 0, exited = false, busHits = 0;
  const el = document.createElement('div');
  el.innerHTML = '<p></p><p></p>';
  document.body.append(el);
  const m = kernel.registry.register(app('ticker', {
    module: {
      default(ctx) {
        ctx.setInterval(() => { ticks++; }, 5);
        ctx.bus.on('test:ping', () => busHits++);
        ctx.listen(window, 'test-event', () => busHits++);
        ctx.ownElement(el);
        ctx.onExit(() => { exited = true; });
      },
    },
  }));
  const p1 = await kernel.launch(m.id, { hello: 1 });
  const p2 = await kernel.launch(m.id);
  assert.ok(p2.pid > p1.pid, 'PIDs increase');
  assert.equal(p1.state, 'running');
  assert.deepEqual(p1.args, { hello: 1 });
  assert.equal(kernel.processes.byApp(m.id).length, 2);
  await sleep(40);
  assert.ok(ticks > 0, 'timers run');
  kernel.bus.emit('test:ping');
  assert.equal(busHits, 2, 'both processes got the event');
  const exitEvent = kernel.bus.waitFor('process:exit', { filter: (e) => e.pid === p1.pid });
  await kernel.processes.kill(p1.pid);
  await exitEvent;
  assert.ok(exited, 'onExit ran');
  assert.ok(!document.body.contains(el), 'owned elements removed');
  assert.equal(kernel.processes.get(p1.pid), null);
  await kernel.processes.kill(p2.pid);
  const before = ticks; await sleep(40);
  assert.equal(ticks, before, 'timers stopped after kill');
  busHits = 0;
  kernel.bus.emit('test:ping');
  window.dispatchEvent(new Event('test-event'));
  assert.equal(busHits, 0, 'listeners removed after kill');
  await assert.rejects(kernel.processes.kill(99999), 'ESRCH');
});

test('processes: single-instance apps are activated, not duplicated', async () => {
  const activations = [];
  const m = kernel.registry.register(app('single', { singleInstance: true, module: { default(ctx) { ctx.onActivate((a) => activations.push(a)); } } }));
  const [a, b] = await Promise.all([kernel.launch(m.id), kernel.launch(m.id, { file: 'x' })]);
  const c = await kernel.launch(m.id, { file: 'y' });
  assert.equal(a.pid, b.pid); assert.equal(a.pid, c.pid);
  assert.deepEqual(activations, [{ file: 'x' }, { file: 'y' }]);
  await kernel.processes.kill(a.pid);
});

test('processes: a crashing app is cleaned up and reported', async () => {
  const m = kernel.registry.register(app('crashy', { module: { default() { throw new Error('kaboom'); } } }));
  const crash = kernel.bus.waitFor('process:crash', { filter: (e) => e.appId === m.id, timeout: 2000 });
  await assert.rejects(kernel.launch(m.id), 'ECRASH');
  assert.equal((await crash).error, 'kaboom');
  assert.equal(kernel.processes.byApp(m.id).length, 0);
  await assert.rejects(kernel.launch('no.such.app'), 'ENOAPP');
});

test('processes: critical processes resist kill, CPU is measured', async () => {
  await assert.rejects(kernel.processes.kill(kernel.kernelProcess.pid), 'EPERM');
  const m = kernel.registry.register(app('burner', {
    module: { default(ctx) { ctx.setInterval(() => { const t = performance.now(); while (performance.now() - t < 20); }, 50); } },
  }));
  const p = await kernel.launch(m.id);
  await kernel.bus.waitFor('process:sample', { timeout: 3000 });
  await kernel.bus.waitFor('process:sample', { timeout: 3000 });
  assert.ok(p.cpu > 5, `expected noticeable CPU, got ${p.cpu.toFixed(1)}%`);
  assert.ok(p.memory > 0);
  await kernel.processes.kill(p.pid);
});

test('processes: apps cannot forge system events', async () => {
  let err = null;
  const m = kernel.registry.register(app('forger', { module: { default(ctx) { try { ctx.bus.emit('process:exit', {}); } catch (e) { err = e; } } } }));
  const p = await kernel.launch(m.id);
  assert.equal(err?.code, 'EPERM');
  await kernel.processes.kill(p.pid);
});

test('ctx.fs enforces permissions and resolves relative to home', async () => {
  let ctxRef;
  kernel.permissions.setPrompter(async () => 'denied');
  const reader = kernel.registry.register(app('reader', { permissions: ['files.read'], module: { default(ctx) { ctxRef = ctx; } } }), { builtin: true });
  const p = await kernel.launch(reader.id);
  await kernel.fs.writeText(`${USER.home}/Documents/x.txt`, 'mine');
  assert.equal(await ctxRef.fs.readText('Documents/x.txt'), 'mine');
  await assert.rejects(ctxRef.fs.writeText('Documents/y.txt', 'no'), 'PermissionError');
  await assert.rejects(ctxRef.fs.readText('/System/version.json'), 'PermissionError');
  await kernel.processes.kill(p.pid);
  kernel.permissions.setPrompter(null);
});

test('ctx.storage is private per app and persists per user', async () => {
  let ctxA, ctxB;
  const a = kernel.registry.register(app('store-a', { module: { default(ctx) { ctxA = ctx; } } }));
  const b = kernel.registry.register(app('store-b', { module: { default(ctx) { ctxB = ctx; } } }));
  const pa = await kernel.launch(a.id), pb = await kernel.launch(b.id);
  ctxA.storage.set('highScore', 42);
  assert.equal(ctxA.storage.get('highScore'), 42);
  assert.equal(ctxB.storage.get('highScore', 'none'), 'none');
  assert.deepEqual(ctxA.storage.keys(), ['highScore']);
  assert.throws(() => ctxA.storage.set('../escape', 1));
  ctxA.storage.remove('highScore');
  assert.equal(ctxA.storage.get('highScore'), null);
  await kernel.processes.kill(pa.pid); await kernel.processes.kill(pb.pid);
});

test('notifications: posting, Do Not Disturb and per-app mute', async () => {
  let ctxRef;
  const n = kernel.registry.register(app('notifier', { permissions: ['notifications'], module: { default(ctx) { ctxRef = ctx; } } }), { builtin: true });
  const p = await kernel.launch(n.id);
  const posted = kernel.bus.waitFor('notification:posted', { timeout: 1000 });
  const first = await ctxRef.notify({ title: 'Hello', body: 'World' });
  assert.equal((await posted).id, first.id);
  assert.equal(first.silent, false);
  kernel.notifications.setDnd(true);
  assert.equal((await ctxRef.notify({ title: 'Quiet' })).silent, true);
  kernel.notifications.setDnd(false);
  kernel.settings.set('notifications.perApp', { [n.id]: false });
  assert.equal(await ctxRef.notify({ title: 'Muted' }), null);
  kernel.settings.set('notifications.perApp', {});
  assert.ok(kernel.notifications.list().filter((x) => x.appId === n.id).length === 2);
  kernel.notifications.clear(n.id);
  assert.equal(kernel.notifications.list().filter((x) => x.appId === n.id).length, 0);
  await kernel.processes.kill(p.pid);
});

test('installed apps persist, run sandboxed and can’t claim device permissions', async () => {
  const manifest = app('installed', { source: 'export default function main(app) { app.storage.set("ran", true); }', permissions: ['network'] });
  const m = await kernel.registry.install(manifest);
  assert.ok(m.sandboxed, 'Store code is marked sandboxed');
  assert.equal(m.entry, undefined);
  assert.equal(m.privileged, false);
  const stored = await platform.kv.get('apps:installed');
  assert.ok(stored.some((r) => r.id === manifest.id));
  await kernel.registry.uninstall(manifest.id);
  assert.ok(!kernel.registry.has(manifest.id));
  assert.ok(!(await platform.kv.get('apps:installed')).some((r) => r.id === manifest.id));
  let threw = false;
  try { await kernel.registry.install(app('greedy', { source: 'export default () => {}', permissions: ['camera'] })); } catch (e) { threw = /camera/.test(e.message); }
  assert.ok(threw, 'camera is refused for Store apps');
});

test('.dapp packages parse, sanitise icons and compare versions', async () => {
  const { parseDapp, buildDapp, compareVersions } = await import('../core/dapp.js');
  const text = buildDapp({ manifest: { id: 'com.test.pkg', name: 'Pkg', version: '1.2.0', permissions: ['notifications'] }, icon: '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>bad()</script><rect/></svg>', source: 'export default function main(app) {}' });
  const m = parseDapp(text);
  assert.equal(m.id, 'com.test.pkg');
  assert.ok(m.icon.startsWith('data:image/svg+xml;base64,'));
  assert.ok(!atob(m.icon.split(',')[1]).includes('script') && !atob(m.icon.split(',')[1]).includes('onload'));
  let err = null;
  try { parseDapp('{"format":"zip"}'); } catch (e) { err = e.code; }
  assert.equal(err, 'EFORMAT');
  assert.ok(compareVersions('1.2.10', '1.2.9') > 0 && compareVersions('2.0.0', '2.0.0') === 0 && compareVersions('1.0.0', '1.1') < 0);
});

test('kernel.open uses file associations', async () => {
  const opened = [];
  const m = kernel.registry.register(app('opener', { fileTypes: ['.zzo'], module: { default(ctx) { opened.push(ctx.args.path); } } }), { builtin: true });
  await kernel.fs.writeText(`${USER.home}/Documents/thing.zzo`, 'x');
  const p = await kernel.open(`${USER.home}/Documents/thing.zzo`);
  assert.deepEqual(opened, [`${USER.home}/Documents/thing.zzo`]);
  assert.equal(kernel.settings.get('start.recentFiles')[0].path, `${USER.home}/Documents/thing.zzo`);
  await kernel.processes.kill(p.pid);
  const ask = kernel.bus.waitFor('kernel:openWith', { timeout: 1000 });
  await kernel.fs.writeText(`${USER.home}/Documents/odd.unknownext`, 'x');
  assert.equal(await kernel.open(`${USER.home}/Documents/odd.unknownext`), null);
  assert.equal((await ask).path, `${USER.home}/Documents/odd.unknownext`);
  void m;
});

// ── Accounts & sessions ───────────────────────────────────────────────

import { AccountService } from '../core/accounts.js';
import { hashSecret, verifySecret } from '../core/crypto.js';

const accountsFor = async () => {
  const bus = new EventBus();
  const settings = new SettingsStore({ kv: prefixedKv, bus });
  await settings.loadSystem();
  const svc = new AccountService({ kv: prefixedKv, fs: kernel.fs, settings, bus });
  await svc.load();
  return { svc, settings };
};

test('password hashing: salted, verifiable, never stores the secret', async () => {
  const a = await hashSecret('correct horse', { iterations: 1000 });
  const b = await hashSecret('correct horse', { iterations: 1000 });
  assert.ok(a.salt !== b.salt && a.hash !== b.hash, 'random salt');
  assert.ok(!JSON.stringify(a).includes('correct'));
  assert.equal(await verifySecret('correct horse', a), true);
  assert.equal(await verifySecret('Correct horse', a), false);
});

test('accounts: create, validate, verify password and PIN', async () => {
  const { svc } = await accountsFor();
  const first = await svc.create({ name: `Ada${RUN}`, password: 'p@ss', pin: '2468', hint: 'usual' });
  assert.equal(first.type, 'admin', 'first account is an administrator');
  assert.ok(first.hasPassword && first.hasPin);
  assert.equal(first.home, `/Users/Ada${RUN}`);
  assert.ok(!('password' in first), 'hashes are never exposed');
  const second = await svc.create({ name: `Bo${RUN}` });
  assert.equal(second.type, 'standard');
  await assert.rejects(svc.create({ name: `ada${RUN}` }), 'EEXIST');
  await assert.rejects(svc.create({ name: 'Guest' }), 'EINVAL');
  await assert.rejects(svc.create({ name: 'a/b' }), 'EINVAL');
  await assert.rejects(svc.create({ name: `Cy${RUN}`, pin: '12' }), 'EINVAL');
  await assert.rejects(svc.create({ name: `Cy${RUN}`, password: 'donut', hint: 'my donut thing' }), 'EHINT');
  assert.equal((await svc.verify(first.id, { password: 'p@ss' })).ok, true);
  assert.equal((await svc.verify(first.id, { password: 'nope' })).ok, false);
  assert.equal((await svc.verify(first.id, { pin: '2468' })).ok, true);
  assert.equal((await svc.verify(second.id, { password: '' })).ok, true, 'no password: empty sign-in works');
  assert.equal((await svc.verify(second.id, { pin: '0000' })).ok, false, 'no PIN set');
  const again = new AccountService({ kv: prefixedKv, fs: kernel.fs, settings: (await accountsFor()).settings, bus: new EventBus() });
  await again.load();
  assert.equal(again.count, 2, 'accounts persist');
});

test('accounts: five wrong attempts lock the account', async () => {
  const { svc } = await accountsFor();
  const id = svc.list({ includeGuest: false }).find((a) => a.name === `Ada${RUN}`).id;
  let r;
  for (let i = 0; i < 5; i++) r = await svc.verify(id, { password: 'wrong' });
  assert.ok(r.lockedFor > 25_000, 'locked for ~30 s');
  assert.equal((await svc.verify(id, { password: 'p@ss' })).ok, false, 'even the right password waits');
  const { svc: reloaded } = await accountsFor();
  assert.ok(reloaded.lockedFor(id) > 0, 'lockout survives a restart');
});

test('accounts: change password, PIN, name, type; last admin protected', async () => {
  const { svc } = await accountsFor();
  const ada = svc.list().find((a) => a.name === `Ada${RUN}`);
  const bo = svc.list().find((a) => a.name === `Bo${RUN}`);
  await assert.rejects(svc.setPassword(ada.id, { current: 'bad', next: 'x' }), 'EAUTH');
  await svc.setPassword(bo.id, { next: 'newpw', hint: 'h' });
  assert.ok(svc.get(bo.id).hasPassword);
  await svc.setPassword(bo.id, { next: 'reset-by-admin', asAdmin: true });
  assert.equal((await svc.verify(bo.id, { password: 'reset-by-admin' })).ok, true);
  await svc.setPin(bo.id, '13579');
  assert.equal((await svc.verify(bo.id, { pin: '13579' })).ok, true);
  await svc.setPin(bo.id, '');
  assert.ok(!svc.get(bo.id).hasPin);
  await svc.rename(bo.id, `Bob${RUN}`);
  assert.equal(svc.get(bo.id).name, `Bob${RUN}`);
  await assert.rejects(svc.setType(ada.id, 'standard'), 'ELASTADMIN');
  await assert.rejects(svc.remove(ada.id), 'ELASTADMIN');
  await svc.setType(bo.id, 'admin');
  await svc.setType(ada.id, 'standard');
  await svc.setAvatar(bo.id, { type: 'initials', color: '#123456' });
  await assert.rejects(svc.setAvatar(bo.id, { type: 'image', data: 'javascript:alert(1)' }), 'EINVAL');
  await kernel.fs.writeText(`${ada.home}/Documents/a.txt`, 'x', { mkdirp: true });
  await svc.remove(ada.id);
  assert.equal(svc.get(ada.id), null);
  assert.ok(!(await kernel.fs.exists(ada.home)), 'files removed with the account');
  await svc.remove(bo.id).catch((e) => assert.equal(e.code, 'ELASTADMIN'));
  await prefixedKv.delete('accounts'); await prefixedKv.delete('accounts:lockout');
});

test('sessions: two users signed in at once keep separate settings, files and apps', async () => {
  const other = { id: `test2-${RUN}`, name: 'Other', home: `${T}/home2`, isGuest: false };
  await kernel.signIn(USER);
  kernel.settings.set('appearance.theme', 'light');
  let ctxA;
  const m = kernel.registry.register(app('per-user', { permissions: ['files.read', 'files.write'], module: { default(ctx) { ctxA = ctx; } } }), { builtin: true });
  const pa = await kernel.launch(m.id);
  await kernel.signIn(other);
  assert.equal(kernel.session.user.id, other.id);
  assert.equal(kernel.settings.get('appearance.theme'), 'dark', 'second user has their own settings');
  assert.equal(kernel.processes.get(pa.pid).state, 'running', 'first user\'s app keeps running');
  // The first user's app still writes to the first user's home and storage.
  await ctxA.fs.writeText('Documents/bg.txt', 'background');
  assert.ok(await kernel.fs.exists(`${USER.home}/Documents/bg.txt`));
  assert.ok(!(await kernel.fs.exists(`${other.home}/Documents/bg.txt`)));
  ctxA.storage.set('k', 1);
  assert.equal(kernel.settings.get(`app.${m.id}.k`, USER.id), 1);
  assert.equal(kernel.settings.get(`app.${m.id}.k`), null, 'not visible to the active user');
  await kernel.signIn(USER);
  assert.equal(kernel.settings.get('appearance.theme'), 'light', 'switching back restores settings');
  await kernel.signOut(other.id);
  assert.ok(!kernel.sessions.has(other.id));
  assert.equal(kernel.session.user.id, USER.id, 'signing out a background user keeps the active one');
  await kernel.processes.kill(pa.pid);
  await platform.kv.delete(`settings:user:${other.id}`);
});

test('sessions: the guest starts clean every time', async () => {
  const guest = kernel.accounts.guest();
  await kernel.signIn(guest);
  await kernel.fs.writeText(`${guest.home}/Documents/left-behind.txt`, 'x');
  kernel.settings.set('appearance.theme', 'light');
  await kernel.signOut(guest.id);
  assert.ok(!(await kernel.fs.exists(`${guest.home}/Documents/left-behind.txt`)));
  await kernel.signIn(guest);
  assert.equal(kernel.settings.get('appearance.theme'), 'dark');
  await kernel.signOut(guest.id);
  await kernel.signIn(USER);
});

// ── Phase 3 services ──────────────────────────────────────────────────

import { normalizeCombo, comboFromEvent, ShortcutRegistry } from '../core/shortcuts.js';

test('shortcuts: combos are normalised and dispatched', () => {
  assert.equal(normalizeCombo('alt+ctrl+e'), 'Ctrl+Alt+E');
  assert.equal(normalizeCombo('Win+.'), 'Meta+Period');
  assert.equal(normalizeCombo('alt+`'), 'Alt+Backquote');
  assert.equal(comboFromEvent(new KeyboardEvent('keydown', { code: 'Backquote', key: '`', altKey: true })), 'Alt+Backquote');
  assert.equal(comboFromEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', ctrlKey: true, altKey: true })), 'Ctrl+Alt+E');
  const reg = new ShortcutRegistry();
  const target = new EventTarget();
  let hits = 0;
  reg.register('t', { keys: ['Meta+E', 'Ctrl+Alt+E'], handler: () => { hits++; } });
  reg.attach(target);
  target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', ctrlKey: true, altKey: true }));
  target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', metaKey: true }));
  target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
  assert.equal(hits, 2);
  // Pressing and releasing Meta alone is its own shortcut (Start).
  let start = 0;
  reg.register('s', { keys: ['Meta'], handler: () => { start++; } });
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft' }));
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }));
  target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', metaKey: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft' }));
  assert.equal(start, 1, 'Meta used in a combination does not open Start');
  reg.detach();
});

test('clipboard history: dedupes, pins and clears', async () => {
  await kernel.signIn(USER);
  const c = kernel.clipboard;
  c.clear(); for (const i of c.list()) c.remove(i.id);
  c.record('one'); c.record('two'); c.record('one');
  assert.deepEqual(c.list().map((i) => i.text), ['one', 'two']);
  c.pin(c.list().find((i) => i.text === 'two').id);
  c.clear();
  assert.deepEqual(c.list().map((i) => i.text), ['two'], 'pinned items survive');
  kernel.settings.set('privacy.clipboardHistory', false);
  c.record('secret');
  assert.ok(!c.list().some((i) => i.text === 'secret'), 'nothing recorded when off');
  kernel.settings.set('privacy.clipboardHistory', true);
});

test('Wi-Fi off / airplane mode blocks network access for apps', async () => {
  const m = kernel.registry.register(app('netapp', { permissions: ['network'], module: { default() {} } }), { builtin: true });
  assert.equal(kernel.permissions.status(m.id, 'network'), 'granted');
  kernel.settings.set('qs.airplane', true);
  assert.equal(kernel.permissions.status(m.id, 'network'), 'blocked');
  kernel.settings.set('qs.airplane', false);
  kernel.settings.set('qs.wifi', false);
  assert.equal(await kernel.permissions.request(m.id, 'network'), false);
  kernel.settings.set('qs.wifi', true);
  assert.equal(kernel.permissions.status(m.id, 'network'), 'granted');
});

test('apps get windows from the window host; closing the last window ends the app', async () => {
  const created = [];
  const fakeWm = { create: (proc, opts) => { const w = { proc, opts }; created.push(w); return w; }, forPid: () => [] };
  kernel.setWindowHost((uid) => (uid === USER.id ? fakeWm : null));
  const m = kernel.registry.register(app('windowed', { module: { default(ctx) { ctx.windows.create({ title: 'Hello' }); } } }));
  const p = await kernel.launch(m.id);
  assert.equal(created.length, 1);
  assert.equal(created[0].opts.title, 'Hello');
  await kernel.processes.kill(p.pid);
  kernel.setWindowHost(null);
});

// ── Window manager (phase 4) ─────────────────────────────────────────

import { WindowManager } from '../wm/window-manager.js';
import { VirtualDesktops } from '../wm/virtual-desktops.js';
import { ZONES, LAYOUTS, fracToRect, zoneAt } from '../wm/snap.js';

async function wmFixture() {
  await kernel.signIn(USER);
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;visibility:hidden';
  document.body.append(layer);
  const wm = new WindowManager({ kernel, uid: USER.id, layer });
  const desktops = new VirtualDesktops({ wm, settings: kernel.settings.forUser(USER.id), layer });
  kernel.setWindowHost(() => wm);
  const handles = [];
  const m = kernel.registry.register(app(`wmapp${Math.random().toString(36).slice(2, 6)}`, { module: { default(ctx) { handles.push(ctx.windows.create({ title: ctx.args.title || 'W', width: 500, height: 400 })); } } }));
  const open = async (title) => { const p = await kernel.launch(m.id, { title }); return { p, win: wm.list().find((w) => w.pid === p.pid) }; };
  const cleanup = async () => {
    for (const p of kernel.processes.byApp(m.id)) await kernel.processes.kill(p.pid, { force: true });
    wm.destroy(); layer.remove(); kernel.setWindowHost(null);
    kernel.settings.reset('wm.desktops'); kernel.settings.reset('wm.currentDesktop');
  };
  return { wm, desktops, open, cleanup, handles };
}

test('snap zones: edges, corners and the top edge', () => {
  const a = { x: 0, y: 0, w: 1000, h: 800 };
  assert.equal(zoneAt(2, 400, a), 'left');
  assert.equal(zoneAt(998, 400, a), 'right');
  assert.equal(zoneAt(500, 2, a), 'max');
  assert.equal(zoneAt(2, 20, a), 'tl');
  assert.equal(zoneAt(995, 790, a), 'br');
  assert.equal(zoneAt(500, 400, a), null);
  assert.deepEqual(fracToRect(ZONES.right, a), { x: 500, y: 0, w: 500, h: 800 });
  assert.deepEqual(fracToRect(LAYOUTS[1][0], a), { x: 0, y: 0, w: 667, h: 800 });
});

test('snapping a window and restoring its earlier size', async () => {
  const f = await wmFixture();
  try {
    const { win } = await f.open('A');
    const before = { ...win.bounds };
    f.wm.snapper.snap(win, ZONES.left);
    assert.deepEqual(win.bounds, fracToRect(ZONES.left, f.wm.workArea()));
    assert.equal(f.handles[0].state, 'snapped');
    f.wm.snapper.unsnap(win, { animate: false });
    assert.deepEqual([win.bounds.w, win.bounds.h], [before.w, before.h]);
    assert.equal(win.snap, null);
  } finally { await f.cleanup(); }
});

test('Win+Arrow moves through halves, quarters, maximize and back', async () => {
  const f = await wmFixture();
  try {
    const { win } = await f.open('K');
    const kb = (d) => f.wm.snapper.keyboard(win, d);
    const a = f.wm.workArea();
    kb('left'); assert.deepEqual(win.bounds, fracToRect(ZONES.left, a), 'left half');
    kb('up'); assert.deepEqual(win.bounds, fracToRect(ZONES.tl, a), 'top-left quarter');
    kb('right'); assert.deepEqual(win.bounds, fracToRect(ZONES.tr, a), 'top-right quarter');
    kb('up'); assert.equal(win.state, 'maximized');
    kb('right'); assert.deepEqual(win.bounds, fracToRect(ZONES.right, a), 'maximized → right half');
    kb('left'); assert.equal(win.snap, null, 'right half → restored');
    kb('up'); assert.equal(win.state, 'maximized');
    kb('down'); assert.equal(win.state, 'normal');
  } finally { await f.cleanup(); }
});

test('snap groups: shared edges resize together, and leaving breaks the group', async () => {
  const f = await wmFixture();
  try {
    const { win: a } = await f.open('A');
    const { win: b } = await f.open('B');
    const sn = f.wm.snapper;
    sn.snap(a, LAYOUTS[0][0], { group: 'gtest' });
    sn.snap(b, LAYOUTS[0][1], { group: 'gtest' });
    assert.equal(sn.groupOf(a)?.length, 2);
    const before = { ...a.bounds };
    a.bounds = { ...a.bounds, w: a.bounds.w + 100 };
    sn.resizing(a, before, a.bounds);
    assert.equal(b.bounds.x, before.x + before.w + 100, 'neighbour moved its left edge');
    assert.equal(b.bounds.x + b.bounds.w, fracToRect(LAYOUTS[0][1], f.wm.workArea()).x + fracToRect(LAYOUTS[0][1], f.wm.workArea()).w, 'neighbour kept its right edge');
    a.maximize();
    assert.equal(sn.groupOf(b), null, 'a group of one is dissolved');
    assert.equal(a.snap, null);
  } finally { await f.cleanup(); }
});

test('virtual desktops: create, move windows, switch, close', async () => {
  const f = await wmFixture();
  try {
    const { win: a } = await f.open('A');
    const d1 = f.desktops.current;
    const d2 = f.desktops.create();
    assert.equal(f.desktops.list().length, 2);
    f.desktops.moveWindow(a, d2.id);
    assert.ok(!f.wm.isVisible(a) && a.el.hidden, 'moved away: hidden');
    f.desktops.switchTo(d2.id, { animate: false });
    assert.ok(f.wm.isVisible(a) && !a.el.hidden, 'visible on its desktop');
    const { win: b } = await f.open('B');
    assert.equal(b.desktop, d2.id, 'new windows open on the current desktop');
    f.desktops.setAllDesktops(b, true);
    f.desktops.switchTo(d1, { animate: false });
    assert.ok(f.wm.isVisible(b) && !f.wm.isVisible(a), 'pinned windows follow you');
    assert.equal(kernel.settings.get('wm.currentDesktop'), d1, 'current desktop is saved');
    f.desktops.rename(d2.id, 'Work');
    assert.equal(f.desktops.get(d2.id).name, 'Work');
    f.desktops.remove(d2.id);
    assert.equal(f.desktops.list().length, 1);
    assert.equal(a.desktop, d1, 'windows move to the remaining desktop');
    assert.ok(f.wm.isVisible(a));
  } finally { await f.cleanup(); }
});

test('focusing a window on another desktop switches to it', async () => {
  const f = await wmFixture();
  try {
    const { win } = await f.open('Far');
    const d2 = f.desktops.create();
    f.desktops.moveWindow(win, d2.id);
    f.wm.focus(win);
    assert.equal(f.desktops.current, d2.id);
    assert.equal(f.wm.active, win);
  } finally { await f.cleanup(); }
});

test('closing an app\'s last window ends the app', async () => {
  const f = await wmFixture();
  try {
    const { p } = await f.open('Last');
    await f.handles.at(-1).close();
    await sleep(20);
    assert.equal(kernel.processes.get(p.pid), null);
  } finally { await f.cleanup(); }
});

test('terminal: tokenizer handles quotes, escapes, operators and comments', () => {
  const words = (line) => tokenize(line).map((t) => (t.t === 'op' ? `<${t.v}>` : t.parts.map((p) => p.text).join('')));
  assert.deepEqual(words(`echo "a b" 'c d' e\\ f`), ['echo', 'a b', 'c d', 'e f']);
  assert.deepEqual(words('a|b&&c||d;e>f>>g<h 2>i'), ['a', '<|>', 'b', '<&&>', 'c', '<||>', 'd', '<;>', 'e', '<>>', 'f', '<>>>', 'g', '<<>', 'h', '<2>>', 'i']);
  assert.deepEqual(words('ls # a comment'), ['ls']);
  let threw = false;
  try { tokenize('echo "open'); } catch (e) { threw = e instanceof ShellSyntaxError; }
  assert.ok(threw, 'unclosed quote is a syntax error');
  const list = parse(tokenize('a x | b > out && c'));
  assert.equal(list.length, 2);
  assert.equal(list[0].pipeline.length, 2);
  assert.equal(list[0].pipeline[1].redirects[0].op, '>');
  assert.equal(list[1].op, '&&');
});

test('terminal: getopts reads short, grouped, valued and long flags', () => {
  const r = getopts(['-la', '-n', '5', '--name=x', 'file', '--', '-z'], { bool: 'la', str: 'n' });
  assert.deepEqual(r.flags, { l: true, a: true, n: '5', name: 'x' });
  assert.deepEqual(r.args, ['file', '-z']);
});

test('terminal: shell runs pipes, redirects, variables, globs and && / ||', async () => {
  const dir = `${T}/term`;
  await kernel.fs.mkdir(dir, { recursive: true });
  const commands = {
    echo: (args, io) => { io.out(`${args.join(' ')}\n`); return 0; },
    cat: async (args, io, sh) => { io.out(args.length ? (await Promise.all(args.map((a) => sh.fs.readText(sh.resolve(a))))).join('') : io.stdin ?? ''); return 0; },
    upper: (args, io) => { io.out((io.stdin || '').toUpperCase()); return 0; },
    false: () => 1,
  };
  const sh = new Shell({ fs: kernel.fs, home: dir, commands });
  let out = '';
  let err = '';
  const io = { out: (t) => { out += t; }, err: (t) => { err += t; } };
  await sh.run('echo hello > a.txt; echo world >> a.txt', io);
  assert.equal(await kernel.fs.readText(`${dir}/a.txt`), 'hello\nworld\n');
  await sh.run('cat a.txt | upper', io);
  assert.equal(out, 'HELLO\nWORLD\n');
  out = '';
  await sh.run("N=7; echo \"n=$N\" '$N' ~", io);
  assert.equal(out, `n=7 $N ${dir}\n`);
  out = '';
  await kernel.fs.writeText(`${dir}/b.txt`, 'x');
  await sh.run('echo *.txt', io);
  assert.equal(out, 'a.txt b.txt\n');
  out = '';
  await sh.run('false && echo no || echo yes', io);
  assert.equal(out, 'yes\n');
  out = '';
  assert.equal(await sh.run('missing', io), 127);
  assert.ok(/command not found/.test(err));
  await sh.run('echo $?', io);
  assert.equal(out, '127\n');
  out = '';
  await sh.run('upper < a.txt', io);
  assert.equal(out, 'HELLO\nWORLD\n');
});

test('signing out ends the user\'s apps', async () => {
  const m = kernel.registry.register(app('lingering', { module: { default() {} } }));
  await kernel.launch(m.id);
  await kernel.setSessionUser(null);
  assert.equal(kernel.processes.byApp(m.id).length, 0);
  assert.equal(kernel.settings.currentUser, null);
});

test('accessibility: Narrator names, roles and states', () => {
  const box = document.createElement('div');
  box.innerHTML = `<button aria-label="Close">×</button><label class="toggle"><small class="toggle-state">On</small><input type="checkbox" checked><span></span> Wi-Fi</label>
    <label for="n${RUN}">Name</label><input id="n${RUN}" value="Ana"><a href="#x">Help <img alt="(new)"></a><h2>Title</h2><input type="range" aria-label="Volume" value="40">
    <button aria-expanded="false" disabled>More</button><select aria-label="Size"><option>Small</option><option selected>Large</option></select><input type="password" aria-label="Password" value="abc">`;
  document.body.append(box);
  try {
    const [btn, , name, link, h2, range, more, size, pw] = [box.querySelector('button'), null, box.querySelector(`#n${RUN}`), box.querySelector('a'), box.querySelector('h2'), box.querySelector('[type=range]'), box.querySelectorAll('button')[1], box.querySelector('select'), box.querySelector('[type=password]')];
    assert.equal(a11yDescribe(btn), 'Close, button');
    assert.equal(a11yDescribe(box.querySelector('[type=checkbox]')), 'Wi-Fi, toggle switch, on');
    assert.equal(a11yDescribe(name), 'Name, Ana, edit');
    assert.equal(a11yDescribe(link), 'Help (new), link');
    assert.equal(a11yDescribe(h2), 'Title, heading level 2');
    assert.equal(a11yDescribe(range), 'Volume, 40, slider');
    assert.equal(a11yDescribe(more), 'More, button, collapsed, unavailable');
    assert.equal(a11yDescribe(size), 'Size, Large, combo box');
    assert.equal(a11yDescribe(pw), 'Password, 3 characters, protected, edit');
  } finally { box.remove(); }
});

test('accessibility: colour-blindness filters keep greys grey and change colours', () => {
  for (const type of ['protanopia', 'deuteranopia', 'tritanopia']) {
    const m = correctionMatrix(type);
    for (const row of m) assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9, `${type}: rows must keep grey`);
    assert.ok(m.flat().some((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) > 0.05), `${type} changes colours`);
  }
});

test('accessibility: sign-in screen preferences are used when nobody is signed in', () => {
  const fake = (signin, uid = null) => ({ currentUser: uid, get: (k) => (k === 'a11y.signin' ? signin : k === 'a11y.narrator' ? 'user-value' : undefined) });
  assert.equal(a11yGet(fake({ narrator: true }), 'narrator'), true);
  assert.equal(a11yGet(fake({}), 'narrator'), false);
  assert.equal(a11yGet(fake({}), 'magnifierZoom'), 200);
  assert.equal(a11yGet(fake({ narrator: true }, 'u1'), 'narrator'), 'user-value');
  assert.equal(a11yGet({ get: () => undefined }, 'osk'), false); // theme previews' stand-in settings
});

test('accessibility: keys typed on DonutOS\'s behalf edit text like real keys', async () => {
  const ta = document.createElement('textarea');
  document.body.append(ta);
  try {
    ta.focus();
    for (const k of ['h', 'i', 'Enter', 'y', 'o']) await performKey(ta, { key: k, mods: {} });
    assert.equal(ta.value, 'hi\nyo');
    await performKey(ta, { key: 'ArrowUp', mods: {} });
    assert.equal(ta.selectionStart, 2);
    await performKey(ta, { key: 'Backspace', mods: {} });
    assert.equal(ta.value, 'h\nyo');
    await performKey(ta, { key: 'End', mods: { shift: true } });
    await performKey(ta, { key: 'a', mods: { ctrl: true } });
    assert.equal([ta.selectionStart, ta.selectionEnd].join(), `0,${ta.value.length}`);
  } finally { ta.remove(); }
});

test('accessibility: Magnifier maps the screen to the page around the pointer', () => {
  try {
    setScreenView({ z: 2, px: 400, py: 300 });
    assert.deepEqual(screenToPage(400, 300), { x: 400, y: 300 }); // the point under the pointer stays put
    assert.deepEqual(screenToPage(600, 500), { x: 500, y: 400 });
    const v = visiblePage();
    assert.equal(v.left, 200); assert.equal(v.top, 150);
    assert.equal(v.right - v.left, innerWidth / 2);
  } finally { setScreenView({ z: 1, px: 0, py: 0 }); }
});

test('accessibility: contrast themes replace the colours and turn transparency off', () => {
  const root = document.createElement('div');
  const values = { 'appearance.theme': 'light', 'appearance.accent': '#e8618c', 'appearance.transparency': true, 'appearance.animations': true, 'a11y.reduceMotion': false, 'appearance.font': 'system', 'appearance.textScale': 100 };
  const fake = (hc) => ({ currentUser: 'x', get: (k) => ({ ...values, 'a11y.highContrast': hc, 'a11y.contrastTheme': 'desert', 'a11y.focusRing': false, 'a11y.alwaysScrollbars': true })[k] });
  applyTheme(fake(true), root);
  assert.equal(root.dataset.contrast, 'desert');
  assert.equal(root.dataset.transparency, 'off');
  assert.equal(root.dataset.scrollbars, 'always');
  assert.equal(root.style.getPropertyValue('--bg'), CONTRAST_THEMES.desert.bg);
  applyTheme(fake(false), root);
  assert.equal(root.dataset.contrast, undefined);
  assert.equal(root.style.getPropertyValue('--bg'), '');
  assert.equal(root.style.getPropertyValue('--accent'), '#e8618c');
  applyTheme(kernel.settings); // put the real theme back
});

test('installed apps keep their code out of the app list, and old lists are migrated', async () => {
  const reg = new AppRegistry({ kv: prefixedKv, bus: new EventBus() });
  const code = 'export default function main(app) {}';
  await reg.install({ id: `t${RUN}.small`, name: 'Small', version: '1.0.0', source: code });
  const list = await prefixedKv.get('apps:installed');
  assert.equal(list.length, 1);
  assert.equal(list[0].source, undefined);
  assert.equal(list[0].codeStored, true);
  assert.equal(await reg.code(`t${RUN}.small`), code);
  assert.equal(reg.get(`t${RUN}.small`).sandboxed, true);
  // A list written by an older DonutOS (code inside):
  await prefixedKv.set('apps:installed', [{ id: `t${RUN}.old`, name: 'Old', version: '1.0.0', source: code, installedAt: 1 }]);
  const again = new AppRegistry({ kv: prefixedKv, bus: new EventBus() });
  await again.loadInstalled();
  assert.equal((await prefixedKv.get('apps:installed'))[0].source, undefined);
  assert.equal(await again.code(`t${RUN}.old`), code);
  await again.uninstall(`t${RUN}.old`);
  assert.ok((await prefixedKv.get(`apps:code:t${RUN}.old`)) == null, "code removed with the app");
});

run({
  platform: platform.name,
  async teardown() {
    for (const id of testApps) kernel.registry.unregister(id);
    await kernel.fs.remove(T, { recursive: true }).catch(() => {});
    await platform.kv.delete(`settings:user:${USER.id}`);
    for (const k of await platform.kv.keys(`test:${RUN}:`)) await platform.kv.delete(k);
  },
});
