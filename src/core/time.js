// Date/time helpers without external libraries. All stored timestamps are ISO-8601 UTC strings.

export const DEFAULT_TZ = 'Europe/Berlin';

export const nowIso = () => new Date().toISOString();

export function toDate(value) {
  if (value instanceof Date) return value;
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const addMinutes = (date, n) => new Date(toDate(date).getTime() + n * 60_000);
export const addHours = (date, n) => addMinutes(date, n * 60);
export const addDays = (date, n) => addMinutes(date, n * 1440);

/** Days elapsed since an ISO timestamp (fractional). Infinity if missing. */
export function daysSince(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return Infinity;
  return (now.getTime() - d.getTime()) / 86_400_000;
}

function partsInTz(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second };
}

/** Offset of `timeZone` from UTC at the given instant, in minutes (Berlin winter = +60). */
export function tzOffsetMinutes(date, timeZone = DEFAULT_TZ) {
  const p = partsInTz(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** Converts a wall-clock time in `timeZone` to a UTC Date. */
export function zonedToUtc({ year, month, day, hour = 0, minute = 0 }, timeZone = DEFAULT_TZ) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = tzOffsetMinutes(new Date(guess), timeZone);
  let result = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(new Date(result), timeZone);
  if (off2 !== off1) result = guess - off2 * 60_000;
  return new Date(result);
}

/**
 * Parses dates like "21.11.2026", "21.11.", "2026-11-21", "21/11/2026".
 * A missing year means the next occurrence of that day.
 */
export function parseDateInput(input, now = new Date()) {
  const s = String(input ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./]?(\d{2,4})?$/);
  if (m) {
    const day = +m[1];
    const month = +m[2];
    let year = m[3] ? +m[3] : now.getUTCFullYear();
    if (m[3] && m[3].length === 2) year = 2000 + year;
    if (!m[3]) {
      const candidate = Date.UTC(year, month - 1, day, 23, 59);
      if (candidate < now.getTime()) year += 1;
    }
    return valid(year, month, day);
  }
  return null;

  function valid(year, month, day) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return { year, month, day };
  }
}

/** Parses "19:00", "19.30", "19", "19 Uhr", "7pm", "7:30 pm". */
export function parseTimeInput(input) {
  const s = String(input ?? '').trim().toLowerCase().replace(/\s*uhr$/, '');
  const m = s.match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = +m[1];
  const minute = m[2] ? +m[2] : 0;
  if (m[3] === 'pm' && hour < 12) hour += 12;
  if (m[3] === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** "21.11.2026" + "19:00" (Berlin) -> Date (UTC) or null. */
export function parseLocalDateTime(dateStr, timeStr, timeZone = DEFAULT_TZ, now = new Date()) {
  const d = parseDateInput(dateStr, now);
  const t = parseTimeInput(timeStr);
  if (!d || !t) return null;
  return zonedToUtc({ ...d, ...t }, timeZone);
}

/** Calendar day "YYYY-MM-DD" of an instant in a time zone (for daily limits/quotas). */
export function dayKey(date = new Date(), timeZone = DEFAULT_TZ) {
  const p = partsInTz(toDate(date), timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const LOCALES = { de: 'de-DE', en: 'en-US', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR', pl: 'pl-PL', tr: 'tr-TR', it: 'it-IT', nl: 'nl-NL' };
export const localeFor = (lang) => LOCALES[lang] || 'en-US';

/** "Samstag, 21. November 2026" / "Saturday, November 21, 2026". */
export function formatDate(date, lang = 'de', timeZone = DEFAULT_TZ, opts = {}) {
  const d = toDate(date);
  if (!d) return '';
  return new Intl.DateTimeFormat(localeFor(lang), {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: opts.year === false ? undefined : 'numeric',
  }).format(d);
}

/** "19:00" / "7:00 PM" in the given zone. */
export function formatTime(date, lang = 'de', timeZone = DEFAULT_TZ) {
  const d = toDate(date);
  if (!d) return '';
  return new Intl.DateTimeFormat(localeFor(lang), { timeZone, hour: 'numeric', minute: '2-digit' }).format(d);
}

/** Short zone name like "MEZ"/"CET"/"EST" for an instant. */
export function zoneLabel(date, lang = 'de', timeZone = DEFAULT_TZ) {
  const d = toDate(date);
  if (!d) return '';
  const part = new Intl.DateTimeFormat(localeFor(lang), { timeZone, timeZoneName: 'short' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}

/** Discord timestamp markup: <t:UNIX:F> renders in each viewer's own time zone. */
export function discordTs(date, style = 'F') {
  const d = toDate(date);
  if (!d) return '';
  return `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
}
