// Creator applications: "Bewerben" button -> age/platform/language -> modal -> team review.
// Rules: under 13 never (nothing stored), under parentConsentUnder only after parental consent,
// minors never get paid deals.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, ModalBuilder, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getCreator } from '../../core/creators.js';
import { PLATFORM_LABELS } from '../../core/urls.js';
import { COLORS, EPHEMERAL, cid, embed, parseCid, replyEphemeral, tr, tryDm } from '../util.js';
import { COMMON, channelMention, userError } from '../lib/common.js';
import {
  AGE_OPTIONS, APPLY_LANGUAGES, APPLY_PLATFORMS, ageDecision, canReapply, foundingAvailable, isStaffInteraction,
  OPEN_APPLICATION_STATES,
} from '../lib/rules.js';
import {
  acceptApplication, countFounding, getApplication, latestApplication, markParentConsent, rejectApplication,
  setReviewMessage, submitApplication,
} from '../lib/applicationsStore.js';

const T = {
  de: {
    chooseIntro: '**Bewerbung als Founding Creator** 📝\nWähle kurz drei Dinge aus und klick dann auf **Weiter**:',
    agePh: 'Wie alt bist du?',
    platformPh: 'Wo machst du hauptsächlich Content?',
    langPh: 'In welcher Sprache?',
    next: 'Weiter',
    'age_u13': 'Unter 13',
    'age_13-15': '13–15 Jahre',
    'age_16-17': '16–17 Jahre',
    'age_18+': '18 oder älter',
    plat_andere: 'Andere',
    lang_de: 'Deutsch', lang_en: 'Englisch', lang_es: 'Spanisch', lang_pt: 'Portugiesisch', lang_fr: 'Französisch', lang_pl: 'Polnisch', lang_tr: 'Türkisch', lang_andere: 'Andere',
    tooYoung: 'Danke für dein Interesse! 💛 Das Creator-Programm ist erst ab 13 Jahren. Bis dahin kannst du das Spiel natürlich ganz normal spielen. Wir haben nichts von dir gespeichert.',
    modalTitle: 'Bewerbung Founding Creator',
    lblChannel: 'Link zu deinem Kanal',
    descChannel: 'YouTube, TikTok, Twitch … – dein Hauptkanal',
    lblFollowers: 'Follower / Abonnenten',
    descFollowers: 'Ungefähr reicht, z. B. 1200 oder 1,2k',
    lblLinks: 'Weitere Kanäle (optional)',
    descLinks: 'Weitere Links oder deine Business-Mail',
    lblIntro: 'Kurz über dich (optional)',
    descIntro: 'Was für Content machst du? Warum willst du dabei sein?',
    alreadyOpen: 'Du hast schon eine offene Bewerbung – das Team meldet sich bei dir. 🙌',
    alreadyMember: 'Du bist schon im Creator-Programm! Deinen Code siehst du mit `/creator code`.',
    recentlyRejected: 'Deine letzte Bewerbung ist noch nicht lange her. Bitte versuch es in ein paar Tagen nochmal.',
    incomplete: 'Bitte wähle zuerst Alter, Plattform und Sprache aus.',
    thanks: '✅ **Danke für deine Bewerbung!** Das Team schaut sie sich an und meldet sich per Nachricht hier im Discord.',
    thanksParent:
      '✅ **Danke für deine Bewerbung!**\nWeil du unter {age} bist, brauchen wir vorher das **Einverständnis deiner Eltern**. Bitte gib ihnen diese Info weiter – sie können sich unter {contact} bei uns melden. Sobald das da ist, geht es weiter.',
    reviewFailed: 'Deine Bewerbung ist gespeichert, aber der Team-Kanal fehlt noch. Das Team wurde informiert.',
    welcomeTitle: '🎉 Willkommen im Creator-Programm!',
    welcome:
      'Hey {name}, du bist jetzt offiziell dabei{founding}!\n\n**Dein Creator-Code:** `{code}`\nDeine Zuschauer geben ihn im Spiel ein und bekommen {reward}.\n\n**Dein Share Link:** {share}\n\n**Kurz die Regeln:**\n• Kennzeichne Videos/Streams als **Werbung** (z. B. „Werbung“ oder „Paid Partnership“), sobald du etwas dafür bekommst – auch Items oder frühen Zugang.\n• Keine Bots, keine Zweitaccounts, keine Belohnungen für Likes/Favoriten.\n• Fordere niemanden zum Kaufen auf.\n{minor}\nAlles Weitere: {start} und {kit}. Wenn du live gehst: `/live`. Videos einreichen: `/content`.',
    foundingSuffix: ' – als **Founding Creator** 🏅',
    shareSoon: 'kommt in Kürze vom Team',
    minorNote: '• Du bist unter 18: Mitmachen ist freiwillig, es gibt keine Pflichten.\n',
    rejected:
      'Hey! Danke für deine Bewerbung als Creator. Diesmal hat es leider nicht gepasst – das hat nichts mit deinem Content zu tun, wir haben nur begrenzt Plätze. Du kannst das Spiel natürlich trotzdem spielen und es später nochmal versuchen. 💛',
    parentOk: 'Danke! Das Einverständnis deiner Eltern ist da – deine Bewerbung wird jetzt geprüft.',
  },
  en: {
    chooseIntro: '**Founding Creator application** 📝\nPick three things and then click **Next**:',
    agePh: 'How old are you?',
    platformPh: 'Where do you mainly create content?',
    langPh: 'In which language?',
    next: 'Next',
    'age_u13': 'Under 13',
    'age_13-15': '13–15 years',
    'age_16-17': '16–17 years',
    'age_18+': '18 or older',
    plat_andere: 'Other',
    lang_de: 'German', lang_en: 'English', lang_es: 'Spanish', lang_pt: 'Portuguese', lang_fr: 'French', lang_pl: 'Polish', lang_tr: 'Turkish', lang_andere: 'Other',
    tooYoung: "Thanks for your interest! 💛 The creator program starts at age 13. Until then you can of course play the game normally. We haven't stored anything about you.",
    modalTitle: 'Founding Creator application',
    lblChannel: 'Link to your channel',
    descChannel: 'YouTube, TikTok, Twitch … – your main channel',
    lblFollowers: 'Followers / subscribers',
    descFollowers: 'A rough number is fine, e.g. 1200 or 1.2k',
    lblLinks: 'Other channels (optional)',
    descLinks: 'More links or your business email',
    lblIntro: 'About you (optional)',
    descIntro: 'What content do you make? Why do you want to join?',
    alreadyOpen: 'You already have an open application – the team will get back to you. 🙌',
    alreadyMember: "You're already in the creator program! See your code with `/creator code`.",
    recentlyRejected: 'Your last application was only recently. Please try again in a few days.',
    incomplete: 'Please pick age, platform and language first.',
    thanks: '✅ **Thanks for applying!** The team will review it and message you here on Discord.',
    thanksParent:
      "✅ **Thanks for applying!**\nBecause you're under {age}, we need your **parents' consent** first. Please pass this on – they can contact us at {contact}. As soon as we have it, we'll continue.",
    reviewFailed: 'Your application is saved, but the team channel is missing. The team has been notified.',
    welcomeTitle: '🎉 Welcome to the creator program!',
    welcome:
      "Hey {name}, you're officially in{founding}!\n\n**Your creator code:** `{code}`\nYour viewers enter it in the game and get {reward}.\n\n**Your share link:** {share}\n\n**Quick rules:**\n• Label videos/streams as **ads** (e.g. \"Ad\" or \"Paid partnership\") as soon as you get anything for them – including items or early access.\n• No bots, no alt accounts, no rewards for likes/favorites.\n• Never push anyone to buy.\n{minor}\nEverything else: {start} and {kit}. When you go live: `/live`. Submit videos: `/content`.",
    foundingSuffix: ' – as a **Founding Creator** 🏅',
    shareSoon: 'coming soon from the team',
    minorNote: "• You're under 18: taking part is voluntary, there are no obligations.\n",
    rejected:
      "Hey! Thanks for applying as a creator. Unfortunately it didn't work out this time – that's not about your content, we just have limited spots. You can of course still play the game and try again later. 💛",
    parentOk: "Thanks! Your parents' consent has arrived – your application is now being reviewed.",
  },
};

const STATUS_DE = {
  offen: '🟡 Offen',
  eltern_ausstehend: '🟠 Eltern-OK ausstehend',
  angenommen: '🟢 Angenommen',
  abgelehnt: '🔴 Abgelehnt',
  zurueckgezogen: '⚪ Zurückgezogen',
};

// ---- selection state lives in the customIds (survives restarts) ----

function stateFrom(args) {
  const v = (x) => (x && x !== '_' ? x : null);
  return { age: v(args[0]), platform: v(args[1]), lang: v(args[2]) };
}
const stateArgs = (s) => [s.age || '_', s.platform || '_', s.lang || '_'];
const complete = (s) => Boolean(s.age && s.platform && s.lang);

export function selectionComponents(locale, s) {
  const row = (c) => new ActionRowBuilder().addComponents(c);
  const age = new StringSelectMenuBuilder()
    .setCustomId(cid('apply', 'sel', 'age', ...stateArgs(s)))
    .setPlaceholder(tr(T, locale, 'agePh'))
    .addOptions(AGE_OPTIONS.map((v) => ({ label: tr(T, locale, `age_${v}`), value: v, default: s.age === v })));
  const platform = new StringSelectMenuBuilder()
    .setCustomId(cid('apply', 'sel', 'platform', ...stateArgs(s)))
    .setPlaceholder(tr(T, locale, 'platformPh'))
    .addOptions(APPLY_PLATFORMS.map((v) => ({ label: v === 'andere' ? tr(T, locale, 'plat_andere') : PLATFORM_LABELS[v], value: v, default: s.platform === v })));
  const lang = new StringSelectMenuBuilder()
    .setCustomId(cid('apply', 'sel', 'lang', ...stateArgs(s)))
    .setPlaceholder(tr(T, locale, 'langPh'))
    .addOptions(APPLY_LANGUAGES.map((v) => ({ label: tr(T, locale, `lang_${v}`), value: v, default: s.lang === v })));
  const next = new ButtonBuilder()
    .setCustomId(cid('apply', 'next', ...stateArgs(s)))
    .setLabel(tr(T, locale, 'next'))
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!complete(s));
  return [row(age), row(platform), row(lang), row(next)];
}

export function applicationModal(locale, s) {
  const input = (id, style, { required, max, placeholder }) => {
    const t = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max);
    if (placeholder) t.setPlaceholder(placeholder);
    return t;
  };
  const label = (key, descKey, component) =>
    new LabelBuilder().setLabel(tr(T, locale, key)).setDescription(tr(T, locale, descKey)).setTextInputComponent(component);
  return new ModalBuilder()
    .setCustomId(cid('apply', 'modal', ...stateArgs(s)))
    .setTitle(tr(T, locale, 'modalTitle'))
    .addLabelComponents(
      label('lblChannel', 'descChannel', input('channel', TextInputStyle.Short, { required: true, max: 200, placeholder: 'https://www.youtube.com/@deinkanal' })),
      label('lblFollowers', 'descFollowers', input('followers', TextInputStyle.Short, { required: true, max: 20, placeholder: '1200' })),
      label('lblLinks', 'descLinks', input('links', TextInputStyle.Paragraph, { required: false, max: 500 })),
      label('lblIntro', 'descIntro', input('intro', TextInputStyle.Paragraph, { required: false, max: 600 })),
    );
}

// ---- review message (team channel, German) ----

export function reviewPayload(app, creator) {
  const color = { offen: COLORS.warning, eltern_ausstehend: COLORS.warning, angenommen: COLORS.success, abgelehnt: COLORS.danger }[app.status] ?? COLORS.primary;
  const fields = [
    { name: 'Discord', value: `<@${app.discord_user_id}> (${app.discord_tag || '–'})`, inline: true },
    { name: 'Alter', value: app.age_group || '–', inline: true },
    { name: 'Sprache', value: app.language || '–', inline: true },
    { name: 'Plattform', value: PLATFORM_LABELS[app.platform] || app.platform || '–', inline: true },
    { name: 'Follower', value: app.followers != null ? String(app.followers) : '–', inline: true },
    { name: 'Status', value: STATUS_DE[app.status] || app.status, inline: true },
    { name: 'Kanal', value: app.channel_url || '–' },
  ];
  if (app.other_links) fields.push({ name: 'Weitere Links', value: app.other_links });
  if (app.intro) fields.push({ name: 'Vorstellung', value: app.intro });
  if (creator && creator.score) fields.push({ name: 'Radar-Score', value: `${creator.score}/100`, inline: true });
  if (app.status === 'eltern_ausstehend') {
    fields.push({ name: '⚠️ Eltern-OK nötig', value: 'Erst annehmen, wenn das Einverständnis der Eltern schriftlich vorliegt (Vorlage: docs/ELTERN-EINVERSTAENDNIS.md).' });
  }
  if (app.reviewed_by) fields.push({ name: 'Bearbeitet', value: `${app.reviewed_by === 'dashboard' ? 'Dashboard' : `<@${app.reviewed_by}>`}` });
  const e = embed({
    title: `📝 Bewerbung #${app.id} – ${creator?.display_name || app.discord_tag || 'Creator'}`,
    color,
    fields,
    footer: creator ? `Creator-ID ${creator.id}` : undefined,
    timestamp: app.created_at,
  });
  const components = [];
  if (OPEN_APPLICATION_STATES.includes(app.status)) {
    const buttons = [
      new ButtonBuilder().setCustomId(cid('app', 'accept', app.id)).setLabel('Annehmen').setStyle(ButtonStyle.Success).setDisabled(app.status !== 'offen'),
      new ButtonBuilder().setCustomId(cid('app', 'reject', app.id)).setLabel('Ablehnen').setStyle(ButtonStyle.Danger),
    ];
    if (app.status === 'eltern_ausstehend') {
      buttons.push(new ButtonBuilder().setCustomId(cid('app', 'parent', app.id)).setLabel('Eltern-OK erhalten').setStyle(ButtonStyle.Secondary));
    }
    components.push(new ActionRowBuilder().addComponents(buttons));
  }
  return { embeds: [e], components, allowedMentions: { parse: [] } };
}

async function refreshReviewMessage(ctx, app) {
  const creator = app.creator_id ? getCreator(app.creator_id) : null;
  const payload = reviewPayload(app, creator);
  if (app.review_channel_id && app.review_message_id) {
    try {
      const channel = await ctx.client.channels.fetch(app.review_channel_id);
      const msg = await channel.messages.fetch(app.review_message_id);
      await msg.edit(payload);
      return msg;
    } catch (err) {
      ctx.log.warn('Prüf-Nachricht konnte nicht aktualisiert werden:', err.message);
    }
  }
  const msg = await ctx.post('reviews', payload);
  if (msg) setReviewMessage(app.id, msg.channelId, msg.id);
  return msg;
}

function welcomeText(ctx, creator, app) {
  const s = ctx.settings();
  const lang = app.language === 'de' ? 'de' : 'en';
  return tr(T, lang, 'welcome', {
    name: creator.display_name,
    founding: creator.founding ? tr(T, lang, 'foundingSuffix') : '',
    code: creator.creator_code,
    reward: (lang === 'de' ? s.game.codeReward_de : s.game.codeReward_en) || (lang === 'de' ? 'ein exklusives Item' : 'an exclusive item'),
    share: creator.share_link || tr(T, lang, 'shareSoon'),
    minor: app.age_group !== '18+' ? tr(T, lang, 'minorNote') : '',
    start: channelMention(ctx, 'start', '#start-hier'),
    kit: channelMention(ctx, 'kit', '#creator-kit'),
  });
}

/**
 * Team decision on an application. action: 'accept' | 'reject' | 'parent-ok'.
 * Used by the review buttons and by the dashboard (services.bot.reviewApplication).
 */
export async function reviewApplication(ctx, id, action, staffUserId = null) {
  const app = getApplication(id);
  if (!app) throw userError('Bewerbung nicht gefunden.', 404);
  const lang = app.language === 'de' ? 'de' : 'en';
  let updated;

  if (action === 'parent-ok' || action === 'parent') {
    updated = markParentConsent(app.id, staffUserId);
    const member = await ctx.member(app.discord_user_id);
    if (member) await tryDm(member.user ?? member, { content: tr(T, lang, 'parentOk') });
  } else if (action === 'accept') {
    if (app.status === 'eltern_ausstehend') throw userError('Erst das Eltern-Einverständnis bestätigen.', 409);
    if (app.status !== 'offen') throw userError(`Bewerbung ist bereits „${app.status}“.`, 409);
    const member = await ctx.member(app.discord_user_id);
    if (!member) throw userError('Die Person ist nicht (mehr) auf dem Server.', 409);
    const creatorRole = ctx.roleId('creator');
    if (!creatorRole) throw userError('Rolle „Creator“ fehlt – bitte zuerst /setup ausführen.', 409);
    const founding = foundingAvailable(countFounding(), ctx.settings().discord.foundingLimit);
    const roles = [creatorRole];
    if (founding && ctx.roleId('founding')) roles.push(ctx.roleId('founding'));
    try {
      await member.roles.add(roles, `Creator-Bewerbung #${app.id} angenommen`);
    } catch (err) {
      throw userError(`Rolle konnte nicht vergeben werden (${err.message}). Die Bot-Rolle muss in den Server-Einstellungen über „Creator“ stehen.`, 409);
    }
    const result = acceptApplication(app.id, staffUserId, { founding });
    updated = result.application;
    const dmOk = await tryDm(member.user ?? member, {
      embeds: [embed({ title: tr(T, lang, 'welcomeTitle'), description: welcomeText(ctx, result.creator, app), color: COLORS.success })],
    });
    await ctx.post('outreachLog', {
      content: `🎉 **${result.creator.display_name}** (<@${app.discord_user_id}>) ist jetzt im Programm${result.founding ? ' – Founding Creator' : ''}. Code: \`${result.creator.creator_code}\`${dmOk ? '' : ' · ⚠️ Willkommens-DM nicht zustellbar (DMs aus)'}`,
      allowedMentions: { parse: [] },
    });
  } else if (action === 'reject') {
    updated = rejectApplication(app.id, staffUserId);
    const member = await ctx.member(app.discord_user_id);
    if (member) await tryDm(member.user ?? member, { content: tr(T, lang, 'rejected') });
  } else {
    throw userError(`Unbekannte Aktion: ${action}`);
  }
  await refreshReviewMessage(ctx, updated);
  return updated;
}

// ---- interaction handlers ----

async function onStart(interaction, ctx) {
  const locale = interaction.locale;
  const last = latestApplication(interaction.user.id);
  const creator = ctx.db().get('SELECT is_member FROM creators WHERE discord_user_id = :id', { id: interaction.user.id });
  if (creator?.is_member) return replyEphemeral(interaction, tr(T, locale, 'alreadyMember'));
  if (last && OPEN_APPLICATION_STATES.includes(last.status)) return replyEphemeral(interaction, tr(T, locale, 'alreadyOpen'));
  if (!canReapply(last)) return replyEphemeral(interaction, tr(T, locale, 'recentlyRejected'));
  if (!ctx.channelId('reviews')) return replyEphemeral(interaction, tr(COMMON, locale, 'notSetup'));
  return interaction.reply({ content: tr(T, locale, 'chooseIntro'), components: selectionComponents(locale, {}), flags: EPHEMERAL });
}

async function onSelect(interaction, ctx) {
  const { action, args } = parseCid(interaction.customId);
  if (action !== 'sel') return;
  const field = args[0];
  const s = stateFrom(args.slice(1));
  if (['age', 'platform', 'lang'].includes(field)) s[field] = interaction.values[0];
  if (s.age && !ageDecision(s.age, ctx.settings().discord).allowed) {
    return interaction.update({ content: tr(T, interaction.locale, 'tooYoung'), components: [] });
  }
  return interaction.update({ content: tr(T, interaction.locale, 'chooseIntro'), components: selectionComponents(interaction.locale, s) });
}

async function onNext(interaction, ctx, args) {
  const s = stateFrom(args);
  if (!complete(s)) return replyEphemeral(interaction, tr(T, interaction.locale, 'incomplete'));
  if (!ageDecision(s.age, ctx.settings().discord).allowed) {
    return interaction.update({ content: tr(T, interaction.locale, 'tooYoung'), components: [] });
  }
  return interaction.showModal(applicationModal(interaction.locale, s));
}

async function onModal(interaction, ctx) {
  const { action, args } = parseCid(interaction.customId);
  if (action !== 'modal') return;
  const locale = interaction.locale;
  const s = stateFrom(args);
  const decision = ageDecision(s.age, ctx.settings().discord);
  const fromMessage = typeof interaction.isFromMessage === 'function' && interaction.isFromMessage();
  if (!decision.allowed) {
    const payload = { content: tr(T, locale, 'tooYoung'), components: [] };
    return fromMessage ? interaction.update(payload) : interaction.reply({ ...payload, flags: EPHEMERAL });
  }
  if (fromMessage) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: EPHEMERAL });
  const finish = (content) => interaction.editReply({ content, components: [] });

  const last = latestApplication(interaction.user.id);
  if (last && OPEN_APPLICATION_STATES.includes(last.status)) return finish(tr(T, locale, 'alreadyOpen'));

  const field = (id) => {
    try {
      return interaction.fields.getTextInputValue(id) || '';
    } catch {
      return '';
    }
  };
  const { application, creator } = submitApplication({
    userId: interaction.user.id,
    tag: interaction.user.tag ?? interaction.user.username,
    displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    ageGroup: s.age,
    platform: s.platform,
    language: s.lang,
    channelInput: field('channel'),
    followersInput: field('followers'),
    otherLinks: field('links'),
    intro: field('intro'),
  });

  const msg = await ctx.post('reviews', reviewPayload(application, creator));
  if (msg) setReviewMessage(application.id, msg.channelId, msg.id);
  else ctx.postLog(`⚠️ Bewerbung #${application.id} konnte nicht in #bewerbungen gepostet werden.`).catch(() => {});

  if (application.status === 'eltern_ausstehend') {
    const contact = ctx.settings().game.contactEmail || channelMention(ctx, 'reviews', 'dem Team');
    return finish(tr(T, locale, 'thanksParent', { age: ctx.settings().discord.parentConsentUnder, contact }));
  }
  return finish(msg ? tr(T, locale, 'thanks') : tr(T, locale, 'reviewFailed'));
}

async function onReviewButton(interaction, ctx) {
  const { action, args } = parseCid(interaction.customId);
  if (!isStaffInteraction(interaction, ctx)) return replyEphemeral(interaction, tr(COMMON, interaction.locale, 'staffOnly'));
  await interaction.deferUpdate();
  try {
    await reviewApplication(ctx, Number(args[0]), action, interaction.user.id);
  } catch (err) {
    await interaction.followUp({ content: `⚠️ ${err.message}`, flags: EPHEMERAL });
  }
}

export default {
  name: 'applications',
  commands: [],
  commandHandlers: {},
  buttons: {
    apply: async (interaction, ctx) => {
      const { action, args } = parseCid(interaction.customId);
      if (action === 'start') return onStart(interaction, ctx);
      if (action === 'next') return onNext(interaction, ctx, args);
      return null;
    },
    app: onReviewButton,
  },
  selects: { apply: onSelect },
  modals: { apply: onModal },
  events: {},
  jobs: [],
  async onReady(ctx) {
    ctx.provide('reviewApplication', (id, action, staffUserId = null) => reviewApplication(ctx, id, action, staffUserId));
  },
};

export { T as APPLICATION_TEXTS };
