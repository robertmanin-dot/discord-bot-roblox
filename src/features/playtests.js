/**
 * Playtests: Termin ankündigen → Tester melden sich an → Erinnerung → automatische Auswertung,
 * wer wie lange im Spiel war (Daten kommen vom Spiel über die API).
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { parseGermanDateTime, discordTime, formatPlaytime } = require('../time');
const { SETTINGS, COLORS, settingChannel, fetchChannel, ephemeral, chunkMentions } = require('../discord-utils');

const REMINDER_LEAD_SECONDS = 15 * 60;

function playtestEnd(pt) {
  return pt.starts_at + pt.duration_min * 60;
}

function buildPlaytestEmbed(pt, signupCount) {
  const statusText = {
    planned: null,
    done: '✅ Beendet',
    cancelled: '❌ Abgesagt',
  }[pt.status];
  const embed = new EmbedBuilder()
    .setColor(pt.status === 'cancelled' ? COLORS.neutral : COLORS.brand)
    .setTitle(`🎮 Playtest #${pt.id}: ${pt.title}`)
    .addFields(
      { name: 'Start', value: `${discordTime(pt.starts_at, 'F')} (${discordTime(pt.starts_at, 'R')})` },
      { name: 'Dauer', value: `${pt.duration_min} Min.`, inline: true },
      { name: 'Zählt als dabei ab', value: `${pt.min_minutes} Min. Spielzeit`, inline: true },
      { name: 'Angemeldet', value: String(signupCount), inline: true },
    );
  if (pt.description) embed.setDescription(pt.description);
  if (statusText) embed.addFields({ name: 'Status', value: statusText });
  return embed;
}

function signupRow(pt) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pt:join:${pt.id}`)
      .setLabel('Ich bin dabei')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(pt.status !== 'planned'),
  );
}

async function refreshMessage(client, store, pt) {
  const channel = await fetchChannel(client, pt.channel_id);
  if (!channel || !pt.message_id) return;
  try {
    const message = await channel.messages.fetch(pt.message_id);
    await message.edit({
      embeds: [buildPlaytestEmbed(pt, store.playtestSignups(pt.id).length)],
      components: pt.status === 'planned' ? [signupRow(pt)] : [],
    });
  } catch (err) {
    console.warn(`[playtest] Nachricht #${pt.id} konnte nicht aktualisiert werden:`, err.message);
  }
}

/** /playtest erstellen */
async function create(interaction, { client, store, config }) {
  const title = interaction.options.getString('titel', true);
  const startInput = interaction.options.getString('start', true);
  const durationMin = interaction.options.getInteger('dauer') ?? 60;
  const minMinutes = interaction.options.getInteger('mindestzeit') ?? 15;
  const description = interaction.options.getString('beschreibung');

  const startsAt = parseGermanDateTime(startInput, config.timeZone);
  if (!startsAt) {
    return interaction.reply(ephemeral('Das Startdatum verstehe ich nicht. Bitte so eingeben: `24.10.2026 18:00`'));
  }
  if (startsAt <= Math.floor(Date.now() / 1000)) {
    return interaction.reply(ephemeral(`Der Start (${discordTime(startsAt, 'F')}) liegt in der Vergangenheit.`));
  }
  if (minMinutes > durationMin) {
    return interaction.reply(ephemeral('Die Mindestzeit kann nicht länger sein als der Playtest.'));
  }

  const channel = (await settingChannel(client, store, SETTINGS.announceChannel)) ?? interaction.channel;
  const id = store.createPlaytest({
    title,
    description,
    startsAt,
    durationMin,
    minMinutes,
    createdBy: interaction.user.id,
  });
  const pt = store.getPlaytest(id);
  const roleId = store.getSetting(SETTINGS.testerRole);

  try {
    const message = await channel.send({
      content: roleId ? `<@&${roleId}> Neuer Playtest!` : 'Neuer Playtest!',
      embeds: [buildPlaytestEmbed(pt, 0)],
      components: [signupRow(pt)],
      allowedMentions: { roles: roleId ? [roleId] : [] },
    });
    store.setPlaytestMessage(id, message.channelId, message.id);
  } catch (err) {
    store.setPlaytestStatus(id, 'cancelled');
    console.error('[playtest] Ankündigung fehlgeschlagen:', err);
    return interaction.reply(ephemeral(`Ich kann in ${channel} nicht schreiben. Bitte prüfe meine Rechte.`));
  }

  return interaction.reply(ephemeral(`✅ Playtest #${id} wurde in ${channel} angekündigt.`));
}

/** Klick auf „Ich bin dabei“ */
async function toggleSignup(interaction, { client, store }, playtestId) {
  const pt = store.getPlaytest(playtestId);
  if (!pt || pt.status !== 'planned') return interaction.reply(ephemeral('Dieser Playtest ist nicht mehr offen.'));
  if (!store.getTester(interaction.user.id)) {
    return interaction.reply(ephemeral('Nur angenommene Tester können sich anmelden. Bewirb dich zuerst!'));
  }
  const joined = store.togglePlaytestSignup(pt.id, interaction.user.id);
  await interaction.reply(
    ephemeral(
      joined
        ? `✅ Du bist für **${pt.title}** angemeldet. Wir erinnern dich 15 Minuten vorher. Klick nochmal, um dich abzumelden.`
        : `Du hast dich von **${pt.title}** abgemeldet.`,
    ),
  );
  await refreshMessage(client, store, pt);
}

function buildResultEmbed(store, pt) {
  const participants = store.playtestParticipants(pt);
  const signups = new Set(store.playtestSignups(pt.id));
  const lines = participants.map((p, i) => {
    const signed = signups.has(p.discord_id) ? '' : ' *(nicht angemeldet)*';
    return `${i + 1}. <@${p.discord_id}> (${p.roblox_name}): ${formatPlaytime(p.seconds)}${signed}`;
  });
  const noShows = [...signups].filter((id) => !participants.some((p) => p.discord_id === id));

  let list = lines.join('\n') || 'Niemand hat die Mindestzeit erreicht.';
  if (list.length > 3800) list = `${list.slice(0, 3800)}\n…`;

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`📊 Auswertung Playtest #${pt.id}: ${pt.title}`)
    .setDescription(list)
    .addFields(
      { name: 'Dabei (mind. ' + pt.min_minutes + ' Min.)', value: String(participants.length), inline: true },
      { name: 'Angemeldet', value: String(signups.size), inline: true },
      { name: 'Angemeldet, aber nicht da', value: String(noShows.length), inline: true },
    );
  return embed;
}

/** /playtest auswertung */
async function report(interaction, { store }) {
  const pt = store.getPlaytest(interaction.options.getInteger('id', true));
  if (!pt) return interaction.reply(ephemeral('Playtest nicht gefunden.'));
  return interaction.reply({ embeds: [buildResultEmbed(store, pt)], allowedMentions: { parse: [] } });
}

/** /playtest liste */
async function list(interaction, { store }) {
  const items = store.listPlaytests();
  if (!items.length) return interaction.reply(ephemeral('Es sind keine Playtests geplant.'));
  const lines = items.map(
    (pt) => `**#${pt.id} ${pt.title}**: ${discordTime(pt.starts_at, 'f')} · ${store.playtestSignups(pt.id).length} angemeldet`,
  );
  return interaction.reply(ephemeral(lines.join('\n')));
}

/** /playtest absagen */
async function cancel(interaction, { client, store }) {
  const pt = store.getPlaytest(interaction.options.getInteger('id', true));
  if (!pt || pt.status !== 'planned') return interaction.reply(ephemeral('Dieser Playtest ist nicht geplant.'));
  store.setPlaytestStatus(pt.id, 'cancelled');
  const updated = store.getPlaytest(pt.id);
  await refreshMessage(client, store, updated);

  const channel = await fetchChannel(client, pt.channel_id);
  const signups = store.playtestSignups(pt.id);
  if (channel && signups.length) {
    for (const chunk of chunkMentions(`❌ Playtest **${pt.title}** wurde abgesagt.`, signups)) {
      await channel.send({ content: chunk, allowedMentions: { users: signups } }).catch(() => {});
    }
  }
  return interaction.reply(ephemeral(`Playtest #${pt.id} wurde abgesagt.`));
}

/** Wird regelmäßig vom Scheduler aufgerufen. */
async function tick({ client, store }) {
  const at = Math.floor(Date.now() / 1000);

  for (const pt of store.playtestsDueForReminder(at, REMINDER_LEAD_SECONDS)) {
    store.markPlaytestReminded(pt.id);
    const channel = await fetchChannel(client, pt.channel_id);
    const signups = store.playtestSignups(pt.id);
    if (!channel || !signups.length) continue;
    const prefix = `⏰ **${pt.title}** startet ${discordTime(pt.starts_at, 'R')}! Spiel einfach mit deinem eingetragenen Roblox-Account mit, die Zeit wird automatisch gezählt.\n`;
    for (const chunk of chunkMentions(prefix, signups)) {
      await channel.send({ content: chunk, allowedMentions: { users: signups } }).catch((err) =>
        console.warn('[playtest] Erinnerung fehlgeschlagen:', err.message),
      );
    }
  }

  for (const pt of store.playtestsFinished(at)) {
    store.setPlaytestStatus(pt.id, 'done');
    const updated = store.getPlaytest(pt.id);
    await refreshMessage(client, store, updated);
    const channel = await fetchChannel(client, pt.channel_id);
    if (channel) {
      await channel
        .send({ embeds: [buildResultEmbed(store, updated)], allowedMentions: { parse: [] } })
        .catch((err) => console.warn('[playtest] Auswertung fehlgeschlagen:', err.message));
    }
  }
}

/** Autovervollständigung für Playtest-IDs */
function autocomplete(interaction, { store }) {
  const focused = String(interaction.options.getFocused() ?? '').toLowerCase();
  const items = store
    .listPlaytests({ includeDone: true })
    .filter((pt) => !focused || String(pt.id).startsWith(focused) || pt.title.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((pt) => ({ name: `#${pt.id} ${pt.title}`.slice(0, 100), value: pt.id }));
  return interaction.respond(items);
}

module.exports = { create, toggleSignup, report, list, cancel, tick, autocomplete, playtestEnd };
