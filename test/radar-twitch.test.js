import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, mockFetch, twitchWorld } from './fixtures/radar-fixtures.js';
import { getSettings, updateSettings } from '../src/core/settings.js';
import { getCreatorFull, findCreatorByAccount } from '../src/core/creators.js';
import { runTwitchDiscovery, getStreamsByLogins, getAppToken, resetTwitchToken, getUsersByLogins, helix } from '../src/radar/twitch.js';

beforeEach(() => {
  freshDb();
  resetTwitchToken();
  process.env.TWITCH_CLIENT_ID = 'cid';
  process.env.TWITCH_CLIENT_SECRET = 'secret';
  updateSettings({ radar: { twitch: { languages: ['de', 'en'], minViewers: 1, maxViewers: 250 } } });
});
afterEach(() => {
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_CLIENT_SECRET;
});

test('discovery: two pages, viewer filter, bios, language, stored category id', async () => {
  const world = twitchWorld();
  const fetchImpl = mockFetch(world.handler);
  const s = await runTwitchDiscovery({ fetchImpl });
  assert.equal(s.streams, 4);
  assert.equal(s.found, 2, 'maxlive (12) and tinyfox (3); big (5000) and zero (0) filtered');
  assert.equal(s.added, 2);
  assert.equal(getSettings().radar.twitch.gameId, '23020');
  assert.equal(world.state.tokens, 1, 'token is cached');

  const max = getCreatorFull(findCreatorByAccount('twitch', { handle: 'maxlive' }).id);
  const acc = max.accounts.find((a) => a.platform === 'twitch');
  assert.equal(acc.avg_live_viewers, 12);
  assert.equal(acc.times_seen_live, 1);
  assert.equal(acc.platform_language, 'de');
  assert.deepEqual(acc.genres.sort(), ['shooter', 'viewers']);
  assert.equal(max.creator.language, 'de');
  assert.equal(max.creator.contact_channel, 'dm');
  assert.equal(max.creator.contact_platform, 'instagram');
  assert.equal(max.creator.contact_target, 'https://www.instagram.com/max.live/');

  const fox = getCreatorFull(findCreatorByAccount('twitch', { handle: 'tinyfox' }).id);
  assert.equal(fox.creator.language, 'en');
  assert.equal(fox.creator.contact_target, 'tinyfox.gaming@outlook.com');

  // Same stream session seen again: no extra sighting. New session: counted, average updated.
  await runTwitchDiscovery({ fetchImpl });
  assert.equal(getCreatorFull(max.creator.id).accounts.find((a) => a.platform === 'twitch').times_seen_live, 1);
  const later = twitchWorld({ startedAt: '2026-10-23T17:00:00Z' });
  later.streams[0].viewer_count = 20;
  await runTwitchDiscovery({ fetchImpl: mockFetch(later.handler) });
  const acc2 = getCreatorFull(max.creator.id).accounts.find((a) => a.platform === 'twitch');
  assert.equal(acc2.times_seen_live, 2);
  assert.equal(acc2.avg_live_viewers, 16);
  assert.equal(acc2.max_live_viewers, 20);
});

test('viewer range parameters override settings', async () => {
  const fetchImpl = mockFetch(twitchWorld().handler);
  const s = await runTwitchDiscovery({ fetchImpl, languages: ['de'], minViewers: 100, maxViewers: 10000 });
  assert.equal(s.found, 1);
  assert.ok(findCreatorByAccount('twitch', { handle: 'bigstreamer' }));
});

test('getStreamsByLogins for the bot (chunks of 100)', async () => {
  const world = twitchWorld();
  const fetchImpl = mockFetch(world.handler);
  const logins = ['MaxLive', 'tinyfox', ...Array.from({ length: 150 }, (_, i) => `user${i}`)];
  const live = await getStreamsByLogins(logins, { fetchImpl });
  assert.deepEqual(live.map((x) => x.user_login).sort(), ['maxlive', 'tinyfox']);
  assert.equal(live.find((x) => x.user_login === 'maxlive').url, 'https://www.twitch.tv/maxlive');
  assert.equal(fetchImpl.count((u) => u.pathname === '/helix/streams'), 2);
  const users = await getUsersByLogins(['tinyfox'], { fetchImpl });
  assert.equal(users[0].id, '103');
});

test('expired token is refreshed once on 401', async () => {
  const world = twitchWorld();
  const fetchImpl = mockFetch(world.handler);
  await getAppToken({ fetchImpl });
  world.state.reject401Once = true;
  const res = await helix('games', { name: 'Roblox' }, { fetchImpl });
  assert.equal(res.data[0].id, '23020');
  assert.equal(world.state.tokens, 2);
});

test('missing or wrong credentials', async () => {
  delete process.env.TWITCH_CLIENT_SECRET;
  await assert.rejects(getAppToken({ fetchImpl: mockFetch(() => ({})) }), /Client-ID und Client-Secret fehlen/);
  process.env.TWITCH_CLIENT_SECRET = 'wrong';
  const fetchImpl = mockFetch(() => new Response(JSON.stringify({ status: 403, message: 'invalid client secret' }), { status: 403 }));
  await assert.rejects(getAppToken({ fetchImpl }), /lehnt Client-ID\/Secret ab/);
});
