// Pure rules for bot part A (age gates, founding slots, points keys, permissions helpers).
import { PermissionFlagsBits } from 'discord.js';
import { minAgeOf } from '../../core/creators.js';
import { toDate } from '../../core/time.js';

export const AGE_OPTIONS = ['u13', '13-15', '16-17', '18+'];
export const APPLY_PLATFORMS = ['youtube', 'tiktok', 'twitch', 'instagram', 'kick', 'andere'];
export const APPLY_LANGUAGES = ['de', 'en', 'es', 'pt', 'fr', 'pl', 'tr', 'andere'];
export const CONTENT_KINDS = ['video', 'short', 'stream'];

/**
 * Can someone in this age group join (creator or tester)?
 * Returns { allowed, reason?, needsParentConsent, minor }.
 * Uses the lowest age of the group, so "13-15" counts as 13.
 */
export function ageDecision(ageGroup, discordSettings = {}) {
  const minAge = Number(discordSettings.minAge ?? 13);
  const consentUnder = Number(discordSettings.parentConsentUnder ?? 16);
  const low = minAgeOf(ageGroup);
  if (low === null) return { allowed: false, reason: 'unknown', needsParentConsent: false, minor: true };
  if (low < Math.max(13, minAge)) return { allowed: false, reason: 'too_young', needsParentConsent: false, minor: true };
  return { allowed: true, needsParentConsent: low < consentUnder, minor: low < 18 };
}

/** Status of a fresh application: 'eltern_ausstehend' if parental consent is needed, else 'offen'. */
export function initialApplicationStatus(ageGroup, discordSettings) {
  const d = ageDecision(ageGroup, discordSettings);
  if (!d.allowed) return null;
  return d.needsParentConsent ? 'eltern_ausstehend' : 'offen';
}

export const OPEN_APPLICATION_STATES = ['offen', 'eltern_ausstehend'];

export function canAccept(application) {
  return application?.status === 'offen';
}

/** Founding slot free? (limit 0 = no founding role at all) */
export function foundingAvailable(currentCount, limit) {
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 && currentCount < n;
}

/** Days to wait after a rejection before applying again. */
export const REAPPLY_AFTER_DAYS = 14;

export function canReapply(lastApplication, now = new Date()) {
  if (!lastApplication) return true;
  if (OPEN_APPLICATION_STATES.includes(lastApplication.status)) return false;
  if (lastApplication.status !== 'abgelehnt') return lastApplication.status !== 'angenommen';
  const at = toDate(lastApplication.reviewed_at || lastApplication.created_at);
  return !at || (now.getTime() - at.getTime()) / 86_400_000 >= REAPPLY_AFTER_DAYS;
}

/** Staff check that works with cached GuildMembers and raw API members. */
export function isStaffInteraction(interaction, ctx) {
  if (interaction?.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  if (ctx.isStaff(interaction?.member)) return true;
  return hasRole(interaction?.member, ctx.roleId('staff'));
}

export function hasRole(member, roleId) {
  if (!roleId || !member) return false;
  const roles = member.roles;
  if (Array.isArray(roles)) return roles.includes(roleId);
  return Boolean(roles?.cache?.has?.(roleId));
}

/** Creator in the program: is_member in the DB or has the creator role. */
export function isProgramMember(creator, member, ctx) {
  return Boolean(creator?.is_member) || hasRole(member, ctx.roleId('creator')) || hasRole(member, ctx.roleId('founding'));
}

/** Event that is running right now (status 'laeuft' or now inside its time window). */
export function findRunningEvent(events, now = new Date()) {
  const t = now.getTime();
  const running = (events || []).filter((e) => {
    if (e.status === 'abgesagt' || e.status === 'beendet') return false;
    if (e.status === 'laeuft') return true;
    const start = toDate(e.starts_at);
    if (!start) return false;
    const end = start.getTime() + Number(e.duration_min || 60) * 60_000;
    return t >= start.getTime() - 15 * 60_000 && t <= end;
  });
  // Prefer the launch event if several overlap.
  running.sort((a, b) => (a.kind === 'launch' ? -1 : 0) - (b.kind === 'launch' ? -1 : 0));
  return running[0] || null;
}

/** Points for going live: once per event, otherwise once per day. */
export function livePointsPlan({ event, day, points }) {
  if (event) {
    return { points: Number(points.liveDuringEvent) || 0, ref: `live:event:${event.id}`, reason: `Live beim Event "${event.title}"` };
  }
  return { points: Number(points.liveOther) || 0, ref: `live:day:${day}`, reason: 'Live-Stream' };
}

export function contentPoints(kind, points) {
  const map = { video: points.contentVideo, short: points.contentShort, stream: points.contentStream };
  return Number(map[kind] ?? points.contentVideo) || 0;
}

/** Creator codes: 3–16 characters A–Z / 0–9. */
export function normalizeCode(input) {
  return String(input || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function validCreatorCode(code) {
  return /^[A-Z0-9]{3,16}$/.test(code);
}

/** Roblox share links / game links (www.roblox.com, ro.blox.com). */
export function isRobloxLink(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'roblox.com' || host.endsWith('.roblox.com') || host === 'ro.blox.com');
  } catch {
    return false;
  }
}
