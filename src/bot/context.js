// The ctx object every bot module receives in handlers, events and jobs.
import { PermissionFlagsBits } from 'discord.js';
import { bus } from '../core/bus.js';
import { getDb } from '../core/db.js';
import { createLogger } from '../core/log.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { services } from '../core/services.js';

export function createCtx(bot) {
  const log = createLogger('bot');
  const ctx = {
    get client() {
      return bot.client;
    },
    log,
    bus,
    db: () => getDb(),
    settings: () => getSettings(),
    updateSettings,
    guildId: () => bot.guildId,
    /** The configured Discord server (Guild) or null. */
    guild: () => (bot.guildId && bot.client ? bot.client.guilds.cache.get(bot.guildId) ?? null : null),
    isOurGuild: (guildId) => Boolean(guildId) && guildId === bot.guildId,
    roleId: (key) => getSettings().discord.roles?.[key] || null,
    channelId: (key) => getSettings().discord.channels?.[key] || null,

    /** Fetches a configured channel by key (see docs/ARCHITEKTUR.md) or null. */
    async channel(key) {
      const id = ctx.channelId(key);
      if (!id || !bot.client) return null;
      try {
        return await bot.client.channels.fetch(id);
      } catch {
        return null;
      }
    },

    async member(userId) {
      const guild = ctx.guild();
      if (!guild || !userId) return null;
      try {
        return await guild.members.fetch(userId);
      } catch {
        return null;
      }
    },

    /** Staff = "Manage Server" permission or the staff role from /setup. */
    isStaff(member) {
      if (!member) return false;
      if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
      const staffRole = ctx.roleId('staff');
      return Boolean(staffRole && member.roles?.cache?.has(staffRole));
    },

    /** Makes a function available to the dashboard as services.bot[name]. */
    provide(name, fn) {
      services.bot[name] = fn;
    },

    /** Posts into a configured channel; returns the message or null. Never throws. */
    async post(key, payload) {
      const channel = await ctx.channel(key);
      if (!channel?.isTextBased?.()) return null;
      try {
        return await channel.send(typeof payload === 'string' ? { content: payload } : payload);
      } catch (err) {
        log.warn(`Konnte nicht in #${key} posten:`, err.message);
        return null;
      }
    },

    /** Staff log channel (#bot-log); falls back to the console. */
    async postLog(payload) {
      const msg = await ctx.post('botLog', payload);
      if (!msg) log.info(typeof payload === 'string' ? payload : JSON.stringify(payload).slice(0, 500));
      return msg;
    },
  };
  return ctx;
}
