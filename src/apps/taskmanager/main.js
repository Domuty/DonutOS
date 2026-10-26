// Task Manager: running apps and processes, live performance graphs, startup apps,
// signed-in users and a full process list. Numbers come from the kernel's process sampler
// and the platform adapter (estimated in a browser, real hardware on the desktop).

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { showMenu } from '../../ui/menu.js';
import { alertDialog, confirmDialog, dialog } from '../../ui/dialog.js';
import { avatar } from '../../ui/avatar.js';
import { formatBytes } from '../../core/util.js';
import { launchApp } from '../../shell/apps.js';
import { History, drawGraph } from './graph.js';

const PAGES = [
  ['processes', 'Processes', 'apps'],
  ['performance', 'Performance', 'activity'],
  ['startup', 'Startup apps', 'rocket'],
  ['users', 'Users', 'users'],
  ['details', 'Details', 'list'],
];
const SPEEDS = { high: 1000, normal: 2000, low: 4000, paused: 0 };
const POINTS = 60;

const pct = (v) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;
const mb = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const dur = (s) => {
  s = Math.floor(s);
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${d ? `${d}:` : ''}${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
// Cell tint that deepens with load, like a heat map.
const heat = (v, max) => ({ background: v / max > 0.08 ? `color-mix(in srgb, var(--accent) ${Math.min(42, 6 + (v / max) * 36).toFixed(0)}%, transparent)` : '' });

export default function main(ctx) {
  const k = ctx.privileged;
  const me = ctx.accounts.current();
  const isAdmin = me.type === 'admin';
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'Task Manager', width: 1000, height: 680, minWidth: 560, minHeight: 400 });
  win.body.classList.add('taskmanager');

  let page = PAGES.some(([id]) => id === store.get('page')) ? store.get('page') : 'processes';
  let speed = SPEEDS[store.get('speed')] !== undefined ? store.get('speed') : 'normal';
  let query = '';
  let selected = null;              // pid
  const expanded = new Set();       // pids (Processes) / uids (Users)
  let sort = store.get('sort', { key: null, dir: -1 });
  let detailSort = store.get('detailSort', { key: 'pid', dir: 1 });
  let procs = k.processes.snapshot();
  let stats = null, battery = null, network = null;
  let locked = false;
  let device = 'cpu';               // Performance page selection
  const hist = { cpu: new History(POINTS), mem: new History(POINTS), disk: new History(POINTS), net: new History(POINTS), battery: new History(POINTS) };
  const cores = [];                 // per-core History when the platform reports it

  // ── Measurements that exist only while Task Manager watches ───────────
  // Disk: DonutOS file operations per second (every write, move, delete is an event).
  let fileOps = 0;
  ctx.bus.on('fs:changed', () => { fileOps++; });
  // Network: bytes DonutOS and its apps received over http(s), from Resource Timing.
  let netBytes = 0, netTotal = 0;
  if (typeof PerformanceObserver === 'function') {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!/^https?:/.test(e.name)) continue;
        const n = e.transferSize || e.encodedBodySize || 0;
        netBytes += n; netTotal += n;
      }
    });
    try { po.observe({ type: 'resource', buffered: false }); ctx.own(() => po.disconnect()); } catch { /* unsupported */ }
  }

  // ── Layout ───────────────────────────────────────────────────────────
  const rail = h('nav.tm-rail', { 'aria-label': 'Task Manager pages' });
  const title = h('h1.tm-title');
  const search = h('input.input.tm-search', { type: 'search', placeholder: 'Type a name, publisher, or PID to search', 'aria-label': 'Search processes', oninput: () => { query = search.value.trim().toLowerCase(); render(); } });
  const actions = h('div.tm-actions');
  const content = h('div.tm-content', { tabindex: '-1' });
  mount(win.body, h('div.tm', rail, h('div.tm-main', h('div.tm-head', title, search, actions), content)));

  function renderRail() {
    mount(rail, PAGES.map(([id, label, ic]) => h('button.tm-nav', { type: 'button', 'aria-current': page === id ? 'page' : undefined, title: label, onclick: () => go(id) }, icon(ic, { size: 18 }), h('span', label))),
      h('div.tm-rail-gap'),
      h('button.tm-nav', { type: 'button', 'aria-current': page === 'settings' ? 'page' : undefined, title: 'Settings', onclick: () => go('settings') }, icon('settings', { size: 18 }), h('span', 'Settings')));
  }

  function go(id) {
    page = id;
    if (id !== 'settings') store.set('page', id);
    selected = null;
    renderRail();
    render();
    content.scrollTop = 0;
  }

  // ── Data ─────────────────────────────────────────────────────────────
  const userName = (uid) => (uid ? k.accounts.get(uid)?.name || k.sessions.get(uid)?.user.name || 'Unknown' : 'SYSTEM');
  const windowsOf = (pid, uid) => (k.windowHost?.(uid)?.list() || []).filter((w) => w.pid === pid);
  const canEnd = (p) => !p.critical && (p.user === me.id || isAdmin);
  const matches = (p) => !query || p.name.toLowerCase().includes(query) || String(p.pid) === query || p.appId.toLowerCase().includes(query)
    || (k.registry.get(p.appId)?.builtin ? 'donutos' : 'installed').includes(query);

  async function sampleSystem() {
    const [s, b, n] = await Promise.all([ctx.system.stats().catch(() => null), ctx.system.battery().catch(() => null), ctx.system.network().catch(() => null)]);
    stats = s; battery = b; network = n;
    if (s) {
      hist.cpu.push(s.cpu.usage);
      hist.mem.push(s.memory.total ? (s.memory.used / s.memory.total) * 100 : 0);
      (s.cpu.perCore || []).forEach((v, i) => { (cores[i] ||= new History(POINTS)).push(v); });
    }
    const secs = (SPEEDS[speed] || 1000) / 1000;
    hist.disk.push(fileOps / secs); fileOps = 0;
    hist.net.push(netBytes / secs); netBytes = 0;
    if (b?.supported) hist.battery.push(b.level * 100);
  }

  let timer = null;
  function schedule() {
    ctx.clearInterval(timer);
    timer = SPEEDS[speed] ? ctx.setInterval(tick, SPEEDS[speed]) : null;
  }
  async function tick() {
    procs = k.processes.snapshot();
    await sampleSystem();
    render({ tick: true });
  }

  // ── Actions ──────────────────────────────────────────────────────────
  async function endTask(pid) {
    const p = k.processes.get(pid);
    if (!p) return;
    if (p.critical) { alertDialog(`${p.name} can’t be ended`, 'It’s part of DonutOS. Ending it would stop the system; restart DonutOS from Start › Power instead.'); return; }
    if (!canEnd(p)) { alertDialog('Access denied', `${p.name} belongs to ${userName(p.user)}. Only an administrator can end another user’s apps.`); return; }
    try { await k.processes.kill(pid); } catch (err) { alertDialog('Couldn’t end the task', err.message); }
    if (selected === pid) selected = null;
    procs = k.processes.snapshot();
    render();
  }

  function switchTo(pid) {
    const p = k.processes.get(pid);
    const w = p && windowsOf(pid, p.user)[0];
    if (!w || p.user !== k.session.user?.id) return false;
    if (w.state === 'minimized') w.restore();
    w.focus();
    return true;
  }

  async function runNewTask() {
    k.bus.emit('shell:runDialog', {});
  }

  function menuFor(p, e) {
    const wins = windowsOf(p.pid, p.user);
    showMenu([
      ...(wins.length && p.user === k.session.user?.id ? [{ label: 'Switch to', icon: 'arrowRight', onSelect: () => switchTo(p.pid) }] : []),
      { label: 'End task', icon: 'close', disabled: !canEnd(p), onSelect: () => endTask(p.pid) },
      { separator: true },
      { label: 'Go to details', icon: 'list', onSelect: () => { go('details'); selected = p.pid; render(); } },
      ...(k.registry.get(p.appId) && !p.critical ? [{ label: 'App settings', icon: 'settings', onSelect: () => launchApp(k, 'settings', { page: 'appinfo', appId: p.appId }) }] : []),
      { label: 'Properties', icon: 'info', onSelect: () => properties(p) },
    ], { x: e.clientX, y: e.clientY });
  }

  function properties(p) {
    const app = k.registry.get(p.appId);
    const dl = (pairs) => h('dl.tm-props', pairs.flatMap(([a, b]) => [h('dt', a), h('dd', b)]));
    dialog({
      title: `${p.name} properties`, width: 460,
      body: dl([
        ['App', app ? `${app.name} ${app.version}` : p.name],
        ['App ID', p.appId],
        ['Publisher', app?.builtin ? 'DonutOS' : app?.author || 'Installed app'],
        ['PID', String(p.pid)],
        ['Parent PID', p.parentPid ? String(p.parentPid) : '—'],
        ['User', userName(p.user)],
        ['Started', new Date(p.startTime).toLocaleString()],
        ['Start-up time', p.launchMs !== null ? `${p.launchMs} ms` : '—'],
        ['CPU time', dur(p.cpuTime / 1000)],
        ['Memory', mb(p.memory)],
        ['Windows', String(p.windows)],
        ['Permissions', app?.permissions?.length ? app.permissions.join(', ') : 'None'],
      ]),
      buttons: [{ label: 'Close', value: true, primary: true }],
    });
  }

  // ── Header per page ──────────────────────────────────────────────────
  function renderHead() {
    const label = page === 'settings' ? 'Settings' : PAGES.find(([id]) => id === page)[1];
    title.textContent = label;
    search.hidden = !['processes', 'details', 'startup'].includes(page);
    const sel = selected && k.processes.get(selected);
    const btn = (ic, text, onclick, opts = {}) => h('button.btn.tm-act', { type: 'button', onclick, ...opts }, icon(ic, { size: 16 }), h('span', text));
    if (page === 'processes' || page === 'details') {
      mount(actions,
        btn('plus', 'Run new task', runNewTask),
        btn('close', 'End task', () => sel && endTask(sel.pid), { disabled: !sel || !canEnd(sel.info()), title: sel?.critical ? 'DonutOS processes can’t be ended' : '' }));
    } else if (page === 'performance') {
      mount(actions, btn('plus', 'Run new task', runNewTask), btn('copy', 'Copy', copySummary, { title: 'Copy a summary of this page' }));
    } else mount(actions);
  }

  // ── Pages ────────────────────────────────────────────────────────────
  let lastPage = null;
  function render({ tick = false } = {}) {
    if (win.state === 'minimized' && tick) return;
    const changed = lastPage !== page;
    lastPage = page;
    renderHead();
    content.dataset.page = page;
    if (page === 'processes') renderProcesses();
    else if (page === 'performance') renderPerformance(changed);
    else if (page === 'startup') { if (!tick || changed) renderStartup(); }
    else if (page === 'users') renderUsers();
    else if (page === 'details') renderDetails();
    else if (page === 'settings') { if (!tick || changed) renderSettings(); }
    gridRoles(content);
  }

  // Every child of a table row is a cell (or a column header), so screen readers can read
  // the tables as grids.
  function gridRoles(root) {
    for (const r of root.querySelectorAll('.tm-table [role="row"]')) {
      for (const c of r.children) if (!c.getAttribute('role')) c.setAttribute('role', r.classList.contains('tm-header') ? 'columnheader' : 'gridcell');
    }
  }

  function sortRows(rows, s, get) {
    if (!s.key) return rows;
    return rows.sort((a, b) => {
      const x = get(a, s.key), y = get(b, s.key);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * s.dir;
    });
  }

  function th(label, key, s, onSort, cls = '') {
    const on = s.key === key;
    return h(`div.tm-th${cls}`, { role: 'columnheader', tabindex: '0', 'aria-sort': on ? (s.dir > 0 ? 'ascending' : 'descending') : 'none',
      onclick: () => onSort(on ? { key, dir: -s.dir } : { key, dir: key === 'name' || key === 'pid' || key === 'user' ? 1 : -1 }),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } },
    h('span', label), on ? icon(s.dir > 0 ? 'chevronUp' : 'chevronDown', { size: 12 }) : null);
  }

  // Processes: Apps (with windows), background processes, DonutOS processes.
  function renderProcesses() {
    const mine = procs.filter((p) => (p.user === me.id || p.critical) && matches(p));
    const apps = mine.filter((p) => !p.critical && p.windows > 0);
    const bg = mine.filter((p) => !p.critical && p.windows === 0);
    const sys = mine.filter((p) => p.critical);
    const totalCpu = stats?.cpu.usage ?? procs.reduce((a, p) => a + p.cpu, 0);
    const memPct = stats?.memory.total ? (stats.memory.used / stats.memory.total) * 100 : null;
    const get = (p, key) => (key === 'name' ? p.name : key === 'status' ? p.status : p[key]);
    const onSort = (s) => { sort = s; store.set('sort', s); render(); };
    const row = (p) => {
      const wins = windowsOf(p.pid, p.user);
      const open = expanded.has(p.pid);
      return [h('div.tm-row', {
        role: 'row', tabindex: '0', 'aria-selected': String(selected === p.pid), class: selected === p.pid && 'sel', 'aria-expanded': wins.length ? String(open) : undefined,
        onclick: () => { selected = p.pid; render(); }, ondblclick: () => switchTo(p.pid),
        oncontextmenu: (e) => { e.preventDefault(); selected = p.pid; render(); menuFor(p, e); },
        onkeydown: (e) => {
          if (e.key === 'Delete') endTask(p.pid);
          else if (e.key === 'Enter') switchTo(p.pid);
          else if (e.key === 'ArrowRight' && wins.length) { expanded.add(p.pid); render(); }
          else if (e.key === 'ArrowLeft') { expanded.delete(p.pid); render(); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSel(e.key === 'ArrowDown' ? 1 : -1); }
        },
      },
      h('div.tm-cell.tm-name',
        wins.length ? h('button.tm-twisty', { type: 'button', tabindex: '-1', 'aria-label': open ? 'Collapse' : 'Expand', onclick: (e) => { e.stopPropagation(); if (open) expanded.delete(p.pid); else expanded.add(p.pid); render(); } }, icon(open ? 'chevronDown' : 'chevronRight', { size: 12 })) : h('span.tm-twisty'),
        h('img', { src: p.icon, alt: '', width: 18, height: 18 }), h('span', p.name, wins.length > 1 ? h('small', ` (${wins.length})`) : null)),
      h('div.tm-cell', p.status),
      h('div.tm-cell.num', { style: heat(p.cpu, 100) }, pct(p.cpu)),
      h('div.tm-cell.num', { style: heat(p.memory, 64 * 1024 ** 2) }, mb(p.memory))),
      open ? wins.map((w) => h('div.tm-row.tm-sub', { role: 'row', 'aria-level': '2', ondblclick: () => switchTo(p.pid), onclick: () => { selected = p.pid; render(); } },
        h('div.tm-cell.tm-name', h('span.tm-twisty'), h('span.tm-indent'), icon('view', { size: 14 }), h('span', w.title || p.name)), h('div.tm-cell'), h('div.tm-cell'), h('div.tm-cell'))) : null];
    };
    const group = (label, list) => (list.length ? [h('div.tm-group', { role: 'row' }, h('span', { role: 'rowheader', 'aria-colspan': '4' }, `${label} (${list.length})`)), sortRows([...list], sort, get).map(row)] : null);
    const focusedPid = document.activeElement?.closest?.('.tm-row') && selected;
    mount(content, h('div.tm-table.tm-procs', { role: 'treegrid', 'aria-label': 'Processes' },
      h('div.tm-row.tm-header', { role: 'row' },
        th('Name', 'name', sort, onSort), th('Status', 'status', sort, onSort),
        th(h('span.tm-th-top', h('b', pct(totalCpu)), h('small', 'CPU')), 'cpu', sort, onSort, '.num'),
        th(h('span.tm-th-top', h('b', memPct !== null ? `${memPct < 10 ? memPct.toFixed(1) : Math.round(memPct)}%` : '—'), h('small', 'Memory')), 'memory', sort, onSort, '.num')),
      group('Apps', apps), group('Background processes', bg), group('DonutOS processes', sys)),
      !mine.length ? h('p.tm-empty', query ? `No processes match “${query}”.` : 'Nothing is running.') : null);
    if (focusedPid) content.querySelector('.tm-row.sel')?.focus({ preventScroll: true });
  }

  function moveSel(d) {
    const rows = [...content.querySelectorAll('.tm-row[tabindex]')];
    const i = rows.findIndex((r) => r.classList.contains('sel'));
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + d))];
    next?.click();
    content.querySelector('.tm-row.sel')?.focus();
  }

  // Performance: device list with mini graphs, and a detail view.
  let perfEls = null;
  function renderPerformance(rebuild) {
    const devices = [
      { id: 'cpu', label: 'CPU', ic: 'cpu', hist: hist.cpu, value: stats ? pct(stats.cpu.usage) : '—', sub: stats ? (stats.estimated ? 'DonutOS load' : `${stats.cpu.cores} cores`) : '' },
      { id: 'mem', label: 'Memory', ic: 'memory', hist: hist.mem, value: stats ? `${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}` : '—', sub: stats ? `${Math.round(hist.mem.last)}%` : '' },
      { id: 'disk', label: 'Disk', ic: 'disk', hist: hist.disk, value: stats ? `${formatBytes(stats.disk.used)} used` : '—', sub: `${hist.disk.last.toFixed(1)} file ops/s`, max: 'auto', minMax: 5 },
      { id: 'net', label: 'Network', ic: network?.type === 'ethernet' ? 'ethernet' : network?.online === false ? 'wifiOff' : 'wifi', hist: hist.net, value: network ? (network.online ? labelNet(network) : 'Not connected') : '—', sub: `R: ${formatBytes(hist.net.last)}/s`, max: 'auto', minMax: 1024 },
      ...(battery?.supported ? [{ id: 'battery', label: 'Battery', ic: 'battery', hist: hist.battery, value: `${Math.round(battery.level * 100)}%`, sub: battery.charging ? 'Charging' : 'On battery' }] : []),
    ];
    if (!devices.some((d) => d.id === device)) device = 'cpu';
    if (rebuild || !perfEls || !content.contains(perfEls.root) || perfEls.count !== devices.length || perfEls.device !== device) {
      const cards = devices.map((d) => {
        const canvas = h('canvas.tm-mini', { 'aria-hidden': 'true' });
        const value = h('small');
        const sub = h('small');
        const card = h('button.tm-dev', { type: 'button', 'aria-pressed': String(d.id === device), onclick: () => { device = d.id; renderPerformance(true); } },
          canvas, h('span.tm-dev-text', h('b', d.label), value, sub));
        return { d, card, canvas, value, sub };
      });
      const big = h('canvas.tm-big', { role: 'img' });
      const coreGrid = h('div.tm-cores');
      const facts = h('div.tm-facts');
      const head = h('div.tm-perf-head');
      const caption = h('div.tm-graph-caption');
      const footer = h('div.tm-graph-caption');
      perfEls = { root: h('div.tm-perf', h('div.tm-devs', cards.map((c) => c.card)), h('div.tm-detail', head, caption, h('div.tm-graph-wrap', big), footer, coreGrid, facts)), cards, big, coreGrid, facts, head, caption, footer, count: devices.length, device };
      mount(content, perfEls.root);
    }
    perfEls.cards.forEach((c, i) => {
      const d = devices[i];
      c.value.textContent = d.value;
      c.sub.textContent = d.sub;
      drawGraph(c.canvas, [d.hist.values], { max: d.max ?? 100, minMax: d.minMax, grid: false, points: POINTS });
    });
    const d = devices.find((x) => x.id === device);
    const top = drawGraph(perfEls.big, [d.hist.values], { max: d.max ?? 100, minMax: d.minMax, points: POINTS });
    perfEls.big.setAttribute('aria-label', `${d.label} history, last ${POINTS} samples`);
    const span = Math.round((POINTS * (SPEEDS[speed] || 1000)) / 1000);
    const scaleLabel = d.id === 'net' ? `${formatBytes(top)}/s` : d.id === 'disk' ? `${top.toFixed(0)} ops/s` : '100%';
    mount(perfEls.caption, h('span', d.id === 'cpu' ? '% Utilization' : d.id === 'mem' ? 'Memory usage' : d.id === 'disk' ? 'File operations per second' : d.id === 'net' ? 'Received' : 'Charge'), h('span', scaleLabel));
    mount(perfEls.footer, h('span', `${span} seconds`), h('span', '0'));
    const fact = (label, value) => h('div.tm-fact', h('small', label), h('b', value));
    const s = stats;
    if (d.id === 'cpu') {
      mount(perfEls.head, h('h2', 'CPU'), h('span', s?.cpu.model || ''));
      mount(perfEls.coreGrid, cores.length > 1 ? cores.map((c, i) => {
        const cv = h('canvas', { 'aria-label': `Core ${i + 1}` });
        requestAnimationFrame(() => drawGraph(cv, [c.values], { max: 100, grid: false, points: POINTS }));
        return h('div.tm-core', cv);
      }) : null);
      mount(perfEls.facts,
        fact('Utilization', s ? pct(s.cpu.usage) : '—'), fact('Processes', String(procs.length)),
        fact('Windows', String(procs.reduce((a, p) => a + p.windows, 0))), fact('Up time', s ? dur(s.uptime) : '—'),
        fact('Logical processors', s ? String(s.cpu.cores) : '—'),
        h('p.tm-source', s?.estimated ? 'Estimated: the share of time DonutOS spent working in this browser tab. Browsers don’t report whole-computer CPU use.' : 'Measured by the operating system for the whole computer.'));
    } else if (d.id === 'mem') {
      mount(perfEls.head, h('h2', 'Memory'), h('span', s ? formatBytes(s.memory.total) : ''));
      mount(perfEls.coreGrid, s ? h('div.tm-membar', { title: `${formatBytes(s.memory.used)} in use` }, h('i', { style: { width: `${hist.mem.last}%` } })) : null);
      mount(perfEls.facts,
        fact('In use', s ? formatBytes(s.memory.used) : '—'), fact('Available', s ? formatBytes(s.memory.free) : '—'),
        fact('Total', s ? formatBytes(s.memory.total) : '—'), fact('Used by DonutOS apps', mb(procs.reduce((a, p) => a + p.memory, 0))),
        h('p.tm-source', s?.memory.label || ''));
    } else if (d.id === 'disk') {
      mount(perfEls.head, h('h2', 'Disk'), h('span', s?.disk.label || ''));
      const used = s?.disk.total ? (s.disk.used / s.disk.total) * 100 : 0;
      mount(perfEls.coreGrid, s ? h('div.tm-membar', h('i', { style: { width: `${used}%` } })) : null);
      mount(perfEls.facts,
        fact('Used', s ? formatBytes(s.disk.used) : '—'), fact('Free', s ? formatBytes(s.disk.free) : '—'),
        fact('Capacity', s ? formatBytes(s.disk.total) : '—'), fact('Used space', `${used.toFixed(1)}%`),
        fact('File operations', `${hist.disk.last.toFixed(1)} per second`),
        h('p.tm-source', 'The graph counts files DonutOS creates, changes, moves and deletes each second.'));
    } else if (d.id === 'net') {
      const n = network;
      mount(perfEls.head, h('h2', n?.type === 'ethernet' ? 'Ethernet' : n?.type === 'cellular' ? 'Cellular' : n?.type === 'wifi' ? 'Wi-Fi' : 'Network'), h('span', n?.online ? 'Connected' : 'Not connected'));
      mount(perfEls.coreGrid);
      mount(perfEls.facts,
        fact('Received', `${formatBytes(hist.net.last)}/s`), fact('Received since opened', formatBytes(netTotal)),
        fact('Connection', n ? (n.online ? labelNet(n) : 'Offline') : '—'),
        ...(n?.effectiveType ? [fact('Quality', n.effectiveType.toUpperCase())] : []),
        ...(n?.downlinkMbps ? [fact('Estimated speed', `${n.downlinkMbps} Mbps`)] : []),
        ...(n?.rttMs ? [fact('Round trip', `${n.rttMs} ms`)] : []),
        ...(n?.interfaces || []).map((i) => fact(i.name, i.address)),
        h('p.tm-source', 'Counts data DonutOS and its apps download over the internet while Task Manager is open.'));
    } else if (d.id === 'battery') {
      const b = battery;
      const left = b.charging ? b.chargingTime : b.dischargingTime;
      mount(perfEls.head, h('h2', 'Battery'), h('span', b.charging ? 'Plugged in' : 'On battery'));
      mount(perfEls.coreGrid, h('div.tm-membar', h('i', { style: { width: `${b.level * 100}%` } })));
      mount(perfEls.facts, fact('Charge', `${Math.round(b.level * 100)}%`), fact('State', b.charging ? (b.level >= 1 ? 'Fully charged' : 'Charging') : 'Discharging'),
        fact(b.charging ? 'Time to full' : 'Time remaining', Number.isFinite(left) && left > 0 ? dur(left) : 'Calculating…'));
    }
  }
  const labelNet = (n) => ({ wifi: 'Wi-Fi', ethernet: 'Ethernet', cellular: 'Cellular' }[n.type] || 'Connected');

  async function copySummary() {
    const s = stats;
    const lines = [
      `CPU: ${s ? pct(s.cpu.usage) : '—'} (${s?.cpu.model || ''}, ${s?.cpu.cores || '?'} logical processors)`,
      `Memory: ${s ? `${formatBytes(s.memory.used)} of ${formatBytes(s.memory.total)}` : '—'}`,
      `Disk: ${s ? `${formatBytes(s.disk.used)} used of ${formatBytes(s.disk.total)}` : '—'}`,
      `Network: ${network?.online ? labelNet(network) : 'Not connected'}`,
      ...(battery?.supported ? [`Battery: ${Math.round(battery.level * 100)}%${battery.charging ? ', charging' : ''}`] : []),
      `Processes: ${procs.length}`,
      `Up time: ${s ? dur(s.uptime) : '—'}`,
    ];
    await ctx.clipboard.writeText(lines.join('\n'));
    ctx.notify({ title: 'Copied', body: 'Performance summary copied to the clipboard.', silent: true }).catch(() => {});
  }

  // Startup apps: the signed-in user's apps.startup list.
  function renderStartup() {
    const s = k.settings.forUser(me.id);
    const on = new Set(s.get('apps.startup'));
    const list = k.registry.list().filter((a) => a.id !== 'taskmanager' && (!query || a.name.toLowerCase().includes(query)));
    const last = (appId) => {
      const runs = procs.filter((p) => p.appId === appId && p.launchMs !== null);
      return runs.length ? Math.max(...runs.map((p) => p.launchMs)) : null;
    };
    const impact = (ms) => (ms === null ? 'Not measured' : ms < 60 ? 'Low' : ms < 250 ? 'Medium' : 'High');
    mount(content, h('p.tm-note', 'Apps that are enabled start automatically when you sign in. Start-up impact is measured each time the app starts.'),
      h('div.tm-table.tm-startup', { role: 'grid', 'aria-label': 'Startup apps' },
        h('div.tm-row.tm-header', { role: 'row' }, h('div.tm-th', 'Name'), h('div.tm-th', 'Publisher'), h('div.tm-th', 'Status'), h('div.tm-th', 'Start-up impact'), h('div.tm-th')),
        list.map((a) => {
          const ms = last(a.id);
          return h('div.tm-row', { role: 'row' },
            h('div.tm-cell.tm-name', h('span.tm-twisty'), h('img', { src: a.icon, alt: '', width: 18, height: 18 }), h('span', a.name)),
            h('div.tm-cell', a.builtin ? 'DonutOS' : a.author || 'Installed app'),
            h('div.tm-cell', on.has(a.id) ? 'Enabled' : 'Disabled'),
            h('div.tm-cell', { title: ms !== null ? `Last start took ${ms} ms` : 'Start the app once to measure it' }, impact(ms), ms !== null ? h('small', ` · ${ms} ms`) : null),
            h('div.tm-cell', h('button.btn', { type: 'button', onclick: () => {
              const cur = new Set(s.get('apps.startup'));
              if (cur.has(a.id)) cur.delete(a.id); else cur.add(a.id);
              s.set('apps.startup', [...cur]);
              renderStartup();
            } }, on.has(a.id) ? 'Disable' : 'Enable')));
        })));
  }

  // Users: everyone signed in, with their apps' totals.
  function renderUsers() {
    const sessions = [...k.sessions.values()];
    const activeUid = k.session.user?.id;
    mount(content, h('div.tm-table.tm-users', { role: 'grid', 'aria-label': 'Users' },
      h('div.tm-row.tm-header', { role: 'row' }, h('div.tm-th', 'User'), h('div.tm-th', 'Status'), h('div.tm-th.num', 'CPU'), h('div.tm-th.num', 'Memory'), h('div.tm-th')),
      sessions.map(({ user, startedAt }) => {
        const theirs = procs.filter((p) => p.user === user.id);
        const cpu = theirs.reduce((a, p) => a + p.cpu, 0);
        const mem = theirs.reduce((a, p) => a + p.memory, 0);
        const open = expanded.has(user.id);
        const mayEnd = user.id === me.id || isAdmin;
        return [h('div.tm-row', { role: 'row' },
          h('div.tm-cell.tm-name',
            h('button.tm-twisty', { type: 'button', 'aria-label': open ? 'Collapse' : 'Expand', onclick: () => { if (open) expanded.delete(user.id); else expanded.add(user.id); render(); } }, icon(open ? 'chevronDown' : 'chevronRight', { size: 12 })),
            avatar(user, 24), h('span', user.name, h('small', ` (${theirs.length})`))),
          h('div.tm-cell', user.id === activeUid ? (locked ? 'Locked' : 'Active') : 'Signed in', h('small', ` · since ${new Date(startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)),
          h('div.tm-cell.num', { style: heat(cpu, 100) }, pct(cpu)),
          h('div.tm-cell.num', mb(mem)),
          h('div.tm-cell', h('button.btn', { type: 'button', disabled: !mayEnd, title: mayEnd ? '' : 'Only an administrator can sign out other users', onclick: async () => {
            const self = user.id === activeUid;
            if (!(await confirmDialog(`Sign out ${user.name}?`, self ? 'Your apps will close. Save your work first.' : `${user.name}’s apps will close and any unsaved work in them will be lost.`, { ok: 'Sign out', danger: true }))) return;
            k.bus.emit('shell:signOutRequest', { uid: user.id });
          } }, 'Sign out'))),
        open ? theirs.map((p) => h('div.tm-row.tm-sub', { role: 'row' },
          h('div.tm-cell.tm-name', h('span.tm-twisty'), h('span.tm-indent'), h('img', { src: p.icon, alt: '', width: 16, height: 16 }), h('span', p.name)),
          h('div.tm-cell', p.status), h('div.tm-cell.num', pct(p.cpu)), h('div.tm-cell.num', mb(p.memory)),
          h('div.tm-cell', canEnd(p) ? h('button.btn.tm-mini-btn', { type: 'button', onclick: () => endTask(p.pid) }, 'End task') : null))) : null];
      })));
  }

  // Details: every process with all its numbers.
  function renderDetails() {
    const cols = [['name', 'Name'], ['pid', 'PID'], ['status', 'Status'], ['user', 'User name'], ['cpu', 'CPU'], ['cpuTime', 'CPU time'], ['memory', 'Memory'], ['windows', 'Windows'], ['startTime', 'Started'], ['parentPid', 'Parent']];
    const get = (p, key) => (key === 'user' ? userName(p.user) : key === 'parentPid' ? p.parentPid || 0 : p[key]);
    const onSort = (s) => { detailSort = s; store.set('detailSort', s); render(); };
    const rows = sortRows(procs.filter(matches), detailSort, get);
    const focused = document.activeElement?.closest?.('.tm-row');
    mount(content, h('div.tm-table.tm-details', { role: 'grid', 'aria-label': 'All processes' },
      h('div.tm-row.tm-header', { role: 'row' }, cols.map(([key, label]) => th(label, key, detailSort, onSort, ['pid', 'cpu', 'cpuTime', 'memory', 'windows', 'parentPid'].includes(key) ? '.num' : ''))),
      rows.map((p) => h('div.tm-row', {
        role: 'row', tabindex: '0', class: selected === p.pid && 'sel', 'aria-selected': String(selected === p.pid),
        onclick: () => { selected = p.pid; render(); },
        oncontextmenu: (e) => { e.preventDefault(); selected = p.pid; render(); menuFor(p, e); },
        ondblclick: () => properties(p),
        onkeydown: (e) => { if (e.key === 'Delete') endTask(p.pid); else if (e.key === 'Enter') properties(p); else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSel(e.key === 'ArrowDown' ? 1 : -1); } },
      },
      h('div.tm-cell.tm-name', h('img', { src: p.icon, alt: '', width: 16, height: 16 }), h('span', p.appId)),
      h('div.tm-cell.num', String(p.pid)),
      h('div.tm-cell', p.status),
      h('div.tm-cell', userName(p.user)),
      h('div.tm-cell.num', pct(p.cpu)),
      h('div.tm-cell.num', dur(p.cpuTime / 1000)),
      h('div.tm-cell.num', mb(p.memory)),
      h('div.tm-cell.num', String(p.windows)),
      h('div.tm-cell', new Date(p.startTime).toLocaleTimeString()),
      h('div.tm-cell.num', p.parentPid ? String(p.parentPid) : '—')))));
    if (focused && selected) content.querySelector('.tm-row.sel')?.focus({ preventScroll: true });
  }

  function renderSettings() {
    const radio = (name, value, label, current, onPick) => h('label.tm-radio', h('input', { type: 'radio', name, value, checked: current === value, onchange: () => onPick(value) }), h('span', label));
    mount(content, h('div.tm-settings',
      h('section', h('h3', 'Default start page'), h('p.hint', 'The page Task Manager opens on.'),
        h('select.input', { 'aria-label': 'Default start page', style: { width: '240px' }, onchange: (e) => store.set('page', e.target.value) },
          PAGES.map(([id, label]) => h('option', { value: id, selected: store.get('page', 'processes') === id }, label)))),
      h('section', h('h3', 'Real-time update speed'), h('p.hint', 'How often the numbers and graphs refresh. Paused stops sampling until you choose another speed.'),
        h('div.tm-radios', [['high', 'High (every second)'], ['normal', 'Normal (every 2 seconds)'], ['low', 'Low (every 4 seconds)'], ['paused', 'Paused']].map(([v, l]) => radio('speed', v, l, speed, (val) => {
          speed = val; store.set('speed', val); schedule();
        })))),
      h('section', h('h3', 'History'), h('p.hint', 'Clear the graphs on the Performance page.'),
        h('button.btn', { type: 'button', onclick: () => { for (const x of Object.values(hist)) x.values = []; cores.length = 0; netTotal = 0; } }, 'Clear graph history'))));
  }

  // ── Wiring ───────────────────────────────────────────────────────────
  ctx.listen(win.body, 'keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF' && !search.hidden) { e.preventDefault(); search.focus(); search.select(); }
    else if (e.key === 'F5') { e.preventDefault(); tick(); }
    else if (e.altKey && /^Digit[1-5]$/.test(e.code)) { e.preventDefault(); go(PAGES[Number(e.code.slice(5)) - 1][0]); }
  });
  ctx.bus.on('process:*', (e, type) => {
    if (type === 'process:exit' || type === 'process:running') { procs = k.processes.snapshot(); if (page !== 'performance') render({ tick: true }); }
  });
  ctx.bus.on('session:*', (e, type) => {
    if (type === 'session:locked') locked = true;
    else if (type === 'session:unlocked' || type === 'session:changed') locked = false;
    procs = k.processes.snapshot();
    render({ tick: true });
  });
  ctx.onActivate(() => win.focus());
  win.on('resize', () => { if (page === 'performance') renderPerformance(false); });

  renderRail();
  render();
  sampleSystem().then(() => render({ tick: true }));
  schedule();
}
