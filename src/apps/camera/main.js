// Camera: takes photos and records videos with your camera (and microphone for video).
// Photos and videos save to Pictures › Camera Roll. Self-timer, grid, mirror, camera and
// quality choice, and a thumbnail of the last capture that opens it.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { showMenu } from '../../ui/menu.js';
import * as P from '../../core/path.js';

export default function main(ctx) {
  const store = ctx.storage;
  const me = ctx.accounts.current();
  const roll = P.join(me.home, 'Pictures', 'Camera Roll');
  const win = ctx.windows.create({ title: 'Camera', width: 900, height: 620, minWidth: 420, minHeight: 320 });
  win.body.classList.add('camera');

  let mode = store.get('mode', 'photo');
  let timer = store.get('timer', 0);
  let grid = store.get('grid', false);
  let mirror = store.get('mirror', true);
  let quality = store.get('quality', 'hd');
  let deviceId = store.get('device', '');
  let stream = null;
  let recorder = null;
  let recStart = 0;
  let lastCapture = null;
  let countdown = null;
  let saving = null;     // resolves when a stopped recording has been written

  const video = h('video.cam-video', { autoplay: true, muted: true, playsinline: true });
  const overlay = h('div.cam-overlay');
  const flash = h('div.cam-flash');
  const message = h('div.cam-message', { hidden: true });
  const recBadge = h('div.cam-rec', { hidden: true });
  const side = h('div.cam-side');
  const top = h('div.cam-top');
  mount(win.body, h('div.cam-stage', video, overlay, flash, recBadge, message), top, side);

  const SIZES = { sd: { width: 640, height: 480 }, hd: { width: 1280, height: 720 }, fhd: { width: 1920, height: 1080 } };

  async function startCamera() {
    stopStream();
    message.hidden = true;
    try {
      stream = await ctx.media.getUserMedia({ video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: SIZES[quality].width }, height: { ideal: SIZES[quality].height } }, audio: false });
      video.srcObject = stream;
      await video.play().catch(() => {});
      render();
    } catch (err) {
      showMessage(err);
    }
  }
  function showMessage(err) {
    const name = err?.name || '';
    const text = name === 'PermissionError' || name === 'NotAllowedError' ? ['Camera access is off', 'Allow Camera to use your camera in Settings › Privacy & security › Camera, or answer Allow when asked.']
      : name === 'NotFoundError' || name === 'OverconstrainedError' || err?.code === 'ENODEV' ? ['We can’t find your camera', 'Check that a camera is connected and not in use by another app.']
        : name === 'NotReadableError' ? ['The camera is busy', 'Close other apps that might be using it, then try again.'] : ['Camera unavailable', err?.message || String(err)];
    mount(message, icon('camera', { size: 44 }), h('b', text[0]), h('p', text[1]),
      h('div.cam-msgbtns', h('button.btn.primary', { type: 'button', onclick: startCamera }, 'Try again'),
        text[0] === 'Camera access is off' ? h('button.btn', { type: 'button', onclick: () => ctx.launch('settings', { page: 'privacy' }).catch(() => {}) }, 'Open privacy settings') : null));
    message.hidden = false;
    render();
  }
  function stopStream() { stream?.release?.(); stream?.getTracks().forEach((t) => t.stop()); stream = null; }

  function render() {
    video.classList.toggle('mirror', mirror);
    overlay.classList.toggle('grid', grid);
    const b = (label, content, onclick, opts = {}) => h('button.cam-btn', { type: 'button', 'aria-label': label, title: label, onclick, ...opts }, content);
    mount(top,
      b('Settings', icon('settings', { size: 18 }), (e) => settingsMenu(e.currentTarget)),
      b(`Self-timer: ${timer ? `${timer} seconds` : 'off'}`, h('span', '⏱', timer ? h('small', ` ${timer}s`) : null), () => { timer = { 0: 3, 3: 5, 5: 10, 10: 0 }[timer]; store.set('timer', timer); render(); }, { 'aria-pressed': String(!!timer) }),
      b('Grid', '#', () => { grid = !grid; store.set('grid', grid); render(); }, { 'aria-pressed': String(grid) }),
      b('Mirror', '⇋', () => { mirror = !mirror; store.set('mirror', mirror); render(); }, { 'aria-pressed': String(mirror) }));
    mount(side,
      h('div.cam-modes', { role: 'tablist' },
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(mode === 'photo'), disabled: !!recorder, onclick: () => setMode('photo') }, icon('camera', { size: 16 }), 'Photo'),
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(mode === 'video'), disabled: !!recorder, onclick: () => setMode('video') }, icon('monitor', { size: 16 }), 'Video')),
      h('button.cam-shutter', { type: 'button', class: [mode, recorder && 'recording'], disabled: !stream, 'aria-label': mode === 'photo' ? 'Take photo (Space)' : recorder ? 'Stop recording (Space)' : 'Start recording (Space)', onclick: shutter }, h('i')),
      h('button.cam-last', { type: 'button', 'aria-label': 'Open last capture', disabled: !lastCapture, onclick: () => lastCapture && ctx.open(lastCapture.path) },
        lastCapture?.thumb ? h('img', { src: lastCapture.thumb, alt: '' }) : icon('image', { size: 20 })),
      h('button.cam-roll', { type: 'button', onclick: () => ctx.launch('explorer', { path: roll }) }, 'Camera Roll'));
  }

  async function settingsMenu(anchor) {
    const devices = (await ctx.media.devices().catch(() => [])).filter((d) => d.kind === 'videoinput');
    showMenu([
      { header: 'Camera' },
      ...(devices.length ? devices.map((d, i) => ({ label: d.label || `Camera ${i + 1}`, checked: (deviceId || devices[0].deviceId) === d.deviceId, onSelect: () => { deviceId = d.deviceId; store.set('device', deviceId); startCamera(); } })) : [{ label: 'No cameras found', disabled: true }]),
      { header: 'Quality' },
      ...[['sd', '480p'], ['hd', '720p HD'], ['fhd', '1080p Full HD']].map(([q, l]) => ({ label: l, checked: quality === q, onSelect: () => { quality = q; store.set('quality', q); startCamera(); } })),
      { separator: true },
      { label: 'Open Camera Roll', icon: 'folder', onSelect: () => ctx.launch('explorer', { path: roll }) },
    ], { anchor, align: 'start' });
  }

  function setMode(m) { mode = m; store.set('mode', m); render(); }

  async function shutter() {
    if (!stream) return;
    if (recorder) { recorder.stop(); return; }
    if (countdown) { clearInterval(countdown); countdown = null; overlay.dataset.count = ''; return; }
    if (timer) {
      let n = timer;
      overlay.dataset.count = String(n);
      countdown = setInterval(() => {
        n--;
        overlay.dataset.count = n ? String(n) : '';
        if (!n) { clearInterval(countdown); countdown = null; capture(); }
      }, 1000);
      return;
    }
    capture();
  }

  const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

  async function capture() {
    if (mode === 'photo') return takePhoto();
    return startRecording();
  }

  async function takePhoto() {
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    if (!c.width) return;
    const g = c.getContext('2d');
    if (mirror) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(video, 0, 0);
    flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    await ctx.fs.mkdir(roll, { recursive: true });
    const path = P.join(roll, await ctx.fs.uniqueName(roll, `IMG_${stamp()}.jpg`));
    await ctx.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    const t = document.createElement('canvas');
    t.width = 96; t.height = Math.round((96 * c.height) / c.width);
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    lastCapture = { path, thumb: t.toDataURL('image/jpeg', 0.8) };
    render();
  }

  async function startRecording() {
    // Ask for the microphone too; record silent video if it's refused.
    let mic = null;
    try { mic = await ctx.media.getUserMedia({ audio: true }); } catch { mic = null; }
    const tracks = [...stream.getVideoTracks(), ...(mic ? mic.getAudioTracks() : [])];
    const rs = new MediaStream(tracks);
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const chunks = [];
    recorder = new MediaRecorder(rs, type ? { mimeType: type } : {});
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    let finished;
    saving = new Promise((r) => { finished = r; });
    recorder.onstop = async () => {
      mic?.release?.();
      clearInterval(recTick);
      recBadge.hidden = true;
      recorder = null;
      const blob = new Blob(chunks, { type: type || 'video/webm' });
      await ctx.fs.mkdir(roll, { recursive: true });
      const path = P.join(roll, await ctx.fs.uniqueName(roll, `VID_${stamp()}.webm`));
      await ctx.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      const t = document.createElement('canvas');
      t.width = 96; t.height = Math.round((96 * (video.videoHeight || 9)) / (video.videoWidth || 16));
      t.getContext('2d').drawImage(video, 0, 0, t.width, t.height);
      lastCapture = { path, thumb: t.toDataURL('image/jpeg', 0.8) };
      render();
      finished();
    };
    recorder.start(1000);
    recStart = Date.now();
    recBadge.hidden = false;
    const recTick = setInterval(() => { const s = Math.floor((Date.now() - recStart) / 1000); recBadge.textContent = `● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
    recBadge.textContent = '● 0:00';
    render();
  }

  ctx.listen(win.body, 'keydown', (e) => {
    if (e.target.matches('input, select')) return;
    if (e.key === ' ' || e.key === 'Enter') { if (!e.target.matches('button') || e.key === ' ') { e.preventDefault(); shutter(); } }
  });
  // Release the camera while minimised, like a desktop camera app; resume when restored.
  win.on('state', (st) => { if (st === 'minimized' && !recorder) stopStream(); else if (st !== 'minimized' && !stream) startCamera(); });
  // Closing while recording saves the video first.
  win.onBeforeClose(async () => { if (recorder) { recorder.stop(); await saving; } return true; });
  ctx.onExit(() => { if (recorder?.state === 'recording') recorder.stop(); stopStream(); });

  render();
  startCamera();
}
