import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getDb } from '../src/core/db.js';
import { resetSettingsCache, updateSettings } from '../src/core/settings.js';
import { createCreator, updateCreator } from '../src/core/creators.js';
import { addPoints } from '../src/core/points.js';
import { services } from '../src/core/services.js';
import { createApp } from '../src/web/server.js';

let server;
let base;
const original = { ...services.bot };

before(async () => {
  openDb(':memory:');
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server.close());

beforeEach(() => {
  openDb(':memory:');
  resetSettingsCache();
  Object.assign(services.bot, original);
  delete services.bot.reviewApplication;
  delete services.bot.createPersonalInvite;
});

const get = (path) => fetch(base + path).then(async (r) => ({ status: r.status, body: await r.json() }));
const post = (path, body = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-clk': '1' }, body: JSON.stringify(body) }).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));

test('overview without bot lists what is missing', async () => {
  const { status, body } = await get('/discord/overview');
  assert.equal(status, 200);
  assert.equal(body.setupDone, false);
  assert.ok(body.missing.some((m) => /Token/.test(m)));
  assert.ok(body.missing.some((m) => /\/setup/.test(m)));
  assert.equal(body.counts.applications.offen, 0);
  assert.deepEqual(body.upcoming, { playtests: [], events: [] });
});

test('applications, leaderboard and content lists', async () => {
  const cid = createCreator({ display_name: 'Lukas' });
  updateCreator(cid, { discord_user_id: 'u1', is_member: 1, founding: 1 });
  getDb().run("INSERT INTO applications (discord_user_id, discord_tag, creator_id, status, age_group) VALUES ('u1', 'lukas', :cid, 'offen', '18+')", { cid });
  getDb().run("INSERT INTO applications (discord_user_id, discord_tag, status, age_group) VALUES ('u2', 'mia', 'eltern_ausstehend', '13-15')");
  getDb().run("INSERT INTO testers (discord_user_id, discord_tag) VALUES ('t1', 'tester_tim')");
  addPoints({ userId: 'u1', kind: 'creator', points: 120 });
  addPoints({ userId: 't1', kind: 'tester', points: 30 });
  getDb().run("INSERT INTO content_submissions (discord_user_id, creator_id, url, kind) VALUES ('u1', :cid, 'https://youtu.be/x', 'video')", { cid });

  const apps = await get('/discord/applications');
  assert.equal(apps.body.items.length, 2);
  assert.equal(apps.body.items.find((a) => a.discord_user_id === 'u1').display_name, 'Lukas');
  const open = await get('/discord/applications?status=eltern_ausstehend');
  assert.equal(open.body.items.length, 1);

  const lb = await get('/discord/leaderboard?kind=creator');
  assert.deepEqual(lb.body.items[0], { discord_user_id: 'u1', name: 'Lukas', points: 120, tier: 'Silber', rank: 1 });
  const lbt = await get('/discord/leaderboard?kind=tester');
  assert.equal(lbt.body.items[0].name, 'tester_tim');

  const content = await get('/discord/content?status=offen');
  assert.equal(content.body.items[0].display_name, 'Lukas');

  const overview = await get('/discord/overview');
  assert.equal(overview.body.counts.applications.offen, 1);
  assert.equal(overview.body.counts.applications.eltern_ausstehend, 1);
  assert.equal(overview.body.counts.members, 1);
  assert.equal(overview.body.counts.founding, 1);
  assert.equal(overview.body.counts.testers, 1);
});

test('actions need the bot (503) and work when it is ready', async () => {
  assert.equal((await post('/discord/applications/1/accept')).status, 503);
  assert.equal((await post('/discord/invite/1')).status, 503);
  assert.equal((await post('/discord/applications/1/explode')).status, 400);

  const calls = [];
  services.bot.isReady = () => true;
  services.bot.reviewApplication = async (id, action, staff) => {
    calls.push([id, action, staff]);
    return { id, status: action === 'accept' ? 'angenommen' : 'offen' };
  };
  services.bot.createPersonalInvite = async (id) => ({ code: `C${id}`, url: `https://discord.gg/C${id}`, reused: false });
  const accepted = await post('/discord/applications/7/accept');
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.application.status, 'angenommen');
  await post('/discord/applications/7/parent-ok');
  assert.deepEqual(calls, [[7, 'accept', null], [7, 'parent-ok', null]]);
  const inv = await post('/discord/invite/3');
  assert.deepEqual(inv.body, { code: 'C3', url: 'https://discord.gg/C3', reused: false });
});

test('errors from the bot keep their HTTP status', async () => {
  services.bot.isReady = () => true;
  services.bot.reviewApplication = async () => {
    const err = new Error('Erst das Eltern-Einverständnis bestätigen.');
    err.status = 409;
    throw err;
  };
  const res = await post('/discord/applications/2/accept');
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Eltern/);
});

test('setupDone reflects saved ids', async () => {
  updateSettings({ discord: { roles: { creator: '1' }, channels: { apply: '2' } } });
  assert.equal((await get('/discord/overview')).body.setupDone, true);
});
