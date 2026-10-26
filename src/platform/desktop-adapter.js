// Desktop platform adapter: talks to the Electron main process through the narrow bridge
// exposed by electron/preload.js as window.donutNative. Files are real files inside
// Documents/DonutOS, and system stats come from the operating system.

import { FsError, DonutError } from '../core/errors.js';
import { createWebviewView } from './desktop/web-view.js';
import { batteryStatus, onBatteryChange, browserNetwork, onBrowserNetworkChange, fullscreenApi } from './common/browser-apis.js';

export function createDesktopAdapter(native = window.donutNative) {
  /** Unwraps an IPC result { ok, value } | { ok: false, error }. */
  const call = async (channel, ...args) => {
    const res = await native.invoke(channel, ...args);
    if (res?.ok) return res.value;
    const e = res?.error || { code: 'EIO', message: 'No response from DonutOS host' };
    if (channel.startsWith('fs:')) throw new FsError(e.code, e.path, e.message);
    throw new DonutError(e.code || 'EHOST', e.message);
  };

  const fsc = fullscreenApi();
  let update = { state: 'idle', version: null, progress: 0, message: '' };
  const updateListeners = new Set();

  const mergeNetwork = async () => {
    const browser = browserNetwork();
    const ifaces = await call('system:network').catch(() => []);
    // The OS knows which interfaces are up; prefer Wi-Fi/Ethernet detection from it.
    let type = browser.type;
    if (browser.online && ifaces.length) {
      type = ifaces.some((i) => i.type === 'ethernet') ? 'ethernet' : ifaces.some((i) => i.type === 'wifi') ? 'wifi' : ifaces[0].type;
    }
    return { ...browser, type, interfaces: ifaces };
  };

  return {
    name: 'desktop',

    async init() {
      native.on('updates:status', (s) => { update = s; for (const l of updateListeners) l(update); });
      update = await call('updates:status');
    },

    info: () => call('system:info'),

    fs: {
      stat: (p) => call('fs:stat', p),
      readdir: (p) => call('fs:readdir', p),
      readFile: (p) => call('fs:readFile', p),
      writeFile: (p, d) => call('fs:writeFile', p, d),
      mkdir: (p) => call('fs:mkdir', p),
      remove: (p, o) => call('fs:remove', p, o || {}),
      rename: (a, b) => call('fs:rename', a, b),
      copy: (a, b) => call('fs:copy', a, b),
      usage: () => call('fs:usage'),
    },

    kv: {
      get: (k) => call('kv:get', k),
      set: (k, v) => call('kv:set', k, v),
      delete: (k) => call('kv:delete', k),
      keys: (prefix = '') => call('kv:keys', prefix),
    },

    system: {
      stats: () => call('system:stats'),
      battery: batteryStatus,
      onBatteryChange,
      network: mergeNetwork,
      onNetworkChange: (cb) => onBrowserNetworkChange(() => mergeNetwork().then(cb)),
    },

    power: {
      shutdown: async () => { await call('power:shutdown'); return true; },
      restart: () => call('power:restart'),
      onCloseRequest: (cb) => native.on('shell:closeRequest', cb),
    },

    capture: {
      screen: () => call('capture:screen'),
    },

    display: {
      setFullscreen: (on) => call('display:setFullscreen', !!on),
      isFullscreen: () => fsc.isFullscreen() || native.isFullscreen(),
      onFullscreenChange: (cb) => native.on('display:fullscreen', cb),
    },

    host: {
      importFiles: (opts = {}) => call('host:importFiles', opts),
      exportFile: (name, data, mime) => call('host:exportFile', name, data, mime),
      openExternal: (url) => call('host:openExternal', url),
    },

    browser: {
      kind: 'webview',
      createView: ({ partition } = {}) => createWebviewView({ partition, native }),
      setDownloadDir: (vpath) => call('browser:setDownloadDir', vpath),
      onDownload: (cb) => native.on('browser:download', cb),
      cancelDownload: (id) => call('browser:cancelDownload', id),
      onOpenRequest: (cb) => native.on('browser:open', cb),
      clearData: (what) => call('browser:clearData', what || {}),
      // A <webview> is a top-level page of its own, so frame rules don't apply.
      canEmbed: async () => true,
      relayAvailable: async () => false, // webviews show every site directly
      // Real key presses into a Browser page (the on-screen keyboard).
      sendKey: (webContentsId, ev) => call('browser:sendKey', webContentsId, ev),
    },

    updates: {
      status: () => update,
      check: () => call('updates:check'),
      install: () => call('updates:install'),
      onStatus: (cb) => { updateListeners.add(cb); return () => updateListeners.delete(cb); },
    },
  };
}
