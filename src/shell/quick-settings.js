// Quick Settings: Wi-Fi, Bluetooth, airplane mode, dark mode, night light, focus;
// brightness and volume; battery. Every control is a real user setting.
//
// Wi-Fi off / airplane mode take DonutOS offline (apps lose the "network" permission and
// the weather stops updating) — a browser or app can't switch the computer's radio.
// Bluetooth on/off controls whether DonutOS apps may use Bluetooth devices.

import { h, mount } from '../ui/h.js';
import { icon, batteryIcon } from '../ui/icons.js';
import { launchApp } from './apps.js';

export class QuickSettings {
  constructor(session) {
    this.s = session;
    this.kernel = session.kernel;
    this.settings = session.settings;
    this.detail = null;
    this.btAvailable = null;
    this.f = session.flyouts.add('qs', { className: 'fly-qs', label: 'Quick settings', onOpen: () => { this.detail = null; this.render(); } });
    this.offs = [this.settings.watch('qs.*', () => this.isOpen() && this.render()), this.settings.watch('appearance.theme', () => this.isOpen() && this.render())];
    navigator.bluetooth?.getAvailability?.().then((a) => { this.btAvailable = a; }).catch(() => { this.btAvailable = false; });
  }

  isOpen() { return this.s.flyouts.isOpen('qs'); }

  tile({ label, sub, ic, on, onClick, onMore, disabled }) {
    return h('div.qs-tile', { class: [on && 'on', disabled && 'disabled'] },
      h('button.qs-main', { type: 'button', 'aria-pressed': String(!!on), disabled, onclick: onClick, title: label }, ic),
      onMore ? h('button.qs-more', { type: 'button', 'aria-label': `${label} settings`, onclick: onMore, disabled }, icon('chevronRight', { size: 14 })) : null,
      h('div.qs-label', h('span', label), sub ? h('small', sub) : null));
  }

  async render() {
    const s = this.settings;
    const [net, bat] = await Promise.all([this.kernel.platform.system.network(), this.kernel.platform.system.battery()]);
    if (this.detail === 'network') return this.renderNetwork(net);
    const air = s.get('qs.airplane');
    const wifi = s.get('qs.wifi') && !air;
    const bt = s.get('qs.bluetooth') && !air;
    const dark = this.s.shell.resolvedTheme() === 'dark';
    const focus = s.get('qs.focus');
    const left = focus ? Math.max(0, Math.ceil((s.get('qs.focusUntil') - Date.now()) / 60000)) : 0;
    const realBattery = bat.supported && !(bat.charging && bat.level === 1 && bat.chargingTime === 0);
    const tiles = [
      this.tile({ label: net.type === 'ethernet' ? 'Network' : 'Wi-Fi', sub: air ? 'Airplane mode' : !wifi ? 'Off' : net.online ? (net.type === 'ethernet' ? 'Ethernet' : net.type === 'wifi' ? 'Connected' : 'Online') : 'No internet', ic: icon(wifi ? (net.type === 'ethernet' ? 'ethernet' : 'wifi') : 'wifiOff', { size: 18 }), on: wifi,
        onClick: () => { if (air) s.set('qs.airplane', false); s.set('qs.wifi', !wifi || air); }, onMore: () => { this.detail = 'network'; this.render(); } }),
      this.tile({ label: 'Bluetooth', sub: this.btAvailable === false ? 'Not available' : bt ? 'On' : 'Off', ic: btIcon(), on: bt, disabled: this.btAvailable === false,
        onClick: () => { if (air) s.set('qs.airplane', false); s.set('qs.bluetooth', !bt); } }),
      this.tile({ label: 'Airplane mode', ic: planeIcon(), on: air, onClick: () => s.set('qs.airplane', !air) }),
      this.tile({ label: 'Dark mode', ic: icon('moon', { size: 18 }), on: dark, onClick: () => s.set('appearance.theme', dark ? 'light' : 'dark') }),
      this.tile({ label: 'Night light', ic: icon('sun', { size: 18 }), on: s.get('qs.nightLight'), onClick: () => s.set('qs.nightLight', !s.get('qs.nightLight')), onMore: () => { this.s.flyouts.close(); launchApp(this.kernel, 'settings', { page: 'display' }); } }),
      this.tile({ label: 'Focus', sub: focus ? `${left} min left` : `${s.get('qs.focusMinutes')} min`, ic: focusIcon(), on: focus, onClick: () => this.s.shell.toggleFocus() }),
    ];
    const bright = s.get('qs.brightness');
    const vol = s.get('qs.volume');
    const muted = s.get('qs.muted');
    const slider = (key, value, min, label) => h('input.slider', { type: 'range', min, max: 100, value, 'aria-label': label, style: { '--p': `${((value - min) / (100 - min)) * 100}%` },
      oninput: (e) => { e.target.style.setProperty('--p', `${((e.target.value - min) / (100 - min)) * 100}%`); s.set(key, Number(e.target.value)); if (key === 'qs.volume' && muted) s.set('qs.muted', false); } });
    mount(this.f.el,
      h('div.qs-grid', tiles),
      h('div.qs-slider', h('span.qs-sl-ic', icon('sun', { size: 18 })), slider('qs.brightness', bright, 20, 'Brightness')),
      h('div.qs-slider', h('button.qs-sl-ic', { type: 'button', 'aria-label': muted ? 'Unmute' : 'Mute', title: muted ? 'Unmute' : 'Mute', onclick: () => s.set('qs.muted', !muted) }, icon(muted ? 'mute' : 'volume', { size: 18 })), slider('qs.volume', muted ? 0 : vol, 0, 'Volume')),
      h('div.qs-foot',
        realBattery ? h('span.qs-bat', batteryIcon(bat.level, bat.charging, { size: 18 }), `${Math.round(bat.level * 100)}%${bat.charging ? ' · charging' : ''}`) : h('span'),
        h('button.tb-btn', { type: 'button', title: 'All settings', 'aria-label': 'All settings', onclick: () => { this.s.flyouts.close(); launchApp(this.kernel, 'settings', { page: 'system' }); } }, icon('settings', { size: 18 }))));
  }

  renderNetwork(net) {
    const s = this.settings;
    const wifi = s.get('qs.wifi') && !s.get('qs.airplane');
    mount(this.f.el,
      h('div.qs-detail-head', h('button.tb-btn', { type: 'button', 'aria-label': 'Back', onclick: () => { this.detail = null; this.render(); } }, icon('arrowLeft', { size: 16 })), h('b', 'Network'),
        h('label.toggle', { style: { marginLeft: 'auto' } }, h('input', { type: 'checkbox', checked: wifi, 'aria-label': 'DonutOS network access', onchange: (e) => { s.set('qs.airplane', false); s.set('qs.wifi', e.target.checked); this.render(); } }), h('span'))),
      h('div.qs-net',
        h('div.row', icon(net.online ? 'globe' : 'wifiOff'), h('div.grow', h('div.t', net.online ? 'Connected to the internet' : 'No internet connection'),
          h('div.d', [net.type !== 'unknown' ? (net.type === 'wifi' ? 'Wi-Fi' : net.type === 'ethernet' ? 'Ethernet' : net.type) : null, net.effectiveType ? `${net.effectiveType.toUpperCase()} speed` : null, net.downlinkMbps ? `~${net.downlinkMbps} Mbps` : null].filter(Boolean).join(' · ') || 'Connection details aren’t reported by this device'))),
        net.interfaces.map((i) => h('div.row', icon(i.type === 'wifi' ? 'wifi' : i.type === 'ethernet' ? 'ethernet' : 'globe'), h('div.grow', h('div.t', i.name), h('div.d', `${i.type} · ${i.address}`)))),
        h('p.hint', { style: { margin: '8px 4px 0', lineHeight: 1.5 } }, wifi
          ? 'DonutOS apps can use the internet. Turning this off takes DonutOS offline without changing your computer’s own connection.'
          : 'DonutOS is offline: apps can’t use the internet. Your computer’s own connection is unchanged.')));
  }

  destroy() { this.offs.forEach((f) => f()); }
}

const svg = (inner) => { const t = document.createElement('template'); t.innerHTML = `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`; return t.content.firstElementChild; };
const btIcon = () => svg('<path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9"/>');
const planeIcon = () => svg('<path d="M10.5 3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v6l7.5 4.5v2l-7.5-2.3v4.5l2.5 2v1.8L12 20.5 8 22v-1.8l2.5-2v-4.5L3 16v-2l7.5-4.5z"/>');
const focusIcon = () => svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>');
