// Date and time formatting that follows the user's Time & language settings.

export function locale(settings) {
  const l = settings?.get?.('language.locale');
  return !l || l === 'auto' ? undefined : l;
}

function tz(settings) {
  const z = settings?.get?.('time.timezone');
  return !z || z === 'auto' ? undefined : z;
}

export function formatTime(date, settings, { seconds = false } = {}) {
  return new Intl.DateTimeFormat(locale(settings), {
    hour: 'numeric', minute: '2-digit', second: seconds ? '2-digit' : undefined,
    hour12: settings ? !settings.get('time.format24h') : undefined, timeZone: tz(settings),
  }).format(date);
}

/** Hours and minutes without the AM/PM marker, for the big lock-screen clock. */
export function formatClock(date, settings) {
  const parts = new Intl.DateTimeFormat(locale(settings), {
    hour: 'numeric', minute: '2-digit', hour12: settings ? !settings.get('time.format24h') : undefined, timeZone: tz(settings),
  }).formatToParts(date);
  return parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
}

export function formatDate(date, settings, style) {
  const s = style || settings?.get?.('time.dateFormat') || 'short';
  if (s === 'iso') return date.toISOString().slice(0, 10);
  const opts = { short: { year: 'numeric', month: 'numeric', day: 'numeric' }, medium: { year: 'numeric', month: 'short', day: 'numeric' },
    long: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }, full: { weekday: 'long', month: 'long', day: 'numeric' } }[s];
  return new Intl.DateTimeFormat(locale(settings), { ...opts, timeZone: tz(settings) }).format(date);
}

/** Calls fn() now and then at the start of every minute (or second). Returns a stop function. */
export function everyTick(fn, { seconds = false } = {}) {
  let t;
  const step = seconds ? 1000 : 60000;
  const loop = () => { fn(); t = setTimeout(loop, step - (Date.now() % step) + 5); };
  loop();
  return () => clearTimeout(t);
}
