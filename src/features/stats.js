/**
 * /profil und /rangliste: Werte, die das Spiel über die API meldet.
 */
const { EmbedBuilder } = require('discord.js');
const { PLAYTIME_STAT } = require('../db');
const roblox = require('../roblox');
const { discordTime, formatPlaytime } = require('../time');
const { COLORS, ephemeral } = require('../discord-utils');
const { statLabel, formatStatValue } = require('./giveaways');

const MEDALS = ['🥇', '🥈', '🥉'];

/** /rangliste */
async function leaderboard(interaction, { store }) {
  const stat = (interaction.options.getString('wert') ?? PLAYTIME_STAT).trim().toLowerCase();
  const days = interaction.options.getInteger('tage') ?? 7;
  const now = Math.floor(Date.now() / 1000);
  const from = days === 0 ? 0 : now - days * 86400;
  const rows = store.leaderboard(stat, from, now + 60, { limit: 10 });

  const period = days === 0 ? 'insgesamt' : days === 1 ? 'letzte 24 Stunden' : `letzte ${days} Tage`;
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(`🏆 Rangliste: ${statLabel(stat)} (${period})`)
    .setDescription(
      rows.length
        ? rows
            .map((r, i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${r.discord_id}> (${r.roblox_name}): ${formatStatValue(stat, r.value)}`)
            .join('\n')
        : 'Noch keine Werte in diesem Zeitraum.',
    );
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

/** /profil [nutzer] [roblox] */
async function profile(interaction, { store }) {
  const user = interaction.options.getUser('nutzer');
  const robloxName = interaction.options.getString('roblox');

  let tester;
  if (robloxName) tester = store.getTesterByRobloxName(robloxName.trim());
  else tester = store.getTester((user ?? interaction.user).id);

  if (!tester) {
    const who = robloxName ? `**${robloxName}**` : user ? `<@${user.id}>` : 'Du';
    return interaction.reply(
      ephemeral(`${who} ${who === 'Du' ? 'bist' : 'ist'} noch kein Tester.`, { allowedMentions: { parse: [] } }),
    );
  }

  await interaction.deferReply();
  const now = Math.floor(Date.now() / 1000);
  const total = store.playtimeSeconds(tester.roblox_id);
  const week = store.playtimeSeconds(tester.roblox_id, now - 7 * 86400, now + 60);
  const stats = store.statTotals(tester.roblox_id);
  const headshot = await roblox.getHeadshotUrl(tester.roblox_id);

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(`🧪 ${tester.roblox_name}`)
    .setURL(roblox.profileUrl(tester.roblox_id))
    .setDescription(`<@${tester.discord_id}> · Tester seit ${discordTime(tester.accepted_at, 'D')}`)
    .addFields(
      { name: 'Spielzeit gesamt', value: formatPlaytime(total), inline: true },
      { name: 'Letzte 7 Tage', value: formatPlaytime(week), inline: true },
      { name: 'Playtests dabei', value: String(store.playtestsAttended(tester.discord_id)), inline: true },
      { name: 'Bug-Reports', value: String(store.validBugCount(tester.discord_id)), inline: true },
      { name: 'Giveaway-Gewinne', value: String(store.giveawayWinCount(tester.discord_id)), inline: true },
    );
  if (stats.length) {
    embed.addFields({
      name: 'Werte im Spiel',
      value: stats.slice(0, 15).map((s) => `${s.stat}: **${formatStatValue(s.stat, s.value)}**`).join('\n'),
    });
  }
  if (headshot) embed.setThumbnail(headshot);
  return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

/** Autovervollständigung für Werte (spielzeit + alles, was das Spiel schon gemeldet hat) */
function autocompleteStat(interaction, { store }) {
  const focused = String(interaction.options.getFocused() ?? '').toLowerCase();
  const stats = [PLAYTIME_STAT, ...store.knownStats().filter((s) => s !== PLAYTIME_STAT)];
  return interaction.respond(
    stats
      .filter((s) => s.includes(focused))
      .slice(0, 25)
      .map((s) => ({ name: statLabel(s), value: s })),
  );
}

module.exports = { leaderboard, profile, autocompleteStat };
