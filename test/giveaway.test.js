const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, PLAYTIME_STAT } = require('../src/db');
const { checkEligibility, drawWinners } = require('../src/features/giveaway-logic');
const { pickWinners } = require('../src/features/giveaways');

const T0 = 1_800_000_000;

test('drawWinners: keine doppelten Gewinner, nie mehr als möglich', () => {
  const candidates = [
    { id: 'a', tickets: 1 },
    { id: 'b', tickets: 3 },
    { id: 'c', tickets: 0 },
  ];
  for (let i = 0; i < 50; i += 1) {
    const winners = drawWinners(candidates, 5);
    assert.equal(winners.length, 2);
    assert.equal(new Set(winners).size, 2);
    assert.ok(!winners.includes('c'));
  }
});

test('drawWinners: mehr Lose = höhere Chance', () => {
  const candidates = [
    { id: 'a', tickets: 1 },
    { id: 'b', tickets: 9 },
  ];
  let b = 0;
  for (let i = 0; i < 2000; i += 1) if (drawWinners(candidates, 1)[0] === 'b') b += 1;
  assert.ok(b > 1650 && b < 1950, `b gewann ${b} von 2000`);
});

test('drawWinners: Losverteilung ist korrekt (feste Zufallszahlen)', () => {
  const candidates = [
    { id: 'a', tickets: 2 },
    { id: 'b', tickets: 3 },
  ];
  assert.deepEqual(drawWinners(candidates, 1, () => 0), ['a']);
  assert.deepEqual(drawWinners(candidates, 1, () => 1), ['a']);
  assert.deepEqual(drawWinners(candidates, 1, () => 2), ['b']);
  assert.deepEqual(drawWinners(candidates, 1, () => 4), ['b']);
});

function setup() {
  const store = openDatabase(':memory:');
  store.addTester({ discordId: 'd1', robloxId: 101, robloxName: 'Alpha' });
  store.addTester({ discordId: 'd2', robloxId: 102, robloxName: 'Beta' });
  const ptId = store.createPlaytest({ title: 'Arena', startsAt: T0, durationMin: 60, minMinutes: 15, createdBy: 'admin' });
  // d1 spielt 20 Minuten beim Playtest, d2 nur 5
  store.recordGameBatch({ batchId: 'a', players: [{ userId: 101, seconds: 600 }, { userId: 102, seconds: 300 }], receivedAt: T0 + 600 });
  store.recordGameBatch({ batchId: 'b', players: [{ userId: 101, seconds: 600 }], receivedAt: T0 + 1200 });
  return { store, ptId };
}

test('Teilnahme-Bedingungen: nur Tester, Mindestzeit beim Playtest', () => {
  const { store, ptId } = setup();
  const g = { playtest_id: ptId, min_minutes: null, weighted: 0 };

  assert.equal(checkEligibility(store, g, 'fremd').ok, false);

  // Während der Playtest noch läuft: Teilnahme erlaubt, wird später geprüft
  const during = checkEligibility(store, g, 'd2', { at: T0 + 1800 });
  assert.equal(during.ok, true);
  assert.match(during.pending, /15 Min/);

  // Nach dem Playtest bzw. bei der Auslosung: endgültig
  assert.equal(checkEligibility(store, g, 'd2', { at: T0 + 7200 }).ok, false);
  assert.equal(checkEligibility(store, g, 'd2', { final: true, at: T0 + 1800 }).ok, false);
  assert.equal(checkEligibility(store, g, 'd1', { final: true }).ok, true);

  // Eigene Mindestzeit im Giveaway überschreibt die des Playtests
  assert.equal(checkEligibility(store, { ...g, min_minutes: 5 }, 'd2', { final: true }).ok, true);
});

test('Gewichtete Lose: +1 pro Playtest und gültigem Bug', () => {
  const { store, ptId } = setup();
  store.setPlaytestStatus(ptId, 'done');
  store.createBug({ discordId: 'd1', title: 'Bug', description: 'x' });
  const result = checkEligibility(store, { weighted: 1 }, 'd1', { final: true });
  assert.equal(result.tickets, 3);
  assert.equal(checkEligibility(store, { weighted: 0 }, 'd1', { final: true }).tickets, 1);
});

test('Verlosung: nur berechtigte Teilnehmer gewinnen', () => {
  const { store, ptId } = setup();
  const id = store.createGiveaway({
    type: 'raffle', prize: 'Deko', winnersCount: 2, startsAt: T0, endsAt: T0 + 3600, playtestId: ptId, createdBy: 'admin',
  });
  store.addGiveawayEntry(id, 'd1');
  store.addGiveawayEntry(id, 'd2');
  const winners = pickWinners(store, store.getGiveaway(id), 2);
  assert.deepEqual(winners.map((w) => w.discordId), ['d1']);
  assert.deepEqual(pickWinners(store, store.getGiveaway(id), 1, new Set(['d1'])), []);
});

test('Ranglisten-Giveaway: Platz 1–3 im Zeitraum, neu auslosen nimmt den Nächsten', () => {
  const store = openDatabase(':memory:');
  for (let i = 1; i <= 5; i += 1) store.addTester({ discordId: `d${i}`, robloxId: 100 + i, robloxName: `P${i}` });
  const id = store.createGiveaway({
    type: 'leaderboard', prize: 'Deko', winnersCount: 3, startsAt: T0, endsAt: T0 + 5 * 86400, stat: PLAYTIME_STAT, createdBy: 'admin',
  });
  store.recordGameBatch({
    batchId: 'x',
    players: [1, 2, 3, 4, 5].map((i) => ({ userId: 100 + i, seconds: i * 60 })),
    receivedAt: T0 + 86400,
  });
  // Spielzeit vor dem Start zählt nicht
  store.recordGameBatch({ batchId: 'vorher', players: [{ userId: 101, seconds: 600 }], receivedAt: T0 - 3600 });

  const g = store.getGiveaway(id);
  const winners = pickWinners(store, g, 3);
  assert.deepEqual(winners.map((w) => w.discordId), ['d5', 'd4', 'd3']);
  assert.equal(winners[0].detail, '5 Min.');

  const next = pickWinners(store, g, 1, new Set(['d5', 'd4', 'd3']));
  assert.deepEqual(next.map((w) => w.discordId), ['d2']);
});

test('Giveaway wird nur einmal beendet', () => {
  const store = openDatabase(':memory:');
  const id = store.createGiveaway({ type: 'raffle', prize: 'x', winnersCount: 1, startsAt: T0, endsAt: T0 + 1, createdBy: 'a' });
  assert.equal(store.giveawaysDue(T0 + 2).length, 1);
  assert.equal(store.endGiveaway(id), true);
  assert.equal(store.endGiveaway(id), false);
  assert.equal(store.giveawaysDue(T0 + 2).length, 0);
});
