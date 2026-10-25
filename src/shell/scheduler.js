// Background scheduler for one signed-in user: Clock alarms and timers, and Calendar
// reminders. It runs in the shell (not in the apps), so alarms ring and reminders appear
// even when Clock and Calendar are closed. Snooze/Dismiss are answered here.

import { playSound } from './sounds.js';
import { formatTime as fmtTime } from './format.js';
import { occurrencesBetween } from '../apps/calendar/recur.js';

const TICK_MS = 1000;
const RING_MS = 2200;
const RING_FOR_MS = 5 * 60 * 1000;

export class Scheduler {
  constructor(kernel, uid) {
    this.k = kernel;
    this.uid = uid;
    this.s = kernel.settings.forUser(uid);
    this.ringing = new Map(); // notification id -> { timer, kind, ref }
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.offAction = kernel.bus.on('notification:activated', (n) => this.onActivated(n));
    this.offDismiss = kernel.bus.on('notification:dismissed', ({ id }) => this.stopRinging(id));
    this.tick();
  }

  destroy() {
    clearInterval(this.timer);
    this.offAction(); this.offDismiss();
    for (const id of [...this.ringing.keys()]) this.stopRinging(id);
  }

  get(key) { return this.k.settings.isLoaded(this.uid) ? this.s.get(key) ?? null : null; }
  set(key, v) { if (this.k.settings.isLoaded(this.uid)) this.s.set(key, v); }

  tick() {
    if (!this.k.settings.isLoaded(this.uid)) return;
    const now = new Date();
    this.checkAlarms(now);
    this.checkTimers(now);
    this.checkReminders(now);
  }

  // ── Alarms ───────────────────────────────────────────────────────────
  checkAlarms(now) {
    const alarms = this.get('app.clock.alarms');
    if (!Array.isArray(alarms) || !alarms.length) return;
    const { hhmm, day, date } = wallClock(now, this.s);
    const stamp = `${date} ${hhmm}`;
    let changed = false;
    const next = alarms.map((a) => {
      if (a.snoozedUntil && a.snoozedUntil <= now.getTime()) {
        changed = true;
        this.ringAlarm(a);
        return { ...a, snoozedUntil: null };
      }
      if (!a.enabled || a.time !== hhmm || a.lastFired === stamp) return a;
      const days = a.days || [];
      if (days.length && !days.includes(day)) return a;
      changed = true;
      this.ringAlarm(a);
      return { ...a, lastFired: stamp, enabled: days.length ? a.enabled : false };
    });
    if (changed) this.set('app.clock.alarms', next);
  }

  ringAlarm(a) {
    const n = this.k.notifications.post({
      appId: 'clock', appName: 'Clock', icon: this.k.registry.get('clock')?.icon, uid: this.uid, urgent: true,
      title: a.label || 'Alarm', body: `${formatTime(a.time, this.s)}${a.snoozedUntil ? ' (snoozed)' : ''}`,
      actions: [{ id: 'snooze', label: `Snooze ${a.snooze || 10} min` }, { id: 'dismiss', label: 'Dismiss' }],
      data: { service: 'alarm', id: a.id },
    });
    if (n) this.startRinging(n.id, 'alarm', a.sound || 'alarm');
  }

  // ── Timers ───────────────────────────────────────────────────────────
  checkTimers(now) {
    const timers = this.get('app.clock.timers');
    if (!Array.isArray(timers) || !timers.length) return;
    let changed = false;
    const next = timers.map((t) => {
      if (!t.endsAt || t.endsAt > now.getTime()) return t;
      changed = true;
      const n = this.k.notifications.post({
        appId: 'clock', appName: 'Clock', icon: this.k.registry.get('clock')?.icon, uid: this.uid, urgent: true,
        title: `${t.label || 'Timer'} is done`, body: formatDuration(t.duration),
        actions: [{ id: 'restart', label: 'Restart' }, { id: 'dismiss', label: 'Dismiss' }],
        data: { service: 'timer', id: t.id },
      });
      if (n) this.startRinging(n.id, 'timer', 'timer');
      return { ...t, endsAt: null, remaining: t.duration, finishedAt: now.getTime() };
    });
    if (changed) this.set('app.clock.timers', next);
  }

  // ── Calendar reminders ───────────────────────────────────────────────
  checkReminders(now) {
    const events = this.get('app.calendar.events');
    if (!Array.isArray(events) || !events.length) return;
    const t = now.getTime();
    const reminded = this.get('app.calendar.reminded') || {};
    let changed = false;
    for (const ev of events) {
      if (ev.reminder === null || ev.reminder === undefined) continue;
      const lead = ev.reminder * 60000;
      // Occurrences starting within the reminder window (look back a minute to catch up after sleep).
      for (const occ of occurrencesBetween(ev, new Date(t - 60000 + lead - 60000), new Date(t + lead + 1000))) {
        const key = `${ev.id}@${occ.start}`;
        if (reminded[key] || occ.start - lead > t) continue;
        reminded[key] = t;
        changed = true;
        const start = new Date(occ.start);
        const when = ev.allDay ? 'Today' : fmtTime(start, this.s);
        const n = this.k.notifications.post({
          appId: 'calendar', appName: 'Calendar', icon: this.k.registry.get('calendar')?.icon, uid: this.uid,
          title: ev.title || 'Event', body: `${when}${ev.location ? ` · ${ev.location}` : ''}${ev.reminder ? ` · in ${ev.reminder} min` : ''}`,
          actions: [{ id: 'snooze', label: 'Remind me in 5 min' }, { id: 'open', label: 'Open' }],
          data: { service: 'reminder', id: ev.id, start: occ.start },
        });
        if (n) playSound('reminder', this.s, { alarm: true });
      }
    }
    if (changed) {
      // Forget reminders older than a week.
      for (const [key, at] of Object.entries(reminded)) if (at < t - 7 * 86400000) delete reminded[key];
      this.set('app.calendar.reminded', { ...reminded });
    }
  }

  // ── Ringing & actions ────────────────────────────────────────────────
  startRinging(nid, kind, sound) {
    const started = Date.now();
    const ring = () => {
      if (Date.now() - started > RING_FOR_MS) { this.stopRinging(nid); return; }
      playSound(sound, this.s, { alarm: true });
    };
    ring();
    this.ringing.set(nid, { timer: setInterval(ring, RING_MS), kind });
  }

  stopRinging(nid) {
    const r = this.ringing.get(nid);
    if (!r) return;
    clearInterval(r.timer);
    this.ringing.delete(nid);
  }

  onActivated(n) {
    if (n.uid !== this.uid || !n.data?.service) return;
    this.stopRinging(n.id);
    const { service, id } = n.data;
    if (service === 'alarm' && n.actionId === 'snooze') {
      const alarms = this.get('app.clock.alarms') || [];
      this.set('app.clock.alarms', alarms.map((a) => (a.id === id ? { ...a, snoozedUntil: Date.now() + (a.snooze || 10) * 60000 } : a)));
    } else if (service === 'timer' && n.actionId === 'restart') {
      const timers = this.get('app.clock.timers') || [];
      this.set('app.clock.timers', timers.map((t) => (t.id === id ? { ...t, endsAt: Date.now() + t.duration, remaining: t.duration } : t)));
    } else if (service === 'reminder' && n.actionId === 'snooze') {
      const events = this.get('app.calendar.events') || [];
      const ev = events.find((e) => e.id === id);
      if (ev) setTimeout(() => this.k.notifications.post({ appId: 'calendar', appName: 'Calendar', icon: this.k.registry.get('calendar')?.icon, uid: this.uid, title: ev.title || 'Event', body: 'Reminder', data: { service: 'reminder', id, start: n.data.start }, actions: [{ id: 'open', label: 'Open' }] }), 5 * 60000);
    } else if (service === 'reminder' || (!n.actionId && service)) {
      // Clicking the notification (or "Open") opens the app at the item.
      const appId = service === 'reminder' ? 'calendar' : 'clock';
      this.k.launch(appId, service === 'reminder' ? { event: id, date: n.data.start } : { page: service === 'timer' ? 'timer' : 'alarm' }, { user: this.uid }).catch(() => {});
    }
    if (n.id) this.k.notifications.dismiss?.(n.id);
  }
}

function formatTime(hhmm, s) {
  const [hh, mm] = hhmm.split(':').map(Number);
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  return fmtTime(d, s);
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [hh && `${hh} hr`, m && `${m} min`, sec && `${sec} sec`].filter(Boolean).join(' ') || '0 sec';
}

/** The time on the user's clock (their Time & language time zone), for matching alarms. */
export function wallClock(date, s) {
  const zone = s.get('time.timezone');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: !zone || zone === 'auto' ? undefined : zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { hhmm: `${parts.hour}:${parts.minute}`, day, date: `${parts.year}-${parts.month}-${parts.day}` };
}
