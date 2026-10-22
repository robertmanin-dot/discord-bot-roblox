// /setup – creates (or repairs) roles, categories, channels and the info/button panels.
// Safe to run again: existing roles/channels are reused, panels are edited in place.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { COLORS, EPHEMERAL, cid, embed, replyEphemeral, tr } from '../util.js';
import { COMMON, channelMention, enLoc } from '../lib/common.js';
import { CHANNEL_PLAN, ROLE_PLAN, channelTypeOf, resolveOverwrites } from '../lib/channelPlan.js';
import { leaderboardPanelPayload } from '../lib/leaderboard.js';
import { isStaffInteraction } from '../lib/rules.js';

const REQUIRED_PERMISSIONS = ['ManageRoles', 'ManageChannels', 'ManageGuild', 'CreateInstantInvite', 'ViewChannel', 'SendMessages', 'EmbedLinks', 'ManageMessages', 'ReadMessageHistory'];

const P = {
  de: {
    infosTitle: '🎬 Founding Creator Programm{game}',
    infosBody:
      '{pitch}**Was du bekommst**\n🏅 Titel „Founding Creator“ im Spiel + dein Name auf der Creator-Wall\n🎟️ Eigener Creator-Code – deine Zuschauer bekommen damit {reward}\n🔗 Eigener Share Link – du siehst, wie viele Spieler du bringst\n🧪 Früher Zugang + Creator-Playtests (Content vor allen anderen)\n📣 Shoutouts und Collabs im Creator-Netzwerk\n📈 Stufen von Bronze bis Diamant – mit Vorrang bei späteren Kampagnen\n\n**So läuft’s**\n1. In {apply} bewerben\n2. Das Team prüft deine Bewerbung\n3. Du bekommst Rolle, Code und Zugang zum Creator HQ\n\n**Regeln**\n• Inhalte als Werbung kennzeichnen, sobald du etwas bekommst (auch Items oder frühen Zugang)\n• Keine Bots, keine Zweitaccounts, keine Belohnungen für Likes/Favoriten\n• Niemanden zum Kaufen auffordern · respektvoll bleiben\n• Ab 13 Jahren · unter 16 nur mit Einverständnis der Eltern',
    applyBody:
      '📝 **Jetzt als Founding Creator bewerben**\nDu machst Roblox-Content auf YouTube, TikTok, Twitch oder Instagram? Klick auf den Button – dauert nur eine Minute.',
    testerBody:
      '🧪 **Tester werden**\nHilf mit, das Spiel vor dem Launch besser zu machen: Playtests spielen, Feedback geben, Bugs finden. Dafür gibt’s Tester-Punkte, die Tester-Rolle und ein exklusives Tester-Item im Spiel.\nAb 13 Jahren · unter 16 mit Einverständnis der Eltern.',
    startBody:
      '👋 **Willkommen im Creator HQ!**\n\n**1.** `/creator code` – dein Code und Share Link\n**2.** Trailer, Thumbnails & Infos: {kit}\n**3.** Launch & Events: {launch}\n**4.** Wenn du live gehst: `/live` (Punkte!)\n**5.** Video oder Short gepostet? `/content` (Punkte nach Prüfung)\n**6.** Fragen & Austausch: {chat}\n\n⚠️ **Werbung kennzeichnen:** Sobald du etwas bekommst (auch Items oder frühen Zugang), markiere Videos/Streams als Werbung bzw. „bezahlte Partnerschaft“.',
    kitBody:
      '🎒 **Creator-Kit**\nHier landen Trailer, Thumbnails, Logo und Infos zum Spiel. _Das Team lädt die Dateien hier hoch._\n\n**Spiel:** {gameLink}\n**Titel-Vorlage:** „🔴 NEUES Roblox-Spiel{gameName} | Code: DEINCODE“\n**Beschreibung:** dein Share Link + „Werbung“, wenn du etwas bekommen hast.',
    applyButton: 'Bewerben',
    testerButton: 'Tester werden',
    noGame: '_kommt bald_',
  },
  en: {
    infosTitle: '🎬 Founding Creator program{game}',
    infosBody:
      "{pitch}**What you get**\n🏅 \"Founding Creator\" title in the game + your name on the Creator Wall\n🎟️ Your own creator code – your viewers get {reward}\n🔗 Your own share link – see how many players you bring\n🧪 Early access + creator playtests (content before everyone else)\n📣 Shoutouts and collabs in the creator network\n📈 Tiers from Bronze to Diamond – with priority for future campaigns\n\n**How it works**\n1. Apply in {apply}\n2. The team reviews your application\n3. You get the role, your code and access to the Creator HQ\n\n**Rules**\n• Label content as an ad as soon as you get anything (including items or early access)\n• No bots, no alt accounts, no rewards for likes/favorites\n• Never push anyone to buy · stay respectful\n• Age 13+ · under 16 only with parental consent",
    applyBody:
      '📝 **Apply as a Founding Creator**\nYou make Roblox content on YouTube, TikTok, Twitch or Instagram? Click the button – it only takes a minute.',
    testerBody:
      '🧪 **Become a tester**\nHelp make the game better before launch: play playtests, give feedback, find bugs. You get tester points, the tester role and an exclusive tester item in the game.\nAge 13+ · under 16 with parental consent.',
    startBody:
      "👋 **Welcome to the Creator HQ!**\n\n**1.** `/creator code` – your code and share link\n**2.** Trailer, thumbnails & info: {kit}\n**3.** Launch & events: {launch}\n**4.** When you go live: `/live` (points!)\n**5.** Posted a video or short? `/content` (points after review)\n**6.** Questions & chat: {chat}\n\n⚠️ **Label ads:** As soon as you get anything (including items or early access), mark videos/streams as an ad or \"paid partnership\".",
    kitBody:
      '🎒 **Creator kit**\nTrailer, thumbnails, logo and game info will land here. _The team uploads the files here._\n\n**Game:** {gameLink}\n**Title template:** "🔴 NEW Roblox game{gameName} | Code: YOURCODE"\n**Description:** your share link + "ad" if you received anything.',
    applyButton: 'Apply',
    testerButton: 'Become a tester',
    noGame: '_coming soon_',
  },
};

const R = {
  de: {
    title: '🛠️ Einrichtung',
    roles: 'Rollen',
    channels: 'Kanäle',
    panels: 'Panels',
    warnings: '⚠️ Hinweise',
    done: 'Fertig! Teste jetzt den Bewerben-Button in {apply}.',
    created: 'angelegt',
    existing: 'vorhanden',
    updated: 'aktualisiert',
    posted: 'gepostet',
    edited: 'aktualisiert',
    failed: 'Fehler',
  },
  en: {
    title: '🛠️ Setup',
    roles: 'Roles',
    channels: 'Channels',
    panels: 'Panels',
    warnings: '⚠️ Notes',
    done: 'Done! Now test the apply button in {apply}.',
    created: 'created',
    existing: 'existing',
    updated: 'updated',
    posted: 'posted',
    edited: 'updated',
    failed: 'error',
  },
};

const command = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('(Team) Rollen, Kanäle und Panels anlegen oder reparieren')
  .setDescriptionLocalizations(enLoc('(Team) Create or repair roles, channels and panels'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addBooleanOption((o) =>
    o
      .setName('nur-panels')
      .setNameLocalizations(enLoc('panels-only'))
      .setDescription('Nur die Info-/Button-Nachrichten neu aufbauen')
      .setDescriptionLocalizations(enLoc('Only rebuild the info/button messages')),
  );

// ---- panels ----

function gameVars(ctx) {
  const g = ctx.settings().game;
  return { name: g.name || '', url: g.url || '', pitchDe: g.pitch_de || '', pitchEn: g.pitch_en || g.pitch_de || '', rewardDe: g.codeReward_de, rewardEn: g.codeReward_en };
}

/** Text in the server language; with 'both' German first, then English (same as publicText). */
function both(ctx, deText, enText) {
  const mode = ctx.settings().discord.serverLanguage || 'both';
  if (mode === 'de') return deText;
  if (mode === 'en') return enText;
  return `${deText}\n\n🇬🇧 ${enText}`;
}

function panelTexts(ctx) {
  const g = gameVars(ctx);
  const links = {
    apply: channelMention(ctx, 'apply', '#creator-bewerbung'),
    kit: channelMention(ctx, 'kit', '#creator-kit'),
    launch: channelMention(ctx, 'launch', '#launch-und-events'),
    chat: channelMention(ctx, 'chat', '#creator-chat'),
  };
  const per = (lang) => {
    const d = P[lang];
    const fillIn = (s, extra = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in extra ? extra[k] : k in links ? links[k] : m));
    return {
      infosTitle: fillIn(d.infosTitle, { game: g.name ? ` – ${g.name}` : '' }),
      infosBody: fillIn(d.infosBody, {
        pitch: (lang === 'de' ? g.pitchDe : g.pitchEn) ? `${lang === 'de' ? g.pitchDe : g.pitchEn}\n\n` : '',
        reward: (lang === 'de' ? g.rewardDe : g.rewardEn) || (lang === 'de' ? 'ein exklusives Item' : 'an exclusive item'),
      }),
      applyBody: d.applyBody,
      testerBody: d.testerBody,
      startBody: fillIn(d.startBody),
      kitBody: fillIn(d.kitBody, { gameLink: g.url || d.noGame, gameName: g.name ? ` – ${g.name}` : '' }),
    };
  };
  return { de: per('de'), en: per('en') };
}

/** All panel payloads by key. */
export function buildPanels(ctx) {
  const t = panelTexts(ctx);
  const mode = ctx.settings().discord.serverLanguage || 'both';
  const buttonLabel = (key) => (mode === 'de' ? P.de[key] : mode === 'en' ? P.en[key] : `${P.de[key]} / ${P.en[key]}`);
  const infosEmbeds = mode === 'both'
    ? [embed({ title: t.de.infosTitle, description: t.de.infosBody, color: COLORS.gold }), embed({ title: `🇬🇧 ${t.en.infosTitle}`, description: t.en.infosBody, color: COLORS.gold })]
    : [embed({ title: t[mode].infosTitle, description: t[mode].infosBody, color: COLORS.gold })];
  return {
    infos: { embeds: infosEmbeds, components: [] },
    apply: {
      embeds: [embed({ description: both(ctx, t.de.applyBody, t.en.applyBody), color: COLORS.primary })],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(cid('apply', 'start')).setLabel(buttonLabel('applyButton')).setEmoji('📝').setStyle(ButtonStyle.Primary),
        ),
      ],
    },
    testerJoin: {
      embeds: [embed({ description: both(ctx, t.de.testerBody, t.en.testerBody), color: COLORS.info })],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(cid('tester', 'join')).setLabel(buttonLabel('testerButton')).setEmoji('🧪').setStyle(ButtonStyle.Success),
        ),
      ],
    },
    start: { embeds: [embed({ description: both(ctx, t.de.startBody, t.en.startBody), color: COLORS.success })], components: [] },
    kit: { embeds: [embed({ description: both(ctx, t.de.kitBody, t.en.kitBody), color: COLORS.primary })], components: [] },
    leaderboard: { ...leaderboardPanelPayload(ctx.settings()), components: [] },
  };
}

// Channel key for each panel (same key as the channel).
const PANEL_CHANNEL = { infos: 'infos', apply: 'apply', testerJoin: 'testerJoin', start: 'start', kit: 'kit', leaderboard: 'leaderboard' };

/** Posts or edits all panels. Returns [{ key, how }] */
export async function ensurePanels(ctx) {
  const panels = buildPanels(ctx);
  const stored = { ...(ctx.settings().discord.messages || {}) };
  const results = [];
  for (const [key, payload] of Object.entries(panels)) {
    const channel = await ctx.channel(PANEL_CHANNEL[key]);
    if (!channel?.isTextBased?.()) {
      results.push({ key, how: 'failed', error: 'Kanal fehlt' });
      continue;
    }
    const prev = stored[key];
    let done = false;
    if (prev?.messageId && prev.channelId === channel.id) {
      try {
        const msg = await channel.messages.fetch(prev.messageId);
        await msg.edit({ ...payload, allowedMentions: { parse: [] } });
        results.push({ key, how: 'edited' });
        done = true;
      } catch {
        // deleted -> post again
      }
    }
    if (!done) {
      try {
        const msg = await channel.send({ ...payload, allowedMentions: { parse: [] } });
        stored[key] = { channelId: channel.id, messageId: msg.id };
        results.push({ key, how: 'posted' });
      } catch (err) {
        results.push({ key, how: 'failed', error: err.message });
      }
    }
  }
  ctx.updateSettings({ discord: { messages: stored } });
  return results;
}

// ---- roles & channels ----

async function ensureRoles(ctx, guild, report) {
  const settings = ctx.settings();
  const ids = {};
  for (const plan of ROLE_PLAN) {
    const name = plan.nameSetting ? settings.discord[plan.nameSetting] || plan.name : plan.name;
    const savedId = settings.discord.roles?.[plan.key];
    let role = savedId ? guild.roles.cache.get(savedId) : null;
    let how = 'existing';
    if (!role) role = guild.roles.cache.find((r) => r.name.toLowerCase() === name.toLowerCase()) || null;
    if (!role) {
      try {
        role = await guild.roles.create({ name, colors: { primaryColor: plan.color }, hoist: plan.hoist, mentionable: false, reason: 'Creator Launch Kit /setup' });
        how = 'created';
      } catch (err) {
        report.roles.push({ key: plan.key, name, how: 'failed', error: err.message });
        continue;
      }
    }
    if (role.editable === false) {
      report.warnings.push(`Rolle „${role.name}“ steht über der Bot-Rolle – der Bot kann sie nicht vergeben. Server-Einstellungen → Rollen → Bot-Rolle nach oben ziehen.`);
    }
    ids[plan.key] = role.id;
    report.roles.push({ key: plan.key, name: role.name, how });
  }
  return ids;
}

async function ensureChannels(ctx, guild, roleIds, report) {
  const settings = ctx.settings();
  const ids = {};
  const overwriteIds = { everyoneId: guild.roles.everyone?.id ?? guild.id, botId: ctx.client.user.id, roles: roleIds };
  for (const item of CHANNEL_PLAN) {
    const type = channelTypeOf(item);
    const parentId = item.parent ? ids[item.parent] : null;
    const savedId = settings.discord.channels?.[item.key];
    let channel = savedId ? guild.channels.cache.get(savedId) : null;
    const ownChannel = Boolean(channel); // created by us before -> we may repair permissions
    if (!channel) {
      const sameName = guild.channels.cache.filter((c) => c.type === type && c.name.toLowerCase() === item.name.toLowerCase());
      channel = (parentId && sameName.find((c) => c.parentId === parentId)) || sameName.first?.() || null;
    }
    const overwrites = resolveOverwrites(item.access, overwriteIds);
    try {
      if (!channel) {
        channel = await guild.channels.create({
          name: item.name,
          type,
          parent: parentId || undefined,
          topic: item.topic,
          permissionOverwrites: overwrites,
          reason: 'Creator Launch Kit /setup',
        });
        report.channels.push({ key: item.key, name: channel.name, how: 'created' });
      } else if (ownChannel) {
        await channel.permissionOverwrites.set(overwrites, 'Creator Launch Kit /setup (Rechte repariert)');
        if (!item.category && parentId && channel.parentId !== parentId) await channel.setParent(parentId, { lockPermissions: false });
        report.channels.push({ key: item.key, name: channel.name, how: 'updated' });
      } else {
        report.channels.push({ key: item.key, name: channel.name, how: 'existing' });
      }
      ids[item.key] = channel.id;
    } catch (err) {
      report.channels.push({ key: item.key, name: item.name, how: 'failed', error: err.message });
      if (channel) ids[item.key] = channel.id;
    }
  }
  return ids;
}

/** Runs the whole setup. Returns a report { roles, channels, panels, warnings }. */
export async function runSetup(ctx, guild, { invoker = null, panelsOnly = false } = {}) {
  const report = { roles: [], channels: [], panels: [], warnings: [] };
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const missing = REQUIRED_PERMISSIONS.filter((p) => !me.permissions.has(PermissionFlagsBits[p]));
  if (missing.length) {
    report.warnings.push(`Dem Bot fehlen Rechte: ${missing.join(', ')}. Bot mit dem Link aus dem Dashboard neu einladen.`);
  }
  if (!panelsOnly) {
    await guild.roles.fetch();
    await guild.channels.fetch();
    const roles = await ensureRoles(ctx, guild, report);
    ctx.updateSettings({ discord: { roles } });
    const channels = await ensureChannels(ctx, guild, roles, report);
    ctx.updateSettings({ discord: { channels } });
    if (invoker && roles.staff && !invoker.roles?.cache?.has(roles.staff)) {
      try {
        await invoker.roles.add(roles.staff, 'Creator Launch Kit /setup');
      } catch { /* not critical */ }
    }
  }
  report.panels = await ensurePanels(ctx);
  return report;
}

export function formatReport(report, locale, ctx) {
  const lang = String(locale || '').startsWith('de') ? 'de' : 'en';
  const word = (how) => tr(R, lang, how);
  const list = (items) => items.map((i) => `${i.how === 'failed' ? '❌' : '✅'} ${i.name || i.key} – ${word(i.how)}${i.error ? ` (${i.error})` : ''}`).join('\n') || '–';
  const fields = [];
  if (report.roles.length) fields.push({ name: tr(R, lang, 'roles'), value: list(report.roles).slice(0, 1024) });
  if (report.channels.length) fields.push({ name: tr(R, lang, 'channels'), value: list(report.channels).slice(0, 1024) });
  fields.push({ name: tr(R, lang, 'panels'), value: list(report.panels).slice(0, 1024) });
  if (report.warnings.length) fields.push({ name: tr(R, lang, 'warnings'), value: report.warnings.join('\n').slice(0, 1024) });
  const failed = [...report.roles, ...report.channels, ...report.panels].some((i) => i.how === 'failed');
  return embed({
    title: tr(R, lang, 'title'),
    description: failed ? undefined : tr(R, lang, 'done', { apply: channelMention(ctx, 'apply', '#creator-bewerbung') }),
    color: failed || report.warnings.length ? COLORS.warning : COLORS.success,
    fields,
  });
}

async function onSetup(interaction, ctx) {
  if (!isStaffInteraction(interaction, ctx)) return replyEphemeral(interaction, tr(COMMON, interaction.locale, 'staffOnly'));
  const guild = interaction.guild;
  if (!guild) return replyEphemeral(interaction, tr(COMMON, interaction.locale, 'notSetup'));
  await interaction.deferReply({ flags: EPHEMERAL });
  const report = await runSetup(ctx, guild, { invoker: interaction.member, panelsOnly: interaction.options.getBoolean('nur-panels') || false });
  await interaction.editReply({ embeds: [formatReport(report, interaction.locale, ctx)] });
  ctx.postLog(`🛠️ /setup ausgeführt von <@${interaction.user.id}>`).catch(() => {});
  return report;
}

export default {
  name: 'setup',
  commands: [command],
  commandHandlers: { setup: onSetup },
  buttons: {},
  selects: {},
  modals: {},
  events: {},
  jobs: [],
  async onReady(ctx) {
    // Re-render panels on start if the setup was done before (e.g. after changing game info).
    if (ctx.channelId('apply') && ctx.settings().discord.messages?.apply) {
      try {
        await ensurePanels(ctx);
      } catch (err) {
        ctx.log.warn('Panels konnten nicht aktualisiert werden:', err.message);
      }
    }
  },
};

