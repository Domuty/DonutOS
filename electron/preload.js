// The only bridge between DonutOS (renderer) and the host computer. It exposes a fixed
// list of IPC channels; nothing else from Node or Electron is reachable from the page.

'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'fs:stat', 'fs:readdir', 'fs:readFile', 'fs:writeFile', 'fs:mkdir', 'fs:remove', 'fs:rename', 'fs:copy', 'fs:usage',
  'kv:get', 'kv:set', 'kv:delete', 'kv:keys',
  'system:info', 'system:stats', 'system:network',
  'power:shutdown', 'power:restart',
  'display:setFullscreen',
  'host:importFiles', 'host:exportFile', 'host:openExternal',
  'updates:status', 'updates:check', 'updates:install',
  'capture:screen',
]);
const EVENTS = new Set(['updates:status', 'display:fullscreen', 'shell:closeRequest']);

const config = ipcRenderer.sendSync('app:config');
let fullscreen = !!config.fullscreen;
ipcRenderer.on('display:fullscreen', (_e, on) => { fullscreen = on; });

const api = {
  version: config.version,
  invoke(channel, ...args) {
    if (!INVOKE.has(channel)) return Promise.resolve({ ok: false, error: { code: 'EINVAL', message: `Unknown channel ${channel}` } });
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, cb) {
    if (!EVENTS.has(channel)) throw new Error(`Unknown event ${channel}`);
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  isFullscreen: () => fullscreen,
};

if (config.tests) api.reportTests = (results) => ipcRenderer.send('test:report', results);

contextBridge.exposeInMainWorld('donutNative', api);
