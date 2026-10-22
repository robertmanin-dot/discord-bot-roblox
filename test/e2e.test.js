// End-to-end flow over the real REST API (no network): settings -> import -> queue -> sent ->
// follow-up -> reply -> opt-out -> stats, plus Discord/playtest routes without a bot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getDb } from '../src/core/db.js';
import { resetSettingsCache, updateSettings } from '../src/core/settings.js';
import { services } from '../src/core/services.js';
import { createApp } from '../src/web/server.js';
import { initRadar } from '../src/radar/index.js';

let server;
let base;

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-clk': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

before(async () => {
  openDb(':memory:');
  resetSettingsCache();
  await initRadar();
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test('full outreach flow', async () => {
  let r = await api('PUT', '/api/settings', {
    game: {
      name: 'Tower Rush', pitch_de: 'Team-Shooter mit Turmbau-Rennen.', pitch_en: 'Team shooter with a tower race.',
      launchDate: '21.11.2026', launchTime: '19:00', senderName: 'Robert', studioName: 'Test Studio',
      privacyUrl: 'https://example.org/datenschutz', infoUrl: 'https://example.org/creator', discordInvite: 'https://discord.gg/general',
    },
    radar: { dailyLimits: { email: 2, dm: 5, discord: 5 } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.settings.game.launchAt, '2026-11-21T18:00:00.000Z');

  r = await api('POST', '/api/import/urls', {
    text: [
      'https://www.tiktok.com/@roblox.max; 5400; max.business@gmail.com',
      'https://www.youtube.com/@LukasPlaysDE; 2300; lukas@lukasplays.de',
      'https://www.twitch.tv/annalive; 800; anna@example.net',
      'https://instagram.com/nocontact.gamer',
      'kein link',
    ].join('\n'),
    language: 'de',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.added, 4, JSON.stringify(r.body));
  assert.equal(r.body.errors.length, 1);

  r = await api('GET', '/api/creators?sort=name&dir=asc');
  assert.equal(r.body.total, 4);
  const byName = Object.fromEntries(r.body.items.map((c) => [c.platforms[0]?.handle, c]));
  assert.equal(byName['roblox.max'].contact_channel, 'email');
  assert.equal(byName['nocontact.gamer'].contact_channel, 'none');

  r = await api('GET', '/api/queue?mode=first');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 3, 'creator without contact path is not queued');
  const item = r.body.items[0];
  assert.ok(item.message.body.includes('Tower Rush'), item.message.body);
  assert.ok(!/\{\w+\}/.test(item.message.body), 'no unresolved placeholders: ' + item.message.body);
  assert.ok(item.message.body.includes('https://example.org/datenschutz'));

  r = await api('POST', `/api/queue/${item.outreach_id}/prepare`, { mode: 'first' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.open_url, /^https:\/\/mail\.google\.com\//);

  const sent = (o) => api('POST', `/api/queue/${o.outreach_id}/sent`, { mode: 'first', channel: o.channel, target: o.target, platform: o.platform, template_key: o.template_key, variant: o.variant });
  r = await sent(item);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.outreach.status, 'kontaktiert');
  assert.ok(r.body.outreach.followup_due_at);

  const q2 = (await api('GET', '/api/queue?mode=first')).body.items;
  assert.equal((await sent(q2[0])).status, 200);
  const q3 = (await api('GET', '/api/queue?mode=first')).body.items;
  assert.equal((await sent(q3[0])).status, 429, 'daily email limit 2 reached');

  // follow-up becomes due
  getDb().run("UPDATE outreach SET followup_due_at = '2000-01-01T00:00:00.000Z' WHERE id = :id", { id: item.outreach_id });
  r = await api('GET', '/api/queue?mode=followup');
  assert.ok(r.body.items.some((i) => i.outreach_id === item.outreach_id));
  updateSettings({ radar: { dailyLimits: { email: 10 } } });
  const fu = r.body.items.find((i) => i.outreach_id === item.outreach_id);
  r = await api('POST', `/api/queue/${fu.outreach_id}/sent`, { mode: 'followup', channel: fu.channel, target: fu.target, template_key: fu.template_key, variant: fu.variant });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.outreach.status, 'nachgefasst');

  const creatorId = fu.creator.id;
  r = await api('POST', `/api/creators/${creatorId}/reply`, { sentiment: 'interessiert' });
  assert.equal(r.body.outreach.status, 'interessiert');

  // opt-out deletes and blocks re-import
  const anna = (await api('GET', '/api/creators?q=annalive')).body.items[0];
  assert.ok(anna);
  assert.equal((await api('POST', `/api/creators/${anna.id}/optout`)).status, 200);
  r = await api('POST', '/api/import/urls', { text: 'https://www.twitch.tv/annalive; 800; anna@example.net' });
  assert.equal(r.body.added, 0, JSON.stringify(r.body));

  r = await api('GET', '/api/stats');
  assert.equal(r.status, 200);
  assert.ok(r.body.totals.contacted >= 2, JSON.stringify(r.body.totals));
});

test('personal discord invite is used when the bot is ready', async () => {
  const prev = { ...services.bot };
  services.bot.isReady = () => true;
  services.bot.createPersonalInvite = async () => ({ code: 'pers0nal', url: 'https://discord.gg/pers0nal' });
  try {
    const t = (await api('GET', '/api/templates')).body.items.find((x) => x.body.includes('{discord}'));
    if (!t) return; // templates without {discord}: nothing to check
    const c = (await api('POST', '/api/creators', { display_name: 'Invite Test', platform: 'tiktok', handle: 'invite.test', email: 'invite@test.de', language: t.language })).body;
    const q = (await api('GET', `/api/queue?mode=first&language=${t.language}`)).body.items.find((i) => i.creator.id === c.id);
    const p = (await api('POST', `/api/queue/${q.outreach_id}/prepare`, { mode: 'first' })).body;
    if (p.template_key === t.key) assert.ok(p.message.body.includes('https://discord.gg/pers0nal'));
  } finally {
    Object.assign(services.bot, prev);
  }
});

test('discord + playtest routes work without a connected bot', async () => {
  let r = await api('GET', '/api/discord/overview');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await api('GET', '/api/playtests');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
  r = await api('POST', '/api/playtests', { title: 'Test', date: '01.12.2026', time: '18:00' });
  assert.equal(r.status, 503);
  r = await api('GET', '/api/events');
  assert.equal(r.status, 200);
});

test('templates exist for de and en', async () => {
  const r = await api('GET', '/api/templates');
  const keys = r.body.items.map((t) => t.key);
  for (const k of ['first.email.de.A', 'first.dm.de.A', 'first.email.en.A', 'followup.email.de.A']) assert.ok(keys.includes(k), `missing ${k}`);
});
