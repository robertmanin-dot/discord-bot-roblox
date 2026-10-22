// Pure logic for playtests, bugs and events (no Discord, no database) – easy to test.
import { minAgeOf } from '../../core/creators.js';
import { parseLocalDateTime, toDate, zonedToUtc, DEFAULT_TZ } from '../../core/time.js';
import { cleanUrl } from '../util.js';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Validation error with a translation key (module translates; REST shows the German message). */
export class ValidationError extends Error {
  constructor(key, message, vars = {}) {
    super(message);
    this.key = key;
    this.vars = vars;
    this.status = 400;
  }
}

const MESSAGES = {
  errTitle: 'Bitte einen Titel angeben (max. 100 Zeichen).',
  errDate: 'Datum/Uhrzeit nicht erkannt. Beispiel: 21.11.2026 und 19:00',
  errPast: 'Der Termin liegt in der Vergangenheit.',
  errDuration: 'Dauer muss zwischen 10 und 600 Minuten liegen.',
  errSlots: 'Plätze müssen zwischen 1 und 1000 liegen.',
  errLink: 'Der Link ist ungültig (nur http/https).',
  errKind: 'Typ muss "launch" oder "event" sein.',
};

const fail = (key, vars) => {
  throw new ValidationError(key, MESSAGES[key] || key, vars);
};

function intOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

function parseStart(input, { now, timezone }) {
  let at = null;
  if (input.starts_at) at = toDate(input.starts_at);
  else at = parseLocalDateTime(input.date, input.time, timezone || DEFAULT_TZ, now);
  if (!at) fail('errDate');
  if (at.getTime() < now.getTime() - 5 * MIN) fail('errPast');
  return at;
}

function parseDuration(value) {
  const d = intOrNull(value);
  if (d === null) return 60;
  if (!Number.isFinite(d) || d < 10 || d > 600) fail('errDuration');
  return d;
}

function parseTitle(value) {
  const title = String(value ?? '').trim();
  if (!title || title.length > 100) fail('errTitle');
  return title;
}

/** http(s) URL with a real host name ("roblox.com/…"), or null. */
export function strictUrl(value) {
  const url = cleanUrl(value);
  if (!url) return null;
  try {
    return new URL(url).hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}

function parseLink(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const url = strictUrl(raw);
  if (!url) fail('errLink');
  return url;
}

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'ja' || v === 'yes' || v === 'on';

/**
 * Validates playtest input from the slash command or the dashboard.
 * input: { title, date, time | starts_at, duration_min|duration, slots, join_link|link, description, min_age|ab16 }
 */
export function parsePlaytestInput(input, { now = new Date(), timezone = DEFAULT_TZ, minAge = 13 } = {}) {
  const title = parseTitle(input.title);
  const startsAt = parseStart(input, { now, timezone });
  const duration = parseDuration(input.duration_min ?? input.duration);
  const slotsRaw = intOrNull(input.slots);
  if (slotsRaw !== null && (!Number.isFinite(slotsRaw) || slotsRaw < 1 || slotsRaw > 1000)) fail('errSlots');
  const joinLink = parseLink(input.join_link ?? input.link);
  const description = String(input.description ?? '').trim().slice(0, 1000) || null;
  let min = Number(input.min_age);
  if (!Number.isFinite(min) || min <= 0) min = truthy(input.ab16) ? 16 : 13;
  min = Math.max(min >= 16 ? 16 : 13, Number(minAge) || 13);
  return {
    title,
    description,
    starts_at: startsAt.toISOString(),
    duration_min: duration,
    slots: slotsRaw,
    join_link: joinLink,
    min_age: min,
  };
}

/**
 * Validates event input (launch hour / weekly creator event).
 * input: { title, kind, date, time | starts_at, duration_min|duration, repeat_weekly|woechentlich, game_link|link, description }
 */
export function parseEventInput(input, { now = new Date(), timezone = DEFAULT_TZ, defaultLink = '' } = {}) {
  const title = parseTitle(input.title);
  const kind = String(input.kind || 'event').trim().toLowerCase();
  if (!['launch', 'event'].includes(kind)) fail('errKind');
  const startsAt = parseStart(input, { now, timezone });
  const duration = parseDuration(input.duration_min ?? input.duration);
  const gameLink = parseLink(input.game_link ?? input.link) || strictUrl(defaultLink) || null;
  return {
    title,
    kind,
    description: String(input.description ?? '').trim().slice(0, 1500) || null,
    starts_at: startsAt.toISOString(),
    duration_min: duration,
    repeat_weekly: truthy(input.repeat_weekly ?? input.woechentlich) ? 1 : 0,
    game_link: gameLink,
  };
}

// ---- Age rules ----------------------------------------------------------------

/**
 * Can someone with this age group join a playtest with `minAge`?
 * Unknown age is fine for 13+ playtests (Discord requires 13+), not for 16+ ones.
 */
export function ageEligible(ageGroup, minAge = 13) {
  if (ageGroup === 'u13') return { ok: false, reason: 'tooYoung' };
  const min = minAgeOf(ageGroup);
  if (min === null) return minAge <= 13 ? { ok: true } : { ok: false, reason: 'ageUnknown' };
  return min >= minAge ? { ok: true } : { ok: false, reason: 'tooYoung' };
}

/** 'reject' | 'parent' | 'accept' for the "become a tester" flow. */
export function testerDecision(ageGroup, { minAge = 13, parentConsentUnder = 16 } = {}) {
  const min = minAgeOf(ageGroup);
  if (ageGroup === 'u13' || min === null || min < minAge) return 'reject';
  if (min < parentConsentUnder) return 'parent';
  return 'accept';
}

// ---- Sign-ups -------------------------------------------------------------------

/** New sign-up goes to the list or the waitlist. */
export function decideSignup({ slots, activeCount }) {
  return !slots || activeCount < slots ? 'angemeldet' : 'warteliste';
}

/** Waitlist entries (oldest first) that move up into free slots. */
export function pickPromotions({ slots, activeCount, waitlist }) {
  const sorted = [...waitlist].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (!slots) return sorted;
  return sorted.slice(0, Math.max(0, slots - activeCount));
}

// ---- Schedules --------------------------------------------------------------------

/**
 * What the playtest job has to do now. Windows that were missed (bot offline) are only
 * marked as done, so nobody gets a "tomorrow" reminder an hour before the start.
 * Returns { actions: [...], flags: { column: 1 } }.
 */
export function playtestPlan(p, now = new Date()) {
  const actions = [];
  const flags = {};
  if (!p || p.status === 'abgesagt') return { actions, flags };
  const t = now.getTime();
  const start = toDate(p.starts_at).getTime();
  const end = start + (Number(p.duration_min) || 60) * MIN;
  if (!p.reminded_24h && t >= start - DAY) {
    flags.reminded_24h = 1;
    if (t < start - HOUR) actions.push('remind24h');
  }
  if (!p.reminded_1h && t >= start - HOUR) {
    flags.reminded_1h = 1;
    if (t < start) actions.push('remind1h');
  }
  if (!p.start_notified && t >= start) {
    flags.start_notified = 1;
    if (t < end) actions.push('start');
  }
  if (!p.feedback_requested && t >= end) {
    flags.feedback_requested = 1;
    actions.push(t < end + 12 * HOUR ? 'end' : 'endQuiet');
  }
  return { actions, flags };
}

/**
 * Plan for launch hours / creator events.
 * summaryDelayMin: wait after the end before posting the summary (to include late player counts).
 */
export function eventPlan(e, now = new Date(), { summaryDelayMin = 30 } = {}) {
  const actions = [];
  const flags = {};
  if (!e || e.status === 'abgesagt') return { actions, flags };
  const t = now.getTime();
  const start = toDate(e.starts_at).getTime();
  const end = start + (Number(e.duration_min) || 60) * MIN;
  if (!e.reminded_24h && t >= start - DAY) {
    flags.reminded_24h = 1;
    if (t < start - HOUR) actions.push('remind24h');
  }
  if (!e.reminded_1h && t >= start - HOUR) {
    flags.reminded_1h = 1;
    if (t < start - 10 * MIN) actions.push('remind1h');
  }
  if (!e.reminded_10m && t >= start - 10 * MIN) {
    flags.reminded_10m = 1;
    if (t < start) actions.push('remind10m');
  }
  if (!e.start_notified && t >= start) {
    flags.start_notified = 1;
    if (t < end) actions.push('start');
  }
  if (e.status !== 'beendet' && t >= end) actions.push('end');
  if (!e.summary_posted && t >= end + summaryDelayMin * MIN) {
    flags.summary_posted = 1;
    actions.push(t < end + DAY ? 'summary' : 'summaryQuiet');
  }
  return { actions, flags };
}

export function eventEnd(e) {
  return new Date(toDate(e.starts_at).getTime() + (Number(e.duration_min) || 60) * MIN);
}

/** Player-count window: 15 minutes before the start until 30 minutes after the end. */
export function inCcuWindow(e, now = new Date()) {
  const start = toDate(e.starts_at).getTime();
  const end = eventEnd(e).getTime();
  const t = now.getTime();
  return t >= start - 15 * MIN && t <= end + 30 * MIN;
}

function localParts(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute };
}

/** Same wall-clock time `days` later in the time zone (keeps 19:00 across DST changes). */
export function addLocalDays(value, days, timeZone = DEFAULT_TZ) {
  const p = localParts(toDate(value), timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedToUtc(
    { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: p.hour, minute: p.minute },
    timeZone,
  );
}

/** Next weekly occurrence after `now` (skips weeks the bot was offline). */
export function nextWeekly(startsAt, timeZone = DEFAULT_TZ, now = new Date()) {
  let next = addLocalDays(startsAt, 7, timeZone);
  for (let i = 0; i < 520 && next.getTime() <= now.getTime(); i++) next = addLocalDays(next, 7, timeZone);
  return next;
}

// ---- Player counts --------------------------------------------------------------

/** { peak, avg, count, last } for samples [{ playing, at }] (optionally within [from, to]). */
export function ccuStats(samples, { from, to } = {}) {
  const f = from ? toDate(from).getTime() : -Infinity;
  const tt = to ? toDate(to).getTime() : Infinity;
  const list = samples
    .filter((s) => {
      const at = toDate(s.at).getTime();
      return at >= f && at <= tt && Number.isFinite(Number(s.playing));
    })
    .map((s) => Number(s.playing));
  if (!list.length) return { peak: 0, avg: 0, count: 0, last: null };
  return {
    peak: Math.max(...list),
    avg: Math.round(list.reduce((a, b) => a + b, 0) / list.length),
    count: list.length,
    last: list[list.length - 1],
  };
}

/** Reads "playing" from games.roblox.com/v1/games?universeIds=… */
export function parseCcuResponse(json) {
  const playing = json?.data?.[0]?.playing;
  return Number.isFinite(Number(playing)) && playing !== null ? Number(playing) : null;
}

export async function fetchCcu(universeId, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(universeId)}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Roblox antwortet mit HTTP ${res.status}`);
  return parseCcuResponse(await res.json());
}

// ---- Feedback & bugs ---------------------------------------------------------------

/** Fun rating "7", "7/10", "7,5", "8 von 10" -> 1..10. */
export function validateFeedback({ fun, liked, disliked, bugs, other } = {}) {
  const m = String(fun ?? '')
    .trim()
    .toLowerCase()
    .replace(',', '.')
    .match(/^(\d{1,2}(?:\.\d+)?)\s*(?:(?:\/|von|of|out of)\s*10)?$/);
  if (!m) return { ok: false, error: 'errFun' };
  const n = Math.round(parseFloat(m[1]));
  if (n < 1 || n > 10) return { ok: false, error: 'errFun' };
  const clean = (s) => String(s ?? '').trim().slice(0, 1000) || null;
  return { ok: true, value: { fun_rating: n, liked: clean(liked), disliked: clean(disliked), bugs: clean(bugs), other: clean(other) } };
}

export const BUG_STATUSES = ['neu', 'bestaetigt', 'duplikat', 'kein_bug', 'behoben'];
export const BUG_ACTIONS = { confirm: 'bestaetigt', dup: 'duplikat', notbug: 'kein_bug', fixed: 'behoben' };
/** Statuses that count as a real bug (points once). */
export const BUG_REAL = new Set(['bestaetigt', 'behoben']);
