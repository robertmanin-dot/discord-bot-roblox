import { test, beforeEach, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, mockFetch, youtubeWorld, twitchWorld } from './fixtures/radar-fixtures.js';
import { getDb } from '../src/core/db.js';
import { getCreatorFull, suppressAndDeleteCreator, findCreatorByAccount } from '../src/core/creators.js';
import { initLanguage } from '../src/radar/language.js';
import { importUrls, importCsv, parseCsv, capture, importProfile } from '../src/radar/importers.js';
import { resetTwitchToken } from '../src/radar/twitch.js';

before(async () => {
  await initLanguage();
});
beforeEach(() => {
  freshDb();
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_CLIENT_SECRET;
  resetTwitchToken();
});
afterEach(() => {
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_CLIENT_SECRET;
});

test('CSV parser: delimiters, quotes, BOM, line breaks in quotes', () => {
  assert.deepEqual(parseCsv('﻿name;url\n"Max ""MX""";https://tiktok.com/@max\n'), [['name', 'url'], ['Max "MX"', 'https://tiktok.com/@max']]);
  assert.deepEqual(parseCsv('a,b\r\n1,"x,y"\r\n2,"zeile\nzwei"'), [['a', 'b'], ['1', 'x,y'], ['2', 'zeile\nzwei']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('URL list without API keys stores basic profiles, merges duplicates, reports errors', async () => {
  const r = await importUrls([
    'https://www.tiktok.com/@roblox.max; 12,3K; max.business@gmail.com',
    'instagram.com/max.gaming/',
    '# Kommentar',
    'https://www.tiktok.com/@ROBLOX.MAX',
    'https://example.com/irgendwas',
    'https://www.youtube.com/@lukasplays',
    '',
  ].join('\n'), { language: 'de', tags: 'welle1' });
  assert.equal(r.added, 3);
  assert.equal(r.updated, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 5);
  const max = findCreatorByAccount('tiktok', { handle: 'roblox.max' });
  const full = getCreatorFull(max.id);
  assert.equal(full.accounts[0].followers, 12300);
  assert.equal(full.creator.language, 'de');
  assert.equal(full.creator.language_source, 'manual');
  assert.deepEqual(full.creator.tags, ['welle1']);
  assert.equal(full.creator.contact_channel, 'email');
  assert.equal(full.creator.contact_target, 'max.business@gmail.com');
  assert.ok(findCreatorByAccount('youtube', { handle: 'lukasplays' }), 'YouTube link stored without key');
});

test('opted-out creators are skipped on import', async () => {
  await importUrls('https://www.tiktok.com/@gone.forever');
  const c = findCreatorByAccount('tiktok', { handle: 'gone.forever' });
  suppressAndDeleteCreator(c.id);
  const r = await importUrls('https://www.tiktok.com/@gone.forever');
  assert.equal(r.skipped, 1);
  await assert.rejects(capture({ url: 'https://www.tiktok.com/@gone.forever' }), (err) => err.status === 409);
});

test('CSV import maps German headers', async () => {
  const csv = 'Name;Plattform;Handle;E-Mail;Abonnenten;Sprache;Tags;Alter\nAnna;TikTok;@anna.rbx;anna@biz.de;4.500;en;shooter|welle2;16-17\nOhne;;;;;;;\n';
  const r = await importCsv(csv);
  assert.equal(r.added, 1);
  assert.equal(r.errors.length, 1);
  const anna = findCreatorByAccount('tiktok', { handle: 'anna.rbx' });
  const full = getCreatorFull(anna.id);
  assert.equal(full.creator.display_name, 'Anna');
  assert.equal(full.accounts[0].followers, 4500);
  assert.equal(full.creator.language, 'en');
  assert.deepEqual(full.creator.tags, ['shooter', 'welle2']);
  assert.equal(full.creator.age_group, '16-17');
  assert.equal((await importCsv('foo;bar\n1;2')).errors[0].line, 1);
});

test('capture from the bookmark popup: bio with DM invitation, follower text, language detection', async () => {
  const res = await capture({
    platform: 'tiktok',
    url: 'https://www.tiktok.com/@blox.lena?lang=de',
    name: 'Lena 🎀',
    followers: '8,1K',
    bio: 'Roblox jeden Tag 💕 Kooperationen gerne per DM | yt: youtube.com/@lenayt',
  });
  assert.equal(res.created, true);
  assert.equal(res.creator.display_name, 'Lena 🎀');
  assert.equal(res.creator.followers, 8100);
  assert.equal(res.creator.contact_channel, 'dm');
  assert.equal(res.creator.contact_platform, 'tiktok');
  assert.equal(res.creator.contact_target, 'https://www.tiktok.com/@blox.lena');
  const again = await capture({ platform: 'tiktok', url: 'https://www.tiktok.com/@blox.lena', followers: '8.200' });
  assert.equal(again.created, false);
  assert.equal(again.creator.followers, 8200);
  await assert.rejects(capture({ url: 'https://example.com' }), (err) => err.status === 400);
});

test('YouTube links are completed via the API when a key is set', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  const world = youtubeWorld();
  const fetchImpl = mockFetch(world.handler);
  const r = await importProfile({ url: 'https://www.youtube.com/@LukasPlays', tags: ['manuell'] }, { fetchImpl });
  assert.equal(r.status, 'added');
  const full = getCreatorFull(r.id);
  const yt = full.accounts.find((a) => a.platform === 'youtube');
  assert.equal(yt.external_id, 'UC_DE1');
  assert.equal(yt.followers, 3200);
  assert.equal(full.creator.language, 'de');
  assert.equal(full.creator.contact_target, 'lukas.business@gmail.com');
  assert.deepEqual(full.creator.tags, ['manuell']);
  assert.ok(fetchImpl.calls.some(({ url }) => url.searchParams.get('forHandle') === '@lukasplays'));
  await assert.rejects(importProfile({ url: 'https://www.youtube.com/@doesnotexist' }, { fetchImpl }), (err) => err.status === 404);
});

test('Twitch links are completed via the API when credentials are set', async () => {
  process.env.TWITCH_CLIENT_ID = 'cid';
  process.env.TWITCH_CLIENT_SECRET = 'secret';
  const world = twitchWorld();
  const fetchImpl = mockFetch(world.handler);
  const r = await importProfile({ url: 'https://twitch.tv/TinyFox' }, { fetchImpl });
  assert.equal(r.status, 'added');
  const full = getCreatorFull(r.id);
  assert.equal(full.accounts[0].external_id, '103');
  assert.equal(full.creator.contact_target, 'tinyfox.gaming@outlook.com');
  assert.equal(getDb().value('SELECT COUNT(*) FROM creators'), 1);
});
