// The platform adapter contract.
//
// Everything that differs between the web build and the desktop (Electron) build lives
// behind this one interface. The kernel receives an adapter at boot; apps never see the
// adapter directly — they use ctx.fs, ctx.system, etc., which the kernel builds on top of it.
//
// Both implementations (web-adapter.js, desktop-adapter.js) must provide every member below
// with the same behaviour and return shapes. assertAdapter() enforces the shape at boot and
// the test suite (src/tests) checks the behaviour against whichever adapter is running.
//
// ── Shapes ───────────────────────────────────────────────────────────────────────────────
// Stat:     { path, name, type: 'file' | 'dir', size, mtime, ctime }      (times in ms)
// Errors:   fs methods throw FsError with code ENOENT | EEXIST | ENOTDIR | EISDIR |
//           ENOTEMPTY | EACCES | EINVAL | ENOSPC | EIO
// Info:     { platform: 'web' | 'desktop', os, osVersion, arch, hostname, cpuModel, cores,
//             appVersion, engine, sandboxRoot | null }
// Stats:    { time, estimated, cpu: { usage, cores, model, perCore: number[] | null },
//             memory: { total, used, free, label }, disk: { total, used, free, label },
//             uptime }                                                       (bytes, %, s)
// Battery:  { supported, level (0-1), charging, chargingTime, dischargingTime }
// Network:  { online, type: 'wifi' | 'ethernet' | 'cellular' | 'none' | 'unknown',
//             effectiveType, downlinkMbps, rttMs, interfaces: [{ name, type, address }] }
// HostFile: { name, relativePath, type, size, lastModified, data: Uint8Array }
// Capture:  the web build asks the browser to share the current tab (the browser shows its
//           own prompt); the desktop build reads its own window directly (no prompt).
// Update:   { state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' |
//                    'up-to-date' | 'error' | 'unsupported', version, progress, message }

export const ADAPTER_SHAPE = {
  name: 'string',                 // 'web' | 'desktop'
  init: 'function',               // async () => void        (called once before anything else)
  info: 'function',               // async () => Info

  fs: {
    stat: 'function',             // async (path) => Stat | null
    readdir: 'function',          // async (path) => Stat[]
    readFile: 'function',         // async (path) => Uint8Array
    writeFile: 'function',        // async (path, Uint8Array) => void   (parent must exist)
    mkdir: 'function',            // async (path) => void               (one level)
    remove: 'function',           // async (path, { recursive }) => void
    rename: 'function',           // async (from, to) => void           (fails if `to` exists)
    copy: 'function',             // async (from, to) => void           (recursive, fails if `to` exists)
    usage: 'function',            // async () => { used, total }
  },

  kv: {                           // small JSON documents: settings, accounts, app registry
    get: 'function',              // async (key) => value | undefined
    set: 'function',              // async (key, value) => void
    delete: 'function',           // async (key) => void
    keys: 'function',             // async (prefix) => string[]
  },

  system: {
    stats: 'function',            // async () => Stats
    battery: 'function',          // async () => Battery
    onBatteryChange: 'function',  // (cb) => unsubscribe
    network: 'function',          // async () => Network
    onNetworkChange: 'function',  // (cb) => unsubscribe
  },

  power: {
    shutdown: 'function',         // async () => boolean   (true if the host actually closed)
    restart: 'function',          // async () => void
    onCloseRequest: 'function',   // (cb) => unsubscribe   (host asked to close, e.g. Alt+F4 on desktop)
  },

  capture: {
    screen: 'function',           // async () => { data: Uint8Array (PNG), width, height }  — the DonutOS screen
  },

  display: {
    setFullscreen: 'function',    // async (bool) => boolean
    isFullscreen: 'function',     // () => boolean
    onFullscreenChange: 'function', // (cb) => unsubscribe
  },

  host: {                         // the real computer outside DonutOS
    importFiles: 'function',      // async ({ multiple, accept, directory }) => HostFile[]  ([] if cancelled)
    exportFile: 'function',       // async (name, Uint8Array, mime) => { saved, location }
    openExternal: 'function',     // async (url) => void
  },

  browser: {                      // web pages for the Browser app (see platform/common/web-view.js)
    kind: 'string',               // 'frame' (web build, <iframe>) | 'webview' (desktop, separate browser process)
    createView: 'function',       // ({ partition }) => WebView
    setDownloadDir: 'function',   // async (virtualPath) => void   (where downloads go; desktop only, web: browser's own)
    onDownload: 'function',       // (cb({ id, name, path, state, received, total })) => unsubscribe
    cancelDownload: 'function',   // async (id) => void
    onOpenRequest: 'function',    // (cb({ url })) => unsubscribe   (a page asked for a new window)
    clearData: 'function',        // async ({ cache, cookies, storage }) => void
    sendKey: 'function',          // async (webContentsId, { key, mods }) => void  (on-screen keyboard into a page)
    relayAvailable: 'function',   // async () => boolean  (web: the host's api/relay; createView({ relay: true }) uses it)
    canEmbed: 'function',         // async (url) => true | false | null  (false: the site refuses to be shown in a frame)
  },

  updates: {
    status: 'function',           // () => Update
    check: 'function',            // async () => Update
    install: 'function',          // async () => void      (restarts into the new version)
    onStatus: 'function',         // (cb) => unsubscribe
  },
};

/** Throws a descriptive error if `adapter` is missing anything from ADAPTER_SHAPE. */
export function assertAdapter(adapter) {
  const missing = [];
  const walk = (shape, obj, prefix) => {
    for (const [k, t] of Object.entries(shape)) {
      const v = obj?.[k];
      if (typeof t === 'object') walk(t, v, `${prefix}${k}.`);
      else if (typeof v !== t) missing.push(`${prefix}${k} (${t})`);
    }
  };
  walk(ADAPTER_SHAPE, adapter, '');
  if (missing.length) throw new Error(`Platform adapter "${adapter?.name}" is incomplete: ${missing.join(', ')}`);
  return adapter;
}
