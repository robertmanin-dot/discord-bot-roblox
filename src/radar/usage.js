// API usage counters per day (table api_usage).
import { getDb } from '../core/db.js';
import { dayKey } from '../core/time.js';

/** YouTube quotas reset at midnight Pacific time. */
export const youtubeDay = (now = new Date()) => dayKey(now, 'America/Los_Angeles');

export function getUsage(day, api) {
  return getDb().value('SELECT used FROM api_usage WHERE day = :day AND api = :api', { day, api }, 0);
}

export function addUsage(day, api, n = 1) {
  getDb().run(
    `INSERT INTO api_usage (day, api, used) VALUES (:day, :api, :n)
     ON CONFLICT(day, api) DO UPDATE SET used = used + excluded.used`,
    { day, api, n },
  );
}

export function setUsage(day, api, used) {
  getDb().run(
    `INSERT INTO api_usage (day, api, used) VALUES (:day, :api, :used)
     ON CONFLICT(day, api) DO UPDATE SET used = MAX(used, excluded.used)`,
    { day, api, used },
  );
}
