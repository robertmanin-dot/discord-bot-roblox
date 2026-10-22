// /rangliste and the auto-updating panel in #rangliste.
import { SlashCommandBuilder } from 'discord.js';
import { getPoints, getRank, tierFor } from '../../core/points.js';
import { sha256 } from '../../core/util.js';
import { replyEphemeral, tr } from '../util.js';
import { enLoc } from '../lib/common.js';
import { leaderboardEmbed, leaderboardPanelPayload } from '../lib/leaderboard.js';

const T = {
  de: { you: 'Du: **{points} Punkte** · Platz {rank} · Stufe {tier}', youNone: 'Du hast hier noch keine Punkte.' },
  en: { you: 'You: **{points} points** · rank {rank} · tier {tier}', youNone: "You don't have points here yet." },
};

const command = new SlashCommandBuilder()
  .setName('rangliste')
  .setNameLocalizations(enLoc('leaderboard'))
  .setDescription('Zeigt die Rangliste der Creator oder Tester')
  .setDescriptionLocalizations(enLoc('Shows the creator or tester leaderboard'))
  .addStringOption((o) =>
    o
      .setName('typ')
      .setNameLocalizations(enLoc('type'))
      .setDescription('Creator oder Tester')
      .setDescriptionLocalizations(enLoc('Creator or tester'))
      .addChoices({ name: 'Creator', value: 'creator' }, { name: 'Tester', value: 'tester' }),
  );

async function onRangliste(interaction, ctx) {
  const kind = interaction.options.getString('typ') || 'creator';
  const lang = String(interaction.locale || '').startsWith('de') ? 'de' : 'en';
  const settings = ctx.settings();
  const e = leaderboardEmbed(kind, { lang, limit: 15, tiers: settings.tiers });
  const points = getPoints(interaction.user.id, kind);
  const you = points > 0
    ? tr(T, lang, 'you', { points, rank: getRank(interaction.user.id, kind) ?? '–', tier: tierFor(points).name })
    : tr(T, lang, 'youNone');
  return replyEphemeral(interaction, { content: you, embeds: [e], allowedMentions: { parse: [] } });
}

let lastHash = null;

/** Posts or edits the leaderboard panel. Skips the edit when nothing changed. */
export async function updateLeaderboardPanel(ctx, { force = false } = {}) {
  const settings = ctx.settings();
  const channelId = ctx.channelId('leaderboard');
  if (!channelId) return { skipped: 'not-setup' };
  const payload = leaderboardPanelPayload(settings);
  const hash = sha256(JSON.stringify(payload.embeds.map((e) => ({ ...e.toJSON(), timestamp: null }))));
  if (!force && hash === lastHash) return { skipped: 'unchanged' };
  const stored = settings.discord.messages?.leaderboard;
  const channel = await ctx.channel('leaderboard');
  if (!channel?.isTextBased?.()) return { skipped: 'no-channel' };
  if (stored?.messageId && stored.channelId === channel.id) {
    try {
      const msg = await channel.messages.fetch(stored.messageId);
      await msg.edit(payload);
      lastHash = hash;
      return { edited: true };
    } catch {
      // message deleted -> post a new one
    }
  }
  const msg = await channel.send(payload);
  ctx.updateSettings({ discord: { messages: { leaderboard: { channelId: channel.id, messageId: msg.id } } } });
  lastHash = hash;
  return { posted: true };
}

export function _resetLeaderboardHash() {
  lastHash = null;
}

export default {
  name: 'leaderboard',
  commands: [command],
  commandHandlers: { rangliste: onRangliste },
  buttons: {},
  selects: {},
  modals: {},
  events: {},
  jobs: [{ name: 'panel', everyMs: 10 * 60_000, initialDelayMs: 30_000, run: (ctx) => updateLeaderboardPanel(ctx) }],
  async onReady() {},
};
