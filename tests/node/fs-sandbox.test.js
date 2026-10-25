// Node tests for the desktop file-system sandbox: it must behave like the web file system
// and must never let a path escape the DonutOS folder.

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FsSandbox, normalizeVirtual } = require('../../electron/native/fs-sandbox');
const { KvStore } = require('../../electron/native/kv-store');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'donut-sbx-'));
const root = path.join(tmp, 'DonutOS');
const outside = path.join(tmp, 'outside');
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
const sbx = new FsSandbox(root);
const enc = (s) => new TextEncoder().encode(s);

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('normalises virtual paths', () => {
  assert.equal(normalizeVirtual('/a/../../b/./c/'), '/b/c');
  assert.equal(normalizeVirtual('..\\..\\x'), '/x');
});

test('".." can never leave the root', async () => {
  assert.equal(sbx.resolve('/../../outside/secret.txt').host, path.join(root, 'outside', 'secret.txt'));
  await assert.rejects(sbx.readFile('/../outside/secret.txt'), { code: 'ENOENT' });
});

test('drive letters and reserved characters are refused', async () => {
  await assert.rejects(sbx.readFile('/C:/Windows/win.ini'), { code: 'EINVAL' });
  await assert.rejects(sbx.writeFile('/a|b', enc('x')), { code: 'EINVAL' });
});

test('symlinks pointing outside are refused and hidden', async (t) => {
  try { fs.symlinkSync(outside, path.join(root, 'link')); } catch { t.skip('symlinks not permitted here'); return; }
  await assert.rejects(sbx.readFile('/link/secret.txt'), { code: 'EACCES' });
  await assert.rejects(sbx.writeFile('/link/new.txt', enc('x')), { code: 'EACCES' });
  assert.equal(await sbx.stat('/link'), null);
  assert.ok(!(await sbx.readdir('/')).some((e) => e.name === 'link'));
  fs.unlinkSync(path.join(root, 'link'));
});

test('file operations and error codes match the web file system', async () => {
  await sbx.mkdir('/d');
  await sbx.writeFile('/d/a.txt', enc('hello'));
  assert.equal(new TextDecoder().decode(await sbx.readFile('/d/a.txt')), 'hello');
  const st = await sbx.stat('/d/a.txt');
  assert.deepEqual([st.path, st.name, st.type, st.size], ['/d/a.txt', 'a.txt', 'file', 5]);
  assert.deepEqual((await sbx.readdir('/d')).map((e) => e.path), ['/d/a.txt']);
  await assert.rejects(sbx.mkdir('/d'), { code: 'EEXIST' });
  await assert.rejects(sbx.mkdir('/x/y'), { code: 'ENOENT' });
  await assert.rejects(sbx.readFile('/d'), { code: 'EISDIR' });
  await assert.rejects(sbx.readdir('/d/a.txt'), { code: 'ENOTDIR' });
  await assert.rejects(sbx.remove('/d'), { code: 'ENOTEMPTY' });
  await sbx.writeFile('/d/b.txt', enc('b'));
  await assert.rejects(sbx.rename('/d/a.txt', '/d/b.txt'), { code: 'EEXIST' });
  await assert.rejects(sbx.rename('/d', '/d/inside'), { code: 'EINVAL' });
  await sbx.copy('/d', '/e');
  assert.equal(new TextDecoder().decode(await sbx.readFile('/e/a.txt')), 'hello');
  await assert.rejects(sbx.copy('/d', '/e'), { code: 'EEXIST' });
  await sbx.rename('/e', '/f');
  assert.equal(await sbx.stat('/e'), null);
  await sbx.remove('/f', { recursive: true });
  assert.equal(await sbx.stat('/f'), null);
  await assert.rejects(sbx.remove('/'), { code: 'EACCES' });
  const u = await sbx.usage();
  assert.ok(u.total > 0 && u.used >= 0);
});

test('writes are atomic and leave no temp files behind', async () => {
  await sbx.writeFile('/d/a.txt', enc('v2'));
  assert.deepEqual(fs.readdirSync(path.join(root, 'd')).sort(), ['a.txt', 'b.txt']);
});

test('key-value store persists across instances', async () => {
  const dir = path.join(tmp, 'kv');
  const kv = new KvStore(dir);
  await kv.set('settings:user:a', { theme: 'light' });
  await kv.set('settings:system', { n: 1 });
  const again = new KvStore(dir);
  assert.deepEqual(again.get('settings:user:a'), { theme: 'light' });
  assert.deepEqual(again.keys('settings:user:'), ['settings:user:a']);
  await again.delete('settings:user:a');
  assert.equal(new KvStore(dir).get('settings:user:a'), undefined);
});
