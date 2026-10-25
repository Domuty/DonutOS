// DonutOS desktop host (Electron main process).
// Serves the shared /src UI from the donut:// scheme, launches it fullscreen like an OS
// shell, and implements the native half of the platform adapter over IPC.

'use strict';
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { FsSandbox } = require('./native/fs-sandbox');
const { KvStore } = require('./native/kv-store');
const systemStats = require('./native/system-stats');
const { createUpdater } = require('./updater');

const SRC = path.join(__dirname, '..', 'src');
const ORIGIN = 'donut://app';
const args = process.argv.slice(1);
const TESTS = args.includes('--tests');
const WINDOWED = args.includes('--windowed') || TESTS;

protocol.registerSchemesAsPrivileged([{
  scheme: 'donut',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true, corsEnabled: true },
}]);

// Tests use a throw-away folder so they never touch the user's real DonutOS files.
if (TESTS) app.setPath('userData', path.join(os.tmpdir(), `donutos-test-${process.pid}`));
const SANDBOX_ROOT = TESTS
  ? path.join(app.getPath('userData'), 'Files')
  : process.env.DONUTOS_ROOT || path.join(app.getPath('documents'), 'DonutOS');

if (!TESTS && !app.requestSingleInstanceLock()) app.quit();

let win = null;
let sandbox = null;
let kv = null;
let updater = null;
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

/** Registers an IPC handler that only answers DonutOS itself and wraps results/errors. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...a) => {
    if (!event.senderFrame || !event.senderFrame.url.startsWith(ORIGIN + '/')) {
      return { ok: false, error: { code: 'EACCES', message: 'Untrusted sender' } };
    }
    try { return { ok: true, value: await fn(...a) }; }
    catch (err) { return { ok: false, error: { code: err.code || 'EIO', message: err.message, path: err.path } }; }
  });
}

function registerIpc() {
  ipcMain.on('app:config', (e) => { e.returnValue = { version: app.getVersion(), tests: TESTS, fullscreen: !WINDOWED }; });

  for (const m of ['stat', 'readdir', 'readFile', 'writeFile', 'mkdir', 'remove', 'rename', 'copy', 'usage']) {
    handle(`fs:${m}`, (...a) => sandbox[m](...a));
  }
  handle('kv:get', (k) => kv.get(k));
  handle('kv:set', (k, v) => kv.set(k, v));
  handle('kv:delete', (k) => kv.delete(k));
  handle('kv:keys', (p) => kv.keys(p));

  handle('system:info', () => systemStats.info(app.getVersion(), SANDBOX_ROOT));
  handle('system:stats', () => systemStats.stats(SANDBOX_ROOT));
  handle('system:network', () => systemStats.network());

  handle('power:shutdown', async () => { await kv.flush(); setImmediate(() => app.quit()); });
  handle('power:restart', async () => { await kv.flush(); setImmediate(() => { app.relaunch(); app.exit(0); }); });

  handle('display:setFullscreen', (on) => { win.setFullScreen(!!on); return !!on; });

  handle('host:importFiles', async ({ multiple = true, accept = '', directory = false } = {}) => {
    const exts = String(accept).split(',').map((s) => s.trim()).filter((s) => s.startsWith('.')).map((s) => s.slice(1));
    const res = await dialog.showOpenDialog(win, {
      title: 'Import into DonutOS',
      properties: [directory ? 'openDirectory' : 'openFile', ...(multiple ? ['multiSelections'] : [])],
      filters: exts.length ? [{ name: 'Supported files', extensions: exts }, { name: 'All files', extensions: ['*'] }] : undefined,
    });
    if (res.canceled) return [];
    const out = [];
    const readOne = async (file, rel) => {
      const st = await fsp.stat(file);
      out.push({ name: path.basename(file), relativePath: rel, type: '', size: st.size, lastModified: st.mtimeMs, data: new Uint8Array(await fsp.readFile(file)) });
    };
    const walk = async (dir, rel) => {
      for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) await walk(full, `${rel}/${ent.name}`);
        else if (ent.isFile()) await readOne(full, `${rel}/${ent.name}`);
      }
    };
    for (const p of res.filePaths) {
      if (directory) await walk(p, path.basename(p)); else await readOne(p, path.basename(p));
    }
    return out;
  });

  handle('host:exportFile', async (name, data) => {
    const res = await dialog.showSaveDialog(win, {
      title: 'Export from DonutOS',
      defaultPath: path.join(app.getPath('downloads'), path.basename(String(name))),
    });
    if (res.canceled || !res.filePath) return { saved: false, location: null };
    await fsp.writeFile(res.filePath, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    return { saved: true, location: res.filePath };
  });

  handle('host:openExternal', async (url) => {
    if (!/^(https?:|mailto:)/i.test(String(url))) throw Object.assign(new Error('Only web and mail links can be opened'), { code: 'EINVAL' });
    await shell.openExternal(url);
  });

  handle('updates:status', () => updater.status());
  handle('updates:check', () => updater.check());
  handle('updates:install', () => updater.install());

  if (TESTS) {
    ipcMain.on('test:report', async (_e, results) => {
      for (const r of results.tests) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.error}`}\n`);
      process.stdout.write(`\n${results.passed} passed, ${results.failed} failed (${results.platform})\n`);
      await fsp.rm(app.getPath('userData'), { recursive: true, force: true }).catch(() => {});
      app.exit(results.failed ? 1 : 0);
    });
  }
}

function serveSource() {
  protocol.handle('donut', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(SRC, rel));
    if (!file.startsWith(SRC + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('Not found', { status: 404 }));
  });
}

function lockDownSession() {
  const allowed = new Set(['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read', 'pointerLock', 'speaker-selection', 'display-capture']);
  // DonutOS's own permission system decides which apps may use these; Electron only
  // grants them to the DonutOS page itself.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(allowed.has(permission) && (details.requestingUrl || '').startsWith(ORIGIN));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && String(origin).startsWith(ORIGIN));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    fullscreen: !WINDOWED,
    frame: WINDOWED,
    show: false,
    backgroundColor: '#000000',
    title: 'DonutOS',
    icon: path.join(SRC, 'assets', 'brand', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: true,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.on('enter-full-screen', () => send('display:fullscreen', true));
  win.on('leave-full-screen', () => send('display:fullscreen', false));

  // DonutOS never navigates away from itself; external links open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN + '/')) e.preventDefault(); });

  win.loadURL(`${ORIGIN}/${TESTS ? 'tests/index.html' : 'index.html'}`);
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  sandbox = new FsSandbox(SANDBOX_ROOT);
  kv = new KvStore(path.join(app.getPath('userData'), 'kv'));
  updater = createUpdater(send);
  serveSource();
  lockDownSession();
  registerIpc();
  createWindow();
  if (!TESTS) {
    setTimeout(() => {
      const system = kv.get('settings:system') || {};
      if (system['system.updates.auto'] !== false) updater.check();
    }, 10_000);
  }
});

app.on('before-quit', () => { if (kv) kv.flush(); });
app.on('window-all-closed', () => app.quit());
