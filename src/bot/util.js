// Shared helpers for bot modules.
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { createLogger } from '../core/log.js';
import { getSettings } from '../core/settings.js';

const log = createLogger('bot');

export const EPHEMERAL = MessageFlags.Ephemeral;

export const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
  info: 0x3ba7ff,
  live: 0xe91e63,
  gold: 0xf1c40f,
};

/** 'de' for German Discord clients, otherwise 'en'. Accepts a locale string or 'de'/'en'. */
export function langOf(locale) {
  return String(locale || '').toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function fill(str, vars = {}) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

/**
 * Translation lookup. Each module keeps its own dictionary:
 *   const T = { de: { hello: 'Hallo {name}' }, en: { hello: 'Hi {name}' } };
 *   tr(T, interaction.locale, 'hello', { name })
 */
export function tr(dict, locale, key, vars = {}) {
  const lang = langOf(locale);
  const str = dict[lang]?.[key] ?? dict.en?.[key] ?? dict.de?.[key];
  if (str === undefined) {
    log.warn(`Fehlender Text: ${key}`);
    return key;
  }
  return fill(str, vars);
}

/**
 * Text for public posts (everyone sees the same message), following
 * settings.discord.serverLanguage: 'de', 'en' or 'both' (German first, then English).
 */
export function publicText(dict, key, vars = {}) {
  const mode = getSettings().discord.serverLanguage || 'both';
  const de = tr(dict, 'de', key, vars);
  const en = tr(dict, 'en', key, vars);
  if (mode === 'de') return de;
  if (mode === 'en') return en;
  return de === en ? de : `${de}\n\n🇬🇧 ${en}`;
}

/** customId format "prefix:action:arg1:arg2" (max 100 chars). */
export function cid(prefix, action, ...args) {
  const id = [prefix, action, ...args].join(':');
  if (id.length > 100) throw new Error(`customId zu lang: ${id}`);
  return id;
}

export function parseCid(customId) {
  const [prefix, action = '', ...args] = String(customId || '').split(':');
  return { prefix, action, args };
}

/** reply / followUp depending on the interaction state; never throws. */
export async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch (err) {
    log.warn('Antwort konnte nicht gesendet werden:', err.message);
    return null;
  }
}

/** Ephemeral reply helper: reply(interaction, 'Text') or reply(interaction, { embeds }) */
export function replyEphemeral(interaction, content) {
  const payload = typeof content === 'string' ? { content } : content;
  return safeReply(interaction, { ...payload, flags: EPHEMERAL });
}

export function embed({ title, description, color = COLORS.primary, fields, footer, url, thumbnail, timestamp } = {}) {
  const e = new EmbedBuilder().setColor(color);
  if (title) e.setTitle(String(title).slice(0, 256));
  if (description) e.setDescription(String(description).slice(0, 4096));
  if (url) e.setURL(url);
  if (fields?.length) {
    e.addFields(
      fields.slice(0, 25).map((f) => ({ name: String(f.name).slice(0, 256), value: String(f.value || '–').slice(0, 1024), inline: Boolean(f.inline) })),
    );
  }
  if (footer) e.setFooter({ text: String(footer).slice(0, 2048) });
  if (thumbnail) e.setThumbnail(thumbnail);
  if (timestamp) e.setTimestamp(timestamp === true ? new Date() : new Date(timestamp));
  return e;
}

/** Sends a DM; returns true on success (users can block DMs). */
export async function tryDm(user, payload) {
  try {
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

export const mentionRole = (roleId) => (roleId ? `<@&${roleId}>` : '');
export const mentionUser = (userId) => (userId ? `<@${userId}>` : '');

/** Splits long text into Discord-sized chunks at line breaks. */
export function chunkText(text, max = 1900) {
  const out = [];
  let cur = '';
  for (const line of String(text).split('\n')) {
    if ((cur + '\n' + line).length > max) {
      if (cur) out.push(cur);
      cur = line.length > max ? line.slice(0, max) : line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Normalizes a URL entered by a user; returns null if it is not http(s). */
export function cleanUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}
