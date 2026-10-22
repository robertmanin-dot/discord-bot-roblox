const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const PLAYTIME_STAT = 'spielzeit';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS applications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id        TEXT    NOT NULL,
  roblox_id         INTEGER NOT NULL,
  roblox_name       TEXT    NOT NULL,
  age_group         TEXT    NOT NULL,
  devices           TEXT    NOT NULL,
  play_frequency    TEXT    NOT NULL,
  motivation        TEXT,
  status            TEXT    NOT NULL DEFAULT 'pending',
  review_channel_id TEXT,
  review_message_id TEXT,
  reviewed_by       TEXT,
  reason            TEXT,
  created_at        INTEGER NOT NULL,
  reviewed_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_applications_discord ON applications(discord_id, status);

CREATE TABLE IF NOT EXISTS testers (
  discord_id     TEXT PRIMARY KEY,
  roblox_id      INTEGER NOT NULL UNIQUE,
  roblox_name    TEXT    NOT NULL,
  application_id INTEGER,
  accepted_at    INTEGER NOT NULL
);

-- Neuester Roblox-Name, den das Spiel gemeldet hat
CREATE TABLE IF NOT EXISTS roblox_players (
  roblox_id  INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  last_seen  INTEGER NOT NULL
);

-- Spielzeit in Sekunden, gesammelt pro Minute (bucket = Unix-Zeit / 60)
CREATE TABLE IF NOT EXISTS playtime (
  roblox_id INTEGER NOT NULL,
  bucket    INTEGER NOT NULL,
  seconds   INTEGER NOT NULL,
  PRIMARY KEY (roblox_id, bucket)
);
CREATE INDEX IF NOT EXISTS idx_playtime_bucket ON playtime(bucket);

CREATE TABLE IF NOT EXISTS stat_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  roblox_id INTEGER NOT NULL,
  stat      TEXT    NOT NULL,
  delta     REAL    NOT NULL,
  ts        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stat_events_stat_ts ON stat_events(stat, ts);
CREATE INDEX IF NOT EXISTS idx_stat_events_player ON stat_events(roblox_id);

-- Bereits verarbeitete Pakete vom Spiel, damit doppelt gesendete Daten nicht doppelt zählen
CREATE TABLE IF NOT EXISTS api_batches (
  batch_id    TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playtests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  description  TEXT,
  starts_at    INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  min_minutes  INTEGER NOT NULL,
  channel_id   TEXT,
  message_id   TEXT,
  created_by   TEXT    NOT NULL,
  reminded     INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'planned',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playtest_signups (
  playtest_id INTEGER NOT NULL,
  discord_id  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (playtest_id, discord_id)
);

CREATE TABLE IF NOT EXISTS giveaways (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL,
  prize         TEXT    NOT NULL,
  winners_count INTEGER NOT NULL,
  starts_at     INTEGER NOT NULL,
  ends_at       INTEGER NOT NULL,
  playtest_id   INTEGER,
  min_minutes   INTEGER,
  stat          TEXT,
  weighted      INTEGER NOT NULL DEFAULT 0,
  channel_id    TEXT,
  message_id    TEXT,
  status        TEXT    NOT NULL DEFAULT 'running',
  created_by    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL,
  discord_id  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, discord_id)
);

CREATE TABLE IF NOT EXISTS giveaway_winners (
  giveaway_id INTEGER NOT NULL,
  discord_id  TEXT    NOT NULL,
  place       INTEGER NOT NULL,
  detail      TEXT,
  drawn_at    INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, discord_id)
);

CREATE TABLE IF NOT EXISTS bugs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL,
  steps       TEXT,
  device      TEXT,
  status      TEXT    NOT NULL DEFAULT 'open',
  channel_id  TEXT,
  message_id  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
`;

const now = () => Math.floor(Date.now() / 1000);

function openDatabase(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return createStore(db);
}

function createStore(db) {
  const store = {
    raw: db,

    // ---------- Einstellungen ----------
    getSetting(key) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row ? row.value : null;
    },
    setSetting(key, value) {
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(key, value);
    },

    // ---------- Bewerbungen ----------
    createApplication(app) {
      const info = db
        .prepare(
          `INSERT INTO applications
             (discord_id, roblox_id, roblox_name, age_group, devices, play_frequency, motivation, created_at)
           VALUES (@discordId, @robloxId, @robloxName, @ageGroup, @devices, @playFrequency, @motivation, @createdAt)`,
        )
        .run({ motivation: null, createdAt: now(), ...app });
      return info.lastInsertRowid;
    },
    getApplication(id) {
      return db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
    },
    getPendingApplication(discordId) {
      return db
        .prepare("SELECT * FROM applications WHERE discord_id = ? AND status = 'pending' ORDER BY id DESC")
        .get(discordId);
    },
    setApplicationReviewMessage(id, channelId, messageId) {
      db.prepare('UPDATE applications SET review_channel_id = ?, review_message_id = ? WHERE id = ?').run(
        channelId,
        messageId,
        id,
      );
    },
    /** Setzt den Status nur, wenn die Bewerbung noch offen ist. Gibt true zurück, wenn es geklappt hat. */
    decideApplication(id, status, reviewerId, reason = null) {
      const info = db
        .prepare(
          `UPDATE applications SET status = ?, reviewed_by = ?, reason = ?, reviewed_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(status, reviewerId, reason, now(), id);
      return info.changes === 1;
    },

    // ---------- Tester ----------
    addTester({ discordId, robloxId, robloxName, applicationId = null }) {
      db.prepare(
        `INSERT INTO testers (discord_id, roblox_id, roblox_name, application_id, accepted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(discord_id) DO UPDATE SET
           roblox_id = excluded.roblox_id, roblox_name = excluded.roblox_name,
           application_id = excluded.application_id, accepted_at = excluded.accepted_at`,
      ).run(discordId, robloxId, robloxName, applicationId, now());
    },
    getTester(discordId) {
      return db.prepare('SELECT * FROM testers WHERE discord_id = ?').get(discordId);
    },
    getTesterByRobloxId(robloxId) {
      return db.prepare('SELECT * FROM testers WHERE roblox_id = ?').get(robloxId);
    },
    getTesterByRobloxName(name) {
      return db
        .prepare(
          `SELECT t.* FROM testers t
           LEFT JOIN roblox_players p ON p.roblox_id = t.roblox_id
           WHERE lower(t.roblox_name) = lower(?) OR lower(p.name) = lower(?)`,
        )
        .get(name, name);
    },
    removeTester(discordId) {
      return db.prepare('DELETE FROM testers WHERE discord_id = ?').run(discordId).changes === 1;
    },
    countTesters() {
      return db.prepare('SELECT COUNT(*) AS n FROM testers').get().n;
    },

    // ---------- Daten vom Spiel ----------
    /**
     * Speichert ein Paket vom Spiel. Gibt false zurück, wenn das Paket schon einmal verarbeitet wurde.
     * players: [{ userId, name, seconds }], stats: [{ userId, stat, delta }]
     */
    recordGameBatch({ batchId, players = [], stats = [], receivedAt = now() }) {
      const bucket = Math.floor(receivedAt / 60);
      const insertBatch = db.prepare('INSERT OR IGNORE INTO api_batches (batch_id, received_at) VALUES (?, ?)');
      const upsertPlayer = db.prepare(
        `INSERT INTO roblox_players (roblox_id, name, last_seen) VALUES (?, ?, ?)
         ON CONFLICT(roblox_id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`,
      );
      const addPlaytime = db.prepare(
        `INSERT INTO playtime (roblox_id, bucket, seconds) VALUES (?, ?, ?)
         ON CONFLICT(roblox_id, bucket) DO UPDATE SET seconds = seconds + excluded.seconds`,
      );
      const addStat = db.prepare('INSERT INTO stat_events (roblox_id, stat, delta, ts) VALUES (?, ?, ?, ?)');

      return db.transaction(() => {
        if (insertBatch.run(batchId, receivedAt).changes === 0) return false;
        for (const p of players) {
          if (p.name) upsertPlayer.run(p.userId, p.name, receivedAt);
          if (p.seconds > 0) addPlaytime.run(p.userId, bucket, p.seconds);
        }
        for (const s of stats) {
          addStat.run(s.userId, s.stat, s.delta, receivedAt);
        }
        return true;
      })();
    },
    pruneApiBatches(olderThan = now() - 7 * 24 * 3600) {
      db.prepare('DELETE FROM api_batches WHERE received_at < ?').run(olderThan);
    },

    /** Spielzeit (Sekunden) eines Roblox-Spielers im Zeitraum [from, to). Ohne Grenzen = gesamt. */
    playtimeSeconds(robloxId, from = 0, to = Number.MAX_SAFE_INTEGER) {
      return db
        .prepare(
          `SELECT COALESCE(SUM(seconds), 0) AS s FROM playtime
           WHERE roblox_id = ? AND bucket >= ? AND bucket < ?`,
        )
        .get(robloxId, Math.floor(from / 60), Math.ceil(to / 60)).s;
    },

    /** Alle Tester mit ihrer Spielzeit im Zeitraum, absteigend sortiert (nur Tester mit Spielzeit > 0). */
    testerPlaytimeInWindow(from, to) {
      return db
        .prepare(
          `SELECT t.discord_id, t.roblox_id, COALESCE(p.name, t.roblox_name) AS roblox_name, SUM(pt.seconds) AS seconds
           FROM testers t
           JOIN playtime pt ON pt.roblox_id = t.roblox_id
           LEFT JOIN roblox_players p ON p.roblox_id = t.roblox_id
           WHERE pt.bucket >= ? AND pt.bucket < ?
           GROUP BY t.discord_id
           ORDER BY seconds DESC`,
        )
        .all(Math.floor(from / 60), Math.ceil(to / 60));
    },

    /**
     * Rangliste für einen Wert im Zeitraum [from, to).
     * stat = 'spielzeit' nutzt die Spielzeit (in Sekunden), sonst die Summe der gemeldeten Werte.
     * testersOnly = true zählt nur angenommene Tester.
     */
    leaderboard(stat, from, to, { limit = 10, testersOnly = true } = {}) {
      const testerJoin = testersOnly ? 'JOIN testers t ON t.roblox_id = x.roblox_id' : 'LEFT JOIN testers t ON t.roblox_id = x.roblox_id';
      let inner;
      let params;
      if (stat === PLAYTIME_STAT) {
        inner = 'SELECT roblox_id, SUM(seconds) AS value FROM playtime WHERE bucket >= ? AND bucket < ? GROUP BY roblox_id';
        params = [Math.floor(from / 60), Math.ceil(to / 60)];
      } else {
        inner = 'SELECT roblox_id, SUM(delta) AS value FROM stat_events WHERE stat = ? AND ts >= ? AND ts < ? GROUP BY roblox_id';
        params = [stat, from, to];
      }
      return db
        .prepare(
          `SELECT x.roblox_id, x.value, t.discord_id,
                  COALESCE(p.name, t.roblox_name, CAST(x.roblox_id AS TEXT)) AS roblox_name
           FROM (${inner}) x
           ${testerJoin}
           LEFT JOIN roblox_players p ON p.roblox_id = x.roblox_id
           WHERE x.value > 0
           ORDER BY x.value DESC, x.roblox_id ASC
           LIMIT ?`,
        )
        .all(...params, limit);
    },

    knownStats() {
      return db
        .prepare('SELECT stat FROM stat_events GROUP BY stat ORDER BY COUNT(*) DESC LIMIT 25')
        .all()
        .map((r) => r.stat);
    },

    statTotals(robloxId) {
      return db
        .prepare('SELECT stat, SUM(delta) AS value FROM stat_events WHERE roblox_id = ? GROUP BY stat ORDER BY stat')
        .all(robloxId);
    },

    // ---------- Playtests ----------
    createPlaytest(pt) {
      const info = db
        .prepare(
          `INSERT INTO playtests (title, description, starts_at, duration_min, min_minutes, created_by, created_at)
           VALUES (@title, @description, @startsAt, @durationMin, @minMinutes, @createdBy, @createdAt)`,
        )
        .run({ description: null, createdAt: now(), ...pt });
      return info.lastInsertRowid;
    },
    getPlaytest(id) {
      return db.prepare('SELECT * FROM playtests WHERE id = ?').get(id);
    },
    setPlaytestMessage(id, channelId, messageId) {
      db.prepare('UPDATE playtests SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, id);
    },
    setPlaytestStatus(id, status) {
      db.prepare('UPDATE playtests SET status = ? WHERE id = ?').run(status, id);
    },
    markPlaytestReminded(id) {
      db.prepare('UPDATE playtests SET reminded = 1 WHERE id = ?').run(id);
    },
    listPlaytests({ includeDone = false, limit = 25 } = {}) {
      const where = includeDone ? "status != 'cancelled'" : "status = 'planned'";
      const order = includeDone ? 'starts_at DESC' : 'starts_at ASC';
      return db.prepare(`SELECT * FROM playtests WHERE ${where} ORDER BY ${order} LIMIT ?`).all(limit);
    },
    playtestsDueForReminder(at = now(), leadSeconds = 15 * 60) {
      return db
        .prepare("SELECT * FROM playtests WHERE status = 'planned' AND reminded = 0 AND starts_at - ? <= ? AND starts_at > ?")
        .all(leadSeconds, at, at);
    },
    playtestsFinished(at = now()) {
      return db.prepare("SELECT * FROM playtests WHERE status = 'planned' AND starts_at + duration_min * 60 <= ?").all(at);
    },
    /** Meldet an oder ab. Gibt true zurück, wenn der Nutzer jetzt angemeldet ist. */
    togglePlaytestSignup(playtestId, discordId) {
      return db.transaction(() => {
        const removed = db
          .prepare('DELETE FROM playtest_signups WHERE playtest_id = ? AND discord_id = ?')
          .run(playtestId, discordId).changes;
        if (removed) return false;
        db.prepare('INSERT INTO playtest_signups (playtest_id, discord_id, created_at) VALUES (?, ?, ?)').run(
          playtestId,
          discordId,
          now(),
        );
        return true;
      })();
    },
    playtestSignups(playtestId) {
      return db
        .prepare('SELECT discord_id FROM playtest_signups WHERE playtest_id = ? ORDER BY created_at')
        .all(playtestId)
        .map((r) => r.discord_id);
    },
    /** Tester, die beim Playtest mindestens min_minutes gespielt haben. */
    playtestParticipants(playtest) {
      const from = playtest.starts_at;
      const to = playtest.starts_at + playtest.duration_min * 60;
      return store.testerPlaytimeInWindow(from, to).filter((r) => r.seconds >= playtest.min_minutes * 60);
    },
    /** Anzahl Playtests, bei denen der Tester die Mindestzeit erreicht hat. */
    playtestsAttended(discordId) {
      const tester = store.getTester(discordId);
      if (!tester) return 0;
      const done = db.prepare("SELECT * FROM playtests WHERE status = 'done'").all();
      return done.filter(
        (pt) =>
          store.playtimeSeconds(tester.roblox_id, pt.starts_at, pt.starts_at + pt.duration_min * 60) >=
          pt.min_minutes * 60,
      ).length;
    },

    // ---------- Giveaways ----------
    createGiveaway(g) {
      const info = db
        .prepare(
          `INSERT INTO giveaways
             (type, prize, winners_count, starts_at, ends_at, playtest_id, min_minutes, stat, weighted, created_by)
           VALUES (@type, @prize, @winnersCount, @startsAt, @endsAt, @playtestId, @minMinutes, @stat, @weighted, @createdBy)`,
        )
        .run({ playtestId: null, minMinutes: null, stat: null, weighted: 0, startsAt: now(), ...g });
      return info.lastInsertRowid;
    },
    getGiveaway(id) {
      return db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id);
    },
    setGiveawayMessage(id, channelId, messageId) {
      db.prepare('UPDATE giveaways SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, id);
    },
    /** Beendet ein Giveaway nur einmal. Gibt true zurück, wenn dieser Aufruf es beendet hat. */
    endGiveaway(id) {
      return db.prepare("UPDATE giveaways SET status = 'ended' WHERE id = ? AND status = 'running'").run(id).changes === 1;
    },
    giveawaysDue(at = now()) {
      return db.prepare("SELECT * FROM giveaways WHERE status = 'running' AND ends_at <= ?").all(at);
    },
    listGiveaways({ running = true, limit = 25 } = {}) {
      const where = running ? "status = 'running'" : '1 = 1';
      return db.prepare(`SELECT * FROM giveaways WHERE ${where} ORDER BY id DESC LIMIT ?`).all(limit);
    },
    /** Gibt true zurück, wenn der Nutzer neu teilnimmt, false wenn er schon dabei war. */
    addGiveawayEntry(giveawayId, discordId) {
      return (
        db
          .prepare('INSERT OR IGNORE INTO giveaway_entries (giveaway_id, discord_id, created_at) VALUES (?, ?, ?)')
          .run(giveawayId, discordId, now()).changes === 1
      );
    },
    removeGiveawayEntry(giveawayId, discordId) {
      return (
        db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND discord_id = ?').run(giveawayId, discordId)
          .changes === 1
      );
    },
    giveawayEntries(giveawayId) {
      return db
        .prepare('SELECT discord_id FROM giveaway_entries WHERE giveaway_id = ? ORDER BY created_at')
        .all(giveawayId)
        .map((r) => r.discord_id);
    },
    addGiveawayWinners(giveawayId, winners) {
      const insert = db.prepare(
        'INSERT OR IGNORE INTO giveaway_winners (giveaway_id, discord_id, place, detail, drawn_at) VALUES (?, ?, ?, ?, ?)',
      );
      db.transaction(() => {
        for (const w of winners) insert.run(giveawayId, w.discordId, w.place, w.detail ?? null, now());
      })();
    },
    giveawayWinners(giveawayId) {
      return db.prepare('SELECT * FROM giveaway_winners WHERE giveaway_id = ? ORDER BY place').all(giveawayId);
    },
    giveawayWinCount(discordId) {
      return db.prepare('SELECT COUNT(*) AS n FROM giveaway_winners WHERE discord_id = ?').get(discordId).n;
    },

    // ---------- Bug-Reports ----------
    createBug(bug) {
      const t = now();
      const info = db
        .prepare(
          `INSERT INTO bugs (discord_id, title, description, steps, device, created_at, updated_at)
           VALUES (@discordId, @title, @description, @steps, @device, @t, @t)`,
        )
        .run({ steps: null, device: null, ...bug, t });
      return info.lastInsertRowid;
    },
    getBug(id) {
      return db.prepare('SELECT * FROM bugs WHERE id = ?').get(id);
    },
    setBugMessage(id, channelId, messageId) {
      db.prepare('UPDATE bugs SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, id);
    },
    setBugStatus(id, status) {
      db.prepare('UPDATE bugs SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
    },
    /** Zählt Bug-Reports, die nicht als „kein Bug“ oder Duplikat markiert wurden. */
    validBugCount(discordId) {
      return db
        .prepare("SELECT COUNT(*) AS n FROM bugs WHERE discord_id = ? AND status NOT IN ('invalid', 'duplicate')")
        .get(discordId).n;
    },
  };
  return store;
}

module.exports = { openDatabase, PLAYTIME_STAT, now };
