// Data retention (docs/ARCHITEKTUR.md 5.7):
// - platform API data (YouTube/Twitch) older than 30 days: refresh for contacted creators, otherwise clear
// - never contacted creators older than X days: delete
// - "keine_antwort"/"kein_interesse" older than X days: delete
import { env } from '../core/config.js';
import { getDb } from '../core/db.js';
import { getSettings, getActiveCampaignId } from '../core/settings.js';
import { createLogger } from '../core/log.js';
import { addDays } from '../core/time.js';
import { refreshYoutubeAccounts } from './youtube.js';
import { refreshTwitchAccounts, twitchConfigured } from './twitch.js';
import { recomputeCreator } from './enrich.js';

const log = createLogger('radar');
const UNCONTACTED = ['neu', 'qualifiziert', 'ungeeignet'];

const CLEAR_SQL = `UPDATE accounts SET followers = NULL, avg_views = NULL, avg_live_viewers = NULL, max_live_viewers = NULL,
  video_count = NULL, uploads_30d = NULL, roblox_share = NULL, live_share = NULL, genres = '[]', latest_title = NULL,
  latest_url = NULL, bio = NULL, platform_language = NULL, fetched_at = NULL WHERE id = :id`;

/** Runs all retention rules. Returns { deleted, cleared, refreshed }. */
export async function runRetention({ now = new Date(), fetchImpl } = {}) {
  const db = getDb();
  const r = getSettings().radar.retention || {};
  const campaignId = getActiveCampaignId();
  const result = { deleted: 0, cleared: 0, refreshed: 0 };
  const protectedCreator = 'c.is_member = 0 AND c.discord_user_id IS NULL';

  // 1) Never contacted and old -> delete.
  const uncontactedCutoff = addDays(now, -(Number(r.uncontactedDays) || 30)).toISOString();
  const stale = db.all(
    `SELECT c.id FROM creators c LEFT JOIN outreach o ON o.creator_id = c.id AND o.campaign_id = :campaignId
     WHERE ${protectedCreator} AND c.created_at < :cutoff AND o.contacted_at IS NULL
       AND COALESCE(o.status, 'neu') IN (${UNCONTACTED.map((s) => `'${s}'`).join(', ')})
       AND NOT EXISTS (SELECT 1 FROM outreach o2 WHERE o2.creator_id = c.id AND o2.contacted_at IS NOT NULL)`,
    { campaignId, cutoff: uncontactedCutoff },
  );
  // 2) No reply / no interest for a long time -> delete.
  const noReplyCutoff = addDays(now, -(Number(r.noReplyDeleteDays) || 180)).toISOString();
  const dead = db.all(
    `SELECT c.id FROM creators c JOIN outreach o ON o.creator_id = c.id AND o.campaign_id = :campaignId
     WHERE ${protectedCreator} AND o.status IN ('keine_antwort', 'kein_interesse') AND o.status_changed_at < :cutoff`,
    { campaignId, cutoff: noReplyCutoff },
  );
  const toDelete = [...new Set([...stale, ...dead].map((x) => x.id))];
  db.tx(() => {
    for (const id of toDelete) result.deleted += db.run('DELETE FROM creators WHERE id = :id', { id }).changes;
  });

  // 3) Old API data -> refresh (contacted/members) or clear.
  const dataCutoff = addDays(now, -(Number(r.platformDataDays) || 30)).toISOString();
  const oldAccounts = db.all(
    `SELECT a.id, a.creator_id, a.platform, a.external_id, a.handle,
       (c.is_member = 1 OR c.discord_user_id IS NOT NULL OR o.contacted_at IS NOT NULL) AS active
     FROM accounts a JOIN creators c ON c.id = a.creator_id
     LEFT JOIN outreach o ON o.creator_id = c.id AND o.campaign_id = :campaignId
     WHERE a.fetched_at IS NOT NULL AND a.fetched_at < :cutoff AND a.source IN ('youtube_api', 'twitch_api')`,
    { campaignId, cutoff: dataCutoff },
  );
  const refreshable = { youtube: [], twitch: [] };
  const clear = [];
  for (const a of oldAccounts) {
    const canRefresh = a.active && ((a.platform === 'youtube' && env('YOUTUBE_API_KEY')) || (a.platform === 'twitch' && twitchConfigured()));
    if (canRefresh) refreshable[a.platform].push(a);
    else clear.push(a);
  }
  for (const [platform, rows] of Object.entries(refreshable)) {
    if (!rows.length) continue;
    try {
      const res = platform === 'youtube'
        ? await refreshYoutubeAccounts(rows, fetchImpl ? { fetchImpl } : {})
        : await refreshTwitchAccounts(rows, fetchImpl ? { fetchImpl } : {});
      result.refreshed += res.refreshed;
      clear.push(...res.missing);
    } catch (err) {
      log.warn(`Aktualisierung (${platform}) nicht möglich, Daten werden geleert:`, err.message);
      clear.push(...rows);
    }
  }
  const touched = new Set();
  db.tx(() => {
    for (const a of clear) {
      // Only clear accounts that are still old (a refresh may have updated some of them).
      const still = db.get('SELECT fetched_at FROM accounts WHERE id = :id', { id: a.id });
      if (!still || !still.fetched_at || still.fetched_at >= dataCutoff) continue;
      result.cleared += db.run(CLEAR_SQL, { id: a.id }).changes;
      touched.add(a.creator_id);
    }
  });
  for (const id of touched) recomputeCreator(id);
  if (result.deleted || result.cleared || result.refreshed) {
    log.info(`Aufbewahrung: ${result.deleted} gelöscht, ${result.cleared} Plattform-Daten geleert, ${result.refreshed} aktualisiert.`);
  }
  return result;
}
