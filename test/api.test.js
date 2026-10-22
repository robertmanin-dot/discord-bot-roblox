const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createApiServer, validateReport } = require('../src/api');

const KEY = 'test-schluessel';

async function withServer(fn) {
  const store = openDatabase(':memory:');
  store.addTester({ discordId: 'd1', robloxId: 101, robloxName: 'Alpha' });
  const server = createApiServer({ store, apiKey: KEY, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ store, base });
  } finally {
    server.close();
  }
}

function post(base, body, key = KEY) {
  return fetch(`${base}/api/v1/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Api-Key': key } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('Health-Check', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/v1/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test('Ohne oder mit falschem Schlüssel: 401', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await post(base, { batchId: 'a' }, null)).status, 401);
    assert.equal((await post(base, { batchId: 'a' }, 'falsch')).status, 401);
  });
});

test('Gültiges Paket wird gespeichert, doppeltes ignoriert', async () => {
  await withServer(async ({ base, store }) => {
    const body = {
      batchId: 'abc',
      players: [{ userId: 101, name: 'Alpha', seconds: 60 }],
      stats: [{ userId: 101, stat: 'Kills', delta: 3 }],
    };
    const first = await post(base, body);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true, duplicate: false });
    const second = await post(base, body);
    assert.deepEqual(await second.json(), { ok: true, duplicate: true });
    assert.equal(store.playtimeSeconds(101), 60);
    assert.deepEqual(store.statTotals(101), [{ stat: 'kills', value: 3 }]);
  });
});

test('Ungültige Daten: 400', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await post(base, 'kein json')).status, 400);
    assert.equal((await post(base, { players: [] })).status, 400);
    assert.equal((await post(base, { batchId: 'x', players: [{ userId: -1, seconds: 5 }] })).status, 400);
    assert.equal((await post(base, { batchId: 'y', stats: [{ userId: 1, stat: 'spielzeit', delta: 5 }] })).status, 400);
    assert.equal((await post(base, { batchId: 'z', stats: [{ userId: 1, stat: 'böse name', delta: 5 }] })).status, 400);
  });
});

test('Falsche Methode und Pfad', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await fetch(`${base}/api/v1/report`)).status, 405);
    assert.equal((await fetch(`${base}/irgendwas`)).status, 404);
  });
});

test('validateReport: Sekunden begrenzt, Zeitpunkt nicht in der Zukunft', () => {
  const now = 1_800_000_000;
  const r = validateReport(
    { batchId: 'a', recordedAt: now + 9999, players: [{ userId: 1, name: 'x y', seconds: 99999 }] },
    now,
  );
  assert.equal(r.players[0].seconds, 600);
  assert.equal(r.players[0].name, null);
  assert.equal(r.receivedAt, now);

  assert.equal(validateReport({ batchId: 'b', recordedAt: now - 300 }, now).receivedAt, now - 300);
  assert.deepEqual(validateReport({ batchId: 'e', players: {}, stats: {} }, now).stats, []);
  assert.equal(validateReport({ batchId: 'c', recordedAt: now - 10 * 86400 }, now).receivedAt, now - 2 * 86400);
});
