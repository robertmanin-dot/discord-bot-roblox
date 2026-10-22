// Database side of creator applications (no Discord calls here, so it is easy to test).
import { getDb } from '../../core/db.js';
import { bus } from '../../core/bus.js';
import { getSettings } from '../../core/settings.js';
import {
  addContact, createCreator, findCreatorByAccount, findCreatorByDiscordId, generateCreatorCode, getCreator,
  linkDiscordUser, logActivity, setOutreachStatus, updateCreator, upsertAccount,
} from '../../core/creators.js';
import { extractLinks, parseProfileUrl, PLATFORMS } from '../../core/urls.js';
import { parseCount, truncate } from '../../core/util.js';
import { nowIso } from '../../core/time.js';
import { foundingAvailable, initialApplicationStatus } from './rules.js';
import { userError } from './common.js';

export function getApplication(id) {
  return getDb().get('SELECT * FROM applications WHERE id = :id', { id: Number(id) });
}

export function latestApplication(discordUserId) {
  return getDb().get('SELECT * FROM applications WHERE discord_user_id = :discordUserId ORDER BY id DESC LIMIT 1', { discordUserId });
}

export function countFounding() {
  return getDb().value('SELECT COUNT(*) FROM creators WHERE founding = 1', null, 0);
}

function nameFromProfile(profile, fallback) {
  if (profile?.handle) return profile.handle;
  return fallback || 'Creator';
}

/**
 * Stores an application and links/creates the creator record.
 * Returns { application, creator } or throws userError for invalid input.
 */
export function submitApplication({
  userId, tag, displayName, ageGroup, platform, language, channelInput, followersInput, otherLinks = '', intro = '',
}) {
  const settings = getSettings();
  const status = initialApplicationStatus(ageGroup, settings.discord);
  if (!status) throw userError('too_young');
  const db = getDb();
  const channelText = String(channelInput || '').trim();
  const profile = parseProfileUrl(channelText);
  const followers = parseCount(followersInput);
  const actualPlatform = profile && PLATFORMS.includes(profile.platform) ? profile.platform : platform !== 'andere' ? platform : null;

  return db.tx(() => {
    // 1. Find the creator: Discord link (e.g. joined via personal invite) > platform account > new.
    let creator = findCreatorByDiscordId(userId);
    if (!creator && profile && (profile.handle || profile.externalId)) {
      creator = findCreatorByAccount(profile.platform, { externalId: profile.externalId, handle: profile.handle });
    }
    let creatorId = creator?.id;
    if (!creatorId) {
      creatorId = createCreator({
        display_name: truncate(nameFromProfile(profile, displayName), 80),
        source: 'application',
        language: language !== 'andere' ? language : null,
        language_source: language !== 'andere' ? 'application' : null,
        age_group: ageGroup,
      });
    } else {
      const update = { age_group: ageGroup };
      if (language !== 'andere' && creator.language_source !== 'manual') {
        update.language = language;
        update.language_source = 'application';
      }
      updateCreator(creatorId, update);
    }
    linkDiscordUser(creatorId, userId, tag);

    // 2. Main channel as account.
    if (profile && PLATFORMS.includes(profile.platform) && (profile.handle || profile.externalId)) {
      upsertAccount(creatorId, {
        platform: profile.platform,
        handle: profile.handle,
        external_id: profile.externalId,
        url: profile.url,
        followers: followers ?? undefined,
        source: 'application',
      });
    }

    // 3. Further links -> accounts / contacts (the applicant gave them for business, so is_business = 1).
    const links = extractLinks(`${otherLinks}\n${channelText}`);
    for (const p of links.profiles) {
      if (p.platform === profile?.platform && (p.handle === profile?.handle || p.externalId === profile?.externalId)) continue;
      if (!PLATFORMS.includes(p.platform)) continue;
      upsertAccount(creatorId, { platform: p.platform, handle: p.handle, external_id: p.externalId, url: p.url, source: 'application' });
    }
    for (const e of links.emails) addContact(creatorId, { type: 'email', value: e.value, source: 'application', is_business: 1 });
    for (const code of links.discordInvites) addContact(creatorId, { type: 'discord', value: code, label: `https://discord.gg/${code}`, source: 'application' });

    // 4. Application row.
    const { lastInsertRowid: id } = db.run(
      `INSERT INTO applications (discord_user_id, discord_tag, creator_id, platform, channel_url, followers, language, age_group, other_links, intro, status)
       VALUES (:userId, :tag, :creatorId, :platform, :channelUrl, :followers, :language, :ageGroup, :otherLinks, :intro, :status)`,
      {
        userId,
        tag,
        creatorId,
        platform: actualPlatform || platform,
        channelUrl: profile?.url || channelText,
        followers,
        language,
        ageGroup,
        otherLinks: String(otherLinks || '').trim() || null,
        intro: String(intro || '').trim() || null,
        status,
      },
    );
    logActivity(creatorId, 'application', { applicationId: id, status });
    setOutreachStatus(creatorId, 'im_discord', { extra: { joined_discord_at: nowIso() } });
    return { application: getApplication(id), creator: getCreator(creatorId) };
  });
}

export function setReviewMessage(id, channelId, messageId) {
  getDb().run('UPDATE applications SET review_channel_id = :channelId, review_message_id = :messageId WHERE id = :id', { id, channelId, messageId });
}

/** Parent consent received: 'eltern_ausstehend' -> 'offen'. */
export function markParentConsent(id, staffUserId) {
  const app = getApplication(id);
  if (!app) throw userError('Bewerbung nicht gefunden.', 404);
  if (app.status !== 'eltern_ausstehend') throw userError(`Bewerbung ist nicht im Status „Eltern-OK ausstehend“ (sondern „${app.status}“).`, 409);
  const db = getDb();
  db.tx(() => {
    db.run("UPDATE applications SET status = 'offen' WHERE id = :id", { id: app.id });
    if (app.creator_id) updateCreator(app.creator_id, { parent_consent: 1 });
    if (app.creator_id) logActivity(app.creator_id, 'note', { text: 'Eltern-Einverständnis bestätigt', by: staffUserId || 'dashboard' });
  });
  return getApplication(app.id);
}

/**
 * Accepts an application in the database (roles are handled by the caller before this).
 * Returns { application, creator, founding }.
 */
export function acceptApplication(id, staffUserId, { founding } = {}) {
  const app = getApplication(id);
  if (!app) throw userError('Bewerbung nicht gefunden.', 404);
  if (app.status === 'eltern_ausstehend') throw userError('Erst das Eltern-Einverständnis bestätigen.', 409);
  if (app.status !== 'offen') throw userError(`Bewerbung ist bereits „${app.status}“.`, 409);
  const db = getDb();
  const settings = getSettings();
  const isFounding = founding ?? foundingAvailable(countFounding(), settings.discord.foundingLimit);
  const result = db.tx(() => {
    let creator = app.creator_id ? getCreator(app.creator_id) : null;
    if (!creator) {
      const creatorId = createCreator({ display_name: app.discord_tag || 'Creator', source: 'application', age_group: app.age_group });
      linkDiscordUser(creatorId, app.discord_user_id, app.discord_tag);
      db.run('UPDATE applications SET creator_id = :creatorId WHERE id = :id', { creatorId, id: app.id });
      creator = getCreator(creatorId);
    }
    const code = creator.creator_code || generateCreatorCode(creator.display_name);
    updateCreator(creator.id, {
      is_member: 1,
      founding: creator.founding || (isFounding ? 1 : 0),
      creator_code: code,
      paid_ok: app.age_group === '18+' ? creator.paid_ok : 0,
    });
    setOutreachStatus(creator.id, 'dabei', { extra: { accepted_at: nowIso() }, data: { applicationId: app.id } });
    db.run(
      "UPDATE applications SET status = 'angenommen', reviewed_by = :by, reviewed_at = :at WHERE id = :id",
      { id: app.id, by: staffUserId || 'dashboard', at: nowIso() },
    );
    logActivity(creator.id, 'accepted', { applicationId: app.id, founding: Boolean(isFounding), code });
    const updated = getCreator(creator.id);
    return { application: getApplication(app.id), creator: updated, founding: Boolean(updated.founding) };
  });
  // Emit outside the transaction so a failing listener cannot roll back the acceptance.
  try {
    bus.emit('creator.accepted', { creatorId: result.creator.id, discordUserId: app.discord_user_id });
  } catch { /* listeners must not break the flow */ }
  return result;
}

export function rejectApplication(id, staffUserId, reason = null) {
  const app = getApplication(id);
  if (!app) throw userError('Bewerbung nicht gefunden.', 404);
  if (!['offen', 'eltern_ausstehend'].includes(app.status)) throw userError(`Bewerbung ist bereits „${app.status}“.`, 409);
  getDb().run(
    "UPDATE applications SET status = 'abgelehnt', reviewed_by = :by, reviewed_at = :at, reject_reason = :reason WHERE id = :id",
    { id: app.id, by: staffUserId || 'dashboard', at: nowIso(), reason },
  );
  if (app.creator_id) logActivity(app.creator_id, 'note', { text: 'Bewerbung abgelehnt', by: staffUserId || 'dashboard' });
  return getApplication(app.id);
}
