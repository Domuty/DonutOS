// Notification Center (with Do Not Disturb), the calendar flyout below it, and a focus
// timer. Opening it marks notifications as read.

import { h, mount } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { relTime } from './start-menu.js';
import { formatDate } from './format.js';

export class NotificationCenter {
  constructor(session) {
    this.s = session;
    this.kernel = session.kernel;
    this.settings = session.settings;
    this.month = null;
    this.selectedDay = null;
    this.calOpen = true;
    this.f = session.flyouts.add('nc', {
      className: 'fly-nc', label: 'Notifications and calendar',
      onOpen: () => {
        const now = new Date();
        this.month = new Date(now.getFullYear(), now.getMonth(), 1);
        this.selectedDay = null;
        this.render();
        this.kernel.notifications.markAllRead();
        session.toasts?.clear();
      },
    });
    this.notifs = h('div.nc-panel.acrylic');
    this.cal = h('div.nc-panel.nc-cal.acrylic');
    mount(this.f.el, this.notifs, this.cal);
    this.offs = [
      this.kernel.bus.on('notification:*', () => { if (this.isOpen()) this.renderNotifications(); }),
      this.settings.watch('notifications.dnd', () => this.isOpen() && this.renderNotifications()),
      this.settings.watch('qs.*', () => this.isOpen() && this.renderCalendar()),
      this.settings.watch('time.*', () => this.isOpen() && this.renderCalendar()),
    ];
  }

  isOpen() { return this.s.flyouts.isOpen('nc'); }
  render() { this.renderNotifications(); this.renderCalendar(); }

  renderNotifications() {
    const list = this.kernel.notifications.list();
    const dnd = this.settings.get('notifications.dnd');
    const groups = new Map();
    for (const n of list) {
      if (!groups.has(n.appId)) groups.set(n.appId, []);
      groups.get(n.appId).push(n);
    }
    mount(this.notifs,
      h('div.nc-head', h('b', 'Notifications'),
        h('button.tb-btn', { type: 'button', title: dnd ? 'Turn off do not disturb' : 'Do not disturb', 'aria-label': 'Do not disturb', 'aria-pressed': String(dnd), class: dnd && 'on', onclick: () => this.kernel.notifications.setDnd(!dnd) }, icon(dnd ? 'moon' : 'sleep', { size: 16 })),
        list.length ? h('button.btn.small', { type: 'button', onclick: () => this.kernel.notifications.clear() }, 'Clear all') : null),
      dnd ? h('div.nc-banner', icon('moon', { size: 16 }), 'Do not disturb is on. Notifications go straight here without a pop-up.') : null,
      list.length ? h('div.nc-list', [...groups].map(([appId, items]) => h('section.nc-group',
        h('div.nc-app', h('img', { src: items[0].icon || this.kernel.registry.get(appId)?.icon || 'assets/brand/logo.svg', alt: '' }), h('span', items[0].appName || appId),
          h('button.tb-btn', { type: 'button', title: 'Clear', 'aria-label': `Clear ${items[0].appName} notifications`, onclick: () => this.kernel.notifications.clear(appId) }, icon('close', { size: 12 }))),
        items.map((n) => card(this.kernel, n))))) : h('div.nc-empty', 'No new notifications'));
  }

  renderCalendar() {
    const now = new Date();
    const first = this.settings.get('time.firstDayOfWeek');
    const m = this.month || new Date(now.getFullYear(), now.getMonth(), 1);
    const monthLabel = m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const start = new Date(m);
    start.setDate(1 - ((m.getDay() - first + 7) % 7));
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const isToday = d.toDateString() === now.toDateString();
      const sel = this.selectedDay && d.toDateString() === this.selectedDay.toDateString();
      days.push(h('button.cal-day', { type: 'button', class: [d.getMonth() !== m.getMonth() && 'other', isToday && 'today', sel && 'sel'], 'aria-label': d.toDateString(), 'aria-current': isToday ? 'date' : undefined,
        onclick: () => { this.selectedDay = d; this.renderCalendar(); } }, String(d.getDate())));
    }
    const weekdays = [...Array(7)].map((_, i) => new Date(2023, 0, 1 + ((i + first) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' }));
    const day = this.selectedDay || now;
    const events = this.eventsOn(day);
    const focus = this.settings.get('qs.focus');
    const left = Math.max(0, Math.ceil((this.settings.get('qs.focusUntil') - Date.now()) / 60000));
    const mins = this.settings.get('qs.focusMinutes');
    mount(this.cal,
      h('div.nc-head', h('b', formatDate(now, this.settings, 'full')),
        h('button.tb-btn', { type: 'button', 'aria-label': this.calOpen ? 'Collapse calendar' : 'Expand calendar', onclick: () => { this.calOpen = !this.calOpen; this.renderCalendar(); } }, icon(this.calOpen ? 'chevronDown' : 'chevronUp', { size: 16 }))),
      this.calOpen ? [
        h('div.cal-nav', h('b', monthLabel),
          h('button.tb-btn', { type: 'button', 'aria-label': 'Previous month', onclick: () => { this.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); this.renderCalendar(); } }, icon('chevronUp', { size: 16 })),
          h('button.tb-btn', { type: 'button', 'aria-label': 'Next month', onclick: () => { this.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); this.renderCalendar(); } }, icon('chevronDown', { size: 16 }))),
        h('div.cal-grid', weekdays.map((w) => h('span.cal-wd', w)), days),
        h('div.cal-agenda', h('small', day.toDateString() === now.toDateString() ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })),
          events.length ? events.map((e) => h('div.cal-ev', h('i', { style: { background: e.color || 'var(--accent)' } }), h('span', e.title), h('small', e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))))
            : h('div.hint', this.kernel.registry.has('calendar') ? 'No events' : 'No events. Events you add in Calendar appear here.')),
      ] : null,
      h('div.nc-focus',
        focus ? [h('span', `Focus: ${left} min left`), h('button.btn.small', { type: 'button', onclick: () => this.s.shell.toggleFocus() }, 'End session')]
          : [h('button.tb-btn', { type: 'button', 'aria-label': 'Fewer minutes', onclick: () => this.settings.set('qs.focusMinutes', Math.max(5, mins - 5)) }, icon('minus', { size: 14 })),
            h('span', `${mins} mins`),
            h('button.tb-btn', { type: 'button', 'aria-label': 'More minutes', onclick: () => this.settings.set('qs.focusMinutes', Math.min(240, mins + 5)) }, icon('plus', { size: 14 })),
            h('button.btn.small', { type: 'button', onclick: () => this.s.shell.toggleFocus() }, icon('sparkle', { size: 14 }), 'Focus')]));
  }

  /** Events saved by the Calendar app (app.calendar.events) for one day. */
  eventsOn(day) {
    let list = [];
    try { list = this.settings.get('app.calendar.events') || []; } catch { list = []; }
    const key = day.toDateString();
    return list.filter((e) => new Date(e.start).toDateString() === key).sort((a, b) => a.start - b.start);
  }

  destroy() { this.offs.forEach((f) => f()); }
}

export function card(kernel, n, { toast = false, onClose } = {}) {
  return h('div.nc-card', { role: 'button', tabindex: '0', 'aria-label': `${n.title}. ${n.body}`,
    onclick: (e) => { if (!e.target.closest('button')) { kernel.notifications.activate(n.id); onClose?.(); } },
    onkeydown: (e) => { if (e.key === 'Enter') { kernel.notifications.activate(n.id); onClose?.(); } } },
  toast ? h('div.nc-app', h('img', { src: n.icon || 'assets/brand/logo.svg', alt: '' }), h('span', n.appName)) : null,
  h('div.nc-title', h('b', n.title), h('small', relTime(n.time)),
    h('button.nc-x', { type: 'button', 'aria-label': toast ? 'Close' : 'Dismiss', onclick: (e) => { e.stopPropagation(); if (toast) onClose?.(); else kernel.notifications.dismiss(n.id); } }, icon('close', { size: 12 }))),
  n.body ? h('p', n.body) : null,
  n.actions.length ? h('div.nc-actions', n.actions.map((a) => h('button.btn.small', { type: 'button', onclick: (e) => { e.stopPropagation(); kernel.notifications.activate(n.id, a.id); onClose?.(); } }, a.label))) : null);
}
