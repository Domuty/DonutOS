// Clock: focus sessions, timers, alarms, stopwatch and world clock. Alarms and timers are
// kept in the user's settings and rung by the shell's scheduler, so they work with Clock
// closed. The stopwatch keeps running too (it stores when it started, not a counter).

import { h, mount, svgEl } from '../../ui/h.js';
import { icon } from '../../ui/icons.js';
import { dialog, confirmDialog } from '../../ui/dialog.js';
import { formatTime } from '../../shell/format.js';
import { toggleFocus } from '../../shell/focus.js';
import { formatDuration } from '../../shell/scheduler.js';

const PAGES = [['focus', 'Focus sessions', 'sparkle'], ['timer', 'Timer', 'restart'], ['alarm', 'Alarm', 'sun'], ['stopwatch', 'Stopwatch', 'activity'], ['world', 'World clock', 'globe']];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SOUNDS = [['alarm', 'Bells'], ['chime', 'Chimes'], ['timer', 'Beeps']];
const uid = () => Math.random().toString(36).slice(2, 10);

export default function main(ctx) {
  const k = ctx.privileged;
  const me = ctx.accounts.current();
  const s = k.settings.forUser(me.id);
  const store = ctx.storage;
  const win = ctx.windows.create({ title: 'Clock', width: 900, height: 620, minWidth: 420, minHeight: 420 });
  win.body.classList.add('clockapp');
  let page = PAGES.some(([p]) => p === ctx.args.page) ? ctx.args.page : store.get('page', 'timer');

  const nav = h('nav.ck-nav', { 'aria-label': 'Clock' });
  const content = h('div.ck-content');
  mount(win.body, nav, content);

  const get = (key, fb) => store.get(key, fb);
  const set = (key, v) => store.set(key, v);

  function go(p) { page = p; set('page', p); render(); }
  function renderNav() {
    mount(nav, PAGES.map(([id, label, ic]) => h('button.ck-navitem', { type: 'button', 'aria-current': page === id ? 'page' : undefined, onclick: () => go(id), title: label }, icon(ic, { size: 18 }), h('span', label))));
  }

  let stopTick = null;
  function render() {
    stopTick?.();
    stopTick = null;
    renderNav();
    ({ focus: renderFocus, timer: renderTimers, alarm: renderAlarms, stopwatch: renderStopwatch, world: renderWorld })[page]();
  }
  // Repaints `fn` every animation frame (stopwatch) or every second.
  function every(fn, ms = 1000) {
    let id;
    if (ms === 0) { const loop = () => { fn(); id = requestAnimationFrame(loop); }; loop(); stopTick = () => cancelAnimationFrame(id); return; }
    fn();
    id = ctx.setInterval(fn, ms);
    stopTick = () => ctx.clearInterval(id);
  }

  const two = (n) => String(n).padStart(2, '0');
  const hms = (ms, { tenths = false } = {}) => {
    const t = Math.max(0, ms);
    const hh = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), sec = Math.floor((t % 60000) / 1000);
    return `${two(hh)}:${two(m)}:${two(sec)}${tenths ? `.${two(Math.floor((t % 1000) / 10))}` : ''}`;
  };

  // ── Focus ────────────────────────────────────────────────────────────
  function renderFocus() {
    const minutes = h('input.input.ck-mins', { type: 'number', min: 5, max: 240, step: 5, value: s.get('qs.focusMinutes'), 'aria-label': 'Minutes' });
    const timeEl = h('div.ck-big');
    const ring = progressRing(220);
    const stats = get('focusStats', { today: '', minutes: 0, total: 0, sessions: 0 });
    const body = h('div.ck-focus');
    const paint = () => {
      const on = s.get('qs.focus');
      const until = s.get('qs.focusUntil');
      const total = s.get('qs.focusMinutes') * 60000;
      const left = on ? until - Date.now() : total;
      timeEl.textContent = hms(left).replace(/^00:/, '');
      ring.set(on ? 1 - left / total : 0);
      mount(body,
        h('div.ck-ringwrap', ring.el, h('div.ck-ringtext', timeEl, h('small', on ? 'Focus session in progress' : 'Ready to focus'))),
        on ? null : h('label.ck-field', 'Length (minutes)', minutes),
        h('button.btn.primary.ck-main', { type: 'button', onclick: () => {
          if (!on) { s.set('qs.focusMinutes', Math.max(5, Math.min(240, Number(minutes.value) || 30))); }
          if (on) { endingByHand = true; recordFocus(total - Math.max(0, until - Date.now())); }
          toggleFocus(s);
          endingByHand = false;
          paint();
        } }, on ? 'End session' : 'Start focus session'),
        h('div.ck-card.ck-stats', h('h3', 'Daily progress'),
          h('div.ck-statrow', h('div', h('small', 'Today'), h('b', `${stats.today === new Date().toDateString() ? stats.minutes : 0} min`)),
            h('div', h('small', 'All time'), h('b', `${Math.round(stats.total)} min`)), h('div', h('small', 'Sessions'), h('b', String(stats.sessions))))),
        h('p.hint', 'During a focus session notifications are silenced (they still collect in the notification centre). When it ends, you’ll get a notification.'));
    };
    mount(content, h('h1.ck-title', 'Focus sessions'), body);
    every(paint, 1000);
  }
  function recordFocus(ms) {
    const st = get('focusStats', { today: '', minutes: 0, total: 0, sessions: 0 });
    const today = new Date().toDateString();
    const mins = Math.round(ms / 60000);
    set('focusStats', { today, minutes: (st.today === today ? st.minutes : 0) + mins, total: st.total + mins, sessions: st.sessions + 1 });
  }
  // The shell ends a session when its time is up; count it.
  let wasFocus = s.get('qs.focus');
  let endingByHand = false;
  ctx.own(s.watch('qs.focus', (on) => { if (wasFocus && !on && !endingByHand) recordFocus(s.get('qs.focusMinutes') * 60000); wasFocus = on; }));

  function progressRing(size) {
    const r = size / 2 - 10, c = 2 * Math.PI * r, m = size / 2;
    const el = svgEl(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="ck-ring" aria-hidden="true"><circle cx="${m}" cy="${m}" r="${r}" class="ck-ring-bg"/><circle cx="${m}" cy="${m}" r="${r}" class="ck-ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c}" transform="rotate(-90 ${m} ${m})"/></svg>`);
    const fg = el.querySelector('.ck-ring-fg');
    return { el, set: (p) => fg.setAttribute('stroke-dashoffset', String(c * (1 - Math.max(0, Math.min(1, p || 0))))) };
  }

  // ── Timers ───────────────────────────────────────────────────────────
  const timers = () => s.get('app.clock.timers') || [];
  const saveTimers = (list) => s.set('app.clock.timers', list);
  if (!s.get('app.clock.timers')) saveTimers([{ id: uid(), label: '', duration: 60000, remaining: 60000, endsAt: null }, { id: uid(), label: '', duration: 3 * 60000, remaining: 3 * 60000, endsAt: null }, { id: uid(), label: '', duration: 5 * 60000, remaining: 5 * 60000, endsAt: null }, { id: uid(), label: '', duration: 10 * 60000, remaining: 10 * 60000, endsAt: null }]);

  function renderTimers() {
    const grid = h('div.ck-grid');
    const rings = new Map();
    const draw = () => {
      mount(grid, timers().map((t) => {
        const ring = progressRing(150);
        rings.set(t.id, ring);
        return h('div.ck-card.ck-timer', { dataset: { id: t.id } },
          h('div.ck-card-head', h('b', t.label || `${formatDuration(t.duration)}`),
            h('button.tb-btn', { type: 'button', 'aria-label': 'Edit timer', onclick: () => editTimer(t) }, icon('edit', { size: 14 })),
            h('button.tb-btn', { type: 'button', 'aria-label': 'Delete timer', onclick: () => saveTimers(timers().filter((x) => x.id !== t.id)) }, icon('trash', { size: 14 }))),
          h('div.ck-ringwrap.small', ring.el, h('div.ck-ringtext', h('div.ck-time'))),
          h('div.ck-btns',
            h('button.btn.primary.ck-round', { type: 'button', 'aria-label': t.endsAt ? 'Pause' : 'Start', onclick: () => toggleTimer(t.id) }, t.endsAt ? '❚❚' : '▶'),
            h('button.btn.ck-round', { type: 'button', 'aria-label': 'Reset', onclick: () => resetTimer(t.id) }, '↺')));
      }), h('button.ck-card.ck-add', { type: 'button', onclick: () => editTimer(null) }, icon('plus', { size: 28 }), 'Add new timer'));
      tick();
    };
    const tick = () => {
      for (const t of timers()) {
        const card = grid.querySelector(`[data-id="${t.id}"]`);
        if (!card) continue;
        const left = t.endsAt ? t.endsAt - Date.now() : t.remaining ?? t.duration;
        card.querySelector('.ck-time').textContent = hms(left);
        card.classList.toggle('running', !!t.endsAt);
        card.classList.toggle('done', !t.endsAt && t.finishedAt && Date.now() - t.finishedAt < 60000);
        rings.get(t.id)?.set(1 - left / t.duration);
      }
    };
    mount(content, h('h1.ck-title', 'Timer'), grid, h('p.hint', 'Timers keep running and ring even when Clock is closed.'));
    draw();
    every(tick, 250);
    const prevStop = stopTick;
    const off = s.watch('app.clock.timers', () => draw());
    stopTick = () => { prevStop(); off(); };
  }
  function toggleTimer(id) {
    saveTimers(timers().map((t) => {
      if (t.id !== id) return t;
      if (t.endsAt) return { ...t, remaining: Math.max(0, t.endsAt - Date.now()), endsAt: null };
      const remaining = t.remaining > 0 ? t.remaining : t.duration;
      return { ...t, endsAt: Date.now() + remaining, remaining, finishedAt: null };
    }));
  }
  function resetTimer(id) { saveTimers(timers().map((t) => (t.id === id ? { ...t, endsAt: null, remaining: t.duration, finishedAt: null } : t))); }
  async function editTimer(t) {
    const d = t?.duration ?? 5 * 60000;
    const num = (v, max, label) => h('input.input.ck-num', { type: 'number', min: 0, max, value: two(v), 'aria-label': label });
    const hh = num(Math.floor(d / 3600000), 23, 'Hours'), mm = num(Math.floor((d % 3600000) / 60000), 59, 'Minutes'), ss = num(Math.floor((d % 60000) / 1000), 59, 'Seconds');
    const label = h('input.input', { value: t?.label || '', placeholder: 'Timer name', 'aria-label': 'Timer name', maxlength: 40 });
    const err = h('div.error-text');
    const ok = await dialog({ title: t ? 'Edit timer' : 'Add new timer', parent: win.body, cancelValue: false,
      body: h('div.ck-form', h('div.ck-hms', hh, h('span', ':'), mm, h('span', ':'), ss), h('div.ck-hms-labels', h('small', 'hr'), h('small', 'min'), h('small', 'sec')), label, err),
      buttons: [{ label: 'Save', value: true, primary: true, validate: () => { const ms = (Number(hh.value) * 3600 + Number(mm.value) * 60 + Number(ss.value)) * 1000; err.textContent = ms > 0 ? '' : 'Set a time longer than zero'; return ms > 0; } }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    const duration = (Math.min(23, Number(hh.value) || 0) * 3600 + Math.min(59, Number(mm.value) || 0) * 60 + Math.min(59, Number(ss.value) || 0)) * 1000;
    if (t) saveTimers(timers().map((x) => (x.id === t.id ? { ...x, duration, remaining: duration, endsAt: null, label: label.value.trim() } : x)));
    else saveTimers([...timers(), { id: uid(), label: label.value.trim(), duration, remaining: duration, endsAt: null }]);
  }

  // ── Alarms ───────────────────────────────────────────────────────────
  const alarms = () => s.get('app.clock.alarms') || [];
  const saveAlarms = (list) => s.set('app.clock.alarms', list);
  if (!s.get('app.clock.alarms')) saveAlarms([{ id: uid(), time: '07:00', label: 'Good morning', days: [1, 2, 3, 4, 5], enabled: false, sound: 'alarm', snooze: 10 }]);

  function nextRing(a) {
    const zone = s.get('time.timezone');
    const now = new Date();
    // Minutes until the alarm on the user's clock.
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: !zone || zone === 'auto' ? undefined : zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(now).map((p) => [p.type, p.value]));
    const nowMin = Number(parts.hour) * 60 + Number(parts.minute);
    const today = DAYS.indexOf(parts.weekday);
    const [ah, am] = a.time.split(':').map(Number);
    const target = ah * 60 + am;
    for (let add = 0; add < 8; add++) {
      const day = (today + add) % 7;
      if (a.days?.length && !a.days.includes(day)) continue;
      const mins = add * 1440 + target - nowMin;
      if (mins > 0) return mins;
    }
    return null;
  }
  function describe(mins) {
    if (mins === null) return '';
    const d = Math.floor(mins / 1440), hh = Math.floor((mins % 1440) / 60), m = mins % 60;
    return `Rings in ${[d && `${d} day${d > 1 ? 's' : ''}`, hh && `${hh} hr`, m && `${m} min`].filter(Boolean).join(', ') || 'less than a minute'}`;
  }

  function renderAlarms() {
    const grid = h('div.ck-grid');
    const draw = () => mount(grid, alarms().map((a) => h('div.ck-card.ck-alarm', { class: !a.enabled && 'off' },
      h('div.ck-card-head', h('b.ck-alarm-time', timeLabelUser(a.time)),
        h('label.toggle', h('input', { type: 'checkbox', checked: a.enabled, 'aria-label': `Alarm ${a.label || a.time}`, onchange: (e) => saveAlarms(alarms().map((x) => (x.id === a.id ? { ...x, enabled: e.target.checked, snoozedUntil: null } : x))) }), h('span'))),
      h('div.ck-alarm-sub', a.enabled ? describe(nextRing(a)) : 'Off', a.snoozedUntil ? ` · snoozed until ${formatTime(new Date(a.snoozedUntil), s)}` : ''),
      h('div', icon('sun', { size: 14 }), ' ', a.label || 'Alarm'),
      h('div.ck-days', DAYS.map((d, i) => h('span', { class: (a.days || []).includes(i) && 'on' }, d[0]))),
      h('div.ck-btns', h('button.btn.subtle', { type: 'button', onclick: () => editAlarm(a) }, icon('edit', { size: 14 }), 'Edit'),
        h('button.btn.subtle', { type: 'button', onclick: async () => { if (await confirmDialog('Delete alarm?', a.label || timeLabelUser(a.time), { ok: 'Delete', danger: true, parent: win.body })) saveAlarms(alarms().filter((x) => x.id !== a.id)); } }, icon('trash', { size: 14 }), 'Delete')))),
    h('button.ck-card.ck-add', { type: 'button', onclick: () => editAlarm(null) }, icon('plus', { size: 28 }), 'Add an alarm'));
    mount(content, h('h1.ck-title', 'Alarm'), grid, h('p.hint', 'Alarms ring while you’re signed in, even if Clock is closed or the screen is locked. They can’t wake a computer that’s asleep or off.'));
    draw();
    every(draw, 30000);
    const prevStop = stopTick;
    const off = s.watch('app.clock.alarms', draw);
    stopTick = () => { prevStop(); off(); };
  }
  const timeLabelUser = (hhmm) => { const [hh, mm] = hhmm.split(':').map(Number); const d = new Date(2000, 0, 1, hh, mm); return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: !s.get('time.format24h') }).format(d); };

  async function editAlarm(a) {
    const time = h('input.input.ck-timein', { type: 'time', value: a?.time || '07:00', 'aria-label': 'Alarm time', required: true });
    const label = h('input.input', { value: a?.label || '', placeholder: 'Alarm name', maxlength: 40, 'aria-label': 'Alarm name' });
    const days = new Set(a?.days || []);
    const dayRow = h('div.ck-daypick', DAYS.map((d, i) => h('button.ck-day', { type: 'button', 'aria-pressed': String(days.has(i)), 'aria-label': d, onclick: (e) => { if (days.has(i)) days.delete(i); else days.add(i); e.currentTarget.setAttribute('aria-pressed', String(days.has(i))); } }, d.slice(0, 2))));
    const sound = h('select.input', { 'aria-label': 'Sound' }, SOUNDS.map(([v, l]) => h('option', { value: v, selected: (a?.sound || 'alarm') === v }, l)));
    const snooze = h('select.input', { 'aria-label': 'Snooze time' }, [5, 10, 15, 20, 30].map((m) => h('option', { value: m, selected: (a?.snooze || 10) === m }, `${m} minutes`)));
    const preview = h('button.btn.subtle', { type: 'button', onclick: () => import('../../shell/sounds.js').then(({ playSound }) => playSound(sound.value, s, { alarm: true })) }, '▶ Preview');
    const ok = await dialog({ title: a ? 'Edit alarm' : 'Add new alarm', parent: win.body, cancelValue: false,
      body: h('div.ck-form', time, label, h('label.ck-field', 'Repeat', dayRow), h('label.ck-field', 'Sound', h('div.ck-row', sound, preview)), h('label.ck-field', 'Snooze', snooze)),
      buttons: [{ label: 'Save', value: true, primary: true, validate: () => /^\d\d:\d\d$/.test(time.value) }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    const next = { id: a?.id || uid(), time: time.value, label: label.value.trim(), days: [...days].sort(), enabled: true, sound: sound.value, snooze: Number(snooze.value), lastFired: null, snoozedUntil: null };
    saveAlarms(a ? alarms().map((x) => (x.id === a.id ? next : x)) : [...alarms(), next]);
  }

  // ── Stopwatch ────────────────────────────────────────────────────────
  // { startedAt: ms | null, elapsed: ms (before startedAt), laps: [ms total at lap] }
  const sw = () => get('stopwatch', { startedAt: null, elapsed: 0, laps: [] });
  const total = (st) => st.elapsed + (st.startedAt ? Date.now() - st.startedAt : 0);
  function renderStopwatch() {
    const time = h('div.ck-sw');
    const laps = h('div.ck-laps');
    const btns = h('div.ck-btns.big');
    const draw = () => {
      const st = sw();
      mount(btns,
        h('button.btn.primary.ck-round.big', { type: 'button', 'aria-label': st.startedAt ? 'Pause' : 'Start', title: 'Start / pause (Space)', onclick: () => swToggle() }, st.startedAt ? '❚❚' : '▶'),
        h('button.btn.ck-round.big', { type: 'button', 'aria-label': 'Lap', title: 'Lap (L)', disabled: !st.startedAt, onclick: swLap }, '⚑'),
        h('button.btn.ck-round.big', { type: 'button', 'aria-label': 'Reset', title: 'Reset (R)', disabled: !st.startedAt && !st.elapsed, onclick: swReset }, '↺'));
      const list = st.laps.map((t, i) => ({ n: i + 1, split: t - (st.laps[i - 1] || 0), total: t }));
      const splits = list.map((l) => l.split);
      const best = Math.min(...splits), worst = Math.max(...splits);
      mount(laps, list.length ? h('table.ck-laptable', h('thead', h('tr', h('th', 'Lap'), h('th', 'Time'), h('th', 'Total'))),
        h('tbody', [...list].reverse().map((l) => h('tr', { class: list.length > 2 && (l.split === best ? 'best' : l.split === worst ? 'worst' : '') }, h('td', String(l.n)), h('td', hms(l.split, { tenths: true })), h('td', hms(l.total, { tenths: true })))))) : null);
    };
    mount(content, h('h1.ck-title', 'Stopwatch'), h('div.ck-swwrap', time, h('div.ck-swlabels', h('small', 'hr'), h('small', 'min'), h('small', 'sec')), btns, laps));
    draw();
    every(() => { time.textContent = hms(total(sw()), { tenths: true }); }, 0);
    swRedraw = draw;
  }
  let swRedraw = () => {};
  function swToggle() { const st = sw(); set('stopwatch', st.startedAt ? { ...st, elapsed: total(st), startedAt: null } : { ...st, startedAt: Date.now() }); swRedraw(); }
  function swLap() { const st = sw(); if (st.startedAt) { set('stopwatch', { ...st, laps: [...st.laps, total(st)] }); swRedraw(); } }
  function swReset() { set('stopwatch', { startedAt: null, elapsed: 0, laps: [] }); swRedraw(); }

  // ── World clock ──────────────────────────────────────────────────────
  function renderWorld() {
    const grid = h('div.ck-grid');
    const zoneName = (z) => z.split('/').pop().replace(/_/g, ' ');
    const draw = () => {
      const now = new Date();
      const localZone = s.get('time.timezone') === 'auto' ? Intl.DateTimeFormat().resolvedOptions().timeZone : s.get('time.timezone');
      const offset = (z) => {
        const parts = (tz) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(now).map((p) => [p.type, Number(p.value)]));
        const a = parts(z), b = parts(localZone);
        return (Date.UTC(a.year, a.month - 1, a.day, a.hour, a.minute) - Date.UTC(b.year, b.month - 1, b.day, b.hour, b.minute)) / 60000;
      };
      const rel = (mins) => {
        if (mins === 0) return 'Same time as you';
        const hh = Math.floor(Math.abs(mins) / 60), m = Math.abs(mins) % 60;
        return `${hh ? `${hh} hr` : ''}${m ? ` ${m} min` : ''} ${mins > 0 ? 'ahead' : 'behind'}`.trim();
      };
      const card = (z, local) => {
        const t = new Intl.DateTimeFormat(undefined, { timeZone: z, hour: 'numeric', minute: '2-digit', hour12: !s.get('time.format24h') }).format(now);
        const d = new Intl.DateTimeFormat(undefined, { timeZone: z, weekday: 'short', month: 'short', day: 'numeric' }).format(now);
        const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: z, hour: 'numeric', hourCycle: 'h23' }).format(now));
        return h('div.ck-card.ck-world', { class: hour >= 7 && hour < 19 ? 'day' : 'night' },
          h('div.ck-card-head', h('b', local ? `${zoneName(z)} (you)` : zoneName(z)), local ? null : h('button.tb-btn', { type: 'button', 'aria-label': `Remove ${zoneName(z)}`, onclick: () => s.set('time.worldClocks', s.get('time.worldClocks').filter((x) => x !== z)) }, icon('close', { size: 14 }))),
          h('div.ck-world-time', t), h('small', `${d} · ${local ? 'Local time' : rel(offset(z))}`));
      };
      mount(grid, card(localZone, true), s.get('time.worldClocks').map((z) => card(z, false)),
        h('button.ck-card.ck-add', { type: 'button', onclick: addCity }, icon('plus', { size: 28 }), 'Add a city'));
    };
    mount(content, h('h1.ck-title', 'World clock'), grid);
    every(draw, 15000);
    const prevStop = stopTick;
    const off = s.watch('time.worldClocks', draw);
    stopTick = () => { prevStop(); off(); };
  }
  async function addCity() {
    const zones = (Intl.supportedValuesOf?.('timeZone') || []).filter((z) => z.includes('/'));
    const input = h('input.input', { placeholder: 'Search for a city', 'aria-label': 'City', list: 'ck-zones', autocomplete: 'off' });
    const listEl = h('datalist#ck-zones', zones.map((z) => h('option', { value: z.split('/').pop().replace(/_/g, ' ') }, z)));
    const err = h('div.error-text');
    const find = () => { const q = input.value.trim().toLowerCase(); return zones.find((z) => z.split('/').pop().replace(/_/g, ' ').toLowerCase() === q) || zones.find((z) => z.toLowerCase().includes(q.replace(/ /g, '_'))); };
    const ok = await dialog({ title: 'Add a city', parent: win.body, cancelValue: false, body: h('div.ck-form', input, listEl, err),
      buttons: [{ label: 'Add', value: true, primary: true, validate: () => { const z = find(); err.textContent = z ? '' : 'No time zone matches that city'; return !!z; } }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    const z = find();
    if (!s.get('time.worldClocks').includes(z)) s.set('time.worldClocks', [...s.get('time.worldClocks'), z]);
  }

  ctx.listen(win.body, 'keydown', (e) => {
    if (page !== 'stopwatch' || e.target.matches('input, select, textarea, button')) return;
    if (e.key === ' ') { e.preventDefault(); swToggle(); } else if (e.key.toLowerCase() === 'l') swLap(); else if (e.key.toLowerCase() === 'r') swReset();
  });
  ctx.onActivate((args) => { win.focus(); if (args?.page) go(args.page); });
  ctx.onExit(() => stopTick?.());
  render();
}
