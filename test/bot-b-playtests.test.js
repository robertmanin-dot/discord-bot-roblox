import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getDb } from '../src/core/db.js';
import { resetSettingsCache, updateSettings } from '../src/core/settings.js';
import { getPoints } from '../src/core/points.js';
import { commandDefinitions } from '../src/bot/index.js';
import playtests, { runPlaytestJob, buildPlaytestMessage } from '../src/bot/modules/playtests.js';
import * as store from '../src/bot/lib/b-store.js';
import { fakeCtx, fakeInteraction, lastReply } from './bot-b-fakes.js';

let f;
const HOUR = 3600_000;

beforeEach(async () => {
  openDb(':memory:');
  resetSettingsCache();
  updateSettings({ game: { url: 'https://www.roblox.com/games/12345/Tower-Rush', contactEmail: 'team@studio.de' }, discord: { serverLanguage: 'de' } });
  f = fakeCtx();
  await playtests.onReady(f.ctx);
});

const inHours = (h) => new Date(Date.now() + h * HOUR);
const dateParts = (d) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.day}.${p.month}.${p.year}`, time: `${p.hour}:${p.minute}` };
};

async function createPlaytest(extra = {}, startsInHours = 48) {
  const { date, time } = dateParts(inHours(startsInHours));
  return f.provided.createPlaytest({ title: 'Waffen-Test', date, time, duration_min: 60, ...extra });
}

const button = (customId, userId, roles = [], opts = {}) =>
  fakeInteraction({ type: 'button', customId, user: f.user(userId), member: f.addMember(userId, roles, opts), locale: opts.locale || 'de' });

test('slash commands of part B are valid with English localizations', () => {
  const defs = commandDefinitions();
  const names = defs.map((c) => c.name);
  for (const n of ['playtest', 'feedback', 'bug', 'event']) assert.ok(names.includes(n), n);
  const pt = defs.find((c) => c.name === 'playtest');
  assert.equal(pt.default_member_permissions, '32');
  const create = pt.options.find((o) => o.name === 'erstellen');
  assert.equal(create.name_localizations['en-US'], 'create');
  assert.deepEqual(create.options.filter((o) => o.required).map((o) => o.name), ['titel', 'datum', 'uhrzeit']);
});

test('createPlaytest posts the embed and a server event without leaking the join link', async () => {
  const p = await createPlaytest({ join_link: 'https://www.roblox.com/share?code=SECRET', slots: 2 });
  assert.equal(p.status, 'geplant');
  assert.ok(p.message_id);
  const post = f.channel('playtests').sent[0];
  const json = JSON.stringify(post.payload);
  assert.match(json, /Waffen-Test/);
  assert.doesNotMatch(json, /SECRET/);
  assert.match(json, /pt:join:/);
  assert.equal(f.scheduled.length, 1);
  assert.equal(f.scheduled[0].entityMetadata.location, 'https://www.roblox.com/games/12345/Tower-Rush');
  assert.equal(p.discord_event_id, f.scheduled[0].id);
  assert.equal(p.reminded_24h, 0);
  const soon = await createPlaytest({}, 3);
  assert.equal(soon.reminded_24h, 1, 'a reminder window that is already open needs no reminder');
  assert.equal(soon.reminded_1h, 0);
  await assert.rejects(() => f.provided.createPlaytest({ title: 'X', date: '31.02.2026', time: '19:00' }), (err) => err.status === 400);
});

test('become a tester: under 13 rejected without storing, 13–15 need parents, 16+ get the role', async () => {
  const start = button('tester:join', 'kid');
  await playtests.buttons.tester(start, f.ctx);
  assert.ok(start.replies[0].components?.length, 'age select is shown');

  const u13 = fakeInteraction({ type: 'select', customId: 'tester:age', values: ['u13'], user: f.user('kid'), member: f.addMember('kid') });
  await playtests.selects.tester(u13, f.ctx);
  assert.match(u13.updates[0].content, /ab 13/);
  assert.equal(store.getTester('kid'), null);

  const teen = fakeInteraction({ type: 'select', customId: 'tester:age', values: ['13-15'], user: f.user('teen'), member: f.addMember('teen') });
  await playtests.selects.tester(teen, f.ctx);
  assert.equal(store.getTester('teen').status, 'eltern_ausstehend');
  assert.match(teen.updates[0].content, /team@studio\.de/);
  const review = f.channel('reviews').sent[0];
  assert.match(JSON.stringify(review.payload), /tester:parent:teen/);
  assert.equal(f.members.get('teen').roleSet.size, 0);

  // a non-staff click is refused
  const sneaky = button('tester:parent:teen', 'teen');
  await playtests.buttons.tester(sneaky, f.ctx);
  assert.equal(store.getTester('teen').status, 'eltern_ausstehend');

  const staffClick = fakeInteraction({ type: 'button', customId: 'tester:parent:teen', user: f.user('boss'), member: f.addMember('boss', [], { staff: true }), message: { embeds: [{ title: 'x', description: 'y' }] } });
  await playtests.buttons.tester(staffClick, f.ctx);
  assert.equal(store.getTester('teen').status, 'aktiv');
  assert.ok(f.members.get('teen').roleSet.has('role-tester'));
  assert.match(f.user('teen').dms[0].content, /Eltern haben zugestimmt/);
  assert.deepEqual(staffClick.updates[0].components, []);

  const older = fakeInteraction({ type: 'select', customId: 'tester:age', values: ['16-17'], user: f.user('older'), member: f.addMember('older') });
  await playtests.selects.tester(older, f.ctx);
  assert.equal(store.getTester('older').status, 'aktiv');
  assert.ok(f.members.get('older').roleSet.has('role-tester'));

  const again = button('tester:join', 'older', ['tester']);
  await playtests.buttons.tester(again, f.ctx);
  assert.match(lastReply(again), /schon Tester/);
});

test('sign-up needs the tester role and the right age; full playtests use a waitlist', async () => {
  const p = await createPlaytest({ slots: 1, ab16: true });
  store.upsertTester({ userId: 'a', ageGroup: '18+' });
  store.upsertTester({ userId: 'b', ageGroup: '16-17' });
  store.upsertTester({ userId: 'young', ageGroup: '13-15' });

  const noRole = button(`pt:join:${p.id}`, 'stranger');
  await playtests.buttons.pt(noRole, f.ctx);
  assert.match(lastReply(noRole), /Tester-Rolle/);

  const young = button(`pt:join:${p.id}`, 'young', ['tester']);
  await playtests.buttons.pt(young, f.ctx);
  assert.match(lastReply(young), /ab 16/);

  const a = button(`pt:join:${p.id}`, 'a', ['tester']);
  await playtests.buttons.pt(a, f.ctx);
  assert.match(lastReply(a), /angemeldet/);
  const b = button(`pt:join:${p.id}`, 'b', ['creator'], { locale: 'en-US' });
  await playtests.buttons.pt(b, f.ctx);
  assert.match(lastReply(b), /waitlist \(position 1\)/);

  const again = button(`pt:join:${p.id}`, 'a', ['tester']);
  await playtests.buttons.pt(again, f.ctx);
  assert.match(lastReply(again), /schon angemeldet/);

  const msg = f.channel('playtests').sent[0];
  assert.match(JSON.stringify(msg.edits.at(-1)), /Plätze: 1\/1 · Warteliste: 1/);

  const leave = button(`pt:leave:${p.id}`, 'a', ['tester']);
  await playtests.buttons.pt(leave, f.ctx);
  assert.match(lastReply(leave), /abgemeldet/);
  assert.equal(store.getSignup(p.id, 'b').status, 'angemeldet');
  assert.match(f.user('b').dms[0].content, /Platz ist frei/);

  const leaveAgain = button(`pt:leave:${p.id}`, 'a', ['tester']);
  await playtests.buttons.pt(leaveAgain, f.ctx);
  assert.match(lastReply(leaveAgain), /nicht angemeldet/);
});

test('scheduler: reminders, link only by DM at the start, feedback request at the end – each once', async () => {
  const p = await createPlaytest({ join_link: 'https://www.roblox.com/share?code=SECRET', slots: 1 });
  store.upsertTester({ userId: 'a', ageGroup: '18+' });
  store.upsertTester({ userId: 'w', ageGroup: '18+' });
  store.signUp(p.id, 'a');
  store.signUp(p.id, 'w'); // waitlist
  const start = new Date(p.starts_at).getTime();

  await runPlaytestJob(f.ctx, new Date(start - 23 * HOUR));
  assert.match(f.user('a').dms[0].content, /morgen/);
  assert.equal(f.user('w').dms.length, 0, 'waitlist gets no reminder');
  await runPlaytestJob(f.ctx, new Date(start - 23 * HOUR + 60_000));
  assert.equal(f.user('a').dms.length, 1, 'no duplicate reminder');

  await runPlaytestJob(f.ctx, new Date(start - 30 * 60_000));
  assert.match(f.user('a').dms[1].content, /einer Stunde/);

  await runPlaytestJob(f.ctx, new Date(start + 60_000));
  assert.match(f.user('a').dms[2].content, /SECRET/);
  assert.equal(store.getPlaytest(p.id).status, 'laeuft');
  const running = f.channel('playtests').sent.find((m) => /läuft jetzt/.test(m.payload.content || ''));
  assert.ok(running);
  assert.doesNotMatch(running.payload.content, /SECRET/);
  assert.equal(f.scheduled[0].status, 2, 'server event set to active');

  await runPlaytestJob(f.ctx, new Date(start + 61 * 60_000));
  const p2 = store.getPlaytest(p.id);
  assert.equal(p2.status, 'beendet');
  assert.equal(p2.feedback_requested, 1);
  const feedbackDm = f.user('a').dms[3];
  assert.match(feedbackDm.content, /Danke fürs Mitmachen/);
  assert.match(JSON.stringify(feedbackDm.components), /fb:open:/);
  assert.equal(f.user('w').dms.length, 0);
  const dmCount = f.user('a').dms.length;
  await runPlaytestJob(f.ctx, new Date(start + 2 * HOUR));
  assert.equal(f.user('a').dms.length, dmCount);
  assert.match(JSON.stringify(f.channel('playtests').sent[0].edits.at(-1)), /fb:open:/, 'post now shows the feedback button');
});

test('feedback: only for signed-up players after the start, validated, points once', async () => {
  const p = await createPlaytest({}, 1);
  store.upsertTester({ userId: 'a', ageGroup: '18+' });
  store.signUp(p.id, 'a');

  const early = button(`fb:open:${p.id}`, 'a', ['tester']);
  await playtests.buttons.fb(early, f.ctx);
  assert.match(lastReply(early), /erst, wenn der Playtest begonnen/);

  getDb().run('UPDATE playtests SET starts_at = :s WHERE id = :id', { s: new Date(Date.now() - 2 * HOUR).toISOString(), id: p.id });
  const stranger = button(`fb:open:${p.id}`, 'x', ['tester']);
  await playtests.buttons.fb(stranger, f.ctx);
  assert.match(lastReply(stranger), /angemeldet warst/);

  const open = button(`fb:open:${p.id}`, 'a', ['tester']);
  await playtests.buttons.fb(open, f.ctx);
  assert.equal(open.modals.length, 1);
  const modal = open.modals[0].toJSON();
  assert.equal(modal.custom_id, `fb:submit:${p.id}`);
  assert.equal(modal.components.length, 5);

  const bad = fakeInteraction({ type: 'modal', customId: `fb:submit:${p.id}`, user: f.user('a'), fields: { fun: 'mega', liked: '', disliked: '', bugs: '', other: '' } });
  await playtests.modals.fb(bad, f.ctx);
  assert.match(lastReply(bad), /1 bis 10/);
  assert.equal(store.listFeedback(p.id).length, 0);

  const good = fakeInteraction({ type: 'modal', customId: `fb:submit:${p.id}`, user: f.user('a'), fields: { fun: '9', liked: 'Turmbau', disliked: 'Spawn', bugs: 'Block hängt', other: '' } });
  await playtests.modals.fb(good, f.ctx);
  assert.match(lastReply(good), /\+15 Punkte/);
  assert.match(lastReply(good), /\/bug/);
  assert.equal(store.getSignup(p.id, 'a').status, 'teilgenommen');
  assert.equal(getPoints('a', 'tester'), 15);

  const again = fakeInteraction({ type: 'modal', customId: `fb:submit:${p.id}`, user: f.user('a'), fields: { fun: '7', liked: 'x', disliked: '', bugs: '', other: '' } });
  await playtests.modals.fb(again, f.ctx);
  assert.equal(getPoints('a', 'tester'), 15, 'no double points');
  assert.equal(store.listFeedback(p.id)[0].fun_rating, 7);

  // /feedback without option opens the latest playtest
  const cmd = fakeInteraction({ type: 'command', commandName: 'feedback', user: f.user('a'), member: f.addMember('a', ['tester']) });
  await playtests.commandHandlers.feedback(cmd, f.ctx);
  assert.equal(cmd.modals[0].toJSON().custom_id, `fb:submit:${p.id}`);
  assert.match(JSON.stringify(cmd.modals[0].toJSON()), /"value":"7"/, 'previous answers are pre-filled');
});

test('/playtest: staff only, create via command, list, participants, cancel and end', async () => {
  const notStaff = fakeInteraction({ type: 'command', commandName: 'playtest', subcommand: 'liste', user: f.user('u'), member: f.addMember('u', ['tester']) });
  await playtests.commandHandlers.playtest(notStaff, f.ctx);
  assert.match(lastReply(notStaff), /nur das Team/);

  const staff = () => f.addMember('boss', [], { staff: true });
  const { date, time } = dateParts(inHours(30));
  const create = fakeInteraction({ type: 'command', commandName: 'playtest', subcommand: 'erstellen', user: f.user('boss'), member: staff(), options: { titel: 'Map-Test', datum: date, uhrzeit: time, plaetze: 10 } });
  await playtests.commandHandlers.playtest(create, f.ctx);
  assert.match(lastReply(create), /Playtest #\d+ angelegt/);
  const p = store.listPlaytests()[0];
  assert.equal(p.created_by, 'boss');

  const badDate = fakeInteraction({ type: 'command', commandName: 'playtest', subcommand: 'erstellen', user: f.user('boss'), member: staff(), options: { titel: 'X', datum: 'morgen', uhrzeit: '19:00' } });
  await playtests.commandHandlers.playtest(badDate, f.ctx);
  assert.match(lastReply(badDate), /Datum\/Uhrzeit nicht erkannt/);

  store.upsertTester({ userId: 'a', ageGroup: '18+' });
  store.signUp(p.id, 'a');
  const list = fakeInteraction({ type: 'command', commandName: 'playtest', subcommand: 'liste', user: f.user('boss'), member: staff() });
  await playtests.commandHandlers.playtest(list, f.ctx);
  assert.match(lastReply(list), /Map-Test/);

  const parts = fakeInteraction({ type: 'command', commandName: 'playtest', subcommand: 'teilnehmer', user: f.user('boss'), member: staff(), options: { id: p.id } });
  await playtests.commandHandlers.playtest(parts, f.ctx);
  assert.match(lastReply(parts), /<@a> – angemeldet/);

  const ac = fakeInteraction({ type: 'autocomplete', commandName: 'playtest', user: f.user('boss'), member: staff(), focused: 'map' });
  await playtests.autocomplete.playtest(ac, f.ctx);
  assert.equal(ac.responded[0].value, p.id);

  const cancel = fakeInteraction({ type: 'command', commandName: 'playtest', subcommand: 'absagen', user: f.user('boss'), member: staff(), options: { id: p.id, grund: 'Server-Update' } });
  await playtests.commandHandlers.playtest(cancel, f.ctx);
  assert.match(lastReply(cancel), /1 Personen/);
  assert.equal(store.getPlaytest(p.id).status, 'abgesagt');
  assert.match(f.user('a').dms.at(-1).content, /abgesagt\. Grund: Server-Update/);
  assert.equal(f.scheduled.find((s) => s.id === p.discord_event_id), undefined, 'server event deleted');

  const p2 = await createPlaytest();
  store.signUp(p2.id, 'a');
  const end = fakeInteraction({ type: 'command', commandName: 'playtest', subcommand: 'beenden', user: f.user('boss'), member: staff(), options: { id: p2.id } });
  await playtests.commandHandlers.playtest(end, f.ctx);
  assert.match(lastReply(end), /an 1 Personen/);
  assert.equal(store.getPlaytest(p2.id).status, 'beendet');
  assert.match(JSON.stringify(f.user('a').dms.at(-1).components), new RegExp(`fb:open:${p2.id}`));
});

test('public post follows the server language setting', async () => {
  const p = await createPlaytest();
  updateSettings({ discord: { serverLanguage: 'both' } });
  const both = JSON.stringify(buildPlaytestMessage(store.getPlaytest(p.id)));
  assert.match(both, /Anmeldung offen/);
  assert.match(both, /Sign-up open/);
  assert.match(both, /Anmelden · Join/);
  updateSettings({ discord: { serverLanguage: 'en' } });
  const en = JSON.stringify(buildPlaytestMessage(store.getPlaytest(p.id)));
  assert.doesNotMatch(en, /Anmeldung offen/);
});
