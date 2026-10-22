// Creator list queries for the dashboard (CreatorListItem, docs/ARCHITEKTUR.md section 6).
import { getDb } from '../core/db.js';
import { getActiveCampaignId } from '../core/settings.js';
import { ALL_STATUSES } from '../core/creators.js';
import { safeJson } from '../core/util.js';

const SORTS = {
  score: 'c.score',
  followers: 'followers',
  created: 'c.created_at',
  updated: 'c.updated_at',
  name: 'c.display_name COLLATE NOCASE',
  last_active: 'last_active_at',
  contacted: 'o.contacted_at',
};

function likeEscape(s) {
  return String(s).replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Builds WHERE clause + params from list filters (shared with the CSV export). */
export function buildCreatorFilter(filters = {}) {
  const where = [];
  const params = { campaignId: filters.campaignId || getActiveCampaignId() };
  const statuses = (filters.status || []).filter((s) => ALL_STATUSES.includes(s));
  if (statuses.length) {
    where.push(`COALESCE(o.status, 'neu') IN (${statuses.map((_, i) => `:st${i}`).join(', ')})`);
    statuses.forEach((s, i) => { params[`st${i}`] = s; });
  }
  if (filters.platform) {
    where.push('EXISTS (SELECT 1 FROM accounts pa WHERE pa.creator_id = c.id AND pa.platform = :platform)');
    params.platform = filters.platform;
  }
  if (filters.language) {
    if (['unknown', 'unbekannt', '?', 'none'].includes(filters.language)) where.push('c.language IS NULL');
    else {
      where.push('c.language = :language');
      params.language = filters.language;
    }
  }
  if (filters.channel) {
    if (filters.channel === 'none') where.push("(c.contact_channel IS NULL OR c.contact_channel = 'none')");
    else {
      where.push('c.contact_channel = :channel');
      params.channel = filters.channel;
    }
  }
  if (filters.minScore !== undefined && filters.minScore !== null && filters.minScore !== '') {
    where.push('c.score >= :minScore');
    params.minScore = Number(filters.minScore) || 0;
  }
  if (filters.member === 0 || filters.member === 1 || filters.member === '0' || filters.member === '1') {
    where.push('c.is_member = :member');
    params.member = Number(filters.member);
  }
  if (filters.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(c.tags) jt WHERE jt.value = :tag)");
    params.tag = filters.tag;
  }
  if (filters.q && String(filters.q).trim()) {
    params.q = `%${likeEscape(String(filters.q).trim().toLowerCase())}%`;
    where.push(`(LOWER(c.display_name) LIKE :q ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM accounts qa WHERE qa.creator_id = c.id AND (qa.handle LIKE :q ESCAPE '\\' OR LOWER(COALESCE(qa.display_handle, '')) LIKE :q ESCAPE '\\'))
      OR EXISTS (SELECT 1 FROM contacts qc WHERE qc.creator_id = c.id AND LOWER(qc.value) LIKE :q ESCAPE '\\')
      OR LOWER(COALESCE(c.creator_code, '')) LIKE :q ESCAPE '\\')`);
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const BASE_SELECT = `
  SELECT c.*, COALESCE(o.status, 'neu') AS status, o.id AS outreach_id, o.contacted_at, o.followup_due_at, o.replied_at, o.reply_sentiment,
    (SELECT MAX(a.followers) FROM accounts a WHERE a.creator_id = c.id) AS followers,
    (SELECT MAX(a.last_active_at) FROM accounts a WHERE a.creator_id = c.id) AS last_active_at
  FROM creators c
  LEFT JOIN outreach o ON o.creator_id = c.id AND o.campaign_id = :campaignId`;

/** Converts rows (with accounts) into CreatorListItems. */
export function toListItems(rows) {
  if (!rows.length) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const accounts = db.all(
    `SELECT creator_id, platform, handle, display_handle, url, followers, latest_title, latest_url, last_active_at, avg_live_viewers, source
     FROM accounts WHERE creator_id IN (${ids.map((_, i) => `:id${i}`).join(', ')}) ORDER BY followers DESC NULLS LAST, id`,
    Object.fromEntries(ids.map((id, i) => [`id${i}`, id])),
  );
  const byCreator = new Map();
  for (const a of accounts) {
    if (!byCreator.has(a.creator_id)) byCreator.set(a.creator_id, []);
    byCreator.get(a.creator_id).push(a);
  }
  return rows.map((r) => {
    const accs = byCreator.get(r.id) || [];
    const latest = accs.filter((a) => a.latest_title).sort((a, b) => String(b.last_active_at || '').localeCompare(String(a.last_active_at || '')))[0];
    return {
      id: r.id,
      display_name: r.display_name,
      language: r.language,
      age_group: r.age_group,
      score: r.score,
      contact_channel: r.contact_channel,
      contact_target: r.contact_target,
      contact_platform: r.contact_platform,
      tags: safeJson(r.tags, []),
      status: r.status || 'neu',
      followers: r.followers ?? null,
      platforms: accs.map((a) => ({
        platform: a.platform,
        handle: a.handle,
        url: a.url,
        followers: a.followers,
        avg_live_viewers: a.avg_live_viewers,
        crosslink: a.source === 'crosslink',
      })),
      latest_title: latest?.latest_title || null,
      latest_url: latest?.latest_url || null,
      last_active_at: r.last_active_at || null,
      contacted_at: r.contacted_at || null,
      followup_due_at: r.followup_due_at || null,
      replied_at: r.replied_at || null,
      reply_sentiment: r.reply_sentiment || null,
      is_member: r.is_member,
      discord_user_id: r.discord_user_id,
      creator_code: r.creator_code,
      share_link: r.share_link,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });
}

/** { total, items } for GET /api/creators. */
export function listCreators(filters = {}) {
  const db = getDb();
  const { where, params } = buildCreatorFilter(filters);
  const sortCol = SORTS[filters.sort] || SORTS.score;
  const dir = String(filters.dir || (filters.sort === 'name' ? 'asc' : 'desc')).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const nulls = ['followers', 'last_active_at', 'o.contacted_at'].includes(sortCol) ? ' NULLS LAST' : '';
  const limit = Math.min(5000, Math.max(1, Number(filters.limit) || 50));
  const offset = Math.max(0, Number(filters.offset) || 0);
  const total = db.value(
    `SELECT COUNT(*) FROM creators c LEFT JOIN outreach o ON o.creator_id = c.id AND o.campaign_id = :campaignId ${where}`,
    params,
    0,
  );
  const rows = db.all(`${BASE_SELECT} ${where} ORDER BY ${sortCol} ${dir}${nulls}, c.id DESC LIMIT :limit OFFSET :offset`, { ...params, limit, offset });
  return { total, items: toListItems(rows) };
}

/** One CreatorListItem by id (or null). */
export function getListItem(id, campaignId = getActiveCampaignId()) {
  const rows = getDb().all(`${BASE_SELECT} WHERE c.id = :id`, { id, campaignId });
  return toListItems(rows)[0] || null;
}

/** All tags in use (for filter dropdowns). */
export function allTags() {
  return getDb().all('SELECT DISTINCT jt.value AS tag FROM creators c, json_each(c.tags) jt ORDER BY tag').map((r) => r.tag);
}
