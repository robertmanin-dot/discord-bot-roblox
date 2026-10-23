// Repeated YouTube runs must continue with new searches/pages instead of repeating the same ones.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getDb } from '../src/core/db.js';
import { resetSettingsCache, updateSettings } from '../src/core/settings.js';
import { runYoutubeDiscovery, searchStreams } from '../src/radar/youtube.js';

let calls;

function fakeYoutube({ pagesPerStream = 3 } = {}) {
  return async (url) => {
    const u = new URL(url);
    const endpoint = u.pathname.split('/').pop();
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (endpoint === 'search') {
      const q = u.searchParams.get('q');
      const order = u.searchParams.get('order');
      const page = Number((u.searchParams.get('pageToken') || 'p1').slice(1));
      calls.push({ q, order, page, lang: u.searchParams.get('relevanceLanguage'), after: u.searchParams.get('publishedAfter') });
      const items = Array.from({ length: 5 }, (_, i) => ({ snippet: { channelId: `UC_${q}_${order}_${page}_${i}`.replace(/\s/g, '') } }));
      return json({ items, nextPageToken: page < pagesPerStream ? `p${page + 1}` : undefined });
    }
    if (endpoint === 'channels') return json({ items: [] }); // nothing in range -> no further calls
    return json({ items: [] });
  };
}

beforeEach(() => {
  openDb(':memory:');
  resetSettingsCache();
  calls = [];
  process.env.YOUTUBE_API_KEY = 'test-key';
  updateSettings({
    radar: {
      languages: ['de', 'en'],
      youtube: { queries: { de: ['a', 'b'], en: ['c'] }, pagesPerQuery: 2, maxSearchesPerRun: 3, dailySearchLimit: 100 },
    },
  });
});
afterEach(() => {
  delete process.env.YOUTUBE_API_KEY;
});

test('streams: newest first, languages interleaved, both orders', () => {
  const streams = searchStreams({ de: ['a', 'b'], en: ['c'] }, ['de', 'en']);
  assert.deepEqual(streams.map((s) => `${s.lang}|${s.order}|${s.q}`), [
    'de|date|a', 'en|date|c', 'de|date|b', 'de|relevance|a', 'en|relevance|c', 'de|relevance|b',
  ]);
});

test('repeated runs continue instead of repeating the same searches', async () => {
  const fetchImpl = fakeYoutube();
  const now = new Date('2026-10-24T08:00:00Z');
  const r1 = await runYoutubeDiscovery({ fetchImpl, now });
  const r2 = await runYoutubeDiscovery({ fetchImpl, now });
  const r3 = await runYoutubeDiscovery({ fetchImpl, now });
  const r4 = await runYoutubeDiscovery({ fetchImpl, now });
  assert.deepEqual([r1.searches, r2.searches, r3.searches, r4.searches], [3, 3, 3, 3]);
  const seen = calls.map((c) => `${c.lang}|${c.order}|${c.q}|${c.page}`);
  assert.equal(new Set(seen).size, 12, 'all 12 searches (6 streams × 2 pages) are different');
  // first all page-1 searches (newest first), then page 2 with the stored token
  assert.deepEqual(seen.slice(0, 6), ['de|date|a|1', 'en|date|c|1', 'de|date|b|1', 'de|relevance|a|1', 'en|relevance|c|1', 'de|relevance|b|1']);
  assert.ok(seen.slice(6).every((x) => x.endsWith('|2')));
  // the search window stays the same while paging (page tokens depend on it)
  assert.equal(new Set(calls.map((c) => c.after)).size, 1);
  assert.equal(getDb().value('SELECT COUNT(*) FROM discovery_cursor'), 6);
});

test('when everything is searched it starts over', async () => {
  updateSettings({ radar: { youtube: { pagesPerQuery: 1, maxSearchesPerRun: 10 } } });
  const fetchImpl = fakeYoutube();
  const now = new Date('2026-10-24T08:00:00Z');
  const logs = [];
  assert.equal((await runYoutubeDiscovery({ fetchImpl, now })).searches, 6);
  const again = await runYoutubeDiscovery({ fetchImpl, now, onLog: (l) => logs.push(l) });
  assert.equal(again.searches, 6);
  assert.ok(logs.some((l) => /wieder von vorn/.test(l)));
});

test('old progress (older than 3 days) is reset with a new search window', async () => {
  const fetchImpl = fakeYoutube();
  await runYoutubeDiscovery({ fetchImpl, now: new Date('2026-10-20T08:00:00Z') });
  calls = [];
  await runYoutubeDiscovery({ fetchImpl, now: new Date('2026-10-24T08:00:00Z') });
  assert.ok(calls.every((c) => c.page === 1), 'starts again at page 1');
  assert.equal(new Date(calls[0].after).toISOString().slice(0, 10), '2026-09-09', '45 days before 24.10.');
});
