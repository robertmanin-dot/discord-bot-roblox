// Modul "events" (Bot-Teil B): Launch Hour & wöchentliche Creator-Events mit Ankündigung,
// Erinnerungen (24 h / 1 h / 10 min), Live-Spielerzahl aus Roblox und Zusammenfassung.
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { COLORS, EPHEMERAL, embed, mentionRole, mentionUser, replyEphemeral, tr, chunkText } from '../util.js';
import { addDays, addMinutes, discordTs, formatDate, formatTime, toDate } from '../../core/time.js';
import { truncate } from '../../core/util.js';
import {
  ValidationError,
  ccuStats,
  eventEnd,
  eventPlan,
  fetchCcu,
  inCcuWindow,
  nextWeekly,
  parseEventInput,
} from '../lib/b-logic.js';
import * as store from '../lib/b-store.js';
import {
  NO_MENTIONS,
  composePublic,
  createScheduledEvent,
  deleteScheduledEvent,
  editMessage,
  primaryLang,
  publicLabel,
  roleMentions,
  setScheduledEventStatus,
} from '../lib/b-discord.js';
import { getDb } from '../../core/db.js';

const LOC = (en) => ({ 'en-US': en, 'en-GB': en });

export const T = {
  de: {
    titleLaunch: '🚀 Launch Hour: {title}',
    titleEvent: '🎮 Creator-Event: {title}',
    when: '📅 {full} ({rel})',
    duration: '⏱️ {min} Minuten',
    link: '🔗 Spiel: {link}',
    weekly: '🔁 Jede Woche zur gleichen Zeit',
    callLaunch: 'Alle Creator gehen **gleichzeitig live** und spielen mit ihren Zuschauern. Code und Link stehen im Creator-Kit. Sag mit /live Bescheid, wenn du streamst!',
    callEvent: 'Geh zur Startzeit live und spiel mit deiner Community. Sag mit /live Bescheid, dann zeigen wir dich in #jetzt-live.',
    statusCancelled: '❌ Abgesagt',
    statusDone: '✅ Vorbei – danke an alle!',
    remind24h: '⏰ **Morgen:** {title} – {full} ({rel}). Plant euren Stream: Titel mit Spielname + Code, Link aus dem Creator-Kit.',
    remind1h: '⏳ **In 1 Stunde:** {title} ({rel}). Stream vorbereiten!',
    remind10m: '🔔 **In 10 Minuten geht’s los:** {title}! Stream starten und Spiel öffnen: {link}',
    start: '🔴 **JETZT LIVE GEHEN!** {title} läuft – {link}\nSag mit /live Bescheid, dann zeigen wir dich in #jetzt-live.',
    ccuLine: '🎮 **{title}** – Spieler gerade: **{n}** · Peak: **{peak}** · Stand {rel}',
    cancelPost: '❌ **{title}** ({full}) wurde abgesagt.{reason}',
    reasonLine: ' Grund: {reason}',
    nextPost: '🔁 Nächster Termin steht: **{title}** am {full}.',
    summaryTitle: '📊 Zusammenfassung: {title}',
    sumPeak: 'Spieler-Peak',
    sumAvg: 'Ø Spieler (während des Events)',
    sumLive: 'Live-Creator',
    sumNew: 'Neue Creator (7 Tage)',
    sumTotal: 'Creator gesamt',
    sumNoCcu: 'keine Daten (Roblox-Spiel im Dashboard verknüpfen)',
    sumNobody: 'niemand gemeldet',
    sumFooter: 'Messpunkte: {n}',
    // replies
    notStaff: 'Das darf nur das Team.',
    created: '✅ Event #{id} angelegt: **{title}** – {full}. {posted}',
    postedIn: 'Angekündigt in {channel}.',
    noChannel: '⚠️ Kanal #launch-und-events fehlt – bitte /setup ausführen.',
    listTitle: '**Events**',
    listLine: '`#{id}` {icon} **{title}** – {full} · {status}{weekly}',
    listEmpty: 'Keine Events geplant.',
    status_geplant: 'geplant',
    status_laeuft: 'läuft',
    status_beendet: 'beendet',
    status_abgesagt: 'abgesagt',
    weeklyShort: ' · 🔁 wöchentlich',
    notFound: 'Dieses Event gibt es nicht.',
    alreadyOver: 'Dieses Event ist schon vorbei oder abgesagt.',
    cancelled: '❌ Event #{id} abgesagt.{weekly}',
    cancelledWeekly: ' Die wöchentliche Serie endet damit.',
    errTitle: 'Bitte einen Titel angeben (max. 100 Zeichen).',
    errDate: 'Datum/Uhrzeit nicht erkannt. Beispiel: datum 21.11.2026, uhrzeit 19:00',
    errPast: 'Der Termin liegt in der Vergangenheit.',
    errDuration: 'Die Dauer muss zwischen 10 und 600 Minuten liegen.',
    errLink: 'Der Link ist ungültig (bitte mit https://).',
    errKind: 'Typ muss „launch“ oder „event“ sein.',
  },
  en: {
    titleLaunch: '🚀 Launch Hour: {title}',
    titleEvent: '🎮 Creator event: {title}',
    when: '📅 {full} ({rel})',
    duration: '⏱️ {min} minutes',
    link: '🔗 Game: {link}',
    weekly: '🔁 Every week at the same time',
    callLaunch: 'All creators go **live at the same time** and play with their viewers. Code and link are in the creator kit. Use /live to let us know you are streaming!',
    callEvent: 'Go live at the start time and play with your community. Use /live and we will show you in #jetzt-live.',
    statusCancelled: '❌ Cancelled',
    statusDone: '✅ Over – thanks everyone!',
    remind24h: '⏰ **Tomorrow:** {title} – {full} ({rel}). Plan your stream: title with game name + code, link from the creator kit.',
    remind1h: '⏳ **In 1 hour:** {title} ({rel}). Get your stream ready!',
    remind10m: '🔔 **Starting in 10 minutes:** {title}! Start your stream and open the game: {link}',
    start: '🔴 **GO LIVE NOW!** {title} is on – {link}\nUse /live and we will show you in #jetzt-live.',
    ccuLine: '🎮 **{title}** – players right now: **{n}** · peak: **{peak}** · updated {rel}',
    cancelPost: '❌ **{title}** ({full}) has been cancelled.{reason}',
    reasonLine: ' Reason: {reason}',
    nextPost: '🔁 Next date is set: **{title}** on {full}.',
    summaryTitle: '📊 Summary: {title}',
    sumPeak: 'Player peak',
    sumAvg: 'Avg players (during the event)',
    sumLive: 'Live creators',
    sumNew: 'New creators (7 days)',
    sumTotal: 'Creators total',
    sumNoCcu: 'no data (link the Roblox game in the dashboard)',
    sumNobody: 'nobody reported',
    sumFooter: 'Data points: {n}',
    notStaff: 'Only the team can do that.',
    created: '✅ Event #{id} created: **{title}** – {full}. {posted}',
    postedIn: 'Announced in {channel}.',
    noChannel: '⚠️ Channel #launch-und-events is missing – please run /setup.',
    listTitle: '**Events**',
    listLine: '`#{id}` {icon} **{title}** – {full} · {status}{weekly}',
    listEmpty: 'No events planned.',
    status_geplant: 'planned',
    status_laeuft: 'running',
    status_beendet: 'finished',
    status_abgesagt: 'cancelled',
    weeklyShort: ' · 🔁 weekly',
    notFound: 'This event does not exist.',
    alreadyOver: 'This event is already over or cancelled.',
    cancelled: '❌ Event #{id} cancelled.{weekly}',
    cancelledWeekly: ' This also ends the weekly series.',
    errTitle: 'Please enter a title (max. 100 characters).',
    errDate: 'Date/time not recognised. Example: date 21.11.2026, time 19:00',
    errPast: 'That date is in the past.',
    errDuration: 'Duration must be between 10 and 600 minutes.',
    errLink: 'The link is invalid (please use https://).',
    errKind: 'Type must be “launch” or “event”.',
  },
};

// Module state (reset in tests): last Roblox request time.
export const ccuState = { lastAt: 0 };

const fullTime = (iso) => discordTs(iso, 'F');
const relTime = (iso) => discordTs(iso, 'R');
const channelMention = (ctx, key, fallback) => (ctx.channelId(key) ? `<#${ctx.channelId(key)}>` : fallback);

function creatorPing(ctx) {
  const roleId = ctx.roleId('creator');
  if (!roleId || ctx.settings().discord?.pingRoleOnEvents === false) return { prefix: '', allowedMentions: NO_MENTIONS };
  return { prefix: `${mentionRole(roleId)} `, allowedMentions: roleMentions(roleId) };
}

/** Announcement embed for #launch-und-events. */
export function buildEventEmbed(e) {
  const titleKey = e.kind === 'launch' ? 'titleLaunch' : 'titleEvent';
  const info = composePublic((lang) => {
    const lines = [tr(T, lang, 'when', { full: fullTime(e.starts_at), rel: relTime(e.starts_at) }), tr(T, lang, 'duration', { min: e.duration_min })];
    if (e.game_link) lines.push(tr(T, lang, 'link', { link: e.game_link }));
    if (e.repeat_weekly) lines.push(tr(T, lang, 'weekly'));
    if (e.status === 'abgesagt') lines.push('', tr(T, lang, 'statusCancelled'));
    else if (e.status === 'beendet') lines.push('', tr(T, lang, 'statusDone'));
    else lines.push('', tr(T, lang, e.kind === 'launch' ? 'callLaunch' : 'callEvent'));
    return lines.join('\n');
  });
  return embed({
    title: truncate(tr(T, primaryLang(), titleKey, { title: e.title }), 256),
    description: (e.description ? `${e.description}\n\n` : '') + info,
    color: e.status === 'abgesagt' ? COLORS.danger : e.kind === 'launch' ? COLORS.gold : COLORS.primary,
    url: e.game_link || undefined,
    footer: `Event #${e.id}`,
  });
}

async function announceEvent(ctx, e, { ping: withPing = true } = {}) {
  const ping = withPing ? creatorPing(ctx) : { prefix: '', allowedMentions: NO_MENTIONS };
  const msg = await ctx.post('launch', { content: ping.prefix.trim() || undefined, embeds: [buildEventEmbed(e)], allowedMentions: ping.allowedMentions });
  if (msg) store.updateEvent(e.id, { channel_id: msg.channelId, message_id: msg.id });
  const eventId = await createScheduledEvent(ctx, {
    name: `${e.kind === 'launch' ? '🚀 Launch Hour' : '🎮 Creator-Event'}: ${e.title}`,
    start: e.starts_at,
    end: eventEnd(e),
    description: e.description || '',
    location: e.game_link || 'Roblox',
  });
  if (eventId) store.updateEvent(e.id, { discord_event_id: eventId });
  return Boolean(msg);
}

async function refreshEventMessage(ctx, id) {
  const e = store.getEvent(id);
  if (!e?.channel_id || !e?.message_id) return false;
  return editMessage(ctx, e.channel_id, e.message_id, { embeds: [buildEventEmbed(e)], allowedMentions: NO_MENTIONS });
}

/** Creates and announces an event. Returns { event, posted }. */
export async function createEventFlow(ctx, data, createdBy = null) {
  const e = store.insertEvent(data, createdBy);
  const posted = await announceEvent(ctx, e);
  if (data.kind === 'launch' && !ctx.settings().game?.launchAt) {
    // First launch event fills the launch date for the outreach templates.
    ctx.updateSettings({ game: { launchAt: e.starts_at } });
  }
  return { event: store.getEvent(e.id), posted };
}

async function postReminder(ctx, e, key) {
  const ping = creatorPing(ctx);
  const vars = { title: e.title, full: fullTime(e.starts_at), rel: relTime(e.starts_at), link: e.game_link || 'Roblox' };
  return ctx.post('launch', { content: ping.prefix + composePublic((lang) => tr(T, lang, key, vars)), allowedMentions: ping.allowedMentions });
}

/** Summary embed: player peak/average, who was live, new creators. */
export function buildSummaryEmbed(e, { hasUniverse = true } = {}) {
  const end = eventEnd(e);
  const samples = store.listCcuSamples(e.id);
  const all = ccuStats(samples);
  const during = ccuStats(samples, { from: e.starts_at, to: end });
  const sessions = store.liveSessionsInWindow(e.starts_at, end.toISOString());
  const seen = new Set();
  const names = [];
  for (const s of sessions) {
    const key = s.creator_id ? `c${s.creator_id}` : `u${s.discord_user_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(s.display_name || (s.discord_user_id ? mentionUser(s.discord_user_id) : s.url || '?'));
  }
  const newMembers = store.acceptedApplicationsBetween(addDays(e.starts_at, -7).toISOString(), addMinutes(end, 30).toISOString());
  const noData = composePublic((lang) => tr(T, lang, 'sumNoCcu'));
  const liveValue = names.length
    ? `${names.length}: ${truncate(names.slice(0, 25).join(', '), 1000)}`
    : composePublic((lang) => tr(T, lang, 'sumNobody'));
  return embed({
    title: truncate(tr(T, primaryLang(), 'summaryTitle', { title: e.title }), 256),
    color: COLORS.info,
    fields: [
      { name: publicLabel(T, 'sumPeak'), value: hasUniverse && all.count ? String(all.peak) : noData, inline: true },
      { name: publicLabel(T, 'sumAvg'), value: hasUniverse && during.count ? String(during.avg) : '–', inline: true },
      { name: publicLabel(T, 'sumLive'), value: liveValue },
      { name: publicLabel(T, 'sumNew'), value: String(newMembers), inline: true },
      { name: publicLabel(T, 'sumTotal'), value: String(store.memberCount()), inline: true },
    ],
    footer: publicLabel(T, 'sumFooter', { n: all.count }),
    timestamp: true,
  });
}

async function createNextOccurrence(ctx, e, now) {
  const exists = getDb().get('SELECT id FROM events WHERE parent_event_id = :id', { id: e.id });
  if (exists) return null;
  const tz = ctx.settings().game?.timezone || 'Europe/Berlin';
  const next = nextWeekly(e.starts_at, tz, now);
  const created = store.insertEvent(
    {
      kind: e.kind,
      title: e.title,
      description: e.description,
      starts_at: next.toISOString(),
      duration_min: e.duration_min,
      repeat_weekly: 1,
      game_link: e.game_link,
      parent_event_id: e.id,
    },
    e.created_by,
    now,
  );
  await announceEvent(ctx, created, { ping: false });
  return store.getEvent(created.id);
}

async function performEventAction(ctx, e, action, now) {
  switch (action) {
    case 'remind24h':
      await postReminder(ctx, e, 'remind24h');
      break;
    case 'remind1h':
      await postReminder(ctx, e, 'remind1h');
      break;
    case 'remind10m':
      await postReminder(ctx, e, 'remind10m');
      break;
    case 'start':
      await postReminder(ctx, e, 'start');
      await setScheduledEventStatus(ctx, e.discord_event_id, 'active');
      break;
    case 'end':
      await refreshEventMessage(ctx, e.id);
      await setScheduledEventStatus(ctx, e.discord_event_id, 'completed');
      if (e.repeat_weekly) await createNextOccurrence(ctx, e, now);
      break;
    case 'summary': {
      const hasUniverse = Boolean(String(ctx.settings().game?.universeId || '').trim());
      await ctx.post('launch', { embeds: [buildSummaryEmbed(e, { hasUniverse })], allowedMentions: NO_MENTIONS });
      break;
    }
    default:
      break;
  }
}

async function upsertCcuMessage(ctx, e, playing, peak, now) {
  const payload = {
    content: composePublic((lang) => tr(T, lang, 'ccuLine', { title: e.title, n: playing, peak, rel: discordTs(now, 'R') })),
    allowedMentions: NO_MENTIONS,
  };
  const channelId = e.channel_id || ctx.channelId('launch');
  if (e.ccu_message_id && (await editMessage(ctx, channelId, e.ccu_message_id, payload))) return;
  const msg = await ctx.post('launch', payload);
  if (msg) store.updateEvent(e.id, { ccu_message_id: msg.id });
}

/** Polls the Roblox player count (at most once per minute) for events inside their window. */
export async function runCcuTick(ctx, now = new Date()) {
  const universeId = String(ctx.settings().game?.universeId || '').trim();
  if (!universeId) return null;
  const candidates = store
    .listEvents({ statuses: ['geplant', 'laeuft', 'beendet'], unsummarizedOnly: true, limit: 50 })
    .filter((e) => inCcuWindow(e, now));
  if (!candidates.length) return null;
  if (ccuState.lastAt && now.getTime() - ccuState.lastAt < 55_000) return null;
  ccuState.lastAt = now.getTime();
  let playing;
  try {
    playing = await fetchCcu(universeId, ctx.fetchImpl || globalThis.fetch);
  } catch (err) {
    ctx.log.warn('Roblox-Spielerzahl nicht abrufbar:', err.message);
    return null;
  }
  if (playing === null) return null;
  for (const e of candidates) {
    store.insertCcuSample(e.id, playing, now.toISOString());
    const peak = Math.max(Number(e.ccu_peak) || 0, playing);
    const fresh = store.updateEvent(e.id, { ccu_peak: peak });
    await upsertCcuMessage(ctx, fresh, playing, peak, now);
  }
  return playing;
}

/** One scheduler tick (exported for tests). */
export async function runEventJob(ctx, now = new Date()) {
  await runCcuTick(ctx, now);
  const hasUniverse = Boolean(String(ctx.settings().game?.universeId || '').trim());
  for (const e of store.listEvents({ statuses: ['geplant', 'laeuft', 'beendet'], unsummarizedOnly: true, limit: 100, order: 'ASC' })) {
    const { actions, flags } = eventPlan(e, now, { summaryDelayMin: hasUniverse ? 30 : 0 });
    const fields = { ...flags };
    if (actions.includes('end')) fields.status = 'beendet';
    else if (actions.includes('start')) fields.status = 'laeuft';
    if (!Object.keys(fields).length) continue;
    const fresh = store.updateEvent(e.id, fields);
    for (const action of actions) {
      try {
        await performEventAction(ctx, fresh, action, now);
      } catch (err) {
        ctx.log.error(`Event #${e.id} (${action}):`, err);
      }
    }
  }
}

async function cancelEvent(ctx, e, reason) {
  store.updateEvent(e.id, {
    status: 'abgesagt',
    reminded_24h: 1,
    reminded_1h: 1,
    reminded_10m: 1,
    start_notified: 1,
    summary_posted: 1,
  });
  const reasonText = (lang) => (reason ? tr(T, lang, 'reasonLine', { reason }) : '');
  await ctx.post('launch', {
    content: composePublic((lang) => tr(T, lang, 'cancelPost', { title: e.title, full: fullTime(e.starts_at), reason: reasonText(lang) })),
    allowedMentions: NO_MENTIONS,
  });
  await deleteScheduledEvent(ctx, e.discord_event_id);
  await refreshEventMessage(ctx, e.id);
}

// ---- Slash command ------------------------------------------------------------------

const eventCommand = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Launch Hour und Creator-Events verwalten (Team)')
  .setDescriptionLocalizations(LOC('Manage launch hour and creator events (team)'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('erstellen')
      .setNameLocalizations(LOC('create'))
      .setDescription('Launch Hour oder Creator-Event anlegen und ankündigen')
      .setDescriptionLocalizations(LOC('Create and announce a launch hour or creator event'))
      .addStringOption((o) => o.setName('titel').setNameLocalizations(LOC('title')).setDescription('Titel, z. B. „Launch Hour“').setDescriptionLocalizations(LOC('Title')).setRequired(true).setMaxLength(100))
      .addStringOption((o) =>
        o
          .setName('typ')
          .setNameLocalizations(LOC('type'))
          .setDescription('Launch Hour oder wiederkehrendes Creator-Event')
          .setDescriptionLocalizations(LOC('Launch hour or recurring creator event'))
          .setRequired(true)
          .addChoices(
            { name: 'Launch Hour', value: 'launch', name_localizations: LOC('Launch hour') },
            { name: 'Creator-Event', value: 'event', name_localizations: LOC('Creator event') },
          ),
      )
      .addStringOption((o) => o.setName('datum').setNameLocalizations(LOC('date')).setDescription('Datum, z. B. 21.11.2026').setDescriptionLocalizations(LOC('Date, e.g. 21.11.2026')).setRequired(true).setMaxLength(20))
      .addStringOption((o) => o.setName('uhrzeit').setNameLocalizations(LOC('time')).setDescription('Uhrzeit (deutsche Zeit), z. B. 19:00').setDescriptionLocalizations(LOC('Time (German time), e.g. 19:00')).setRequired(true).setMaxLength(10))
      .addIntegerOption((o) => o.setName('dauer').setNameLocalizations(LOC('duration')).setDescription('Dauer in Minuten (Standard 60)').setDescriptionLocalizations(LOC('Duration in minutes (default 60)')).setMinValue(10).setMaxValue(600))
      .addStringOption((o) => o.setName('link').setNameLocalizations(LOC('link')).setDescription('Spiel-Link (Standard: Link aus den Einstellungen)').setDescriptionLocalizations(LOC('Game link (default: from settings)')).setMaxLength(500))
      .addBooleanOption((o) => o.setName('woechentlich').setNameLocalizations(LOC('weekly')).setDescription('Jede Woche zur gleichen Zeit wiederholen').setDescriptionLocalizations(LOC('Repeat every week at the same time')))
      .addStringOption((o) => o.setName('beschreibung').setNameLocalizations(LOC('description')).setDescription('Was passiert im Event?').setDescriptionLocalizations(LOC('What happens in the event?')).setMaxLength(1500)),
  )
  .addSubcommand((s) => s.setName('liste').setNameLocalizations(LOC('list')).setDescription('Geplante Events anzeigen').setDescriptionLocalizations(LOC('Show planned events')))
  .addSubcommand((s) =>
    s
      .setName('absagen')
      .setNameLocalizations(LOC('cancel'))
      .setDescription('Event absagen (beendet auch die Wochen-Serie)')
      .setDescriptionLocalizations(LOC('Cancel an event (also ends a weekly series)'))
      .addIntegerOption((o) => o.setName('id').setDescription('Event').setDescriptionLocalizations(LOC('Event')).setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('grund').setNameLocalizations(LOC('reason')).setDescription('Grund (optional)').setDescriptionLocalizations(LOC('Reason (optional)')).setMaxLength(300)),
  );

async function cmdCreate(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const locale = interaction.locale;
  const o = interaction.options;
  const settings = ctx.settings();
  let data;
  try {
    data = parseEventInput(
      {
        title: o.getString('titel'),
        kind: o.getString('typ'),
        date: o.getString('datum'),
        time: o.getString('uhrzeit'),
        duration_min: o.getInteger('dauer'),
        game_link: o.getString('link'),
        repeat_weekly: o.getBoolean('woechentlich'),
        description: o.getString('beschreibung'),
      },
      { timezone: settings.game?.timezone, defaultLink: settings.game?.url },
    );
  } catch (err) {
    if (err instanceof ValidationError) return interaction.editReply(tr(T, locale, err.key));
    throw err;
  }
  const { event, posted } = await createEventFlow(ctx, data, interaction.user.id);
  const postedText = posted ? tr(T, locale, 'postedIn', { channel: channelMention(ctx, 'launch', '#launch-und-events') }) : tr(T, locale, 'noChannel');
  return interaction.editReply(tr(T, locale, 'created', { id: event.id, title: event.title, full: fullTime(event.starts_at), posted: postedText }));
}

async function cmdList(interaction) {
  const locale = interaction.locale;
  const rows = [
    ...store.listEvents({ statuses: ['geplant', 'laeuft'], limit: 20, order: 'ASC' }),
    ...store.listEvents({ statuses: ['beendet'], limit: 3 }),
  ];
  if (!rows.length) return replyEphemeral(interaction, tr(T, locale, 'listEmpty'));
  const lines = rows.map((e) =>
    tr(T, locale, 'listLine', {
      id: e.id,
      icon: e.kind === 'launch' ? '🚀' : '🎮',
      title: e.title,
      full: fullTime(e.starts_at),
      status: tr(T, locale, `status_${e.status}`),
      weekly: e.repeat_weekly ? tr(T, locale, 'weeklyShort') : '',
    }),
  );
  return replyEphemeral(interaction, { content: chunkText([tr(T, locale, 'listTitle'), ...lines].join('\n'))[0], allowedMentions: NO_MENTIONS });
}

async function cmdCancel(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const locale = interaction.locale;
  const e = store.getEvent(interaction.options.getInteger('id'));
  if (!e) return interaction.editReply(tr(T, locale, 'notFound'));
  if (['beendet', 'abgesagt'].includes(e.status)) return interaction.editReply(tr(T, locale, 'alreadyOver'));
  await cancelEvent(ctx, e, interaction.options.getString('grund'));
  return interaction.editReply(tr(T, locale, 'cancelled', { id: e.id, weekly: e.repeat_weekly ? tr(T, locale, 'cancelledWeekly') : '' }));
}

function shortWhen(iso) {
  const tz = 'Europe/Berlin';
  return `${formatDate(iso, 'de', tz, { year: false }).replace(/^[^,]+,\s*/, '')} ${formatTime(iso, 'de', tz)}`;
}

export default {
  name: 'events',
  commands: [eventCommand],
  commandHandlers: {
    async event(interaction, ctx) {
      if (!ctx.isStaff(interaction.member)) return replyEphemeral(interaction, tr(T, interaction.locale, 'notStaff'));
      const sub = interaction.options.getSubcommand();
      if (sub === 'erstellen') return cmdCreate(interaction, ctx);
      if (sub === 'liste') return cmdList(interaction, ctx);
      if (sub === 'absagen') return cmdCancel(interaction, ctx);
      return null;
    },
  },
  autocomplete: {
    async event(interaction) {
      const q = String(interaction.options.getFocused() ?? '').toLowerCase().replace(/^#/, '');
      const rows = store
        .listEvents({ statuses: ['geplant', 'laeuft'], limit: 50, order: 'ASC' })
        .filter((e) => !q || String(e.id).startsWith(q) || e.title.toLowerCase().includes(q))
        .slice(0, 25)
        .map((e) => ({ name: truncate(`#${e.id} · ${e.kind === 'launch' ? '🚀' : '🎮'} ${e.title} · ${shortWhen(e.starts_at)}`, 100), value: e.id }));
      return interaction.respond(rows);
    },
  },
  buttons: {},
  selects: {},
  modals: {},
  events: {},
  jobs: [{ name: 'scheduler', everyMs: 60_000, run: (ctx) => runEventJob(ctx) }],
  async onReady(ctx) {
    ctx.provide('createEvent', async (data = {}) => {
      const settings = ctx.settings();
      const parsed = parseEventInput(data, { timezone: settings.game?.timezone, defaultLink: settings.game?.url });
      const { event } = await createEventFlow(ctx, parsed, null);
      return event;
    });
  },
};
