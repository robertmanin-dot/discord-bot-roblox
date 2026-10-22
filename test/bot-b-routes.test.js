import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb, getDb } from '../src/core/db.js';
import { resetSettingsCache } from '../src/core/settings.js';
import { services } from '../src/core/services.js';
import { getPoints } from '../src/core/points.js';
import playtestsRoutes from '../src/web/routes/playtests.js';
import * as store from '../src/bot/lib/b-store.js';
import { parsePlaytestInput } from '../src/bot/lib/b-logic.js';

let server;
let base;
const originalBot = { ...services.bot };

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', playtestsRoutes());
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server?.close();
  Object.assign(services.bot, originalBot);
  delete services.bot.createPlaytest;
  delete services.bot.createEvent;
  delete services.bot.updateBugStatus;
});

beforeEach(() => {
  openDb(':memory:');
  resetSettingsCache();
  Object.assign(services.bot, { isReady: () => false });
  delete services.bot.createPlaytest;
  delete services.bot.createEvent;
  delete services.bot.updateBugStatus;
});

const json = async (path, opts = {}) => {
  const res = await fetch(base + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
};

function seedPlaytest() {
  const p = store.insertPlaytest(parsePlaytestInput({ title: 'Waffen-Test', starts_at: new Date(Date.now() + 3600_000).toISOString(), slots: 1 }));
  store.upsertTester({ userId: 'a', tag: 'anna#1', ageGroup: '18+' });
  store.upsertTester({ userId: 'b', tag: 'ben#2', ageGroup: '16-17' });
  store.signUp(p.id, 'a');
  store.signUp(p.id, 'b');
  store.saveFeedback(p.id, 'a', { fun_rating: 8, liked: 'Turm; bauen', disliked: 'Spawn "zu weit"', bugs: null, other: null });
  return p;
}

test('GET /playtests and /playtests/:id with counts, names and average rating', async () => {
  const p = seedPlaytest();
  const list = await json('/playtests');
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].signups, 1);
  assert.equal(list.body.items[0].waitlist, 1);
  assert.equal(list.body.items[0].feedback, 1);
  const detail = await json(`/playtests/${p.id}`);
  assert.equal(detail.body.signups.length, 2);
  assert.equal(detail.body.signups[0].name, 'anna#1');
  assert.equal(detail.body.signups[1].age_group, '16-17');
  assert.equal(detail.body.avgFun, 8);
  assert.equal((await json('/playtests/999')).status, 404);
  assert.equal((await json('/playtests/abc')).status, 400);
  assert.equal((await json('/playtests?status=quatsch')).status, 400);
});

test('GET /playtests/:id/feedback.csv is Excel-friendly', async () => {
  const p = seedPlaytest();
  const res = await fetch(`${base}/playtests/${p.id}/feedback.csv`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /playtest-\d+-feedback\.csv/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for umlauts in Excel');
  const text = bytes.toString('utf8');
  assert.match(text, /Zeitpunkt;Name;Discord-ID;Spaß \(1-10\)/);
  assert.match(text, /anna#1;a;8;"Turm; bauen";"Spawn ""zu weit"""/);
});

test('POST /playtests and /events need the bot; validation errors become 400', async () => {
  assert.equal((await json('/playtests', { method: 'POST', body: { title: 'X' } })).status, 503);
  assert.equal((await json('/events', { method: 'POST', body: { title: 'X' } })).status, 503);

  services.bot.isReady = () => true;
  services.bot.createPlaytest = async (data) => {
    const parsed = parsePlaytestInput(data);
    return store.insertPlaytest(parsed);
  };
  services.bot.createEvent = async (data) => store.insertEvent({ ...data, kind: 'event', repeat_weekly: 0, duration_min: 60, starts_at: new Date(Date.now() + 3600_000).toISOString() });
  const ok = await json('/playtests', { method: 'POST', body: { title: 'Neu', starts_at: new Date(Date.now() + 7200_000).toISOString() } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.playtest.title, 'Neu');
  assert.equal(ok.body.playtest.signups, 0);
  const bad = await json('/playtests', { method: 'POST', body: { title: 'Neu', date: '31.02.2026', time: '19:00' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Datum/);
  const ev = await json('/events', { method: 'POST', body: { title: 'Launch' } });
  assert.equal(ev.status, 201);
  assert.equal(ev.body.event.title, 'Launch');
});

test('bugs: list with filter, PATCH works with the bot offline and awards points once', async () => {
  const bug = store.insertBug({ userId: 't', title: 'Lag', description: 'x', steps: null, device: null });
  store.upsertTester({ userId: 't', tag: 'tim#3', ageGroup: '18+' });
  const list = await json('/bugs');
  assert.equal(list.body.items[0].reporter, 'tim#3');
  assert.equal((await json('/bugs?status=neu')).body.items.length, 1);
  assert.equal((await json('/bugs?status=behoben')).body.items.length, 0);
  assert.equal((await json('/bugs?status=quatsch')).status, 400);

  const patched = await json(`/bugs/${bug.id}`, { method: 'PATCH', body: { status: 'bestaetigt' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.bug.status, 'bestaetigt');
  assert.equal(getPoints('t', 'tester'), 20);
  await json(`/bugs/${bug.id}`, { method: 'PATCH', body: { status: 'behoben' } });
  assert.equal(getPoints('t', 'tester'), 20);
  assert.equal((await json(`/bugs/${bug.id}`, { method: 'PATCH', body: { status: 'egal' } })).status, 400);
  assert.equal((await json('/bugs/999', { method: 'PATCH', body: { status: 'neu' } })).status, 404);

  let called = null;
  services.bot.isReady = () => true;
  services.bot.updateBugStatus = async (id, status) => {
    called = [id, status];
    return store.applyBugStatus(id, status, null).bug;
  };
  await json(`/bugs/${bug.id}`, { method: 'PATCH', body: { status: 'duplikat' } });
  assert.deepEqual(called, [bug.id, 'duplikat']);
});

test('events: list and detail with player counts and live sessions', async () => {
  const start = new Date('2026-11-21T18:00:00.000Z');
  const e = store.insertEvent({ kind: 'launch', title: 'Launch Hour', starts_at: start.toISOString(), duration_min: 60, repeat_weekly: 0, game_link: null }, null, new Date('2026-11-01T00:00:00Z'));
  store.insertCcuSample(e.id, 50, '2026-11-21T18:05:00.000Z');
  store.insertCcuSample(e.id, 90, '2026-11-21T18:10:00.000Z');
  getDb().run("INSERT INTO live_sessions (discord_user_id, platform, url, started_at) VALUES ('u1', 'twitch', 'https://twitch.tv/u1', '2026-11-21T18:02:00.000Z')");
  getDb().run("INSERT INTO live_sessions (discord_user_id, platform, url, started_at, ended_at) VALUES ('u2', 'youtube', 'https://youtu.be/x', '2026-11-20T18:00:00.000Z', '2026-11-20T19:00:00.000Z')");
  const list = await json('/events');
  assert.equal(list.body.items[0].title, 'Launch Hour');
  const detail = await json(`/events/${e.id}`);
  assert.deepEqual(detail.body.ccu.map((s) => s.playing), [50, 90]);
  assert.deepEqual(detail.body.live.map((l) => l.discord_user_id), ['u1']);
  assert.equal((await json('/events/77')).status, 404);
});
