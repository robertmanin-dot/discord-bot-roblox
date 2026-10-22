// Shared data access for creators, accounts, contacts, outreach and activity.
// Used by the radar (dashboard), the Discord bot and the jobs.
import { getDb } from './db.js';
import { bus } from './bus.js';
import { getActiveCampaignId } from './settings.js';
import { makeCode, normalizeEmail, normalizeHandle, safeJson, sha256 } from './util.js';
import { nowIso } from './time.js';

/** Pipeline order. Automatic updates only move forward along this list. */
export const STATUS_FLOW = [
  'neu',
  'qualifiziert',
  'kontaktiert',
  'nachgefasst',
  'geantwortet',
  'interessiert',
  'im_discord',
  'dabei',
  'live',
];

/** Side states (end of the road unless changed manually). */
export const STATUS_SIDE = ['ungeeignet', 'kein_interesse', 'keine_antwort', 'abgemeldet'];

export const ALL_STATUSES = [...STATUS_FLOW, ...STATUS_SIDE];

export const STATUS_LABELS = {
  neu: 'Neu',
  qualifiziert: 'Qualifiziert',
  kontaktiert: 'Kontaktiert',
  nachgefasst: 'Nachgefasst',
  geantwortet: 'Geantwortet',
  interessiert: 'Interessiert',
  im_discord: 'Im Discord',
  dabei: 'Dabei',
  live: 'Live beim Launch',
  ungeeignet: 'Ungeeignet',
  kein_interesse: 'Kein Interesse',
  keine_antwort: 'Keine Antwort',
  abgemeldet: 'Abgemeldet',
};

export const AGE_GROUPS = ['unbekannt', 'u13', '13-15', '16-17', '18+'];

/** Lowest age of an age group (null for unknown). */
export function minAgeOf(group) {
  return { u13: 0, '13-15': 13, '16-17': 16, '18+': 18 }[group] ?? null;
}

export const statusRank = (s) => STATUS_FLOW.indexOf(s);

function parseCreator(row) {
  if (!row) return null;
  return { ...row, tags: safeJson(row.tags, []), score_details: safeJson(row.score_details, {}) };
}

function parseAccount(row) {
  if (!row) return null;
  return { ...row, genres: safeJson(row.genres, []) };
}

export function getCreator(id) {
  return parseCreator(getDb().get('SELECT * FROM creators WHERE id = :id', { id }));
}

/** Creator with accounts, contacts, outreach (active campaign) and recent activity. */
export function getCreatorFull(id, { campaignId = getActiveCampaignId(), activityLimit = 50 } = {}) {
  const db = getDb();
  const creator = getCreator(id);
  if (!creator) return null;
  return {
    creator,
    accounts: db.all('SELECT * FROM accounts WHERE creator_id = :id ORDER BY followers DESC NULLS LAST, id', { id }).map(parseAccount),
    contacts: db.all('SELECT * FROM contacts WHERE creator_id = :id ORDER BY is_business DESC, id', { id }),
    outreach: db.get('SELECT * FROM outreach WHERE creator_id = :id AND campaign_id = :campaignId', { id, campaignId }),
    activity: db
      .all('SELECT * FROM activity WHERE creator_id = :id ORDER BY id DESC LIMIT :limit', { id, limit: activityLimit })
      .map((a) => ({ ...a, data: safeJson(a.data, {}) })),
    application: db.get('SELECT * FROM applications WHERE creator_id = :id ORDER BY id DESC LIMIT 1', { id }),
  };
}

export function findCreatorByDiscordId(discordUserId) {
  return parseCreator(getDb().get('SELECT * FROM creators WHERE discord_user_id = :discordUserId', { discordUserId }));
}

/** Finds a creator via a platform account (external id or handle). */
export function findCreatorByAccount(platform, { externalId, handle } = {}) {
  const db = getDb();
  let row = null;
  if (externalId) {
    row = db.get('SELECT creator_id FROM accounts WHERE platform = :platform AND external_id = :externalId', { platform, externalId: String(externalId) });
  }
  if (!row && handle) {
    row = db.get('SELECT creator_id FROM accounts WHERE platform = :platform AND handle = :handle', { platform, handle: normalizeHandle(handle) });
  }
  return row ? getCreator(row.creator_id) : null;
}

export function findCreatorByEmail(email) {
  const row = getDb().get("SELECT creator_id FROM contacts WHERE type = 'email' AND value = :value", { value: normalizeEmail(email) });
  return row ? getCreator(row.creator_id) : null;
}

export function logActivity(creatorId, type, data = {}, campaignId = getActiveCampaignId()) {
  getDb().run('INSERT INTO activity (creator_id, campaign_id, type, data) VALUES (:creatorId, :campaignId, :type, :data)', {
    creatorId,
    campaignId,
    type,
    data,
  });
}

/** Ensures an outreach row exists for the creator in the campaign and returns it. */
export function ensureOutreach(creatorId, campaignId = getActiveCampaignId()) {
  const db = getDb();
  db.run('INSERT OR IGNORE INTO outreach (creator_id, campaign_id) VALUES (:creatorId, :campaignId)', { creatorId, campaignId });
  return db.get('SELECT * FROM outreach WHERE creator_id = :creatorId AND campaign_id = :campaignId', { creatorId, campaignId });
}

export function getOutreach(creatorId, campaignId = getActiveCampaignId()) {
  return getDb().get('SELECT * FROM outreach WHERE creator_id = :creatorId AND campaign_id = :campaignId', { creatorId, campaignId });
}

const CREATOR_FIELDS = [
  'display_name', 'language', 'language_source', 'country', 'age_group', 'score', 'score_details',
  'contact_channel', 'contact_target', 'contact_platform', 'contact_locked', 'tags', 'notes',
  'discord_user_id', 'discord_tag', 'creator_code', 'share_link', 'is_member', 'founding',
  'paid_ok', 'parent_consent', 'source',
];

/** Creates a creator (plus outreach row for the active campaign). Returns the new id. */
export function createCreator(fields) {
  const db = getDb();
  const data = { display_name: fields.display_name || 'Unbekannt', tags: [], score_details: {} };
  for (const f of CREATOR_FIELDS) if (fields[f] !== undefined) data[f] = fields[f];
  const cols = Object.keys(data);
  return db.tx(() => {
    const { lastInsertRowid: id } = db.run(
      `INSERT INTO creators (${cols.join(', ')}) VALUES (${cols.map((c) => ':' + c).join(', ')})`,
      data,
    );
    ensureOutreach(id);
    logActivity(id, 'discovered', { source: fields.source || 'manual' });
    return id;
  });
}

export function updateCreator(id, fields) {
  const data = {};
  for (const f of CREATOR_FIELDS) if (fields[f] !== undefined) data[f] = fields[f];
  const cols = Object.keys(data);
  if (!cols.length) return getCreator(id);
  getDb().run(
    `UPDATE creators SET ${cols.map((c) => `${c} = :${c}`).join(', ')}, updated_at = :now WHERE id = :id`,
    { ...data, id, now: nowIso() },
  );
  return getCreator(id);
}

const ACCOUNT_FIELDS = [
  'external_id', 'handle', 'display_handle', 'url', 'followers', 'avg_views', 'avg_live_viewers',
  'max_live_viewers', 'times_seen_live', 'video_count', 'uploads_30d', 'last_active_at', 'roblox_share',
  'live_share', 'genres', 'latest_title', 'latest_url', 'bio', 'platform_language', 'country',
  'channel_created_at', 'fetched_at', 'source',
];

/**
 * Inserts or updates a platform account of a creator (matched by external id, then handle).
 * Returns the account id.
 */
export function upsertAccount(creatorId, account) {
  const db = getDb();
  const data = { ...account };
  if (data.handle) data.handle = normalizeHandle(data.handle);
  if (data.external_id !== undefined && data.external_id !== null) data.external_id = String(data.external_id);
  let existing = null;
  if (data.external_id) {
    existing = db.get('SELECT id FROM accounts WHERE platform = :platform AND external_id = :external_id', { platform: account.platform, external_id: data.external_id });
  }
  if (!existing && data.handle) {
    existing = db.get('SELECT id FROM accounts WHERE platform = :platform AND handle = :handle', { platform: account.platform, handle: data.handle });
  }
  const fields = {};
  for (const f of ACCOUNT_FIELDS) if (data[f] !== undefined) fields[f] = data[f];
  if (existing) {
    const cols = Object.keys(fields);
    if (cols.length) {
      db.run(`UPDATE accounts SET ${cols.map((c) => `${c} = :${c}`).join(', ')}, creator_id = :creatorId WHERE id = :id`, {
        ...fields,
        creatorId,
        id: existing.id,
      });
    }
    return existing.id;
  }
  const cols = ['creator_id', 'platform', ...Object.keys(fields)];
  const { lastInsertRowid } = db.run(
    `INSERT INTO accounts (${cols.join(', ')}) VALUES (${cols.map((c) => ':' + c).join(', ')})`,
    { ...fields, creator_id: creatorId, platform: account.platform },
  );
  return lastInsertRowid;
}

/** Adds a contact if new (type+value unique per creator). Upgrades business/dm flags if set. */
export function addContact(creatorId, { type, value, label, source, is_business = 0, dm_invited = 0 }) {
  const db = getDb();
  const normalized = type === 'email' ? normalizeEmail(value) : String(value ?? '').trim();
  if (!normalized) return null;
  db.run(
    `INSERT INTO contacts (creator_id, type, value, label, source, is_business, dm_invited)
     VALUES (:creatorId, :type, :value, :label, :source, :is_business, :dm_invited)
     ON CONFLICT(creator_id, type, value) DO UPDATE SET
       is_business = MAX(contacts.is_business, excluded.is_business),
       dm_invited = MAX(contacts.dm_invited, excluded.dm_invited)`,
    { creatorId, type, value: normalized, label: label ?? value, source, is_business: is_business ? 1 : 0, dm_invited: dm_invited ? 1 : 0 },
  );
  return db.get('SELECT * FROM contacts WHERE creator_id = :creatorId AND type = :type AND value = :value', {
    creatorId,
    type,
    value: normalized,
  });
}

/**
 * Changes the pipeline status. By default only moves forward along STATUS_FLOW
 * (side states like 'abgemeldet' are only set with force or from 'neu'..'nachgefasst').
 * Returns the updated outreach row, or null if nothing changed.
 */
export function setOutreachStatus(creatorId, to, { campaignId = getActiveCampaignId(), force = false, data = {}, extra = {} } = {}) {
  if (!ALL_STATUSES.includes(to)) throw new Error(`Unbekannter Status: ${to}`);
  const db = getDb();
  return db.tx(() => {
    const row = ensureOutreach(creatorId, campaignId);
    const from = row.status;
    if (from === to && !Object.keys(extra).length) return null;
    if (!force) {
      if (from === 'abgemeldet') return null;
      const fromRank = statusRank(from);
      const toRank = statusRank(to);
      if (toRank >= 0 && fromRank >= 0 && toRank < fromRank) return null;
    }
    const set = { status: to, status_changed_at: nowIso(), ...extra };
    const cols = Object.keys(set);
    db.run(`UPDATE outreach SET ${cols.map((c) => `${c} = :${c}`).join(', ')} WHERE id = :id`, { ...set, id: row.id });
    if (from !== to) {
      logActivity(creatorId, 'status', { from, to, ...data }, campaignId);
      bus.emit('outreach.status', { creatorId, outreachId: row.id, campaignId, from, to });
    }
    return db.get('SELECT * FROM outreach WHERE id = :id', { id: row.id });
  });
}

/** Updates outreach columns without changing the status. */
export function updateOutreach(outreachId, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return null;
  const db = getDb();
  db.run(`UPDATE outreach SET ${cols.map((c) => `${c} = :${c}`).join(', ')} WHERE id = :id`, { ...fields, id: outreachId });
  return db.get('SELECT * FROM outreach WHERE id = :id', { id: outreachId });
}

/** Links a Discord account to a creator (moves the link if another creator had it). */
export function linkDiscordUser(creatorId, discordUserId, discordTag) {
  const db = getDb();
  db.tx(() => {
    db.run('UPDATE creators SET discord_user_id = NULL WHERE discord_user_id = :discordUserId AND id != :creatorId', { discordUserId, creatorId });
    db.run('UPDATE creators SET discord_user_id = :discordUserId, discord_tag = COALESCE(:discordTag, discord_tag), updated_at = :now WHERE id = :creatorId', {
      discordUserId,
      discordTag,
      creatorId,
      now: nowIso(),
    });
  });
  return getCreator(creatorId);
}

/** Unique creator code derived from the name (e.g. LUKASPLAYS, LUKASPLAYS2). */
export function generateCreatorCode(displayName) {
  const db = getDb();
  const base = makeCode(displayName, 12);
  let code = base;
  for (let i = 2; db.get('SELECT 1 FROM creators WHERE creator_code = :code', { code }); i++) {
    code = `${base.slice(0, 12 - String(i).length)}${i}`;
  }
  return code;
}

// ---- Opt-out / suppression -------------------------------------------------

/** Hashes that identify a person: emails and platform accounts. */
export function identifierHashes({ emails = [], accounts = [] }) {
  const out = [];
  for (const e of emails) if (e) out.push({ hash: sha256('email:' + normalizeEmail(e)), kind: 'email' });
  for (const a of accounts) {
    if (a.external_id) out.push({ hash: sha256(`acc:${a.platform}:id:${a.external_id}`), kind: 'account' });
    if (a.handle) out.push({ hash: sha256(`acc:${a.platform}:h:${normalizeHandle(a.handle)}`), kind: 'account' });
  }
  return out;
}

/** True if any identifier belongs to someone who opted out. */
export function isSuppressed(identifiers) {
  const db = getDb();
  return identifierHashes(identifiers).some((h) => db.get('SELECT 1 FROM suppression WHERE hash = :hash', { hash: h.hash }));
}

/** Opt-out: stores identifier hashes and deletes everything else about the creator. */
export function suppressAndDeleteCreator(creatorId) {
  const db = getDb();
  const full = getCreatorFull(creatorId);
  if (!full) return false;
  const emails = full.contacts.filter((c) => c.type === 'email').map((c) => c.value);
  const accounts = [
    ...full.accounts,
    ...full.contacts.filter((c) => ['tiktok', 'instagram', 'x', 'twitch', 'kick', 'youtube'].includes(c.type)).map((c) => ({ platform: c.type, handle: c.value })),
  ];
  db.tx(() => {
    for (const h of identifierHashes({ emails, accounts })) {
      db.run('INSERT OR IGNORE INTO suppression (hash, kind) VALUES (:hash, :kind)', h);
    }
    db.run('DELETE FROM creators WHERE id = :creatorId', { creatorId });
  });
  return true;
}

export function deleteCreator(creatorId) {
  return getDb().run('DELETE FROM creators WHERE id = :creatorId', { creatorId }).changes > 0;
}
