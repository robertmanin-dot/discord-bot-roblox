// Discord helpers shared by the playtest, bug and event modules (Bot part B).
import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, GuildScheduledEventStatus } from 'discord.js';
import { getSettings } from '../../core/settings.js';
import { tr } from '../util.js';

/** No pings from user-provided text. */
export const NO_MENTIONS = Object.freeze({ parse: [] });

/** Allowed mentions that ping only the given role (or nothing). */
export function roleMentions(roleId) {
  return roleId ? { parse: [], roles: [roleId] } : NO_MENTIONS;
}

/** Public multi-line text following settings.discord.serverLanguage (de|en|both). */
export function composePublic(build) {
  const mode = getSettings().discord.serverLanguage || 'both';
  const de = build('de');
  const en = build('en');
  if (mode === 'de') return de;
  if (mode === 'en') return en;
  return de === en ? de : `${de}\n\n🇬🇧 ${en}`;
}

/** Language for single-language parts like embed titles: English only on English-only servers. */
export function primaryLang() {
  return getSettings().discord.serverLanguage === 'en' ? 'en' : 'de';
}

/** Button label for public messages ("Anmelden · Join" in both-mode). Max 80 chars. */
export function publicLabel(dict, key, vars = {}) {
  const mode = getSettings().discord.serverLanguage || 'both';
  const de = tr(dict, 'de', key, vars);
  const en = tr(dict, 'en', key, vars);
  const label = mode === 'de' ? de : mode === 'en' ? en : de === en ? de : `${de} · ${en}`;
  return label.slice(0, 80);
}

/** Sends a DM to a user id. Returns true on success (DMs can be closed). */
export async function dmUser(ctx, userId, payload) {
  try {
    const user = await ctx.client.users.fetch(userId);
    await user.send(payload);
    return true;
  } catch (err) {
    ctx.log?.debug?.(`DM an ${userId} nicht möglich: ${err.message}`);
    return false;
  }
}

/** DMs many users one after another; payload may be a function (userId) => payload. */
export async function dmMany(ctx, userIds, payload) {
  let sent = 0;
  let failed = 0;
  for (const id of userIds) {
    const ok = await dmUser(ctx, id, typeof payload === 'function' ? payload(id) : payload);
    if (ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

export async function fetchMessage(ctx, channelId, messageId) {
  if (!channelId || !messageId || !ctx.client) return null;
  try {
    const channel = await ctx.client.channels.fetch(channelId);
    return (await channel?.messages?.fetch(messageId)) || null;
  } catch {
    return null;
  }
}

/** Edits a stored message; returns false if it no longer exists. */
export async function editMessage(ctx, channelId, messageId, payload) {
  const msg = await fetchMessage(ctx, channelId, messageId);
  if (!msg) return false;
  try {
    await msg.edit(payload);
    return true;
  } catch (err) {
    ctx.log?.warn?.(`Nachricht ${messageId} nicht bearbeitbar: ${err.message}`);
    return false;
  }
}

/** Creates a Discord server event ("Events" list in Discord). Returns its id or null (errors are logged only). */
export async function createScheduledEvent(ctx, { name, start, end, description, location }) {
  const guild = ctx.guild?.();
  if (!guild?.scheduledEvents) return null;
  try {
    const ev = await guild.scheduledEvents.create({
      name: String(name).slice(0, 100),
      scheduledStartTime: new Date(start),
      scheduledEndTime: new Date(end),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: String(location || 'Roblox').slice(0, 100) },
      description: description ? String(description).slice(0, 1000) : undefined,
    });
    return ev?.id || null;
  } catch (err) {
    ctx.log?.warn?.(`Discord-Server-Event konnte nicht angelegt werden: ${err.message}`);
    return null;
  }
}

export async function setScheduledEventStatus(ctx, id, status) {
  const guild = ctx.guild?.();
  if (!id || !guild?.scheduledEvents) return false;
  const value = { active: GuildScheduledEventStatus.Active, completed: GuildScheduledEventStatus.Completed }[status];
  try {
    await guild.scheduledEvents.edit(id, { status: value });
    return true;
  } catch (err) {
    ctx.log?.debug?.(`Server-Event ${id} Status ${status}: ${err.message}`);
    if (status === 'completed') return deleteScheduledEvent(ctx, id);
    return false;
  }
}

export async function deleteScheduledEvent(ctx, id) {
  const guild = ctx.guild?.();
  if (!id || !guild?.scheduledEvents) return false;
  try {
    await guild.scheduledEvents.delete(id);
    return true;
  } catch (err) {
    ctx.log?.debug?.(`Server-Event ${id} nicht löschbar: ${err.message}`);
    return false;
  }
}

/** True if the member has one of the role keys (e.g. 'tester', 'creator'). Works with cached and raw members. */
export function hasAnyRole(ctx, member, keys) {
  if (!member?.roles) return false;
  const has = (id) => (Array.isArray(member.roles) ? member.roles.includes(id) : Boolean(member.roles.cache?.has(id)));
  return keys.some((k) => {
    const id = ctx.roleId(k);
    return Boolean(id && has(id));
  });
}

/** A full GuildMember for role changes (interaction.member can be a raw API object). */
export async function resolveMember(interaction, ctx) {
  const m = interaction.member;
  if (m?.roles?.add) return m;
  return ctx.member(interaction.user.id);
}
