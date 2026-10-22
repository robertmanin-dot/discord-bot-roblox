// Send queue: first contact + follow-up, open links, daily limits, replies, "no reply" job.
// Nothing is sent automatically – the dashboard opens the right window and copies the text.
import { getDb } from '../core/db.js';
import { getSettings, getActiveCampaignId } from '../core/settings.js';
import { services } from '../core/services.js';
import { createLogger } from '../core/log.js';
import {
  getCreatorFull, getOutreach, logActivity, setOutreachStatus, updateCreator, updateOutreach,
} from '../core/creators.js';
import { parseProfileUrl } from '../core/urls.js';
import { addDays, dayKey, zonedToUtc } from '../core/time.js';
import { HttpError, badRequest, conflict, notFound } from '../web/http.js';
import { buildVars, pickTemplate, renderTemplate } from './templates.js';
import { getListItem } from './repo.js';

const log = createLogger('radar');
const TZ = 'Europe/Berlin';
export const CHANNEL_LABELS = { email: 'E-Mail', dm: 'Direktnachricht', discord: 'Discord' };
const PLACEHOLDER_HINTS = {
  privacy: 'Link zur Datenschutzerklärung fehlt (Einstellungen → Spiel).',
  sender: 'Absendername fehlt (Einstellungen → Spiel).',
  game: 'Spielname fehlt (Einstellungen → Spiel).',
  date: 'Launch-Termin fehlt (Einstellungen → Spiel).',
  time: 'Launch-Termin fehlt (Einstellungen → Spiel).',
  link: 'Infoseite bzw. Spiel-Link fehlt (Einstellungen → Spiel).',
  discord: 'Discord-Link fehlt: Bot verbinden oder allgemeinen Einladungslink eintragen.',
  pitch: 'Kurzbeschreibung des Spiels fehlt (Einstellungen → Spiel).',
};

/** Start/end (UTC ISO) of the current day in Berlin. */
export function todayRange(now = new Date()) {
  const [y, m, d] = dayKey(now, TZ).split('-').map(Number);
  const start = zonedToUtc({ year: y, month: m, day: d }, TZ);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = zonedToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, TZ);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** { email: { used, max }, dm: {…}, discord: {…} } for today. */
export function getLimits(now = new Date(), settings = getSettings()) {
  const { start, end } = todayRange(now);
  const rows = getDb().all(
    `SELECT json_extract(data, '$.channel') AS channel, COUNT(*) AS n FROM activity
     WHERE type IN ('sent', 'followup_sent') AND created_at >= :start AND created_at < :end GROUP BY channel`,
    { start, end },
  );
  const used = Object.fromEntries(rows.map((r) => [r.channel, r.n]));
  const max = settings.radar.dailyLimits || {};
  return Object.fromEntries(['email', 'dm', 'discord'].map((ch) => [ch, { used: used[ch] || 0, max: Number(max[ch] ?? 0) }]));
}

/** Link that opens the right window: mail draft, profile/DM, or Discord invite. */
export function buildOpenUrl({ channel, target, platform, subject = '', body = '' }, settings = getSettings()) {
  if (!target) return null;
  const enc = encodeURIComponent;
  if (channel === 'email') {
    const client = settings.radar.emailClient || 'gmail';
    if (client === 'outlook') return `https://outlook.live.com/mail/0/deeplink/compose?to=${enc(target)}&subject=${enc(subject)}&body=${enc(body)}`;
    if (client === 'mailto') return `mailto:${enc(target)}?subject=${enc(subject)}&body=${enc(body.replace(/\r?\n/g, '\r\n'))}`;
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(target)}&su=${enc(subject)}&body=${enc(body)}`;
  }
  if (channel === 'dm') {
    if (platform === 'instagram' && settings.radar.instagramLink === 'app') {
      const handle = parseProfileUrl(target)?.handle;
      if (handle) return `https://ig.me/m/${handle}`;
    }
    return target;
  }
  return target;
}

function contactFor(mode, outreach, creator) {
  if (mode === 'followup') {
    return { channel: outreach.channel, target: outreach.channel_target, platform: outreach.channel_platform };
  }
  return { channel: creator.contact_channel, target: creator.contact_target, platform: creator.contact_platform };
}

function warningsFor(full, rendered, template, limits, channel) {
  const out = [];
  if (!template) out.push('Keine passende Vorlage gefunden (Vorlagen prüfen).');
  for (const key of rendered?.missing || []) {
    if (key === 'video' || key === 'name') continue;
    if (PLACEHOLDER_HINTS[key]) out.push(PLACEHOLDER_HINTS[key]);
  }
  const age = full.creator.age_group;
  if (age === '13-15' || age === '16-17') out.push('Minderjährig: keine Pflichten und keine Bezahlung anbieten, nur freiwillige Teilnahme.');
  if (limits?.[channel] && limits[channel].max && limits[channel].used >= limits[channel].max) out.push(`Tageslimit für ${CHANNEL_LABELS[channel] || channel} erreicht.`);
  return [...new Set(out)];
}

/** Renders the message for an outreach row. */
export function buildMessage(outreach, full, { mode = 'first', inviteUrl = null, settings = getSettings() } = {}) {
  const { channel, target, platform } = contactFor(mode, outreach, full.creator);
  const template = channel && channel !== 'none'
    ? pickTemplate({ step: mode === 'followup' ? 'followup' : 'first', channel, language: full.creator.language || 'en', outreachId: outreach.id, settings })
    : null;
  const vars = buildVars(full, { language: template?.language || full.creator.language || 'en', inviteUrl, settings });
  const rendered = template ? renderTemplate(template, vars) : { subject: '', body: '', missing: [] };
  const message = { subject: channel === 'email' ? rendered.subject : '', body: rendered.body };
  return {
    channel,
    target,
    platform,
    template,
    rendered,
    message,
    open_url: buildOpenUrl({ channel, target, platform, ...message }, settings),
  };
}

const QUEUE_BASE = `FROM outreach o JOIN creators c ON c.id = o.creator_id`;

function queueWhere(mode, filters, now, settings) {
  const params = { campaignId: getActiveCampaignId(), now: now.toISOString() };
  const where = ['o.campaign_id = :campaignId', "c.age_group != 'u13'"];
  if (mode === 'followup') {
    where.push("o.status = 'kontaktiert'", "o.channel = 'email'", 'o.followups_sent < :maxFollowups', 'o.followup_due_at IS NOT NULL', 'o.followup_due_at <= :now', 'o.replied_at IS NULL');
    params.maxFollowups = Number(settings.radar.maxFollowups ?? 1);
  } else {
    where.push("o.status IN ('neu', 'qualifiziert')", "c.contact_channel IS NOT NULL", "c.contact_channel != 'none'", '(o.snoozed_until IS NULL OR o.snoozed_until <= :now)', 'c.score >= :minScore');
    params.minScore = Number(filters.minScore ?? settings.radar.minScore ?? 0) || 0;
  }
  if (filters.language) {
    if (['unknown', 'unbekannt', '?'].includes(filters.language)) where.push('c.language IS NULL');
    else {
      where.push('c.language = :language');
      params.language = filters.language;
    }
  }
  if (filters.channel) {
    where.push(mode === 'followup' ? 'o.channel = :channel' : 'c.contact_channel = :channel');
    params.channel = filters.channel;
  }
  if (filters.platform) {
    where.push('EXISTS (SELECT 1 FROM accounts a WHERE a.creator_id = c.id AND a.platform = :platform)');
    params.platform = filters.platform;
  }
  return { where: `WHERE ${where.join(' AND ')}`, params };
}

/** GET /api/queue */
export function getQueue({ mode = 'first', language, platform, channel, minScore, limit = 20 } = {}, now = new Date()) {
  if (!['first', 'followup'].includes(mode)) throw badRequest('mode muss "first" oder "followup" sein.');
  const settings = getSettings();
  const db = getDb();
  const { where, params } = queueWhere(mode, { language, platform, channel, minScore }, now, settings);
  const order = mode === 'followup'
    ? 'ORDER BY o.followup_due_at ASC, o.id'
    : "ORDER BY (o.status = 'qualifiziert') DESC, c.score DESC, c.id";
  const total = db.value(`SELECT COUNT(*) ${QUEUE_BASE} ${where}`, params, 0);
  const rows = db.all(`SELECT o.* ${QUEUE_BASE} ${where} ${order} LIMIT :limit`, { ...params, limit: Math.min(200, Math.max(1, Number(limit) || 20)) });
  const limits = getLimits(now, settings);
  const items = [];
  for (const o of rows) {
    const full = getCreatorFull(o.creator_id);
    if (!full) continue;
    const m = buildMessage(o, full, { mode, inviteUrl: o.invite_code ? `https://discord.gg/${o.invite_code}` : null, settings });
    items.push({
      outreach_id: o.id,
      creator: getListItem(o.creator_id),
      channel: m.channel,
      target: m.target,
      platform: m.platform,
      template_key: m.template?.key || null,
      variant: m.template?.variant || null,
      message: m.message,
      open_url: m.open_url,
      warnings: warningsFor(full, m.rendered, m.template, limits, m.channel),
    });
  }
  return { mode, limits, total, items };
}

function loadOutreach(outreachId) {
  const o = getDb().get('SELECT * FROM outreach WHERE id = :id', { id: outreachId });
  if (!o) throw notFound('Eintrag nicht gefunden.');
  const full = getCreatorFull(o.creator_id, { campaignId: o.campaign_id });
  if (!full) throw notFound('Creator nicht gefunden.');
  return { o, full };
}

/** POST /api/queue/:id/prepare – final text incl. personal Discord invite (if the bot runs). */
export async function prepareOutreach(outreachId, { mode = 'first' } = {}) {
  const { o, full } = loadOutreach(outreachId);
  const settings = getSettings();
  let inviteUrl = o.invite_code ? `https://discord.gg/${o.invite_code}` : null;
  const probe = buildMessage(o, full, { mode, inviteUrl, settings });
  const usesDiscord = /\{discord\}/.test(`${probe.template?.subject || ''} ${probe.template?.body || ''}`);
  // The bot reuses a still valid personal invite or creates a new one (e.g. after it was deleted).
  if (usesDiscord && services.bot?.isReady?.() && typeof services.bot.createPersonalInvite === 'function') {
    try {
      const inv = await services.bot.createPersonalInvite(o.creator_id);
      if (inv?.url) inviteUrl = inv.url;
      if (inv?.code && inv.code !== o.invite_code) updateOutreach(o.id, { invite_code: inv.code });
    } catch (err) {
      log.warn('Persönlicher Discord-Link konnte nicht erstellt werden:', err.message);
    }
  }
  const m = buildMessage(o, full, { mode, inviteUrl, settings });
  return {
    channel: m.channel,
    target: m.target,
    platform: m.platform,
    template_key: m.template?.key || null,
    variant: m.template?.variant || null,
    message: m.message,
    open_url: m.open_url,
    invite_url: inviteUrl || settings.game.discordInvite || null,
    warnings: warningsFor(full, m.rendered, m.template, getLimits(new Date(), settings), m.channel),
  };
}

/** POST /api/queue/:id/sent */
export function markSent(outreachId, { mode = 'first', channel, target, platform, template_key, variant } = {}, now = new Date()) {
  const { o, full } = loadOutreach(outreachId);
  const settings = getSettings();
  const contact = contactFor(mode, o, full.creator);
  const ch = channel || contact.channel;
  if (!ch || ch === 'none') throw badRequest('Für diesen Creator ist kein Kontaktweg hinterlegt.');
  if (full.creator.age_group === 'u13') throw badRequest('Unter 13 Jahren: nicht anschreiben.');
  if (mode === 'followup') {
    if (!['kontaktiert', 'nachgefasst'].includes(o.status)) throw conflict('Nachfassen ist nur nach dem Erstkontakt möglich.');
    if (o.followups_sent >= Number(settings.radar.maxFollowups ?? 1)) throw conflict('Für diesen Creator wurde schon nachgefasst.');
  } else if (!['neu', 'qualifiziert'].includes(o.status)) {
    throw conflict('Dieser Creator ist schon als kontaktiert markiert.');
  }
  const limits = getLimits(now, settings);
  if (limits[ch]?.max && limits[ch].used >= limits[ch].max) {
    throw new HttpError(429, `Tageslimit für ${CHANNEL_LABELS[ch] || ch} erreicht (${limits[ch].max}). Morgen geht es weiter – oder das Limit in den Einstellungen erhöhen.`);
  }
  const at = now.toISOString();
  if (mode === 'followup') {
    const updated = setOutreachStatus(o.creator_id, 'nachgefasst', {
      campaignId: o.campaign_id,
      extra: { followups_sent: o.followups_sent + 1, last_followup_at: at, followup_due_at: null },
    });
    logActivity(o.creator_id, 'followup_sent', { channel: ch, template_key: template_key || null, variant: variant || null }, o.campaign_id);
    return updated || getOutreach(o.creator_id, o.campaign_id);
  }
  const followupDays = Number(settings.radar.followupAfterDays ?? 6);
  const updated = setOutreachStatus(o.creator_id, 'kontaktiert', {
    campaignId: o.campaign_id,
    extra: {
      contacted_at: at,
      channel: ch,
      channel_target: target || contact.target,
      channel_platform: platform || contact.platform,
      template_key: template_key || null,
      variant: variant || null,
      followup_due_at: ch === 'email' && Number(settings.radar.maxFollowups ?? 1) > 0 ? addDays(now, followupDays).toISOString() : null,
      snoozed_until: null,
    },
  });
  logActivity(o.creator_id, 'sent', { channel: ch, template_key: template_key || null, variant: variant || null }, o.campaign_id);
  return updated || getOutreach(o.creator_id, o.campaign_id);
}

/** POST /api/queue/:id/skip – later | unsuitable | no_contact */
export function skipOutreach(outreachId, { reason = 'later' } = {}, now = new Date()) {
  const { o } = loadOutreach(outreachId);
  if (reason === 'later') {
    const { end } = todayRange(now);
    logActivity(o.creator_id, 'skipped', { reason }, o.campaign_id);
    return updateOutreach(o.id, { snoozed_until: end });
  }
  if (reason === 'unsuitable') {
    logActivity(o.creator_id, 'skipped', { reason }, o.campaign_id);
    return setOutreachStatus(o.creator_id, 'ungeeignet', { campaignId: o.campaign_id, force: true, data: { reason } }) || getOutreach(o.creator_id, o.campaign_id);
  }
  if (reason === 'no_contact') {
    updateCreator(o.creator_id, { contact_channel: 'none', contact_target: null, contact_platform: null, contact_locked: 1 });
    logActivity(o.creator_id, 'skipped', { reason }, o.campaign_id);
    return getOutreach(o.creator_id, o.campaign_id);
  }
  throw badRequest('reason muss later, unsuitable oder no_contact sein.');
}

const SENTIMENTS = { interessiert: 'interessiert', fragen: 'geantwortet', kein_interesse: 'kein_interesse' };

/** POST /api/creators/:id/reply */
export function recordReply(creatorId, { sentiment, note } = {}, now = new Date()) {
  if (!SENTIMENTS[sentiment]) throw badRequest('sentiment muss interessiert, fragen oder kein_interesse sein.');
  const outreach = getOutreach(creatorId);
  if (!outreach) throw notFound('Creator nicht gefunden.');
  const extra = { replied_at: outreach.replied_at || now.toISOString(), reply_sentiment: sentiment, followup_due_at: null };
  const changed = setOutreachStatus(creatorId, SENTIMENTS[sentiment], { extra, data: { sentiment } });
  if (!changed) updateOutreach(outreach.id, extra);
  logActivity(creatorId, 'reply', { sentiment, note: note || null });
  return getOutreach(creatorId);
}

/** Hourly job: contacted creators without reply for too long -> "keine_antwort". Returns count. */
export function markNoReplies(now = new Date(), settings = getSettings()) {
  const days = Number(settings.radar.noReplyAfterDays ?? 14);
  const followupDays = Number(settings.radar.followupAfterDays ?? 6);
  const cutoff = addDays(now, -days).toISOString();
  const pendingCutoff = addDays(now, -(days + followupDays)).toISOString();
  const rows = getDb().all(
    `SELECT creator_id, campaign_id FROM outreach
     WHERE status IN ('kontaktiert', 'nachgefasst') AND replied_at IS NULL
       AND (
         (followup_due_at IS NULL AND COALESCE(last_followup_at, contacted_at) <= :cutoff)
         OR (followup_due_at IS NOT NULL AND contacted_at <= :pendingCutoff)
       )`,
    { cutoff, pendingCutoff },
  );
  let n = 0;
  for (const r of rows) {
    if (setOutreachStatus(r.creator_id, 'keine_antwort', { campaignId: r.campaign_id, data: { auto: true }, extra: { followup_due_at: null } })) n++;
  }
  return n;
}

