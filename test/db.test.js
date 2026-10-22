const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, PLAYTIME_STAT } = require('../src/db');

const T0 = 1_800_000_000; // fester Zeitpunkt, durch 60 teilbar

function setup() {
  const store = openDatabase(':memory:');
  store.addTester({ discordId: 'd1', robloxId: 101, robloxName: 'Alpha' });
  store.addTester({ discordId: 'd2', robloxId: 102, robloxName: 'Beta' });
  return store;
}

test('Pakete vom Spiel zählen nur einmal', () => {
  const store = setup();
  const batch = { batchId: 'b1', players: [{ userId: 101, name: 'Alpha', seconds: 60 }], receivedAt: T0 };
  assert.equal(store.recordGameBatch(batch), true);
  assert.equal(store.recordGameBatch(batch), false);
  assert.equal(store.playtimeSeconds(101), 60);
});

test('Spielzeit im Zeitraum', () => {
  const store = setup();
  for (let i = 0; i < 30; i += 1) {
    store.recordGameBatch({ batchId: `a${i}`, players: [{ userId: 101, seconds: 60 }], receivedAt: T0 + i * 60 });
  }
  assert.equal(store.playtimeSeconds(101), 30 * 60);
  assert.equal(store.playtimeSeconds(101, T0, T0 + 10 * 60), 10 * 60);
  assert.equal(store.playtimeSeconds(101, T0 + 3600, T0 + 7200), 0);
});

test('Rangliste: nur Tester, sortiert, Spielzeit und Werte', () => {
  const store = setup();
  store.recordGameBatch({
    batchId: 'x',
    players: [
      { userId: 101, seconds: 120 },
      { userId: 102, seconds: 300 },
      { userId: 999, name: 'Fremder', seconds: 600 },
    ],
    stats: [
      { userId: 101, stat: 'kills', delta: 5 },
      { userId: 102, stat: 'kills', delta: 2 },
      { userId: 999, stat: 'kills', delta: 50 },
    ],
    receivedAt: T0,
  });

  const time = store.leaderboard(PLAYTIME_STAT, T0, T0 + 60);
  assert.deepEqual(time.map((r) => r.discord_id), ['d2', 'd1']);

  const kills = store.leaderboard('kills', T0, T0 + 60);
  assert.deepEqual(kills.map((r) => [r.discord_id, r.value]), [['d1', 5], ['d2', 2]]);

  const all = store.leaderboard('kills', T0, T0 + 60, { testersOnly: false });
  assert.equal(all[0].roblox_name, 'Fremder');

  assert.deepEqual(store.knownStats(), ['kills']);
});

test('Playtest-Teilnahme ab Mindestzeit', () => {
  const store = setup();
  const id = store.createPlaytest({ title: 'Test', startsAt: T0, durationMin: 60, minMinutes: 15, createdBy: 'admin' });
  // d1 spielt 20 Minuten, d2 nur 10 Minuten, beide im Zeitraum
  for (let i = 0; i < 20; i += 1) {
    store.recordGameBatch({
      batchId: `p${i}`,
      players: [{ userId: 101, seconds: 60 }, ...(i < 10 ? [{ userId: 102, seconds: 60 }] : [])],
      receivedAt: T0 + 60 + i * 60,
    });
  }
  // Spielzeit nach dem Playtest zählt nicht
  store.recordGameBatch({ batchId: 'after', players: [{ userId: 102, seconds: 600 }], receivedAt: T0 + 2 * 3600 });

  const pt = store.getPlaytest(id);
  assert.deepEqual(store.playtestParticipants(pt).map((p) => p.discord_id), ['d1']);

  assert.equal(store.playtestsAttended('d1'), 0, 'zählt erst, wenn der Playtest beendet ist');
  store.setPlaytestStatus(id, 'done');
  assert.equal(store.playtestsAttended('d1'), 1);
  assert.equal(store.playtestsAttended('d2'), 0);
});

test('Playtest: Anmelden, Abmelden, Erinnerung und Ende', () => {
  const store = setup();
  const id = store.createPlaytest({ title: 'Test', startsAt: T0, durationMin: 30, minMinutes: 10, createdBy: 'admin' });
  assert.equal(store.togglePlaytestSignup(id, 'd1'), true);
  assert.equal(store.togglePlaytestSignup(id, 'd2'), true);
  assert.equal(store.togglePlaytestSignup(id, 'd2'), false);
  assert.deepEqual(store.playtestSignups(id), ['d1']);

  assert.equal(store.playtestsDueForReminder(T0 - 20 * 60).length, 0);
  assert.equal(store.playtestsDueForReminder(T0 - 10 * 60).length, 1);
  store.markPlaytestReminded(id);
  assert.equal(store.playtestsDueForReminder(T0 - 5 * 60).length, 0);

  assert.equal(store.playtestsFinished(T0 + 29 * 60).length, 0);
  assert.equal(store.playtestsFinished(T0 + 30 * 60).length, 1);
});

test('Bewerbung kann nur einmal entschieden werden', () => {
  const store = setup();
  const id = store.createApplication({
    discordId: 'd3',
    robloxId: 103,
    robloxName: 'Gamma',
    ageGroup: '16-17',
    devices: 'pc,handy',
    playFrequency: 'taeglich',
  });
  assert.equal(store.getPendingApplication('d3').id, id);
  assert.equal(store.decideApplication(id, 'accepted', 'admin'), true);
  assert.equal(store.decideApplication(id, 'rejected', 'admin2'), false);
  assert.equal(store.getApplication(id).status, 'accepted');
  assert.equal(store.getPendingApplication('d3'), undefined);
});

test('Tester per Roblox-Name finden (auch neuer Name aus dem Spiel)', () => {
  const store = setup();
  assert.equal(store.getTesterByRobloxName('alpha').discord_id, 'd1');
  store.recordGameBatch({ batchId: 'n', players: [{ userId: 101, name: 'AlphaNeu', seconds: 0 }], receivedAt: T0 });
  assert.equal(store.getTesterByRobloxName('AlphaNeu').discord_id, 'd1');
});

test('Bug-Zähler ignoriert „kein Bug“ und Duplikate', () => {
  const store = setup();
  const a = store.createBug({ discordId: 'd1', title: 'A', description: 'x' });
  const b = store.createBug({ discordId: 'd1', title: 'B', description: 'x' });
  store.createBug({ discordId: 'd1', title: 'C', description: 'x' });
  store.setBugStatus(a, 'invalid');
  store.setBugStatus(b, 'fixed');
  assert.equal(store.validBugCount('d1'), 2);
});
