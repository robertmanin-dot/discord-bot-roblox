// Statistics for the dashboard (GET /api/stats).
import { getDb } from '../core/db.js';
import { getActiveCampaignId } from '../core/settings.js';
import { ALL_STATUSES } from '../core/creators.js';
import { addDays, dayKey } from '../core/time.js';

const INTERESTED = "o.status IN ('interessiert', 'im_discord', 'dabei', 'live') OR o.reply_sentiment = 'interessiert'";

export function getStats(now = new Date()) {
  const db = getDb();
  const campaignId = getActiveCampaignId();
  const p = { campaignId };

  const funnel = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
  for (const r of db.all('SELECT status, COUNT(*) AS n FROM outreach WHERE campaign_id = :campaignId GROUP BY status', p)) funnel[r.status] = r.n;

  const t = db.get(
    `SELECT COUNT(*) AS creators,
       SUM(o.contacted_at IS NOT NULL) AS contacted,
       SUM(o.replied_at IS NOT NULL) AS replied,
       SUM(CASE WHEN ${INTERESTED} THEN 1 ELSE 0 END) AS interested,
       SUM(o.joined_discord_at IS NOT NULL OR o.status IN ('im_discord', 'dabei', 'live')) AS joined,
       SUM(c.is_member = 1) AS members,
       SUM(o.went_live_at IS NOT NULL OR o.status = 'live') AS live
     FROM creators c LEFT JOIN outreach o ON o.creator_id = c.id AND o.campaign_id = :campaignId`,
    p,
  ) || {};
  const totals = Object.fromEntries(['creators', 'contacted', 'replied', 'interested', 'joined', 'members', 'live'].map((k) => [k, Number(t[k] || 0)]));

  const byLanguage = db.all(
    `SELECT COALESCE(c.language, '?') AS language,
       SUM(o.contacted_at IS NOT NULL) AS contacted,
       SUM(o.replied_at IS NOT NULL) AS replied,
       SUM(CASE WHEN ${INTERESTED} THEN 1 ELSE 0 END) AS interested,
       SUM(o.joined_discord_at IS NOT NULL OR o.status IN ('im_discord', 'dabei', 'live')) AS joined,
       COUNT(*) AS total
     FROM outreach o JOIN creators c ON c.id = o.creator_id
     WHERE o.campaign_id = :campaignId GROUP BY COALESCE(c.language, '?') ORDER BY contacted DESC, total DESC`,
    p,
  );

  const byChannel = db.all(
    `SELECT o.channel AS channel, COUNT(*) AS sent, SUM(o.replied_at IS NOT NULL) AS replied
     FROM outreach o WHERE o.campaign_id = :campaignId AND o.contacted_at IS NOT NULL GROUP BY o.channel ORDER BY sent DESC`,
    p,
  );

  const byTemplate = db.all(
    `SELECT o.template_key AS template_key, o.variant AS variant, COUNT(*) AS sent, SUM(o.replied_at IS NOT NULL) AS replied,
       SUM(CASE WHEN ${INTERESTED} THEN 1 ELSE 0 END) AS interested
     FROM outreach o WHERE o.campaign_id = :campaignId AND o.contacted_at IS NOT NULL AND o.template_key IS NOT NULL
     GROUP BY o.template_key, o.variant ORDER BY sent DESC`,
    p,
  ).map((r) => ({ ...r, rate: r.sent ? Math.round((r.replied / r.sent) * 1000) / 1000 : 0 }));

  // Last 14 days (Berlin calendar days).
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(dayKey(addDays(now, -i)));
  const daily = Object.fromEntries(days.map((d) => [d, { day: d, sent: 0, followups: 0, replies: 0 }]));
  const since = addDays(now, -15).toISOString();
  for (const a of db.all("SELECT type, created_at FROM activity WHERE type IN ('sent', 'followup_sent', 'reply') AND created_at >= :since", { since })) {
    const d = daily[dayKey(new Date(a.created_at))];
    if (!d) continue;
    if (a.type === 'sent') d.sent++;
    else if (a.type === 'followup_sent') d.followups++;
    else d.replies++;
  }

  const discovery = {
    byPlatform: db.all("SELECT platform, COUNT(DISTINCT creator_id) AS n FROM accounts WHERE COALESCE(source, '') != 'crosslink' GROUP BY platform ORDER BY n DESC"),
    byLanguage: db.all("SELECT COALESCE(language, '?') AS language, COUNT(*) AS n FROM creators GROUP BY COALESCE(language, '?') ORDER BY n DESC"),
    byChannel: db.all("SELECT COALESCE(contact_channel, 'none') AS channel, COUNT(*) AS n FROM creators GROUP BY COALESCE(contact_channel, 'none') ORDER BY n DESC"),
  };

  return { funnel, totals, byLanguage, byChannel, byTemplate, daily: Object.values(daily), discovery };
}
