// Weather from Open-Meteo (free, no API key). Used by the taskbar weather button and the
// Weather widget. Respects Wi-Fi/airplane mode; the last forecast is cached per user.

import { svgEl } from '../ui/h.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const STALE_MS = 20 * 60 * 1000;

// WMO weather interpretation codes.
const CODES = {
  0: ['Clear', 'clear'], 1: ['Mostly clear', 'partly'], 2: ['Partly cloudy', 'partly'], 3: ['Cloudy', 'cloud'],
  45: ['Fog', 'fog'], 48: ['Freezing fog', 'fog'], 51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'], 57: ['Freezing drizzle', 'drizzle'], 61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'], 71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Heavy showers', 'rain'], 85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'],
  95: ['Thunderstorm', 'thunder'], 96: ['Thunderstorm with hail', 'thunder'], 99: ['Thunderstorm with hail', 'thunder'],
};
export const describe = (code) => CODES[code] || ['Unknown', 'cloud'];

const SUN = '<circle cx="12" cy="12" r="4.2" fill="#ffc83d"/><g stroke="#ffc83d" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></g>';
const MOON = '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" fill="#ffd56b"/>';
const CLOUD = (fill = '#e8ecf3', y = 0) => `<path transform="translate(0 ${y})" d="M7 19h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 19z" fill="${fill}"/>`;
const ICONS = {
  clear: (night) => (night ? MOON : SUN),
  partly: (night) => `<g transform="translate(-3 -3) scale(.85)">${night ? MOON : SUN}</g>${CLOUD('#eef1f6', 1)}`,
  cloud: () => `${CLOUD('#b9c2d0', -3)}${CLOUD('#e8ecf3', 1)}`,
  fog: () => `${CLOUD('#d6dbe4', -3)}<g stroke="#aeb7c6" stroke-width="1.8" stroke-linecap="round"><path d="M5 19h14M7 22h10"/></g>`,
  drizzle: () => `${CLOUD('#d6dbe4', -4)}<g stroke="#5aa9ff" stroke-width="1.6" stroke-linecap="round"><path d="M9 18v1.5M13 18v1.5M17 18v1.5"/></g>`,
  rain: () => `${CLOUD('#c3cbd8', -4)}<g stroke="#3d8bfd" stroke-width="1.8" stroke-linecap="round"><path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/></g>`,
  snow: () => `${CLOUD('#dfe4ec', -4)}<g fill="#9fd0ff"><circle cx="8.5" cy="19" r="1.2"/><circle cx="12.5" cy="20.5" r="1.2"/><circle cx="16.5" cy="19" r="1.2"/></g>`,
  thunder: () => `${CLOUD('#9aa4b5', -4)}<path d="M12.5 15l-2.5 4.5h3l-1.5 3.5 4-5h-3l1.5-3z" fill="#ffc83d"/>`,
};

export function weatherIcon(code, { night = false, size = 24 } = {}) {
  const kind = describe(code)[1];
  return svgEl(`<svg class="wx-ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind](night)}</svg>`);
}

export class Weather {
  constructor(kernel, uid) {
    this.kernel = kernel;
    this.s = kernel.settings.forUser(uid);
    this.uid = uid;
    this.listeners = new Set();
    this.loading = false;
    this.error = '';
    this.timer = setInterval(() => this.refresh(), 30 * 60 * 1000);
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #notify() { for (const fn of this.listeners) fn(this); }

  get location() { return this.s.get('weather.location'); }
  get data() { return this.s.get('widgets.weatherCache'); }

  units() {
    const u = this.s.get('weather.units');
    if (u !== 'auto') return u;
    const loc = (this.s.get('language.locale') === 'auto' ? navigator.language : this.s.get('language.locale')) || 'en';
    return /-(US|LR|MM)$/i.test(loc) ? 'imperial' : 'metric';
  }

  online() { return !this.s.get('qs.airplane') && this.s.get('qs.wifi') && navigator.onLine; }

  async search(query) {
    if (!this.online()) throw new Error('You’re offline.');
    const r = await fetch(`${GEOCODE}?name=${encodeURIComponent(query)}&count=6&language=${encodeURIComponent((navigator.language || 'en').slice(0, 2))}&format=json`);
    if (!r.ok) throw new Error('Couldn’t search for places right now.');
    const j = await r.json();
    return (j.results || []).map((p) => ({ name: p.name, region: [p.admin1, p.country].filter(Boolean).join(', '), latitude: p.latitude, longitude: p.longitude }));
  }

  /** Uses the device's location (asks the browser/OS; obeys the Location privacy switch). */
  locate() {
    return new Promise((resolve, reject) => {
      if (!this.s.get('privacy.location')) { reject(new Error('Location is turned off in Settings › Privacy.')); return; }
      if (!navigator.geolocation) { reject(new Error('Location isn’t available on this device.')); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ name: 'Current location', region: `${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`, latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => reject(new Error(err.code === 1 ? 'Permission to use your location was denied.' : 'Your location couldn’t be found. Search for your city instead.')),
        { timeout: 10000, maximumAge: 600000 });
    });
  }

  async setLocation(loc) {
    this.s.set('weather.location', loc);
    this.s.set('widgets.weatherCache', null);
    await this.refresh({ force: true });
  }

  async refresh({ force = false } = {}) {
    const loc = this.location;
    if (!loc || this.loading) return;
    const d = this.data;
    if (!force && d && d.lat === loc.latitude && Date.now() - d.fetchedAt < STALE_MS) return;
    if (!this.online()) { this.error = 'offline'; this.#notify(); return; }
    this.loading = true; this.error = ''; this.#notify();
    try {
      const imperial = this.units() === 'imperial';
      const q = new URLSearchParams({
        latitude: loc.latitude, longitude: loc.longitude, timezone: 'auto', forecast_days: '5',
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
        temperature_unit: imperial ? 'fahrenheit' : 'celsius', wind_speed_unit: imperial ? 'mph' : 'kmh',
      });
      const r = await fetch(`${FORECAST}?${q}`);
      if (!r.ok) throw new Error(`Weather service error (${r.status})`);
      const j = await r.json();
      this.s.set('widgets.weatherCache', {
        fetchedAt: Date.now(), lat: loc.latitude, units: imperial ? 'imperial' : 'metric',
        current: { temp: j.current.temperature_2m, feels: j.current.apparent_temperature, humidity: j.current.relative_humidity_2m, code: j.current.weather_code, wind: j.current.wind_speed_10m, day: !!j.current.is_day },
        daily: j.daily.time.map((t, i) => ({ date: t, code: j.daily.weather_code[i], max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i], rain: j.daily.precipitation_probability_max?.[i] ?? null })),
      });
    } catch (err) {
      this.error = navigator.onLine ? (err.message || 'Couldn’t get the weather.') : 'offline';
    } finally {
      this.loading = false;
      this.#notify();
    }
  }

  destroy() { clearInterval(this.timer); this.listeners.clear(); }
}
