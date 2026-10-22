import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './fixtures/radar-fixtures.js';
import { updateSettings } from '../src/core/settings.js';
import { services } from '../src/core/services.js';
import { createCreator, upsertAccount, addContact, getOutreach, updateCreator } from '../src/core/creators.js';
import { recomputeCreator } from '../src/radar/enrich.js';
import { createTemplate } from '../src/radar/templates.js';
import { getQueue, prepareOutreach, markSent, skipOutreach, recordReply, markNoReplies, getLimits, buildOpenUrl, todayRange } from '../src/radar/outreach.js';

const LAUNCH = '2026-11-21T18:00:00.000Z';
const origBot = { ...services.bot };

function setup() {
  updateSettings({
    game: { name: 'Tower Rush', pitch_de: 'Shooter + Turmbau', launchAt: LAUNCH, infoUrl: 'https://info.example', senderName: 'Robert', privacyUrl: 'https://p.example', discordInvite: 'https://discord.gg/general' },
    radar: { dailyLimits: { email: 2, dm: 1, discord: 1 }, followupAfterDays: 6, maxFollowups: 1, noReplyAfterDays: 14 },
  });
  createTemplate({ step: 'first', channel: 'email', language: 'de', variant: 'A', subject: '{game}: Founding Creator?', body: 'Hey {name}! [[„{video}“||Deine Videos]] … {discord} {privacy}' });
  createTemplate({ step: 'first', channel: 'dm', language: 'en', variant: 'A', body: 'Hey {name}, DM {link}' });
  createTemplate({ step: 'followup', channel: 'email', language: 'de', variant: 'A', subject: 'Kurze Erinnerung', body: 'Nochmal {name}' });
}

function creator(name, { email, dm, score, language = 'de', age } = {}) {
  const id = createCreator({ display_name: name, language, language_source: 'manual', age_group: age || 'unbekannt' });
  upsertAccount(id, { platform: 'youtube', external_id: `UC_${name}`, handle: name.toLowerCase(), followers: 2000, latest_title: `Video von ${name}`, last_active_at: new Date().toISOString(), source: 'youtube_api', roblox_share: 1 });
  if (email) addContact(id, { type: 'email', value: email, is_business: 1 });
  if (dm) addContact(id, { type: 'instagram', value: dm, dm_invited: 1 });
  recomputeCreator(id);
  if (score !== undefined) updateCreator(id, { score });
  return id;
}

beforeEach(() => {
  freshDb();
  setup();
});
afterEach(() => {
  Object.keys(services.bot).forEach((k) => delete services.bot[k]);
  Object.assign(services.bot, origBot);
});

test('queue: only contactable, not snoozed, sorted by score, no under-13', () => {
  const a = creator('Alpha', { email: 'a@x.de', score: 40 });
  const b = creator('Beta', { email: 'b@x.de', score: 90 });
  creator('NoContact', { score: 99 });
  creator('Kid', { email: 'kid@x.de', score: 95, age: 'u13' });
  const d = creator('Delta', { dm: 'delta.ig', language: 'en', score: 60 });
  const q = getQueue({ mode: 'first' });
  assert.deepEqual(q.items.map((i) => i.creator.display_name), ['Beta', 'Delta', 'Alpha']);
  assert.equal(q.total, 3);
  const beta = q.items[0];
  assert.equal(beta.channel, 'email');
  assert.equal(beta.target, 'b@x.de');
  assert.equal(beta.message.subject, 'Tower Rush: Founding Creator?');
  assert.match(beta.message.body, /Hey Beta! „Video von Beta“/);
  assert.match(beta.open_url, /^https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=b%40x\.de&su=/);
  assert.equal(beta.template_key, 'first.email.de.A');
  const delta = q.items.find((i) => i.creator.display_name === 'Delta');
  assert.equal(delta.channel, 'dm');
  assert.equal(delta.open_url, 'https://www.instagram.com/delta.ig/');
  assert.equal(delta.message.subject, '');
  assert.equal(getQueue({ mode: 'first', channel: 'dm' }).total, 1);
  assert.equal(getQueue({ mode: 'first', language: 'en' }).items[0].creator.id, d);

  skipOutreach(getOutreach(b).id, { reason: 'later' });
  assert.deepEqual(getQueue({ mode: 'first' }).items.map((i) => i.creator.id), [d, a]);
  skipOutreach(getOutreach(a).id, { reason: 'unsuitable' });
  assert.equal(getOutreach(a).status, 'ungeeignet');
  skipOutreach(getOutreach(d).id, { reason: 'no_contact' });
  assert.equal(getQueue({ mode: 'first' }).total, 0);
});

test('prepare creates a personal invite when the bot runs', async () => {
  const id = creator('Gamma', { email: 'g@x.de' });
  const o = getOutreach(id);
  let calls = 0;
  services.bot.isReady = () => true;
  services.bot.createPersonalInvite = async (creatorId) => {
    calls++;
    assert.equal(creatorId, id);
    return { code: 'Pers0nal', url: 'https://discord.gg/Pers0nal' };
  };
  const p = await prepareOutreach(o.id, { mode: 'first' });
  assert.equal(p.invite_url, 'https://discord.gg/Pers0nal');
  assert.match(p.message.body, /https:\/\/discord\.gg\/Pers0nal/);
  assert.equal(getOutreach(id).invite_code, 'Pers0nal');
  const again = await prepareOutreach(o.id, { mode: 'first' });
  assert.equal(calls, 2, 'the bot decides whether the invite can be reused');
  assert.equal(again.invite_url, 'https://discord.gg/Pers0nal');

  services.bot.isReady = () => false;
  const other = creator('Omega', { email: 'o@x.de' });
  const p2 = await prepareOutreach(getOutreach(other).id, { mode: 'first' });
  assert.match(p2.message.body, /discord\.gg\/general/);
});

test('sent -> follow-up due -> follow-up sent; limits and double clicks', () => {
  const now = new Date('2026-10-23T10:00:00Z');
  const id = creator('Eps', { email: 'e@x.de' });
  const o = getOutreach(id);
  const sent = markSent(o.id, { mode: 'first', template_key: 'first.email.de.A', variant: 'A' }, now);
  assert.equal(sent.status, 'kontaktiert');
  assert.equal(sent.channel, 'email');
  assert.equal(sent.channel_target, 'e@x.de');
  assert.equal(sent.followup_due_at, '2026-10-29T10:00:00.000Z');
  assert.throws(() => markSent(o.id, { mode: 'first' }, now), (err) => err.status === 409);
  assert.equal(getQueue({ mode: 'followup' }, now).total, 0);
  const later = new Date('2026-10-30T10:00:00Z');
  const fq = getQueue({ mode: 'followup' }, later);
  assert.equal(fq.total, 1);
  assert.equal(fq.items[0].message.body, 'Nochmal Eps');
  assert.equal(fq.items[0].target, 'e@x.de');
  const fu = markSent(o.id, { mode: 'followup' }, later);
  assert.equal(fu.status, 'nachgefasst');
  assert.equal(fu.followups_sent, 1);
  assert.equal(fu.followup_due_at, null);
  assert.equal(getQueue({ mode: 'followup' }, later).total, 0);
  assert.throws(() => markSent(o.id, { mode: 'followup' }, later), (err) => err.status === 409);
});

test('daily limit per channel (Berlin day)', () => {
  const now = new Date();
  const ids = ['L1', 'L2', 'L3'].map((n) => creator(n, { email: `${n}@x.de` }));
  markSent(getOutreach(ids[0]).id, {}, now);
  markSent(getOutreach(ids[1]).id, {}, now);
  assert.deepEqual(getLimits(now).email, { used: 2, max: 2 });
  assert.throws(() => markSent(getOutreach(ids[2]).id, {}, now), (err) => err.status === 429 && /Tageslimit/.test(err.message));
  const q = getQueue({ mode: 'first' }, now);
  assert.ok(q.items[0].warnings.some((w) => /Tageslimit/.test(w)));
  const { start, end } = todayRange(new Date('2026-11-21T23:30:00Z'));
  assert.equal(start, '2026-11-21T23:00:00.000Z');
  assert.equal(end, '2026-11-22T23:00:00.000Z');
});

test('replies and automatic "keine Antwort"', () => {
  const now = new Date('2026-10-01T10:00:00Z');
  const a = creator('R1', { email: 'r1@x.de' });
  const b = creator('R2', { dm: 'r2.ig' });
  const c = creator('R3', { email: 'r3@x.de' });
  markSent(getOutreach(a).id, {}, now);
  markSent(getOutreach(b).id, {}, now);
  markSent(getOutreach(c).id, {}, now);
  const r = recordReply(a, { sentiment: 'interessiert' }, new Date('2026-10-02T10:00:00Z'));
  assert.equal(r.status, 'interessiert');
  assert.equal(r.reply_sentiment, 'interessiert');
  assert.equal(r.replied_at, '2026-10-02T10:00:00.000Z');
  assert.equal(recordReply(a, { sentiment: 'fragen' }).status, 'interessiert', 'status does not move backwards');
  assert.equal(getOutreach(a).reply_sentiment, 'fragen');
  assert.throws(() => recordReply(a, { sentiment: 'egal' }), /sentiment/);

  // DM (no follow-up) after 14 days -> keine_antwort; email with pending follow-up waits longer.
  assert.equal(markNoReplies(new Date('2026-10-16T10:00:00Z')), 1);
  assert.equal(getOutreach(b).status, 'keine_antwort');
  assert.equal(getOutreach(c).status, 'kontaktiert');
  assert.equal(markNoReplies(new Date('2026-10-22T10:00:00Z')), 1);
  assert.equal(getOutreach(c).status, 'keine_antwort');
  assert.equal(getOutreach(a).status, 'interessiert');
});

test('open links for mail clients and Instagram app links', () => {
  const body = 'Zeile 1\nZeile 2 & mehr';
  updateSettings({ radar: { emailClient: 'outlook' } });
  assert.match(buildOpenUrl({ channel: 'email', target: 'a@b.de', subject: 'Hi', body }), /^https:\/\/outlook\.live\.com\/mail\/0\/deeplink\/compose\?to=a%40b\.de&subject=Hi&body=Zeile%201%0AZeile%202%20%26%20mehr$/);
  updateSettings({ radar: { emailClient: 'mailto' } });
  assert.equal(buildOpenUrl({ channel: 'email', target: 'a@b.de', subject: 'Hi', body }), 'mailto:a%40b.de?subject=Hi&body=Zeile%201%0D%0AZeile%202%20%26%20mehr');
  updateSettings({ radar: { instagramLink: 'app' } });
  assert.equal(buildOpenUrl({ channel: 'dm', platform: 'instagram', target: 'https://www.instagram.com/max.ig/' }), 'https://ig.me/m/max.ig');
  assert.equal(buildOpenUrl({ channel: 'discord', target: 'https://discord.gg/Abc' }), 'https://discord.gg/Abc');
  assert.equal(buildOpenUrl({ channel: 'email', target: null }), null);
});

test('minors get a warning in the queue', () => {
  creator('Teen', { email: 't@x.de', age: '16-17' });
  const q = getQueue({ mode: 'first' });
  assert.ok(q.items[0].warnings.some((w) => /Minderjährig/.test(w)));
});
