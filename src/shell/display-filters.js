// Screen-wide filters that follow the active user's settings: brightness (a dimming layer)
// and night light (a warm layer). They cover everything, including the lock screen.
// DonutOS can't change the monitor's own backlight, so brightness dims the picture instead.

import { h } from '../ui/h.js';

export class DisplayFilters {
  constructor(kernel, root) {
    this.kernel = kernel;
    this.dim = h('div.filter.filter-dim', { 'aria-hidden': 'true' });
    this.warm = h('div.filter.filter-warm', { 'aria-hidden': 'true' });
    root.append(this.warm, this.dim);
    kernel.settings.watch('qs.*', () => this.apply());
    kernel.bus.on('session:changed', () => this.apply());
    this.apply();
  }

  apply() {
    const s = this.kernel.settings;
    const signedIn = !!s.currentUser;
    const brightness = signedIn ? s.get('qs.brightness') : 100;
    this.dim.style.opacity = String(((100 - brightness) / 100) * 0.85);
    const night = signedIn && s.get('qs.nightLight');
    this.warm.style.opacity = night ? String(0.15 + (s.get('qs.nightLightStrength') / 100) * 0.45) : '0';
  }
}
