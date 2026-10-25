// Auto-updates from GitHub Releases via electron-updater. Status changes are pushed to
// the renderer as "updates:status" so Settings › Update shows live progress.

'use strict';
const { app } = require('electron');

function createUpdater(send) {
  let status = { state: 'idle', version: null, progress: 0, message: '' };
  const set = (patch) => { status = { ...status, ...patch }; send('updates:status', status); };

  if (!app.isPackaged) {
    status = { ...status, state: 'unsupported', message: 'Updates are only available in the installed app (not when running from source).' };
    return { status: () => status, check: async () => status, install: async () => {} };
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: 'Checking for updates…' }));
  autoUpdater.on('update-available', (i) => set({ state: 'downloading', version: i.version, progress: 0, message: `Downloading DonutOS ${i.version}…` }));
  autoUpdater.on('update-not-available', () => set({ state: 'up-to-date', message: 'DonutOS is up to date.' }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: p.percent / 100 }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version, progress: 1, message: `DonutOS ${i.version} is ready to install.` }));
  autoUpdater.on('error', (err) => set({ state: 'error', message: err == null ? 'Update failed' : String(err.message || err) }));

  return {
    status: () => status,
    async check() {
      try { await autoUpdater.checkForUpdates(); } catch (err) { set({ state: 'error', message: String(err.message || err) }); }
      return status;
    },
    async install() { if (status.state === 'ready') setImmediate(() => autoUpdater.quitAndInstall(false, true)); },
  };
}

module.exports = { createUpdater };
