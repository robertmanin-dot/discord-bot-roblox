const { PermissionFlagsBits, MessageFlags } = require('discord.js');

const SETTINGS = {
  testerRole: 'tester_role_id',
  staffRole: 'staff_role_id',
  reviewChannel: 'review_channel_id',
  announceChannel: 'announce_channel_id',
  bugChannel: 'bug_channel_id',
};

const COLORS = {
  brand: 0x7c3aed,
  success: 0x22c55e,
  danger: 0xef4444,
  warning: 0xf59e0b,
  info: 0x3b82f6,
  neutral: 0x6b7280,
};

/** Team-Mitglied = darf „Server verwalten“ oder hat die eingestellte Team-Rolle. */
function isStaff(member, store) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  const staffRole = store.getSetting(SETTINGS.staffRole);
  if (!staffRole) return false;
  const roles = member.roles;
  if (roles?.cache) return roles.cache.has(staffRole);
  return Array.isArray(roles) && roles.includes(staffRole);
}

async function fetchChannel(client, channelId) {
  if (!channelId) return null;
  try {
    return await client.channels.fetch(channelId);
  } catch {
    return null;
  }
}

async function settingChannel(client, store, key) {
  return fetchChannel(client, store.getSetting(key));
}

/** Schickt eine Direktnachricht. Gibt false zurück, wenn der Nutzer DMs blockiert. */
async function safeDm(client, userId, payload) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

async function fetchMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

function ephemeral(content, extra = {}) {
  return { content, flags: MessageFlags.Ephemeral, ...extra };
}

/** Antwortet passend, egal ob die Interaktion schon beantwortet wurde. */
async function respond(interaction, payload) {
  const data = typeof payload === 'string' ? ephemeral(payload) : payload;
  if (interaction.deferred || interaction.replied) {
    const { flags, ...rest } = data;
    return interaction.followUp({ ...rest, flags });
  }
  return interaction.reply(data);
}

/** Teilt eine Liste von Erwähnungen auf mehrere Nachrichten auf (Discord-Limit 2000 Zeichen). */
function chunkMentions(prefix, userIds, limit = 1900) {
  const chunks = [];
  let current = prefix;
  for (const id of userIds) {
    const mention = `<@${id}> `;
    if (current.length + mention.length > limit) {
      chunks.push(current.trim());
      current = '';
    }
    current += mention;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function formatNumber(value) {
  return Number.isInteger(value) ? value.toLocaleString('de-DE') : value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

module.exports = {
  SETTINGS,
  COLORS,
  isStaff,
  fetchChannel,
  settingChannel,
  safeDm,
  fetchMember,
  ephemeral,
  respond,
  chunkMentions,
  formatNumber,
};
