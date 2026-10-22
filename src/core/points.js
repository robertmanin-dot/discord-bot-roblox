// Points for creators and testers (leaderboards, tiers). Rewards are status and in-game items —
// never Robux or money prizes (Roblox rules forbid prize competitions with real value).
import { getDb } from './db.js';
import { getSettings } from './settings.js';

/**
 * Adds points. With `ref` the same action is only counted once per user
 * (e.g. ref 'playtest:3:attend'). Returns true if points were added.
 */
export function addPoints({ userId, kind, points, reason = '', ref = null }) {
  if (!userId || !kind || !Number.isFinite(points) || points === 0) return false;
  const r = getDb().run(
    `INSERT OR IGNORE INTO points_log (discord_user_id, kind, points, reason, ref)
     VALUES (:userId, :kind, :points, :reason, :ref)`,
    { userId, kind, points: Math.round(points), reason, ref },
  );
  return r.changes > 0;
}

export function getPoints(userId, kind) {
  return getDb().value(
    'SELECT COALESCE(SUM(points), 0) FROM points_log WHERE discord_user_id = :userId AND kind = :kind',
    { userId, kind },
    0,
  );
}

/** [{ discord_user_id, points }] highest first. */
export function getLeaderboard(kind, limit = 15) {
  return getDb().all(
    `SELECT discord_user_id, SUM(points) AS points FROM points_log
     WHERE kind = :kind GROUP BY discord_user_id HAVING SUM(points) > 0
     ORDER BY points DESC, MIN(created_at) ASC LIMIT :limit`,
    { kind, limit },
  );
}

/** Rank (1-based) of a user in a leaderboard, or null. */
export function getRank(userId, kind) {
  const mine = getPoints(userId, kind);
  if (mine <= 0) return null;
  const higher = getDb().value(
    `SELECT COUNT(*) FROM (SELECT discord_user_id, SUM(points) AS p FROM points_log WHERE kind = :kind GROUP BY discord_user_id) WHERE p > :mine`,
    { kind, mine },
    0,
  );
  return higher + 1;
}

/** Tier for a points total, e.g. { name: 'Gold', min: 300, next: { name: 'Diamant', min: 750 } }. */
export function tierFor(points) {
  const tiers = [...(getSettings().tiers || [])].sort((a, b) => a.min - b.min);
  let current = tiers[0] || { name: '-', min: 0 };
  let next = null;
  for (const t of tiers) {
    if (points >= t.min) current = t;
    else {
      next = t;
      break;
    }
  }
  return { ...current, next };
}
