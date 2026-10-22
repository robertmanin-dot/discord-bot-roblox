/**
 * Zeit-Hilfen. Eingaben kommen im deutschen Format ("24.10.2026 18:00") und gelten in der
 * eingestellten Zeitzone. Gespeichert wird immer als Unix-Zeit in Sekunden.
 */

/** Versatz der Zeitzone zu UTC in Minuten für einen bestimmten Zeitpunkt. */
function timeZoneOffsetMinutes(utcMillis, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMillis));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - utcMillis) / 60000);
}

/** Wandelt eine Uhrzeit in der Zeitzone in Unix-Sekunden um. */
function zonedToUnix(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let offset = timeZoneOffsetMinutes(guess, timeZone);
  let result = guess - offset * 60000;
  // Zweiter Durchlauf für die Tage der Zeitumstellung
  const offset2 = timeZoneOffsetMinutes(result, timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = guess - offset * 60000;
  }
  return Math.floor(result / 1000);
}

/**
 * Liest "24.10.2026 18:00", "24.10.26 18:00" oder "24.10. 18:00" (aktuelles bzw. nächstes Jahr).
 * Gibt Unix-Sekunden zurück oder null, wenn das Format nicht passt.
 */
function parseGermanDateTime(input, timeZone, nowMillis = Date.now()) {
  const match = String(input)
    .trim()
    .match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?\s*(?:,|um)?\s*(\d{1,2})[:.](\d{2})(?:\s*uhr)?$/i);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  let year;
  if (match[3]) {
    year = Number(match[3]);
    if (year < 100) year += 2000;
  } else {
    const currentYear = new Date(nowMillis).getUTCFullYear();
    year = currentYear;
    // Liegt das Datum dieses Jahr schon mehr als einen Tag zurück, ist das nächste Jahr gemeint
    if (zonedToUnix(year, month, day, hour, minute, timeZone) * 1000 < nowMillis - 24 * 3600 * 1000) {
      year += 1;
    }
  }

  // Ungültige Tage wie 31.02. abfangen
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1) return null;

  return zonedToUnix(year, month, day, hour, minute, timeZone);
}

/** Liest Dauern wie "30m", "12h", "3d", "1d 12h", "2 tage". Gibt Sekunden zurück oder null. */
function parseDuration(input) {
  const text = String(input).trim().toLowerCase();
  if (!text) return null;
  const units = {
    m: 60, min: 60, minute: 60, minuten: 60,
    h: 3600, std: 3600, stunde: 3600, stunden: 3600,
    d: 86400, t: 86400, tag: 86400, tage: 86400,
    w: 604800, woche: 604800, wochen: 604800,
  };
  const re = /(\d+)\s*([a-zäöü]+)/g;
  let total = 0;
  let consumed = '';
  let m;
  while ((m = re.exec(text)) !== null) {
    const factor = units[m[2]];
    if (!factor) return null;
    total += Number(m[1]) * factor;
    consumed += m[0];
  }
  if (consumed.replace(/\s/g, '') !== text.replace(/\s/g, '')) return null;
  return total > 0 ? total : null;
}

/** Discord-Zeitstempel, der bei jedem Nutzer in seiner eigenen Zeitzone angezeigt wird. */
function discordTime(unix, style = 'F') {
  return `<t:${unix}:${style}>`;
}

/** "1 Std. 25 Min." aus Sekunden */
function formatPlaytime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} Min.`;
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}

module.exports = { parseGermanDateTime, parseDuration, discordTime, formatPlaytime, zonedToUnix };
