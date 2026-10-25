// Browser APIs that behave identically in a normal browser and in Electron's renderer.
// Both adapters share these so the two builds report the same data the same way.

let batteryPromise = null;
const getBattery = () => (batteryPromise ??= (navigator.getBattery ? navigator.getBattery().catch(() => null) : Promise.resolve(null)));

export async function batteryStatus() {
  const b = await getBattery();
  if (!b) return { supported: false, level: 1, charging: true, chargingTime: 0, dischargingTime: Infinity };
  return { supported: true, level: b.level, charging: b.charging, chargingTime: b.chargingTime, dischargingTime: b.dischargingTime };
}

export function onBatteryChange(cb) {
  let off = () => {};
  let cancelled = false;
  getBattery().then((b) => {
    if (!b || cancelled) return;
    const h = () => batteryStatus().then(cb);
    const evs = ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'];
    evs.forEach((e) => b.addEventListener(e, h));
    off = () => evs.forEach((e) => b.removeEventListener(e, h));
  });
  return () => { cancelled = true; off(); };
}

/** Network status from the browser's own APIs. */
export function browserNetwork() {
  const c = navigator.connection || null;
  const online = navigator.onLine;
  let type = c?.type || 'unknown';
  if (type === 'wimax') type = 'wifi';
  if (!['wifi', 'ethernet', 'cellular', 'none'].includes(type)) type = 'unknown';
  if (!online) type = 'none';
  return {
    online, type,
    effectiveType: c?.effectiveType || null,
    downlinkMbps: c?.downlink ?? null,
    rttMs: c?.rtt ?? null,
    interfaces: [],
  };
}

export function onBrowserNetworkChange(cb) {
  const h = () => cb();
  window.addEventListener('online', h);
  window.addEventListener('offline', h);
  navigator.connection?.addEventListener?.('change', h);
  return () => {
    window.removeEventListener('online', h);
    window.removeEventListener('offline', h);
    navigator.connection?.removeEventListener?.('change', h);
  };
}

/**
 * Measures how busy the UI thread is by watching how late a 50 ms timer fires.
 * A late timer means the thread was occupied; the fraction of lateness over a window
 * is a real (if coarse) measurement of load, used where no OS CPU counter exists.
 */
export class LoadMonitor {
  #busy = 0; #window = 0; #last = 0; #timer = null; #usage = 0;
  start() {
    if (this.#timer) return;
    this.#last = performance.now();
    this.#timer = setInterval(() => {
      const now = performance.now();
      const elapsed = now - this.#last;
      this.#last = now;
      this.#busy += Math.max(0, elapsed - 50);
      this.#window += elapsed;
      if (this.#window >= 1000) {
        // Background tabs throttle timers to 1 s; treat that as idle rather than busy.
        const busy = document.hidden ? 0 : this.#busy;
        this.#usage = Math.min(100, (busy / this.#window) * 100);
        this.#busy = 0; this.#window = 0;
      }
    }, 50);
  }
  get usage() { return this.#usage; }
}

export function fullscreenApi() {
  return {
    setFullscreen: async (on) => {
      try {
        if (on && !document.fullscreenElement) {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
          // In full screen, Chromium lets the page receive system keys (Win key, Alt+Tab…),
          // so DonutOS's own shortcuts work. Holding Esc leaves full screen.
          await navigator.keyboard?.lock?.().catch(() => {});
        } else if (!on && document.fullscreenElement) {
          navigator.keyboard?.unlock?.();
          await document.exitFullscreen();
        }
      } catch { /* the browser refused (no user gesture) */ }
      return !!document.fullscreenElement;
    },
    isFullscreen: () => !!document.fullscreenElement,
    onFullscreenChange: (cb) => {
      const h = () => cb(!!document.fullscreenElement);
      document.addEventListener('fullscreenchange', h);
      return () => document.removeEventListener('fullscreenchange', h);
    },
  };
}

/** Basic OS detection from the user agent, for the "About" page on the web build. */
export function detectOs() {
  const ua = navigator.userAgent;
  const uaData = navigator.userAgentData;
  if (uaData?.platform) return uaData.platform;
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

export function detectEngine() {
  const ua = navigator.userAgent;
  const m = ua.match(/(Edg|Chrome|Firefox|Version)\/(\d+)/);
  if (!m) return 'Browser';
  const name = { Edg: 'Edge', Chrome: 'Chromium', Firefox: 'Firefox', Version: 'Safari' }[m[1]];
  return `${name} ${m[2]}`;
}
