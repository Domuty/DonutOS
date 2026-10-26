// Kernel console: a live read-out of the running core (platform, hardware stats, processes,
// file system, update channel and kernel log). A developer tool; mountKernelConsole()
// renders into a container and returns a function that stops it.

import { formatBytes } from './core/util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (used, total) => (total > 0 ? Math.min(100, (used / total) * 100) : 0);

export function mountKernelConsole(root, kernel) {
  const { platform } = kernel;
  const info = kernel.info;
  root.innerHTML = `
    <div class="kc">
      <header>
        <img src="assets/brand/logo.svg" alt="">
        <div>
          <h1>DonutOS ${esc(kernel.version)} — kernel console</h1>
          <p>The core is running on the <b>${esc(platform.name)}</b> platform.</p>
        </div>
        <div class="kc-actions">
          <a class="kc-btn kc-primary" href="tests/index.html" target="_blank" rel="noopener">Run core tests</a>
          <button data-act="fullscreen">Toggle full screen</button>
          <button data-act="update">Check for updates</button>
        </div>
      </header>
      <div class="kc-grid">
        <section><h2>Device</h2><dl>
          <dt>Platform</dt><dd>${esc(info.platform)}</dd>
          <dt>Host OS</dt><dd>${esc(`${info.os} ${info.osVersion}`.trim())} ${esc(info.arch)}</dd>
          <dt>Host name</dt><dd>${esc(info.hostname)}</dd>
          <dt>Processor</dt><dd>${esc(info.cpuModel)} · ${info.cores} cores</dd>
          <dt>Engine</dt><dd>${esc(info.engine)}</dd>
          <dt>Files stored in</dt><dd>${esc(info.sandboxRoot || 'IndexedDB (this browser)')}</dd>
        </dl></section>
        <section><h2>Live stats <span data-k="est"></span></h2><dl>
          <dt>CPU</dt><dd><span data-k="cpu"></span><div class="kc-meter"><i data-m="cpu"></i></div></dd>
          <dt data-k="memLabel">Memory</dt><dd><span data-k="mem"></span><div class="kc-meter"><i data-m="mem"></i></div></dd>
          <dt>Storage</dt><dd><span data-k="disk"></span><div class="kc-meter"><i data-m="disk"></i></div></dd>
          <dt>Battery</dt><dd data-k="battery"></dd>
          <dt>Network</dt><dd data-k="net"></dd>
          <dt>Uptime</dt><dd data-k="uptime"></dd>
        </dl><p class="kc-note" data-k="diskLabel"></p></section>
        <section><h2>Processes</h2><table><thead><tr><th>PID</th><th>Name</th><th>CPU</th><th>Memory</th></tr></thead><tbody data-k="procs"></tbody></table></section>
        <section><h2>File system</h2><pre data-k="tree" tabindex="0" aria-label="File system"></pre></section>
        <section><h2>Updates</h2><dl><dt>Status</dt><dd data-k="update"></dd></dl></section>
        <section><h2>Kernel log</h2><pre data-k="log" tabindex="0" aria-label="Kernel log"></pre></section>
      </div>
    </div>`;

  const $ = (k) => root.querySelector(`[data-k="${k}"]`);
  const meter = (k, v) => { root.querySelector(`[data-m="${k}"]`).style.width = `${v}%`; };

  const refreshStats = async () => {
    const s = await platform.system.stats();
    if (!root.querySelector('.kc')) return; // closed while waiting
    $('est').textContent = s.estimated ? '(estimated)' : '(from the OS)';
    $('cpu').textContent = `${s.cpu.usage.toFixed(1)} %`;
    meter('cpu', s.cpu.usage);
    $('memLabel').textContent = s.memory.label;
    $('mem').textContent = s.memory.total ? `${formatBytes(s.memory.used)} of ${formatBytes(s.memory.total)}` : formatBytes(s.memory.used);
    meter('mem', pct(s.memory.used, s.memory.total));
    $('disk').textContent = `${formatBytes(s.disk.used)} of ${formatBytes(s.disk.total)}`;
    meter('disk', pct(s.disk.used, s.disk.total));
    $('diskLabel').textContent = `Storage: ${s.disk.label}.`;
    const up = Math.floor(s.uptime);
    $('uptime').textContent = `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m ${up % 60}s`;
    const b = await platform.system.battery();
    if (!root.querySelector('.kc')) return;
    $('battery').textContent = b.supported ? `${Math.round(b.level * 100)} % ${b.charging ? '(charging)' : ''}` : 'No battery reported';
    const n = await platform.system.network();
    if (!root.querySelector('.kc')) return;
    $('net').textContent = n.online ? `Online · ${n.type}${n.effectiveType ? ` · ${n.effectiveType}` : ''}${n.interfaces.length ? ` · ${n.interfaces.map((i) => i.name).join(', ')}` : ''}` : 'Offline';
  };

  const refreshProcs = () => {
    $('procs').innerHTML = kernel.processes.snapshot().map((p) =>
      `<tr><td>${p.pid}</td><td>${esc(p.name)}</td><td>${p.cpu.toFixed(1)} %</td><td>${formatBytes(p.memory)}</td></tr>`).join('');
  };

  const refreshTree = async () => {
    const lines = [];
    await kernel.fs.walk('/', (e) => {
      const depth = e.path.split('/').length - 2;
      lines.push(`${'  '.repeat(depth)}${e.type === 'dir' ? '▸ ' : '  '}${e.name}${e.type === 'file' ? `  (${formatBytes(e.size)})` : ''}`);
      return depth < 2;
    });
    if (!root.querySelector('.kc')) return;
    $('tree').textContent = ['/', ...lines].join('\n');
  };

  const refreshUpdate = (u = platform.updates.status()) => {
    root.querySelector('[data-act="update"]').textContent = u.state === 'ready' ? 'Restart to update' : 'Check for updates';
    $('update').textContent = `${u.state}${u.message ? ` — ${u.message}` : ''}${u.state === 'downloading' && u.progress ? ` (${Math.round(u.progress * 100)} %)` : ''}`;
  };

  const refreshLog = () => {
    $('log').textContent = kernel.log.entries({ limit: 40 }).map((e) =>
      `${new Date(e.time).toLocaleTimeString()}  ${e.level.padEnd(5)} ${e.source}: ${e.message}`).join('\n');
  };

  const onClick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fullscreen') await platform.display.setFullscreen(!platform.display.isFullscreen());
    if (act === 'update') {
      if (platform.updates.status().state === 'ready') await platform.updates.install();
      else refreshUpdate(await platform.updates.check());
    }
  };
  root.addEventListener('click', onClick);

  const offs = [
    platform.updates.onStatus(refreshUpdate),
    kernel.bus.on('kernel:log', refreshLog),
    kernel.bus.on('process:sample', refreshProcs),
    kernel.bus.on('fs:changed', refreshTree),
  ];
  const timer = setInterval(refreshStats, 1000);
  refreshStats(); refreshProcs(); refreshTree(); refreshUpdate(); refreshLog();
  return () => { clearInterval(timer); offs.forEach((off) => off()); root.removeEventListener('click', onClick); root.replaceChildren(); };
}
