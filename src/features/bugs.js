/**
 * Bug-Reports: /bug öffnet ein Formular, der Report landet als eigener Beitrag im Bug-Kanal
 * (Forum- oder Textkanal). Das Team setzt den Status per Button.
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { SETTINGS, COLORS, isStaff, settingChannel, fetchChannel, safeDm, ephemeral } = require('../discord-utils');
const { DEVICES } = require('./applications');

const STATUSES = {
  open: { label: 'Offen', emoji: '🟡', color: COLORS.warning },
  in_progress: { label: 'In Arbeit', emoji: '🔵', color: COLORS.info },
  fixed: { label: 'Behoben', emoji: '🟢', color: COLORS.success },
  invalid: { label: 'Kein Bug', emoji: '⚪', color: COLORS.neutral },
  duplicate: { label: 'Duplikat', emoji: '⚪', color: COLORS.neutral },
};

function buildModal() {
  return new ModalBuilder()
    .setCustomId('bug:submit')
    .setTitle('Bug melden')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Kurzer Titel')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('title')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(80)
            .setPlaceholder('z. B. Fällt durch den Boden in der Arena')
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Was ist passiert?')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('description').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Wie kann man es nachstellen? (optional)')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('steps')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setPlaceholder('1. Arena betreten\n2. In die Ecke springen\n3. …')
            .setRequired(false),
        ),
      new LabelBuilder()
        .setLabel('Gerät')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder().setCustomId('device').setPlaceholder('Auf welchem Gerät?').addOptions(DEVICES),
        ),
      new LabelBuilder()
        .setLabel('Screenshot oder Video (optional)')
        .setFileUploadComponent(new FileUploadBuilder().setCustomId('media').setMinValues(0).setMaxValues(3).setRequired(false)),
    );
}

function buildEmbed(bug, imageName = null) {
  const status = STATUSES[bug.status] ?? STATUSES.open;
  const embed = new EmbedBuilder()
    .setColor(status.color)
    .setTitle(`Bug #${bug.id}: ${bug.title}`)
    .setDescription(bug.description)
    .addFields(
      { name: 'Status', value: `${status.emoji} ${status.label}`, inline: true },
      { name: 'Gerät', value: DEVICES.find((d) => d.value === bug.device)?.label ?? '–', inline: true },
      { name: 'Gemeldet von', value: `<@${bug.discord_id}>`, inline: true },
    )
    .setTimestamp(bug.created_at * 1000);
  if (bug.steps) embed.addFields({ name: 'Nachstellen', value: bug.steps });
  if (imageName) embed.setImage(`attachment://${imageName}`);
  return embed;
}

function statusRow(bugId) {
  const button = (status, style) =>
    new ButtonBuilder()
      .setCustomId(`bug:status:${bugId}:${status}`)
      .setLabel(STATUSES[status].label)
      .setEmoji(STATUSES[status].emoji)
      .setStyle(style);
  return new ActionRowBuilder().addComponents(
    button('in_progress', ButtonStyle.Primary),
    button('fixed', ButtonStyle.Success),
    button('invalid', ButtonStyle.Secondary),
    button('duplicate', ButtonStyle.Secondary),
  );
}

function threadName(bug) {
  return `${(STATUSES[bug.status] ?? STATUSES.open).emoji} #${bug.id} ${bug.title}`.slice(0, 100);
}

/** /bug */
async function open(interaction, { store }) {
  if (!store.getSetting(SETTINGS.bugChannel)) {
    return interaction.reply(ephemeral('Bug-Reports sind noch nicht eingerichtet. Ein Admin muss `/setup einstellungen` ausführen.'));
  }
  if (!store.getTester(interaction.user.id) && !isStaff(interaction.member, store)) {
    return interaction.reply(ephemeral('Nur Tester können Bugs melden. Bewirb dich zuerst!'));
  }
  return interaction.showModal(buildModal());
}

/** Formular abgeschickt */
async function submit(interaction, { client, store }) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = await settingChannel(client, store, SETTINGS.bugChannel);
  if (!channel) return interaction.editReply('Der Bug-Kanal ist nicht erreichbar. Bitte sag dem Team Bescheid.');

  const id = store.createBug({
    discordId: interaction.user.id,
    title: interaction.fields.getTextInputValue('title').trim(),
    description: interaction.fields.getTextInputValue('description').trim(),
    steps: interaction.fields.getTextInputValue('steps')?.trim() || null,
    device: interaction.fields.getStringSelectValues('device')[0] ?? null,
  });
  const bug = store.getBug(id);

  const uploads = interaction.fields.getUploadedFiles('media') ?? new Map();
  const files = [...uploads.values()].map((a) => ({ attachment: a.url, name: a.name }));
  const firstImage = [...uploads.values()].find((a) => a.contentType?.startsWith('image/'));

  const payload = {
    embeds: [buildEmbed(bug, firstImage?.name)],
    components: [statusRow(id)],
    files,
    allowedMentions: { parse: [] },
  };

  try {
    let message;
    if (channel.type === ChannelType.GuildForum) {
      const thread = await channel.threads.create({ name: threadName(bug), message: payload });
      message = await thread.fetchStarterMessage();
      store.setBugMessage(id, thread.id, message.id);
    } else {
      message = await channel.send(payload);
      await message.startThread({ name: threadName(bug) }).catch(() => {});
      store.setBugMessage(id, channel.id, message.id);
    }
  } catch (err) {
    console.error('[bug] Konnte Report nicht posten:', err);
    store.setBugStatus(id, 'invalid');
    return interaction.editReply('Der Report konnte nicht gepostet werden. Bitte sag dem Team Bescheid.');
  }

  return interaction.editReply(`✅ Danke! Dein Bug-Report #${id} ist angekommen. Wir sagen dir Bescheid, wenn er behoben ist.`);
}

/** Team ändert den Status per Button */
async function setStatus(interaction, { client, store }, bugId, status) {
  if (!isStaff(interaction.member, store)) return interaction.reply(ephemeral('Nur das Team kann den Status ändern.'));
  if (!STATUSES[status]) return interaction.reply(ephemeral('Unbekannter Status.'));
  const bug = store.getBug(bugId);
  if (!bug) return interaction.reply(ephemeral('Bug nicht gefunden.'));

  await interaction.deferUpdate();
  const previous = bug.status;
  store.setBugStatus(bugId, status);
  const updated = store.getBug(bugId);

  const current = interaction.message.embeds[0];
  const embed = current ? EmbedBuilder.from(current) : buildEmbed(updated);
  const fields = (embed.data.fields ?? []).map((f) =>
    f.name === 'Status' ? { ...f, value: `${STATUSES[status].emoji} ${STATUSES[status].label}` } : f,
  );
  embed.setColor(STATUSES[status].color).setFields(fields);
  await interaction.editReply({ embeds: [embed], components: [statusRow(bugId)] });

  // Forum-Beitrag bzw. Thread umbenennen, damit der Status in der Übersicht sichtbar ist
  const thread = interaction.channel?.isThread?.()
    ? interaction.channel
    : interaction.message.thread ?? (await fetchChannel(client, updated.channel_id));
  if (thread?.isThread?.()) thread.setName(threadName(updated)).catch(() => {});

  if (status === 'fixed' && previous !== 'fixed') {
    await safeDm(client, bug.discord_id, {
      content: `🟢 Dein Bug-Report **#${bug.id}: ${bug.title}** wurde als behoben markiert. Danke fürs Melden!`,
    });
  }
}

module.exports = { open, submit, setStatus, buildModal, STATUSES };
