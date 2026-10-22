// Enrichment: contacts from texts, genres, fit score and the legal contact path ("Ampel").
import { getDb } from '../core/db.js';
import { getSettings } from '../core/settings.js';
import { addContact, getCreatorFull, updateCreator, upsertAccount } from '../core/creators.js';
import { extractLinks, profileUrl } from '../core/urls.js';
import { clamp, normalizeHandle } from '../core/util.js';
import { daysSince } from '../core/time.js';
import { normalizeLangCode } from './language.js';

/** Platforms on which a person can be messaged directly (manually). */
export const DM_PLATFORMS = ['instagram', 'tiktok', 'x', 'twitch'];
const DM_PREFERENCE = ['instagram', 'tiktok', 'x', 'twitch'];
const SOCIAL_TYPES = ['youtube', 'twitch', 'tiktok', 'instagram', 'x', 'kick'];

const BUSINESS_WORDS = [
  'business', 'geschäftlich', 'geschaeftlich', 'anfragen', 'anfrage', 'kooperation', 'kooperationen',
  'collab', 'collabs', 'collaboration', 'sponsor', 'sponsoring', 'sponsorship', 'inquiries', 'inquiry',
  'enquiries', 'contact', 'kontakt', 'negocios', 'negócios', 'parcerias', 'parceria', 'contato', 'contacto',
  'partenariat', 'partenariats', 'booking', 'management', 'werbung', 'promo', 'partnership', 'pr-anfragen',
];

const DM_BUSINESS_WORDS = [
  'business', 'geschäftlich', 'geschäftliches', 'geschaeftlich', 'anfragen', 'anfrage', 'kooperation', 'kooperationen',
  'koop', 'collab', 'collabs', 'collaboration', 'collaborations', 'sponsor', 'sponsors', 'sponsoring', 'sponsorship',
  'werbung', 'promo', 'promotion', 'promotions', 'partnership', 'partnerships', 'partner', 'deals', 'deal',
  'inquiries', 'negocios', 'negócios', 'colaboraciones', 'colaboración', 'colabs', 'parcerias', 'parceria',
  'publicidad', 'publicidade', 'publi', 'partenariat', 'partenariats', 'pub', 'booking', 'trabalhos',
];

const DM_TOKEN_RE = /(^|[^\p{L}\p{N}])(dms?|pms?|pn|md|mp|direct\s*messages?|direktnachrichten?|privatnachrichten?|mensagem\s*direta|mensaje\s*directo|message\s*priv[ée])(?=$|[^\p{L}\p{N}])/giu;

const PLATFORM_WORDS = [
  { platform: 'instagram', re: /(^|[^\p{L}])(instagram|insta|ig)(?=$|[^\p{L}])/iu },
  { platform: 'tiktok', re: /(^|[^\p{L}])(tiktok|tik tok|tt)(?=$|[^\p{L}])/iu },
  { platform: 'x', re: /(^|[^\p{L}])(twitter)(?=$|[^\p{L}])/iu },
  { platform: 'twitch', re: /(^|[^\p{L}])(twitch)(?=$|[^\p{L}])/iu },
];

const BUSINESS_RES = BUSINESS_WORDS.map(keywordRegex);
const DM_BUSINESS_RES = DM_BUSINESS_WORDS.map(keywordRegex);

function containsWord(text, regexes) {
  const t = text.toLowerCase();
  return regexes.some((re) => re.test(t));
}

function windowAround(text, index, length, radius) {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + length + radius));
}

/**
 * True if a business word appears near an email: up to 80 characters before it (but not before
 * the previous email) and 30 characters after it.
 */
export function isBusinessEmail(text, index, length, prevEnd = 0) {
  const start = Math.max(prevEnd, index - 80, 0);
  const end = Math.min(text.length, index + length + 30);
  return containsWord(text.slice(start, end), BUSINESS_RES);
}

/**
 * Detects an explicit invitation for business DMs ("DM for collabs", "Anfragen per DM",
 * "MD para parcerias"). Returns { invited, platforms: [] } – platforms named near the phrase.
 */
export function detectDmInvite(text) {
  const s = String(text ?? '');
  const platforms = new Set();
  let invited = false;
  for (const m of s.matchAll(DM_TOKEN_RE)) {
    const idx = m.index + m[1].length;
    const win = windowAround(s, idx, m[2].length, 60);
    if (!containsWord(win, DM_BUSINESS_RES)) continue;
    invited = true;
    for (const { platform, re } of PLATFORM_WORDS) if (re.test(win)) platforms.add(platform);
  }
  return { invited, platforms: [...platforms] };
}

/**
 * Analyses a text (description, bio).
 * Returns { emails:[{value,is_business}], profiles, discordInvites, dmInvited, dmPlatforms }.
 */
export function analyzeText(text, { sourcePlatform = null } = {}) {
  const s = String(text ?? '');
  const links = extractLinks(s);
  const sorted = [...links.emails].sort((a, b) => a.index - b.index);
  const emails = sorted.map((e, i) => {
    const prev = sorted[i - 1];
    const prevEnd = prev ? prev.index + prev.value.length : 0;
    return { value: e.value, is_business: isBusinessEmail(s, e.index, e.value.length, prevEnd) ? 1 : 0 };
  });
  const dm = detectDmInvite(s);
  let dmPlatforms = dm.platforms.filter((p) => DM_PLATFORMS.includes(p));
  if (dm.invited && !dmPlatforms.length) {
    if (sourcePlatform && DM_PLATFORMS.includes(sourcePlatform)) dmPlatforms = [sourcePlatform];
    else {
      const linked = [...new Set(links.profiles.map((p) => p.platform).filter((p) => DM_PLATFORMS.includes(p)))];
      if (linked.length === 1) dmPlatforms = linked;
    }
  }
  return { emails, profiles: links.profiles, discordInvites: links.discordInvites, dmInvited: dm.invited, dmPlatforms };
}

/**
 * Stores what analyzeText found: emails, cross-linked profiles (as contacts and, if free, as
 * accounts), Discord invites and the DM invitation. `sourceAccount` = { platform, handle } of the
 * profile the text came from (so "DM for collabs" in a TikTok bio marks that TikTok account).
 */
export function applyAnalysis(creatorId, analysis, { source, sourceAccount = null } = {}) {
  const db = getDb();
  for (const e of analysis.emails) {
    addContact(creatorId, { type: 'email', value: e.value, source, is_business: e.is_business });
  }
  for (const p of analysis.profiles) {
    const value = p.handle || p.externalId;
    if (!value) continue;
    addContact(creatorId, {
      type: p.platform,
      value: p.handle ? normalizeHandle(p.handle) : value,
      label: p.url,
      source,
      dm_invited: analysis.dmPlatforms.includes(p.platform) ? 1 : 0,
    });
    // Also remember the profile as an account (helps merging duplicates) unless someone else owns it.
    const owner = p.handle
      ? db.get('SELECT creator_id FROM accounts WHERE platform = :platform AND handle = :handle', { platform: p.platform, handle: normalizeHandle(p.handle) })
      : db.get('SELECT creator_id FROM accounts WHERE platform = :platform AND external_id = :id', { platform: p.platform, id: p.externalId });
    if (!owner) {
      upsertAccount(creatorId, { platform: p.platform, handle: p.handle || undefined, external_id: p.externalId || undefined, url: p.url, source: 'crosslink' });
    }
  }
  for (const code of analysis.discordInvites) {
    addContact(creatorId, { type: 'discord', value: code, label: `https://discord.gg/${code}`, source });
  }
  if (analysis.dmInvited && sourceAccount?.platform && DM_PLATFORMS.includes(sourceAccount.platform) && sourceAccount.handle
      && analysis.dmPlatforms.includes(sourceAccount.platform)) {
    addContact(creatorId, {
      type: sourceAccount.platform,
      value: normalizeHandle(sourceAccount.handle),
      label: profileUrl(sourceAccount.platform, sourceAccount.handle),
      source,
      dm_invited: 1,
    });
  }
}

function keywordRegex(keyword) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
}

const genreCache = new Map();

/** Like keywordRegex, but every word may carry a short ending ("neue" also matches "neuen", "tower" → "towers"). */
function genreRegex(keyword) {
  let re = genreCache.get(keyword);
  if (!re) {
    const words = keyword.toLowerCase().trim().split(/\s+/).map((w) => `${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e|en|er|es|n|s|ern)?`);
    re = new RegExp(`(^|[^\\p{L}\\p{N}])${words.join('\\s+')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
    if (genreCache.size > 500) genreCache.clear();
    genreCache.set(keyword, re);
  }
  return re;
}

/** Genre keys (shooter, buildfight, newgames, viewers) whose keywords occur in the texts. */
export function matchGenres(texts, genres = getSettings().radar.genres) {
  const hay = (Array.isArray(texts) ? texts : [texts]).flat().filter(Boolean).join(' \n ').toLowerCase();
  if (!hay) return [];
  return Object.entries(genres || {})
    .filter(([, words]) => (words || []).some((w) => w && genreRegex(w).test(hay)))
    .map(([key]) => key);
}

const GENRE_POINTS = { shooter: 8, newgames: 8, buildfight: 6, viewers: 5 };

function activityPoints(days) {
  if (!Number.isFinite(days)) return null;
  if (days <= 7) return 15;
  if (days <= 14) return 11;
  if (days <= 30) return 7;
  if (days <= 60) return 3;
  return 0;
}

/**
 * Fit score 0–100 (docs/ARCHITEKTUR.md 5.4). Unknown values (e.g. a hand-captured TikTok profile)
 * get small neutral points so they are not ranked to the bottom only for missing API data.
 */
export function computeScore(full, settings = getSettings(), now = new Date()) {
  const accounts = full.accounts || [];
  const contacts = full.contacts || [];
  const details = {};

  // Roblox focus
  let roblox = null;
  for (const a of accounts) {
    let v = null;
    if (a.platform === 'twitch' && a.times_seen_live > 0) v = 25;
    else if (a.roblox_share !== null && a.roblox_share !== undefined) v = Math.round(clamp(a.roblox_share, 0, 1) * 30);
    if (v !== null) roblox = Math.max(roblox ?? 0, v);
  }
  details.roblox = roblox ?? (accounts.some((a) => ['tiktok', 'instagram', 'x', 'kick'].includes(a.platform)) ? 15 : 0);

  // Activity
  const lastActive = accounts.map((a) => a.last_active_at).filter(Boolean).sort().pop();
  const act = activityPoints(daysSince(lastActive, now));
  details.activity = act ?? (accounts.length ? 5 : 0);

  // Size
  const { minFollowers = 200, maxFollowers = 25000 } = settings.radar || {};
  let size = null;
  for (const a of accounts) {
    let v = null;
    if (a.platform === 'twitch' && a.avg_live_viewers !== null && a.avg_live_viewers !== undefined) {
      const avg = a.avg_live_viewers;
      v = avg >= 3 && avg <= 100 ? 20 : (avg >= 1 && avg < 3) || (avg > 100 && avg <= 250) ? 12 : 5;
    } else if (a.followers !== null && a.followers !== undefined) {
      const f = a.followers;
      v = f >= 500 && f <= 15000 ? 20 : (f >= minFollowers && f < 500) || (f > 15000 && f <= maxFollowers) ? 12 : 5;
    }
    if (v !== null) size = Math.max(size ?? 0, v);
  }
  details.size = size ?? 5;

  // Engagement
  let engagement = 0;
  for (const a of accounts) {
    let v = 0;
    if (a.platform === 'youtube' && a.avg_views !== null && a.avg_views !== undefined && a.followers > 0) {
      const r = a.avg_views / a.followers;
      v = r > 0.3 ? 10 : r > 0.15 ? 7 : r > 0.05 ? 4 : 1;
    } else if (a.platform === 'twitch' && a.times_seen_live > 0) {
      v = a.times_seen_live >= 3 ? 10 : a.times_seen_live === 2 ? 6 : 3;
    }
    engagement = Math.max(engagement, v);
  }
  details.engagement = engagement;

  // Genres
  const genres = new Set(accounts.flatMap((a) => (Array.isArray(a.genres) ? a.genres : [])));
  details.genre = Math.min(15, [...genres].reduce((sum, g) => sum + (GENRE_POINTS[g] || 0), 0));
  details.genres = [...genres];

  // Contactability
  const emails = contacts.filter((c) => c.type === 'email');
  let contact = 0;
  if (emails.some((c) => c.is_business)) contact = 10;
  else if (emails.length) contact = 8;
  else if (contacts.some((c) => DM_PLATFORMS.includes(c.type) && c.dm_invited)) contact = 7;
  else if (contacts.some((c) => c.type === 'discord')) contact = 5;
  else if (contacts.some((c) => SOCIAL_TYPES.includes(c.type)) || accounts.length > 1) contact = 2;
  details.contact = contact;

  const score = clamp(Math.round(details.roblox + details.activity + details.size + details.engagement + details.genre + details.contact), 0, 100);
  return { score, details };
}

/**
 * Best legal contact path (docs/ARCHITEKTUR.md 4):
 * email > dm (only with explicit invitation) > own Discord server > none.
 */
export function chooseContactChannel(full) {
  const contacts = full.contacts || [];
  const emails = contacts.filter((c) => c.type === 'email');
  if (emails.length) {
    const best = emails.find((c) => c.is_business) || emails[0];
    return { channel: 'email', target: best.value, platform: null };
  }
  const dms = contacts.filter((c) => DM_PLATFORMS.includes(c.type) && c.dm_invited);
  if (dms.length) {
    dms.sort((a, b) => DM_PREFERENCE.indexOf(a.type) - DM_PREFERENCE.indexOf(b.type));
    const best = dms[0];
    return { channel: 'dm', target: profileUrl(best.type, best.value) || best.label, platform: best.type };
  }
  const discord = contacts.find((c) => c.type === 'discord');
  if (discord) return { channel: 'discord', target: `https://discord.gg/${discord.value}`, platform: 'discord' };
  return { channel: 'none', target: null, platform: null };
}

/** Recomputes score, contact path (unless locked) and missing language. Returns the creator. */
export function recomputeCreator(creatorId, settings = getSettings()) {
  const full = getCreatorFull(creatorId);
  if (!full) return null;
  const { score, details } = computeScore(full, settings);
  const fields = { score, score_details: details };
  if (!full.creator.contact_locked) {
    const ch = chooseContactChannel(full);
    fields.contact_channel = ch.channel;
    fields.contact_target = ch.target;
    fields.contact_platform = ch.platform;
  }
  if (!full.creator.language) {
    const lang = full.accounts.map((a) => normalizeLangCode(a.platform_language)).find(Boolean);
    if (lang) {
      fields.language = lang;
      fields.language_source = 'platform';
    }
  }
  return updateCreator(creatorId, fields);
}
