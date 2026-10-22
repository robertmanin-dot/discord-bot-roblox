/**
 * Giveaways für Tester.
 *  - Verlosung: Teilnahme per Button, optional mit Bedingung (Mindestzeit beim Playtest) und
 *    gewichteten Losen (mehr Lose für Playtests und Bug-Reports).
 *  - Rangliste: Die besten Tester nach einem Wert (z. B. Spielzeit oder Siege) im Zeitraum gewinnen.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { PLAYTIME_STAT } = require('../db');
const { parseDuration, discordTime, formatPlaytime } = require('../time');
const { SETTINGS, COLORS, settingChannel, fetchChannel, safeDm, ephemeral, formatNumber } = require('../discord-utils');
const { checkEligibility, drawWinners } = require('./giveaway-logic');

const MEDALS = ['🥇', '🥈', '🥉'];

function statLabel(stat) {
  return stat === PLAYTIME_STAT ? 'Spielzeit' : stat;
}

function formatStatValue(stat, value) {
  return stat === PLAYTIME_STAT ? formatPlaytime(value) : formatNumber(value);
}

function conditionLines(store, g) {
  const lines = ['• Du musst angenommener Tester sein'];
  if (g.playtest_id) {
    const pt = store.getPlaytest(g.playtest_id);
    const min = g.min_minutes ?? pt?.min_minutes ?? 15;
    lines.push(`• Mindestens **${min} Min.** beim Playtest **${pt ? pt.title : '#' + g.playtest_id}** gespielt`);
  }
  if (g.weighted) lines.push('• Extra-Lose: +1 pro Playtest, bei dem du dabei warst, und +1 pro gültigem Bug-Report');
  return lines;
}

function buildEmbed(store, g) {
  const ended = g.status !== 'running';
  const embed = new EmbedBuilder()
    .setColor(ended ? COLORS.neutral : COLORS.warning)
    .setTitle(`🎁 Giveaway #${g.id}: ${g.prize}`);

  if (g.type === 'raffle') {
    embed.setDescription(
      [
        ended ? '**Beendet**' : `Klick auf „Teilnehmen“! Endet ${discordTime(g.ends_at, 'R')}.`,
        '',
        '**Bedingungen**',
        ...conditionLines(store, g),
      ].join('\n'),
    );
    embed.addFields(
      { name: 'Gewinner', value: String(g.winners_count), inline: true },
      { name: 'Teilnehmer', value: String(store.giveawayEntries(g.id).length), inline: true },
      { name: 'Ende', value: discordTime(g.ends_at, 'f'), inline: true },
    );
  } else {
    embed.setDescription(
      [
        ended ? '**Beendet**' : `Endet ${discordTime(g.ends_at, 'R')}.`,
        '',
        `Die **${g.winners_count} besten Tester** nach **${statLabel(g.stat)}** zwischen ${discordTime(g.starts_at, 'f')} und ${discordTime(g.ends_at, 'f')} gewinnen.`,
        'Du musst nichts anklicken: Spiel einfach Wonder Wars mit deinem eingetragenen Roblox-Account.',
      ].join('\n'),
    );
  }

  const winners = store.giveawayWinners(g.id);
  if (winners.length) {
    embed.addFields({
      name: '🏆 Gewinner',
      value: winners.map((w) => `${MEDALS[w.place - 1] ?? `${w.place}.`} <@${w.discord_id}>${w.detail ? ` (${w.detail})` : ''}`).join('\n'),
    });
  }
  return embed;
}

function buildRow(g) {
  if (g.status !== 'running') return [];
  const button =
    g.type === 'raffle'
      ? new ButtonBuilder().setCustomId(`ga:enter:${g.id}`).setLabel('Teilnehmen').setEmoji('🎉').setStyle(ButtonStyle.Success)
      : new ButtonBuilder().setCustomId(`ga:standings:${g.id}`).setLabel('Aktueller Stand').setEmoji('📊').setStyle(ButtonStyle.Secondary);
  return [new ActionRowBuilder().addComponents(button)];
}

async function refreshMessage(client, store, g) {
  const channel = await fetchChannel(client, g.channel_id);
  if (!channel || !g.message_id) return;
  try {
    const message = await channel.messages.fetch(g.message_id);
    await message.edit({ embeds: [buildEmbed(store, g)], components: buildRow(g), allowedMentions: { parse: [] } });
  } catch (err) {
    console.warn(`[giveaway] Nachricht #${g.id} konnte nicht aktualisiert werden:`, err.message);
  }
}

async function postGiveaway(interaction, { client, store }, id) {
  const g = store.getGiveaway(id);
  const channel = (await settingChannel(client, store, SETTINGS.announceChannel)) ?? interaction.channel;
  const roleId = store.getSetting(SETTINGS.testerRole);
  try {
    const message = await channel.send({
      content: roleId ? `<@&${roleId}> Neues Giveaway!` : 'Neues Giveaway!',
      embeds: [buildEmbed(store, g)],
      components: buildRow(g),
      allowedMentions: { roles: roleId ? [roleId] : [] },
    });
    store.setGiveawayMessage(id, message.channelId, message.id);
  } catch (err) {
    store.endGiveaway(id);
    console.error('[giveaway] Posten fehlgeschlagen:', err);
    return interaction.reply(ephemeral(`Ich kann in ${channel} nicht schreiben. Bitte prüfe meine Rechte.`));
  }
  return interaction.reply(ephemeral(`✅ Giveaway #${id} läuft in ${channel}.`));
}

/** /giveaway verlosung */
async function createRaffle(interaction, ctx) {
  const { store } = ctx;
  const prize = interaction.options.getString('preis', true);
  const durationInput = interaction.options.getString('dauer', true);
  const winnersCount = interaction.options.getInteger('gewinner') ?? 1;
  const playtestId = interaction.options.getInteger('playtest');
  const minMinutes = interaction.options.getInteger('mindestzeit');
  const weighted = interaction.options.getBoolean('gewichtet') ?? false;

  const duration = parseDuration(durationInput);
  if (!duration) return interaction.reply(ephemeral('Die Dauer verstehe ich nicht. Beispiele: `30m`, `12h`, `3d`, `1d 12h`'));
  if (playtestId && !store.getPlaytest(playtestId)) return interaction.reply(ephemeral(`Playtest #${playtestId} gibt es nicht.`));
  if (minMinutes != null && !playtestId) {
    return interaction.reply(ephemeral('Eine Mindestzeit braucht einen Playtest. Wähle bei `playtest` einen aus.'));
  }

  const now = Math.floor(Date.now() / 1000);
  const id = store.createGiveaway({
    type: 'raffle',
    prize,
    winnersCount,
    startsAt: now,
    endsAt: now + duration,
    playtestId: playtestId ?? null,
    minMinutes: minMinutes ?? null,
    weighted: weighted ? 1 : 0,
    createdBy: interaction.user.id,
  });
  return postGiveaway(interaction, ctx, id);
}

/** /giveaway rangliste */
async function createLeaderboard(interaction, ctx) {
  const { store } = ctx;
  const prize = interaction.options.getString('preis', true);
  const days = interaction.options.getInteger('tage', true);
  const stat = (interaction.options.getString('wert') ?? PLAYTIME_STAT).trim().toLowerCase();
  const places = interaction.options.getInteger('plaetze') ?? 3;

  if (!/^[a-z0-9_]{1,32}$/.test(stat)) return interaction.reply(ephemeral('Ungültiger Wert. Erlaubt sind a-z, 0-9 und _.'));

  const now = Math.floor(Date.now() / 1000);
  const id = store.createGiveaway({
    type: 'leaderboard',
    prize,
    winnersCount: places,
    startsAt: now,
    endsAt: now + days * 86400,
    stat,
    createdBy: interaction.user.id,
  });
  return postGiveaway(interaction, ctx, id);
}

/** Klick auf „Teilnehmen“ (nochmal klicken = austreten) */
async function toggleEntry(interaction, { client, store }, giveawayId) {
  const g = store.getGiveaway(giveawayId);
  if (!g || g.status !== 'running' || g.type !== 'raffle') return interaction.reply(ephemeral('Dieses Giveaway ist vorbei.'));

  if (store.removeGiveawayEntry(g.id, interaction.user.id)) {
    await interaction.reply(ephemeral('Du nimmst nicht mehr teil. Klick nochmal, um wieder mitzumachen.'));
    return refreshMessage(client, store, g);
  }

  const result = checkEligibility(store, g, interaction.user.id);
  if (!result.ok) return interaction.reply(ephemeral(`❌ ${result.reason}`));

  store.addGiveawayEntry(g.id, interaction.user.id);
  const lines = [`🎉 Du nimmst teil! Auslosung ${discordTime(g.ends_at, 'R')}.`];
  if (g.weighted) lines.push(`Du hast aktuell **${result.tickets} Los${result.tickets === 1 ? '' : 'e'}**.`);
  if (result.pending) lines.push(`⚠️ ${result.pending}`);
  lines.push('Klick nochmal, um auszutreten.');
  await interaction.reply(ephemeral(lines.join('\n')));
  return refreshMessage(client, store, g);
}

/** Klick auf „Aktueller Stand“ bei Ranglisten-Giveaways */
async function showStandings(interaction, { store }, giveawayId) {
  const g = store.getGiveaway(giveawayId);
  if (!g || g.type !== 'leaderboard') return interaction.reply(ephemeral('Giveaway nicht gefunden.'));
  const rows = store.leaderboard(g.stat, g.starts_at, Math.min(g.ends_at, Math.floor(Date.now() / 1000) + 60), { limit: 10 });
  if (!rows.length) return interaction.reply(ephemeral('Noch keine Werte in diesem Zeitraum.'));
  const lines = rows.map(
    (r, i) => `${MEDALS[i] ?? `${i + 1}.`} <@${r.discord_id}> (${r.roblox_name}): ${formatStatValue(g.stat, r.value)}`,
  );
  const own = rows.findIndex((r) => r.discord_id === interaction.user.id);
  if (own === -1 && store.getTester(interaction.user.id)) lines.push('', 'Du bist noch nicht in den Top 10.');
  return interaction.reply(ephemeral(lines.join('\n'), { allowedMentions: { parse: [] } }));
}

/** Ermittelt Gewinner. exclude = Discord-IDs, die schon gewonnen haben. */
function pickWinners(store, g, count, exclude = new Set()) {
  if (g.type === 'raffle') {
    const candidates = store
      .giveawayEntries(g.id)
      .filter((id) => !exclude.has(id))
      .map((id) => ({ id, ...checkEligibility(store, g, id, { final: true }) }))
      .filter((c) => c.ok);
    return drawWinners(candidates, count).map((id) => ({ discordId: id, detail: null }));
  }
  return store
    .leaderboard(g.stat, g.starts_at, g.ends_at, { limit: count + exclude.size })
    .filter((r) => !exclude.has(r.discord_id))
    .slice(0, count)
    .map((r) => ({ discordId: r.discord_id, detail: formatStatValue(g.stat, r.value) }));
}

async function announceWinners(ctx, g, winners) {
  const { client, store } = ctx;
  const channel = await fetchChannel(client, g.channel_id);
  if (channel) {
    const content = winners.length
      ? `🎉 Glückwunsch ${winners.map((w) => `<@${w.discordId}>`).join(', ')}! Ihr habt **${g.prize}** gewonnen (Giveaway #${g.id}). Das Team meldet sich bei euch.`
      : `Giveaway #${g.id} (**${g.prize}**) ist vorbei, aber niemand hat die Bedingungen erfüllt.`;
    await channel
      .send({ content, allowedMentions: { users: winners.map((w) => w.discordId) } })
      .catch((err) => console.warn('[giveaway] Ankündigung fehlgeschlagen:', err.message));
  }

  for (const w of winners) {
    await safeDm(client, w.discordId, {
      content: `🎉 Du hast beim Wonder-Wars-Giveaway **${g.prize}** gewonnen! Das Team meldet sich bei dir, um dir den Preis zu schicken.`,
    });
  }

  const reviewChannel = await settingChannel(client, store, SETTINGS.reviewChannel);
  if (reviewChannel && winners.length) {
    const lines = winners.map((w) => {
      const tester = store.getTester(w.discordId);
      return `• <@${w.discordId}>${tester ? ` (Roblox: ${tester.roblox_name})` : ''}${w.detail ? `: ${w.detail}` : ''}`;
    });
    await reviewChannel
      .send({
        content: [`📦 **Giveaway #${g.id}: ${g.prize}** ist beendet. Bitte den Preis verschicken an:`, ...lines].join('\n'),
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  }
}

/** Beendet ein Giveaway und lost aus. Gibt die Gewinner zurück oder null, wenn es schon beendet war. */
async function finish(ctx, giveawayId) {
  const { client, store } = ctx;
  if (!store.endGiveaway(giveawayId)) return null;
  const g = store.getGiveaway(giveawayId);
  const winners = pickWinners(store, g, g.winners_count);
  store.addGiveawayWinners(
    g.id,
    winners.map((w, i) => ({ ...w, place: i + 1 })),
  );
  await refreshMessage(client, store, g);
  await announceWinners(ctx, g, winners);
  return winners;
}

/** /giveaway beenden */
async function endNow(interaction, ctx) {
  const id = interaction.options.getInteger('id', true);
  const g = ctx.store.getGiveaway(id);
  if (!g) return interaction.reply(ephemeral('Giveaway nicht gefunden.'));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const winners = await finish(ctx, id);
  if (winners === null) return interaction.editReply('Dieses Giveaway ist schon beendet.');
  return interaction.editReply(`Giveaway #${id} beendet. ${winners.length} Gewinner gezogen.`);
}

/** /giveaway neu-auslosen: zieht einen zusätzlichen Gewinner (z. B. wenn sich jemand nicht meldet). */
async function reroll(interaction, ctx) {
  const { client, store } = ctx;
  const id = interaction.options.getInteger('id', true);
  const g = store.getGiveaway(id);
  if (!g) return interaction.reply(ephemeral('Giveaway nicht gefunden.'));
  if (g.status === 'running') return interaction.reply(ephemeral('Das Giveaway läuft noch. Beende es zuerst mit `/giveaway beenden`.'));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const previous = store.giveawayWinners(id);
  const exclude = new Set(previous.map((w) => w.discord_id));
  const [winner] = pickWinners(store, g, 1, exclude);
  if (!winner) return interaction.editReply('Es gibt keine weiteren Teilnehmer, die die Bedingungen erfüllen.');

  const place = previous.reduce((max, w) => Math.max(max, w.place), 0) + 1;
  store.addGiveawayWinners(id, [{ ...winner, place }]);
  await refreshMessage(client, store, g);
  await announceWinners(ctx, g, [winner]);
  return interaction.editReply(`Neuer Gewinner: <@${winner.discordId}>`);
}

/** /giveaway liste */
async function list(interaction, { store }) {
  const items = store.listGiveaways();
  if (!items.length) return interaction.reply(ephemeral('Es laufen gerade keine Giveaways.'));
  const lines = items.map((g) => {
    const kind = g.type === 'raffle' ? 'Verlosung' : `Rangliste (${statLabel(g.stat)})`;
    return `**#${g.id} ${g.prize}**: ${kind}, endet ${discordTime(g.ends_at, 'R')}`;
  });
  return interaction.reply(ephemeral(lines.join('\n')));
}

/** Wird regelmäßig vom Scheduler aufgerufen. */
async function tick(ctx) {
  for (const g of ctx.store.giveawaysDue()) {
    try {
      await finish(ctx, g.id);
    } catch (err) {
      console.error(`[giveaway] Auslosung #${g.id} fehlgeschlagen:`, err);
    }
  }
}

function autocompleteIds(interaction, { store }) {
  const focused = String(interaction.options.getFocused() ?? '');
  const items = store
    .listGiveaways({ running: false })
    .filter((g) => !focused || String(g.id).startsWith(focused) || g.prize.toLowerCase().includes(focused.toLowerCase()))
    .slice(0, 25)
    .map((g) => ({ name: `#${g.id} ${g.prize}${g.status === 'running' ? ' (läuft)' : ''}`.slice(0, 100), value: g.id }));
  return interaction.respond(items);
}

module.exports = {
  createRaffle,
  createLeaderboard,
  toggleEntry,
  showStandings,
  endNow,
  reroll,
  list,
  tick,
  finish,
  pickWinners,
  autocompleteIds,
  statLabel,
  formatStatValue,
};
