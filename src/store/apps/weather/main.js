// Weather — forecasts from Open-Meteo (free, no key). Uses the network permission for
// requests and, only when you ask, the location permission.
import { h, mount, css, ui } from '@donut/sdk';

const CODES = {
  0: ['Clear', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'], 45: ['Fog', '🌫️'], 48: ['Freezing fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'], 56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'], 80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'],
  85: ['Snow showers', '🌨️'], 86: ['Snow showers', '❄️'], 95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'],
};
const code = (c) => CODES[c] || ['Unknown', '🌡️'];

css(`
.wx { height: 100%; display: grid; grid-template-columns: 240px 1fr; }
.wx-side { border-right: 1px solid var(--border); padding: 12px; display: flex; flex-direction: column; gap: 8px; overflow: auto; background: var(--surface-2); }
.wx-place { display: flex; align-items: center; gap: 8px; border: 0; background: none; text-align: left; padding: 8px 10px; border-radius: var(--radius-s); }
.wx-place:hover { background: var(--hover); } .wx-place[aria-current] { background: var(--accent-soft); }
.wx-place span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wx-main { overflow: auto; padding: 20px 24px; }
.wx-now { display: flex; align-items: center; gap: 20px; margin-bottom: 20px; }
.wx-temp { font: 600 64px/1 var(--font-display); } .wx-emoji { font-size: 64px; }
.wx-hours { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; }
.wx-hour { min-width: 64px; text-align: center; padding: 8px 4px; border-radius: var(--radius); background: var(--surface-2); }
.wx-hour b { display: block; font-size: 15px; } .wx-hour i { font-style: normal; font-size: 22px; display: block; }
.wx-days { display: grid; gap: 2px; margin-top: 16px; }
.wx-day { display: grid; grid-template-columns: 90px 32px 1fr 110px; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-s); background: var(--surface-2); }
.wx-bar { height: 6px; border-radius: 3px; background: linear-gradient(90deg, #4fa8f7, #ffb347); }
.wx-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-top: 16px; }
.wx-fact { padding: 10px 12px; border-radius: var(--radius); background: var(--surface-2); } .wx-fact small { display: block; } .wx-fact b { font-size: 18px; }
.wx-results { display: grid; gap: 2px; }
@media (max-width: 640px) { .wx { grid-template-columns: 1fr; } .wx-side { display: none; } }
`);

export default function main(app) {
  let places = app.storage.get('places', []);
  let current = app.storage.get('current', null);
  let unit = app.storage.get('unit', 'celsius');
  let data = null, error = null, loading = false;

  const side = h('aside.wx-side');
  const view = h('main.wx-main');
  mount(app.root, h('div.wx', side, view));

  const t = (v) => `${Math.round(v)}°`;
  async function getJSON(url) {
    const r = await app.net.fetch(url);
    if (!r.ok) throw new Error(`The weather service answered ${r.status}`);
    return r.json();
  }

  async function search(q) {
    const res = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`);
    return (res.results || []).map((r) => ({ name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude, tz: r.timezone }));
  }

  async function load() {
    if (!current) { renderMain(); return; }
    loading = true; error = null; renderMain();
    try {
      data = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${current.lat}&longitude=${current.lon}&timezone=auto&temperature_unit=${unit}&wind_speed_unit=${unit === 'fahrenheit' ? 'mph' : 'kmh'}`
        + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,pressure_msl,is_day'
        + '&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&forecast_days=7');
      app.storage.set('cache', { key: `${current.lat},${current.lon},${unit}`, data, time: Date.now() });
    } catch (err) {
      const cache = app.storage.get('cache');
      if (cache?.key === `${current.lat},${current.lon},${unit}`) { data = cache.data; error = `Showing the forecast from ${new Date(cache.time).toLocaleString()} — ${err.code === 'EPERM' ? 'internet access is off for Weather' : err.message}.`; }
      else { data = null; error = err.code === 'EPERM' ? 'Weather needs internet access. Allow it when asked, or in Settings › Privacy & security.' : `Couldn’t get the forecast: ${err.message}`; }
    }
    loading = false;
    renderMain();
  }

  function choose(place) {
    current = place;
    app.storage.set('current', place);
    if (!places.some((p) => p.lat === place.lat && p.lon === place.lon)) { places = [...places, place]; app.storage.set('places', places); }
    app.window.setTitle(`${place.name} — Weather`);
    renderSide(); load();
  }

  function renderSide() {
    const q = h('input.input', { type: 'search', placeholder: 'Search for a city', 'aria-label': 'Search for a city' });
    const results = h('div.wx-results');
    let timer = null;
    q.addEventListener('input', () => {
      clearTimeout(timer);
      if (!q.value.trim()) { mount(results); return; }
      timer = setTimeout(async () => {
        try {
          const list = await search(q.value.trim());
          mount(results, list.length ? list.map((r) => h('button.wx-place', { type: 'button', onclick: () => { q.value = ''; mount(results); choose(r); } }, '📍', h('span', `${r.name}`, h('small', ` ${r.region}`)))) : h('small', 'No matching places.'));
        } catch (err) { mount(results, h('small', err.code === 'EPERM' ? 'Internet access is off for Weather.' : err.message)); }
      }, 300);
    });
    mount(side, q, results,
      h('button.btn', { type: 'button', onclick: useLocation }, '◎ Use my location'),
      h('hr'),
      h('small', 'Saved places'),
      places.length ? places.map((p) => h('div.row', h('button.wx-place.grow', { type: 'button', 'aria-current': current && p.lat === current.lat && p.lon === current.lon ? 'true' : null, onclick: () => choose(p) }, h('span', p.name, h('small', ` ${p.region || ''}`))),
        h('button.btn.subtle.icon', { type: 'button', 'aria-label': `Remove ${p.name}`, onclick: () => { places = places.filter((x) => x !== p); app.storage.set('places', places); renderSide(); } }, '✕')))
        : h('small.hint', 'Search for a city to add it.'),
      h('div.grow'),
      h('div.row', h('small', 'Units'), h('select.input', { 'aria-label': 'Units', onchange: (e) => { unit = e.target.value; app.storage.set('unit', unit); load(); } },
        h('option', { value: 'celsius', selected: unit === 'celsius' }, '°C, km/h'), h('option', { value: 'fahrenheit', selected: unit === 'fahrenheit' }, '°F, mph'))),
      h('small.hint', 'Data: open-meteo.com'));
  }

  async function useLocation() {
    try {
      const pos = await app.location.get();
      let name = 'My location', region = '';
      try {
        const r = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${pos.latitude.toFixed(2)},${pos.longitude.toFixed(2)}&count=1`);
        if (r.results?.[0]) { name = r.results[0].name; region = r.results[0].country || ''; }
      } catch { /* keep the generic name */ }
      choose({ name, region, lat: +pos.latitude.toFixed(3), lon: +pos.longitude.toFixed(3) });
    } catch (err) {
      ui.alert('Location unavailable', err.code === 'EPERM' ? 'Weather isn’t allowed to use your location. You can allow it in Settings › Privacy & security › Location.' : err.message);
    }
  }

  function renderMain() {
    if (!current) { mount(view, h('div.empty', h('div', { style: { fontSize: '56px' } }, '⛅'), h('h2', 'Find your weather'), h('p', 'Search for a city on the left, or use your location.'))); return; }
    if (loading && !data) { mount(view, h('div.empty', 'Getting the forecast…')); return; }
    if (!data) { mount(view, h('div.empty', h('h2', current.name), h('p', error), h('button.btn.primary', { type: 'button', onclick: load }, 'Try again'))); return; }
    const c = data.current, d = data.daily, hr = data.hourly;
    const nowIdx = Math.max(0, hr.time.findIndex((x) => x >= c.time.slice(0, 13)));
    const [label, emoji] = code(c.weather_code);
    const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max);
    const day = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: 'short' });
    const clock = (s) => new Date(s).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    mount(view,
      error ? h('p.card', { style: { marginBottom: '12px' } }, error) : null,
      h('div.row', h('h1.grow', current.name, h('small', `  ${current.region || ''}`)), h('button.btn.subtle', { type: 'button', onclick: load, title: 'Refresh' }, loading ? '…' : '↻ Refresh')),
      h('div.wx-now', h('div.wx-emoji', emoji), h('div', h('div.wx-temp', t(c.temperature_2m)), h('div', `${label} · feels like ${t(c.apparent_temperature)}`), h('small', `High ${t(d.temperature_2m_max[0])} · Low ${t(d.temperature_2m_min[0])}`))),
      h('h3', 'Next 24 hours'),
      h('div.wx-hours', hr.time.slice(nowIdx, nowIdx + 24).map((x, i) => h('div.wx-hour', h('small', i ? new Date(x).toLocaleTimeString(undefined, { hour: 'numeric' }) : 'Now'), h('i', code(hr.weather_code[nowIdx + i])[1]), h('b', t(hr.temperature_2m[nowIdx + i])), h('small', `${hr.precipitation_probability[nowIdx + i] ?? 0}%`)))),
      h('h3', { style: { marginTop: '18px' } }, '7-day forecast'),
      h('div.wx-days', d.time.map((x, i) => {
        const left = ((d.temperature_2m_min[i] - lo) / Math.max(1, hi - lo)) * 100, right = ((d.temperature_2m_max[i] - lo) / Math.max(1, hi - lo)) * 100;
        return h('div.wx-day', h('b', i ? day(x) : 'Today'), h('span', { title: code(d.weather_code[i])[0] }, code(d.weather_code[i])[1]),
          h('div', { style: { position: 'relative', height: '6px' } }, h('div.wx-bar', { style: { position: 'absolute', left: `${left}%`, width: `${Math.max(4, right - left)}%` } })),
          h('span', { style: { textAlign: 'right' } }, `${t(d.temperature_2m_min[i])} / ${t(d.temperature_2m_max[i])}`, h('small', `  ${d.precipitation_probability_max[i] ?? 0}%`)));
      })),
      h('div.wx-facts',
        h('div.wx-fact', h('small', 'Humidity'), h('b', `${c.relative_humidity_2m}%`)),
        h('div.wx-fact', h('small', 'Wind'), h('b', `${Math.round(c.wind_speed_10m)} ${data.current_units.wind_speed_10m}`)),
        h('div.wx-fact', h('small', 'Pressure'), h('b', `${Math.round(c.pressure_msl)} hPa`)),
        h('div.wx-fact', h('small', 'UV index'), h('b', String(Math.round(d.uv_index_max[0] ?? 0)))),
        h('div.wx-fact', h('small', 'Sunrise'), h('b', clock(d.sunrise[0]))),
        h('div.wx-fact', h('small', 'Sunset'), h('b', clock(d.sunset[0])))));
  }

  renderSide();
  if (current) app.window.setTitle(`${current.name} — Weather`);
  load();
  setInterval(() => { if (current) load(); }, 30 * 60 * 1000);
}
