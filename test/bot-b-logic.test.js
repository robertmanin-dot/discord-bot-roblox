import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlaytestInput,
  parseEventInput,
  ageEligible,
  testerDecision,
  decideSignup,
  pickPromotions,
  playtestPlan,
  eventPlan,
  inCcuWindow,
  nextWeekly,
  addLocalDays,
  ccuStats,
  parseCcuResponse,
  fetchCcu,
  validateFeedback,
  ValidationError,
  strictUrl,
  HOUR,
  MIN,
} from '../src/bot/lib/b-logic.js';
import { formatTime } from '../src/core/time.js';

const NOW = new Date('2026-11-01T12:00:00.000Z');

test('parsePlaytestInput: valid input with defaults', () => {
  const p = parsePlaytestInput({ title: ' Waffen-Test ', date: '21.11.2026', time: '19:00' }, { now: NOW });
  assert.equal(p.title, 'Waffen-Test');
  assert.equal(p.starts_at, '2026-11-21T18:00:00.000Z');
  assert.equal(p.duration_min, 60);
  assert.equal(p.slots, null);
  assert.equal(p.join_link, null);
  assert.equal(p.min_age, 13);
  const q = parsePlaytestInput({ title: 'X', date: '2026-11-21', time: '19:30', duration_min: 90, slots: 20, join_link: 'roblox.com/share?code=abc', ab16: true }, { now: NOW });
  assert.equal(q.duration_min, 90);
  assert.equal(q.slots, 20);
  assert.equal(q.join_link, 'https://roblox.com/share?code=abc');
  assert.equal(q.min_age, 16);
  assert.equal(parsePlaytestInput({ title: 'X', date: '21.11.2026', time: '19:00', min_age: 16 }, { now: NOW }).min_age, 16);
});

test('parsePlaytestInput: validation errors carry keys and status 400', () => {
  const cases = [
    [{ title: '', date: '21.11.2026', time: '19:00' }, 'errTitle'],
    [{ title: 'x'.repeat(101), date: '21.11.2026', time: '19:00' }, 'errTitle'],
    [{ title: 'X', date: '31.02.2026', time: '19:00' }, 'errDate'],
    [{ title: 'X', date: '21.11.2026', time: 'abends' }, 'errDate'],
    [{ title: 'X', date: '01.10.2026', time: '19:00' }, 'errPast'],
    [{ title: 'X', date: '21.11.2026', time: '19:00', duration_min: 5 }, 'errDuration'],
    [{ title: 'X', date: '21.11.2026', time: '19:00', slots: 0 }, 'errSlots'],
    [{ title: 'X', date: '21.11.2026', time: '19:00', join_link: 'nur Text' }, 'errLink'],
  ];
  for (const [input, key] of cases) {
    assert.throws(() => parsePlaytestInput(input, { now: NOW }), (err) => err instanceof ValidationError && err.key === key && err.status === 400, key);
  }
});

test('parseEventInput: kind, weekly and default link', () => {
  const e = parseEventInput({ title: 'Launch Hour', kind: 'launch', date: '21.11.2026', time: '19:00', woechentlich: true }, { now: NOW, defaultLink: 'https://www.roblox.com/games/123' });
  assert.equal(e.kind, 'launch');
  assert.equal(e.repeat_weekly, 1);
  assert.equal(e.game_link, 'https://www.roblox.com/games/123');
  assert.throws(() => parseEventInput({ title: 'X', kind: 'party', date: '21.11.2026', time: '19:00' }, { now: NOW }), (err) => err.key === 'errKind');
  assert.equal(parseEventInput({ title: 'X', date: '21.11.2026', time: '19:00' }, { now: NOW }).kind, 'event');
});

test('strictUrl requires a real host name', () => {
  assert.equal(strictUrl('roblox.com/games/1'), 'https://roblox.com/games/1');
  assert.equal(strictUrl('Roblox'), null);
  assert.equal(strictUrl('javascript:alert(1)'), null);
});

test('age rules', () => {
  assert.deepEqual(ageEligible('u13', 13), { ok: false, reason: 'tooYoung' });
  assert.equal(ageEligible('13-15', 13).ok, true);
  assert.deepEqual(ageEligible('13-15', 16), { ok: false, reason: 'tooYoung' });
  assert.equal(ageEligible('16-17', 16).ok, true);
  assert.equal(ageEligible('unbekannt', 13).ok, true);
  assert.deepEqual(ageEligible('unbekannt', 16), { ok: false, reason: 'ageUnknown' });
  assert.equal(testerDecision('u13'), 'reject');
  assert.equal(testerDecision('13-15'), 'parent');
  assert.equal(testerDecision('16-17'), 'accept');
  assert.equal(testerDecision('16-17', { parentConsentUnder: 18 }), 'parent');
  assert.equal(testerDecision('18+', { parentConsentUnder: 18 }), 'accept');
  assert.equal(testerDecision('13-15', { minAge: 16 }), 'reject');
  assert.equal(testerDecision('unbekannt'), 'reject');
});

test('waitlist decisions and promotions (oldest first)', () => {
  assert.equal(decideSignup({ slots: null, activeCount: 99 }), 'angemeldet');
  assert.equal(decideSignup({ slots: 2, activeCount: 1 }), 'angemeldet');
  assert.equal(decideSignup({ slots: 2, activeCount: 2 }), 'warteliste');
  const waitlist = [
    { discord_user_id: 'b', created_at: '2026-01-02' },
    { discord_user_id: 'a', created_at: '2026-01-01' },
    { discord_user_id: 'c', created_at: '2026-01-03' },
  ];
  assert.deepEqual(pickPromotions({ slots: 3, activeCount: 2, waitlist }).map((s) => s.discord_user_id), ['a']);
  assert.deepEqual(pickPromotions({ slots: 3, activeCount: 3, waitlist }), []);
  assert.deepEqual(pickPromotions({ slots: null, activeCount: 5, waitlist }).map((s) => s.discord_user_id), ['a', 'b', 'c']);
});

test('playtestPlan: reminder windows, start, end and skipped windows', () => {
  const start = new Date('2026-11-21T18:00:00.000Z');
  const base = { status: 'geplant', starts_at: start.toISOString(), duration_min: 60, reminded_24h: 0, reminded_1h: 0, start_notified: 0, feedback_requested: 0 };
  const at = (ms) => new Date(start.getTime() + ms);
  assert.deepEqual(playtestPlan(base, at(-25 * HOUR)), { actions: [], flags: {} });
  assert.deepEqual(playtestPlan(base, at(-23 * HOUR)), { actions: ['remind24h'], flags: { reminded_24h: 1 } });
  // bot was offline until 30 minutes before: the 24 h reminder is skipped, the 1 h reminder goes out
  assert.deepEqual(playtestPlan(base, at(-30 * MIN)), { actions: ['remind1h'], flags: { reminded_24h: 1, reminded_1h: 1 } });
  const reminded = { ...base, reminded_24h: 1, reminded_1h: 1 };
  assert.deepEqual(playtestPlan(reminded, at(1 * MIN)), { actions: ['start'], flags: { start_notified: 1 } });
  const started = { ...reminded, start_notified: 1, status: 'laeuft' };
  assert.deepEqual(playtestPlan(started, at(30 * MIN)), { actions: [], flags: {} });
  assert.deepEqual(playtestPlan(started, at(61 * MIN)), { actions: ['end'], flags: { feedback_requested: 1 } });
  // offline through the whole playtest: no start DM, quiet end after 12 h
  assert.deepEqual(playtestPlan(reminded, at(2 * HOUR)), { actions: ['end'], flags: { start_notified: 1, feedback_requested: 1 } });
  assert.deepEqual(playtestPlan(reminded, at(20 * HOUR)), { actions: ['endQuiet'], flags: { start_notified: 1, feedback_requested: 1 } });
  assert.deepEqual(playtestPlan({ ...base, status: 'abgesagt' }, at(0)), { actions: [], flags: {} });
});

test('eventPlan: 24h/1h/10m reminders, start, end, summary delay', () => {
  const start = new Date('2026-11-21T18:00:00.000Z');
  const base = { status: 'geplant', starts_at: start.toISOString(), duration_min: 60, reminded_24h: 0, reminded_1h: 0, reminded_10m: 0, start_notified: 0, summary_posted: 0 };
  const at = (ms) => new Date(start.getTime() + ms);
  assert.deepEqual(eventPlan(base, at(-2 * HOUR)).actions, ['remind24h']);
  assert.deepEqual(eventPlan({ ...base, reminded_24h: 1 }, at(-50 * MIN)).actions, ['remind1h']);
  assert.deepEqual(eventPlan({ ...base, reminded_24h: 1 }, at(-5 * MIN)), { actions: ['remind10m'], flags: { reminded_1h: 1, reminded_10m: 1 } });
  const ready = { ...base, reminded_24h: 1, reminded_1h: 1, reminded_10m: 1 };
  assert.deepEqual(eventPlan(ready, at(0)), { actions: ['start'], flags: { start_notified: 1 } });
  const running = { ...ready, start_notified: 1, status: 'laeuft' };
  assert.deepEqual(eventPlan(running, at(60 * MIN)), { actions: ['end'], flags: {} });
  const ended = { ...running, status: 'beendet' };
  assert.deepEqual(eventPlan(ended, at(80 * MIN)), { actions: [], flags: {} });
  assert.deepEqual(eventPlan(ended, at(90 * MIN)), { actions: ['summary'], flags: { summary_posted: 1 } });
  assert.deepEqual(eventPlan(running, at(60 * MIN), { summaryDelayMin: 0 }), { actions: ['end', 'summary'], flags: { summary_posted: 1 } });
  assert.deepEqual(eventPlan(ended, at(3 * 24 * HOUR)).actions, ['summaryQuiet']);
});

test('player-count window and statistics', () => {
  const e = { starts_at: '2026-11-21T18:00:00.000Z', duration_min: 60 };
  assert.equal(inCcuWindow(e, new Date('2026-11-21T17:44:00.000Z')), false);
  assert.equal(inCcuWindow(e, new Date('2026-11-21T17:45:00.000Z')), true);
  assert.equal(inCcuWindow(e, new Date('2026-11-21T19:30:00.000Z')), true);
  assert.equal(inCcuWindow(e, new Date('2026-11-21T19:31:00.000Z')), false);
  const samples = [
    { playing: 10, at: '2026-11-21T17:50:00.000Z' },
    { playing: 120, at: '2026-11-21T18:10:00.000Z' },
    { playing: 80, at: '2026-11-21T18:40:00.000Z' },
    { playing: 30, at: '2026-11-21T19:20:00.000Z' },
  ];
  assert.deepEqual(ccuStats(samples), { peak: 120, avg: 60, count: 4, last: 30 });
  assert.deepEqual(ccuStats(samples, { from: '2026-11-21T18:00:00.000Z', to: '2026-11-21T19:00:00.000Z' }), { peak: 120, avg: 100, count: 2, last: 80 });
  assert.deepEqual(ccuStats([]), { peak: 0, avg: 0, count: 0, last: null });
  assert.equal(parseCcuResponse({ data: [{ playing: 42 }] }), 42);
  assert.equal(parseCcuResponse({ data: [] }), null);
});

test('fetchCcu uses the injected fetch', async () => {
  let url = null;
  const playing = await fetchCcu('987', async (u) => {
    url = u;
    return { ok: true, json: async () => ({ data: [{ playing: 7 }] }) };
  });
  assert.equal(playing, 7);
  assert.equal(url, 'https://games.roblox.com/v1/games?universeIds=987');
  await assert.rejects(() => fetchCcu('1', async () => ({ ok: false, status: 503 })), /503/);
});

test('weekly events keep the local time across the DST change', () => {
  // 24.10.2026 19:00 CEST (UTC+2) -> 31.10.2026 19:00 CET (UTC+1, DST ends on 25.10.)
  const next = addLocalDays('2026-10-24T17:00:00.000Z', 7, 'Europe/Berlin');
  assert.equal(next.toISOString(), '2026-10-31T18:00:00.000Z');
  assert.equal(formatTime(next, 'de', 'Europe/Berlin'), '19:00');
  // spring: 21.03.2027 19:00 CET -> 28.03.2027 19:00 CEST
  assert.equal(addLocalDays('2027-03-21T18:00:00.000Z', 7, 'Europe/Berlin').toISOString(), '2027-03-28T17:00:00.000Z');
  // skips weeks in the past
  const skipped = nextWeekly('2026-10-24T17:00:00.000Z', 'Europe/Berlin', new Date('2026-11-10T00:00:00.000Z'));
  assert.equal(skipped.toISOString(), '2026-11-14T18:00:00.000Z');
});

test('feedback validation', () => {
  assert.equal(validateFeedback({ fun: '8' }).value.fun_rating, 8);
  assert.equal(validateFeedback({ fun: '7/10' }).value.fun_rating, 7);
  assert.equal(validateFeedback({ fun: '7,5' }).value.fun_rating, 8);
  assert.equal(validateFeedback({ fun: '9 von 10' }).value.fun_rating, 9);
  assert.equal(validateFeedback({ fun: '10' }).value.fun_rating, 10);
  for (const bad of ['0', '11', 'super', '', '-3']) assert.deepEqual(validateFeedback({ fun: bad }), { ok: false, error: 'errFun' }, bad);
  const v = validateFeedback({ fun: '6', liked: '  Waffen  ', disliked: '', bugs: 'x'.repeat(1200) }).value;
  assert.equal(v.liked, 'Waffen');
  assert.equal(v.disliked, null);
  assert.equal(v.bugs.length, 1000);
});
