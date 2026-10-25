// Widgets: weather (Open-Meteo), clocks, today's agenda, to-do list and photos.

import { h, mount } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { showMenu } from '../ui/menu.js';
import { weatherIcon, describe } from './weather.js';
import { formatTime, formatDate } from './format.js';
import { openPath, launchApp } from './apps.js';
import { relTime } from './start-menu.js';
import { uid as makeId } from '../core/util.js';
import * as P from '../core/path.js';

const ALL = [['weather', 'Weather'], ['clock', 'Clocks'], ['agenda', 'Calendar'], ['todo', 'To Do'], ['photos', 'Photos']];
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg']);

export class Widgets {
  constructor(session) {
    this.s = session;
    this.kernel = session.kernel;
    this.settings = session.settings;
    this.weather = session.weather;
    this.photos = [];
    this.photoIndex = 0;
    this.urls = new Map();
    this.f = session.flyouts.add('widgets', {
      className: 'fly-widgets', label: 'Widgets',
      onOpen: () => { this.render(); this.weather.refresh(); this.loadPhotos(); this.tick = setInterval(() => this.renderClock(), 1000); this.slide = setInterval(() => this.nextPhoto(), 8000); },
      onClose: () => { clearInterval(this.tick); clearInterval(this.slide); },
    });
    this.offs = [
      this.weather.subscribe(() => this.isOpen() && this.renderWeather()),
      this.settings.watch('widgets.*', (_, key) => { if (this.isOpen() && key !== 'widgets.weatherCache') this.render(); }),
      this.kernel.bus.on('fs:changed', (e) => { if (this.isOpen() && e.path.startsWith(P.join(this.s.user.home, 'Pictures'))) this.loadPhotos(); }),
    ];
  }

  isOpen() { return this.s.flyouts.isOpen('widgets'); }
  shown(id) { return !this.settings.get('widgets.hidden').includes(id); }

  render() {
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    this.weatherEl = h('section.widget.w-weather.w-wide');
    this.clockEl = h('section.widget.w-clock');
    this.agendaEl = h('section.widget.w-agenda');
    this.todoEl = h('section.widget.w-todo');
    this.photoEl = h('section.widget.w-photos');
    mount(this.f.el,
      h('div.w-head', h('div', h('b', `${greet}, ${this.s.user.name.split(' ')[0]}`), h('small', formatDate(new Date(), this.settings, 'long'))),
        h('button.btn.small', { type: 'button', onclick: (e) => this.customize(e.currentTarget) }, icon('plus', { size: 14 }), 'Widgets')),
      h('div.w-grid',
        this.shown('weather') ? this.weatherEl : null,
        this.shown('clock') ? this.clockEl : null,
        this.shown('agenda') ? this.agendaEl : null,
        this.shown('todo') ? this.todoEl : null,
        this.shown('photos') ? this.photoEl : null,
        ALL.every(([id]) => !this.shown(id)) ? h('div.nc-empty', 'All widgets are hidden. Use “Widgets” above to add some.') : null));
    this.renderWeather(); this.renderClock(); this.renderAgenda(); this.renderTodo(); this.renderPhotos();
  }

  customize(anchor) {
    const hidden = this.settings.get('widgets.hidden');
    showMenu(ALL.map(([id, label]) => ({ label, checked: !hidden.includes(id), onSelect: () => {
      this.settings.set('widgets.hidden', hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]);
    } })), { anchor });
  }

  // ── Weather ──────────────────────────────────────────────────────────
  renderWeather() {
    const el = this.weatherEl;
    if (!el) return;
    const w = this.weather;
    const loc = w.location;
    if (!loc) { this.weatherSetup(el); return; }
    const d = w.data;
    const head = h('div.w-title', icon('sun', { size: 16 }), h('span', 'Weather'), h('small', loc.name),
      h('button.tb-btn', { type: 'button', 'aria-label': 'Weather options', onclick: (e) => showMenu([
        { label: 'Refresh', icon: 'refresh', onSelect: () => w.refresh({ force: true }) },
        { label: 'Change location', icon: 'globe', onSelect: () => this.weatherSetup(el) },
        { label: `Units: ${w.units() === 'imperial' ? '°F' : '°C'} (switch)`, icon: 'sort', onSelect: () => { this.settings.set('weather.units', w.units() === 'imperial' ? 'metric' : 'imperial'); w.refresh({ force: true }); } },
      ], { anchor: e.currentTarget }) }, icon('chevronDown', { size: 14 })));
    if (!d) {
      mount(el, head, h('div.w-msg', w.loading ? 'Loading the forecast…' : w.error === 'offline' ? 'You’re offline. The forecast will load when DonutOS is back online.' : w.error || 'No forecast yet.'));
      return;
    }
    const unit = d.units === 'imperial' ? '°F' : '°C';
    const wind = d.units === 'imperial' ? 'mph' : 'km/h';
    mount(el, head,
      h('div.wx-now', weatherIcon(d.current.code, { night: !d.current.day, size: 56 }),
        h('div', h('div.wx-temp', `${Math.round(d.current.temp)}`, h('small', unit)), h('div', describe(d.current.code)[0])),
        h('div.wx-meta', h('div', `Feels like ${Math.round(d.current.feels)}°`), h('div', `Humidity ${d.current.humidity}%`), h('div', `Wind ${Math.round(d.current.wind)} ${wind}`))),
      h('div.wx-days', d.daily.map((day, i) => h('div.wx-day',
        h('small', i === 0 ? 'Today' : new Date(`${day.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })),
        weatherIcon(day.code, { size: 28 }), h('b', `${Math.round(day.max)}°`), h('small', `${Math.round(day.min)}°`),
        day.rain !== null ? h('small.wx-rain', `${day.rain}%`) : null))),
      h('div.w-foot', w.error === 'offline' ? 'Offline — showing the last forecast' : w.error ? w.error : `Updated ${relTime(d.fetchedAt)} · Open-Meteo`));
  }

  weatherSetup(el) {
    const w = this.weather;
    const input = h('input.input', { type: 'search', placeholder: 'Search for a city', 'aria-label': 'City' });
    const results = h('div.w-results');
    const msg = h('div.hint');
    const find = async () => {
      if (!input.value.trim()) return;
      msg.textContent = 'Searching…';
      try {
        const list = await w.search(input.value.trim());
        msg.textContent = list.length ? '' : 'No places found.';
        mount(results, list.map((p) => h('button.search-row', { type: 'button', onclick: () => w.setLocation(p) }, icon('globe', { size: 18 }), h('span', h('b', p.name), h('small', p.region)))));
      } catch (e) { msg.textContent = e.message; }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') find(); });
    mount(el,
      h('div.w-title', icon('sun', { size: 16 }), h('span', 'Weather')),
      h('p.w-msg', 'Choose a location for your forecast.'),
      h('div', { style: { display: 'flex', gap: '8px' } }, input, h('button.btn', { type: 'button', onclick: find }, 'Search')),
      h('button.btn.subtle', { type: 'button', style: { justifySelf: 'start' }, onclick: async () => {
        msg.textContent = 'Finding your location…';
        try { await w.setLocation(await w.locate()); } catch (e) { msg.textContent = e.message; }
      } }, icon('globe', { size: 16 }), 'Use my location'),
      msg, results);
    input.focus();
  }

  // ── Clock ────────────────────────────────────────────────────────────
  renderClock() {
    const el = this.clockEl;
    if (!el || !el.isConnected) return;
    const now = new Date();
    const zones = this.settings.get('time.worldClocks');
    const fmt = (tz) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: !this.settings.get('time.format24h'), timeZone: tz }).format(now);
    const city = (tz) => tz.split('/').pop().replace(/_/g, ' ');
    const offset = (tz) => {
      const a = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      const b = new Date(now.toLocaleString('en-US'));
      const hrs = Math.round((a - b) / 36e5);
      return hrs === 0 ? 'Same time' : `${hrs > 0 ? '+' : ''}${hrs}h`;
    };
    mount(el, h('div.w-title', icon('restart', { size: 16 }), h('span', 'Clocks')),
      h('div.clk-big', formatTime(now, this.settings, { seconds: true })),
      h('div.clk-list', zones.map((tz) => h('div.clk-row', h('span', city(tz)), h('small', offset(tz)), h('b', fmt(tz))))),
      h('button.btn.small', { type: 'button', style: { justifySelf: 'start' }, onclick: () => { this.s.flyouts.close(); launchApp(this.kernel, 'settings', { page: 'datetime' }); } }, 'Edit clocks'));
  }

  // ── Agenda ───────────────────────────────────────────────────────────
  renderAgenda() {
    const el = this.agendaEl;
    if (!el) return;
    let events = [];
    try { events = this.settings.get('app.calendar.events') || []; } catch { events = []; }
    const now = Date.now();
    const upcoming = events.filter((e) => (e.end || e.start) >= now - 3600_000).sort((a, b) => a.start - b.start).slice(0, 4);
    const today = new Date();
    mount(el, h('div.w-title', icon('calendar', { size: 16 }), h('span', 'Calendar')),
      h('div.agenda-day', h('b', String(today.getDate())), h('span', today.toLocaleDateString(undefined, { weekday: 'long' }), h('small', today.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })))),
      upcoming.length ? upcoming.map((e) => h('div.cal-ev', h('i', { style: { background: e.color || 'var(--accent)' } }), h('span', e.title),
        h('small', new Date(e.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))))
        : h('div.w-msg', 'Nothing coming up.'),
      this.kernel.registry.has('calendar') ? h('button.btn.small', { type: 'button', style: { justifySelf: 'start' }, onclick: () => { this.s.flyouts.close(); launchApp(this.kernel, 'calendar'); } }, 'Open Calendar') : null);
  }

  // ── To do ────────────────────────────────────────────────────────────
  renderTodo() {
    const el = this.todoEl;
    if (!el) return;
    const items = this.settings.get('widgets.todo');
    const save = (list) => this.settings.set('widgets.todo', list);
    const input = h('input.input', { placeholder: 'Add a task', 'aria-label': 'New task', maxlength: 200,
      onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { this.todoFocus = true; save([...items, { id: makeId('t'), text: e.target.value.trim(), done: false }]); } } });
    const open = items.filter((t) => !t.done), done = items.filter((t) => t.done);
    mount(el, h('div.w-title', icon('check', { size: 16 }), h('span', 'To Do'), h('small', `${open.length} open`)),
      h('div.todo-list', [...open, ...done].map((t) => h('div.todo-item', { class: t.done && 'done' },
        h('input', { type: 'checkbox', checked: t.done, 'aria-label': t.text, onchange: () => save(items.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x))) }),
        h('span', t.text),
        h('button.tb-btn', { type: 'button', 'aria-label': `Delete ${t.text}`, onclick: () => save(items.filter((x) => x.id !== t.id)) }, icon('close', { size: 12 }))))),
      input,
      done.length ? h('button.btn.small', { type: 'button', style: { justifySelf: 'start' }, onclick: () => save(open) }, 'Clear completed') : null);
    if (this.todoFocus) { input.focus(); this.todoFocus = false; }
  }

  // ── Photos ───────────────────────────────────────────────────────────
  async loadPhotos() {
    const root = P.join(this.s.user.home, 'Pictures');
    const found = [];
    await this.kernel.fs.walk(root, (e) => { if (e.type === 'file' && IMAGE.has(e.ext) && found.length < 60) found.push(e); });
    this.photos = found.sort((a, b) => b.mtime - a.mtime);
    if (this.photoIndex >= this.photos.length) this.photoIndex = 0;
    this.renderPhotos();
  }

  async photoUrl(e) {
    const key = `${e.path}|${e.mtime}`;
    if (!this.urls.has(key)) this.urls.set(key, URL.createObjectURL(await this.kernel.fs.readBlob(e.path)));
    return this.urls.get(key);
  }

  nextPhoto() { if (this.photos.length > 1) { this.photoIndex = (this.photoIndex + 1) % this.photos.length; this.renderPhotos(); } }

  async renderPhotos() {
    const el = this.photoEl;
    if (!el) return;
    const title = h('div.w-title', icon('image', { size: 16 }), h('span', 'Photos'), this.photos.length ? h('small', `${this.photoIndex + 1} of ${this.photos.length}`) : null);
    if (!this.photos.length) {
      mount(el, title, h('div.w-msg', 'Photos in your Pictures folder show up here.'),
        h('button.btn.small', { type: 'button', style: { justifySelf: 'start' }, onclick: async () => {
          const files = await this.kernel.platform.host.importFiles({ multiple: true, accept: 'image/*' });
          const dir = P.join(this.s.user.home, 'Pictures');
          for (const f of files) if (IMAGE.has(P.extname(f.name))) await this.kernel.fs.writeFile(P.join(dir, await this.kernel.fs.uniqueName(dir, f.name)), f.data);
        } }, icon('upload', { size: 14 }), 'Add photos'));
      return;
    }
    const e = this.photos[this.photoIndex];
    const url = await this.photoUrl(e);
    mount(el, title, h('button.photo-frame', { type: 'button', title: e.name, onclick: () => { this.s.flyouts.close(); openPath(this.kernel, e.path); } }, h('img', { src: url, alt: e.name })),
      h('div.w-foot', e.name));
  }

  destroy() { this.offs.forEach((f) => f()); clearInterval(this.tick); clearInterval(this.slide); for (const u of this.urls.values()) URL.revokeObjectURL(u); }
}
