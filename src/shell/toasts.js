// Pop-up notifications (toasts) in the bottom-right corner.

import { h, settle } from '../ui/h.js';
import { card } from './notification-center.js';
import { playSound } from './sounds.js';

const MAX = 3;
const SHOW_MS = 6000;

export class Toasts {
  constructor(session) {
    this.s = session;
    this.kernel = session.kernel;
    this.el = h('div.toasts', { role: 'region', 'aria-label': 'Notifications', 'aria-live': 'polite' });
    session.el.append(this.el);
    this.off = this.kernel.bus.on('notification:posted', (n) => this.show(n));
  }

  show(n) {
    if (n.uid !== this.s.uid || n.silent) return;
    if (this.s.flyouts.isOpen('nc')) return; // already visible in the Center
    if (this.s.settings.get('notifications.sounds')) playSound('notify', this.s.settings);
    let timer;
    const close = async () => {
      clearTimeout(timer);
      if (!t.isConnected) return;
      t.classList.add('out');
      await settle(t, 300);
      t.remove();
    };
    const t = h('div.toast.acrylic', { onpointerenter: () => clearTimeout(timer), onpointerleave: () => { timer = setTimeout(close, 2500); } },
      card(this.kernel, n, { toast: true, onClose: close }));
    this.el.append(t);
    while (this.el.children.length > MAX) this.el.firstElementChild.remove();
    timer = setTimeout(close, SHOW_MS);
  }

  /** Hides every toast (they stay in the Notification Center). */
  clear() { this.el.replaceChildren(); }

  destroy() { this.off(); this.el.remove(); }
}
