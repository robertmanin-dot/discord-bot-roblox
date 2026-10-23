import { test, beforeEach, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, mockFetch, youtubeWorld, json } from './fixtures/radar-fixtures.js';
import { getDb } from '../src/core/db.js';
import { updateSettings } from '../src/core/settings.js';
import { getCreatorFull, findCreatorByAccount, suppressAndDeleteCreator } from '../src/core/creators.js';
import { initLanguage } from '../src/radar/language.js';
import { runYoutubeDiscovery, youtubeClient, QuotaError, analyzeYoutubeChannel } from '../src/radar/youtube.js';
import { getUsage, youtubeDay } from '../src/radar/usage.js';

before(async () => {
  await initLanguage();
});
beforeEach(() => {
  freshDb();
  process.env.YOUTUBE_API_KEY = 'test-key';
  updateSettings({
    radar: {
      languages: ['de', 'en'],
      youtube: { queries: { de: ['neue roblox spiele'], en: ['new roblox games'] }, pagesPerQuery: 1, maxSearchesPerRun: 10 },
    },
  });
});
afterEach(() => {
  delete process.env.YOUTUBE_API_KEY;
});

test('discovery end-to-end: filters, saves data, counts quota', async () => {
  const world = youtubeWorld();
  const fetchImpl = mockFetch(world.handler);
  const logs = [];
  const summary = await runYoutubeDiscovery({ fetchImpl, onLog: (l) => logs.push(l) });
  assert.equal(summary.searches, 4, '1 query per language × newest + most relevant');
  assert.equal(summary.found, 3, 'DE1, EN1, COOK are inside the follower range');
  assert.equal(summary.added, 2);
  assert.equal(summary.skipped, 3, 'BIG + HIDDEN out of range, COOK not a Roblox channel');
  assert.equal(getUsage(youtubeDay(), 'youtube_search'), 4);
  assert.equal(getUsage(youtubeDay(), 'youtube_units'), summary.units);
  assert.ok(logs.some((l) => /Fertig/.test(l)));

  const de = getCreatorFull(findCreatorByAccount('youtube', { externalId: 'UC_DE1' }).id);
  const acc = de.accounts.find((a) => a.platform === 'youtube');
  assert.equal(acc.followers, 3200);
  assert.equal(acc.handle, 'lukasplays');
  assert.equal(acc.roblox_share, 1);
  assert.equal(acc.live_share, 0.25);
  assert.equal(acc.avg_views, 1600);
  assert.equal(acc.latest_url, 'https://www.youtube.com/watch?v=v_de1');
  assert.deepEqual(acc.genres.sort(), ['buildfight', 'newgames', 'shooter', 'viewers']);
  assert.equal(de.creator.language, 'de');
  assert.equal(de.creator.country, 'DE');
  assert.equal(de.creator.contact_channel, 'email');
  assert.equal(de.creator.contact_target, 'lukas.business@gmail.com');
  assert.ok(de.contacts.find((c) => c.type === 'tiktok' && c.value === 'lukas_tt'));
  assert.ok(de.contacts.find((c) => c.type === 'discord' && c.value === 'LukasCommunity'));
  assert.ok(de.creator.score >= 80, `score ${de.creator.score}`);

  const en = getCreatorFull(findCreatorByAccount('youtube', { externalId: 'UC_EN1' }).id);
  assert.equal(en.creator.language, 'en');
  assert.equal(en.creator.contact_channel, 'dm');
  assert.equal(en.creator.contact_platform, 'instagram');
  assert.equal(en.creator.contact_target, 'https://www.instagram.com/bloxreviewer/');
  assert.ok(!findCreatorByAccount('youtube', { externalId: 'UC_COOK' }));
  assert.ok(!findCreatorByAccount('youtube', { externalId: 'UC_BIG' }));

  // Second run within 3 days: no new video calls, numbers updated.
  const videosBefore = fetchImpl.count((u) => u.pathname.endsWith('/videos'));
  const second = await runYoutubeDiscovery({ fetchImpl });
  assert.equal(second.updated, 2);
  assert.equal(second.added, 0);
  assert.equal(fetchImpl.count((u) => u.pathname.endsWith('/videos')), videosBefore + 1, 'only the cooking channel is checked again');
});

test('daily search limit stops the run cleanly', async () => {
  updateSettings({ radar: { youtube: { dailySearchLimit: 1 } } });
  const fetchImpl = mockFetch(youtubeWorld().handler);
  const logs = [];
  const s = await runYoutubeDiscovery({ fetchImpl, onLog: (l) => logs.push(l) });
  assert.equal(s.searches, 1);
  const again = await runYoutubeDiscovery({ fetchImpl, onLog: (l) => logs.push(l) });
  assert.equal(again.searches, 0);
  assert.ok(logs.some((l) => /Tageslimit/.test(l)));
});

test('Google quota error is mapped and blocks further calls today', async () => {
  const fetchImpl = mockFetch((url) => {
    if (url.pathname.endsWith('/search')) return json({ error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }] } }, 403);
    return undefined;
  });
  const logs = [];
  const s = await runYoutubeDiscovery({ fetchImpl, onLog: (l) => logs.push(l) });
  assert.equal(s.searches, 0);
  assert.ok(logs.some((l) => /Kontingent/.test(l)));
  assert.equal(getUsage(youtubeDay(), 'youtube_search'), 100);
  await assert.rejects(youtubeClient({ fetchImpl }).search({ q: 'x' }), QuotaError);
});

test('invalid key and disabled API give clear German errors', async () => {
  process.env.YOUTUBE_API_KEY = 'BAD';
  const fetchImpl = mockFetch(youtubeWorld().handler);
  await assert.rejects(runYoutubeDiscovery({ fetchImpl }), /API-Schlüssel ist ungültig/);
  process.env.YOUTUBE_API_KEY = 'ok';
  const disabled = mockFetch(() => json({ error: { code: 403, message: 'YouTube Data API v3 has not been used in project 123 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } }, 403));
  await assert.rejects(runYoutubeDiscovery({ fetchImpl: disabled }), /nicht aktiviert/);
  delete process.env.YOUTUBE_API_KEY;
  assert.throws(() => youtubeClient(), /Kein YouTube-API-Schlüssel/);
});

test('opted-out channels are not re-added', async () => {
  const fetchImpl = mockFetch(youtubeWorld().handler);
  await runYoutubeDiscovery({ fetchImpl });
  const id = findCreatorByAccount('youtube', { externalId: 'UC_DE1' }).id;
  suppressAndDeleteCreator(id);
  getDb().run("DELETE FROM accounts WHERE external_id = 'UC_EN1'");
  const s = await runYoutubeDiscovery({ fetchImpl });
  assert.ok(!findCreatorByAccount('youtube', { externalId: 'UC_DE1' }));
  assert.ok(s.skipped >= 1);
});

test('analyzeYoutubeChannel without videos falls back to channel texts', () => {
  const a = analyzeYoutubeChannel({ id: 'UC_X', snippet: { title: 'X', description: 'Roblox jeden Tag' }, statistics: { subscriberCount: '999' } }, []);
  assert.equal(a.account.roblox_share, 0.5);
  assert.equal(a.account.url, 'https://www.youtube.com/channel/UC_X');
  assert.equal(a.account.followers, 999);
});
