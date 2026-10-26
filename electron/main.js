// DonutOS desktop host (Electron main process).
// Serves the shared /src UI from the donut:// scheme, launches it fullscreen like an OS
// shell, and implements the native half of the platform adapter over IPC.

'use strict';
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, session, webContents } = require('electron');
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
const DEVTOOLS = args.includes('--devtools'); // for app developers: opens Chromium DevTools in their own window

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
let allowClose = false; // set when DonutOS itself (or the OS) really wants to quit
let wantFullscreen = !WINDOWED;
const BROWSER_PARTITION = 'persist:donut-browser';
let browserDownloadDir = '';
const downloads = new Map(); // id -> DownloadItem
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

  handle('power:shutdown', async () => { await kv.flush(); allowClose = true; setImmediate(() => app.quit()); });
  handle('power:restart', async () => { await kv.flush(); allowClose = true; setImmediate(() => { app.relaunch(); app.exit(0); }); });

  handle('capture:screen', async () => {
    const img = await win.webContents.capturePage();
    const size = img.getSize();
    return { data: new Uint8Array(img.toPNG()), width: size.width, height: size.height };
  });

  handle('display:setFullscreen', (on) => {
    wantFullscreen = !!on;
    win.setFullScreen(!!on);
    if (on) lockSystemKeys(); else win.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true).catch(() => {});
    return !!on;
  });

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

  handle('browser:setDownloadDir', (vpath) => { browserDownloadDir = String(vpath || ''); });
  handle('browser:cancelDownload', (id) => { downloads.get(id)?.cancel(); });
  handle('browser:clearData', async ({ cache = true, cookies = false, storage = false } = {}) => {
    const s = session.fromPartition(BROWSER_PARTITION);
    if (cache) await s.clearCache();
    if (cookies || storage) await s.clearStorageData({ storages: [...(cookies ? ['cookies'] : []), ...(storage ? ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem', 'websql'] : [])] });
  });
  // On-screen keyboard → a Browser page: real key presses, only into DonutOS's own webviews.
  const KEY_NAMES = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete', Enter: 'Enter', Tab: 'Tab' };
  handle('browser:sendKey', (id, { key, mods = {} } = {}) => {
    const wc = webContents.fromId(Number(id));
    if (!wc || wc.getType() !== 'webview' || wc.hostWebContents !== win?.webContents) throw Object.assign(new Error('Not a DonutOS browser page'), { code: 'EACCES' });
    const keyCode = KEY_NAMES[key] || (String(key).length === 1 ? String(key) : null);
    if (!keyCode) return;
    const modifiers = [mods.ctrl && 'control', mods.alt && 'alt', mods.shift && 'shift', mods.meta && 'meta'].filter(Boolean);
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (String(key).length === 1 && !mods.ctrl && !mods.alt && !mods.meta) wc.sendInputEvent({ type: 'char', keyCode: key, modifiers });
    else if (key === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
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

/**
 * The Browser app's <webview>s: no preload, no Node, sandboxed, web content only, in their
 * own storage partition. New windows become new Browser tabs; downloads are saved into the
 * signed-in user's Downloads folder inside the DonutOS sandbox.
 */
function guardWebviews() {
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
    prefs.allowRunningInsecureContent = false;
    if (params.partition !== BROWSER_PARTITION && params.partition !== 'donut-private') params.partition = BROWSER_PARTITION;
    if (params.src && !/^(https?:|about:blank|data:text\/html)/i.test(params.src)) e.preventDefault();
  });
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) send('browser:open', { url, from: contents.id });
      return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => { if (!/^(https?:|about:|data:)/i.test(url)) e.preventDefault(); });
    contents.on('context-menu', (_e, p) => send('browser:contextMenu', {
      webContentsId: contents.id, x: p.x, y: p.y, linkURL: p.linkURL, srcURL: p.srcURL, mediaType: p.mediaType,
      selectionText: p.selectionText, isEditable: p.isEditable, pageURL: p.pageURL,
    }));
  });
  for (const part of [BROWSER_PARTITION, 'donut-private']) {
    const s = session.fromPartition(part);
    // Websites don't get the camera, microphone, location or notifications; DonutOS apps do.
    s.setPermissionRequestHandler((_wc, permission, cb) => cb(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'].includes(permission)));
    s.on('will-download', (_e, item) => {
      if (!browserDownloadDir) { item.cancel(); return; }
      let host;
      try { host = sandbox.resolve(browserDownloadDir).host; } catch { item.cancel(); return; }
      const parsed = path.parse(item.getFilename().replace(/[\\/:*?"<>|]/g, '_') || 'download');
      let name = parsed.base, n = 2;
      const fs = require('node:fs');
      while (fs.existsSync(path.join(host, name))) name = `${parsed.name} (${n++})${parsed.ext}`;
      item.setSavePath(path.join(host, name));
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      downloads.set(id, item);
      const vpath = `${browserDownloadDir.replace(/\/+$/, '')}/${name}`;
      const report = (state) => send('browser:download', { id, name, path: vpath, url: item.getURL(), state, received: item.getReceivedBytes(), total: item.getTotalBytes() });
      report('progressing');
      item.on('updated', (_ev, state) => report(state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'));
      item.once('done', (_ev, state) => { downloads.delete(id); report(state); });
    });
  }
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

/**
 * Full-screen DonutOS behaves like an OS shell: Chromium's Keyboard Lock lets the page
 * receive the Windows/Command key, Alt+Tab and friends (only Ctrl+Alt+Del and Win+L stay
 * with the host). Holding Esc for two seconds releases the keys again.
 */
function lockSystemKeys() {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(
    "document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => navigator.keyboard && navigator.keyboard.lock()).catch(() => {})",
    true,
  ).catch(() => {});
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
      webviewTag: true, // the Browser app's pages; locked down in guardWebviews()
      spellcheck: true,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => { win.show(); if (DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' }); });
  win.webContents.on('did-finish-load', () => { if (wantFullscreen) lockSystemKeys(); });
  // Leaving HTML full screen (holding Esc) must not leave a frameless, un-movable window.
  win.on('leave-html-full-screen', () => { if (wantFullscreen) setTimeout(() => { if (win && !win.isDestroyed()) win.setFullScreen(true); }, 50); });
  win.on('enter-full-screen', () => send('display:fullscreen', true));
  win.on('leave-full-screen', () => send('display:fullscreen', false));

  // DonutOS never navigates away from itself; external links open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    // DonutOS's own pages (e.g. the core test runner) open in a normal window.
    if (url.startsWith(ORIGIN + '/')) return { action: 'allow', overrideBrowserWindowOptions: { fullscreen: false, frame: true, width: 1100, height: 800, autoHideMenuBar: true } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN + '/')) e.preventDefault(); });

  guardWebviews();
  win.loadURL(`${ORIGIN}/${TESTS ? 'tests/index.html' : 'index.html'}`);
  // Alt+F4 / the window's close button: like a desktop OS, DonutOS decides (close the
  // active app window, or offer to shut down) instead of the host killing it.
  win.on('close', (e) => {
    if (allowClose || TESTS) return;
    e.preventDefault();
    send('shell:closeRequest', {});
  });
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

app.on('before-quit', () => { allowClose = true; if (kv) kv.flush(); });
app.on('window-all-closed', () => app.quit());
