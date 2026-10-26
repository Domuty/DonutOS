// Photos: a gallery of your pictures (grouped by month, folders, favourites, search) and a
// viewer with zoom/pan, slideshow, rotate, crop, adjustments and filters, info, delete,
// copy, print, open in Paint, and "set as desktop / lock screen background".

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { showMenu } from '../../ui/menu.js';
import { confirmDialog, alertDialog } from '../../ui/dialog.js';
import { saveFileDialog } from '../../ui/file-dialog.js';
import { thumbnail } from '../../shell/thumbs.js';
import { formatBytes } from '../../core/util.js';
import * as P from '../../core/path.js';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg']);
const WRITABLE = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const FILTERS = [['none', 'Original', ''], ['mono', 'Mono', 'grayscale(1)'], ['sepia', 'Sepia', 'sepia(.85)'], ['vivid', 'Vivid', 'saturate(1.6) contrast(1.08)'],
  ['cool', 'Cool', 'hue-rotate(-12deg) saturate(1.15) brightness(1.03)'], ['warm', 'Warm', 'sepia(.25) saturate(1.3) hue-rotate(-8deg)'], ['fade', 'Fade', 'contrast(.82) brightness(1.1) saturate(.75)'], ['noir', 'Noir', 'grayscale(1) contrast(1.5) brightness(.9)']];

export default function main(ctx) {
  const k = ctx.privileged;
  const me = ctx.accounts.current();
  const home = me.home;
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'Photos', width: 1100, height: 720, minWidth: 480, minHeight: 360 });
  win.body.classList.add('photos');

  let view = ctx.args.path ? 'viewer' : 'gallery';
  let section = store.get('section', 'all');   // all | favorites | folders
  let folders = store.get('folders', ['Pictures']).filter((f) => typeof f === 'string');
  let favorites = new Set(store.get('favorites', []));
  let query = '';
  let items = [];          // every picture in the library, newest first
  let list = [];           // what the viewer pages through
  let index = 0;
  let openedFolder = null;
  const urls = new Map();

  const content = h('div.ph-content');
  mount(win.body, content);

  // ── Library ──────────────────────────────────────────────────────────
  async function scan() {
    const found = [];
    for (const f of folders) {
      const root = f.startsWith('/') ? f : P.join(home, f);
      await ctx.fs.walk(root, (e) => { if (e.type === 'file' && IMAGE_EXT.has(e.ext)) found.push(e); }).catch(() => {});
    }
    const seen = new Set();
    items = found.filter((e) => !seen.has(e.path) && seen.add(e.path)).sort((a, b) => b.mtime - a.mtime);
  }

  async function urlFor(e) {
    const key = `${e.path}|${e.mtime}`;
    if (!urls.has(key)) urls.set(key, URL.createObjectURL(await ctx.fs.readBlob(e.path)));
    return urls.get(key);
  }
  ctx.own(() => { for (const u of urls.values()) URL.revokeObjectURL(u); });

  // ── Gallery ──────────────────────────────────────────────────────────
  async function renderGallery() {
    view = 'gallery';
    win.setTitle('Photos');
    win.body.classList.remove('viewing');
    const search = h('input.input.ph-search', { type: 'search', placeholder: 'Search pictures', value: query, 'aria-label': 'Search pictures',
      oninput: (e) => { query = e.target.value.trim().toLowerCase(); paint(); } });
    const tabs = h('nav.ph-tabs', { 'aria-label': 'Views' }, [['all', 'All photos', 'image'], ['favorites', 'Favourites', 'sparkle'], ['folders', 'Folders', 'folder']].map(([id, label, ic]) =>
      h('button.ph-tab', { type: 'button', 'aria-current': section === id ? 'page' : undefined, onclick: () => { section = id; openedFolder = null; store.set('section', id); renderGallery(); } }, icon(ic, { size: 16 }), label)));
    const grid = h('div.ph-grid-wrap');
    mount(content,
      h('div.ph-head', tabs, h('div.ph-grow'), search,
        h('button.btn', { type: 'button', onclick: importPictures }, icon('upload', { size: 16 }), 'Import'),
        h('button.tb-btn', { type: 'button', title: 'Library folders', 'aria-label': 'Library folders', onclick: (e) => folderMenu(e.currentTarget) }, icon('settings', { size: 16 }))),
      grid);
    const paint = () => {
      let shown = items;
      if (section === 'favorites') shown = items.filter((e) => favorites.has(e.path));
      if (query) shown = shown.filter((e) => e.name.toLowerCase().includes(query) || e.path.toLowerCase().includes(query));
      if (section === 'folders' && !openedFolder) {
        const byDir = new Map();
        for (const e of shown) { const d = P.dirname(e.path); if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push(e); }
        mount(grid, byDir.size ? h('div.ph-folders', [...byDir].map(([dir, pics]) => h('button.ph-folder', { type: 'button', onclick: () => { openedFolder = dir; paint(); } },
          h('div.ph-folder-art', pics.slice(0, 4).map((pic) => thumbImg(pic, 160))), h('b', P.basename(dir) || dir), h('small', `${pics.length} item${pics.length === 1 ? '' : 's'}`))))
          : empty());
        return;
      }
      if (openedFolder) shown = shown.filter((e) => P.dirname(e.path) === openedFolder);
      if (!shown.length) { mount(grid, openedFolder ? [crumb(), empty()] : empty()); return; }
      // Group by month, newest first.
      const groups = new Map();
      for (const e of shown) {
        const d = new Date(e.mtime);
        const key = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      }
      mount(grid, openedFolder ? crumb() : null, [...groups].map(([label, pics]) => [h('h2.ph-month', label), h('div.ph-grid', pics.map((e) => tile(e, shown)))]));
    };
    const crumb = () => h('div.ph-crumb', h('button.btn.subtle', { type: 'button', onclick: () => { openedFolder = null; paint(); } }, icon('arrowLeft', { size: 14 }), 'Folders'), h('b', P.basename(openedFolder)));
    const empty = () => h('div.ph-empty', icon('image', { size: 40 }), h('b', section === 'favorites' ? 'No favourites yet' : query ? 'No pictures match your search' : 'No pictures yet'),
      h('p', section === 'favorites' ? 'Open a picture and select the star to add it here.' : `Photos shows pictures in ${folders.join(', ')}. Import pictures, take some with Camera, or add folders with the settings button.`));
    paint();
  }

  function thumbImg(e, size = 220) {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
    thumbnail(ctx.fs, e, size).then((u) => { if (u) img.src = u; else img.replaceWith(h('div.ph-noimg', icon('image', { size: 24 }))); });
    return img;
  }
  function tile(e, shown) {
    return h('button.ph-tile', { type: 'button', title: e.name, 'aria-label': e.name, onclick: () => openViewer(shown, shown.indexOf(e)),
      oncontextmenu: (ev) => { ev.preventDefault(); showMenu(pictureMenu(e), { x: ev.clientX, y: ev.clientY }); } },
    thumbImg(e), favorites.has(e.path) ? h('span.ph-star', '★') : null);
  }

  function folderMenu(anchor) {
    const opts = ['Pictures', 'Desktop', 'Downloads', 'Documents'];
    showMenu([{ header: 'Show pictures from' }, ...opts.map((f) => ({ label: f, checked: folders.includes(f), onSelect: async () => {
      folders = folders.includes(f) ? folders.filter((x) => x !== f) : [...folders, f];
      if (!folders.length) folders = ['Pictures'];
      store.set('folders', folders);
      await scan(); renderGallery();
    } }))], { anchor, align: 'start' });
  }

  async function importPictures() {
    const files = await ctx.host.importFiles({ multiple: true, accept: 'image/*' });
    if (!files?.length) return;
    const dir = P.join(home, 'Pictures', 'Imported');
    await ctx.fs.mkdir(dir, { recursive: true });
    for (const f of files) {
      const path = P.join(dir, await ctx.fs.uniqueName(dir, f.name));
      await ctx.fs.writeFile(path, f.data);
    }
    await scan();
    renderGallery();
  }

  function pictureMenu(e) {
    return [
      { label: 'Open', icon: 'image', onSelect: () => openViewer(items, Math.max(0, items.indexOf(e))) },
      { label: favorites.has(e.path) ? 'Remove from favourites' : 'Add to favourites', icon: 'sparkle', onSelect: () => toggleFav(e) },
      { label: 'Set as desktop background', icon: 'monitor', onSelect: () => setBackground(e, 'appearance.wallpaper') },
      { label: 'Set as lock screen', icon: 'lock', onSelect: () => setBackground(e, 'appearance.lockWallpaper') },
      { label: 'Open in Paint', icon: 'edit', onSelect: () => ctx.open(e.path, { appId: 'paint' }) },
      { label: 'Show in folder', icon: 'folder', onSelect: () => ctx.launch('explorer', { path: P.dirname(e.path) }) },
      { separator: true },
      { label: 'Delete', icon: 'trash', danger: true, onSelect: () => remove(e) },
    ];
  }

  function toggleFav(e) {
    if (favorites.has(e.path)) favorites.delete(e.path); else favorites.add(e.path);
    store.set('favorites', [...favorites]);
    if (view === 'viewer') renderViewerChrome(); else renderGallery();
  }

  function setBackground(e, key) {
    k.settings.set(key, `file:${e.path}`, me.id);
    ctx.notify({ title: key === 'appearance.wallpaper' ? 'Desktop background set' : 'Lock screen picture set', body: e.name }).catch(() => {});
  }

  async function remove(e) {
    if (!(await confirmDialog(`Delete ${e.name}?`, 'It moves to the Recycle Bin, where you can restore it.', { ok: 'Delete', danger: true, parent: win.body }))) return;
    try { await ctx.fs.trash(e.path); } catch (err) { alertDialog('Couldn’t delete', err.message, { parent: win.body }); return; }
    items = items.filter((x) => x.path !== e.path);
    if (view === 'viewer') {
      list = list.filter((x) => x.path !== e.path);
      if (!list.length) { renderGallery(); return; }
      index = Math.min(index, list.length - 1);
      showCurrent();
    } else renderGallery();
  }

  // ── Viewer ───────────────────────────────────────────────────────────
  let stage, imgEl, chrome, infoEl, filmstrip;
  let zoom = 1, fit = true, pan = { x: 0, y: 0 }, slideshow = null, infoOpen = store.get('info', false);

  async function openViewer(arr, i) {
    list = arr;
    index = Math.max(0, i);
    view = 'viewer';
    win.body.classList.add('viewing');
    imgEl = h('img.ph-img', { alt: '', draggable: 'false' });
    stage = h('div.ph-stage', { tabindex: '0' }, imgEl);
    chrome = h('div.ph-vbar');
    infoEl = h('div.ph-info', { hidden: !infoOpen });
    filmstrip = h('div.ph-film');
    mount(content, chrome, h('div.ph-vbody', stage, infoEl), filmstrip,
      h('button.ph-nav.prev', { type: 'button', 'aria-label': 'Previous picture', onclick: () => step(-1) }, icon('chevronRight', { size: 22 })),
      h('button.ph-nav.next', { type: 'button', 'aria-label': 'Next picture', onclick: () => step(1) }, icon('chevronRight', { size: 22 })));
    wireStage();
    await showCurrent();
    stage.focus();
  }

  async function showCurrent() {
    const e = list[index];
    if (!e) return;
    win.setTitle(`${e.name} — Photos`);
    zoom = 1; fit = true; pan = { x: 0, y: 0 };
    imgEl.style.filter = '';
    try {
      imgEl.src = await urlFor(e);
      await imgEl.decode().catch(() => {});
    } catch (err) { imgEl.removeAttribute('src'); alertDialog('Couldn’t open this picture', err.message, { parent: win.body }); }
    applyTransform();
    renderViewerChrome();
    renderFilm();
    ctx.addRecent(e.path);
  }

  function renderViewerChrome() {
    const e = list[index];
    const btn = (ic, label, onclick, opts = {}) => h('button.tb-btn', { type: 'button', title: label, 'aria-label': label, onclick, ...opts }, typeof ic === 'string' ? icon(ic, { size: 18 }) : ic);
    mount(chrome,
      btn('arrowLeft', 'Back to gallery (Esc)', () => { stopShow(); scan().then(renderGallery); }),
      h('span.ph-name', e.name, h('small', `  ${index + 1} of ${list.length}`)),
      h('div.ph-grow'),
      btn('minus', 'Zoom out (Ctrl+Minus)', () => setZoom(currentScale() / 1.25)),
      h('span.ph-zoomv', `${Math.round(currentScale() * 100)}%`),
      btn('plus', 'Zoom in (Ctrl+Plus)', () => setZoom(currentScale() * 1.25)),
      btn('view', fit ? 'Actual size' : 'Fit to window', () => { if (fit) setZoom(1); else { fit = true; pan = { x: 0, y: 0 }; applyTransform(); renderViewerChrome(); } }),
      h('span.wr-sep'),
      btn(h('span.ph-starbtn', favorites.has(e.path) ? '★' : '☆'), favorites.has(e.path) ? 'Remove from favourites' : 'Add to favourites', () => toggleFav(e), { 'aria-pressed': String(favorites.has(e.path)) }),
      btn('restart', 'Rotate (Ctrl+R)', () => rotateFile(e)),
      btn('edit', 'Edit', () => openEditor(e)),
      btn('trash', 'Delete (Del)', () => remove(e)),
      btn('sparkle', slideshow ? 'Stop slideshow' : 'Slideshow (F5)', () => (slideshow ? stopShow() : startShow())),
      btn('info', 'File information (Alt+Enter)', () => { infoOpen = !infoOpen; store.set('info', infoOpen); infoEl.hidden = !infoOpen; renderInfo(); }),
      btn('chevronDown', 'More', (ev) => showMenu([
        { label: 'Copy', icon: 'copy', hint: 'Ctrl+C', onSelect: () => copyImage(e) },
        { label: 'Print…', hint: 'Ctrl+P', onSelect: () => printImage(e) },
        { label: 'Save a copy…', icon: 'download', onSelect: () => saveCopy(e) },
        { separator: true },
        ...pictureMenu(e).slice(2, 6),
      ], { anchor: ev.currentTarget, align: 'start' })));
    renderInfo();
  }

  async function renderInfo() {
    if (!infoOpen || !infoEl) return;
    const e = list[index];
    const st = await ctx.fs.stat(e.path).catch(() => e);
    mount(infoEl, h('h3', 'Info'),
      h('dl.tm-props',
        h('dt', 'Name'), h('dd', e.name),
        h('dt', 'Dimensions'), h('dd', imgEl.naturalWidth ? `${imgEl.naturalWidth} × ${imgEl.naturalHeight}` : '—'),
        h('dt', 'Size'), h('dd', formatBytes(st.size)),
        h('dt', 'Type'), h('dd', e.ext.slice(1).toUpperCase()),
        h('dt', 'Modified'), h('dd', new Date(st.mtime).toLocaleString()),
        h('dt', 'Folder'), h('dd', h('button.wr-stbtn', { type: 'button', onclick: () => ctx.launch('explorer', { path: P.dirname(e.path) }) }, P.dirname(e.path).replace(home, '~')))));
  }

  function renderFilm() {
    const start = Math.max(0, index - 12);
    mount(filmstrip, list.slice(start, index + 13).map((e, i) => h('button.ph-filmitem', { type: 'button', 'aria-current': start + i === index ? 'true' : undefined, 'aria-label': e.name, onclick: () => { index = start + i; showCurrent(); } }, thumbImg(e, 96))));
    filmstrip.querySelector('[aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function step(d) {
    if (!list.length) return;
    index = (index + d + list.length) % list.length;
    showCurrent();
  }

  // Zoom and pan
  const baseScale = () => {
    if (!imgEl?.naturalWidth) return 1;
    const r = stage.getBoundingClientRect();
    return Math.min(1, (r.width - 32) / imgEl.naturalWidth, (r.height - 32) / imgEl.naturalHeight);
  };
  const currentScale = () => (fit ? baseScale() : zoom);
  function setZoom(z) {
    zoom = Math.max(0.05, Math.min(10, z));
    fit = false;
    applyTransform();
    renderViewerChrome();
  }
  function applyTransform() {
    if (!imgEl) return;
    const s = currentScale();
    imgEl.style.width = `${(imgEl.naturalWidth || 0) * s}px`;
    imgEl.style.height = `${(imgEl.naturalHeight || 0) * s}px`;
    imgEl.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
    stage.classList.toggle('pannable', !fit && s > baseScale());
  }
  function wireStage() {
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || !fit) setZoom(currentScale() * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      else step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    stage.addEventListener('dblclick', () => { if (fit) setZoom(1); else { fit = true; pan = { x: 0, y: 0 }; applyTransform(); renderViewerChrome(); } });
    let drag = null;
    stage.addEventListener('pointerdown', (e) => { if (fit) return; drag = { x: e.clientX - pan.x, y: e.clientY - pan.y }; stage.setPointerCapture(e.pointerId); stage.classList.add('panning'); });
    stage.addEventListener('pointermove', (e) => { if (!drag) return; pan = { x: e.clientX - drag.x, y: e.clientY - drag.y }; applyTransform(); });
    stage.addEventListener('pointerup', () => { drag = null; stage.classList.remove('panning'); });
    // Swipe on touch screens
    let touch = null;
    stage.addEventListener('touchstart', (e) => { if (fit && e.touches.length === 1) touch = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', (e) => { if (touch === null) return; const dx = e.changedTouches[0].clientX - touch; touch = null; if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1); });
  }
  win.on('resize', () => { if (view === 'viewer') { applyTransform(); renderViewerChrome(); } });

  // Slideshow
  function startShow() {
    stopShow();
    slideshow = ctx.setInterval(() => step(1), store.get('slideSeconds', 4) * 1000);
    win.body.classList.add('slideshow');
    renderViewerChrome();
  }
  function stopShow() {
    if (!slideshow) return;
    ctx.clearInterval(slideshow);
    slideshow = null;
    win.body.classList.remove('slideshow');
    renderViewerChrome?.();
  }

  // ── File operations on the current picture ───────────────────────────
  async function readCanvas(e) {
    const img = new Image();
    img.src = await urlFor(e);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  }
  const typeFor = (ext) => (ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png');
  async function writeCanvas(c, path) {
    const blob = await new Promise((r) => c.toBlob(r, typeFor(P.extname(path).toLowerCase()), 0.93));
    await ctx.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    const st = await ctx.fs.stat(path);
    const i = list.findIndex((x) => x.path === path);
    if (i >= 0) list[i] = st; else { list.splice(index + 1, 0, st); }
    const j = items.findIndex((x) => x.path === path);
    if (j >= 0) items[j] = st; else items.unshift(st);
    return st;
  }

  async function rotateFile(e) {
    if (!WRITABLE.has(e.ext.toLowerCase())) { alertDialog('Can’t rotate this picture', `Photos can save PNG, JPEG and WebP pictures. Use Edit › Save a copy to rotate a ${e.ext.slice(1).toUpperCase()}.`, { parent: win.body }); return; }
    const src = await readCanvas(e);
    const c = document.createElement('canvas');
    c.width = src.height; c.height = src.width;
    const g = c.getContext('2d');
    g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(src, 0, 0);
    await writeCanvas(c, e.path);
    await showCurrent();
  }

  async function copyImage(e) {
    const c = await readCanvas(e);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); ctx.notify({ title: 'Copied', body: e.name, silent: true }).catch(() => {}); }
    catch { alertDialog('Couldn’t copy the picture', 'The clipboard isn’t available right now.', { parent: win.body }); }
  }

  async function printImage(e) {
    const { printDocument } = await import('../common/print.js');
    const c = await readCanvas(e);
    await printDocument({ title: e.name, html: `<img src="${c.toDataURL('image/png')}" style="max-width:100%;max-height:100vh;display:block;margin:auto">` });
  }

  async function saveCopy(e, canvasOverride) {
    const base = P.basename(e.name, e.ext);
    const ext = WRITABLE.has(e.ext.toLowerCase()) ? e.ext.toLowerCase() : '.png';
    const filters = [{ label: 'PNG picture', exts: ['.png'] }, { label: 'JPEG picture', exts: ['.jpg', '.jpeg'] }, { label: 'WebP picture', exts: ['.webp'] }]
      .sort((a, b) => (b.exts.includes(ext) ? 1 : 0) - (a.exts.includes(ext) ? 1 : 0));
    const path = await saveFileDialog(ctx, win, { title: 'Save a copy', filters, suggestedName: `${base} (edited)${filters[0].exts[0]}`, startIn: P.dirname(e.path) });
    if (!path) return null;
    const st = await writeCanvas(canvasOverride || (await readCanvas(e)), path);
    return st;
  }

  // ── Editor: crop, rotate, flip, adjustments, filters ─────────────────
  async function openEditor(e) {
    stopShow();
    const src = await readCanvas(e);
    let state = { rot: 0, flipH: false, flipV: false, crop: null, filter: 'none', brightness: 100, contrast: 100, saturation: 100, warmth: 0 };
    const preview = h('canvas.ph-edit-canvas');
    const cropBox = h('div.ph-crop', { hidden: true });
    const wrap = h('div.ph-edit-stage', preview, cropBox);
    const panel = h('div.ph-edit-panel');
    const editor = h('div.ph-editor', h('div.ph-vbar',
      h('button.btn.subtle', { type: 'button', onclick: () => close() }, icon('close', { size: 14 }), 'Cancel'),
      h('span.ph-name', `Editing ${e.name}`), h('div.ph-grow'),
      h('button.btn', { type: 'button', onclick: async () => { const st = await saveCopy(e, render(true)); if (st) { close(); index = list.findIndex((x) => x.path === st.path); showCurrent(); } } }, 'Save as copy'),
      WRITABLE.has(e.ext.toLowerCase()) ? h('button.btn.primary', { type: 'button', onclick: async () => {
        if (!(await confirmDialog('Replace the original?', `${e.name} will be overwritten with your edits.`, { ok: 'Save', parent: win.body }))) return;
        await writeCanvas(render(true), e.path); close(); showCurrent();
      } }, 'Save') : null),
    h('div.ph-edit-body', wrap, panel));
    content.append(editor);

    const filterCss = () => {
      const f = FILTERS.find((x) => x[0] === state.filter)[2];
      return `${f} brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%)${state.warmth ? ` sepia(${Math.abs(state.warmth) / 200}) hue-rotate(${state.warmth < 0 ? 180 : 0}deg)` : ''}`.trim();
    };
    // Renders the edited picture: for the preview (scaled) or full size for saving.
    function render(full = false) {
      const rotated = state.rot % 180 !== 0;
      const fw = rotated ? src.height : src.width, fh = rotated ? src.width : src.height;
      const full_ = document.createElement('canvas');
      full_.width = fw; full_.height = fh;
      const g = full_.getContext('2d');
      g.filter = filterCss() || 'none';
      g.translate(fw / 2, fh / 2);
      g.rotate((state.rot * Math.PI) / 180);
      g.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
      g.drawImage(src, -src.width / 2, -src.height / 2);
      let out = full_;
      if (state.crop) {
        const { x, y, w, h: ch } = state.crop;
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * fw)); c.height = Math.max(1, Math.round(ch * fh));
        c.getContext('2d').drawImage(full_, x * fw, y * fh, w * fw, ch * fh, 0, 0, c.width, c.height);
        out = c;
      }
      if (full) return out;
      const r = wrap.getBoundingClientRect();
      const source = cropping ? full_ : out;
      const s = Math.min(1, (r.width - 40) / source.width, (r.height - 40) / source.height);
      preview.width = Math.max(1, Math.round(source.width * s)); preview.height = Math.max(1, Math.round(source.height * s));
      preview.getContext('2d').drawImage(source, 0, 0, preview.width, preview.height);
      return out;
    }

    let cropping = false;
    let pendingCrop = null;
    function showCropBox() {
      const pr = preview.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      const c = pendingCrop;
      Object.assign(cropBox.style, { left: `${pr.left - wr.left + c.x * pr.width}px`, top: `${pr.top - wr.top + c.y * pr.height}px`, width: `${c.w * pr.width}px`, height: `${c.h * pr.height}px` });
    }
    cropBox.innerHTML = '<i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i>';
    cropBox.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const handle = ev.target.dataset.h || 'move';
      const pr = preview.getBoundingClientRect();
      const start = { x: ev.clientX, y: ev.clientY, c: { ...pendingCrop } };
      const move = (m) => {
        const dx = (m.clientX - start.x) / pr.width, dy = (m.clientY - start.y) / pr.height;
        let { x, y, w, h: hh } = start.c;
        if (handle === 'move') { x = Math.min(1 - w, Math.max(0, x + dx)); y = Math.min(1 - hh, Math.max(0, y + dy)); }
        if (handle.includes('w')) { const nx = Math.min(x + w - 0.05, Math.max(0, x + dx)); w += x - nx; x = nx; }
        if (handle.includes('e')) w = Math.min(1 - x, Math.max(0.05, w + dx));
        if (handle.includes('n')) { const ny = Math.min(y + hh - 0.05, Math.max(0, y + dy)); hh += y - ny; y = ny; }
        if (handle.includes('s')) hh = Math.min(1 - y, Math.max(0.05, hh + dy));
        pendingCrop = { x, y, w, h: hh };
        showCropBox();
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });

    const slider = (label, key, min, max) => h('label.ph-slider', h('span', label, h('small', String(state[key]))),
      h('input', { type: 'range', min, max, value: state[key], 'aria-label': label, oninput: (ev) => { state[key] = Number(ev.target.value); ev.target.previousSibling.lastChild.textContent = ev.target.value; render(); } }));
    function renderPanel() {
      mount(panel,
        h('h3', 'Crop & rotate'),
        h('div.ph-edit-row',
          h('button.btn', { type: 'button', 'aria-pressed': String(cropping), onclick: () => {
            cropping = !cropping;
            if (cropping) { pendingCrop = state.crop || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }; state.crop = null; render(); cropBox.hidden = false; showCropBox(); }
            else { state.crop = pendingCrop; cropBox.hidden = true; render(); }
            renderPanel();
          } }, cropping ? 'Apply crop' : 'Crop'),
          state.crop ? h('button.btn.subtle', { type: 'button', onclick: () => { state.crop = null; render(); renderPanel(); } }, 'Reset crop') : null),
        h('div.ph-edit-row',
          h('button.btn', { type: 'button', onclick: () => { state.rot = (state.rot + 270) % 360; state.crop = null; render(); } }, '⟲ Left'),
          h('button.btn', { type: 'button', onclick: () => { state.rot = (state.rot + 90) % 360; state.crop = null; render(); } }, '⟳ Right'),
          h('button.btn', { type: 'button', onclick: () => { state.flipH = !state.flipH; render(); } }, '⇋ Flip'),
          h('button.btn', { type: 'button', onclick: () => { state.flipV = !state.flipV; render(); } }, '⇵ Flip')),
        h('h3', 'Adjust'),
        slider('Brightness', 'brightness', 30, 200), slider('Contrast', 'contrast', 30, 200), slider('Saturation', 'saturation', 0, 250), slider('Warmth', 'warmth', -100, 100),
        h('h3', 'Filters'),
        h('div.ph-filters', FILTERS.map(([id, label, css]) => {
          const t = thumbFor(css);
          return h('button.ph-filter', { type: 'button', 'aria-pressed': String(state.filter === id), onclick: () => { state.filter = id; render(); renderPanel(); } }, t, h('span', label));
        })),
        h('button.btn.subtle', { type: 'button', onclick: () => { state = { rot: 0, flipH: false, flipV: false, crop: null, filter: 'none', brightness: 100, contrast: 100, saturation: 100, warmth: 0 }; cropping = false; cropBox.hidden = true; render(); renderPanel(); } }, 'Reset all'));
    }
    const small = document.createElement('canvas');
    { const s = 72 / Math.max(src.width, src.height); small.width = Math.max(1, Math.round(src.width * s)); small.height = Math.max(1, Math.round(src.height * s)); small.getContext('2d').drawImage(src, 0, 0, small.width, small.height); }
    const thumbFor = (css) => { const c = document.createElement('canvas'); c.width = small.width; c.height = small.height; const g = c.getContext('2d'); g.filter = css || 'none'; g.drawImage(small, 0, 0); return c; };
    function close() { editor.remove(); stage?.focus(); }
    editor.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } });
    renderPanel();
    requestAnimationFrame(() => render());
  }

  // ── Keys ─────────────────────────────────────────────────────────────
  ctx.listen(win.body, 'keydown', (e) => {
    if (view !== 'viewer' || e.target.matches('input, textarea, select') || content.querySelector('.ph-editor')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const cur = list[index];
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !slideshow)) { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { index = 0; showCurrent(); }
    else if (e.key === 'End') { index = list.length - 1; showCurrent(); }
    else if (e.key === 'Escape') { e.preventDefault(); if (slideshow) stopShow(); else scan().then(renderGallery); }
    else if (e.key === 'F5') { e.preventDefault(); slideshow ? stopShow() : startShow(); }
    else if (e.key === 'Delete') { e.preventDefault(); remove(cur); }
    else if (e.altKey && e.key === 'Enter') { e.preventDefault(); infoOpen = !infoOpen; store.set('info', infoOpen); infoEl.hidden = !infoOpen; renderInfo(); }
    else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(currentScale() * 1.25); }
    else if (ctrl && e.key === '-') { e.preventDefault(); setZoom(currentScale() / 1.25); }
    else if (ctrl && e.key === '0') { e.preventDefault(); fit = true; pan = { x: 0, y: 0 }; applyTransform(); renderViewerChrome(); }
    else if (ctrl && e.key.toLowerCase() === 'r') { e.preventDefault(); rotateFile(cur); }
    else if (ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); copyImage(cur); }
    else if (ctrl && e.key.toLowerCase() === 'p') { e.preventDefault(); printImage(cur); }
    else if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); openEditor(cur); }
  });

  ctx.bus.on('fs:changed', (ev) => {
    if (view !== 'gallery') return;
    const dir = ev.dir || '';
    if (folders.some((f) => P.isSameOrInside(f.startsWith('/') ? f : P.join(home, f), dir))) { clearTimeout(rescan); rescan = setTimeout(() => scan().then(renderGallery), 400); }
  });
  let rescan = null;
  ctx.onActivate((args) => { win.focus(); if (args?.path) openFile(args.path); });

  async function openFile(path) {
    const st = await ctx.fs.stat(path).catch(() => null);
    if (!st) { await scan(); renderGallery(); return; }
    // Page through the pictures in the same folder, like a desktop photo viewer.
    const siblings = (await ctx.fs.readdir(P.dirname(path)).catch(() => [st])).filter((e) => e.type === 'file' && IMAGE_EXT.has(e.ext)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    openViewer(siblings.length ? siblings : [st], Math.max(0, siblings.findIndex((x) => x.path === path)));
    scan();
  }

  if (ctx.args.path) openFile(ctx.args.path);
  else scan().then(renderGallery);
}
