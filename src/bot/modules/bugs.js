// Modul "bugs" (Bot-Teil B): /bug-Formular, Bug-Post mit Thread, Team-Status-Buttons, Punkte für echte Bugs.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { COLORS, EPHEMERAL, cid, embed, mentionUser, parseCid, replyEphemeral, tr } from '../util.js';
import { truncate } from '../../core/util.js';
import { BUG_ACTIONS, BUG_STATUSES } from '../lib/b-logic.js';
import * as store from '../lib/b-store.js';
import { NO_MENTIONS, composePublic, dmUser, editMessage, hasAnyRole, publicLabel } from '../lib/b-discord.js';

const LOC = (en) => ({ 'en-US': en, 'en-GB': en });

export const T = {
  de: {
    modalTitle: 'Bug melden',
    fTitle: 'Kurzer Titel',
    fTitlePh: 'z. B. „Turm-Blöcke verschwinden nach Respawn“',
    fDescription: 'Was ist passiert?',
    fSteps: 'Wie kann man es nachstellen?',
    fStepsPh: '1. … 2. … 3. …',
    fDevice: 'Gerät / Plattform',
    fDevicePh: 'PC, Handy, Tablet, Xbox …',
    needRole: 'Bugs melden können Tester und Creator. Werde Tester in {channel}.',
    thanks: '🐞 Danke! Bug #{id} ist gemeldet{where}. Du bekommst eine Nachricht, sobald das Team ihn prüft.',
    whereLink: ': {url}',
    noChannel: ' (der Kanal #bug-meldungen fehlt noch – das Team sieht ihn trotzdem)',
    errTitle: 'Bitte einen kurzen Titel und eine Beschreibung angeben.',
    notStaff: 'Den Status ändern kann nur das Team.',
    notFound: 'Diesen Bug gibt es nicht mehr.',
    unchanged: 'Der Bug hat diesen Status schon.',
    fieldSteps: 'Schritte',
    fieldDevice: 'Gerät',
    fieldReporter: 'Gemeldet von',
    fieldStatus: 'Status',
    status_neu: '🆕 Neu',
    status_bestaetigt: '✅ Bestätigt',
    status_duplikat: '♻️ Duplikat',
    status_kein_bug: '🚫 Kein Bug',
    status_behoben: '🛠️ Behoben',
    btn_confirm: 'Bestätigt',
    btn_dup: 'Duplikat',
    btn_notbug: 'Kein Bug',
    btn_fixed: 'Behoben',
    threadNote: 'Status: {status} (von {staff})',
    dmStatus: '🐞 Dein Bug #{id} „{title}“ hat jetzt den Status: {status}.{points}',
    dmPoints: ' Danke – dafür gibt es +{n} Punkte!',
    threadName: 'Bug #{id}: {title}',
  },
  en: {
    modalTitle: 'Report a bug',
    fTitle: 'Short title',
    fTitlePh: 'e.g. “Tower blocks disappear after respawn”',
    fDescription: 'What happened?',
    fSteps: 'How can we reproduce it?',
    fStepsPh: '1. … 2. … 3. …',
    fDevice: 'Device / platform',
    fDevicePh: 'PC, phone, tablet, Xbox …',
    needRole: 'Testers and creators can report bugs. Become a tester in {channel}.',
    thanks: '🐞 Thanks! Bug #{id} has been reported{where}. You will get a message once the team reviews it.',
    whereLink: ': {url}',
    noChannel: ' (the #bug-meldungen channel is missing – the team still sees it)',
    errTitle: 'Please enter a short title and a description.',
    notStaff: 'Only the team can change the status.',
    notFound: 'This bug no longer exists.',
    unchanged: 'The bug already has this status.',
    fieldSteps: 'Steps',
    fieldDevice: 'Device',
    fieldReporter: 'Reported by',
    fieldStatus: 'Status',
    status_neu: '🆕 New',
    status_bestaetigt: '✅ Confirmed',
    status_duplikat: '♻️ Duplicate',
    status_kein_bug: '🚫 Not a bug',
    status_behoben: '🛠️ Fixed',
    btn_confirm: 'Confirmed',
    btn_dup: 'Duplicate',
    btn_notbug: 'Not a bug',
    btn_fixed: 'Fixed',
    threadNote: 'Status: {status} (by {staff})',
    dmStatus: '🐞 Your bug #{id} “{title}” now has the status: {status}.{points}',
    dmPoints: ' Thanks – that is worth +{n} points!',
    threadName: 'Bug #{id}: {title}',
  },
};

const STATUS_COLOR = {
  neu: COLORS.warning,
  bestaetigt: COLORS.danger,
  duplikat: COLORS.primary,
  kein_bug: COLORS.primary,
  behoben: COLORS.success,
};

const statusText = (status) => publicLabel(T, `status_${status}`);

/** Embed + team buttons for a bug report. */
export function buildBugMessage(bug) {
  const fields = [];
  if (bug.steps) fields.push({ name: publicLabel(T, 'fieldSteps'), value: truncate(bug.steps, 1024) });
  if (bug.device) fields.push({ name: publicLabel(T, 'fieldDevice'), value: truncate(bug.device, 1024), inline: true });
  fields.push({ name: publicLabel(T, 'fieldReporter'), value: mentionUser(bug.discord_user_id), inline: true });
  fields.push({ name: publicLabel(T, 'fieldStatus'), value: statusText(bug.status), inline: true });
  const e = embed({
    title: truncate(`🐞 Bug #${bug.id}: ${bug.title}`, 256),
    description: bug.description || '–',
    color: STATUS_COLOR[bug.status] ?? COLORS.warning,
    fields,
    footer: `Bug #${bug.id}`,
    timestamp: bug.created_at,
  });
  const row = new ActionRowBuilder().addComponents(
    ...Object.entries({ confirm: ButtonStyle.Success, dup: ButtonStyle.Secondary, notbug: ButtonStyle.Danger, fixed: ButtonStyle.Primary }).map(
      ([action, style]) =>
        new ButtonBuilder()
          .setCustomId(cid('bug', action, bug.id))
          .setLabel(publicLabel(T, `btn_${action}`))
          .setStyle(style)
          .setDisabled(bug.status === BUG_ACTIONS[action]),
    ),
  );
  return { embeds: [e], components: [row], allowedMentions: NO_MENTIONS };
}

export function buildBugModal(locale) {
  const input = (id, label, style, { required = false, max, placeholder } = {}) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required).setMaxLength(max);
    if (placeholder) t.setPlaceholder(placeholder.slice(0, 100));
    return new ActionRowBuilder().addComponents(t);
  };
  return new ModalBuilder()
    .setCustomId(cid('bug', 'submit'))
    .setTitle(tr(T, locale, 'modalTitle'))
    .addComponents(
      input('title', tr(T, locale, 'fTitle'), TextInputStyle.Short, { required: true, max: 100, placeholder: tr(T, locale, 'fTitlePh') }),
      input('description', tr(T, locale, 'fDescription'), TextInputStyle.Paragraph, { required: true, max: 1500 }),
      input('steps', tr(T, locale, 'fSteps'), TextInputStyle.Paragraph, { max: 1000, placeholder: tr(T, locale, 'fStepsPh') }),
      input('device', tr(T, locale, 'fDevice'), TextInputStyle.Short, { max: 100, placeholder: tr(T, locale, 'fDevicePh') }),
    );
}

/**
 * Changes a bug status and updates Discord (message, thread note, DM to the reporter).
 * `interaction` (button) is updated in place; otherwise the stored message is edited.
 */
export async function updateBugStatusFlow(ctx, id, status, reviewerId = null, { interaction = null } = {}) {
  if (!BUG_STATUSES.includes(status)) {
    const err = new Error(`Unbekannter Status: ${status}`);
    err.status = 400;
    throw err;
  }
  const res = store.applyBugStatus(id, status, reviewerId);
  if (!res) return null;
  if (!res.changed) {
    if (interaction) await replyEphemeral(interaction, tr(T, interaction.locale, 'unchanged'));
    return res.bug;
  }
  const bug = res.bug;
  const payload = buildBugMessage(bug);
  if (interaction) await interaction.update(payload);
  else await editMessage(ctx, bug.channel_id, bug.message_id, payload);
  if (bug.thread_id && ctx.client) {
    try {
      const thread = await ctx.client.channels.fetch(bug.thread_id);
      await thread?.send({
        content: composePublic((lang) => tr(T, lang, 'threadNote', { status: tr(T, lang, `status_${status}`), staff: reviewerId ? mentionUser(reviewerId) : 'Dashboard' })),
        allowedMentions: NO_MENTIONS,
      });
    } catch (err) {
      ctx.log.debug(`Thread-Notiz für Bug #${bug.id} fehlgeschlagen: ${err.message}`);
    }
  }
  await dmUser(ctx, bug.discord_user_id, {
    content: composePublic((lang) =>
      tr(T, lang, 'dmStatus', {
        id: bug.id,
        title: bug.title,
        status: tr(T, lang, `status_${status}`),
        points: res.pointsAwarded ? tr(T, lang, 'dmPoints', { n: res.pointsAwarded }) : '',
      }),
    ),
    allowedMentions: NO_MENTIONS,
  });
  return bug;
}

/** Saves a bug report and posts it in #bug-meldungen with a thread. Returns { bug, message }. */
export async function reportBug(ctx, { userId, title, description, steps, device }) {
  const bug = store.insertBug({ userId, title, description, steps, device });
  const message = await ctx.post('bugs', buildBugMessage(bug));
  if (!message) {
    await ctx.postLog(`🐞 Neuer Bug #${bug.id} von <@${userId}>: ${title} (Kanal #bug-meldungen fehlt – bitte /setup)`);
    return { bug, message: null };
  }
  let threadId = null;
  try {
    const thread = await message.startThread({
      name: truncate(tr(T, 'de', 'threadName', { id: bug.id, title }), 100),
      autoArchiveDuration: 4320,
    });
    threadId = thread?.id ?? null;
  } catch (err) {
    ctx.log.debug(`Thread für Bug #${bug.id} nicht möglich: ${err.message}`);
  }
  const saved = store.updateBug(bug.id, { channel_id: message.channelId, message_id: message.id, thread_id: threadId });
  return { bug: saved, message };
}

const bugCommand = new SlashCommandBuilder()
  .setName('bug')
  .setDescription('Einen Bug im Spiel melden')
  .setDescriptionLocalizations(LOC('Report a bug in the game'));

export default {
  name: 'bugs',
  commands: [bugCommand],
  commandHandlers: {
    async bug(interaction, ctx) {
      const member = interaction.member;
      if (!ctx.isStaff(member) && !hasAnyRole(ctx, member, ['tester', 'creator'])) {
        const channel = ctx.channelId('testerJoin') ? `<#${ctx.channelId('testerJoin')}>` : '#tester-werden';
        return replyEphemeral(interaction, tr(T, interaction.locale, 'needRole', { channel }));
      }
      return interaction.showModal(buildBugModal(interaction.locale));
    },
  },
  buttons: {
    async bug(interaction, ctx) {
      const { action, args } = parseCid(interaction.customId);
      const status = BUG_ACTIONS[action];
      if (!status) return null;
      if (!ctx.isStaff(interaction.member)) return replyEphemeral(interaction, tr(T, interaction.locale, 'notStaff'));
      const bug = await updateBugStatusFlow(ctx, Number(args[0]), status, interaction.user.id, { interaction });
      if (!bug) return replyEphemeral(interaction, tr(T, interaction.locale, 'notFound'));
      return null;
    },
  },
  modals: {
    async bug(interaction, ctx) {
      const { action } = parseCid(interaction.customId);
      if (action !== 'submit') return null;
      const locale = interaction.locale;
      const get = (id) => {
        try {
          return String(interaction.fields.getTextInputValue(id) || '').trim();
        } catch {
          return '';
        }
      };
      const title = get('title').slice(0, 100);
      const description = get('description').slice(0, 1500);
      if (!title || !description) return replyEphemeral(interaction, tr(T, locale, 'errTitle'));
      await interaction.deferReply({ flags: EPHEMERAL });
      const { bug, message } = await reportBug(ctx, {
        userId: interaction.user.id,
        title,
        description,
        steps: get('steps').slice(0, 1000) || null,
        device: get('device').slice(0, 100) || null,
      });
      const where = message?.url ? tr(T, locale, 'whereLink', { url: message.url }) : message ? '' : tr(T, locale, 'noChannel');
      return interaction.editReply(tr(T, locale, 'thanks', { id: bug.id, where }));
    },
  },
  events: {},
  jobs: [],
  async onReady(ctx) {
    ctx.provide('updateBugStatus', (id, status, reviewerId = null) => updateBugStatusFlow(ctx, Number(id), status, reviewerId));
  },
};
