// iCalendar (.ics, RFC 5545) import and export for the events Calendar stores.

const pad = (n) => String(n).padStart(2, '0');

function unfold(text) { return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const escape = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

function parseDate(value, params) {
  if (/VALUE=DATE(?!-)/i.test(params) || /^\d{8}$/.test(value)) {
    const y = +value.slice(0, 4), m = +value.slice(4, 6), d = +value.slice(6, 8);
    return { ms: new Date(y, m - 1, d).getTime(), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss = '0', z] = m;
  const ms = z ? Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss) : zoned(+y, +mo - 1, +d, +hh, +mi, +ss, /TZID=([^;:]+)/i.exec(params)?.[1]);
  return { ms, allDay: false };
}

/** Local wall time in a named time zone → epoch ms (falls back to this device's zone). */
function zoned(y, mo, d, hh, mi, ss, tz) {
  const guess = Date.UTC(y, mo, d, hh, mi, ss);
  if (!tz) return new Date(y, mo, d, hh, mi, ss).getTime();
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(guess)).map((p) => [p.type, Number(p.value)]));
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return guess - (asUtc - guess);
  } catch { return new Date(y, mo, d, hh, mi, ss).getTime(); }
}

export function parseICS(text) {
  const lines = unfold(text).split('\n');
  const out = [];
  let ev = null, inAlarm = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^BEGIN:VEVENT/i.test(line)) { ev = { repeat: 'none', reminder: null }; continue; }
    if (/^END:VEVENT/i.test(line)) {
      if (ev?.start !== undefined) {
        if (ev.end === undefined) ev.end = ev.allDay ? ev.start + 86400000 : ev.start + 3600000;
        out.push({ title: ev.title || '', start: ev.start, end: ev.end, allDay: !!ev.allDay, repeat: ev.repeat, until: ev.until || null,
          reminder: ev.reminder, location: ev.location || '', notes: ev.notes || '', uidICS: ev.uid || null, skip: ev.skip || [] });
      }
      ev = null;
      continue;
    }
    if (!ev) continue;
    if (/^BEGIN:VALARM/i.test(line)) { inAlarm = true; continue; }
    if (/^END:VALARM/i.test(line)) { inAlarm = false; continue; }
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const left = line.slice(0, idx), value = line.slice(idx + 1);
    const [name, ...rest] = left.split(';');
    const params = rest.join(';');
    const key = name.toUpperCase();
    if (inAlarm) {
      if (key === 'TRIGGER') {
        const m = /^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/i.exec(value.trim());
        if (m) ev.reminder = ((+m[1] || 0) * 7 * 1440) + ((+m[2] || 0) * 1440) + ((+m[3] || 0) * 60) + (+m[4] || 0);
      }
      continue;
    }
    if (key === 'SUMMARY') ev.title = unescape(value);
    else if (key === 'LOCATION') ev.location = unescape(value);
    else if (key === 'DESCRIPTION') ev.notes = unescape(value);
    else if (key === 'UID') ev.uid = value;
    else if (key === 'DTSTART') { const d = parseDate(value, params); if (d) { ev.start = d.ms; ev.allDay = d.allDay; } }
    else if (key === 'DTEND') { const d = parseDate(value, params); if (d) ev.end = d.ms; }
    else if (key === 'EXDATE') { for (const v of value.split(',')) { const d = parseDate(v, params); if (d) (ev.skip ||= []).push(d.ms); } }
    else if (key === 'RRULE') {
      const rule = Object.fromEntries(value.split(';').map((p) => p.split('=')));
      const freq = (rule.FREQ || '').toUpperCase();
      if (freq === 'WEEKLY' && /^MO,TU,WE,TH,FR$/i.test(rule.BYDAY || '')) ev.repeat = 'weekdays';
      else ev.repeat = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[freq] || 'none';
      if (rule.UNTIL) { const d = parseDate(rule.UNTIL, ''); if (d) ev.until = d.ms + (d.allDay ? 86399999 : 0); }
    }
  }
  return out;
}

const utc = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
const dateOnly = (ms) => { const d = new Date(ms); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
// Lines longer than 75 octets are folded.
const fold = (line) => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}`; } out.push(s); return out.join('\r\n'); };

export function toICS(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DonutOS//Calendar 1.0//EN', 'CALSCALE:GREGORIAN'];
  const stamp = utc(Date.now());
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uidICS || `${e.id}@donutos`}`, `DTSTAMP:${stamp}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.start)}`, `DTEND;VALUE=DATE:${dateOnly(e.end)}`);
    else lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`);
    lines.push(`SUMMARY:${escape(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escape(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${escape(e.notes)}`);
    if (e.repeat && e.repeat !== 'none') {
      const rule = e.repeat === 'weekdays' ? 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' : `FREQ=${e.repeat.toUpperCase()}`;
      lines.push(`RRULE:${rule}${e.until ? `;UNTIL=${utc(e.until)}` : ''}`);
    }
    for (const s of e.skip || []) lines.push(e.allDay ? `EXDATE;VALUE=DATE:${dateOnly(s)}` : `EXDATE:${utc(s)}`);
    if (e.reminder !== null && e.reminder !== undefined) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escape(e.title)}`, `TRIGGER:-PT${e.reminder}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
