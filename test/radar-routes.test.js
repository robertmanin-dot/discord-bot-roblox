import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { freshDb, mockFetch, youtubeWorld } from './fixtures/radar-fixtures.js';
import { updateSettings } from '../src/core/settings.js';
import { getDb } from '../src/core/db.js';
import { initLanguage } from '../src/radar/language.js';
import { createTemplate } from '../src/radar/templates.js';
import { setRadarFetch } from '../src/radar/net.js';
import { createApp } from '../src/web/server.js';

let server;
let base;

async function api(method, path, body, { headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(method === 'GET' ? {} : { 'x-clk': '1' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

async function waitForRun(runId) {
  for (let i = 0; i < 100; i++) {
    const { data } = await api('GET', `/api/discovery/runs/${runId}`);
    if (data.run.status !== 'laeuft') return data.run;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('run did not finish');
}

before(async () => {
  await initLanguage();
  freshDb();
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  setRadarFetch(null);
  server.close();
});
beforeEach(() => {
  freshDb();
  delete process.env.YOUTUBE_API_KEY;
  setRadarFetch(null);
  updateSettings({
    game: { name: 'Tower Rush', launchAt: '2026-11-21T18:00:00.000Z', senderName: 'Robert', privacyUrl: 'https://p.example', infoUrl: 'https://i.example' },
    radar: { dailyLimits: { email: 1, dm: 5, discord: 5 } },
  });
  createTemplate({ step: 'first', channel: 'email', language: 'de', subject: 'Hallo {name}', body: 'Hey {name} {privacy}' });
  createTemplate({ step: 'first', channel: 'dm', language: 'de', body: 'DM {name}' });
});

test('changing requests need the X-CLK header', async () => {
  const res = await fetch(`${base}/api/import/urls`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"x"}' });
  assert.equal(res.status, 403);
});

test('import, list with filters, detail, patch, contacts, bulk, status', async () => {
  const imp = await api('POST', '/api/import/urls', { text: 'https://www.tiktok.com/@anna.rbx; 4500; anna@biz.de\nhttps://instagram.com/ben.gg\nkaputt', language: 'de', tags: ['welle1'] });
  assert.equal(imp.status, 200);
  assert.equal(imp.data.added, 2);
  assert.equal(imp.data.errors.length, 1);

  let list = await api('GET', '/api/creators?sort=followers&dir=desc');
  assert.equal(list.data.total, 2);
  const anna = list.data.items[0];
  assert.equal(anna.display_name, '@anna.rbx');
  assert.equal(anna.followers, 4500);
  assert.equal(anna.status, 'neu');
  assert.deepEqual(anna.tags, ['welle1']);
  assert.equal(anna.platforms[0].platform, 'tiktok');
  assert.equal((await api('GET', '/api/creators?channel=email')).data.total, 1);
  assert.equal((await api('GET', '/api/creators?q=ben')).data.total, 1);
  assert.equal((await api('GET', '/api/creators?q=biz.de')).data.total, 1);
  assert.equal((await api('GET', '/api/creators?platform=instagram')).data.items[0].display_name, '@ben.gg');
  assert.deepEqual((await api('GET', '/api/creators/tags')).data.tags, ['welle1']);

  const detail = await api('GET', `/api/creators/${anna.id}`);
  assert.equal(detail.data.creator.contact_channel, 'email');
  assert.equal(detail.data.outreach.status, 'neu');
  assert.equal((await api('GET', '/api/creators/9999')).status, 404);

  let p = await api('PATCH', `/api/creators/${anna.id}`, { display_name: 'Anna', age_group: '16-17', creator_code: 'anna rbx!', share_link: 'https://www.roblox.com/share?code=abc' });
  assert.equal(p.data.creator.display_name, 'Anna');
  assert.equal(p.data.creator.creator_code, 'ANNARBX');
  assert.equal((await api('PATCH', `/api/creators/${anna.id}`, { paid_ok: true })).status, 400, 'no paid deals for minors');
  assert.equal((await api('PATCH', `/api/creators/${anna.id}`, { share_link: 'roblox.com/x' })).status, 400);
  p = await api('PATCH', `/api/creators/${anna.id}`, { contact_channel: 'dm', contact_target: 'https://www.tiktok.com/@anna.rbx', contact_platform: 'tiktok' });
  assert.equal(p.data.creator.contact_locked, 1);
  p = await api('PATCH', `/api/creators/${anna.id}`, { contact_channel: null });
  assert.equal(p.data.creator.contact_channel, 'email');

  const ben = list.data.items[1];
  const c = await api('POST', `/api/creators/${ben.id}/contacts`, { type: 'discord', value: 'https://discord.gg/BenServer' });
  assert.equal(c.data.contact.value, 'BenServer');
  assert.equal((await api('GET', `/api/creators/${ben.id}`)).data.creator.contact_channel, 'discord');
  assert.equal((await api('POST', `/api/creators/${ben.id}/contacts`, { type: 'email', value: 'kaputt' })).status, 400);
  assert.equal((await api('DELETE', `/api/contacts/${c.data.contact.id}`)).data.ok, true);
  assert.equal((await api('GET', `/api/creators/${ben.id}`)).data.creator.contact_channel, 'none');

  const bulk = await api('POST', '/api/creators/bulk', { ids: [anna.id, ben.id], action: 'tag', value: 'shooter' });
  assert.equal(bulk.data.changed, 2);
  assert.equal((await api('POST', '/api/creators/bulk', { ids: [anna.id], action: 'qualify' })).data.changed, 1);
  assert.equal((await api('GET', '/api/creators?status=qualifiziert')).data.total, 1);
  assert.equal((await api('POST', '/api/creators/bulk', { ids: [anna.id], action: 'nope' })).status, 400);

  const st = await api('POST', `/api/creators/${ben.id}/status`, { status: 'ungeeignet', note: 'passt nicht' });
  assert.equal(st.data.outreach.status, 'ungeeignet');
  assert.equal((await api('POST', `/api/creators/${ben.id}/status`, { status: 'quatsch' })).status, 400);
  assert.equal((await api('POST', `/api/creators/${ben.id}/note`, { text: 'Hat 2 Kanäle' })).data.ok, true);
  assert.equal((await api('POST', `/api/creators/${ben.id}/refresh`)).status, 400);
  assert.ok((await api('POST', `/api/creators/${ben.id}/rescore`)).data.creator);

  assert.equal((await api('POST', `/api/creators/${ben.id}/optout`)).data.ok, true);
  assert.equal((await api('POST', '/api/import/urls', { text: 'https://instagram.com/ben.gg' })).data.skipped, 1);
  assert.equal((await api('DELETE', `/api/creators/${anna.id}`)).data.ok, true);
});

test('queue flow over the API with daily limit', async () => {
  await api('POST', '/api/import/urls', { text: 'https://www.tiktok.com/@a1; a1@x.de\nhttps://www.tiktok.com/@a2; a2@x.de', language: 'de' });
  const q = await api('GET', '/api/queue?mode=first');
  assert.equal(q.data.total, 2);
  assert.deepEqual(q.data.limits.email, { used: 0, max: 1 });
  const item = q.data.items[0];
  assert.match(item.message.body, /^Hey @a\d https:\/\/p\.example$/);
  const prep = await api('POST', `/api/queue/${item.outreach_id}/prepare`, { mode: 'first' });
  assert.equal(prep.data.channel, 'email');
  assert.match(prep.data.open_url, /^https:\/\/mail\.google\.com/);
  const sent = await api('POST', `/api/queue/${item.outreach_id}/sent`, { mode: 'first', template_key: prep.data.template_key, variant: prep.data.variant });
  assert.equal(sent.data.outreach.status, 'kontaktiert');
  assert.equal((await api('POST', `/api/queue/${item.outreach_id}/sent`, { mode: 'first' })).status, 409);
  const second = (await api('GET', '/api/queue?mode=first')).data.items[0];
  const limited = await api('POST', `/api/queue/${second.outreach_id}/sent`, { mode: 'first' });
  assert.equal(limited.status, 429);
  assert.match(limited.data.error, /Tageslimit/);
  assert.equal((await api('POST', `/api/queue/${second.outreach_id}/skip`, { reason: 'later' })).status, 200);
  assert.equal((await api('GET', '/api/queue?mode=first')).data.total, 0);
  assert.equal((await api('GET', '/api/queue?mode=quatsch')).status, 400);
  const reply = await api('POST', `/api/creators/${item.creator.id}/reply`, { sentiment: 'interessiert' });
  assert.equal(reply.data.outreach.status, 'interessiert');
  const stats = await api('GET', '/api/stats');
  assert.equal(stats.data.totals.contacted, 1);
  assert.equal(stats.data.totals.replied, 1);
  assert.equal(stats.data.byTemplate[0].rate, 1);
  assert.equal(stats.data.daily.length, 14);
  assert.equal(stats.data.daily.at(-1).sent, 1);
});

test('templates endpoints', async () => {
  const list = await api('GET', '/api/templates');
  assert.ok(list.data.items.find((t) => t.key === 'first.email.de.A'));
  assert.ok(list.data.placeholders.find((p) => p.key === 'video'));
  assert.ok(list.data.languages.find((l) => l.code === 'pt'));
  const upd = await api('PUT', '/api/templates/first.email.de.A', { body: 'Neu {name} {game}' });
  assert.equal(upd.data.template.is_custom, 1);
  assert.equal((await api('PUT', '/api/templates/first.email.de.A', { body: '  ' })).status, 400);
  const prev = await api('POST', '/api/templates/preview', { key: 'first.email.de.A' });
  assert.equal(prev.data.body, 'Neu LukasPlays Tower Rush');
  const prev2 = await api('POST', '/api/templates/preview', { body: '{name} {discord} {studio}', language: 'en' });
  assert.equal(prev2.data.body, 'LukasPlays https://discord.gg/beispiel');
  assert.deepEqual(prev2.data.missing, ['studio']);
  const created = await api('POST', '/api/templates', { step: 'followup', channel: 'email', language: 'nl', variant: 'Z', subject: 'Re', body: 'Hi again' });
  assert.equal(created.data.template.key, 'followup.email.nl.Z');
  assert.equal((await api('POST', '/api/templates', { step: 'x', channel: 'email', language: 'en', body: 'a' })).status, 400);
  assert.equal((await api('DELETE', '/api/templates/followup.email.nl.Z')).data.ok, true);
  assert.equal((await api('POST', '/api/templates/followup.email.nl.Z/reset')).status, 404);
});

test('discovery endpoints with mocked YouTube', async () => {
  assert.equal((await api('POST', '/api/discovery/youtube', {})).status, 400);
  process.env.YOUTUBE_API_KEY = 'test-key';
  updateSettings({ radar: { youtube: { queries: { de: ['neue roblox spiele'], en: ['new roblox games'] }, pagesPerQuery: 1 } } });
  setRadarFetch(mockFetch(youtubeWorld().handler));
  const start = await api('POST', '/api/discovery/youtube', { languages: ['de', 'en'], maxSearches: 5 });
  assert.equal(start.status, 200);
  const run = await waitForRun(start.data.runId);
  assert.equal(run.status, 'fertig');
  assert.equal(run.added, 2);
  assert.match(run.log, /Fertig/);
  const runs = await api('GET', '/api/discovery/runs');
  assert.equal(runs.data.items[0].id, start.data.runId);
  const quota = await api('GET', '/api/discovery/quota');
  assert.equal(quota.data.youtube.searchesUsed, 2);
  assert.equal(quota.data.youtube.keySet, true);
  assert.equal(quota.data.twitch.keySet, false);
  assert.equal((await api('POST', '/api/discovery/twitch', {})).status, 400);
  assert.equal((await api('POST', '/api/discovery/999/cancel')).status, 404);
  assert.equal((await api('GET', '/api/creators?language=de')).data.total, 1);
});

test('capture, bookmarklet, CSV import/export, maintenance', async () => {
  const cap = await api('POST', '/api/capture', { platform: 'tiktok', url: 'https://www.tiktok.com/@lena.rbx', name: 'Lena', followers: '8,1K', bio: 'business: lena@biz.de' });
  assert.equal(cap.data.created, true);
  assert.equal(cap.data.creator.contact_target, 'lena@biz.de');
  assert.equal((await api('POST', '/api/capture', {})).status, 400);
  const bm = await api('GET', '/api/bookmarklet');
  assert.ok(bm.data.code.startsWith('javascript:(function(){'));
  assert.ok(bm.data.code.includes(JSON.stringify(base)));
  assert.ok(!bm.data.code.includes('\n'));
  const csv = await api('POST', '/api/import/csv', { csv: 'name;url;email\nTom;https://twitch.tv/tomlive;tom@biz.de' });
  assert.equal(csv.data.added, 1);
  const exp = await fetch(`${base}/api/export/creators.csv?sort=name&dir=asc`);
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /creator\.csv/);
  const bytes = new Uint8Array(await exp.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel');
  const text = new TextDecoder('utf-8').decode(bytes);
  assert.ok(text.startsWith('ID;Name;Status'));
  assert.ok(text.includes('lena@biz.de'));
  assert.equal(text.trim().split('\r\n').length, 3);
  const ret = await api('POST', '/api/maintenance/retention');
  assert.deepEqual(Object.keys(ret.data).sort(), ['cleared', 'deleted', 'refreshed']);
  assert.equal((await api('POST', '/api/maintenance/rescore-all')).data.updated, 2);
  assert.equal(getDb().value('SELECT COUNT(*) FROM creators'), 2);
});
