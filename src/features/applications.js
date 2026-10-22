/**
 * Tester-Bewerbung: Panel mit Regeln → Formular → Prüfung durchs Team → Tester-Rolle.
 * Abgefragt werden nur Roblox-Name, Altersgruppe, Geräte, wie oft man spielt und optional die Motivation.
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const roblox = require('../roblox');
const { discordTime } = require('../time');
const { SETTINGS, COLORS, isStaff, settingChannel, safeDm, fetchMember, ephemeral } = require('../discord-utils');

const AGE_GROUPS = [
  { label: '13–15 Jahre', value: '13-15' },
  { label: '16–17 Jahre', value: '16-17' },
  { label: '18 Jahre oder älter', value: '18+' },
];
const DEVICES = [
  { label: 'PC / Laptop', value: 'pc' },
  { label: 'Handy', value: 'handy' },
  { label: 'Tablet', value: 'tablet' },
  { label: 'Konsole (Xbox / PlayStation)', value: 'konsole' },
];
const FREQUENCIES = [
  { label: 'Fast jeden Tag', value: 'taeglich' },
  { label: 'Ein paar Mal pro Woche', value: 'woechentlich' },
  { label: 'Eher selten', value: 'selten' },
];

const RULES = [
  '1. **Keine Leaks:** Keine Screenshots, Videos oder Infos aus der Testversion nach außen geben, solange das Team es nicht erlaubt.',
  '2. **Ehrliches Feedback:** Sag, was dir gefällt und was nicht. Genau dafür bist du hier.',
  '3. **Bugs melden statt ausnutzen:** Fehler bitte mit `/bug` melden.',
  '4. **Respektvoll bleiben:** Kein Spam, keine Beleidigungen.',
  '',
  '🔒 **Wir fragen nie nach deinem Passwort, Login, Cookie oder einem QR-Code.** Wer das tut, ist ein Betrüger.',
];

const labelOf = (list, value) => list.find((o) => o.value === value)?.label ?? value;

function buildPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle('🧪 Werde Spieltester für Wonder Wars')
    .setDescription(
      [
        'Spiele neue Inhalte vor allen anderen, hilf uns, Bugs zu finden, und gewinne bei Giveaways.',
        '',
        '**So geht’s:** Klick auf „Bewerben“ und gib deinen Roblox-Namen und ein paar kurze Infos an. Das Team meldet sich per Nachricht.',
        '',
        '**Regeln für Tester**',
        ...RULES,
        '',
        'Mit deiner Bewerbung akzeptierst du diese Regeln.',
      ].join('\n'),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('app:start').setLabel('Bewerben').setEmoji('📝').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

function buildModal() {
  const select = (id, placeholder, options, { min = 1, max = 1 } = {}) =>
    new StringSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(placeholder)
      .setMinValues(min)
      .setMaxValues(max)
      .addOptions(options);

  return new ModalBuilder()
    .setCustomId('app:submit')
    .setTitle('Bewerbung als Spieltester')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Roblox-Benutzername')
        .setDescription('Nur der Name. Wir fragen nie nach Passwort oder Login.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('roblox_name')
            .setStyle(TextInputStyle.Short)
            .setMinLength(3)
            .setMaxLength(20)
            .setPlaceholder('z. B. Builderman')
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Wie alt bist du?')
        .setStringSelectMenuComponent(select('age_group', 'Altersgruppe wählen', AGE_GROUPS)),
      new LabelBuilder()
        .setLabel('Auf welchen Geräten spielst du?')
        .setDescription('Mehrere möglich')
        .setStringSelectMenuComponent(select('devices', 'Geräte wählen', DEVICES, { max: DEVICES.length })),
      new LabelBuilder()
        .setLabel('Wie oft spielst du Roblox?')
        .setStringSelectMenuComponent(select('frequency', 'Bitte wählen', FREQUENCIES)),
      new LabelBuilder()
        .setLabel('Warum möchtest du testen? (optional)')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('motivation')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500)
            .setRequired(false),
        ),
    );
}

function reviewButtons(applicationId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`app:accept:${applicationId}`)
      .setLabel('Annehmen')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`app:reject:${applicationId}`)
      .setLabel('Ablehnen')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger),
  );
}

function buildReviewEmbed(app, { headshotUrl = null, created = null, warnings = [] } = {}) {
  const devices = app.devices
    .split(',')
    .map((d) => labelOf(DEVICES, d))
    .join(', ');
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`Bewerbung #${app.id}`)
    .setDescription(`<@${app.discord_id}> möchte Tester werden.`)
    .addFields(
      { name: 'Roblox', value: `[${app.roblox_name}](${roblox.profileUrl(app.roblox_id)}) (ID ${app.roblox_id})` },
      { name: 'Alter', value: labelOf(AGE_GROUPS, app.age_group), inline: true },
      { name: 'Spielt', value: labelOf(FREQUENCIES, app.play_frequency), inline: true },
      { name: 'Geräte', value: devices, inline: true },
    )
    .setFooter({ text: `Discord-ID ${app.discord_id}` })
    .setTimestamp(app.created_at * 1000);
  if (created) {
    const createdUnix = Math.floor(new Date(created).getTime() / 1000);
    embed.addFields({ name: 'Roblox-Account erstellt', value: discordTime(createdUnix, 'D') + ` (${discordTime(createdUnix, 'R')})`, inline: true });
  }
  if (app.motivation) embed.addFields({ name: 'Motivation', value: app.motivation.slice(0, 1024) });
  if (warnings.length) embed.addFields({ name: '⚠️ Hinweise', value: warnings.join('\n') });
  if (headshotUrl) embed.setThumbnail(headshotUrl);
  return embed;
}

/** Klick auf „Bewerben“ */
async function handleStart(interaction, { store }) {
  if (!store.getSetting(SETTINGS.reviewChannel) || !store.getSetting(SETTINGS.testerRole)) {
    return interaction.reply(ephemeral('Bewerbungen sind noch nicht eingerichtet. Ein Admin muss zuerst `/setup einstellungen` ausführen.'));
  }
  if (store.getTester(interaction.user.id)) {
    return interaction.reply(ephemeral('Du bist schon Tester. 🎉'));
  }
  if (store.getPendingApplication(interaction.user.id)) {
    return interaction.reply(ephemeral('Deine Bewerbung wird gerade geprüft. Du bekommst eine Nachricht, sobald das Team entschieden hat.'));
  }
  return interaction.showModal(buildModal());
}

/** Formular wurde abgeschickt */
async function handleSubmit(interaction, { client, store }) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const userId = interaction.user.id;

  if (store.getTester(userId)) return interaction.editReply('Du bist schon Tester. 🎉');
  if (store.getPendingApplication(userId)) return interaction.editReply('Deine Bewerbung wird bereits geprüft.');

  const robloxName = interaction.fields.getTextInputValue('roblox_name').trim();
  const ageGroup = interaction.fields.getStringSelectValues('age_group')[0];
  const devices = interaction.fields.getStringSelectValues('devices');
  const frequency = interaction.fields.getStringSelectValues('frequency')[0];
  const motivation = interaction.fields.getTextInputValue('motivation')?.trim() || null;

  if (!roblox.isValidUsername(robloxName)) {
    return interaction.editReply(
      `„${robloxName}“ ist kein gültiger Roblox-Name (3–20 Zeichen, nur Buchstaben, Zahlen und _). Bitte bewirb dich nochmal.`,
    );
  }

  let robloxUser;
  try {
    robloxUser = await roblox.findUserByName(robloxName);
  } catch (err) {
    console.error('[bewerbung] Roblox-Abfrage fehlgeschlagen:', err);
    return interaction.editReply('Roblox ist gerade nicht erreichbar. Bitte versuch es in ein paar Minuten nochmal.');
  }
  if (!robloxUser) {
    return interaction.editReply(
      `Wir haben keinen Roblox-Account mit dem Namen **${robloxName}** gefunden. Achte auf den Benutzernamen (nicht den Anzeigenamen) und bewirb dich nochmal.`,
    );
  }

  const existing = store.getTesterByRobloxId(robloxUser.id);
  if (existing && existing.discord_id !== userId) {
    return interaction.editReply(
      `Der Roblox-Account **${robloxUser.name}** ist schon bei einem anderen Tester eingetragen. Wenn das dein Account ist, melde dich bitte beim Team.`,
    );
  }

  const reviewChannel = await settingChannel(client, store, SETTINGS.reviewChannel);
  if (!reviewChannel) {
    return interaction.editReply('Der Bewerbungs-Kanal ist nicht erreichbar. Bitte sag dem Team Bescheid.');
  }

  const applicationId = store.createApplication({
    discordId: userId,
    robloxId: robloxUser.id,
    robloxName: robloxUser.name,
    ageGroup,
    devices: devices.join(','),
    playFrequency: frequency,
    motivation,
  });
  const app = store.getApplication(applicationId);

  const [details, headshotUrl] = await Promise.all([
    roblox.getUserDetails(robloxUser.id),
    roblox.getHeadshotUrl(robloxUser.id),
  ]);
  const warnings = [];
  if (details?.created) {
    const ageDays = (Date.now() - new Date(details.created).getTime()) / 86400000;
    if (ageDays < 30) warnings.push(`Roblox-Account ist erst ${Math.floor(ageDays)} Tage alt.`);
  }

  try {
    const message = await reviewChannel.send({
      embeds: [buildReviewEmbed(app, { headshotUrl, created: details?.created, warnings })],
      components: [reviewButtons(applicationId)],
      allowedMentions: { parse: [] },
    });
    store.setApplicationReviewMessage(applicationId, message.channelId, message.id);
  } catch (err) {
    console.error('[bewerbung] Konnte Bewerbung nicht posten:', err);
    store.decideApplication(applicationId, 'error', client.user.id, 'Konnte nicht gepostet werden');
    return interaction.editReply('Beim Absenden ist etwas schiefgelaufen. Bitte sag dem Team Bescheid.');
  }

  return interaction.editReply(
    `✅ Deine Bewerbung mit dem Roblox-Account **${robloxUser.name}** ist angekommen! Du bekommst eine Nachricht, sobald das Team entschieden hat.`,
  );
}

function decidedEmbed(message, { color, text }) {
  const base = message.embeds[0] ? EmbedBuilder.from(message.embeds[0]) : new EmbedBuilder();
  return base.setColor(color).addFields({ name: 'Entscheidung', value: text });
}

/** Team klickt „Annehmen“ */
async function handleAccept(interaction, { client, store }, applicationId) {
  if (!isStaff(interaction.member, store)) return interaction.reply(ephemeral('Nur das Team kann Bewerbungen bearbeiten.'));
  const app = store.getApplication(applicationId);
  if (!app) return interaction.reply(ephemeral('Bewerbung nicht gefunden.'));
  if (app.status !== 'pending') return interaction.reply(ephemeral('Diese Bewerbung wurde schon bearbeitet.'));

  const taken = store.getTesterByRobloxId(app.roblox_id);
  if (taken && taken.discord_id !== app.discord_id) {
    return interaction.reply(
      ephemeral(`Der Roblox-Account ist inzwischen bei <@${taken.discord_id}> eingetragen. Bitte ablehnen oder klären.`),
    );
  }

  await interaction.deferUpdate();
  if (!store.decideApplication(app.id, 'accepted', interaction.user.id)) {
    return interaction.followUp(ephemeral('Diese Bewerbung wurde gerade schon von jemand anderem bearbeitet.'));
  }

  const notes = [];
  const roleId = store.getSetting(SETTINGS.testerRole);
  const member = await fetchMember(interaction.guild, app.discord_id);
  if (!member) {
    notes.push('Die Person ist nicht mehr auf dem Server. Sie wurde trotzdem als Tester gespeichert.');
  } else if (roleId) {
    try {
      await member.roles.add(roleId, `Tester-Bewerbung #${app.id} angenommen`);
    } catch {
      notes.push('Rolle konnte nicht vergeben werden. Ist die Bot-Rolle über der Tester-Rolle?');
    }
  }
  store.addTester({ discordId: app.discord_id, robloxId: app.roblox_id, robloxName: app.roblox_name, applicationId: app.id });

  const dmOk = await safeDm(client, app.discord_id, {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('🎉 Du bist jetzt Wonder-Wars-Tester!')
        .setDescription(
          [
            `Deine Bewerbung mit dem Roblox-Account **${app.roblox_name}** wurde angenommen.`,
            '',
            '• Playtest-Termine findest du im Ankündigungs-Kanal. Melde dich dort mit „Ich bin dabei“ an.',
            '• Fehler gefunden? Melde ihn mit `/bug`.',
            '• Deine Spielzeit wird automatisch über deinen Roblox-Account gezählt. Mit `/profil` siehst du deine Werte.',
            '',
            'Viel Spaß beim Testen!',
          ].join('\n'),
        ),
    ],
  });
  if (!dmOk) notes.push('DM konnte nicht zugestellt werden (DMs blockiert).');

  const text = [`✅ Angenommen von <@${interaction.user.id}>`, ...notes.map((n) => `⚠️ ${n}`)].join('\n');
  return interaction.editReply({ embeds: [decidedEmbed(interaction.message, { color: COLORS.success, text })], components: [] });
}

/** Team klickt „Ablehnen“ → Formular für den Grund */
async function handleRejectButton(interaction, { store }, applicationId) {
  if (!isStaff(interaction.member, store)) return interaction.reply(ephemeral('Nur das Team kann Bewerbungen bearbeiten.'));
  const app = store.getApplication(applicationId);
  if (!app || app.status !== 'pending') return interaction.reply(ephemeral('Diese Bewerbung wurde schon bearbeitet.'));
  const modal = new ModalBuilder()
    .setCustomId(`app:rejectreason:${applicationId}`)
    .setTitle(`Bewerbung #${applicationId} ablehnen`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Grund (optional)')
        .setDescription('Wird der Person per Nachricht geschickt.')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false),
        ),
    );
  return interaction.showModal(modal);
}

async function handleRejectSubmit(interaction, { client, store }, applicationId) {
  if (!isStaff(interaction.member, store)) return interaction.reply(ephemeral('Nur das Team kann Bewerbungen bearbeiten.'));
  const reason = interaction.fields.getTextInputValue('reason')?.trim() || null;
  const app = store.getApplication(applicationId);
  if (!app || !store.decideApplication(applicationId, 'rejected', interaction.user.id, reason)) {
    return interaction.reply(ephemeral('Diese Bewerbung wurde schon bearbeitet.'));
  }
  await interaction.deferUpdate();

  const dmOk = await safeDm(client, app.discord_id, {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setTitle('Deine Tester-Bewerbung')
        .setDescription(
          [
            'Danke für deine Bewerbung! Leider können wir dich gerade nicht als Tester aufnehmen.',
            reason ? `\n**Grund:** ${reason}` : '',
            '\nDu kannst dich später gerne nochmal bewerben.',
          ].join(''),
        ),
    ],
  });

  const lines = [`✖️ Abgelehnt von <@${interaction.user.id}>`];
  if (reason) lines.push(`Grund: ${reason}`);
  if (!dmOk) lines.push('⚠️ DM konnte nicht zugestellt werden.');
  return interaction.editReply({
    embeds: [decidedEmbed(interaction.message, { color: COLORS.danger, text: lines.join('\n') })],
    components: [],
  });
}

module.exports = {
  buildPanel,
  buildModal,
  handleStart,
  handleSubmit,
  handleAccept,
  handleRejectButton,
  handleRejectSubmit,
  AGE_GROUPS,
  DEVICES,
};
