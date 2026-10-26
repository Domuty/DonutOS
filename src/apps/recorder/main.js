// Sound Recorder: records from your microphone with a live waveform, pause/resume and
// markers, saves to Documents › Sound recordings, and plays back with speed control.
// Recordings can be renamed, deleted, or shown in File Explorer.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { showMenu } from '../../ui/menu.js';
import { promptDialog, confirmDialog } from '../../ui/dialog.js';
import { formatBytes } from '../../core/util.js';
import * as P from '../../core/path.js';

const EXT = new Set(['.weba', '.webm', '.ogg', '.oga', '.wav', '.mp3', '.m4a', '.opus']);
const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60), x = Math.floor(s % 60), cs = Math.floor((s % 1) * 100); return `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}.${String(cs).padStart(2, '0')}`; };

export default function main(ctx) {
  const store = ctx.storage;
  const me = ctx.accounts.current();
  const folder = P.join(me.home, 'Documents', 'Sound recordings');
  const win = ctx.windows.create({ title: 'Sound Recorder', width: 880, height: 560, minWidth: 420, minHeight: 360 });
  win.body.classList.add('recorder');

  let recordings = [];
  let selected = null;
  let rec = null;           // { recorder, stream, started, pausedAt, pausedTotal, chunks, marks, analyser }
  let deviceId = store.get('device', '');
  let speed = 1;
  const marks = () => store.get('marks', {});

  const listEl = h('div.rc-list');
  const stage = h('div.rc-stage');
  mount(win.body, listEl, stage);
  const audio = new Audio();
  audio.preload = 'metadata';

  async function load() {
    await ctx.fs.mkdir(folder, { recursive: true }).catch(() => {});
    recordings = (await ctx.fs.readdir(folder).catch(() => [])).filter((e) => e.type === 'file' && EXT.has(e.ext)).sort((a, b) => b.mtime - a.mtime);
    if (selected && !recordings.some((r) => r.path === selected.path)) selected = null;
    renderList();
  }

  function renderList() {
    mount(listEl, h('h2', 'Recordings'),
      recordings.length ? recordings.map((r) => h('button.rc-item', { type: 'button', 'aria-current': selected?.path === r.path ? 'true' : undefined, onclick: () => select(r),
        oncontextmenu: (e) => { e.preventDefault(); itemMenu(r, e); } },
      h('b', P.basename(r.name, r.ext)), h('small', `${new Date(r.mtime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${formatBytes(r.size)}`),
      marks()[r.path]?.length ? h('small', `⚑ ${marks()[r.path].length}`) : null))
        : h('p.calc-empty', 'Your recordings will show up here.'));
  }

  function itemMenu(r, e) {
    showMenu([
      { label: 'Rename', icon: 'edit', onSelect: () => rename(r) },
      { label: 'Show in folder', icon: 'folder', onSelect: () => ctx.launch('explorer', { path: folder }) },
      { label: 'Open with Media Player', onSelect: () => ctx.open(r.path, { appId: 'mediaplayer' }) },
      { separator: true },
      { label: 'Delete', icon: 'trash', danger: true, onSelect: () => remove(r) },
    ], { x: e.clientX, y: e.clientY });
  }

  async function rename(r) {
    const name = await promptDialog('Rename recording', { value: P.basename(r.name, r.ext), parent: win.body, validate: (v) => P.validateName(v.trim() + r.ext) || '' });
    if (!name || name.trim() === P.basename(r.name, r.ext)) return;
    const to = P.join(folder, name.trim() + r.ext);
    await ctx.fs.move(r.path, to);
    const m = marks();
    if (m[r.path]) { m[to] = m[r.path]; delete m[r.path]; store.set('marks', m); }
    if (selected?.path === r.path) selected = { ...r, path: to, name: name.trim() + r.ext };
    await load();
    renderStage();
  }

  async function remove(r) {
    if (!(await confirmDialog(`Delete ${P.basename(r.name, r.ext)}?`, 'It moves to the Recycle Bin.', { ok: 'Delete', danger: true, parent: win.body }))) return;
    if (selected?.path === r.path) { audio.pause(); selected = null; }
    await ctx.fs.trash(r.path);
    const m = marks(); delete m[r.path]; store.set('marks', m);
    await load();
    renderStage();
  }

  let url = null;
  let waveform = null;
  async function select(r) {
    if (rec) return;
    selected = r;
    audio.pause();
    if (url) URL.revokeObjectURL(url);
    const blob = await ctx.fs.readBlob(r.path);
    url = URL.createObjectURL(blob);
    audio.src = url;
    audio.playbackRate = speed;
    waveform = null;
    renderList();
    renderStage();
    // Decode to draw the waveform.
    try {
      const ac = new OfflineAudioContext(1, 44100, 44100);
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      const data = buf.getChannelData(0);
      const n = 400, step = Math.floor(data.length / n) || 1;
      waveform = Array.from({ length: n }, (_, i) => { let m = 0; for (let j = i * step; j < (i + 1) * step && j < data.length; j++) m = Math.max(m, Math.abs(data[j])); return m; });
      if (Number.isFinite(buf.duration)) durationOf.set(r.path, buf.duration);
      drawWave();
    } catch { /* format the engine can't decode: playback may still work */ }
  }
  const durationOf = new Map();

  // ── Stage ────────────────────────────────────────────────────────────
  let canvas, timeEl, seek;
  function renderStage() {
    canvas = h('canvas.rc-wave', { width: 1200, height: 240, 'aria-hidden': 'true' });
    timeEl = h('div.rc-time');
    if (rec) {
      mount(stage, h('div.rc-center', timeEl, canvas,
        h('div.rc-controls',
          h('button.btn.rc-round', { type: 'button', 'aria-label': 'Add a marker (Ctrl+M)', title: 'Add a marker (Ctrl+M)', onclick: addRecMark }, '⚑'),
          h('button.rc-recbtn.stop', { type: 'button', 'aria-label': 'Stop recording (Esc)', onclick: stopRecording }, h('i')),
          h('button.btn.rc-round', { type: 'button', 'aria-label': rec.recorder.state === 'paused' ? 'Resume' : 'Pause', onclick: pauseResume }, rec.recorder.state === 'paused' ? '●' : '❚❚')),
        h('div.rc-marks', rec.marks.map((m, i) => h('span', `⚑ ${i + 1}  ${fmt(m)}`)))));
      return;
    }
    if (!selected) {
      mount(stage, h('div.rc-center', h('div.rc-time', fmt(0)),
        h('button.rc-recbtn', { type: 'button', 'aria-label': 'Start recording (Ctrl+R)', title: 'Start recording (Ctrl+R)', onclick: startRecording }, h('i')),
        h('div.rc-device', h('button.btn.subtle', { type: 'button', onclick: (e) => deviceMenu(e.currentTarget) }, icon('volume', { size: 14 }), 'Microphone ▾')),
        h('p.hint', `Recordings are saved to Documents › Sound recordings.`)));
      return;
    }
    seek = h('input.rc-seek', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Position', oninput: (e) => { const d = duration(); if (d) audio.currentTime = (e.target.value / 1000) * d; } });
    const ms = marks()[selected.path] || [];
    mount(stage, h('div.rc-center',
      h('h2.rc-name', P.basename(selected.name, selected.ext)),
      timeEl, h('div.rc-wavewrap', canvas, h('div.rc-markpins', ms.map((m, i) => h('button.rc-pin', { type: 'button', style: { left: `${(m / Math.max(duration(), 0.01)) * 100}%` }, title: `Marker ${i + 1} · ${fmt(m)}`, onclick: () => { audio.currentTime = m; } }, '⚑')))),
      seek,
      h('div.rc-controls',
        h('button.btn.rc-round', { type: 'button', 'aria-label': 'Back 10 seconds', onclick: () => { audio.currentTime = Math.max(0, audio.currentTime - 10); } }, '↺10'),
        h('button.rc-play', { type: 'button', 'aria-label': audio.paused ? 'Play (Space)' : 'Pause (Space)', onclick: () => (audio.paused ? audio.play() : audio.pause()) }, audio.paused ? '▶' : '❚❚'),
        h('button.btn.rc-round', { type: 'button', 'aria-label': 'Forward 30 seconds', onclick: () => { audio.currentTime = Math.min(duration(), audio.currentTime + 30); } }, '30↻')),
      h('div.rc-actions',
        h('button.btn', { type: 'button', onclick: () => { const m = marks(); m[selected.path] = [...(m[selected.path] || []), audio.currentTime].sort((a, b) => a - b); store.set('marks', m); renderStage(); renderList(); } }, '⚑ Add marker'),
        h('button.btn', { type: 'button', onclick: (e) => showMenu([0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({ label: `${r}×`, checked: speed === r, onSelect: () => { speed = r; audio.playbackRate = r; renderStage(); } })), { anchor: e.currentTarget, align: 'start' }) }, `${speed}× speed`),
        h('button.btn', { type: 'button', onclick: () => rename(selected) }, icon('edit', { size: 14 }), 'Rename'),
        h('button.btn', { type: 'button', onclick: () => remove(selected) }, icon('trash', { size: 14 }), 'Delete'),
        h('button.btn.primary', { type: 'button', onclick: () => { audio.pause(); selected = null; renderList(); renderStage(); } }, '● New recording')),
      ms.length ? h('div.rc-marks', ms.map((m, i) => h('button.btn.subtle', { type: 'button', onclick: () => { audio.currentTime = m; audio.play(); } }, `⚑ ${i + 1}  ${fmt(m)}`))) : null));
    tick();
    drawWave();
  }
  const duration = () => (Number.isFinite(audio.duration) && audio.duration ? audio.duration : durationOf.get(selected?.path) || 0);

  function tick() {
    if (!timeEl) return;
    if (rec) { timeEl.textContent = fmt(recElapsed()); return; }
    timeEl.textContent = `${fmt(audio.currentTime)} / ${fmt(duration())}`;
    const d = duration();
    if (seek && document.activeElement !== seek) seek.value = d ? (audio.currentTime / d) * 1000 : 0;
    drawWave();
  }
  function drawWave() {
    if (!canvas || !waveform || rec) return;
    const g = canvas.getContext('2d');
    const accent = getComputedStyle(win.body).getPropertyValue('--accent').trim() || '#e8618c';
    const muted = getComputedStyle(win.body).getPropertyValue('--text-3').trim() || '#888';
    const W = canvas.width, H = canvas.height, n = waveform.length, bw = W / n;
    const max = Math.max(...waveform, 0.01);
    const played = duration() ? audio.currentTime / duration() : 0;
    g.clearRect(0, 0, W, H);
    waveform.forEach((v, i) => {
      const bh = Math.max(2, (v / max) * (H - 10));
      g.fillStyle = i / n <= played ? accent : muted;
      g.fillRect(i * bw + 0.5, (H - bh) / 2, Math.max(1, bw - 1.5), bh);
    });
  }
  ['timeupdate', 'durationchange', 'play', 'pause', 'ended'].forEach((ev) => audio.addEventListener(ev, () => { if (ev === 'play' || ev === 'pause' || ev === 'ended') renderStage(); else tick(); }));

  async function deviceMenu(anchor) {
    const mics = (await ctx.media.devices().catch(() => [])).filter((d) => d.kind === 'audioinput');
    showMenu(mics.length ? mics.map((d, i) => ({ label: d.label || `Microphone ${i + 1}`, checked: (deviceId || mics[0].deviceId) === d.deviceId, onSelect: () => { deviceId = d.deviceId; store.set('device', deviceId); } }))
      : [{ label: 'Microphones appear here after you allow access', disabled: true }], { anchor, align: 'start' });
  }

  // ── Recording ────────────────────────────────────────────────────────
  const recElapsed = () => (rec ? ((rec.recorder.state === 'paused' ? rec.pausedAt : Date.now()) - rec.started - rec.pausedTotal) / 1000 : 0);
  async function startRecording() {
    let stream;
    try {
      stream = await ctx.media.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: true } : { echoCancellation: false, noiseSuppression: true } });
    } catch (err) {
      mount(stage, h('div.rc-center', icon('volume', { size: 44 }), h('b', err.name === 'PermissionError' || err.name === 'NotAllowedError' ? 'Microphone access is off' : 'No microphone found'),
        h('p.hint', err.name === 'PermissionError' || err.name === 'NotAllowedError' ? 'Allow Sound Recorder to use your microphone in Settings › Privacy & security › Microphone.' : 'Connect a microphone and try again.'),
        h('button.btn.primary', { type: 'button', onclick: () => renderStage() }, 'OK')));
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 128000 } : {});
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const ac = new AudioContext();
    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    ac.createMediaStreamSource(stream).connect(analyser);
    rec = { recorder, stream, ac, analyser, chunks, started: Date.now(), pausedAt: 0, pausedTotal: 0, marks: [], levels: [], type };
    recorder.start(500);
    audio.pause();
    selected = null;
    renderList();
    renderStage();
    liveLoop();
  }
  function liveLoop() {
    if (!rec) return;
    requestAnimationFrame(liveLoop);
    const buf = new Uint8Array(rec.analyser.fftSize);
    rec.analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
    if (rec.recorder.state === 'recording') { rec.levels.push(peak); if (rec.levels.length > 300) rec.levels.shift(); }
    tick();
    if (!canvas) return;
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    const accent = getComputedStyle(win.body).getPropertyValue('--accent').trim() || '#e8618c';
    g.fillStyle = accent;
    const bw = W / 300;
    rec.levels.forEach((v, i) => { const bh = Math.max(2, v * (H - 10) * 1.6); g.fillRect(W - (rec.levels.length - i) * bw, (H - Math.min(H, bh)) / 2, Math.max(1, bw - 1), Math.min(H, bh)); });
  }
  function pauseResume() {
    if (!rec) return;
    if (rec.recorder.state === 'recording') { rec.recorder.pause(); rec.pausedAt = Date.now(); }
    else if (rec.recorder.state === 'paused') { rec.pausedTotal += Date.now() - rec.pausedAt; rec.recorder.resume(); }
    renderStage();
  }
  function addRecMark() { if (rec) { rec.marks.push(recElapsed()); renderStage(); } }

  function stopRecording() {
    if (!rec) return Promise.resolve();
    const r = rec;
    return new Promise((resolve) => {
      r.recorder.onstop = async () => {
        r.stream.release?.();
        r.ac.close().catch(() => {});
        const blob = new Blob(r.chunks, { type: r.type || 'audio/webm' });
        await ctx.fs.mkdir(folder, { recursive: true });
        const ext = (r.type || '').includes('ogg') ? '.ogg' : '.weba';
        let n = recordings.length + 1;
        let name = `Recording (${n})${ext}`;
        while (await ctx.fs.exists(P.join(folder, name))) name = `Recording (${++n})${ext}`;
        const path = P.join(folder, name);
        await ctx.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
        if (r.marks.length) { const m = marks(); m[path] = r.marks; store.set('marks', m); }
        durationOf.set(path, (Date.now() - r.started - r.pausedTotal) / 1000);
        rec = null;
        await load();
        const st = recordings.find((x) => x.path === path);
        if (st) await select(st); else renderStage();
        resolve();
      };
      r.recorder.stop();
    });
  }

  ctx.listen(win.body, 'keydown', (e) => {
    if (e.target.matches('input:not([type=range]), textarea, select')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'r') { e.preventDefault(); if (!rec) startRecording(); }
    else if (ctrl && e.key.toLowerCase() === 'm') { e.preventDefault(); addRecMark(); }
    else if (e.key === 'Escape' && rec) { e.preventDefault(); stopRecording(); }
    else if (e.key === ' ' && !e.target.matches('button')) { e.preventDefault(); if (rec) pauseResume(); else if (selected) { if (audio.paused) audio.play(); else audio.pause(); } }
    else if (e.key === 'Delete' && selected && !rec) remove(selected);
  });
  win.onBeforeClose(async () => { if (rec) await stopRecording(); return true; });
  ctx.own(() => { audio.pause(); if (url) URL.revokeObjectURL(url); });
  ctx.bus.on('fs:changed', (ev) => { if (ev.dir === folder || ev.fromDir === folder) load(); });

  load().then(async () => {
    if (ctx.args.path) { const st = await ctx.fs.stat(ctx.args.path); if (st) select(st); else renderStage(); } else renderStage();
  });
}
