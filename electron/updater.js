// Auto-updates from GitHub Releases via electron-updater. Status changes are pushed to
// the renderer as "updates:status" so Settings › DonutOS Update shows live progress.
//
// Windows and Linux (AppImage, .deb) download and install updates themselves. macOS only
// lets an app replace itself when it's signed with an Apple Developer certificate, which
// DonutOS's free builds aren't; there DonutOS checks for new versions and offers to open
// the download page instead (state "available").
//
// DONUTOS_UPDATE_URL=<url> points the updater at a generic update feed (testing, or hosting
// updates yourself).

'use strict';
const { app, shell } = require('electron');

const RELEASES = 'https://github.com/Domuty/DonutOS/releases/latest';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function createUpdater(send, { autoCheck = () => true } = {}) {
  let status = { state: 'idle', version: null, progress: 0, message: '' };
  const set = (patch) => { status = { ...status, ...patch }; send('updates:status', status); };

  if (!app.isPackaged) {
    status = { ...status, state: 'unsupported', message: 'Updates are only available in the installed app (not when running from source).' };
    return { status: () => status, check: async () => status, install: async () => {}, start() {} };
  }

  const { autoUpdater } = require('electron-updater');
  const manual = process.platform === 'darwin';
  if (process.env.DONUTOS_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.DONUTOS_UPDATE_URL });
  autoUpdater.autoDownload = !manual;
  autoUpdater.autoInstallOnAppQuit = !manual;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: 'Checking for updates…' }));
  autoUpdater.on('update-available', (i) => set(manual
    ? { state: 'available', version: i.version, progress: 0, message: `DonutOS ${i.version} is available. Download it and replace the app in your Applications folder.` }
    : { state: 'downloading', version: i.version, progress: 0, message: `Downloading DonutOS ${i.version}…` }));
  autoUpdater.on('update-not-available', () => set({ state: 'up-to-date', message: `DonutOS ${app.getVersion()} is the latest version.` }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: p.percent / 100 }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version, progress: 1, message: `DonutOS ${i.version} is ready. It installs when you restart DonutOS.` }));
  autoUpdater.on('error', (err) => set({ state: 'error', message: friendly(err) }));

  const check = async () => {
    if (status.state === 'checking' || status.state === 'downloading') return status;
    try { await autoUpdater.checkForUpdates(); } catch (err) { set({ state: 'error', message: friendly(err) }); }
    return status;
  };
  return {
    status: () => status,
    check,
    async install() {
      if (status.state === 'ready') setImmediate(() => autoUpdater.quitAndInstall(false, true));
      else if (status.state === 'available') await shell.openExternal(RELEASES);
    },
    /** Checks shortly after start and then every few hours, while automatic updates are on. */
    start() {
      setTimeout(() => { if (autoCheck()) check(); }, 10_000);
      setInterval(() => { if (autoCheck() && status.state !== 'ready') check(); }, CHECK_EVERY_MS);
    },
  };
}

function friendly(err) {
  const msg = String(err?.message || err || 'Update failed');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_|getaddrinfo/i.test(msg)) return 'DonutOS couldn’t reach the update server. Check your internet connection and try again.';
  if (/404|No published versions|Cannot find latest/i.test(msg)) return 'No updates have been published yet.';
  return msg.split('\n')[0].slice(0, 300);
}

module.exports = { createUpdater };
