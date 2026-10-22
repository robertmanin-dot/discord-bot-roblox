// Database access for playtests, testers, feedback, bugs and events (Bot part B).
import { getDb } from '../../core/db.js';
import { nowIso } from '../../core/time.js';
import { addPoints } from '../../core/points.js';
import { findCreatorByDiscordId } from '../../core/creators.js';
import { getSettings } from '../../core/settings.js';
import { decideSignup, pickPromotions, BUG_REAL } from './b-logic.js';

function setColumns(table, id, fields, idCol = 'id') {
  const cols = Object.keys(fields).filter((c) => fields[c] !== undefined);
  if (!cols.length) return;
  getDb().run(`UPDATE ${table} SET ${cols.map((c) => `${c} = :${c}`).join(', ')} WHERE ${idCol} = :__id`, { ...fields, __id: id });
}

// ---- Testers --------------------------------------------------------------------

export function getTester(userId) {
  return getDb().get('SELECT * FROM testers WHERE discord_user_id = :userId', { userId });
}

export function upsertTester({ userId, tag = null, ageGroup = null, status = 'aktiv' }) {
  const creator = findCreatorByDiscordId(userId);
  getDb().run(
    `INSERT INTO testers (discord_user_id, discord_tag, age_group, status, creator_id)
     VALUES (:userId, :tag, :ageGroup, :status, :creatorId)
     ON CONFLICT(discord_user_id) DO UPDATE SET
       discord_tag = COALESCE(excluded.discord_tag, testers.discord_tag),
       age_group = COALESCE(excluded.age_group, testers.age_group),
       status = excluded.status,
       creator_id = COALESCE(excluded.creator_id, testers.creator_id)`,
    { userId, tag, ageGroup, status, creatorId: creator?.id ?? null },
  );
  return getTester(userId);
}

export function setTesterStatus(userId, status) {
  getDb().run('UPDATE testers SET status = :status WHERE discord_user_id = :userId', { userId, status });
  return getTester(userId);
}

/**
 * Best known age group of a Discord user: tester entry → latest creator application → creator record.
 */
export function getUserAgeGroup(userId) {
  const db = getDb();
  const tester = db.get("SELECT age_group FROM testers WHERE discord_user_id = :userId AND status != 'entfernt'", { userId });
  if (tester?.age_group && tester.age_group !== 'unbekannt') return tester.age_group;
  const app = db.get(
    "SELECT age_group FROM applications WHERE discord_user_id = :userId AND status NOT IN ('abgelehnt','zurueckgezogen') ORDER BY id DESC LIMIT 1",
    { userId },
  );
  if (app?.age_group && app.age_group !== 'unbekannt') return app.age_group;
  const creator = db.get('SELECT age_group FROM creators WHERE discord_user_id = :userId', { userId });
  return creator?.age_group || 'unbekannt';
}

/** Name for lists (Discord tag from testers/applications/creators). */
export function displayNameFor(userId) {
  const db = getDb();
  return (
    db.value('SELECT discord_tag FROM testers WHERE discord_user_id = :userId', { userId }) ||
    db.value('SELECT display_name FROM creators WHERE discord_user_id = :userId', { userId }) ||
    db.value('SELECT discord_tag FROM applications WHERE discord_user_id = :userId ORDER BY id DESC LIMIT 1', { userId }) ||
    null
  );
}

// ---- Playtests ------------------------------------------------------------------

export function insertPlaytest(data, createdBy = null, now = new Date()) {
  const start = new Date(data.starts_at).getTime();
  const t = now.getTime();
  const row = {
    ...data,
    created_by: createdBy,
    // Windows that are already open at creation time need no reminder (nobody is signed up yet).
    reminded_24h: start - t <= 24 * 3600_000 ? 1 : 0,
    reminded_1h: start - t <= 3600_000 ? 1 : 0,
  };
  const cols = ['title', 'description', 'starts_at', 'duration_min', 'slots', 'join_link', 'min_age', 'created_by', 'reminded_24h', 'reminded_1h'];
  const { lastInsertRowid } = getDb().run(
    `INSERT INTO playtests (${cols.join(', ')}) VALUES (${cols.map((c) => ':' + c).join(', ')})`,
    row,
  );
  return getPlaytest(lastInsertRowid);
}

export const getPlaytest = (id) => getDb().get('SELECT * FROM playtests WHERE id = :id', { id: Number(id) });

export function updatePlaytest(id, fields) {
  setColumns('playtests', Number(id), fields);
  return getPlaytest(id);
}

export function listPlaytests({ statuses = null, limit = 50, order = 'DESC' } = {}) {
  const where = statuses?.length ? `WHERE status IN (${statuses.map((_, i) => `:s${i}`).join(', ')})` : '';
  const params = { limit };
  statuses?.forEach((s, i) => { params[`s${i}`] = s; });
  return getDb().all(`SELECT * FROM playtests ${where} ORDER BY starts_at ${order === 'ASC' ? 'ASC' : 'DESC'} LIMIT :limit`, params);
}

export function playtestCounts(id) {
  const db = getDb();
  return {
    active: db.value("SELECT COUNT(*) FROM playtest_signups WHERE playtest_id = :id AND status IN ('angemeldet','teilgenommen')", { id }, 0),
    waitlist: db.value("SELECT COUNT(*) FROM playtest_signups WHERE playtest_id = :id AND status = 'warteliste'", { id }, 0),
    feedback: db.value('SELECT COUNT(*) FROM feedback WHERE playtest_id = :id', { id }, 0),
  };
}

export const getSignup = (playtestId, userId) =>
  getDb().get('SELECT * FROM playtest_signups WHERE playtest_id = :playtestId AND discord_user_id = :userId', { playtestId, userId });

export function listSignups(playtestId, statuses = null) {
  const where = statuses?.length ? `AND status IN (${statuses.map((_, i) => `:s${i}`).join(', ')})` : '';
  const params = { playtestId };
  statuses?.forEach((s, i) => { params[`s${i}`] = s; });
  return getDb().all(`SELECT * FROM playtest_signups WHERE playtest_id = :playtestId ${where} ORDER BY created_at, rowid`, params);
}

/**
 * Signs a user up (list or waitlist). Returns { status, previous, changed }.
 * Already signed-up users keep their place.
 */
export function signUp(playtestId, userId) {
  const db = getDb();
  return db.tx(() => {
    const p = getPlaytest(playtestId);
    const prev = getSignup(playtestId, userId);
    if (prev && ['angemeldet', 'warteliste', 'teilgenommen'].includes(prev.status)) {
      return { status: prev.status, previous: prev.status, changed: false };
    }
    const { active } = playtestCounts(playtestId);
    const status = decideSignup({ slots: p.slots, activeCount: active });
    db.run(
      `INSERT INTO playtest_signups (playtest_id, discord_user_id, status, created_at) VALUES (:playtestId, :userId, :status, :now)
       ON CONFLICT(playtest_id, discord_user_id) DO UPDATE SET status = excluded.status, created_at = excluded.created_at`,
      { playtestId, userId, status, now: nowIso() },
    );
    return { status, previous: prev?.status ?? null, changed: true };
  });
}

/** Moves waitlisted users into free slots. Returns promoted user ids. */
export function promoteWaitlist(playtestId) {
  const db = getDb();
  return db.tx(() => {
    const p = getPlaytest(playtestId);
    const { active } = playtestCounts(playtestId);
    const promote = pickPromotions({ slots: p.slots, activeCount: active, waitlist: listSignups(playtestId, ['warteliste']) });
    for (const s of promote) {
      db.run("UPDATE playtest_signups SET status = 'angemeldet' WHERE playtest_id = :playtestId AND discord_user_id = :userId", {
        playtestId,
        userId: s.discord_user_id,
      });
    }
    return promote.map((s) => s.discord_user_id);
  });
}

/** Cancels a sign-up. Returns { previous, promoted: [userIds] }. */
export function leave(playtestId, userId) {
  const db = getDb();
  return db.tx(() => {
    const prev = getSignup(playtestId, userId);
    if (!prev || prev.status === 'abgemeldet') return { previous: prev?.status ?? null, promoted: [] };
    db.run("UPDATE playtest_signups SET status = 'abgemeldet' WHERE playtest_id = :playtestId AND discord_user_id = :userId", { playtestId, userId });
    const promoted = prev.status === 'angemeldet' ? promoteWaitlist(playtestId) : [];
    return { previous: prev.status, promoted };
  });
}

/** Saves (or updates) feedback, marks attendance and awards points once. */
export function saveFeedback(playtestId, userId, value) {
  const db = getDb();
  const points = getSettings().points;
  return db.tx(() => {
    const existing = db.get('SELECT id FROM feedback WHERE playtest_id = :playtestId AND discord_user_id = :userId', { playtestId, userId });
    if (existing) {
      db.run(
        'UPDATE feedback SET fun_rating = :fun_rating, liked = :liked, disliked = :disliked, bugs = :bugs, other = :other WHERE id = :id',
        { ...value, id: existing.id },
      );
    } else {
      db.run(
        `INSERT INTO feedback (playtest_id, discord_user_id, fun_rating, liked, disliked, bugs, other)
         VALUES (:playtestId, :userId, :fun_rating, :liked, :disliked, :bugs, :other)`,
        { ...value, playtestId, userId },
      );
    }
    db.run("UPDATE playtest_signups SET status = 'teilgenommen' WHERE playtest_id = :playtestId AND discord_user_id = :userId", { playtestId, userId });
    const attend = addPoints({ userId, kind: 'tester', points: points.playtestAttend, reason: `Playtest #${playtestId}`, ref: `playtest:${playtestId}:attend` });
    const fb = addPoints({ userId, kind: 'tester', points: points.playtestFeedback, reason: `Feedback Playtest #${playtestId}`, ref: `playtest:${playtestId}:feedback` });
    return {
      created: !existing,
      pointsAwarded: (attend ? points.playtestAttend : 0) + (fb ? points.playtestFeedback : 0),
    };
  });
}

export function listFeedback(playtestId) {
  return getDb().all('SELECT * FROM feedback WHERE playtest_id = :playtestId ORDER BY created_at', { playtestId });
}

// ---- Bugs -----------------------------------------------------------------------

export function insertBug({ userId, title, description, steps, device }) {
  const { lastInsertRowid } = getDb().run(
    'INSERT INTO bugs (discord_user_id, title, description, steps, device) VALUES (:userId, :title, :description, :steps, :device)',
    { userId, title, description, steps, device },
  );
  return getBug(lastInsertRowid);
}

export const getBug = (id) => getDb().get('SELECT * FROM bugs WHERE id = :id', { id: Number(id) });

export function updateBug(id, fields) {
  setColumns('bugs', Number(id), fields);
  return getBug(id);
}

export function listBugs(status = null, limit = 500) {
  return status
    ? getDb().all('SELECT * FROM bugs WHERE status = :status ORDER BY id DESC LIMIT :limit', { status, limit })
    : getDb().all('SELECT * FROM bugs ORDER BY id DESC LIMIT :limit', { limit });
}

/**
 * Sets a bug status (from Discord or the dashboard). Real bugs give the reporter points once.
 * Returns { bug, changed, previous, pointsAwarded }.
 */
export function applyBugStatus(id, status, reviewerId = null) {
  const bug = getBug(id);
  if (!bug) return null;
  if (bug.status === status) return { bug, changed: false, previous: status, pointsAwarded: 0 };
  const updated = updateBug(id, { status, reviewed_by: reviewerId ?? bug.reviewed_by });
  let pointsAwarded = 0;
  if (BUG_REAL.has(status)) {
    const pts = getSettings().points.bugConfirmed;
    if (addPoints({ userId: bug.discord_user_id, kind: 'tester', points: pts, reason: `Bug #${bug.id}`, ref: `bug:${bug.id}:confirmed` })) pointsAwarded = pts;
  }
  return { bug: updated, changed: true, previous: bug.status, pointsAwarded };
}

// ---- Events ---------------------------------------------------------------------

export function insertEvent(data, createdBy = null, now = new Date()) {
  const start = new Date(data.starts_at).getTime();
  const t = now.getTime();
  const row = {
    ...data,
    created_by: createdBy,
    reminded_24h: start - t <= 24 * 3600_000 ? 1 : 0,
    reminded_1h: start - t <= 3600_000 ? 1 : 0,
    reminded_10m: start - t <= 10 * 60_000 ? 1 : 0,
  };
  const cols = ['kind', 'title', 'description', 'starts_at', 'duration_min', 'repeat_weekly', 'game_link', 'parent_event_id', 'created_by', 'reminded_24h', 'reminded_1h', 'reminded_10m'];
  const { lastInsertRowid } = getDb().run(
    `INSERT INTO events (${cols.join(', ')}) VALUES (${cols.map((c) => ':' + c).join(', ')})`,
    row,
  );
  return getEvent(lastInsertRowid);
}

export const getEvent = (id) => getDb().get('SELECT * FROM events WHERE id = :id', { id: Number(id) });

export function updateEvent(id, fields) {
  setColumns('events', Number(id), fields);
  return getEvent(id);
}

export function listEvents({ statuses = null, limit = 50, order = 'DESC', unsummarizedOnly = false } = {}) {
  const conds = [];
  const params = { limit };
  if (statuses?.length) {
    conds.push(`status IN (${statuses.map((_, i) => `:s${i}`).join(', ')})`);
    statuses.forEach((s, i) => { params[`s${i}`] = s; });
  }
  if (unsummarizedOnly) conds.push('summary_posted = 0');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return getDb().all(`SELECT * FROM events ${where} ORDER BY starts_at ${order === 'ASC' ? 'ASC' : 'DESC'} LIMIT :limit`, params);
}

export function insertCcuSample(eventId, playing, at = nowIso()) {
  getDb().run('INSERT INTO ccu_samples (event_id, playing, at) VALUES (:eventId, :playing, :at)', { eventId, playing, at });
}

export function listCcuSamples(eventId) {
  return getDb().all('SELECT playing, at FROM ccu_samples WHERE event_id = :eventId ORDER BY at, id', { eventId });
}

/** Live sessions overlapping [from, to] with the creator name if known. */
export function liveSessionsInWindow(from, to) {
  return getDb().all(
    `SELECT l.*, c.display_name FROM live_sessions l LEFT JOIN creators c ON c.id = l.creator_id
     WHERE l.started_at <= :to AND (l.ended_at IS NULL OR l.ended_at >= :from)
     ORDER BY l.started_at`,
    { from, to },
  );
}

/** Creator applications accepted in [from, to]. */
export function acceptedApplicationsBetween(from, to) {
  return getDb().value(
    "SELECT COUNT(*) FROM applications WHERE status = 'angenommen' AND reviewed_at >= :from AND reviewed_at <= :to",
    { from, to },
    0,
  );
}

export const memberCount = () => getDb().value('SELECT COUNT(*) FROM creators WHERE is_member = 1', null, 0);
