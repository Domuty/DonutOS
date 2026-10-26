// Calendar: month, week, day and agenda views; events with times, all-day, repeats,
// reminders (rung by the shell's scheduler even when Calendar is closed), colours, places
// and notes; drag to reschedule; search; import and export iCalendar (.ics) files.

import { h, mount } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { dialog, confirmDialog, alertDialog } from '../../ui/dialog.js';
import { openFileDialog, saveFileDialog } from '../../ui/file-dialog.js';
import { occurrencesBetween } from './recur.js';
import { parseICS, toICS } from './ics.js';
import * as P from '../../core/path.js';

const COLORS = [['#e8618c', 'Pink'], ['#5b7cf0', 'Blue'], ['#4cb782', 'Green'], ['#f08a4b', 'Orange'], ['#9466e8', 'Purple'], ['#2fa8c9', 'Teal'], ['#8a8a8a', 'Grey']];
const REPEATS = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday (Mon–Fri)'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']];
const REMINDERS = [[null, 'None'], [0, 'At start time'], [5, '5 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [1440, '1 day before']];
const DAY = 86400000;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export default function main(ctx) {
  const store = ctx.storage;
  const settings = ctx.settings;
  const win = ctx.windows.create({ title: 'Calendar', width: 1100, height: 720, minWidth: 520, minHeight: 420 });
  win.body.classList.add('calendarapp');

  let view = store.get('view', 'month');
  let cursor = startOfDay(new Date());
  let query = '';
  const firstDay = () => settings.get('time.firstDayOfWeek') ?? 0;
  const h24 = () => !!settings.get('time.format24h');

  const events = () => store.get('events', []);
  const saveEvents = (list) => store.set('events', list);

  const side = h('aside.cal-side');
  const head = h('header.cal-head');
  const body = h('div.cal-body');
  mount(win.body, side, h('div.cal-main', head, body));

  // ── Date helpers ─────────────────────────────────────────────────────
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function startOfWeek(d) { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() - firstDay() + 7) % 7)); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const fmt = (d, o) => new Intl.DateTimeFormat(undefined, o).format(d);
  const timeStr = (d) => fmt(d, { hour: 'numeric', minute: '2-digit', hour12: !h24() });
  const weekdayNames = () => Array.from({ length: 7 }, (_, i) => fmt(new Date(2023, 0, 1 + ((i + firstDay()) % 7)), { weekday: 'short' }));

  function occurrences(from, to) {
    const q = query.toLowerCase();
    return events().filter((e) => !q || `${e.title} ${e.location || ''} ${e.notes || ''}`.toLowerCase().includes(q))
      .flatMap((e) => occurrencesBetween(e, from, to)).sort((a, b) => (b.event.allDay - a.event.allDay) || a.start - b.start);
  }

  // ── Header & sidebar ─────────────────────────────────────────────────
  function title() {
    if (view === 'month') return fmt(cursor, { month: 'long', year: 'numeric' });
    if (view === 'week') { const a = startOfWeek(cursor), b = addDays(a, 6); return a.getMonth() === b.getMonth() ? `${fmt(a, { month: 'long' })} ${a.getDate()}–${b.getDate()}, ${a.getFullYear()}` : `${fmt(a, { month: 'short', day: 'numeric' })} – ${fmt(b, { month: 'short', day: 'numeric', year: 'numeric' })}`; }
    if (view === 'day') return fmt(cursor, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    return 'Agenda';
  }
  function move(n) {
    if (view === 'month') { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1); }
    else if (view === 'week') cursor = addDays(cursor, 7 * n);
    else if (view === 'day') cursor = addDays(cursor, n);
    else cursor = addDays(cursor, 30 * n);
    render();
  }
  function renderHead() {
    mount(head,
      h('button.btn.primary', { type: 'button', onclick: () => editEvent(null, { start: defaultStart() }) }, icon('plus', { size: 16 }), 'New event'),
      h('button.btn', { type: 'button', onclick: () => { cursor = startOfDay(new Date()); render(); } }, 'Today'),
      h('button.tb-btn', { type: 'button', 'aria-label': 'Previous', onclick: () => move(-1) }, icon('arrowLeft', { size: 16 })),
      h('button.tb-btn', { type: 'button', 'aria-label': 'Next', onclick: () => move(1) }, icon('arrowRight', { size: 16 })),
      h('h1.cal-title', title()),
      h('div.cal-grow'),
      h('input.input.cal-search', { type: 'search', placeholder: 'Search events', value: query, 'aria-label': 'Search events', oninput: (e) => { query = e.target.value.trim(); renderBody(); } }),
      h('div.cal-views', { role: 'tablist' }, [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['agenda', 'Agenda']].map(([v, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(view === v), onclick: () => { view = v; store.set('view', v); render(); } }, l))),
      h('button.tb-btn', { type: 'button', 'aria-label': 'More', title: 'Import / export', onclick: (e) => import('../../ui/menu.js').then(({ showMenu }) => showMenu([
        { label: 'Import an .ics file…', icon: 'upload', onSelect: importICS },
        { label: 'Export all events (.ics)…', icon: 'download', onSelect: exportICS },
      ], { anchor: e.currentTarget, align: 'start' })) }, icon('chevronDown', { size: 16 })));
  }
  function defaultStart() {
    const d = new Date(cursor);
    const now = new Date();
    if (sameDay(d, now)) d.setHours(now.getHours() + 1, 0, 0, 0); else d.setHours(9, 0, 0, 0);
    return d;
  }

  function renderSide() {
    const base = new Date(miniMonth.getFullYear(), miniMonth.getMonth(), 1);
    const start = startOfWeek(base);
    const today = new Date();
    const upcoming = occurrences(startOfDay(today), addDays(today, 14)).slice(0, 6);
    mount(side,
      h('div.cal-mini-head', h('b', fmt(base, { month: 'long', year: 'numeric' })),
        h('button.tb-btn', { type: 'button', 'aria-label': 'Previous month', onclick: () => { miniMonth = new Date(base.getFullYear(), base.getMonth() - 1, 1); renderSide(); } }, icon('chevronUp', { size: 14 })),
        h('button.tb-btn', { type: 'button', 'aria-label': 'Next month', onclick: () => { miniMonth = new Date(base.getFullYear(), base.getMonth() + 1, 1); renderSide(); } }, icon('chevronDown', { size: 14 }))),
      h('div.cal-mini', weekdayNames().map((d) => h('small', d.slice(0, 2))),
        Array.from({ length: 42 }, (_, i) => {
          const d = addDays(start, i);
          return h('button', { type: 'button', class: [d.getMonth() !== base.getMonth() && 'other', sameDay(d, today) && 'today', sameDay(d, cursor) && 'sel'], 'aria-label': fmt(d, { dateStyle: 'full' }), onclick: () => { cursor = startOfDay(d); if (view === 'agenda') view = 'day'; render(); } }, String(d.getDate()));
        })),
      h('h3.cal-side-title', 'Coming up'),
      upcoming.length ? h('div.cal-upcoming', upcoming.map((o) => h('button.cal-up', { type: 'button', onclick: () => editEvent(o.event, { occurrence: o }) },
        h('i', { style: { background: o.event.color || COLORS[0][0] } }), h('span', h('b', o.event.title || '(No title)'), h('small', `${sameDay(new Date(o.start), today) ? 'Today' : fmt(new Date(o.start), { weekday: 'short', month: 'short', day: 'numeric' })}${o.event.allDay ? '' : ` · ${timeStr(new Date(o.start))}`}`)))))
        : h('p.hint', 'Nothing in the next two weeks.'));
  }
  let miniMonth = new Date(cursor);

  // ── Views ────────────────────────────────────────────────────────────
  function render() { miniMonth = new Date(cursor); renderHead(); renderSide(); renderBody(); }
  function renderBody() {
    if (view === 'month') renderMonth();
    else if (view === 'agenda') renderAgenda();
    else renderTimeGrid(view === 'week' ? 7 : 1);
  }

  function chip(o, { compact = false } = {}) {
    const e = o.event;
    const el = h('button.cal-chip', { type: 'button', draggable: 'true', class: e.allDay ? 'allday' : '', style: { '--c': e.color || COLORS[0][0] }, title: `${e.title || '(No title)'}${e.location ? ` — ${e.location}` : ''}`,
      onclick: (ev) => { ev.stopPropagation(); editEvent(e, { occurrence: o }); },
      ondragstart: (ev) => { ev.dataTransfer.setData('application/x-donut-event', JSON.stringify({ id: e.id, start: o.start })); ev.dataTransfer.effectAllowed = 'move'; } },
    !e.allDay && !compact ? h('small', timeStr(new Date(o.start))) : null, h('span', e.title || '(No title)'), e.repeat && e.repeat !== 'none' ? h('span.cal-rep', { title: 'Repeats' }, '↻') : null);
    return el;
  }

  function dropTarget(el, dayDate, { withTime = false } = {}) {
    el.addEventListener('dragover', (ev) => { if (ev.dataTransfer.types.includes('application/x-donut-event')) { ev.preventDefault(); el.classList.add('drop'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (ev) => {
      el.classList.remove('drop');
      const raw = ev.dataTransfer.getData('application/x-donut-event');
      if (!raw) return;
      ev.preventDefault();
      const { id, start } = JSON.parse(raw);
      let target = new Date(dayDate);
      if (withTime) {
        const r = el.getBoundingClientRect();
        const mins = Math.round((((ev.clientY - r.top) / r.height) * 1440) / 15) * 15;
        target.setHours(0, mins, 0, 0);
      } else { const old = new Date(start); target.setHours(old.getHours(), old.getMinutes(), 0, 0); }
      moveEvent(id, start, +target, withTime);
    });
  }

  function moveEvent(id, occStart, newStart, timed) {
    const list = events();
    const e = list.find((x) => x.id === id);
    if (!e) return;
    const delta = newStart - occStart;
    if (!delta) return;
    const shifted = { ...e, start: e.start + delta, end: e.end + delta, allDay: timed ? false : e.allDay };
    if (timed && e.allDay) { shifted.end = shifted.start + 3600000; }
    saveEvents(list.map((x) => (x.id === id ? shifted : x)));
  }

  function renderMonth() {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = startOfWeek(first);
    const weeks = Math.ceil(((first.getDay() - firstDay() + 7) % 7 + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) / 7);
    const end = addDays(start, weeks * 7);
    const occ = occurrences(start, end);
    const today = new Date();
    const cells = Array.from({ length: weeks * 7 }, (_, i) => {
        const d = addDays(start, i);
        const next = addDays(d, 1);
        const todays = occ.filter((o) => o.start < +next && Math.max(o.end, o.start + 1) > +d);
        const cell = h('div.cal-day', { class: [d.getMonth() !== cursor.getMonth() && 'other', sameDay(d, today) && 'today'], role: 'gridcell', tabindex: '-1',
          ondblclick: () => { const s = new Date(d); s.setHours(9, 0, 0, 0); editEvent(null, { start: s }); } },
        h('button.cal-daynum', { type: 'button', 'aria-label': fmt(d, { dateStyle: 'full' }), onclick: () => { cursor = startOfDay(d); view = 'day'; store.set('view', 'day'); render(); } }, d.getDate() === 1 ? fmt(d, { month: 'short', day: 'numeric' }) : String(d.getDate())),
        h('div.cal-chips', todays.slice(0, 3).map((o) => chip(o)), todays.length > 3 ? h('button.cal-more', { type: 'button', onclick: () => { cursor = startOfDay(d); view = 'day'; render(); } }, `+${todays.length - 3} more`) : null));
        dropTarget(cell, d);
        return cell;
      });
    // Week rows (display: contents) so screen readers see a grid of days.
    mount(body, h('div.cal-month', { role: 'grid', 'aria-label': fmt(cursor, { month: 'long', year: 'numeric' }), style: { '--weeks': weeks } },
      h('div.cal-week', { role: 'row' }, weekdayNames().map((d) => h('div.cal-dow', { role: 'columnheader' }, d))),
      Array.from({ length: weeks }, (_, w) => h('div.cal-week', { role: 'row' }, cells.slice(w * 7, w * 7 + 7)))));
  }

  function renderTimeGrid(days) {
    const start = days === 7 ? startOfWeek(cursor) : startOfDay(cursor);
    const end = addDays(start, days);
    const occ = occurrences(start, end);
    const today = new Date();
    const cols = Array.from({ length: days }, (_, i) => addDays(start, i));
    const hours = h('div.cal-hours', Array.from({ length: 24 }, (_, i) => h('div.cal-hour', i ? fmt(new Date(2000, 0, 1, i), { hour: 'numeric', hour12: !h24() }) : '')));
    const grid = h('div.cal-grid', { style: { '--days': days } }, hours, cols.map((d) => {
      const col = h('div.cal-col', { class: sameDay(d, today) && 'today', onclick: (ev) => {
        if (ev.target !== col) return;
        const r = col.getBoundingClientRect();
        const mins = Math.floor((((ev.clientY - r.top) / r.height) * 1440) / 30) * 30;
        const s = new Date(d); s.setHours(0, mins, 0, 0);
        editEvent(null, { start: s });
      } });
      // Lay overlapping events side by side.
      const dayOcc = occ.filter((o) => !o.event.allDay && o.start < +addDays(d, 1) && o.end > +d).map((o) => ({ o, s: Math.max(o.start, +d), e: Math.min(Math.max(o.end, o.start + 1800000), +addDays(d, 1)) }));
      const lanes = [];
      for (const it of dayOcc) { let l = lanes.findIndex((end) => end <= it.s); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = it.e; it.lane = l; }
      for (const it of dayOcc) {
        const top = ((it.s - +d) / DAY) * 100, height = Math.max(2, ((it.e - it.s) / DAY) * 100);
        const el = chip(it.o);
        el.classList.add('timed');
        Object.assign(el.style, { top: `${top}%`, height: `${height}%`, left: `${(it.lane / lanes.length) * 100}%`, width: `${100 / lanes.length}%` });
        col.append(el);
      }
      if (sameDay(d, today)) col.append(h('div.cal-now', { style: { top: `${((Date.now() - +startOfDay(today)) / DAY) * 100}%` } }));
      dropTarget(col, d, { withTime: true });
      return col;
    }));
    const allDay = h('div.cal-allday', { style: { '--days': days } }, h('div.cal-allday-label', 'All day'), cols.map((d) => {
      const cell = h('div.cal-allday-cell', occ.filter((o) => o.event.allDay && o.start < +addDays(d, 1) && Math.max(o.end, o.start + 1) > +d).map((o) => chip(o, { compact: true })));
      dropTarget(cell, d);
      return cell;
    }));
    const headRow = h('div.cal-colheads', { style: { '--days': days } }, h('div'), cols.map((d) => h('button.cal-colhead', { type: 'button', class: sameDay(d, today) && 'today', onclick: () => { cursor = d; view = 'day'; render(); } }, h('small', fmt(d, { weekday: 'short' })), h('b', String(d.getDate())))));
    const scroller = h('div.cal-scroll', grid);
    mount(body, h('div.cal-week', headRow, allDay, scroller));
    requestAnimationFrame(() => { scroller.scrollTop = (scroller.scrollHeight * 7.5) / 24; });
  }

  function renderAgenda() {
    const start = startOfDay(cursor);
    const occ = occurrences(query ? addDays(start, -365) : start, addDays(start, query ? 730 : 60));
    const byDay = new Map();
    for (const o of occ) { const key = startOfDay(new Date(o.start)).getTime(); if (!byDay.has(key)) byDay.set(key, []); byDay.get(key).push(o); }
    mount(body, h('div.cal-agenda', byDay.size ? [...byDay].map(([day, list]) => h('section',
      h('h3', fmt(new Date(day), { weekday: 'long', month: 'long', day: 'numeric', year: new Date(day).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })),
      list.map((o) => h('button.cal-agenda-item', { type: 'button', onclick: () => editEvent(o.event, { occurrence: o }) },
        h('i', { style: { background: o.event.color || COLORS[0][0] } }),
        h('span.cal-agenda-time', o.event.allDay ? 'All day' : `${timeStr(new Date(o.start))} – ${timeStr(new Date(o.end))}`),
        h('b', o.event.title || '(No title)'), o.event.location ? h('small', o.event.location) : null))))
      : h('div.ph-empty', icon('calendar', { size: 40 }), h('b', query ? 'No events match your search' : 'Nothing planned'), h('p', 'Select New event or double-click a day to add one.'))));
  }

  // ── Event editor ─────────────────────────────────────────────────────
  const pad = (n) => String(n).padStart(2, '0');
  const dateVal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeVal = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const parse = (date, time) => { const [y, m, d] = date.split('-').map(Number); const [hh, mm] = (time || '00:00').split(':').map(Number); return new Date(y, m - 1, d, hh, mm); };

  async function editEvent(e, { start, occurrence } = {}) {
    const st = e ? new Date(occurrence?.start ?? e.start) : new Date(start);
    const en = e ? new Date((occurrence?.start ?? e.start) + (e.end - e.start)) : new Date(+st + 3600000);
    const f = {
      title: h('input.input.cal-titlein', { value: e?.title || '', placeholder: 'Add a title', 'aria-label': 'Title', maxlength: 120 }),
      allDay: h('input', { type: 'checkbox', checked: !!e?.allDay }),
      sd: h('input.input', { type: 'date', value: dateVal(st), 'aria-label': 'Start date' }),
      stime: h('input.input', { type: 'time', value: timeVal(st), 'aria-label': 'Start time' }),
      ed: h('input.input', { type: 'date', value: dateVal(e?.allDay ? new Date(+en - 1) : en), 'aria-label': 'End date' }),
      etime: h('input.input', { type: 'time', value: timeVal(en), 'aria-label': 'End time' }),
      repeat: h('select.input', { 'aria-label': 'Repeat' }, REPEATS.map(([v, l]) => h('option', { value: v, selected: (e?.repeat || 'none') === v }, l))),
      until: h('input.input', { type: 'date', value: e?.until ? dateVal(new Date(e.until)) : '', 'aria-label': 'Repeat until' }),
      reminder: h('select.input', { 'aria-label': 'Reminder' }, REMINDERS.map(([v, l]) => h('option', { value: v === null ? '' : v, selected: (e ? e.reminder ?? null : 15) === v }, l))),
      location: h('input.input', { value: e?.location || '', placeholder: 'Location', 'aria-label': 'Location', maxlength: 200 }),
      notes: h('textarea.input.cal-notes', { placeholder: 'Notes', 'aria-label': 'Notes', rows: 3 }, e?.notes || ''),
    };
    let color = e?.color || COLORS[0][0];
    const swatches = h('div.swatches', COLORS.map(([c, n]) => h('button.swatch', { type: 'button', style: { background: c }, 'aria-label': n, 'aria-pressed': String(color === c), onclick: (ev) => { color = c; swatches.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', 'false')); ev.currentTarget.setAttribute('aria-pressed', 'true'); } })));
    const timeRow = () => { f.stime.hidden = f.etime.hidden = f.allDay.checked; };
    f.allDay.onchange = timeRow; timeRow();
    const untilRow = h('label.ck-field', 'Until (optional)', f.until);
    const syncUntil = () => { untilRow.hidden = f.repeat.value === 'none'; };
    f.repeat.onchange = syncUntil; syncUntil();
    f.sd.onchange = () => { if (f.ed.value < f.sd.value) f.ed.value = f.sd.value; };
    const err = h('div.error-text');
    const buttons = [{ label: 'Save', value: 'save', primary: true, validate: () => {
      const s = f.allDay.checked ? parse(f.sd.value) : parse(f.sd.value, f.stime.value);
      const en2 = f.allDay.checked ? addDays(parse(f.ed.value), 1) : parse(f.ed.value, f.etime.value);
      if (!f.sd.value || !f.ed.value || Number.isNaN(+s) || Number.isNaN(+en2)) { err.textContent = 'Choose a start and end.'; return false; }
      if (en2 < s) { err.textContent = 'The event ends before it starts.'; return false; }
      err.textContent = '';
      return true;
    } }, { label: 'Cancel', value: null }];
    if (e) buttons.splice(1, 0, { label: 'Delete', value: 'delete', danger: true });
    const choice = await dialog({ title: e ? 'Edit event' : 'New event', width: 520, parent: win.body, cancelValue: null,
      body: h('div.cal-form', f.title,
        h('div.cal-row', h('label.wr-check', f.allDay, 'All day')),
        h('div.cal-row', h('label.ck-field', 'Starts', h('div.ck-row', f.sd, f.stime))),
        h('div.cal-row', h('label.ck-field', 'Ends', h('div.ck-row', f.ed, f.etime))),
        h('div.cal-row2', h('label.ck-field', 'Repeat', f.repeat), untilRow),
        h('label.ck-field', 'Reminder', f.reminder),
        f.location, f.notes, h('label.ck-field', 'Colour', swatches), err),
      buttons });
    if (choice === 'delete') return deleteEvent(e, occurrence);
    if (choice !== 'save') return;
    const s = f.allDay.checked ? parse(f.sd.value) : parse(f.sd.value, f.stime.value);
    const en2 = f.allDay.checked ? addDays(parse(f.ed.value), 1) : parse(f.ed.value, f.etime.value);
    const next = {
      id: e?.id || uid(), title: f.title.value.trim(), allDay: f.allDay.checked, start: +s, end: +en2,
      repeat: f.repeat.value, until: f.repeat.value !== 'none' && f.until.value ? +addDays(parse(f.until.value), 1) - 1 : null,
      reminder: f.reminder.value === '' ? null : Number(f.reminder.value), location: f.location.value.trim(), notes: f.notes.value, color,
      skip: e?.skip || [],
    };
    // Editing one occurrence of a repeating event moves the whole series by the same amount.
    if (e && occurrence && e.repeat !== 'none' && occurrence.start !== e.start) { const delta = +s - occurrence.start; next.start = e.start + delta; next.end = next.start + (+en2 - +s); }
    saveEvents(e ? events().map((x) => (x.id === e.id ? next : x)) : [...events(), next]);
  }

  async function deleteEvent(e, occurrence) {
    if (e.repeat && e.repeat !== 'none' && occurrence) {
      const which = await dialog({ title: 'Delete repeating event', parent: win.body, cancelValue: null, body: h('p', `Delete only this occurrence of “${e.title || 'event'}”, or every one?`),
        buttons: [{ label: 'This one', value: 'one', primary: true }, { label: 'All events', value: 'all', danger: true }, { label: 'Cancel', value: null }] });
      if (!which) return;
      if (which === 'one') { saveEvents(events().map((x) => (x.id === e.id ? { ...x, skip: [...(x.skip || []), occurrence.start] } : x))); return; }
    } else if (!(await confirmDialog(`Delete “${e.title || 'event'}”?`, 'This can’t be undone.', { ok: 'Delete', danger: true, parent: win.body }))) return;
    saveEvents(events().filter((x) => x.id !== e.id));
  }

  // ── Import / export ──────────────────────────────────────────────────
  async function importICS(path) {
    if (typeof path !== 'string') path = await openFileDialog(ctx, win, { title: 'Import calendar', filters: [{ label: 'iCalendar files', exts: ['.ics'] }] });
    if (!path) return;
    try {
      const parsed = parseICS(await ctx.fs.readText(path));
      if (!parsed.length) { alertDialog('Nothing to import', `${P.basename(path)} has no events.`, { parent: win.body }); return; }
      if (!(await confirmDialog(`Import ${parsed.length} event${parsed.length === 1 ? '' : 's'}?`, `From ${P.basename(path)}. Events already in your calendar aren’t duplicated.`, { ok: 'Import', parent: win.body }))) return;
      const existing = new Set(events().map((x) => x.uidICS || x.id));
      const fresh = parsed.filter((x) => !existing.has(x.uidICS)).map((x) => ({ ...x, id: uid(), color: COLORS[1][0] }));
      saveEvents([...events(), ...fresh]);
      if (fresh[0]) { cursor = startOfDay(new Date(fresh[0].start)); render(); }
    } catch (err) { alertDialog('Couldn’t import', err.message, { parent: win.body }); }
  }
  async function exportICS() {
    const path = await saveFileDialog(ctx, win, { title: 'Export calendar', filters: [{ label: 'iCalendar file', exts: ['.ics'] }], suggestedName: 'Calendar.ics' });
    if (!path) return;
    await ctx.fs.writeText(path, toICS(events()));
  }

  // ── Wiring ───────────────────────────────────────────────────────────
  ctx.own(store.watch('events', () => { renderSide(); renderBody(); }));
  ctx.own(settings.watch('time.*', () => render()));
  ctx.setInterval(() => { if (view === 'week' || view === 'day') { const now = body.querySelector('.cal-now'); if (now) now.style.top = `${((Date.now() - +startOfDay(new Date())) / DAY) * 100}%`; } }, 60000);
  ctx.listen(win.body, 'keydown', (e) => {
    if (e.target.matches('input, textarea, select') || win.body.querySelector('.dlg')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); move(1); }
    else if (e.key.toLowerCase() === 't' && !ctrl) { cursor = startOfDay(new Date()); render(); }
    else if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); editEvent(null, { start: defaultStart() }); }
    else if (ctrl && /^[1-4]$/.test(e.key)) { e.preventDefault(); view = ['day', 'week', 'month', 'agenda'][Number(e.key) - 1]; store.set('view', view); render(); }
  });

  function handleArgs(args) {
    if (args?.path && P.extname(args.path).toLowerCase() === '.ics') importICS(args.path);
    if (args?.date || args?.event) {
      const d = new Date(args.date || (events().find((x) => x.id === args.event)?.start ?? Date.now()));
      cursor = startOfDay(d); view = 'day'; render();
      const ev = events().find((x) => x.id === args.event);
      if (ev) editEvent(ev, { occurrence: { start: args.date ?? ev.start } });
    }
    if (args?.notification?.data?.service === 'reminder') handleArgs({ event: args.notification.data.id, date: args.notification.data.start });
  }
  ctx.onActivate((args) => { win.focus(); handleArgs(args); });
  render();
  handleArgs(ctx.args);
}
