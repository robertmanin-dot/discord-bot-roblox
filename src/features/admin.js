/**
 * /setup und /tester: Einrichtung und Tester-Verwaltung durchs Team.
 */
const { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const roblox = require('../roblox');
const { SETTINGS, COLORS, ephemeral, fetchMember, safeDm } = require('../discord-utils');
const applications = require('./applications');

const SETUP_OPTIONS = [
  { option: 'tester-rolle', key: SETTINGS.testerRole, label: 'Tester-Rolle', kind: 'role' },
  { option: 'team-rolle', key: SETTINGS.staffRole, label: 'Team-Rolle', kind: 'role' },
  { option: 'bewerbungen-kanal', key: SETTINGS.reviewChannel, label: 'Bewerbungen & Team-Infos', kind: 'channel' },
  { option: 'ankuendigungen-kanal', key: SETTINGS.announceChannel, label: 'Playtests & Giveaways', kind: 'channel' },
  { option: 'bug-kanal', key: SETTINGS.bugChannel, label: 'Bug-Reports', kind: 'channel' },
];

function currentSettings(store) {
  return SETUP_OPTIONS.map(({ key, label, kind }) => {
    const id = store.getSetting(key);
    const value = id ? (kind === 'role' ? `<@&${id}>` : `<#${id}>`) : '❌ nicht gesetzt';
    return `**${label}:** ${value}`;
  }).join('\n');
}

/** /setup einstellungen */
async function settings(interaction, { store, client }) {
  const changed = [];
  const warnings = [];
  for (const { option, key, label, kind } of SETUP_OPTIONS) {
    const value = kind === 'role' ? interaction.options.getRole(option) : interaction.options.getChannel(option);
    if (!value) continue;
    store.setSetting(key, value.id);
    changed.push(label);

    if (kind === 'role' && key === SETTINGS.testerRole) {
      const me = interaction.guild.members.me ?? (await fetchMember(interaction.guild, client.user.id));
      if (me && me.roles.highest.comparePositionTo(value) <= 0) {
        warnings.push(`Meine Rolle muss in den Server-Einstellungen **über** ${value} stehen, sonst kann ich sie nicht vergeben.`);
      }
      if (value.managed || value.id === interaction.guild.id) warnings.push(`${value} kann nicht vergeben werden. Bitte eine normale Rolle wählen.`);
    }
    if (kind === 'channel') {
      const perms = value.permissionsFor?.(client.user);
      const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
      if (value.type === ChannelType.GuildForum) needed.push(PermissionFlagsBits.CreatePublicThreads);
      if (perms && !perms.has(needed)) warnings.push(`In ${value} fehlen mir Rechte (Kanal sehen, Nachrichten senden, Links einbetten).`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle('⚙️ Bot-Einstellungen')
    .setDescription(currentSettings(store))
    .setFooter({ text: 'Ändern: /setup einstellungen mit den gewünschten Optionen' });
  if (changed.length) embed.addFields({ name: 'Geändert', value: changed.join(', ') });
  if (warnings.length) embed.addFields({ name: '⚠️ Bitte prüfen', value: warnings.join('\n') });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** /setup bewerbungs-panel: postet die Nachricht mit den Regeln und dem „Bewerben“-Button. */
async function panel(interaction) {
  try {
    await interaction.channel.send(applications.buildPanel());
  } catch {
    return interaction.reply(ephemeral('Ich kann in diesem Kanal nicht schreiben. Bitte prüfe meine Rechte.'));
  }
  return interaction.reply(ephemeral('✅ Bewerbungs-Panel gepostet.'));
}

/** /tester hinzufuegen: Tester direkt aufnehmen (ohne Bewerbung). */
async function addTester(interaction, { store }) {
  const user = interaction.options.getUser('nutzer', true);
  const name = interaction.options.getString('roblox', true).trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let robloxUser;
  try {
    robloxUser = await roblox.findUserByName(name);
  } catch {
    return interaction.editReply('Roblox ist gerade nicht erreichbar. Bitte später nochmal versuchen.');
  }
  if (!robloxUser) return interaction.editReply(`Kein Roblox-Account mit dem Namen **${name}** gefunden.`);

  const taken = store.getTesterByRobloxId(robloxUser.id);
  if (taken && taken.discord_id !== user.id) {
    return interaction.editReply(`Der Roblox-Account ist schon bei <@${taken.discord_id}> eingetragen.`);
  }

  store.addTester({ discordId: user.id, robloxId: robloxUser.id, robloxName: robloxUser.name });
  const roleId = store.getSetting(SETTINGS.testerRole);
  const member = await fetchMember(interaction.guild, user.id);
  let note = '';
  if (member && roleId) {
    await member.roles.add(roleId, `Von ${interaction.user.tag} als Tester hinzugefügt`).catch(() => {
      note = '\n⚠️ Rolle konnte nicht vergeben werden. Ist meine Rolle über der Tester-Rolle?';
    });
  }
  return interaction.editReply(`✅ <@${user.id}> ist jetzt Tester (Roblox: **${robloxUser.name}**).${note}`);
}

/** /tester entfernen */
async function removeTester(interaction, { client, store }) {
  const user = interaction.options.getUser('nutzer', true);
  const reason = interaction.options.getString('grund');
  const tester = store.getTester(user.id);
  if (!tester) return interaction.reply(ephemeral(`<@${user.id}> ist kein Tester.`));

  store.removeTester(user.id);
  const roleId = store.getSetting(SETTINGS.testerRole);
  const member = await fetchMember(interaction.guild, user.id);
  if (member && roleId) await member.roles.remove(roleId, reason ?? 'Als Tester entfernt').catch(() => {});

  await safeDm(client, user.id, {
    content: `Du wurdest aus dem Wonder-Wars-Testerteam entfernt.${reason ? `\n**Grund:** ${reason}` : ''}`,
  });
  return interaction.reply(ephemeral(`<@${user.id}> (Roblox: ${tester.roblox_name}) ist kein Tester mehr.`));
}

/** /tester anzahl */
async function count(interaction, { store }) {
  return interaction.reply(ephemeral(`Es gibt aktuell **${store.countTesters()}** Tester.`));
}

module.exports = { settings, panel, addTester, removeTester, count };
