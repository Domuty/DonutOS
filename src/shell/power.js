// Power actions with their screens: sleep, shut down, restart, sign out.

import { h, settle } from '../ui/h.js';
import { icon } from '../ui/icons.js';
import { confirmDialog } from '../ui/dialog.js';
import { spinner } from './boot-screen.js';
import { playSound } from './sounds.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export function busyScreen(layer, text) {
  const el = h('div.screen.power-screen', { role: 'status', 'aria-live': 'assertive' }, spinner(), h('p', text));
  layer.append(el);
  return el;
}

export class Power {
  constructor(shell) { this.shell = shell; this.kernel = shell.kernel; }

  /** Warns when other people are still signed in. Resolves false if the user backs out. */
  async #confirmOthers(action) {
    const active = this.kernel.session.user?.id;
    const others = [...this.kernel.sessions.values()].filter((s) => s.user.id !== active);
    if (!others.length) return true;
    return confirmDialog(`${action}?`, `${others.map((s) => s.user.name).join(', ')} ${others.length === 1 ? 'is' : 'are'} still signed in. If you ${action.toLowerCase()} now, their open apps will close and unsaved work may be lost.`, { ok: `${action} anyway` });
  }

  async shutdown() {
    if (!(await this.#confirmOthers('Shut down'))) return;
    const settings = this.kernel.settings.currentUser ? this.kernel.settings : null;
    const screen = busyScreen(this.shell.overlay, 'Shutting down');
    if (this.kernel.settings.get('sound.startup')) playSound('shutdown', settings);
    await Promise.all([pause(1400), this.kernel.prepareForPowerOff()]);
    const closed = await this.kernel.platform.power.shutdown();
    if (closed) return;
    // The browser wouldn't let the page close itself: show a powered-off screen.
    screen.remove();
    this.shell.clearAll();
    const off = h('div.screen.off-screen',
      h('p', 'DonutOS has shut down. You can close this tab.'),
      h('button', { 'aria-label': 'Start DonutOS', title: 'Start DonutOS', onclick: () => location.reload() }, icon('power', { size: 28 })));
    this.shell.overlay.append(off);
  }

  async restart() {
    if (!(await this.#confirmOthers('Restart'))) return;
    busyScreen(this.shell.overlay, 'Restarting');
    await Promise.all([pause(1400), this.kernel.prepareForPowerOff()]);
    await this.kernel.platform.power.restart();
  }

  /** Screen goes black; any input wakes it to the lock screen. */
  async sleep() {
    const el = h('div.screen.sleep-screen', { 'aria-label': 'Sleeping. Press any key to wake.' });
    this.shell.overlay.append(el);
    requestAnimationFrame(() => el.classList.add('on'));
    await settle(el, 900);
    if (this.kernel.session.user) this.shell.lock({ animate: false });
    await this.kernel.settings.flush();
    await pause(400); // ignore the click that chose "Sleep"
    await new Promise((resolve) => {
      const wake = () => {
        for (const t of ['keydown', 'pointerdown', 'pointermove', 'wheel']) document.removeEventListener(t, wake, true);
        resolve();
      };
      for (const t of ['keydown', 'pointerdown', 'pointermove', 'wheel']) document.addEventListener(t, wake, true);
    });
    el.classList.remove('on');
    await settle(el, 900);
    el.remove();
  }

  async signOut() {
    const user = this.kernel.session.user;
    if (!user) return;
    const screen = busyScreen(this.shell.overlay, 'Signing out');
    await Promise.all([pause(900), this.shell.endSession(user.id)]);
    screen.classList.add('out');
    await this.shell.showLock({ animateIn: false });
    screen.remove();
  }
}
