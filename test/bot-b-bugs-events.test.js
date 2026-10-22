import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getDb } from '../src/core/db.js';
import { getSettings, resetSettingsCache, updateSettings } from '../src/core/settings.js';
import { getPoints } from '../src/core/points.js';
import { createCreator, updateCreator } from '../src/core/creators.js';
import bugs from '../src/bot/modules/bugs.js';
import events, { runEventJob, ccuState } from '../src/bot/modules/events.js';
import * as store from '../src/bot/lib/b-store.js';
import { fakeCtx, fakeInteraction, lastReply } from './bot-b-fakes.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
let f;

function ccuFetch(values) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const playing = values.length > 1 ? values.shift() : values[0];
    return { ok: true, json: async () => ({ data: [{ playing }] }) };
  };
  fn.calls = calls;
  return fn;
}

beforeEach(async () => {
  openDb(':memory:');
  resetSettingsCache();
  updateSettings({ game: { url: 'https://www.roblox.com/games/12345/Tower-Rush', universeId: '999' }, discord: { serverLanguage: 'de' } });
  ccuState.lastAt = 0;
  f = fakeCtx();
  await bugs.onReady(f.ctx);
  await events.onReady(f.ctx);
});

// ---- Bugs ---------------------------------------------------------------------

test('/bug: role required, modal, post with thread, staff status buttons, points once', async () => {
  const noRole = fakeInteraction({ type: 'command', commandName: 'bug', user: f.user('x'), member: f.addMember('x') });
  await bugs.commandHandlers.bug(noRole, f.ctx);
  assert.match(lastReply(noRole), /Tester und Creator/);

  const cmd = fakeInteraction({ type: 'command', commandName: 'bug', user: f.user('t'), member: f.addMember('t', ['tester']) });
  await bugs.commandHandlers.bug(cmd, f.ctx);
  const modal = cmd.modals[0].toJSON();
  assert.equal(modal.custom_id, 'bug:submit');
  assert.equal(modal.components.length, 4);

  const empty = fakeInteraction({ type: 'modal', customId: 'bug:submit', user: f.user('t'), member: f.addMember('t', ['tester']), fields: { title: ' ', description: '', steps: '', device: '' } });
  await bugs.modals.bug(empty, f.ctx);
  assert.match(lastReply(empty), /Titel/);

  const submit = fakeInteraction({
    type: 'modal',
    customId: 'bug:submit',
    user: f.user('t'),
    member: f.addMember('t', ['tester']),
    fields: { title: 'Blöcke verschwinden', description: 'Nach Respawn sind meine Blöcke weg', steps: '1. sterben 2. respawn', device: 'PC' },
  });
  await bugs.modals.bug(submit, f.ctx);
  assert.match(lastReply(submit), /Bug #1 ist gemeldet/);
  const bug = store.getBug(1);
  assert.equal(bug.status, 'neu');
  const post = f.channel('bugs').sent[0];
  assert.equal(bug.message_id, post.id);
  assert.equal(bug.thread_id, post.thread.id);
  assert.match(post.thread.name, /Bug #1: Blöcke verschwinden/);
  assert.match(JSON.stringify(post.payload), /bug:confirm:1/);

  const tester = fakeInteraction({ type: 'button', customId: 'bug:confirm:1', user: f.user('t'), member: f.addMember('t', ['tester']) });
  await bugs.buttons.bug(tester, f.ctx);
  assert.match(lastReply(tester), /nur das Team/);
  assert.equal(store.getBug(1).status, 'neu');

  const staff = () => fakeInteraction({ type: 'button', customId: 'bug:confirm:1', user: f.user('boss'), member: f.addMember('boss', [], { staff: true }) });
  const confirm = staff();
  await bugs.buttons.bug(confirm, f.ctx);
  assert.equal(store.getBug(1).status, 'bestaetigt');
  assert.equal(store.getBug(1).reviewed_by, 'boss');
  assert.match(JSON.stringify(confirm.updates[0]), /Bestätigt/);
  assert.equal(getPoints('t', 'tester'), 20);
  assert.match(f.user('t').dms[0].content, /\+20 Punkte/);
  assert.match(post.thread.sent[0].payload.content, /Status: ✅ Bestätigt/);

  const twice = staff();
  await bugs.buttons.bug(twice, f.ctx);
  assert.match(lastReply(twice), /schon/);

  const fixed = fakeInteraction({ type: 'button', customId: 'bug:fixed:1', user: f.user('boss'), member: f.addMember('boss', [], { staff: true }) });
  await bugs.buttons.bug(fixed, f.ctx);
  assert.equal(store.getBug(1).status, 'behoben');
  assert.equal(getPoints('t', 'tester'), 20, 'points only once');
});

test('bug status from the dashboard edits the stored message (bot online)', async () => {
  const { bug } = await (await import('../src/bot/modules/bugs.js')).reportBug(f.ctx, { userId: 't', title: 'Lag', description: 'ruckelt', steps: null, device: null });
  const updated = await f.provided.updateBugStatus(bug.id, 'duplikat', null);
  assert.equal(updated.status, 'duplikat');
  const msg = f.channel('bugs').sent[0];
  assert.match(JSON.stringify(msg.edits.at(-1)), /Duplikat/);
  assert.equal(getPoints('t', 'tester'), 0);
  await assert.rejects(() => f.provided.updateBugStatus(bug.id, 'quatsch', null), (err) => err.status === 400);
});

// ---- Events ---------------------------------------------------------------------

async function createEvent(extra = {}, startsAt = new Date(Date.now() + 3 * 24 * HOUR)) {
  return f.provided.createEvent({ title: 'Launch Hour', kind: 'launch', starts_at: startsAt.toISOString(), duration_min: 60, ...extra });
}

test('createEvent announces with role ping, adds a server event and fills the launch date', async () => {
  assert.equal(getSettings().game.launchAt, '');
  const e = await createEvent();
  const post = f.channel('launch').sent[0];
  assert.equal(post.payload.content, '<@&role-creator>');
  assert.deepEqual(post.payload.allowedMentions, { parse: [], roles: ['role-creator'] });
  assert.match(JSON.stringify(post.payload.embeds), /Launch Hour: Launch Hour/);
  assert.equal(e.message_id, post.id);
  assert.equal(f.scheduled[0].entityMetadata.location, 'https://www.roblox.com/games/12345/Tower-Rush');
  assert.equal(getSettings().game.launchAt, e.starts_at);

  updateSettings({ discord: { pingRoleOnEvents: false } });
  await createEvent({ kind: 'event', title: 'Tower Rush Samstag' });
  assert.equal(f.channel('launch').sent[1].payload.content, undefined);
  await assert.rejects(() => f.provided.createEvent({ title: 'X', kind: 'event', date: '31.02.2026', time: '19:00' }), (err) => err.status === 400);
});

test('event job: reminders, player counts, start, weekly follow-up and summary', async () => {
  const start = new Date(Date.now() + 2 * 24 * HOUR);
  start.setUTCSeconds(0, 0);
  const e = await createEvent({ kind: 'event', title: 'Tower Rush', repeat_weekly: true }, start);
  const launch = f.channel('launch');
  const t = (ms) => new Date(start.getTime() + ms);
  const posts = () => launch.sent.map((m) => m.payload.content || '');

  f.ctx.fetchImpl = ccuFetch([3]);
  await runEventJob(f.ctx, t(-23 * HOUR));
  assert.match(posts().at(-1), /Morgen:\*\* Tower Rush/);
  assert.equal(f.ctx.fetchImpl.calls.length, 0, 'no player count outside the window');

  await runEventJob(f.ctx, t(-50 * MIN));
  assert.match(posts().at(-1), /In 1 Stunde/);

  await runEventJob(f.ctx, t(-10 * MIN));
  assert.match(posts().at(-1), /In 10 Minuten/);
  assert.equal(f.ctx.fetchImpl.calls[0], 'https://games.roblox.com/v1/games?universeIds=999');
  const ccuMsg = launch.sent.find((m) => /Spieler gerade: \*\*3\*\*/.test(m.payload.content || ''));
  assert.ok(ccuMsg, 'status message with player count');

  // second tick within 55 s: no new request
  await runEventJob(f.ctx, t(-10 * MIN + 20_000));
  assert.equal(f.ctx.fetchImpl.calls.length, 1);

  f.ctx.fetchImpl = ccuFetch([120]);
  await runEventJob(f.ctx, t(1 * MIN));
  assert.match(posts().at(-1), /JETZT LIVE GEHEN/);
  assert.equal(store.getEvent(e.id).status, 'laeuft');
  assert.match(ccuMsg.edits.at(-1).content, /\*\*120\*\* · Peak: \*\*120\*\*/, 'status message is edited, not reposted');
  assert.equal(store.getEvent(e.id).ccu_peak, 120);

  // a creator was live during the event, one application was accepted
  const cid = createCreator({ display_name: 'LukasPlays' });
  updateCreator(cid, { is_member: 1, discord_user_id: 'lukas' });
  getDb().run("INSERT INTO live_sessions (discord_user_id, creator_id, platform, url, started_at) VALUES ('lukas', :cid, 'twitch', 'https://twitch.tv/lukas', :at)", { cid, at: t(5 * MIN).toISOString() });
  getDb().run("INSERT INTO applications (discord_user_id, status, reviewed_at) VALUES ('lukas', 'angenommen', :at)", { at: t(-2 * HOUR).toISOString() });

  f.ctx.fetchImpl = ccuFetch([60]);
  await runEventJob(f.ctx, t(61 * MIN));
  const ended = store.getEvent(e.id);
  assert.equal(ended.status, 'beendet');
  assert.equal(ended.summary_posted, 0, 'summary waits 30 minutes for late player counts');
  const next = getDb().get('SELECT * FROM events WHERE parent_event_id = :id', { id: e.id });
  assert.ok(next, 'weekly follow-up created');
  assert.equal(new Date(next.starts_at).getTime() - start.getTime() > 6.9 * 24 * HOUR, true);
  const nextPost = launch.sent.find((m) => m.id === next.message_id);
  assert.equal(nextPost.payload.content, undefined, 'follow-up announcement does not ping again');

  f.ctx.fetchImpl = ccuFetch([20]);
  await runEventJob(f.ctx, t(91 * MIN));
  const summary = launch.sent.at(-1).payload;
  const json = JSON.stringify(summary.embeds);
  assert.match(json, /Zusammenfassung: Tower Rush/);
  assert.match(json, /"value":"120"/, 'peak');
  assert.match(json, /LukasPlays/);
  assert.equal(store.getEvent(e.id).summary_posted, 1);

  const count = launch.sent.length;
  await runEventJob(f.ctx, t(95 * MIN));
  assert.equal(launch.sent.length, count, 'nothing posted twice');
  assert.equal(getDb().value('SELECT COUNT(*) FROM events WHERE parent_event_id = :id', { id: e.id }), 1);
});

test('without a linked Roblox game the summary comes right at the end and says so', async () => {
  updateSettings({ game: { universeId: '' } });
  const start = new Date(Date.now() + 2 * HOUR);
  const e = await createEvent({ kind: 'event', title: 'Mini-Event' }, start);
  f.ctx.fetchImpl = ccuFetch([1]);
  await runEventJob(f.ctx, new Date(start.getTime() + 61 * MIN));
  assert.equal(f.ctx.fetchImpl.calls.length, 0);
  assert.equal(store.getEvent(e.id).summary_posted, 1);
  assert.match(JSON.stringify(f.channel('launch').sent.at(-1).payload.embeds), /keine Daten/);
});

test('/event: staff only, list, autocomplete and cancel', async () => {
  const e = await createEvent({ kind: 'event', title: 'Samstags-Event', repeat_weekly: true });
  const user = fakeInteraction({ type: 'command', commandName: 'event', subcommand: 'liste', user: f.user('u'), member: f.addMember('u', ['creator']) });
  await events.commandHandlers.event(user, f.ctx);
  assert.match(lastReply(user), /nur das Team/);

  const staff = () => f.addMember('boss', [], { staff: true });
  const list = fakeInteraction({ type: 'command', commandName: 'event', subcommand: 'liste', user: f.user('boss'), member: staff() });
  await events.commandHandlers.event(list, f.ctx);
  assert.match(lastReply(list), /Samstags-Event.*wöchentlich/);

  const ac = fakeInteraction({ type: 'autocomplete', commandName: 'event', user: f.user('boss'), member: staff(), focused: 'samstag' });
  await events.autocomplete.event(ac, f.ctx);
  assert.equal(ac.responded[0].value, e.id);

  const create = fakeInteraction({ type: 'command', commandName: 'event', subcommand: 'erstellen', user: f.user('boss'), member: staff(), options: { titel: 'X', typ: 'event', datum: '01.01.2020', uhrzeit: '19:00' } });
  await events.commandHandlers.event(create, f.ctx);
  assert.match(lastReply(create), /Vergangenheit/);

  const cancel = fakeInteraction({ type: 'command', commandName: 'event', subcommand: 'absagen', user: f.user('boss'), member: staff(), options: { id: e.id, grund: 'Update' } });
  await events.commandHandlers.event(cancel, f.ctx);
  assert.match(lastReply(cancel), /Serie endet/);
  assert.equal(store.getEvent(e.id).status, 'abgesagt');
  assert.match(f.channel('launch').sent.at(-1).payload.content, /abgesagt\. Grund: Update/);
  assert.equal(f.scheduled.length, 0);
  await runEventJob(f.ctx, new Date(new Date(e.starts_at).getTime() + 2 * HOUR));
  assert.equal(getDb().value('SELECT COUNT(*) FROM events WHERE parent_event_id = :id', { id: e.id }), 0, 'cancelled series does not continue');
});
