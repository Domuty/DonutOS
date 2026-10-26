// Web platform adapter: IndexedDB file system and settings, browser APIs for the rest,
// and a service worker for offline use and updates.

import { createFrameView } from './common/web-view.js';
import { openDb, req, tx } from './web/idb.js';
import { IdbFileSystem } from './web/idb-fs.js';
import {
  batteryStatus, onBatteryChange, browserNetwork, onBrowserNetworkChange,
  LoadMonitor, fullscreenApi, detectOs, detectEngine,
} from './common/browser-apis.js';

const DB_NAME = 'donutos';
const DB_VERSION = 1;
const APP_VERSION = '0.1.0';

// Most big sites forbid being shown in a frame (X-Frame-Options / CSP frame-ancestors) and the
// frame then just stays empty. A page can't see another site's headers, so the server that hosts
// DonutOS answers: api/frame-check.js on Vercel, scripts/serve.js locally. On hosts without
// it (GitHub Pages, offline) the answer is null and the Browser tries the frame anyway.
const frameAnswers = new Map();
let frameCheckMissing = false;
// The Browser's relay (api/relay): whether this host has it, asked once.
let relayProbe = null;
const relayBase = () => new URL('api/relay?url=', document.baseURI).href;
function relayAvailable() {
  relayProbe ||= fetch(new URL('api/relay?probe=1', document.baseURI))
    .then(async (r) => r.ok && (r.headers.get('content-type') || '').includes('json') && (await r.json()).relay === true)
    .catch(() => { relayProbe = null; return false; });
  return relayProbe;
}

async function frameCheck(url) {
  if (frameCheckMissing || !/^https?:/i.test(url)) return null;
  const cached = frameAnswers.get(url);
  if (cached && Date.now() - cached.time < 10 * 60e3) return cached.embeddable;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const api = new URL('api/frame-check', document.baseURI);
    api.search = new URLSearchParams({ url, origin: location.origin });
    const res = await fetch(api, { signal: ctl.signal });
    if (res.status === 404 || !(res.headers.get('content-type') || '').includes('json')) { frameCheckMissing = true; return null; }
    const { embeddable = null } = await res.json();
    if (embeddable !== null) frameAnswers.set(url, { embeddable, time: Date.now() });
    return embeddable;
  } catch {
    return null;
  } finally { clearTimeout(timer); }
}

export function createWebAdapter({ dbName = DB_NAME } = {}) {
  let db = null;
  let fs = null;
  const load = new LoadMonitor();
  const sessionStart = Date.now();
  const updateListeners = new Set();
  let update = { state: 'idle', version: null, progress: 0, message: '' };
  let registration = null;

  const setUpdate = (patch) => {
    update = { ...update, ...patch };
    for (const l of updateListeners) l(update);
  };

  const watchRegistration = (reg) => {
    registration = reg;
    const track = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) setUpdate({ state: 'ready', message: 'A new version of DonutOS is ready.' });
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) setUpdate({ state: 'ready', message: 'A new version of DonutOS is ready.' });
    track(reg.installing);
    reg.addEventListener('updatefound', () => {
      // The very first install is not an update: it only makes DonutOS available offline.
      if (!navigator.serviceWorker.controller) {
        reg.installing?.addEventListener('statechange', (e) => {
          if (e.target.state === 'activated') setUpdate({ state: 'up-to-date', message: 'DonutOS is up to date and available offline.' });
        });
        return;
      }
      setUpdate({ state: 'downloading', message: 'Downloading the new version…' });
      track(reg.installing);
    });
    if (reg.active && !reg.waiting && !reg.installing) setUpdate({ state: 'up-to-date', message: 'DonutOS is up to date and available offline.' });
  };

  const adapter = {
    name: 'web',

    async init() {
      db = await openDb(dbName, DB_VERSION, (d) => {
        if (!d.objectStoreNames.contains('nodes')) d.createObjectStore('nodes', { keyPath: 'path' }).createIndex('parent', 'parent');
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      });
      fs = new IdbFileSystem(db);
      await fs.ensureRoot();
      // Ask the browser not to evict DonutOS data under storage pressure.
      navigator.storage?.persist?.().catch(() => {});
      load.start();
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !globalThis.DONUT_NO_SW) {
        navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname })
          .then(watchRegistration)
          .catch((err) => setUpdate({ state: 'unsupported', message: `Offline mode unavailable: ${err.message}` }));
      } else {
        update = { ...update, state: 'unsupported', message: 'Updates are delivered when the page is reloaded.' };
      }
    },

    async info() {
      return {
        platform: 'web',
        os: detectOs(),
        osVersion: navigator.userAgentData?.platformVersion || '',
        arch: navigator.userAgentData?.architecture || '',
        hostname: location.hostname || 'localhost',
        cpuModel: 'Not exposed by the browser',
        cores: navigator.hardwareConcurrency || 1,
        appVersion: APP_VERSION,
        engine: detectEngine(),
        sandboxRoot: null,
      };
    },

    fs: {
      stat: (p) => fs.stat(p),
      readdir: (p) => fs.readdir(p),
      readFile: (p) => fs.readFile(p),
      writeFile: (p, d) => fs.writeFile(p, d),
      mkdir: (p) => fs.mkdir(p),
      remove: (p, o) => fs.remove(p, o),
      rename: (a, b) => fs.rename(a, b),
      copy: (a, b) => fs.copy(a, b),
      usage: () => fs.usage(),
    },

    kv: {
      get: (key) => tx(db, ['kv'], 'readonly', ({ kv }) => req(kv.get(key))),
      set: (key, value) => tx(db, ['kv'], 'readwrite', ({ kv }) => { kv.put(structuredClone(value), key); }),
      delete: (key) => tx(db, ['kv'], 'readwrite', ({ kv }) => { kv.delete(key); }),
      keys: async (prefix = '') => {
        const all = await tx(db, ['kv'], 'readonly', ({ kv }) => req(kv.getAllKeys()));
        return all.filter((k) => typeof k === 'string' && k.startsWith(prefix));
      },
    },

    system: {
      async stats() {
        const mem = performance.memory;
        const est = (await navigator.storage?.estimate?.()) || {};
        const deviceBytes = (navigator.deviceMemory || 0) * 1024 ** 3;
        const memTotal = mem?.jsHeapSizeLimit || deviceBytes || 0;
        const memUsed = mem?.usedJSHeapSize ?? 0;
        return {
          time: Date.now(),
          estimated: true,
          cpu: { usage: load.usage, cores: navigator.hardwareConcurrency || 1, model: 'Browser main thread', perCore: null },
          memory: { total: memTotal, used: memUsed, free: Math.max(0, memTotal - memUsed), label: mem ? 'DonutOS memory (browser heap)' : 'Device memory (approximate)' },
          disk: { total: est.quota ?? 0, used: est.usage ?? 0, free: Math.max(0, (est.quota ?? 0) - (est.usage ?? 0)), label: 'Browser storage for DonutOS' },
          uptime: (Date.now() - sessionStart) / 1000,
        };
      },
      battery: batteryStatus,
      onBatteryChange,
      network: async () => browserNetwork(),
      onNetworkChange: (cb) => onBrowserNetworkChange(() => cb(browserNetwork())),
    },

    power: {
      async shutdown() {
        // Browsers only let a page close itself when it was opened by a script or is a
        // fresh window with no history (an installed app window); otherwise don't try.
        if (!(window.opener || history.length <= 1)) return false;
        window.close();
        await new Promise((r) => setTimeout(r, 300));
        return window.closed;
      },
      async restart() { location.reload(); },
      // A web page cannot intercept the browser closing it, so this never fires on the web.
      onCloseRequest: () => () => {},
    },

    capture: {
      async screen() {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'browser', frameRate: 5 }, audio: false,
          preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude',
        });
        try {
          return await grabFrame(stream);
        } finally {
          stream.getTracks().forEach((t) => t.stop());
        }
      },
    },

    display: fullscreenApi(),

    host: {
      importFiles({ multiple = true, accept = '', directory = false } = {}) {
        return new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = multiple;
          if (accept) input.accept = accept;
          if (directory) input.webkitdirectory = true;
          input.style.display = 'none';
          document.body.appendChild(input);
          const done = async () => {
            const files = [...(input.files || [])];
            input.remove();
            resolve(await Promise.all(files.map(async (f) => ({
              name: f.name, relativePath: f.webkitRelativePath || f.name, type: f.type, size: f.size,
              lastModified: f.lastModified, data: new Uint8Array(await f.arrayBuffer()),
            }))));
          };
          input.addEventListener('change', done, { once: true });
          input.addEventListener('cancel', () => { input.remove(); resolve([]); }, { once: true });
          input.click();
        });
      },
      async exportFile(name, data, mime = 'application/octet-stream') {
        const url = URL.createObjectURL(new Blob([data], { type: mime }));
        const a = document.createElement('a');
        a.href = url; a.download = name; a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        return { saved: true, location: 'Your browser\'s Downloads folder' };
      },
      async openExternal(url) {
        if (!/^(https?:|mailto:)/i.test(url)) throw new Error('Only web and mail links can be opened');
        window.open(url, '_blank', 'noopener,noreferrer');
      },
    },

    // Pages load in sandboxed iframes; the browser itself handles downloads and storage.
    browser: {
      kind: 'frame',
      createView: ({ relay = false } = {}) => (relay ? createFrameView({ sandbox: 'relay', relayBase: relayBase() }) : createFrameView()),
      // Sites that refuse frames can be shown through the relay where the host has one (Vercel, serve.js).
      relayAvailable,
      setDownloadDir: async () => {},
      onDownload: () => () => {},
      cancelDownload: async () => {},
      onOpenRequest: () => () => {},
      clearData: async () => {},
      canEmbed: frameCheck,
      // Pages are cross-origin frames: DonutOS can't type into them.
      sendKey: async () => false,
    },

    updates: {
      status: () => update,
      async check() {
        if (!registration) return update;
        setUpdate({ state: 'checking' });
        try {
          await registration.update();
          if (registration.waiting) setUpdate({ state: 'ready', message: 'A new version of DonutOS is ready.' });
          else if (registration.installing) setUpdate({ state: 'downloading' });
          else setUpdate({ state: 'up-to-date', message: 'DonutOS is up to date.' });
        } catch (err) {
          setUpdate({ state: navigator.onLine ? 'error' : 'up-to-date', message: navigator.onLine ? err.message : 'You are offline.' });
        }
        return update;
      },
      async install() {
        const waiting = registration?.waiting;
        if (!waiting) { location.reload(); return; }
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        waiting.postMessage({ type: 'skip-waiting' });
      },
      onStatus(cb) { updateListeners.add(cb); return () => updateListeners.delete(cb); },
    },
  };
  return adapter;
}

/** Draws the first real frame of a screen-capture stream to a PNG. */
async function grabFrame(stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  // Wait for a frame that has actually been rendered (the first can be blank).
  await new Promise((r) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(() => r()) : setTimeout(r, 200)));
  await new Promise((r) => setTimeout(r, 120));
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  video.srcObject = null;
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return { data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}
