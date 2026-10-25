// Notification service. Apps post notifications through ctx.notify(); the shell's toast
// layer and Notification Center (phase 3) subscribe to the bus events emitted here.
// History is stored per user so the Notification Center survives a restart.

import { uid } from './util.js';

const MAX_HISTORY = 100;

export class NotificationService {
  #settings; #bus;

  constructor({ settings, bus }) {
    this.#settings = settings;
    this.#bus = bus;
  }

  /**
   * Posts a notification. Returns the stored notification, or null when suppressed
   * because notifications are off for the user or the app.
   * Do Not Disturb / Focus still stores it in the Center but marks it silent (no toast).
   */
  post({ appId, appName, icon, title, body = '', actions = [], data = null, urgent = false }) {
    if (!this.#settings.currentUser) return null;
    if (!this.#settings.get('notifications.enabled')) return null;
    const perApp = this.#settings.get('notifications.perApp');
    if (perApp[appId] === false) return null;
    const quiet = this.#settings.get('notifications.dnd') || this.#settings.get('qs.focus');
    const n = {
      id: uid('n'), appId, appName, icon: icon || null,
      title: String(title || appName || 'Notification'), body: String(body),
      actions: actions.map((a) => ({ id: String(a.id), label: String(a.label) })),
      data, time: Date.now(), read: false, silent: quiet && !urgent,
    };
    const history = [n, ...this.#settings.get('notifications.history')].slice(0, MAX_HISTORY);
    this.#settings.set('notifications.history', history);
    this.#bus.emit('notification:posted', n);
    return n;
  }

  list() { return this.#settings.currentUser ? this.#settings.get('notifications.history') : []; }

  unreadCount() { return this.list().filter((n) => !n.read).length; }

  markAllRead() {
    if (!this.#settings.currentUser) return;
    this.#settings.set('notifications.history', this.list().map((n) => ({ ...n, read: true })));
    this.#bus.emit('notification:changed', {});
  }

  dismiss(id) {
    this.#settings.set('notifications.history', this.list().filter((n) => n.id !== id));
    this.#bus.emit('notification:dismissed', { id });
  }

  clear(appId) {
    this.#settings.set('notifications.history', appId ? this.list().filter((n) => n.appId !== appId) : []);
    this.#bus.emit('notification:cleared', { appId: appId || null });
  }

  /** Called by the shell when the user clicks a notification or one of its buttons. */
  activate(id, actionId = null) {
    const n = this.list().find((x) => x.id === id);
    if (!n) return;
    this.#bus.emit('notification:activated', { ...n, actionId });
    this.#settings.set('notifications.history', this.list().map((x) => (x.id === id ? { ...x, read: true } : x)));
  }

  setDnd(on) { this.#settings.set('notifications.dnd', !!on); }
}
