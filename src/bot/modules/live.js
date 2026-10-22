// /live: creators announce their stream (#jetzt-live). Twitch streams of members are detected automatically.
import { SlashCommandBuilder } from 'discord.js';
import { env } from '../../core/config.js';
import { getDb } from '../../core/db.js';
import { findCreatorByDiscordId, logActivity, setOutreachStatus } from '../../core/creators.js';
import { addPoints } from '../../core/points.js';
import { parseProfileUrl, PLATFORM_LABELS } from '../../core/urls.js';
import { dayKey, nowIso } from '../../core/time.js';
import { COLORS, EPHEMERAL, cleanUrl, embed, publicText, replyEphemeral, tr } from '../util.js';
import { COMMON, channelMention, enLoc } from '../lib/common.js';
import { findRunningEvent, isProgramMember, livePointsPlan } from '../lib/rules.js';

const T = {
  de: {
    liveTitle: '🔴 {name} ist jetzt live!',
    liveBody: '{title}\n👉 {url}',
    duringEvent: '🎉 Beim Event **{event}** dabei',
    ok: '✅ Angekündigt in {channel}! {points}',
    pointsAdded: '+{points} Punkte.',
    noPoints: '(Punkte für heute schon erhalten.)',
    notMember: 'Das ist nur für Creator im Programm. Bewirb dich in {apply}.',
  },
  en: {
    liveTitle: '🔴 {name} is live now!',
    liveBody: '{title}\n👉 {url}',
    duringEvent: '🎉 Taking part in **{event}**',
    ok: '✅ Announced in {channel}! {points}',
    pointsAdded: '+{points} points.',
    noPoints: '(Points for today already received.)',
    notMember: 'This is only for creators in the program. Apply in {apply}.',
  },
};

const liveCommand = new SlashCommandBuilder()
  .setName('live')
  .setDescription('Sag Bescheid, dass du gerade live bist (Punkte!)')
  .setDescriptionLocalizations(enLoc("Let everyone know you're live (points!)"))
  .addStringOption((o) => o.setName('link').setDescription('Link zu deinem Stream').setDescriptionLocalizations(enLoc('Link to your stream')).setRequired(true).setMaxLength(300));

function platformOf(url) {
  const p = parseProfileUrl(url);
  if (p?.platform && p.platform !== 'discord') return p.platform;
  return 'andere';
}

/** Events that might be running now (recent or current). */
function candidateEvents() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  return getDb().all("SELECT * FROM events WHERE status IN ('geplant','laeuft') AND starts_at >= :since ORDER BY starts_at", { since });
}

/**
 * Records a live session, gives points (once per event / per day), posts in #jetzt-live.
 * Returns { sessionId, event, points } (points = 0 if already given).
 */
export async function announceLive(ctx, { userId, creatorId, displayName, url, title = null, platform = null, source = 'manual' }) {
  const db = getDb();
  const event = findRunningEvent(candidateEvents());
  const plat = platform || platformOf(url);
  const { lastInsertRowid: sessionId } = db.run(
    `INSERT INTO live_sessions (discord_user_id, creator_id, platform, url, title, event_id, source, started_at)
     VALUES (:userId, :creatorId, :platform, :url, :title, :eventId, :source, :now)`,
    { userId, creatorId, platform: plat, url, title, eventId: event?.id ?? null, source, now: nowIso() },
  );
  const plan = livePointsPlan({ event, day: dayKey(new Date()), points: ctx.settings().points });
  const added = userId && plan.points > 0 ? addPoints({ userId, kind: 'creator', points: plan.points, reason: plan.reason, ref: plan.ref }) : false;
  if (creatorId) {
    logActivity(creatorId, 'live', { url, platform: plat, eventId: event?.id ?? null, source });
    if (event?.kind === 'launch') setOutreachStatus(creatorId, 'live', { extra: { went_live_at: nowIso() } });
  }
  const name = displayName || (userId ? `<@${userId}>` : 'Creator');
  const lines = [publicText(T, 'liveBody', { title: title || PLATFORM_LABELS[plat] || 'Stream', url })];
  if (event) lines.push(publicText(T, 'duringEvent', { event: event.title }));
  await ctx.post('live', {
    content: userId ? `<@${userId}>` : undefined,
    embeds: [embed({ title: tr(T, ctx.settings().discord.serverLanguage === 'en' ? 'en' : 'de', 'liveTitle', { name }), description: lines.join('\n\n'), color: COLORS.live, url, timestamp: true })],
    allowedMentions: { parse: [] },
  });
  return { sessionId, event, points: added ? plan.points : 0 };
}

async function onLive(interaction, ctx) {
  const locale = interaction.locale;
  const creator = findCreatorByDiscordId(interaction.user.id);
  if (!isProgramMember(creator, interaction.member, ctx)) {
    return replyEphemeral(interaction, tr(T, locale, 'notMember', { apply: channelMention(ctx, 'apply', '#creator-bewerbung') }));
  }
  if (!ctx.channelId('live')) return replyEphemeral(interaction, tr(COMMON, locale, 'notSetup'));
  const url = cleanUrl(interaction.options.getString('link', true));
  if (!url) return replyEphemeral(interaction, tr(COMMON, locale, 'invalidUrl'));
  await interaction.deferReply({ flags: EPHEMERAL });
  const result = await announceLive(ctx, {
    userId: interaction.user.id,
    creatorId: creator?.id ?? null,
    displayName: creator?.display_name || interaction.member?.displayName || interaction.user.username,
    url,
  });
  const points = result.points > 0 ? tr(T, locale, 'pointsAdded', { points: result.points }) : tr(T, locale, 'noPoints');
  return interaction.editReply({ content: tr(T, locale, 'ok', { channel: channelMention(ctx, 'live', '#jetzt-live'), points }) });
}

let lastTwitchCheck = 0;

/** Job: checks Twitch for members who are live in Roblox and announces/ends sessions. */
export async function checkTwitchLive(ctx, { importTwitch = () => import('../../radar/twitch.js'), now = Date.now() } = {}) {
  const minutes = Number(ctx.settings().discord.twitchLiveCheckMinutes || 0);
  if (minutes <= 0) return { skipped: 'disabled' };
  if (now - lastTwitchCheck < minutes * 60_000 - 5_000) return { skipped: 'interval' };
  if (!env('TWITCH_CLIENT_ID') || !env('TWITCH_CLIENT_SECRET')) return { skipped: 'no-credentials' };
  if (!ctx.channelId('live')) return { skipped: 'not-setup' };
  let mod;
  try {
    mod = await importTwitch();
  } catch {
    return { skipped: 'no-module' };
  }
  if (typeof mod?.getStreamsByLogins !== 'function') return { skipped: 'no-function' };
  lastTwitchCheck = now;

  const db = getDb();
  const rows = db.all(
    `SELECT c.id AS creator_id, c.discord_user_id, c.display_name, a.handle
     FROM creators c JOIN accounts a ON a.creator_id = c.id AND a.platform = 'twitch'
     WHERE c.is_member = 1 AND c.discord_user_id IS NOT NULL AND a.handle IS NOT NULL`,
  );
  if (!rows.length) return { checked: 0, started: 0, ended: 0 };
  const streams = await mod.getStreamsByLogins(rows.map((r) => r.handle));
  const live = new Map((streams || []).filter((s) => /roblox/i.test(s.game_name || '')).map((s) => [String(s.user_login).toLowerCase(), s]));
  const open = new Map(
    db.all("SELECT * FROM live_sessions WHERE source = 'twitch' AND ended_at IS NULL").map((s) => [s.creator_id, s]),
  );
  let started = 0;
  let ended = 0;
  for (const r of rows) {
    const stream = live.get(String(r.handle).toLowerCase());
    const session = open.get(r.creator_id);
    if (stream && !session) {
      await announceLive(ctx, {
        userId: r.discord_user_id,
        creatorId: r.creator_id,
        displayName: r.display_name,
        url: stream.url || `https://www.twitch.tv/${r.handle}`,
        title: stream.title,
        platform: 'twitch',
        source: 'twitch',
      });
      started++;
    } else if (!stream && session) {
      db.run('UPDATE live_sessions SET ended_at = :now WHERE id = :id', { now: nowIso(), id: session.id });
      ended++;
    }
  }
  return { checked: rows.length, started, ended };
}

export function _resetTwitchTimer() {
  lastTwitchCheck = 0;
}

export default {
  name: 'live',
  commands: [liveCommand],
  commandHandlers: { live: onLive },
  buttons: {},
  selects: {},
  modals: {},
  events: {},
  jobs: [{ name: 'twitch-live', everyMs: 60_000, initialDelayMs: 20_000, run: (ctx) => checkTwitchLive(ctx) }],
  async onReady() {},
};
