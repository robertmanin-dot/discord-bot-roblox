/**
 * Komplette Abläufe mit nachgebauten Discord-Objekten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { openDatabase, PLAYTIME_STAT } = require('../src/db');
const { SETTINGS } = require('../src/discord-utils');
const { handleInteraction } = require('../src/interactions');
const playtests = require('../src/features/playtests');
const giveaways = require('../src/features/giveaways');
const { createClient, createMember, createGuild, createInteraction, lastText } = require('./helpers/fake-discord');

// Roblox-API nachbauen
const ROBLOX_USERS = { TesterName: 555, Zweiter: 556 };
const realFetch = global.fetch;
test.before(() => {
  global.fetch = async (url, options = {}) => {
    const json = (data) => ({ ok: true, status: 200, json: async () => data });
    if (url === 'https://users.roblox.com/v1/usernames/users') {
      const [name] = JSON.parse(options.body).usernames;
      const entry = Object.entries(ROBLOX_USERS).find(([n]) => n.toLowerCase() === name.toLowerCase());
      return json({ data: entry ? [{ id: entry[1], name: entry[0], displayName: entry[0] }] : [] });
    }
    if (url.startsWith('https://users.roblox.com/v1/users/')) {
      return json({ id: 555, name: 'TesterName', displayName: 'TesterName', created: new Date(Date.now() - 5 * 86400000).toISOString() });
    }
    if (url.startsWith('https://thumbnails.roblox.com/')) {
      return json({ data: [{ state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/bild.png' }] });
    }
    throw new Error(`Unerwarteter Aufruf: ${url}`);
  };
});
test.after(() => {
  global.fetch = realFetch;
});

function setup() {
  const store = openDatabase(':memory:');
  const client = createClient();
  const review = client.addChannel({ name: 'bewerbungen' });
  const announce = client.addChannel({ name: 'ankuendigungen' });
  const bugsForum = client.addChannel({ name: 'bugs', type: ChannelType.GuildForum });
  store.setSetting(SETTINGS.testerRole, 'role-tester');
  store.setSetting(SETTINGS.reviewChannel, review.id);
  store.setSetting(SETTINGS.announceChannel, announce.id);
  store.setSetting(SETTINGS.bugChannel, bugsForum.id);

  const members = {
    admin: createMember('admin', { admin: true }),
    u1: createMember('u1'),
    u2: createMember('u2'),
  };
  const guild = createGuild(members);
  const ctx = { client, store, config: { timeZone: 'Europe/Berlin' } };
  const act = async (opts) => {
    const interaction = createInteraction({ guild, member: members[opts.user ?? 'u1'], ...opts });
    await handleInteraction(interaction, ctx);
    return interaction;
  };
  return { store, client, review, announce, bugsForum, members, ctx, act };
}

const applicationFields = {
  roblox_name: 'testername',
  age_group: ['13-15'],
  devices: ['pc', 'handy'],
  frequency: ['taeglich'],
  motivation: 'Ich liebe das Spiel',
};

test('Bewerbung: Formular → Team nimmt an → Rolle, Tester, DM', async () => {
  const { store, client, review, members, act } = setup();

  const start = await act({ kind: 'button', customId: 'app:start' });
  assert.equal(start.modal.custom_id, 'app:submit');
  assert.equal(start.modal.components.length, 5);

  const submit = await act({ kind: 'modal', customId: 'app:submit', fields: applicationFields });
  assert.match(lastText(submit), /angekommen/);
  assert.match(lastText(submit), /TesterName/, 'echter Name aus Roblox wird benutzt');

  const post = review.sent[0];
  assert.ok(post, 'Bewerbung im Team-Kanal gepostet');
  assert.equal(post.embeds[0].title, 'Bewerbung #1');
  assert.ok(post.embeds[0].fields.some((f) => f.name === '⚠️ Hinweise' && /5 Tage/.test(f.value)));
  assert.equal(post.embeds[0].thumbnail.url, 'https://tr.rbxcdn.com/bild.png');

  // Zweite Bewerbung, solange die erste offen ist
  const again = await act({ kind: 'button', customId: 'app:start' });
  assert.match(lastText(again), /wird gerade geprüft/);

  // Normale Mitglieder dürfen nicht annehmen
  const notStaff = await act({ kind: 'button', customId: 'app:accept:1', user: 'u2', message: post });
  assert.match(lastText(notStaff), /Nur das Team/);

  const accept = await act({ kind: 'button', customId: 'app:accept:1', user: 'admin', message: post });
  assert.equal(accept.replies.at(-1).type, 'edit');
  assert.deepEqual(post.components, [], 'Buttons verschwinden');
  assert.ok(post.embeds[0].fields.some((f) => f.name === 'Entscheidung' && /Angenommen/.test(f.value)));
  assert.equal(members.u1.roles.cache.has('role-tester'), true);
  assert.equal(store.getTester('u1').roblox_id, 555);
  assert.match(client.dms.at(-1).embeds[0].title, /Tester/);

  // Doppelt annehmen geht nicht
  const twice = await act({ kind: 'button', customId: 'app:accept:1', user: 'admin', message: post });
  assert.match(lastText(twice), /schon bearbeitet/);

  // Gleicher Roblox-Account bei anderem Discord-Nutzer wird abgelehnt
  const dup = await act({ kind: 'modal', customId: 'app:submit', user: 'u2', fields: applicationFields });
  assert.match(lastText(dup), /schon bei einem anderen Tester/);
});

test('Bewerbung: unbekannter Roblox-Name und Ablehnung mit Grund', async () => {
  const { store, client, review, act } = setup();

  const unknown = await act({ kind: 'modal', customId: 'app:submit', fields: { ...applicationFields, roblox_name: 'GibtsNicht' } });
  assert.match(lastText(unknown), /keinen Roblox-Account/);
  const invalid = await act({ kind: 'modal', customId: 'app:submit', fields: { ...applicationFields, roblox_name: 'mit leer' } });
  assert.match(lastText(invalid), /kein gültiger Roblox-Name/);
  assert.equal(review.sent.length, 0);

  await act({ kind: 'modal', customId: 'app:submit', fields: applicationFields });
  const post = review.sent[0];
  const button = await act({ kind: 'button', customId: 'app:reject:1', user: 'admin', message: post });
  assert.equal(button.modal.custom_id, 'app:rejectreason:1');

  await act({ kind: 'modal', customId: 'app:rejectreason:1', user: 'admin', message: post, fields: { reason: 'Gerade voll' } });
  assert.equal(store.getApplication(1).status, 'rejected');
  assert.match(client.dms.at(-1).embeds[0].description, /Gerade voll/);
  assert.ok(post.embeds[0].fields.some((f) => /Abgelehnt/.test(f.value)));
  assert.equal(store.getTester('u1'), undefined);
});

test('Playtest: ankündigen, anmelden, erinnern, auswerten', async () => {
  const { store, announce, act, ctx } = setup();
  store.addTester({ discordId: 'u1', robloxId: 555, robloxName: 'TesterName' });

  const past = await act({ kind: 'command', commandName: 'playtest', subcommand: 'erstellen', user: 'admin', options: { titel: 'Arena', start: '01.01.2020 18:00' } });
  assert.match(lastText(past), /Vergangenheit/);
  const bad = await act({ kind: 'command', commandName: 'playtest', subcommand: 'erstellen', user: 'admin', options: { titel: 'Arena', start: 'morgen' } });
  assert.match(lastText(bad), /verstehe ich nicht/);

  const created = await act({
    kind: 'command', commandName: 'playtest', subcommand: 'erstellen', user: 'admin',
    options: { titel: 'Arena', start: '24.12.2099 18:00', dauer: 60, mindestzeit: 15 },
  });
  assert.match(lastText(created), /angekündigt/);
  const post = announce.sent[0];
  assert.match(post.content, /<@&role-tester>/);
  assert.equal(post.components[0].components[0].custom_id, 'pt:join:1');

  const nonTester = await act({ kind: 'button', customId: 'pt:join:1', user: 'u2' });
  assert.match(lastText(nonTester), /Nur angenommene Tester/);
  const join = await act({ kind: 'button', customId: 'pt:join:1' });
  assert.match(lastText(join), /angemeldet/);
  assert.equal(post.embeds[0].fields.find((f) => f.name === 'Angemeldet').value, '1');

  // Playtest auf "gleich" bzw. "vorbei" verschieben und den Scheduler laufen lassen
  const now = Math.floor(Date.now() / 1000);
  store.raw.prepare('UPDATE playtests SET starts_at = ? WHERE id = 1').run(now + 5 * 60);
  await playtests.tick(ctx);
  assert.match(announce.sent.at(-1).content, /startet/);
  assert.match(announce.sent.at(-1).content, /<@u1>/);

  store.raw.prepare('UPDATE playtests SET starts_at = ? WHERE id = 1').run(now - 3600);
  store.recordGameBatch({ batchId: 'g1', players: [{ userId: 555, seconds: 600 }], receivedAt: now - 3000 });
  store.recordGameBatch({ batchId: 'g2', players: [{ userId: 555, seconds: 600 }], receivedAt: now - 2400 });
  await playtests.tick(ctx);
  const result = announce.sent.at(-1).embeds[0];
  assert.match(result.title, /Auswertung/);
  assert.match(result.description, /<@u1> \(TesterName\): 20 Min\./);
  assert.equal(store.getPlaytest(1).status, 'done');
  assert.deepEqual(post.components, [], 'Anmelde-Button ist weg');
  assert.equal(store.playtestsAttended('u1'), 1);
});

test('Giveaway-Verlosung mit Playtest-Bedingung', async () => {
  const { store, client, announce, review, act, ctx } = setup();
  store.addTester({ discordId: 'u1', robloxId: 555, robloxName: 'TesterName' });
  store.addTester({ discordId: 'u2', robloxId: 556, robloxName: 'Zweiter' });
  const now = Math.floor(Date.now() / 1000);
  const ptId = store.createPlaytest({ title: 'Arena', startsAt: now - 7200, durationMin: 60, minMinutes: 15, createdBy: 'admin' });
  store.setPlaytestStatus(ptId, 'done');
  store.recordGameBatch({ batchId: 'p', players: [{ userId: 555, seconds: 600 }, { userId: 556, seconds: 300 }], receivedAt: now - 6600 });
  store.recordGameBatch({ batchId: 'q', players: [{ userId: 555, seconds: 600 }], receivedAt: now - 6000 });

  const badDuration = await act({ kind: 'command', commandName: 'giveaway', subcommand: 'verlosung', user: 'admin', options: { preis: 'Deko', dauer: 'bald' } });
  assert.match(lastText(badDuration), /Dauer verstehe ich nicht/);

  await act({
    kind: 'command', commandName: 'giveaway', subcommand: 'verlosung', user: 'admin',
    options: { preis: 'Discord-Deko', dauer: '1d', gewinner: 2, playtest: ptId, gewichtet: true },
  });
  const post = announce.sent[0];
  assert.match(post.embeds[0].description, /15 Min\.\*\* beim Playtest \*\*Arena/);

  const enter1 = await act({ kind: 'button', customId: 'ga:enter:1' });
  assert.match(lastText(enter1), /Du nimmst teil/);
  assert.match(lastText(enter1), /2 Lose/, '1 Grundlos + 1 Playtest');
  const enter2 = await act({ kind: 'button', customId: 'ga:enter:1', user: 'u2' });
  assert.match(lastText(enter2), /mindestens 15 Min/);

  const end = await act({ kind: 'command', commandName: 'giveaway', subcommand: 'beenden', user: 'admin', options: { id: 1 } });
  assert.match(lastText(end), /1 Gewinner/);
  assert.match(announce.sent.at(-1).content, /Glückwunsch <@u1>/);
  assert.ok(client.dms.some((d) => d.userId === 'u1' && /gewonnen/.test(d.content)));
  assert.match(review.sent.at(-1).content, /Roblox: TesterName/);
  assert.deepEqual(post.components, []);
  assert.ok(post.embeds[0].fields.some((f) => f.name === '🏆 Gewinner'));

  const again = await act({ kind: 'command', commandName: 'giveaway', subcommand: 'beenden', user: 'admin', options: { id: 1 } });
  assert.match(lastText(again), /schon beendet/);
  const reroll = await act({ kind: 'command', commandName: 'giveaway', subcommand: 'neu-auslosen', user: 'admin', options: { id: 1 } });
  assert.match(lastText(reroll), /keine weiteren/);
});

test('Ranglisten-Giveaway: aktueller Stand und automatisches Ende', async () => {
  const { store, announce, act, ctx } = setup();
  store.addTester({ discordId: 'u1', robloxId: 555, robloxName: 'TesterName' });
  store.addTester({ discordId: 'u2', robloxId: 556, robloxName: 'Zweiter' });

  await act({
    kind: 'command', commandName: 'giveaway', subcommand: 'rangliste', user: 'admin',
    options: { preis: 'Deko', tage: 5, wert: 'Kills', plaetze: 3 },
  });
  const post = announce.sent[0];
  assert.match(post.embeds[0].description, /3 besten Tester\*\* nach \*\*kills/);
  assert.equal(post.components[0].components[0].custom_id, 'ga:standings:1');
  store.raw.prepare('UPDATE giveaways SET starts_at = starts_at - 3600 WHERE id = 1').run();

  store.recordGameBatch({
    batchId: 'k',
    stats: [
      { userId: 555, stat: 'kills', delta: 3 },
      { userId: 556, stat: 'kills', delta: 7 },
    ],
    receivedAt: Math.floor(Date.now() / 1000) - 10,
  });
  const standings = await act({ kind: 'button', customId: 'ga:standings:1' });
  assert.match(lastText(standings), /🥇 <@u2> \(Zweiter\): 7\n🥈 <@u1> \(TesterName\): 3/);

  store.raw.prepare('UPDATE giveaways SET ends_at = ? WHERE id = 1').run(Math.floor(Date.now() / 1000));
  await giveaways.tick(ctx);
  assert.match(announce.sent.at(-1).content, /Glückwunsch <@u2>, <@u1>/);
  assert.deepEqual(store.giveawayWinners(1).map((w) => [w.discord_id, w.place, w.detail]), [['u2', 1, '7'], ['u1', 2, '3']]);
});

test('Bug-Report: Forum-Beitrag, Status setzen, Melder bekommt DM', async () => {
  const { client, bugsForum, store, act } = setup();
  const notTester = await act({ kind: 'command', commandName: 'bug' });
  assert.match(lastText(notTester), /Nur Tester/);

  store.addTester({ discordId: 'u1', robloxId: 555, robloxName: 'TesterName' });
  const open = await act({ kind: 'command', commandName: 'bug' });
  assert.equal(open.modal.custom_id, 'bug:submit');

  const uploads = new Map([['a1', { url: 'https://cdn/bild.png', name: 'bild.png', contentType: 'image/png' }]]);
  const submit = await act({
    kind: 'modal', customId: 'bug:submit',
    fields: { title: 'Fällt durch Boden', description: 'In der Arena', steps: '', device: ['pc'], media: uploads },
  });
  assert.match(lastText(submit), /Bug-Report #1/);
  const thread = bugsForum.threads.created[0];
  assert.equal(thread.name, '🟡 #1 Fällt durch Boden');
  const starter = thread.sent[0];
  assert.equal(starter.embeds[0].image.url, 'attachment://bild.png');
  assert.equal(starter.files[0].attachment, 'https://cdn/bild.png');

  const notStaff = await act({ kind: 'button', customId: 'bug:status:1:fixed', message: starter, channel: thread });
  assert.match(lastText(notStaff), /Nur das Team/);

  await act({ kind: 'button', customId: 'bug:status:1:fixed', user: 'admin', message: starter, channel: thread });
  assert.equal(store.getBug(1).status, 'fixed');
  assert.match(starter.embeds[0].fields.find((f) => f.name === 'Status').value, /Behoben/);
  assert.equal(thread.name, '🟢 #1 Fällt durch Boden');
  assert.ok(client.dms.some((d) => d.userId === 'u1' && /behoben/.test(d.content)));
});

test('Profil und Rangliste', async () => {
  const { store, act } = setup();
  store.addTester({ discordId: 'u1', robloxId: 555, robloxName: 'TesterName' });
  store.recordGameBatch({ batchId: 'x', players: [{ userId: 555, seconds: 3000 }], stats: [{ userId: 555, stat: 'siege', delta: 4 }] });

  const profile = await act({ kind: 'command', commandName: 'profil' });
  const embed = profile.replies.at(-1).embeds[0];
  assert.equal(embed.title, '🧪 TesterName');
  assert.equal(embed.fields.find((f) => f.name === 'Spielzeit gesamt').value, '50 Min.');
  assert.match(embed.fields.find((f) => f.name === 'Werte im Spiel').value, /siege: \*\*4\*\*/);

  const byName = await act({ kind: 'command', commandName: 'profil', options: { roblox: 'testername' } });
  assert.equal(byName.replies.at(-1).embeds[0].title, '🧪 TesterName');
  const none = await act({ kind: 'command', commandName: 'profil', options: { nutzer: 'u2' } });
  assert.match(lastText(none), /noch kein Tester/);

  const board = await act({ kind: 'command', commandName: 'rangliste', options: { tage: 7 } });
  assert.match(board.replies.at(-1).embeds[0].description, /🥇 <@u1> \(TesterName\): 50 Min\./);

  const auto = await act({ kind: 'autocomplete', commandName: 'rangliste', focused: { name: 'wert', value: '' } });
  assert.deepEqual(auto.responded.map((r) => r.value), [PLAYTIME_STAT, 'siege']);
});

test('Setup zeigt Einstellungen und Tester-Verwaltung', async () => {
  const { store, members, act } = setup();
  const setupView = await act({ kind: 'command', commandName: 'setup', subcommand: 'einstellungen', user: 'admin' });
  assert.match(setupView.replies.at(-1).embeds[0].description, /Tester-Rolle:\*\* <@&role-tester>/);
  assert.match(setupView.replies.at(-1).embeds[0].description, /Team-Rolle:\*\* ❌ nicht gesetzt/);

  const added = await act({ kind: 'command', commandName: 'tester', subcommand: 'hinzufuegen', user: 'admin', options: { nutzer: 'u2', roblox: 'Zweiter' } });
  assert.match(lastText(added), /ist jetzt Tester/);
  assert.equal(members.u2.roles.cache.has('role-tester'), true);

  const removed = await act({ kind: 'command', commandName: 'tester', subcommand: 'entfernen', user: 'admin', options: { nutzer: 'u2', grund: 'Leak' } });
  assert.match(lastText(removed), /kein Tester mehr/);
  assert.equal(members.u2.roles.cache.has('role-tester'), false);
  assert.equal(store.getTester('u2'), undefined);
});

test('Fehler in einem Befehl führen zu einer freundlichen Meldung statt Absturz', async () => {
  const { act, store } = setup();
  store.raw.close();
  const broken = await act({ kind: 'command', commandName: 'profil' });
  assert.match(lastText(broken), /etwas schiefgelaufen/);
});
