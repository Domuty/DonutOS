// Calendar event recurrence. An event is
//   { id, title, start, end (ms), allDay, repeat: 'none'|'daily'|'weekdays'|'weekly'|'monthly'|'yearly',
//     until: ms | null, skip: [occurrence start ms, …] }
// occurrencesBetween() expands it into the concrete occurrences overlapping [from, to).

const DAY = 86400000;

function step(d, repeat, n) {
  const x = new Date(d);
  if (repeat === 'daily') x.setDate(x.getDate() + n);
  else if (repeat === 'weekly') x.setDate(x.getDate() + 7 * n);
  else if (repeat === 'monthly') {
    const day = x.getDate();
    x.setDate(1); x.setMonth(x.getMonth() + n);
    // Skip months without that day (31st), like most calendars.
    const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
    if (day > last) return null;
    x.setDate(day);
  } else if (repeat === 'yearly') {
    const m = x.getMonth(), day = x.getDate();
    x.setFullYear(x.getFullYear() + n);
    if (x.getMonth() !== m || x.getDate() !== day) return null; // 29 February
  }
  return x;
}

export function occurrencesBetween(ev, from, to) {
  const out = [];
  const start = Number(ev.start), end = Number(ev.end ?? ev.start);
  const len = Math.max(0, end - start);
  const f = +from, t = +to;
  const skip = new Set(ev.skip || []);
  const until = ev.until ? Number(ev.until) : Infinity;
  const push = (s) => { if (s < t && s + Math.max(len, 1) > f && s <= until && !skip.has(s)) out.push({ start: s, end: s + len, event: ev }); };
  const repeat = ev.repeat || 'none';
  if (repeat === 'none') { push(start); return out; }
  if (start >= t) return out;
  if (repeat === 'weekdays') {
    // Jump close to the window, then walk day by day.
    let d = new Date(start);
    const skipDays = Math.max(0, Math.floor((f - len - start) / DAY) - 1);
    d.setDate(d.getDate() + skipDays);
    for (let i = 0; i < 400 && +d < t; i++) {
      if (d.getDay() !== 0 && d.getDay() !== 6) push(+d);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  const approx = { daily: DAY, weekly: 7 * DAY, monthly: 28 * DAY, yearly: 365 * DAY }[repeat] || DAY;
  let n = Math.max(0, Math.floor((f - len - start) / approx) - 2);
  for (let guard = 0; guard < 1000; guard++, n++) {
    const d = step(start, repeat, n);
    if (d === null) continue;
    if (+d >= t || +d > until) break;
    push(+d);
  }
  return out;
}
