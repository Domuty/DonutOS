// Live network and battery indicators (lock screen, sign-in screen, taskbar).

import { h } from '../ui/h.js';
import { icon, batteryIcon } from '../ui/icons.js';

/** Renders into `el` and keeps it updated. Returns a dispose function. */
export function mountStatusIcons(el, platform, { showBattery = true, size = 20 } = {}) {
  const net = h('span.status-net', { role: 'img' });
  const bat = h('span.status-bat', { role: 'img' });
  el.append(net, bat);

  const paintNet = (n) => {
    const name = !n.online ? 'wifiOff' : n.type === 'ethernet' ? 'ethernet' : n.type === 'wifi' ? 'wifi' : 'globe';
    net.replaceChildren(icon(name, { size }));
    const label = n.online ? `Connected${n.type !== 'unknown' ? ` (${n.type === 'wifi' ? 'Wi-Fi' : n.type})` : ''}` : 'Not connected';
    net.title = label; net.setAttribute('aria-label', `Network: ${label}`);
  };
  const paintBat = (b) => {
    // Machines without a battery report nothing useful; hide the icon there.
    const real = b.supported && !(b.charging && b.level === 1 && b.chargingTime === 0);
    bat.hidden = !showBattery || !real;
    if (bat.hidden) return;
    bat.replaceChildren(batteryIcon(b.level, b.charging, { size }));
    const label = `${Math.round(b.level * 100)}%${b.charging ? ', charging' : ''}`;
    bat.title = `Battery ${label}`; bat.setAttribute('aria-label', `Battery: ${label}`);
  };
  platform.system.network().then(paintNet);
  platform.system.battery().then(paintBat);
  const offNet = platform.system.onNetworkChange(paintNet);
  const offBat = platform.system.onBatteryChange(paintBat);
  return () => { offNet(); offBat(); net.remove(); bat.remove(); };
}
