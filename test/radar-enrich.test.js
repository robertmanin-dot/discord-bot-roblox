import { test, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './fixtures/radar-fixtures.js';
import { analyzeText, detectDmInvite, matchGenres, computeScore, chooseContactChannel, recomputeCreator, applyAnalysis } from '../src/radar/enrich.js';
import { initLanguage, detectLanguage, pickLanguage, cleanText, normalizeLangCode } from '../src/radar/language.js';
import { createCreator, upsertAccount, addContact, getCreatorFull, updateCreator, getCreator } from '../src/core/creators.js';

before(async () => {
  await initLanguage();
});
beforeEach(() => freshDb());

test('business emails are recognised by nearby words', () => {
  const a = analyzeText('Videos jeden Tag!\nBusiness: max@gmail.com | Fanpost an fanpost@web.de');
  assert.deepEqual(a.emails, [
    { value: 'max@gmail.com', is_business: 1 },
    { value: 'fanpost@web.de', is_business: 0 },
  ]);
  assert.equal(analyzeText('Für Kooperationen: koop@lukas.de').emails[0].is_business, 1);
  assert.equal(analyzeText('parcerias: joao@gmail.com').emails[0].is_business, 1);
});

test('DM invitations need a business word nearby', () => {
  assert.equal(detectDmInvite('DM for collabs!').invited, true);
  assert.equal(detectDmInvite('Anfragen gerne per DM').invited, true);
  assert.equal(detectDmInvite('Kooperationen über PN').invited, true);
  assert.equal(detectDmInvite('MD para parcerias').invited, true);
  assert.equal(detectDmInvite('DM pour collab').invited, true);
  assert.equal(detectDmInvite('business inquiries via DMs').invited, true);
  assert.equal(detectDmInvite('DMs open').invited, false);
  assert.equal(detectDmInvite('send me a dm if you like the video').invited, false);
  assert.deepEqual(detectDmInvite('For collabs DM me on Instagram').platforms, ['instagram']);
});

test('analyzeText picks the DM platform from the source or a single linked profile', () => {
  assert.deepEqual(analyzeText('DM for collabs', { sourcePlatform: 'tiktok' }).dmPlatforms, ['tiktok']);
  assert.deepEqual(analyzeText('DM for collabs | instagram.com/max.gg').dmPlatforms, ['instagram']);
  assert.deepEqual(analyzeText('DM for collabs | instagram.com/max.gg | tiktok.com/@max').dmPlatforms.sort(), ['instagram', 'tiktok']);
  assert.deepEqual(analyzeText('Für Kooperationen schreibt mir gerne eine DM 🙂\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nhttps://www.tiktok.com/@max').dmPlatforms, ['tiktok']);
  assert.deepEqual(analyzeText('DM for collabs', { sourcePlatform: 'youtube' }).dmPlatforms, []);
});

test('genres from keywords with word boundaries', () => {
  assert.deepEqual(matchGenres(['Roblox Rivals mit Zuschauern']).sort(), ['shooter', 'viewers']);
  assert.deepEqual(matchGenres(['I found the best new roblox games']), ['newgames']);
  assert.deepEqual(matchGenres(['The building begun']), []);
  assert.deepEqual(matchGenres(['BedWars Turm bauen']), ['buildfight']);
});

test('language helpers', () => {
  assert.equal(normalizeLangCode('en-US'), 'en');
  assert.equal(normalizeLangCode('zxx'), null);
  assert.equal(normalizeLangCode('other'), null);
  assert.equal(normalizeLangCode('fil'), 'tl');
  assert.equal(cleanText('Roblox RIVALS 1v1 🔥 https://x.com @max #roblox'), '');
  assert.equal(cleanText('Neues Video: Roblox mit Zuschauern!'), 'Neues Video mit Zuschauern');
  assert.equal(detectLanguage('Ich spiele mit meinen Zuschauern und wir bauen den größten Turm'), 'de');
  assert.equal(detectLanguage('roblox rivals 1v1'), null);
  assert.equal(pickLanguage({ platformLangs: ['de', 'de', 'en'], texts: [] }).language, 'de');
  const yt = pickLanguage({ platformLangs: ['en'], texts: ['Ich spiele heute mit euch das neue Spiel und wir haben richtig Spaß dabei'] });
  assert.deepEqual(yt, { language: 'de', source: 'detected' });
  assert.deepEqual(pickLanguage({ platformLangs: ['en'], texts: ['Ich spiele heute mit euch das neue Spiel und wir haben richtig Spaß dabei'], preferPlatform: true }), { language: 'en', source: 'platform' });
  assert.deepEqual(pickLanguage({ platformLangs: [], texts: ['jugando con suscriptores en vivo los mejores juegos de la semana'] }), { language: 'es', source: 'detected' });
});

test('score components', () => {
  const now = new Date();
  const full = {
    accounts: [{
      platform: 'youtube', followers: 3200, avg_views: 1600, roblox_share: 1, last_active_at: new Date(now - 2 * 86400000).toISOString(),
      genres: ['shooter', 'newgames', 'viewers'],
    }],
    contacts: [{ type: 'email', value: 'a@b.de', is_business: 1 }],
  };
  const { score, details } = computeScore(full, undefined, now);
  assert.equal(details.roblox, 30);
  assert.equal(details.activity, 15);
  assert.equal(details.size, 20);
  assert.equal(details.engagement, 10);
  assert.equal(details.genre, 15);
  assert.equal(details.contact, 10);
  assert.equal(score, 100);

  const twitch = computeScore({
    accounts: [{ platform: 'twitch', avg_live_viewers: 12, times_seen_live: 2, last_active_at: new Date(now - 20 * 86400000).toISOString(), genres: [] }],
    contacts: [],
  }, undefined, now);
  assert.equal(twitch.details.roblox, 25);
  assert.equal(twitch.details.activity, 7);
  assert.equal(twitch.details.size, 20);
  assert.equal(twitch.details.engagement, 6);
  assert.equal(twitch.details.contact, 0);

  const captured = computeScore({ accounts: [{ platform: 'tiktok', followers: null, genres: [] }], contacts: [] }, undefined, now);
  assert.equal(captured.details.roblox, 15);
  assert.equal(captured.details.activity, 5);
  assert.equal(captured.details.size, 5);
});

test('contact path: email > invited DM > discord > none', () => {
  assert.deepEqual(chooseContactChannel({ contacts: [{ type: 'discord', value: 'Abc' }, { type: 'email', value: 'fan@x.de', is_business: 0 }, { type: 'email', value: 'biz@x.de', is_business: 1 }] }), { channel: 'email', target: 'biz@x.de', platform: null });
  assert.deepEqual(chooseContactChannel({ contacts: [{ type: 'tiktok', value: 'max', dm_invited: 1 }, { type: 'instagram', value: 'max.ig', dm_invited: 1 }] }), { channel: 'dm', target: 'https://www.instagram.com/max.ig/', platform: 'instagram' });
  assert.deepEqual(chooseContactChannel({ contacts: [{ type: 'tiktok', value: 'max', dm_invited: 0 }, { type: 'discord', value: 'Abc' }] }), { channel: 'discord', target: 'https://discord.gg/Abc', platform: 'discord' });
  assert.deepEqual(chooseContactChannel({ contacts: [{ type: 'tiktok', value: 'max', dm_invited: 0 }] }), { channel: 'none', target: null, platform: null });
});

test('applyAnalysis stores contacts, cross-links and self DM invite; recompute respects locks', () => {
  const id = createCreator({ display_name: 'Max' });
  upsertAccount(id, { platform: 'tiktok', handle: 'max.tt', source: 'capture' });
  applyAnalysis(id, analyzeText('DM for collabs 💌 | yt: youtube.com/@maxyt | discord.gg/MaxServer', { sourcePlatform: 'tiktok' }), { source: 'capture_bio', sourceAccount: { platform: 'tiktok', handle: 'max.tt' } });
  let full = getCreatorFull(id);
  assert.ok(full.contacts.find((c) => c.type === 'tiktok' && c.value === 'max.tt' && c.dm_invited === 1));
  assert.ok(full.contacts.find((c) => c.type === 'discord' && c.value === 'MaxServer'));
  assert.ok(full.accounts.find((a) => a.platform === 'youtube' && a.handle === 'maxyt' && a.source === 'crosslink'));
  recomputeCreator(id);
  let c = getCreator(id);
  assert.equal(c.contact_channel, 'dm');
  assert.equal(c.contact_platform, 'tiktok');
  assert.equal(c.contact_target, 'https://www.tiktok.com/@max.tt');

  updateCreator(id, { contact_channel: 'discord', contact_target: 'https://discord.gg/MaxServer', contact_platform: 'discord', contact_locked: 1, language: 'pl', language_source: 'manual' });
  addContact(id, { type: 'email', value: 'max@biz.de', is_business: 1 });
  recomputeCreator(id);
  c = getCreator(id);
  assert.equal(c.contact_channel, 'discord', 'locked path stays');
  assert.equal(c.language, 'pl');
  full = getCreatorFull(id);
  assert.equal(full.creator.score_details.contact, 10);
});
