import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, getDb } from '../src/core/db.js';
import { getSettings, updateSettings, resetSettingsCache } from '../src/core/settings.js';
import {
  createCreator, getCreatorFull, upsertAccount, addContact, setOutreachStatus, findCreatorByAccount,
  generateCreatorCode, updateCreator, isSuppressed, suppressAndDeleteCreator, linkDiscordUser, findCreatorByDiscordId,
} from '../src/core/creators.js';
import { addPoints, getPoints, getLeaderboard, tierFor } from '../src/core/points.js';
import { parseLocalDateTime, parseDateInput, parseTimeInput, dayKey, formatDate, formatTime, discordTs } from '../src/core/time.js';
import { parseCount, makeCode, deepMerge } from '../src/core/util.js';
import { parseEnv, writeEnv } from '../src/core/config.js';
import { parseProfileUrl, extractLinks } from '../src/core/urls.js';
import { commandDefinitions, buildHandlers } from '../src/bot/index.js';

beforeEach(() => {
  openDb(':memory:');
  resetSettingsCache();
});

test('db wrapper: named params ignore unknown keys, booleans and undefined', () => {
  const db = getDb();
  db.exec('CREATE TABLE t (a TEXT, b INTEGER, c TEXT)');
  db.run('INSERT INTO t (a, b, c) VALUES (:a, :b, :c)', { a: 'x', b: true, c: undefined, extra: 1 });
  assert.deepEqual({ ...db.get('SELECT * FROM t') }, { a: 'x', b: 1, c: null });
  assert.equal(db.value('SELECT COUNT(*) FROM t'), 1);
});

test('db.tx rolls back on error and supports nesting', () => {
  const db = getDb();
  db.exec('CREATE TABLE t (a INTEGER)');
  assert.throws(() => db.tx(() => {
    db.run('INSERT INTO t (a) VALUES (1)');
    db.tx(() => db.run('INSERT INTO t (a) VALUES (2)'));
    throw new Error('boom');
  }));
  assert.equal(db.value('SELECT COUNT(*) FROM t'), 0);
  db.tx(() => {
    db.run('INSERT INTO t (a) VALUES (1)');
    try {
      db.tx(() => {
        db.run('INSERT INTO t (a) VALUES (2)');
        throw new Error('inner');
      });
    } catch { /* inner rolled back */ }
  });
  assert.equal(db.value('SELECT COUNT(*) FROM t'), 1);
});

test('settings: defaults merged with saved values, arrays replaced', () => {
  assert.equal(getSettings().radar.minFollowers, 200);
  updateSettings({ radar: { minFollowers: 500, languages: ['de'] } });
  const s = getSettings();
  assert.equal(s.radar.minFollowers, 500);
  assert.deepEqual(s.radar.languages, ['de']);
  assert.equal(s.radar.maxFollowers, 25000);
  updateSettings({ discord: { roles: { creator: '1' } } });
  updateSettings({ discord: { roles: { tester: '2' } } });
  assert.deepEqual(getSettings().discord.roles, { creator: '1', tester: '2' });
});

test('creators: create, accounts, contacts, status flow', () => {
  const id = createCreator({ display_name: 'Lukas Plays', source: 'youtube' });
  upsertAccount(id, { platform: 'youtube', external_id: 'UC1', handle: '@LukasPlays', followers: 1200 });
  upsertAccount(id, { platform: 'youtube', external_id: 'UC1', followers: 1300 });
  addContact(id, { type: 'email', value: 'Lukas@Example.org ', source: 'test', is_business: 1 });
  addContact(id, { type: 'email', value: 'lukas@example.org', source: 'test' });
  const full = getCreatorFull(id);
  assert.equal(full.accounts.length, 1);
  assert.equal(full.accounts[0].followers, 1300);
  assert.equal(full.accounts[0].handle, 'lukasplays');
  assert.equal(full.contacts.length, 1);
  assert.equal(full.contacts[0].is_business, 1);
  assert.equal(full.outreach.status, 'neu');
  assert.equal(findCreatorByAccount('youtube', { handle: 'LUKASPLAYS' }).id, id);

  assert.ok(setOutreachStatus(id, 'kontaktiert'));
  assert.equal(setOutreachStatus(id, 'neu'), null, 'no backwards move without force');
  assert.equal(setOutreachStatus(id, 'neu', { force: true }).status, 'neu');
  setOutreachStatus(id, 'im_discord', { extra: { joined_discord_at: '2026-01-01T00:00:00.000Z' } });
  assert.equal(getCreatorFull(id).outreach.joined_discord_at, '2026-01-01T00:00:00.000Z');
});

test('creator codes are unique', () => {
  const a = createCreator({ display_name: 'Max' });
  updateCreator(a, { creator_code: generateCreatorCode('Max') });
  const b = createCreator({ display_name: 'Max' });
  assert.equal(generateCreatorCode('Max'), 'MAX2');
  updateCreator(b, { creator_code: generateCreatorCode('Max') });
  assert.equal(generateCreatorCode('Max'), 'MAX3');
});

test('opt-out keeps only hashes and blocks re-adding', () => {
  const id = createCreator({ display_name: 'Optout' });
  upsertAccount(id, { platform: 'tiktok', handle: 'opt.out' });
  addContact(id, { type: 'email', value: 'opt@out.de' });
  assert.equal(suppressAndDeleteCreator(id), true);
  assert.equal(getCreatorFull(id), null);
  assert.equal(isSuppressed({ emails: ['OPT@out.de'] }), true);
  assert.equal(isSuppressed({ accounts: [{ platform: 'tiktok', handle: '@Opt.Out' }] }), true);
  assert.equal(isSuppressed({ emails: ['other@out.de'] }), false);
  assert.equal(getDb().value('SELECT COUNT(*) FROM suppression'), 2);
});

test('discord link moves between creators', () => {
  const a = createCreator({ display_name: 'A' });
  const b = createCreator({ display_name: 'B' });
  linkDiscordUser(a, '123', 'a#1');
  linkDiscordUser(b, '123', 'b#1');
  assert.equal(findCreatorByDiscordId('123').id, b);
});

test('points with dedupe ref, leaderboard and tiers', () => {
  assert.equal(addPoints({ userId: 'u1', kind: 'tester', points: 10, ref: 'pt:1:attend' }), true);
  assert.equal(addPoints({ userId: 'u1', kind: 'tester', points: 10, ref: 'pt:1:attend' }), false);
  addPoints({ userId: 'u2', kind: 'tester', points: 25 });
  assert.equal(getPoints('u1', 'tester'), 10);
  assert.deepEqual(getLeaderboard('tester').map((r) => r.discord_user_id), ['u2', 'u1']);
  assert.equal(tierFor(320).name, 'Gold');
  assert.equal(tierFor(320).next.name, 'Diamant');
});

test('time helpers', () => {
  assert.equal(parseLocalDateTime('21.11.2026', '19:00').toISOString(), '2026-11-21T18:00:00.000Z');
  assert.equal(parseLocalDateTime('2026-07-01', '19:00').toISOString(), '2026-07-01T17:00:00.000Z');
  assert.equal(parseLocalDateTime('31.02.2026', '19:00'), null);
  assert.deepEqual(parseTimeInput('7pm'), { hour: 19, minute: 0 });
  assert.deepEqual(parseTimeInput('19 Uhr'), { hour: 19, minute: 0 });
  assert.deepEqual(parseDateInput('21.11.', new Date('2026-12-01T00:00:00Z')), { year: 2027, month: 11, day: 21 });
  assert.equal(dayKey(new Date('2026-11-21T23:30:00Z'), 'Europe/Berlin'), '2026-11-22');
  assert.equal(formatDate('2026-11-21T18:00:00Z', 'de'), 'Samstag, 21. November 2026');
  assert.equal(formatTime('2026-11-21T18:00:00Z', 'de'), '19:00');
  assert.equal(formatTime('2026-11-21T18:00:00Z', 'en', 'America/New_York'), '1:00 PM');
  assert.equal(discordTs('2026-11-21T18:00:00Z', 'R'), '<t:1795284000:R>');
});

test('util helpers', () => {
  assert.equal(parseCount('12,3K'), 12300);
  assert.equal(parseCount('1.2M'), 1200000);
  assert.equal(parseCount('12.300'), 12300);
  assert.equal(parseCount('12,3 Tsd.'), 12300);
  assert.equal(parseCount('987'), 987);
  assert.equal(parseCount(''), null);
  assert.equal(makeCode('Lukas Plays 🎮'), 'LUKASPLAYS');
  assert.equal(makeCode('Jörg'), 'JORG');
  assert.deepEqual(deepMerge({ a: { b: 1, c: [1] } }, { a: { c: [2] } }), { a: { b: 1, c: [2] } });
});

test('.env parse and write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clk-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, '# Kommentar\nPORT=3000\nYOUTUBE_API_KEY=old\n');
  writeEnv({ YOUTUBE_API_KEY: 'new key "x"', DISCORD_TOKEN: 'abc.def' }, file);
  const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.YOUTUBE_API_KEY, 'new key "x"');
  assert.equal(parsed.DISCORD_TOKEN, 'abc.def');
  assert.equal(parsed.PORT, '3000');
  assert.match(fs.readFileSync(file, 'utf8'), /# Kommentar/);
  writeEnv({ DISCORD_TOKEN: '' }, file);
  assert.equal(parseEnv(fs.readFileSync(file, 'utf8')).DISCORD_TOKEN, undefined);
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.DISCORD_TOKEN;
});

test('profile urls and link extraction', () => {
  assert.deepEqual(parseProfileUrl('tiktok.com/@Roblox.Max?lang=de'), { platform: 'tiktok', handle: 'roblox.max', url: 'https://www.tiktok.com/@roblox.max' });
  assert.equal(parseProfileUrl('https://instagram.com/p/abc'), null);
  assert.equal(parseProfileUrl('https://discord.com/invite/XyZ').inviteCode, 'XyZ');
  const links = extractLinks('Business: lukas.plays@gmail.com | TikTok: @lukas_tt | Insta: lukas.ig | discord.gg/AbC | kontakt [at] lukas-plays [dot] de');
  assert.deepEqual(links.emails.map((e) => e.value), ['lukas.plays@gmail.com', 'kontakt@lukas-plays.de']);
  assert.deepEqual(links.profiles.map((p) => `${p.platform}:${p.handle}`), ['tiktok:lukas_tt', 'instagram:lukas.ig']);
  assert.deepEqual(links.discordInvites, ['AbC']);
});

test('bot modules: command definitions and handlers are valid and unique', () => {
  assert.doesNotThrow(() => commandDefinitions());
  assert.doesNotThrow(() => buildHandlers());
});
