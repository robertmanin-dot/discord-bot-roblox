// /creator (own code/profile + team tools) and /content (submit videos for points).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { getDb } from '../../core/db.js';
import { findCreatorByDiscordId, getCreatorFull, logActivity, updateCreator } from '../../core/creators.js';
import { addPoints, getPoints, getRank, tierFor } from '../../core/points.js';
import { PLATFORM_LABELS } from '../../core/urls.js';
import { COLORS, cid, cleanUrl, embed, parseCid, replyEphemeral, tr, tryDm } from '../util.js';
import { COMMON, channelMention, enLoc } from '../lib/common.js';
import {
  CONTENT_KINDS, contentPoints, hasRole, isProgramMember, isRobloxLink, isStaffInteraction, normalizeCode, validCreatorCode,
} from '../lib/rules.js';

const T = {
  de: {
    codeTitle: '🎟️ Dein Creator-Code',
    codeBody: '**Code:** `{code}`\nDeine Zuschauer geben ihn im Spiel ein und bekommen {reward}.\n\n**Share Link:** {share}\nTeile diesen Link in Videobeschreibungen und im Stream-Chat – so sieht das Team, wie viele Spieler du bringst.\n\n⚠️ Kennzeichne Inhalte als **Werbung**, sobald du etwas dafür bekommst.',
    noCode: 'Du hast noch keinen Creator-Code. Bewirb dich in {apply} – nach der Annahme bekommst du deinen Code.',
    shareSoon: '_kommt in Kürze vom Team_',
    profileTitle: '👤 Dein Creator-Profil',
    points: 'Punkte',
    rank: 'Platz',
    tier: 'Stufe',
    next: 'Nächste Stufe',
    nextValue: '{name} ab {min} Punkten (noch {missing})',
    maxTier: 'Höchste Stufe erreicht 🏆',
    founding: 'Founding Creator',
    yes: 'Ja 🏅',
    no: 'Nein',
    testerPoints: 'Tester-Punkte',
    notMember: 'Du bist (noch) nicht im Creator-Programm. Bewirb dich in {apply}.',
    contentOk: '✅ Danke! Dein Beitrag wurde eingereicht. Sobald das Team ihn bestätigt, bekommst du die Punkte.',
    contentDuplicate: 'Dieser Link wurde schon eingereicht.',
    contentConfirmed: '🎉 Dein Beitrag wurde bestätigt: **+{points} Punkte**! ({url})',
    contentRejected: 'Dein eingereichter Beitrag ({url}) wurde diesmal nicht gewertet – z. B. weil das Spiel nicht vorkommt oder die Werbekennzeichnung fehlt. Bei Fragen melde dich im Support.',
    setLinkOk: '✅ Share Link für {name} gespeichert.',
    setLinkDm: '🔗 Dein persönlicher Share Link ist da: {url}\nTeile ihn in Videobeschreibungen und im Stream-Chat.',
    badRobloxLink: 'Das ist kein Roblox-Link (erwartet z. B. https://www.roblox.com/share?code=…).',
    setCodeOk: '✅ Code von {name} ist jetzt `{code}`.',
    badCode: 'Codes bestehen aus 3–16 Buchstaben/Ziffern (A–Z, 0–9).',
    codeTaken: 'Der Code `{code}` ist schon vergeben.',
    pointsOk: '✅ {sign}{points} {kind}-Punkte für {name}. Neuer Stand: {total}.',
    removed: '✅ {name} ist nicht mehr im Creator-Programm (Rollen entfernt).',
    removeRolesFailed: '⚠️ Im System entfernt, aber Rollen konnten nicht entfernt werden: {error}',
  },
  en: {
    codeTitle: '🎟️ Your creator code',
    codeBody: "**Code:** `{code}`\nYour viewers enter it in the game and get {reward}.\n\n**Share link:** {share}\nShare this link in video descriptions and stream chat – that's how the team sees how many players you bring.\n\n⚠️ Label content as an **ad** as soon as you get anything for it.",
    noCode: "You don't have a creator code yet. Apply in {apply} – you'll get your code once accepted.",
    shareSoon: '_coming soon from the team_',
    profileTitle: '👤 Your creator profile',
    points: 'Points',
    rank: 'Rank',
    tier: 'Tier',
    next: 'Next tier',
    nextValue: '{name} at {min} points ({missing} to go)',
    maxTier: 'Highest tier reached 🏆',
    founding: 'Founding Creator',
    yes: 'Yes 🏅',
    no: 'No',
    testerPoints: 'Tester points',
    notMember: "You're not in the creator program (yet). Apply in {apply}.",
    contentOk: '✅ Thanks! Your post has been submitted. You get the points once the team confirms it.',
    contentDuplicate: 'This link has already been submitted.',
    contentConfirmed: '🎉 Your post was confirmed: **+{points} points**! ({url})',
    contentRejected: "Your submitted post ({url}) wasn't counted this time – e.g. because the game isn't in it or the ad label is missing. Ask in support if you have questions.",
    setLinkOk: '✅ Share link for {name} saved.',
    setLinkDm: '🔗 Your personal share link is here: {url}\nShare it in video descriptions and stream chat.',
    badRobloxLink: "That's not a Roblox link (expected e.g. https://www.roblox.com/share?code=…).",
    setCodeOk: "✅ {name}'s code is now `{code}`.",
    badCode: 'Codes have 3–16 letters/digits (A–Z, 0–9).',
    codeTaken: 'The code `{code}` is already taken.',
    pointsOk: '✅ {sign}{points} {kind} points for {name}. New total: {total}.',
    removed: '✅ {name} is no longer in the creator program (roles removed).',
    removeRolesFailed: '⚠️ Removed in the system, but roles could not be removed: {error}',
  },
};

const STATUS_DE = {
  neu: 'Neu', qualifiziert: 'Qualifiziert', kontaktiert: 'Kontaktiert', nachgefasst: 'Nachgefasst', geantwortet: 'Geantwortet',
  interessiert: 'Interessiert', im_discord: 'Im Discord', dabei: 'Dabei', live: 'Live beim Launch', ungeeignet: 'Ungeeignet',
  kein_interesse: 'Kein Interesse', keine_antwort: 'Keine Antwort', abgemeldet: 'Abgemeldet',
};

const userOpt = (o) => o.setName('user').setDescription('Discord-Mitglied').setDescriptionLocalizations(enLoc('Discord member')).setRequired(true);

const creatorCommand = new SlashCommandBuilder()
  .setName('creator')
  .setDescription('Dein Creator-Code und Profil (+ Team-Werkzeuge)')
  .setDescriptionLocalizations(enLoc('Your creator code and profile (+ team tools)'))
  .addSubcommand((s) => s.setName('code').setDescription('Zeigt deinen Creator-Code und Share Link').setDescriptionLocalizations(enLoc('Shows your creator code and share link')))
  .addSubcommand((s) =>
    s.setName('profil').setNameLocalizations(enLoc('profile')).setDescription('Deine Punkte, dein Platz und deine Stufe').setDescriptionLocalizations(enLoc('Your points, rank and tier')),
  )
  .addSubcommand((s) =>
    s.setName('info').setDescription('(Team) Infos zu einem Creator').setDescriptionLocalizations(enLoc('(Team) Info about a creator')).addUserOption(userOpt),
  )
  .addSubcommand((s) =>
    s
      .setName('link')
      .setDescription('(Team) Roblox Share Link eines Creators setzen')
      .setDescriptionLocalizations(enLoc("(Team) Set a creator's Roblox share link"))
      .addUserOption(userOpt)
      .addStringOption((o) => o.setName('url').setDescription('Share Link aus dem Creator Hub').setDescriptionLocalizations(enLoc('Share link from Creator Hub')).setRequired(true).setMaxLength(300)),
  )
  .addSubcommand((s) =>
    s
      .setName('code-setzen')
      .setNameLocalizations(enLoc('set-code'))
      .setDescription('(Team) Creator-Code ändern')
      .setDescriptionLocalizations(enLoc("(Team) Change a creator's code"))
      .addUserOption(userOpt)
      .addStringOption((o) => o.setName('code').setDescription('Neuer Code (A–Z, 0–9)').setDescriptionLocalizations(enLoc('New code (A–Z, 0–9)')).setRequired(true).setMinLength(3).setMaxLength(16)),
  )
  .addSubcommand((s) =>
    s
      .setName('punkte')
      .setNameLocalizations(enLoc('points'))
      .setDescription('(Team) Punkte vergeben oder abziehen')
      .setDescriptionLocalizations(enLoc('(Team) Add or remove points'))
      .addUserOption(userOpt)
      .addIntegerOption((o) =>
        o.setName('anzahl').setNameLocalizations(enLoc('amount')).setDescription('z. B. 50 oder -20').setDescriptionLocalizations(enLoc('e.g. 50 or -20')).setRequired(true).setMinValue(-1000).setMaxValue(1000),
      )
      .addStringOption((o) => o.setName('grund').setNameLocalizations(enLoc('reason')).setDescription('Wofür?').setDescriptionLocalizations(enLoc('What for?')).setRequired(true).setMaxLength(200))
      .addStringOption((o) =>
        o
          .setName('art')
          .setNameLocalizations(enLoc('kind'))
          .setDescription('Creator- oder Tester-Punkte')
          .setDescriptionLocalizations(enLoc('Creator or tester points'))
          .addChoices({ name: 'Creator', value: 'creator' }, { name: 'Tester', value: 'tester' }),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('entfernen')
      .setNameLocalizations(enLoc('remove'))
      .setDescription('(Team) Creator aus dem Programm nehmen')
      .setDescriptionLocalizations(enLoc('(Team) Remove a creator from the program'))
      .addUserOption(userOpt),
  );

const contentCommand = new SlashCommandBuilder()
  .setName('content')
  .setDescription('Video, Short oder Stream einreichen und Punkte sammeln')
  .setDescriptionLocalizations(enLoc('Submit a video, short or stream to earn points'))
  .addStringOption((o) => o.setName('link').setDescription('Link zum Video/Stream').setDescriptionLocalizations(enLoc('Link to the video/stream')).setRequired(true).setMaxLength(300))
  .addStringOption((o) =>
    o
      .setName('typ')
      .setNameLocalizations(enLoc('type'))
      .setDescription('Art des Beitrags')
      .setDescriptionLocalizations(enLoc('Kind of post'))
      .setRequired(true)
      .addChoices(
        { name: 'Video', value: 'video' },
        { name: 'Short / TikTok', value: 'short' },
        { name: 'Stream (Aufzeichnung)', value: 'stream', name_localizations: enLoc('Stream (VOD)') },
      ),
  );

const STAFF_SUBS = new Set(['info', 'link', 'code-setzen', 'punkte', 'entfernen']);

function shareText(lang, creator) {
  return creator.share_link || tr(T, lang, 'shareSoon');
}

async function onCreator(interaction, ctx) {
  const sub = interaction.options.getSubcommand();
  const locale = interaction.locale;
  if (STAFF_SUBS.has(sub) && !isStaffInteraction(interaction, ctx)) return replyEphemeral(interaction, tr(COMMON, locale, 'staffOnly'));
  const apply = channelMention(ctx, 'apply', '#creator-bewerbung');
  const settings = ctx.settings();

  if (sub === 'code') {
    const creator = findCreatorByDiscordId(interaction.user.id);
    if (!creator?.creator_code) return replyEphemeral(interaction, tr(T, locale, 'noCode', { apply }));
    const lang = locale?.startsWith('de') ? 'de' : 'en';
    const reward = (lang === 'de' ? settings.game.codeReward_de : settings.game.codeReward_en) || '';
    return replyEphemeral(interaction, {
      embeds: [embed({ title: tr(T, locale, 'codeTitle'), description: tr(T, locale, 'codeBody', { code: creator.creator_code, reward, share: shareText(lang, creator) }), color: COLORS.gold })],
    });
  }

  if (sub === 'profil') {
    const creator = findCreatorByDiscordId(interaction.user.id);
    if (!creator?.is_member && !hasRole(interaction.member, ctx.roleId('creator'))) return replyEphemeral(interaction, tr(T, locale, 'notMember', { apply }));
    const points = getPoints(interaction.user.id, 'creator');
    const tier = tierFor(points);
    const rank = getRank(interaction.user.id, 'creator');
    const fields = [
      { name: tr(T, locale, 'points'), value: String(points), inline: true },
      { name: tr(T, locale, 'rank'), value: rank ? `#${rank}` : '–', inline: true },
      { name: tr(T, locale, 'tier'), value: tier.name, inline: true },
      {
        name: tr(T, locale, 'next'),
        value: tier.next ? tr(T, locale, 'nextValue', { name: tier.next.name, min: tier.next.min, missing: tier.next.min - points }) : tr(T, locale, 'maxTier'),
      },
      { name: 'Code', value: creator?.creator_code ? `\`${creator.creator_code}\`` : '–', inline: true },
      { name: tr(T, locale, 'founding'), value: creator?.founding ? tr(T, locale, 'yes') : tr(T, locale, 'no'), inline: true },
      { name: 'Share Link', value: creator ? shareText(locale?.startsWith('de') ? 'de' : 'en', creator) : '–' },
    ];
    const testerPoints = getPoints(interaction.user.id, 'tester');
    if (testerPoints > 0) fields.push({ name: tr(T, locale, 'testerPoints'), value: String(testerPoints), inline: true });
    return replyEphemeral(interaction, { embeds: [embed({ title: tr(T, locale, 'profileTitle'), fields, color: COLORS.primary })] });
  }

  const user = interaction.options.getUser('user', true);
  const creator = findCreatorByDiscordId(user.id);
  if (!creator && sub !== 'punkte') return replyEphemeral(interaction, tr(COMMON, locale, 'unknownUser'));

  if (sub === 'info') {
    const full = getCreatorFull(creator.id);
    const accounts = full.accounts.map((a) => `${PLATFORM_LABELS[a.platform] || a.platform}: ${a.url || a.handle}${a.followers != null ? ` (${a.followers})` : ''}`).join('\n') || '–';
    const emails = full.contacts.filter((c) => c.type === 'email').map((c) => c.value).join(', ') || '–';
    return replyEphemeral(interaction, {
      embeds: [
        embed({
          title: `ℹ️ ${creator.display_name}`,
          color: COLORS.info,
          fields: [
            { name: 'Discord', value: `<@${user.id}>`, inline: true },
            { name: 'Status', value: STATUS_DE[full.outreach?.status] || full.outreach?.status || '–', inline: true },
            { name: 'Alter', value: creator.age_group, inline: true },
            { name: 'Sprache', value: creator.language || '–', inline: true },
            { name: 'Score', value: `${creator.score}/100`, inline: true },
            { name: 'Founding', value: creator.founding ? 'Ja' : 'Nein', inline: true },
            { name: 'Code', value: creator.creator_code ? `\`${creator.creator_code}\`` : '–', inline: true },
            { name: 'Bezahlte Deals erlaubt', value: creator.paid_ok ? 'Ja' : 'Nein', inline: true },
            { name: 'Punkte', value: String(getPoints(user.id, 'creator')), inline: true },
            { name: 'Kanäle', value: accounts },
            { name: 'E-Mail', value: emails },
            { name: 'Share Link', value: creator.share_link || '–' },
          ],
          footer: `Creator-ID ${creator.id}`,
        }),
      ],
      allowedMentions: { parse: [] },
    });
  }

  if (sub === 'link') {
    const url = cleanUrl(interaction.options.getString('url', true));
    if (!url || !isRobloxLink(url)) return replyEphemeral(interaction, tr(T, locale, 'badRobloxLink'));
    updateCreator(creator.id, { share_link: url });
    logActivity(creator.id, 'note', { text: 'Share Link gesetzt', by: interaction.user.id });
    await tryDm(user, { content: tr(T, creator.language === 'de' ? 'de' : 'en', 'setLinkDm', { url }) });
    return replyEphemeral(interaction, tr(T, locale, 'setLinkOk', { name: creator.display_name }));
  }

  if (sub === 'code-setzen') {
    const code = normalizeCode(interaction.options.getString('code', true));
    if (!validCreatorCode(code)) return replyEphemeral(interaction, tr(T, locale, 'badCode'));
    const taken = getDb().get('SELECT id FROM creators WHERE creator_code = :code AND id != :id', { code, id: creator.id });
    if (taken) return replyEphemeral(interaction, tr(T, locale, 'codeTaken', { code }));
    updateCreator(creator.id, { creator_code: code });
    logActivity(creator.id, 'note', { text: `Code geändert zu ${code}`, by: interaction.user.id });
    return replyEphemeral(interaction, tr(T, locale, 'setCodeOk', { name: creator.display_name, code }));
  }

  if (sub === 'punkte') {
    const amount = interaction.options.getInteger('anzahl', true);
    const reason = interaction.options.getString('grund', true);
    const kind = interaction.options.getString('art') || 'creator';
    addPoints({ userId: user.id, kind, points: amount, reason: `${reason} (von ${interaction.user.tag ?? interaction.user.username})` });
    if (creator) logActivity(creator.id, 'note', { text: `${amount > 0 ? '+' : ''}${amount} ${kind}-Punkte: ${reason}`, by: interaction.user.id });
    return replyEphemeral(interaction, {
      content: tr(T, locale, 'pointsOk', { sign: amount > 0 ? '+' : '', points: amount, kind, name: creator?.display_name || `<@${user.id}>`, total: getPoints(user.id, kind) }),
      allowedMentions: { parse: [] },
    });
  }

  if (sub === 'entfernen') {
    updateCreator(creator.id, { is_member: 0 });
    logActivity(creator.id, 'note', { text: 'Aus dem Creator-Programm entfernt', by: interaction.user.id });
    const member = await ctx.member(user.id);
    const roles = [ctx.roleId('creator'), ctx.roleId('founding')].filter(Boolean);
    if (member && roles.length) {
      try {
        await member.roles.remove(roles, 'Aus dem Creator-Programm entfernt');
      } catch (err) {
        return replyEphemeral(interaction, tr(T, locale, 'removeRolesFailed', { error: err.message }));
      }
    }
    return replyEphemeral(interaction, tr(T, locale, 'removed', { name: creator.display_name }));
  }
  return null;
}

// ---- /content ----

export function contentReviewPayload(sub, creatorName) {
  const color = { offen: COLORS.warning, bestaetigt: COLORS.success, abgelehnt: COLORS.danger }[sub.status] ?? COLORS.primary;
  const label = { offen: '🟡 Zu prüfen', bestaetigt: '🟢 Bestätigt', abgelehnt: '🔴 Nicht gewertet' }[sub.status] || sub.status;
  const components = [];
  if (sub.status === 'offen') {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid('content', 'ok', sub.id)).setLabel('Bestätigen').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(cid('content', 'no', sub.id)).setLabel('Nicht werten').setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  return {
    embeds: [
      embed({
        title: `🎬 Content-Einreichung #${sub.id}`,
        color,
        fields: [
          { name: 'Creator', value: `<@${sub.discord_user_id}>${creatorName ? ` (${creatorName})` : ''}`, inline: true },
          { name: 'Art', value: sub.kind, inline: true },
          { name: 'Status', value: label, inline: true },
          { name: 'Link', value: sub.url },
          { name: 'Prüfen', value: 'Kommt das Spiel vor? Ist der Beitrag als Werbung gekennzeichnet (falls nötig)?' },
        ],
        timestamp: sub.created_at,
      }),
    ],
    components,
    allowedMentions: { parse: [] },
  };
}

async function onContent(interaction, ctx) {
  const locale = interaction.locale;
  const creator = findCreatorByDiscordId(interaction.user.id);
  if (!isProgramMember(creator, interaction.member, ctx)) {
    return replyEphemeral(interaction, tr(T, locale, 'notMember', { apply: channelMention(ctx, 'apply', '#creator-bewerbung') }));
  }
  const url = cleanUrl(interaction.options.getString('link', true));
  if (!url) return replyEphemeral(interaction, tr(COMMON, locale, 'invalidUrl'));
  const kind = interaction.options.getString('typ', true);
  if (!CONTENT_KINDS.includes(kind)) return replyEphemeral(interaction, tr(COMMON, locale, 'invalidUrl'));
  const db = getDb();
  if (db.get('SELECT 1 FROM content_submissions WHERE url = :url', { url })) return replyEphemeral(interaction, tr(T, locale, 'contentDuplicate'));
  const { lastInsertRowid: id } = db.run(
    'INSERT INTO content_submissions (discord_user_id, creator_id, url, kind) VALUES (:userId, :creatorId, :url, :kind)',
    { userId: interaction.user.id, creatorId: creator?.id ?? null, url, kind },
  );
  const sub = db.get('SELECT * FROM content_submissions WHERE id = :id', { id });
  const msg = await ctx.post('reviews', contentReviewPayload(sub, creator?.display_name));
  if (msg) db.run('UPDATE content_submissions SET review_channel_id = :c, review_message_id = :m WHERE id = :id', { c: msg.channelId, m: msg.id, id });
  if (creator) logActivity(creator.id, 'content', { url, kind, submissionId: id });
  return replyEphemeral(interaction, tr(T, locale, 'contentOk'));
}

/** Team decision on a content submission ('ok' | 'no'). Returns the updated row. */
export async function reviewContent(ctx, id, decision, staffUserId) {
  const db = getDb();
  const sub = db.get('SELECT * FROM content_submissions WHERE id = :id', { id: Number(id) });
  if (!sub) throw new Error('Einreichung nicht gefunden.');
  if (sub.status !== 'offen') return sub;
  const status = decision === 'ok' ? 'bestaetigt' : 'abgelehnt';
  db.run('UPDATE content_submissions SET status = :status, reviewed_by = :by WHERE id = :id', { status, by: staffUserId, id: sub.id });
  const creator = sub.creator_id ? getCreatorFull(sub.creator_id)?.creator : findCreatorByDiscordId(sub.discord_user_id);
  const lang = creator?.language === 'de' ? 'de' : 'en';
  const user = await ctx.client?.users?.fetch(sub.discord_user_id).catch(() => null);
  if (status === 'bestaetigt') {
    const points = contentPoints(sub.kind, ctx.settings().points);
    addPoints({ userId: sub.discord_user_id, kind: 'creator', points, reason: `Content (${sub.kind})`, ref: `content:${sub.id}` });
    if (user) await tryDm(user, { content: tr(T, lang, 'contentConfirmed', { points, url: sub.url }) });
  } else if (user) {
    await tryDm(user, { content: tr(T, lang, 'contentRejected', { url: sub.url }) });
  }
  return db.get('SELECT * FROM content_submissions WHERE id = :id', { id: sub.id });
}

async function onContentButton(interaction, ctx) {
  if (!isStaffInteraction(interaction, ctx)) return replyEphemeral(interaction, tr(COMMON, interaction.locale, 'staffOnly'));
  const { action, args } = parseCid(interaction.customId);
  await interaction.deferUpdate();
  const updated = await reviewContent(ctx, Number(args[0]), action, interaction.user.id);
  const creator = findCreatorByDiscordId(updated.discord_user_id);
  await interaction.editReply(contentReviewPayload(updated, creator?.display_name));
}

export default {
  name: 'creator',
  commands: [creatorCommand, contentCommand],
  commandHandlers: { creator: onCreator, content: onContent },
  buttons: { content: onContentButton },
  selects: {},
  modals: {},
  events: {},
  jobs: [],
  async onReady() {},
};

export { T as CREATOR_TEXTS };
