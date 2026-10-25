// Real system statistics for the desktop build, from Node's os module.

'use strict';
const os = require('node:os');
const fsp = require('node:fs/promises');

let last = os.cpus().map((c) => c.times);

function cpuUsage() {
  const now = os.cpus().map((c) => c.times);
  const perCore = now.map((t, i) => {
    const p = last[i] || t;
    const idle = t.idle - p.idle;
    const total = (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq) + idle;
    return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0;
  });
  last = now;
  const usage = perCore.length ? perCore.reduce((a, b) => a + b, 0) / perCore.length : 0;
  return { usage, perCore };
}

async function stats(diskRoot) {
  const { usage, perCore } = cpuUsage();
  const cpus = os.cpus();
  const total = os.totalmem(), free = os.freemem();
  let disk = { total: 0, used: 0, free: 0, label: 'Disk' };
  try {
    const st = await fsp.statfs(diskRoot);
    const dt = st.blocks * st.bsize, df = st.bavail * st.bsize;
    disk = { total: dt, used: dt - df, free: df, label: 'Disk containing the DonutOS folder' };
  } catch { /* statfs unsupported: report zeros */ }
  return {
    time: Date.now(),
    estimated: false,
    cpu: { usage, cores: cpus.length, model: (cpus[0] && cpus[0].model.trim()) || 'CPU', perCore },
    memory: { total, used: total - free, free, label: 'System memory' },
    disk,
    uptime: os.uptime(),
  };
}

function info(appVersion, sandboxRoot) {
  const platforms = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  const cpus = os.cpus();
  return {
    platform: 'desktop',
    os: platforms[process.platform] || process.platform,
    osVersion: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpuModel: (cpus[0] && cpus[0].model.trim()) || 'CPU',
    cores: cpus.length,
    appVersion,
    engine: `Electron ${process.versions.electron} (Chromium ${process.versions.chrome.split('.')[0]})`,
    sandboxRoot,
  };
}

/** Network interfaces that are up, classified by name (the OS gives no type field). */
function network() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    const ext = (addrs || []).filter((a) => !a.internal);
    if (!ext.length) continue;
    const n = name.toLowerCase();
    let type = 'unknown';
    if (/wi-?fi|wlan|wlp|airport|wireless/.test(n)) type = 'wifi';
    else if (/^en\d$/.test(n) && process.platform === 'darwin') type = n === 'en0' ? 'wifi' : 'ethernet';
    else if (/eth|enp|eno|ens|ethernet|local area/.test(n)) type = 'ethernet';
    else if (/wwan|cell|rmnet/.test(n)) type = 'cellular';
    if (/vethernet|docker|veth|virtualbox|vmnet|tun|tap|utun|br-|zt|tailscale|wsl/.test(n)) continue;
    const v4 = ext.find((a) => a.family === 'IPv4' || a.family === 4) || ext[0];
    out.push({ name, type, address: v4.address });
  }
  return out;
}

module.exports = { stats, info, network };
