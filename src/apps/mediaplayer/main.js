// Media Player: plays music and video from your files. Music and video libraries, a play
// queue, playlists, shuffle/repeat, speed, a visualiser, cover art and song details read
// from the files, full-screen video, and media keys through the Media Session API.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { showMenu } from '../../ui/menu.js';
import { promptDialog, confirmDialog, alertDialog } from '../../ui/dialog.js';
import { openFileDialog } from '../../ui/file-dialog.js';
import { readTags } from './tags.js';
import * as P from '../../core/path.js';

const AUDIO = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.flac', '.aac', '.weba', '.opus']);
const VIDEO = new Set(['.mp4', '.webm', '.ogv', '.mov', '.mkv', '.m4v']);
const isMedia = (e) => e.type === 'file' && (AUDIO.has(e.ext) || VIDEO.has(e.ext));
const fmt = (s) => { if (!Number.isFinite(s)) return '--:--'; s = Math.max(0, Math.floor(s)); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${hh ? `${hh}:${String(m).padStart(2, '0')}` : m}:${String(x).padStart(2, '0')}`; };

export default function main(ctx) {
  const store = ctx.storage;
  const me = ctx.accounts.current();
  const win = ctx.windows.create({ title: 'Media Player', width: 1000, height: 660, minWidth: 420, minHeight: 360 });
  win.body.classList.add('mediaplayer');

  let page = store.get('page', 'music');
  let library = { music: [], videos: [] };
  let tagCache = store.get('tags', {});
  let playlists = store.get('playlists', []);
  let queue = [];          // entries { path, name, ext, kind }
  let qi = -1;
  let shuffle = store.get('shuffle', false);
  let repeat = store.get('repeat', 'off'); // off | all | one
  let order = [];
  let query = '';
  let rate = 1;

  const media = h('video.mp-media', { preload: 'metadata', playsinline: true });
  media.volume = store.get('volume', 0.8);
  media.muted = store.get('muted', false);
  const nav = h('nav.mp-nav');
  const content = h('main.mp-content');
  const nowPlaying = h('div.mp-now', { hidden: true }, media);
  const bar = h('footer.mp-bar');
  mount(win.body, h('div.mp-wrap', nav, h('div.mp-main', content, nowPlaying)), bar);

  // ── Library ──────────────────────────────────────────────────────────
  async function scan() {
    const music = [], videos = [];
    for (const dir of ['Music', 'Videos', 'Downloads']) {
      await ctx.fs.walk(P.join(me.home, dir), (e) => {
        if (!isMedia(e)) return;
        (AUDIO.has(e.ext) ? music : videos).push(e);
      }).catch(() => {});
    }
    library = { music: music.sort(byTitle), videos: videos.sort(byTitle) };
    // Read tags for new songs in the background.
    for (const e of music) if (!tagCache[key(e)]) await loadTags(e);
    store.set('tags', pruneTags());
    if (page === 'music') renderPage();
  }
  const key = (e) => `${e.path}|${e.mtime}`;
  const byTitle = (a, b) => title(a).localeCompare(title(b), undefined, { numeric: true });
  const tagsOf = (e) => tagCache[key(e)] || {};
  const title = (e) => tagsOf(e).title || P.basename(e.name || e.path, e.ext || P.extname(e.path));
  const artist = (e) => tagsOf(e).artist || '';
  async function loadTags(e) {
    try {
      const bytes = await ctx.fs.readFile(e.path);
      const t = readTags(bytes);
      const { cover, ...rest } = t;
      tagCache[key(e)] = { ...rest, hasCover: !!cover };
      return t;
    } catch { tagCache[key(e)] = {}; return {}; }
  }
  function pruneTags() {
    const live = new Set([...library.music, ...library.videos].map(key));
    return Object.fromEntries(Object.entries(tagCache).filter(([k]) => live.has(k)));
  }

  // ── Navigation & pages ───────────────────────────────────────────────
  function renderNav() {
    const item = (id, label, ic) => h('button.mp-navitem', { type: 'button', 'aria-current': page === id ? 'page' : undefined, onclick: () => go(id) }, icon(ic, { size: 18 }), h('span', label));
    mount(nav,
      item('music', 'Music', 'volume'), item('videos', 'Videos', 'camera'), item('queue', 'Play queue', 'list'),
      h('div.mp-navhead', 'Playlists', h('button.tb-btn', { type: 'button', 'aria-label': 'New playlist', onclick: () => newPlaylist() }, icon('plus', { size: 14 }))),
      playlists.map((pl) => item(`pl:${pl.id}`, pl.name, 'file')),
      h('div.mp-grow'),
      h('button.mp-navitem', { type: 'button', onclick: openFiles }, icon('folder', { size: 18 }), h('span', 'Open files…')));
  }
  function go(p) { page = p; if (!p.startsWith('pl:') || playlists.some((x) => `pl:${x.id}` === p)) store.set('page', p); nowPlaying.hidden = true; content.hidden = false; renderNav(); renderPage(); }

  function renderPage() {
    const search = h('input.input.mp-search', { type: 'search', placeholder: 'Search', value: query, 'aria-label': 'Search', oninput: (e) => { query = e.target.value.trim().toLowerCase(); renderList(); } });
    const listEl = h('div.mp-list');
    let rows = [], heading = '', actions = [];
    const pl = page.startsWith('pl:') ? playlists.find((x) => `pl:${x.id}` === page) : null;
    if (page === 'music') { rows = library.music; heading = 'Music'; }
    else if (page === 'videos') { rows = library.videos; heading = 'Videos'; }
    else if (page === 'queue') { rows = queue; heading = 'Play queue'; actions = [h('button.btn', { type: 'button', disabled: !queue.length, onclick: () => { queue = []; qi = -1; order = []; media.pause(); media.removeAttribute('src'); media.load(); renderAll(); } }, 'Clear')]; }
    else if (pl) {
      rows = pl.items.map((p) => [...library.music, ...library.videos].find((e) => e.path === p) || { path: p, name: P.basename(p), ext: P.extname(p), missing: true });
      heading = pl.name;
      actions = [h('button.btn', { type: 'button', onclick: async () => { const n = await promptDialog('Rename playlist', { value: pl.name, parent: win.body, validate: (v) => (v.trim() ? '' : 'Type a name') }); if (n) { pl.name = n.trim(); savePlaylists(); renderAll(); } } }, 'Rename'),
        h('button.btn', { type: 'button', onclick: async () => { if (await confirmDialog(`Delete “${pl.name}”?`, 'The songs stay in your library.', { ok: 'Delete', danger: true, parent: win.body })) { playlists = playlists.filter((x) => x !== pl); savePlaylists(); go('music'); } } }, 'Delete')];
    }
    const renderList = () => {
      const shown = rows.filter((e) => !query || `${title(e)} ${artist(e)} ${tagsOf(e).album || ''}`.toLowerCase().includes(query));
      mount(listEl, shown.length ? shown.map((e, i) => {
        const playing = queue[qi]?.path === e.path;
        return h('div.mp-row', { role: 'button', tabindex: '0', class: [playing && 'playing', e.missing && 'missing'],
          ondblclick: () => playList(shown, i), onkeydown: (ev) => { if (ev.key === 'Enter') playList(shown, i); },
          oncontextmenu: (ev) => { ev.preventDefault(); rowMenu(e, ev, { shown, i, pl }); } },
        h('button.tb-btn.mp-rowplay', { type: 'button', 'aria-label': `Play ${title(e)}`, onclick: () => playList(shown, i) }, playing && !media.paused ? '❚❚' : '▶'),
        h('span.mp-t', title(e)), h('span.mp-a', artist(e)), h('span.mp-al', tagsOf(e).album || ''), h('span.mp-d', tagsOf(e).duration ? fmt(tagsOf(e).duration) : ''),
        h('button.tb-btn', { type: 'button', 'aria-label': 'More', onclick: (ev) => rowMenu(e, ev, { shown, i, pl }) }, '⋯'));
      }) : h('div.ph-empty', icon(page === 'videos' ? 'camera' : 'volume', { size: 40 }), h('b', query ? 'Nothing matches your search' : page === 'queue' ? 'The play queue is empty' : pl ? 'This playlist is empty' : `No ${heading.toLowerCase()} yet`),
        h('p', page === 'music' ? 'Media Player shows music in your Music and Downloads folders. Select “Open files…” to play something from anywhere.' : page === 'videos' ? 'Videos in your Videos and Downloads folders appear here.' : 'Right-click a song and choose “Add to” to fill it.')));
    };
    mount(content, h('header.mp-head', h('h1', heading), h('div.mp-grow'), search, rows.length ? h('button.btn.primary', { type: 'button', onclick: () => playList(rows, 0) }, '▶ Play all') : null,
      rows.length > 1 ? h('button.btn', { type: 'button', onclick: () => { setShuffle(true); playList(rows, Math.floor(Math.random() * rows.length)); } }, '⤨ Shuffle') : null, actions),
    page !== 'videos' ? h('div.mp-row.mp-header', h('span'), h('span', 'Title'), h('span', 'Artist'), h('span', 'Album'), h('span', 'Length'), h('span')) : null,
    listEl);
    renderList();
  }

  function rowMenu(e, ev, { shown, i, pl }) {
    showMenu([
      { label: 'Play', onSelect: () => playList(shown, i) },
      { label: 'Play next', onSelect: () => { queue.splice(qi + 1, 0, e); rebuildOrder(); renderAll(); } },
      { label: 'Add to play queue', onSelect: () => { queue.push(e); rebuildOrder(); if (qi < 0) start(0); renderAll(); } },
      { separator: true },
      { header: 'Add to playlist' },
      ...playlists.filter((x) => x !== pl).map((x) => ({ label: x.name, onSelect: () => { if (!x.items.includes(e.path)) x.items.push(e.path); savePlaylists(); } })),
      { label: 'New playlist…', icon: 'plus', onSelect: () => newPlaylist([e.path]) },
      ...(pl ? [{ separator: true }, { label: 'Remove from playlist', onSelect: () => { pl.items = pl.items.filter((p) => p !== e.path); savePlaylists(); renderPage(); } }] : []),
      ...(page === 'queue' ? [{ label: 'Remove from queue', onSelect: () => { const j = queue.indexOf(e); queue.splice(j, 1); if (j < qi) qi--; rebuildOrder(); renderAll(); } }] : []),
      { separator: true },
      { label: 'Show in folder', icon: 'folder', onSelect: () => ctx.launch('explorer', { path: P.dirname(e.path) }) },
    ], { x: ev.clientX, y: ev.clientY });
  }

  async function newPlaylist(items = []) {
    const name = await promptDialog('New playlist', { label: 'Name', value: `Playlist ${playlists.length + 1}`, parent: win.body, validate: (v) => (v.trim() ? '' : 'Type a name') });
    if (!name) return;
    playlists.push({ id: Math.random().toString(36).slice(2, 9), name: name.trim(), items });
    savePlaylists();
    renderNav();
  }
  const savePlaylists = () => store.set('playlists', playlists);

  async function openFiles() {
    const paths = await openFileDialog(ctx, win, { title: 'Open media', multiple: true, filters: [{ label: 'Music and videos', exts: [...AUDIO, ...VIDEO] }, { label: 'All files', exts: ['*'] }] });
    if (!paths?.length) return;
    const entries = [];
    for (const p of paths) { const st = await ctx.fs.stat(p); if (st) entries.push(st); }
    playList(entries, 0);
  }

  // ── Playback ─────────────────────────────────────────────────────────
  function rebuildOrder() {
    order = queue.map((_, i) => i);
    if (shuffle) {
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      // The current song stays first.
      const at = order.indexOf(qi);
      if (at > 0) { order.splice(at, 1); order.unshift(qi); }
    }
  }
  function playList(list, i) { queue = list.filter((e) => !e.missing); qi = Math.max(0, queue.indexOf(list[i])); rebuildOrder(); start(qi); }

  let currentUrl = null;
  async function start(i) {
    const e = queue[i];
    if (!e) return;
    qi = i;
    try {
      const blob = await ctx.fs.readBlob(e.path);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = URL.createObjectURL(blob);
      media.src = currentUrl;
      media.playbackRate = rate;
      await media.play().catch((err) => { if (err.name !== 'AbortError') throw err; });
    } catch (err) {
      alertDialog(`Can’t play ${e.name}`, err.name === 'NotSupportedError' ? 'This file’s format isn’t supported on this device.' : err.message, { parent: win.body });
      return;
    }
    const isVideo = VIDEO.has(e.ext) && !AUDIO.has(e.ext);
    win.body.classList.toggle('video', isVideo);
    if (isVideo) { nowPlaying.hidden = false; content.hidden = true; }
    ctx.addRecent(e.path);
    updateSession(e);
    renderAll();
  }

  function next(step = 1, { auto = false } = {}) {
    if (!queue.length) return;
    if (auto && repeat === 'one') { media.currentTime = 0; media.play(); return; }
    const pos = order.indexOf(qi);
    let n = pos + step;
    if (n >= order.length || n < 0) {
      if (repeat === 'all' || !auto) n = (n + order.length) % order.length;
      else { media.pause(); media.currentTime = 0; renderBar(); return; }
    }
    start(order[n]);
  }
  function prev() { if (media.currentTime > 3) media.currentTime = 0; else next(-1); }
  function toggle() { if (!media.src) { if (queue.length) start(Math.max(qi, 0)); else if (library.music.length) playList(library.music, 0); return; } if (media.paused) media.play(); else media.pause(); }
  function setShuffle(on) { shuffle = on; store.set('shuffle', on); rebuildOrder(); renderBar(); }

  // ── Now playing (video stage / album art) ────────────────────────────
  async function showNowPlaying() {
    nowPlaying.hidden = false;
    content.hidden = true;
    const e = queue[qi];
    nowPlaying.querySelectorAll('.mp-art, .mp-viz, .mp-npinfo').forEach((x) => x.remove());
    if (!e) return;
    if (!win.body.classList.contains('video')) {
      const t = await loadTags(e);
      const art = h('div.mp-art', t.cover ? h('img', { src: URL.createObjectURL(t.cover), alt: '' }) : icon('volume', { size: 72 }));
      const viz = h('canvas.mp-viz', { width: 600, height: 120, 'aria-hidden': 'true' });
      nowPlaying.append(art, h('div.mp-npinfo', h('b', title(e)), h('span', [artist(e), tagsOf(e).album].filter(Boolean).join(' · '))), viz);
      startViz(viz);
    }
  }
  let audioCtx = null, analyser = null, srcNode = null, vizFrame = null;
  function startViz(canvas) {
    try {
      if (!audioCtx) {
        audioCtx = new AudioContext();
        srcNode = audioCtx.createMediaElementSource(media);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        srcNode.connect(analyser).connect(audioCtx.destination);
        ctx.own(() => audioCtx.close());
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { return; }
    cancelAnimationFrame(vizFrame);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const g = canvas.getContext('2d');
    const accent = getComputedStyle(win.body).getPropertyValue('--accent').trim() || '#e8618c';
    const draw = () => {
      if (!canvas.isConnected) return;
      vizFrame = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      g.clearRect(0, 0, canvas.width, canvas.height);
      const n = 48, w = canvas.width / n;
      g.fillStyle = accent;
      for (let i = 0; i < n; i++) {
        const v = data[Math.floor((i / n) * data.length * 0.8)] / 255;
        const bh = Math.max(2, v * canvas.height);
        g.globalAlpha = 0.35 + v * 0.65;
        g.beginPath(); g.roundRect(i * w + 2, canvas.height - bh, w - 4, bh, 3); g.fill();
      }
      g.globalAlpha = 1;
    };
    draw();
  }

  // ── Transport bar ────────────────────────────────────────────────────
  const seek = h('input.mp-seek', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Seek', oninput: (e) => { if (Number.isFinite(media.duration)) media.currentTime = (e.target.value / 1000) * media.duration; } });
  const cur = h('span.mp-time'), dur = h('span.mp-time');
  function renderBar() {
    const e = queue[qi];
    const b = (label, glyph, onclick, opts = {}) => h('button.tb-btn.mp-btn', { type: 'button', 'aria-label': label, title: label, onclick, ...opts }, glyph);
    mount(bar,
      h('button.mp-nowbtn', { type: 'button', disabled: !e, onclick: () => (nowPlaying.hidden ? showNowPlaying() : go(page)), title: 'Now playing' },
        h('div.mp-thumb', icon(e && win.body.classList.contains('video') ? 'camera' : 'volume', { size: 18 })),
        h('span', h('b', e ? title(e) : 'Nothing playing'), h('small', e ? artist(e) || P.dirname(e.path).replace(me.home, '~') : 'Choose something from your library'))),
      h('div.mp-center',
        h('div.mp-controls',
          b(shuffle ? 'Shuffle: on' : 'Shuffle: off', '⤨', () => setShuffle(!shuffle), { 'aria-pressed': String(shuffle), class: shuffle && 'on' }),
          b('Previous (Ctrl+Left)', '⏮', prev),
          h('button.mp-play', { type: 'button', 'aria-label': media.paused ? 'Play (Space)' : 'Pause (Space)', onclick: toggle }, media.paused ? '▶' : '❚❚'),
          b('Next (Ctrl+Right)', '⏭', () => next(1)),
          b(`Repeat: ${repeat}`, repeat === 'one' ? '↻¹' : '↻', () => { repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'; store.set('repeat', repeat); renderBar(); }, { 'aria-pressed': String(repeat !== 'off'), class: repeat !== 'off' && 'on' })),
        h('div.mp-seekrow', cur, seek, dur)),
      h('div.mp-right',
        b(media.muted ? 'Unmute (M)' : 'Mute (M)', media.muted || media.volume === 0 ? icon('mute', { size: 16 }) : icon('volume', { size: 16 }), () => { media.muted = !media.muted; store.set('muted', media.muted); renderBar(); }),
        h('input.mp-vol', { type: 'range', min: 0, max: 100, value: Math.round(media.volume * 100), 'aria-label': 'Volume', oninput: (ev) => { media.volume = ev.target.value / 100; media.muted = false; store.set('volume', media.volume); } }),
        b(`Speed ${rate}×`, `${rate}×`, (ev) => showMenu([0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({ label: `${r}×`, checked: rate === r, onSelect: () => { rate = r; media.playbackRate = r; renderBar(); } })), { anchor: ev.currentTarget, placement: 'above' })),
        win.body.classList.contains('video') ? b('Full screen (F)', '⛶', fullscreen) : null));
    tickTime();
  }
  function tickTime() {
    cur.textContent = fmt(media.currentTime);
    dur.textContent = fmt(media.duration);
    if (document.activeElement !== seek) seek.value = Number.isFinite(media.duration) && media.duration ? (media.currentTime / media.duration) * 1000 : 0;
  }
  function fullscreen() {
    if (win.state === 'maximized' && win.body.classList.contains('fs')) { win.body.classList.remove('fs'); win.restore(); return; }
    win.body.classList.add('fs');
    if (win.state !== 'maximized') win.maximize();
    showNowPlaying();
  }

  function renderAll() { renderNav(); if (!content.hidden) renderPage(); renderBar(); }

  media.addEventListener('timeupdate', tickTime);
  media.addEventListener('durationchange', () => {
    tickTime();
    const e = queue[qi];
    if (e && Number.isFinite(media.duration) && tagCache[key(e)] && !tagCache[key(e)].duration) { tagCache[key(e)].duration = media.duration; store.set('tags', tagCache); }
  });
  media.addEventListener('play', () => { renderBar(); if (!content.hidden) renderPage(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
  media.addEventListener('pause', () => { renderBar(); if (!content.hidden) renderPage(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });
  media.addEventListener('ended', () => next(1, { auto: true }));
  media.addEventListener('error', () => { const e = queue[qi]; if (e && media.src) alertDialog(`Can’t play ${e.name}`, 'This file’s format isn’t supported on this device, or the file is damaged.', { parent: win.body }); });
  media.addEventListener('dblclick', fullscreen);
  media.addEventListener('click', toggle);

  async function updateSession(e) {
    if (!('mediaSession' in navigator)) return;
    const t = AUDIO.has(e.ext) ? await loadTags(e) : {};
    navigator.mediaSession.metadata = new MediaMetadata({ title: title(e), artist: artist(e), album: tagsOf(e).album || '', artwork: t.cover ? [{ src: URL.createObjectURL(t.cover) }] : [] });
    for (const [action, fn] of [['play', () => media.play()], ['pause', () => media.pause()], ['previoustrack', prev], ['nexttrack', () => next(1)], ['seekto', (d) => { media.currentTime = d.seekTime; }]]) {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ }
    }
  }

  ctx.listen(win.body, 'keydown', (e) => {
    if (e.target.matches('input[type=search], input:not([type]), textarea')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === ' ' && !e.target.matches('button')) { e.preventDefault(); toggle(); }
    else if (ctrl && e.key === 'ArrowRight') { e.preventDefault(); next(1); }
    else if (ctrl && e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === 'ArrowRight' && !e.target.matches('input')) { media.currentTime = Math.min(media.duration || 0, media.currentTime + 5); }
    else if (e.key === 'ArrowLeft' && !e.target.matches('input')) { media.currentTime = Math.max(0, media.currentTime - 5); }
    else if (e.key.toLowerCase() === 'm' && !ctrl) { media.muted = !media.muted; store.set('muted', media.muted); renderBar(); }
    else if (e.key.toLowerCase() === 'f' && !ctrl && win.body.classList.contains('video')) fullscreen();
    else if (e.key === 'Escape' && win.body.classList.contains('fs')) fullscreen();
    else if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); openFiles(); }
  });
  ctx.bus.on('fs:changed', (ev) => { if (['Music', 'Videos', 'Downloads'].some((f) => P.isSameOrInside(P.join(me.home, f), ev.dir))) { clearTimeout(rescan); rescan = setTimeout(scan, 600); } });
  let rescan = null;
  ctx.own(() => { if (currentUrl) URL.revokeObjectURL(currentUrl); if ('mediaSession' in navigator) navigator.mediaSession.metadata = null; });

  async function openArg(path) {
    const st = await ctx.fs.stat(path);
    if (!st) return;
    const existing = queue.findIndex((x) => x.path === path);
    if (existing >= 0) start(existing);
    else { queue.splice(qi + 1, 0, st); rebuildOrder(); start(qi + 1); }
  }
  ctx.onActivate((args) => { win.focus(); if (args?.path) openArg(args.path); });

  renderNav();
  renderPage();
  renderBar();
  scan();
  if (ctx.args.path) openArg(ctx.args.path);
}
