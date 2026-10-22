// Modul "playtests" (Bot-Teil B): Tester werden, Playtest-Termine mit Anmeldung/Warteliste,
// Erinnerungen per DM, Link zum Start, Feedback-Formular mit Punkten.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { COLORS, EPHEMERAL, cid, embed, mentionUser, parseCid, replyEphemeral, tr, chunkText } from '../util.js';
import { discordTs, formatDate, formatTime, toDate } from '../../core/time.js';
import { truncate } from '../../core/util.js';
import {
  ValidationError,
  ageEligible,
  parsePlaytestInput,
  playtestPlan,
  strictUrl,
  testerDecision,
  validateFeedback,
  MIN,
} from '../lib/b-logic.js';
import * as store from '../lib/b-store.js';
import {
  NO_MENTIONS,
  composePublic,
  createScheduledEvent,
  deleteScheduledEvent,
  dmMany,
  dmUser,
  editMessage,
  hasAnyRole,
  publicLabel,
  resolveMember,
  setScheduledEventStatus,
} from '../lib/b-discord.js';

const LOC = (en) => ({ 'en-US': en, 'en-GB': en });

export const T = {
  de: {
    // public post
    ptWhen: '📅 {full} ({rel})',
    ptDuration: '⏱️ {min} Minuten',
    ptSlots: '👥 Plätze: {n}/{slots}',
    ptSlotsOpen: '👥 Angemeldet: {n}',
    ptWait: ' · Warteliste: {wait}',
    ptAge16: '🔞 Ab 16 Jahren',
    ptStatus_geplant: '🟡 Anmeldung offen',
    ptStatus_laeuft: '🟢 Läuft gerade',
    ptStatus_beendet: '✅ Beendet – danke fürs Testen!',
    ptStatus_abgesagt: '❌ Abgesagt',
    ptHowTo: 'Klick auf **Anmelden** – den Link bekommst du zum Start per DM.',
    btnJoin: 'Anmelden',
    btnLeave: 'Abmelden',
    btnFeedback: 'Feedback geben',
    ptRunningPost: '🟢 **{title}** läuft jetzt! Alle Angemeldeten haben den Link per DM bekommen.',
    ptEndPost: '📝 **{title}** ist vorbei – danke an alle! Wer dabei war: bitte kurz Feedback geben (2 Minuten).',
    ptCancelPost: '❌ **{title}** ({full}) wurde abgesagt.{reason}',
    reasonLine: ' Grund: {reason}',
    // DMs
    dm24h: '⏰ Erinnerung: **{title}** ist morgen – {full} ({rel}). Bis dann!',
    dm1h: '⏳ In einer Stunde geht’s los: **{title}** – {full}.',
    dmStartLink: '🟢 **{title}** startet jetzt! Hier ist dein Link: {link}\nViel Spaß – und achte darauf, was dir auffällt. 😉',
    dmStartNoLink: '🟢 **{title}** startet jetzt! Alle Infos stehen im Kanal #playtest-termine.',
    dmEnd: '🙏 Danke fürs Mitmachen bei **{title}**! Wie war’s? Dein Feedback hilft uns enorm – dauert nur 2 Minuten.',
    dmPromoted: '🎉 Ein Platz ist frei geworden – du bist beim Playtest **{title}** dabei! {full}',
    dmCancelled: '❌ Der Playtest **{title}** ({full}) wurde leider abgesagt.{reason}',
    // replies
    joined: '✅ Du bist für **{title}** angemeldet! Den Link bekommst du zum Start per DM, Erinnerungen kommen 24 h und 1 h vorher.',
    waitlisted: '🕐 **{title}** ist voll – du stehst auf der Warteliste (Platz {pos}). Wird ein Platz frei, rückst du automatisch nach.',
    alreadyIn: 'Du bist schon angemeldet ({status}).',
    status_angemeldet: 'angemeldet',
    status_warteliste: 'Warteliste',
    status_teilgenommen: 'teilgenommen',
    status_abgemeldet: 'abgemeldet',
    left: '👋 Du bist von **{title}** abgemeldet.',
    notSignedUp: 'Du warst für diesen Playtest nicht angemeldet.',
    needRole: 'Für Playtests brauchst du die Tester-Rolle. Hol sie dir in {channel}.',
    tooYoung16: 'Dieser Playtest ist erst ab 16 Jahren.',
    ageUnknown16: 'Dieser Playtest ist ab 16 – bitte gib zuerst dein Alter über „Tester werden“ in {channel} an.',
    tooYoung: 'Playtests sind erst ab 13 Jahren möglich.',
    ptClosed: 'Für diesen Playtest ist keine Anmeldung mehr möglich.',
    ptNotFound: 'Diesen Playtest gibt es nicht (mehr).',
    startedLinkSent: ' Der Playtest läuft schon – der Link kam gerade per DM.',
    dmClosed: '\n⚠️ Ich konnte dir keine DM schicken. Bitte erlaube DMs von Servermitgliedern (Server-Einstellungen → Privatsphäre), sonst bekommst du den Link nicht.',
    // tester flow
    testerAlready: '✅ Du bist schon Tester. Termine findest du in {channel}.',
    testerPending: '⏳ Wir warten noch auf das OK deiner Eltern. Sobald es da ist, schalten wir dich frei.',
    testerAskAge: 'Wie alt bist du? Wir fragen das, damit Playtests für alle sicher bleiben.',
    agePlaceholder: 'Alter wählen',
    age_u13: 'Unter 13',
    'age_13-15': '13–15 Jahre',
    'age_16-17': '16–17 Jahre',
    'age_18+': '18 oder älter',
    testerRejectU13: 'Danke für dein Interesse! 💙 Playtests sind leider erst ab 13 Jahren möglich – das ist auch das Mindestalter von Discord. Wir freuen uns, wenn du später dabei bist!',
    testerParent: 'Danke! 🙌 Weil du unter {age} bist, brauchen wir kurz das OK deiner Eltern. {how} Sobald es da ist, schalten wir dich frei und du bekommst eine Nachricht.',
    testerParentHowEmail: 'Bitte deine Eltern, eine kurze Einverständniserklärung an {email} zu schicken – wir antworten mit der Vorlage.',
    testerParentHowTeam: 'Das Team meldet sich mit einer Vorlage für deine Eltern.',
    testerParentHowForm: 'Bitte deine Eltern, dieses kurze Formular auszufüllen: {url}',
    testerWelcome: '🎉 Willkommen im Testteam! Neue Termine erscheinen in {channel} – dort meldest du dich mit einem Klick an.',
    noTesterRole: '⚠️ Die Tester-Rolle fehlt noch. Das Team muss einmal /setup ausführen.',
    roleFailed: '⚠️ Ich konnte dir die Rolle nicht geben (fehlende Rechte). Das Team wurde informiert.',
    dmParentOk: '🎉 Deine Eltern haben zugestimmt – du bist jetzt im Testteam! Termine findest du in {channel}.',
    dmDenied: 'Deine Tester-Anfrage konnte leider nicht bestätigt werden. Bei Fragen melde dich gern beim Team.',
    staffParentTitle: '🧪 Tester-Anfrage – Eltern-OK nötig',
    staffParentDesc: '{user} möchte Tester werden (Alter: {age}).\nBitte die Einverständniserklärung der Eltern einholen (Vorlage: docs/ELTERN-EINVERSTAENDNIS.md) und erst danach bestätigen.',
    btnParentOk: 'Eltern-OK erhalten ✅',
    btnDeny: 'Ablehnen',
    staffParentDone: '✅ Eltern-OK bestätigt von {staff}',
    staffDenied: '❌ Abgelehnt von {staff}',
    testerNotFound: 'Diese Tester-Anfrage gibt es nicht mehr.',
    notStaff: 'Das darf nur das Team.',
    // command replies
    created: '✅ Playtest #{id} angelegt: **{title}** – {full}. {posted}',
    postedIn: 'Gepostet in {channel}.',
    noChannel: '⚠️ Kanal #playtest-termine fehlt – bitte /setup ausführen.',
    listTitle: '**Playtests**',
    listLine: '`#{id}` **{title}** – {full} · {status} · 👥 {n}{slots} · 📝 {fb}',
    listEmpty: 'Keine Playtests geplant.',
    cancelled: '❌ Playtest #{id} abgesagt. {n} Personen wurden benachrichtigt.',
    ended: '✅ Playtest #{id} beendet. Feedback-Anfrage an {n} Personen geschickt.',
    alreadyEnded: 'Dieser Playtest ist schon beendet oder abgesagt.',
    participantsTitle: '**Teilnehmer – Playtest #{id}: {title}**',
    participantLine: '{mention} – {status}{fb}',
    participantsEmpty: 'Noch niemand angemeldet.',
    // feedback
    fbTitle: 'Feedback: {title}',
    fbFun: 'Wie viel Spaß hattest du? (1–10)',
    fbFunPlaceholder: 'z. B. 8',
    fbLiked: 'Was war gut?',
    fbDisliked: 'Was hat genervt oder verwirrt?',
    fbBugs: 'Bugs? (Was ist wo passiert?)',
    fbOther: 'Sonstiges / Ideen',
    fbThanks: '🙏 Danke für dein Feedback zu **{title}**!{points}',
    fbPoints: ' +{n} Punkte.',
    fbBugsHint: '\nTipp: Einzelne Bugs mit Details kannst du auch mit /bug melden.',
    errFun: 'Bitte bei „Spaß“ eine Zahl von 1 bis 10 eintragen und das Formular nochmal öffnen.',
    fbNotSignedUp: 'Feedback geht nur, wenn du für diesen Playtest angemeldet warst.',
    fbNoneFound: 'Ich habe keinen Playtest gefunden, für den du angemeldet warst.',
    fbTooEarly: 'Feedback geht erst, wenn der Playtest begonnen hat.',
    // validation
    errTitle: 'Bitte einen Titel angeben (max. 100 Zeichen).',
    errDate: 'Datum/Uhrzeit nicht erkannt. Beispiel: datum 21.11.2026, uhrzeit 19:00',
    errPast: 'Der Termin liegt in der Vergangenheit.',
    errDuration: 'Die Dauer muss zwischen 10 und 600 Minuten liegen.',
    errSlots: 'Plätze müssen zwischen 1 und 1000 liegen.',
    errLink: 'Der Link ist ungültig (bitte mit https://).',
  },
  en: {
    ptWhen: '📅 {full} ({rel})',
    ptDuration: '⏱️ {min} minutes',
    ptSlots: '👥 Spots: {n}/{slots}',
    ptSlotsOpen: '👥 Signed up: {n}',
    ptWait: ' · Waitlist: {wait}',
    ptAge16: '🔞 16+ only',
    ptStatus_geplant: '🟡 Sign-up open',
    ptStatus_laeuft: '🟢 Running now',
    ptStatus_beendet: '✅ Finished – thanks for testing!',
    ptStatus_abgesagt: '❌ Cancelled',
    ptHowTo: 'Click **Join** – you get the link via DM when it starts.',
    btnJoin: 'Join',
    btnLeave: 'Leave',
    btnFeedback: 'Give feedback',
    ptRunningPost: '🟢 **{title}** is running now! Everyone signed up got the link via DM.',
    ptEndPost: '📝 **{title}** is over – thanks everyone! If you played: please leave quick feedback (2 minutes).',
    ptCancelPost: '❌ **{title}** ({full}) has been cancelled.{reason}',
    reasonLine: ' Reason: {reason}',
    dm24h: '⏰ Reminder: **{title}** is tomorrow – {full} ({rel}). See you!',
    dm1h: '⏳ Starting in one hour: **{title}** – {full}.',
    dmStartLink: '🟢 **{title}** starts now! Here is your link: {link}\nHave fun – and keep an eye out for anything odd. 😉',
    dmStartNoLink: '🟢 **{title}** starts now! All details are in #playtest-termine.',
    dmEnd: '🙏 Thanks for joining **{title}**! How was it? Your feedback helps a lot – it only takes 2 minutes.',
    dmPromoted: '🎉 A spot opened up – you are now in for the playtest **{title}**! {full}',
    dmCancelled: '❌ Sorry, the playtest **{title}** ({full}) has been cancelled.{reason}',
    joined: '✅ You are signed up for **{title}**! You get the link via DM when it starts, reminders come 24 h and 1 h before.',
    waitlisted: '🕐 **{title}** is full – you are on the waitlist (position {pos}). If a spot opens up you move up automatically.',
    alreadyIn: 'You are already signed up ({status}).',
    status_angemeldet: 'signed up',
    status_warteliste: 'waitlist',
    status_teilgenommen: 'took part',
    status_abgemeldet: 'left',
    left: '👋 You left **{title}**.',
    notSignedUp: 'You were not signed up for this playtest.',
    needRole: 'You need the Tester role for playtests. Get it in {channel}.',
    tooYoung16: 'This playtest is 16+ only.',
    ageUnknown16: 'This playtest is 16+ – please tell us your age via “become a tester” in {channel} first.',
    tooYoung: 'Playtests are only possible from age 13.',
    ptClosed: 'Sign-up for this playtest is closed.',
    ptNotFound: 'This playtest does not exist (anymore).',
    startedLinkSent: ' It is already running – the link was just sent via DM.',
    dmClosed: '\n⚠️ I could not send you a DM. Please allow DMs from server members (server settings → privacy), otherwise you will not get the link.',
    testerAlready: '✅ You are already a tester. Dates are posted in {channel}.',
    testerPending: '⏳ We are still waiting for your parents’ OK. As soon as it arrives we will unlock you.',
    testerAskAge: 'How old are you? We ask so playtests stay safe for everyone.',
    agePlaceholder: 'Choose your age',
    age_u13: 'Under 13',
    'age_13-15': '13–15 years',
    'age_16-17': '16–17 years',
    'age_18+': '18 or older',
    testerRejectU13: 'Thanks for your interest! 💙 Playtests are only possible from age 13 – that is also Discord’s minimum age. We would love to have you later!',
    testerParent: 'Thanks! 🙌 Because you are under {age}, we need a quick OK from your parents. {how} Once we have it, we unlock you and send you a message.',
    testerParentHowEmail: 'Please ask your parents to send a short consent note to {email} – we will reply with the form.',
    testerParentHowTeam: 'The team will get in touch with a form for your parents.',
    testerParentHowForm: 'Please ask your parents to fill in this short form: {url}',
    testerWelcome: '🎉 Welcome to the test team! New dates appear in {channel} – sign up there with one click.',
    noTesterRole: '⚠️ The Tester role is missing. The team has to run /setup once.',
    roleFailed: '⚠️ I could not give you the role (missing permissions). The team has been notified.',
    dmParentOk: '🎉 Your parents agreed – you are now part of the test team! Dates are posted in {channel}.',
    dmDenied: 'Sorry, your tester request could not be confirmed. Feel free to contact the team if you have questions.',
    staffParentTitle: '🧪 Tester request – parental OK needed',
    staffParentDesc: '{user} wants to become a tester (age: {age}).\nPlease get the parental consent form first (template: docs/ELTERN-EINVERSTAENDNIS.md), then confirm.',
    btnParentOk: 'Parental OK received ✅',
    btnDeny: 'Decline',
    staffParentDone: '✅ Parental OK confirmed by {staff}',
    staffDenied: '❌ Declined by {staff}',
    testerNotFound: 'This tester request no longer exists.',
    notStaff: 'Only the team can do that.',
    created: '✅ Playtest #{id} created: **{title}** – {full}. {posted}',
    postedIn: 'Posted in {channel}.',
    noChannel: '⚠️ Channel #playtest-termine is missing – please run /setup.',
    listTitle: '**Playtests**',
    listLine: '`#{id}` **{title}** – {full} · {status} · 👥 {n}{slots} · 📝 {fb}',
    listEmpty: 'No playtests planned.',
    cancelled: '❌ Playtest #{id} cancelled. {n} people were notified.',
    ended: '✅ Playtest #{id} ended. Feedback request sent to {n} people.',
    alreadyEnded: 'This playtest has already ended or was cancelled.',
    participantsTitle: '**Participants – playtest #{id}: {title}**',
    participantLine: '{mention} – {status}{fb}',
    participantsEmpty: 'Nobody signed up yet.',
    fbTitle: 'Feedback: {title}',
    fbFun: 'How much fun did you have? (1–10)',
    fbFunPlaceholder: 'e.g. 8',
    fbLiked: 'What was good?',
    fbDisliked: 'What was annoying or confusing?',
    fbBugs: 'Bugs? (what happened, where?)',
    fbOther: 'Anything else / ideas',
    fbThanks: '🙏 Thanks for your feedback on **{title}**!{points}',
    fbPoints: ' +{n} points.',
    fbBugsHint: '\nTip: you can also report single bugs with details via /bug.',
    errFun: 'Please enter a number from 1 to 10 for “fun” and open the form again.',
    fbNotSignedUp: 'Feedback is only possible if you were signed up for this playtest.',
    fbNoneFound: 'I could not find a playtest you were signed up for.',
    fbTooEarly: 'Feedback opens once the playtest has started.',
    errTitle: 'Please enter a title (max. 100 characters).',
    errDate: 'Date/time not recognised. Example: date 21.11.2026, time 19:00',
    errPast: 'That date is in the past.',
    errDuration: 'Duration must be between 10 and 600 minutes.',
    errSlots: 'Spots must be between 1 and 1000.',
    errLink: 'The link is invalid (please use https://).',
  },
};

const channelMention = (ctx, key, fallback) => (ctx.channelId(key) ? `<#${ctx.channelId(key)}>` : fallback);
const fullTime = (iso) => `${discordTs(iso, 'F')}`;
const relTime = (iso) => `${discordTs(iso, 'R')}`;
const playtestEnd = (p) => new Date(toDate(p.starts_at).getTime() + (Number(p.duration_min) || 60) * MIN);

// ---- Messages ---------------------------------------------------------------------

const STATUS_COLOR = { geplant: COLORS.primary, laeuft: COLORS.success, beendet: COLORS.info, abgesagt: COLORS.danger };

export function feedbackButtonRow(playtestId, label) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid('fb', 'open', playtestId)).setLabel(label || publicLabel(T, 'btnFeedback')).setEmoji('📝').setStyle(ButtonStyle.Primary),
  );
}

/** Embed + buttons for the playtest post in #playtest-termine. */
export function buildPlaytestMessage(p) {
  const counts = store.playtestCounts(p.id);
  const info = composePublic((lang) => {
    const lines = [
      tr(T, lang, 'ptWhen', { full: fullTime(p.starts_at), rel: relTime(p.starts_at) }),
      tr(T, lang, 'ptDuration', { min: p.duration_min }),
      (p.slots ? tr(T, lang, 'ptSlots', { n: counts.active, slots: p.slots }) : tr(T, lang, 'ptSlotsOpen', { n: counts.active })) +
        (counts.waitlist ? tr(T, lang, 'ptWait', { wait: counts.waitlist }) : ''),
    ];
    if (p.min_age >= 16) lines.push(tr(T, lang, 'ptAge16'));
    lines.push(tr(T, lang, `ptStatus_${p.status}`));
    if (p.status === 'geplant') lines.push(tr(T, lang, 'ptHowTo'));
    return lines.join('\n');
  });
  const e = embed({
    title: `🧪 ${p.title}`,
    description: (p.description ? `${p.description}\n\n` : '') + info,
    color: STATUS_COLOR[p.status] ?? COLORS.primary,
    footer: `Playtest #${p.id}`,
  });
  let components = [];
  if (p.status === 'geplant' || p.status === 'laeuft') {
    components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid('pt', 'join', p.id)).setLabel(publicLabel(T, 'btnJoin')).setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(cid('pt', 'leave', p.id)).setLabel(publicLabel(T, 'btnLeave')).setStyle(ButtonStyle.Secondary),
      ),
    ];
  } else if (p.status === 'beendet') {
    components = [feedbackButtonRow(p.id)];
  }
  return { embeds: [e], components, allowedMentions: NO_MENTIONS };
}

export async function refreshPlaytestMessage(ctx, playtestId) {
  const p = store.getPlaytest(playtestId);
  if (!p?.channel_id || !p?.message_id) return false;
  return editMessage(ctx, p.channel_id, p.message_id, buildPlaytestMessage(p));
}

function startDm(p) {
  return {
    content: composePublic((lang) => tr(T, lang, p.join_link ? 'dmStartLink' : 'dmStartNoLink', { title: p.title, link: p.join_link })),
    allowedMentions: NO_MENTIONS,
  };
}

const publicDm = (key, vars) => ({ content: composePublic((lang) => tr(T, lang, key, vars)), allowedMentions: NO_MENTIONS });

// ---- Create / cancel / end ------------------------------------------------------

/** Creates the playtest, posts it and adds a Discord server event. Returns { playtest, posted }. */
export async function createPlaytestFlow(ctx, data, createdBy = null) {
  const p = store.insertPlaytest(data, createdBy);
  const msg = await ctx.post('playtests', buildPlaytestMessage(p));
  if (msg) store.updatePlaytest(p.id, { channel_id: msg.channelId, message_id: msg.id });
  const location = strictUrl(ctx.settings().game?.url) || 'Roblox';
  const eventId = await createScheduledEvent(ctx, {
    name: `🧪 Playtest: ${p.title}`,
    start: p.starts_at,
    end: playtestEnd(p),
    description: p.description || '',
    location,
  });
  if (eventId) store.updatePlaytest(p.id, { discord_event_id: eventId });
  return { playtest: store.getPlaytest(p.id), posted: Boolean(msg) };
}

async function postInPlaytestChannel(ctx, p, payload) {
  return ctx.post('playtests', { allowedMentions: NO_MENTIONS, ...payload });
}

/** Sends the feedback request (DM + channel post). Returns the number of recipients. */
async function requestFeedback(ctx, p) {
  const recipients = store.listSignups(p.id, ['angemeldet', 'teilgenommen']).map((s) => s.discord_user_id);
  await dmMany(ctx, recipients, { ...publicDm('dmEnd', { title: p.title }), components: [feedbackButtonRow(p.id)] });
  await postInPlaytestChannel(ctx, p, {
    content: composePublic((lang) => tr(T, lang, 'ptEndPost', { title: p.title })),
    components: [feedbackButtonRow(p.id)],
  });
  await setScheduledEventStatus(ctx, p.discord_event_id, 'completed');
  return recipients.length;
}

async function performPlaytestAction(ctx, p, action) {
  const vars = { title: p.title, full: fullTime(p.starts_at), rel: relTime(p.starts_at) };
  const signedUp = () => store.listSignups(p.id, ['angemeldet']).map((s) => s.discord_user_id);
  switch (action) {
    case 'remind24h':
      await dmMany(ctx, signedUp(), publicDm('dm24h', vars));
      break;
    case 'remind1h':
      await dmMany(ctx, signedUp(), publicDm('dm1h', vars));
      break;
    case 'start':
      await dmMany(ctx, signedUp(), startDm(p));
      await postInPlaytestChannel(ctx, p, { content: composePublic((lang) => tr(T, lang, 'ptRunningPost', vars)) });
      await setScheduledEventStatus(ctx, p.discord_event_id, 'active');
      break;
    case 'end':
      await requestFeedback(ctx, p);
      break;
    case 'endQuiet':
      await setScheduledEventStatus(ctx, p.discord_event_id, 'completed');
      break;
    default:
      break;
  }
}

/** One scheduler tick (exported for tests). */
export async function runPlaytestJob(ctx, now = new Date()) {
  for (const p of store.listPlaytests({ statuses: ['geplant', 'laeuft'], limit: 200, order: 'ASC' })) {
    const { actions, flags } = playtestPlan(p, now);
    const fields = { ...flags };
    if (actions.includes('end') || actions.includes('endQuiet')) fields.status = 'beendet';
    else if (actions.includes('start')) fields.status = 'laeuft';
    if (!Object.keys(fields).length) continue;
    // Mark first so a crash never sends the same reminder twice.
    const fresh = store.updatePlaytest(p.id, fields);
    for (const action of actions) {
      try {
        await performPlaytestAction(ctx, fresh, action);
      } catch (err) {
        ctx.log.error(`Playtest #${p.id} (${action}):`, err);
      }
    }
    if (fields.status) await refreshPlaytestMessage(ctx, p.id);
  }
}

async function cancelPlaytest(ctx, p, reason) {
  store.updatePlaytest(p.id, { status: 'abgesagt', reminded_24h: 1, reminded_1h: 1, start_notified: 1, feedback_requested: 1 });
  const recipients = store.listSignups(p.id, ['angemeldet', 'warteliste']).map((s) => s.discord_user_id);
  const reasonText = (lang) => (reason ? tr(T, lang, 'reasonLine', { reason }) : '');
  await dmMany(ctx, recipients, {
    content: composePublic((lang) => tr(T, lang, 'dmCancelled', { title: p.title, full: fullTime(p.starts_at), reason: reasonText(lang) })),
    allowedMentions: NO_MENTIONS,
  });
  await postInPlaytestChannel(ctx, p, {
    content: composePublic((lang) => tr(T, lang, 'ptCancelPost', { title: p.title, full: fullTime(p.starts_at), reason: reasonText(lang) })),
  });
  await deleteScheduledEvent(ctx, p.discord_event_id);
  await refreshPlaytestMessage(ctx, p.id);
  return recipients.length;
}

async function endPlaytestNow(ctx, p) {
  const fresh = store.updatePlaytest(p.id, { status: 'beendet', reminded_24h: 1, reminded_1h: 1, start_notified: 1, feedback_requested: 1 });
  const n = await requestFeedback(ctx, fresh);
  await refreshPlaytestMessage(ctx, p.id);
  return n;
}

// ---- Tester onboarding ----------------------------------------------------------

function ageSelectRow(locale) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid('tester', 'age'))
      .setPlaceholder(tr(T, locale, 'agePlaceholder'))
      .addOptions(['u13', '13-15', '16-17', '18+'].map((value) => ({ label: tr(T, locale, `age_${value}`), value }))),
  );
}

async function testerJoin(interaction, ctx) {
  const locale = interaction.locale;
  const userId = interaction.user.id;
  const testerChannel = channelMention(ctx, 'playtests', '#playtest-termine');
  const tester = store.getTester(userId);
  if (hasAnyRole(ctx, interaction.member, ['tester']) || tester?.status === 'aktiv') {
    return replyEphemeral(interaction, tr(T, locale, 'testerAlready', { channel: testerChannel }));
  }
  if (tester?.status === 'eltern_ausstehend') return replyEphemeral(interaction, tr(T, locale, 'testerPending'));
  return replyEphemeral(interaction, { content: tr(T, locale, 'testerAskAge'), components: [ageSelectRow(locale)] });
}

async function giveTesterRole(ctx, member) {
  const roleId = ctx.roleId('tester');
  if (!roleId) return 'noRole';
  try {
    await member.roles.add(roleId, 'Tester werden');
    return 'ok';
  } catch (err) {
    ctx.log.warn('Tester-Rolle konnte nicht vergeben werden:', err.message);
    await ctx.postLog(`⚠️ Tester-Rolle konnte nicht an <@${member.id}> vergeben werden: ${err.message}`);
    return 'failed';
  }
}

async function testerAge(interaction, ctx) {
  const locale = interaction.locale;
  const ageGroup = interaction.values?.[0];
  const settings = ctx.settings();
  const decision = testerDecision(ageGroup, {
    minAge: Number(settings.discord.minAge) || 13,
    parentConsentUnder: Number(settings.discord.parentConsentUnder) || 16,
  });
  const userId = interaction.user.id;
  const tag = interaction.user.tag || interaction.user.username || null;
  const testerChannel = channelMention(ctx, 'playtests', '#playtest-termine');

  if (decision === 'reject') {
    // Nothing is stored for under-13s.
    return interaction.update({ content: tr(T, locale, 'testerRejectU13'), components: [] });
  }
  if (decision === 'parent') {
    store.upsertTester({ userId, tag, ageGroup, status: 'eltern_ausstehend' });
    const email = settings.game?.contactEmail;
    const formUrl = settings.game?.parentFormUrl;
    const how = formUrl
      ? tr(T, locale, 'testerParentHowForm', { url: formUrl })
      : email ? tr(T, locale, 'testerParentHowEmail', { email }) : tr(T, locale, 'testerParentHowTeam');
    await ctx.post('reviews', {
      embeds: [
        embed({
          title: tr(T, 'de', 'staffParentTitle'),
          description: tr(T, 'de', 'staffParentDesc', { user: mentionUser(userId), age: tr(T, 'de', `age_${ageGroup}`) }),
          color: COLORS.warning,
          footer: `Tester ${userId}`,
          timestamp: true,
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(cid('tester', 'parent', userId)).setLabel(tr(T, 'de', 'btnParentOk')).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(cid('tester', 'deny', userId)).setLabel(tr(T, 'de', 'btnDeny')).setStyle(ButtonStyle.Danger),
        ),
      ],
      allowedMentions: NO_MENTIONS,
    });
    return interaction.update({
      content: tr(T, locale, 'testerParent', { age: Number(settings.discord.parentConsentUnder) || 16, how }),
      components: [],
    });
  }
  const member = await resolveMember(interaction, ctx);
  const result = member ? await giveTesterRole(ctx, member) : 'failed';
  if (result === 'noRole') return interaction.update({ content: tr(T, locale, 'noTesterRole'), components: [] });
  if (result === 'failed') return interaction.update({ content: tr(T, locale, 'roleFailed'), components: [] });
  store.upsertTester({ userId, tag, ageGroup, status: 'aktiv' });
  return interaction.update({ content: tr(T, locale, 'testerWelcome', { channel: testerChannel }), components: [] });
}

async function testerReview(interaction, ctx, userId, approve) {
  if (!ctx.isStaff(interaction.member)) return replyEphemeral(interaction, tr(T, interaction.locale, 'notStaff'));
  const tester = store.getTester(userId);
  if (!tester) return replyEphemeral(interaction, tr(T, interaction.locale, 'testerNotFound'));
  const testerChannel = channelMention(ctx, 'playtests', '#playtest-termine');
  let line;
  if (approve) {
    const member = await ctx.member(userId);
    const result = member ? await giveTesterRole(ctx, member) : 'failed';
    store.setTesterStatus(userId, 'aktiv');
    await dmUser(ctx, userId, publicDm('dmParentOk', { channel: testerChannel }));
    line = tr(T, 'de', 'staffParentDone', { staff: mentionUser(interaction.user.id) }) + (result === 'ok' ? '' : ' (⚠️ Rolle bitte manuell vergeben)');
  } else {
    store.setTesterStatus(userId, 'entfernt');
    await dmUser(ctx, userId, publicDm('dmDenied', {}));
    line = tr(T, 'de', 'staffDenied', { staff: mentionUser(interaction.user.id) });
  }
  const old = interaction.message?.embeds?.[0];
  const updated = embed({
    title: old?.title || tr(T, 'de', 'staffParentTitle'),
    description: `${old?.description || mentionUser(userId)}\n\n${line}`,
    color: approve ? COLORS.success : COLORS.danger,
  });
  return interaction.update({ embeds: [updated], components: [], allowedMentions: NO_MENTIONS });
}

// ---- Sign-up buttons -------------------------------------------------------------

async function onJoin(interaction, ctx, id) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const locale = interaction.locale;
  const userId = interaction.user.id;
  const p = store.getPlaytest(id);
  if (!p) return interaction.editReply(tr(T, locale, 'ptNotFound'));
  if (!['geplant', 'laeuft'].includes(p.status)) return interaction.editReply(tr(T, locale, 'ptClosed'));
  const joinChannel = channelMention(ctx, 'testerJoin', '#tester-werden');
  const member = interaction.member;
  if (!ctx.isStaff(member) && !hasAnyRole(ctx, member, ['tester', 'creator'])) {
    return interaction.editReply(tr(T, locale, 'needRole', { channel: joinChannel }));
  }
  const tester = store.getTester(userId);
  if (tester?.status === 'eltern_ausstehend') return interaction.editReply(tr(T, locale, 'testerPending'));
  if (!ctx.isStaff(member)) {
    const elig = ageEligible(store.getUserAgeGroup(userId), p.min_age);
    if (!elig.ok) {
      const key = elig.reason === 'ageUnknown' ? 'ageUnknown16' : p.min_age >= 16 ? 'tooYoung16' : 'tooYoung';
      return interaction.editReply(tr(T, locale, key, { channel: joinChannel }));
    }
  }
  const res = store.signUp(id, userId);
  if (!res.changed) return interaction.editReply(tr(T, locale, 'alreadyIn', { status: tr(T, locale, `status_${res.status}`) }));
  let text;
  if (res.status === 'angemeldet') {
    text = tr(T, locale, 'joined', { title: p.title });
    if (p.status === 'laeuft' && p.start_notified) {
      const ok = await dmUser(ctx, userId, startDm(p));
      text += ok ? tr(T, locale, 'startedLinkSent') : tr(T, locale, 'dmClosed');
    }
  } else {
    const pos = store.listSignups(id, ['warteliste']).findIndex((s) => s.discord_user_id === userId) + 1;
    text = tr(T, locale, 'waitlisted', { title: p.title, pos });
  }
  await refreshPlaytestMessage(ctx, id);
  return interaction.editReply(text);
}

async function onLeave(interaction, ctx, id) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const locale = interaction.locale;
  const p = store.getPlaytest(id);
  if (!p) return interaction.editReply(tr(T, locale, 'ptNotFound'));
  if (!['geplant', 'laeuft'].includes(p.status)) return interaction.editReply(tr(T, locale, 'ptClosed'));
  const res = store.leave(id, interaction.user.id);
  if (!res.previous || res.previous === 'abgemeldet') return interaction.editReply(tr(T, locale, 'notSignedUp'));
  for (const promotedId of res.promoted) {
    await dmUser(ctx, promotedId, publicDm('dmPromoted', { title: p.title, full: fullTime(p.starts_at) }));
    if (p.status === 'laeuft' && p.start_notified) await dmUser(ctx, promotedId, startDm(p));
  }
  await refreshPlaytestMessage(ctx, id);
  return interaction.editReply(tr(T, locale, 'left', { title: p.title }));
}

// ---- Feedback --------------------------------------------------------------------

function canGiveFeedback(p, userId, now = new Date()) {
  if (!p) return 'ptNotFound';
  if (toDate(p.starts_at).getTime() > now.getTime()) return 'fbTooEarly';
  const signup = store.getSignup(p.id, userId);
  if (!signup || !['angemeldet', 'teilgenommen'].includes(signup.status)) return 'fbNotSignedUp';
  return null;
}

function textInput(id, label, style, { required = false, max = 1000, placeholder, value } = {}) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required).setMaxLength(max);
  if (placeholder) input.setPlaceholder(placeholder.slice(0, 100));
  if (value) input.setValue(String(value).slice(0, max));
  return new ActionRowBuilder().addComponents(input);
}

export function buildFeedbackModal(p, locale, existing = null) {
  return new ModalBuilder()
    .setCustomId(cid('fb', 'submit', p.id))
    .setTitle(truncate(tr(T, locale, 'fbTitle', { title: p.title }), 45))
    .addComponents(
      textInput('fun', tr(T, locale, 'fbFun'), TextInputStyle.Short, {
        required: true,
        max: 10,
        placeholder: tr(T, locale, 'fbFunPlaceholder'),
        value: existing?.fun_rating ? String(existing.fun_rating) : undefined,
      }),
      textInput('liked', tr(T, locale, 'fbLiked'), TextInputStyle.Paragraph, { value: existing?.liked }),
      textInput('disliked', tr(T, locale, 'fbDisliked'), TextInputStyle.Paragraph, { value: existing?.disliked }),
      textInput('bugs', tr(T, locale, 'fbBugs'), TextInputStyle.Paragraph, { value: existing?.bugs }),
      textInput('other', tr(T, locale, 'fbOther'), TextInputStyle.Paragraph, { value: existing?.other }),
    );
}

async function openFeedback(interaction, ctx, id) {
  const p = store.getPlaytest(id);
  const problem = canGiveFeedback(p, interaction.user.id);
  if (problem) return replyEphemeral(interaction, tr(T, interaction.locale, problem));
  const existing = store.listFeedback(p.id).find((f) => f.discord_user_id === interaction.user.id) || null;
  return interaction.showModal(buildFeedbackModal(p, interaction.locale, existing));
}

async function submitFeedback(interaction, ctx, id) {
  const locale = interaction.locale;
  const p = store.getPlaytest(id);
  const problem = canGiveFeedback(p, interaction.user.id);
  if (problem) return replyEphemeral(interaction, tr(T, locale, problem));
  const get = (field) => {
    try {
      return interaction.fields.getTextInputValue(field);
    } catch {
      return '';
    }
  };
  const result = validateFeedback({ fun: get('fun'), liked: get('liked'), disliked: get('disliked'), bugs: get('bugs'), other: get('other') });
  if (!result.ok) return replyEphemeral(interaction, tr(T, locale, result.error));
  const saved = store.saveFeedback(p.id, interaction.user.id, result.value);
  const points = saved.pointsAwarded ? tr(T, locale, 'fbPoints', { n: saved.pointsAwarded }) : '';
  const hint = result.value.bugs ? tr(T, locale, 'fbBugsHint') : '';
  return replyEphemeral(interaction, tr(T, locale, 'fbThanks', { title: p.title, points }) + hint);
}

/** Latest playtest (already started) the user is signed up for. */
function latestPlaytestFor(userId, now = new Date()) {
  return (
    store
      .listPlaytests({ limit: 50 })
      .filter((p) => p.status !== 'abgesagt' && toDate(p.starts_at).getTime() <= now.getTime())
      .find((p) => {
        const s = store.getSignup(p.id, userId);
        return s && ['angemeldet', 'teilgenommen'].includes(s.status);
      }) || null
  );
}

// ---- Slash commands ---------------------------------------------------------------

const playtestCommand = new SlashCommandBuilder()
  .setName('playtest')
  .setDescription('Playtests verwalten (Team)')
  .setDescriptionLocalizations(LOC('Manage playtests (team)'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('erstellen')
      .setNameLocalizations(LOC('create'))
      .setDescription('Neuen Playtest-Termin anlegen und posten')
      .setDescriptionLocalizations(LOC('Create and post a new playtest'))
      .addStringOption((o) => o.setName('titel').setNameLocalizations(LOC('title')).setDescription('Titel, z. B. „Waffen-Test #2“').setDescriptionLocalizations(LOC('Title')).setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('datum').setNameLocalizations(LOC('date')).setDescription('Datum, z. B. 21.11.2026').setDescriptionLocalizations(LOC('Date, e.g. 21.11.2026')).setRequired(true).setMaxLength(20))
      .addStringOption((o) => o.setName('uhrzeit').setNameLocalizations(LOC('time')).setDescription('Uhrzeit (deutsche Zeit), z. B. 19:00').setDescriptionLocalizations(LOC('Time (German time), e.g. 19:00')).setRequired(true).setMaxLength(10))
      .addIntegerOption((o) => o.setName('dauer').setNameLocalizations(LOC('duration')).setDescription('Dauer in Minuten (Standard 60)').setDescriptionLocalizations(LOC('Duration in minutes (default 60)')).setMinValue(10).setMaxValue(600))
      .addIntegerOption((o) => o.setName('plaetze').setNameLocalizations(LOC('slots')).setDescription('Maximale Teilnehmer (leer = unbegrenzt)').setDescriptionLocalizations(LOC('Max participants (empty = unlimited)')).setMinValue(1).setMaxValue(1000))
      .addStringOption((o) => o.setName('link').setNameLocalizations(LOC('link')).setDescription('Join-Link (z. B. privater Server) – nur per DM an Angemeldete').setDescriptionLocalizations(LOC('Join link (e.g. private server) – sent by DM only')).setMaxLength(500))
      .addStringOption((o) => o.setName('beschreibung').setNameLocalizations(LOC('description')).setDescription('Was wird getestet?').setDescriptionLocalizations(LOC('What will be tested?')).setMaxLength(1000))
      .addBooleanOption((o) => o.setName('ab16').setNameLocalizations(LOC('age16')).setDescription('Nur für Tester ab 16').setDescriptionLocalizations(LOC('Testers aged 16+ only'))),
  )
  .addSubcommand((s) => s.setName('liste').setNameLocalizations(LOC('list')).setDescription('Geplante Playtests anzeigen').setDescriptionLocalizations(LOC('Show planned playtests')))
  .addSubcommand((s) =>
    s
      .setName('absagen')
      .setNameLocalizations(LOC('cancel'))
      .setDescription('Playtest absagen (alle Angemeldeten bekommen eine DM)')
      .setDescriptionLocalizations(LOC('Cancel a playtest (everyone signed up gets a DM)'))
      .addIntegerOption((o) => o.setName('id').setDescription('Playtest').setDescriptionLocalizations(LOC('Playtest')).setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('grund').setNameLocalizations(LOC('reason')).setDescription('Grund (optional)').setDescriptionLocalizations(LOC('Reason (optional)')).setMaxLength(300)),
  )
  .addSubcommand((s) =>
    s
      .setName('beenden')
      .setNameLocalizations(LOC('end'))
      .setDescription('Playtest jetzt beenden und Feedback anfragen')
      .setDescriptionLocalizations(LOC('End the playtest now and ask for feedback'))
      .addIntegerOption((o) => o.setName('id').setDescription('Playtest').setDescriptionLocalizations(LOC('Playtest')).setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('teilnehmer')
      .setNameLocalizations(LOC('participants'))
      .setDescription('Angemeldete und Feedback anzeigen')
      .setDescriptionLocalizations(LOC('Show participants and feedback'))
      .addIntegerOption((o) => o.setName('id').setDescription('Playtest').setDescriptionLocalizations(LOC('Playtest')).setRequired(true).setAutocomplete(true)),
  );

const feedbackCommand = new SlashCommandBuilder()
  .setName('feedback')
  .setDescription('Feedback zu einem Playtest geben')
  .setDescriptionLocalizations(LOC('Give feedback on a playtest'))
  .addIntegerOption((o) => o.setName('playtest').setDescription('Welcher Playtest? (leer = der letzte)').setDescriptionLocalizations(LOC('Which playtest? (empty = the latest)')).setAutocomplete(true));

function statusLabel(locale, status) {
  return tr(T, locale, `ptStatus_${status}`).replace(/^\S+\s/, '');
}

function shortWhen(iso) {
  const tz = 'Europe/Berlin';
  return `${formatDate(iso, 'de', tz, { year: false }).replace(/^[^,]+,\s*/, '')} ${formatTime(iso, 'de', tz)}`;
}

async function cmdCreate(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const locale = interaction.locale;
  const o = interaction.options;
  const settings = ctx.settings();
  let data;
  try {
    data = parsePlaytestInput(
      {
        title: o.getString('titel'),
        date: o.getString('datum'),
        time: o.getString('uhrzeit'),
        duration_min: o.getInteger('dauer'),
        slots: o.getInteger('plaetze'),
        join_link: o.getString('link'),
        description: o.getString('beschreibung'),
        ab16: o.getBoolean('ab16'),
      },
      { timezone: settings.game?.timezone, minAge: settings.discord?.minAge },
    );
  } catch (err) {
    if (err instanceof ValidationError) return interaction.editReply(tr(T, locale, err.key));
    throw err;
  }
  const { playtest, posted } = await createPlaytestFlow(ctx, data, interaction.user.id);
  const postedText = posted ? tr(T, locale, 'postedIn', { channel: channelMention(ctx, 'playtests', '#playtest-termine') }) : tr(T, locale, 'noChannel');
  return interaction.editReply(tr(T, locale, 'created', { id: playtest.id, title: playtest.title, full: fullTime(playtest.starts_at), posted: postedText }));
}

async function cmdList(interaction) {
  const locale = interaction.locale;
  const upcoming = store.listPlaytests({ statuses: ['geplant', 'laeuft'], limit: 25, order: 'ASC' });
  const recent = store.listPlaytests({ statuses: ['beendet'], limit: 3 });
  const rows = [...upcoming, ...recent];
  if (!rows.length) return replyEphemeral(interaction, tr(T, locale, 'listEmpty'));
  const lines = rows.map((p) => {
    const c = store.playtestCounts(p.id);
    return tr(T, locale, 'listLine', {
      id: p.id,
      title: p.title,
      full: fullTime(p.starts_at),
      status: statusLabel(locale, p.status),
      n: c.active,
      slots: p.slots ? `/${p.slots}` : '',
      fb: c.feedback,
    });
  });
  const [first] = chunkText([tr(T, locale, 'listTitle'), ...lines].join('\n'));
  return replyEphemeral(interaction, { content: first, allowedMentions: NO_MENTIONS });
}

async function cmdCancel(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const locale = interaction.locale;
  const p = store.getPlaytest(interaction.options.getInteger('id'));
  if (!p) return interaction.editReply(tr(T, locale, 'ptNotFound'));
  if (['beendet', 'abgesagt'].includes(p.status)) return interaction.editReply(tr(T, locale, 'alreadyEnded'));
  const n = await cancelPlaytest(ctx, p, interaction.options.getString('grund'));
  return interaction.editReply(tr(T, locale, 'cancelled', { id: p.id, n }));
}

async function cmdEnd(interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const locale = interaction.locale;
  const p = store.getPlaytest(interaction.options.getInteger('id'));
  if (!p) return interaction.editReply(tr(T, locale, 'ptNotFound'));
  if (['beendet', 'abgesagt'].includes(p.status)) return interaction.editReply(tr(T, locale, 'alreadyEnded'));
  const n = await endPlaytestNow(ctx, p);
  return interaction.editReply(tr(T, locale, 'ended', { id: p.id, n }));
}

async function cmdParticipants(interaction) {
  const locale = interaction.locale;
  const p = store.getPlaytest(interaction.options.getInteger('id'));
  if (!p) return replyEphemeral(interaction, tr(T, locale, 'ptNotFound'));
  const signups = store.listSignups(p.id).filter((s) => s.status !== 'abgemeldet');
  const fbUsers = new Set(store.listFeedback(p.id).map((f) => f.discord_user_id));
  const header = tr(T, locale, 'participantsTitle', { id: p.id, title: p.title });
  if (!signups.length) return replyEphemeral(interaction, `${header}\n${tr(T, locale, 'participantsEmpty')}`);
  const lines = signups.map((s) =>
    tr(T, locale, 'participantLine', { mention: mentionUser(s.discord_user_id), status: tr(T, locale, `status_${s.status}`), fb: fbUsers.has(s.discord_user_id) ? ' · 📝' : '' }),
  );
  const chunks = chunkText([header, ...lines].join('\n'));
  await replyEphemeral(interaction, { content: chunks[0], allowedMentions: NO_MENTIONS });
  for (const extra of chunks.slice(1, 5)) await interaction.followUp({ content: extra, flags: EPHEMERAL, allowedMentions: NO_MENTIONS });
  return null;
}

function autocompleteChoices(rows, focused) {
  const q = String(focused ?? '').toLowerCase().replace(/^#/, '');
  return rows
    .filter((p) => !q || String(p.id).startsWith(q) || p.title.toLowerCase().includes(q))
    .slice(0, 25)
    .map((p) => ({ name: truncate(`#${p.id} · ${p.title} · ${shortWhen(p.starts_at)}`, 100), value: p.id }));
}

// ---- Module -------------------------------------------------------------------------

export default {
  name: 'playtests',
  commands: [playtestCommand, feedbackCommand],
  commandHandlers: {
    async playtest(interaction, ctx) {
      if (!ctx.isStaff(interaction.member)) return replyEphemeral(interaction, tr(T, interaction.locale, 'notStaff'));
      const sub = interaction.options.getSubcommand();
      if (sub === 'erstellen') return cmdCreate(interaction, ctx);
      if (sub === 'liste') return cmdList(interaction, ctx);
      if (sub === 'absagen') return cmdCancel(interaction, ctx);
      if (sub === 'beenden') return cmdEnd(interaction, ctx);
      if (sub === 'teilnehmer') return cmdParticipants(interaction, ctx);
      return null;
    },
    async feedback(interaction, ctx) {
      const chosen = interaction.options.getInteger('playtest');
      const p = chosen ? store.getPlaytest(chosen) : latestPlaytestFor(interaction.user.id);
      if (!p) return replyEphemeral(interaction, tr(T, interaction.locale, chosen ? 'ptNotFound' : 'fbNoneFound'));
      return openFeedback(interaction, ctx, p.id);
    },
  },
  autocomplete: {
    async playtest(interaction) {
      const rows = store.listPlaytests({ limit: 50 });
      rows.sort((a, b) => Number(['geplant', 'laeuft'].includes(b.status)) - Number(['geplant', 'laeuft'].includes(a.status)));
      return interaction.respond(autocompleteChoices(rows, interaction.options.getFocused()));
    },
    async feedback(interaction) {
      const userId = interaction.user.id;
      const rows = store.listPlaytests({ limit: 50 }).filter((p) => {
        const s = store.getSignup(p.id, userId);
        return p.status !== 'abgesagt' && s && ['angemeldet', 'teilgenommen'].includes(s.status);
      });
      return interaction.respond(autocompleteChoices(rows, interaction.options.getFocused()));
    },
  },
  buttons: {
    async pt(interaction, ctx) {
      const { action, args } = parseCid(interaction.customId);
      const id = Number(args[0]);
      if (action === 'join') return onJoin(interaction, ctx, id);
      if (action === 'leave') return onLeave(interaction, ctx, id);
      return null;
    },
    async tester(interaction, ctx) {
      const { action, args } = parseCid(interaction.customId);
      if (action === 'join') return testerJoin(interaction, ctx);
      if (action === 'parent') return testerReview(interaction, ctx, args[0], true);
      if (action === 'deny') return testerReview(interaction, ctx, args[0], false);
      return null;
    },
    async fb(interaction, ctx) {
      const { action, args } = parseCid(interaction.customId);
      if (action === 'open') return openFeedback(interaction, ctx, Number(args[0]));
      return null;
    },
  },
  selects: {
    async tester(interaction, ctx) {
      const { action } = parseCid(interaction.customId);
      if (action === 'age') return testerAge(interaction, ctx);
      return null;
    },
  },
  modals: {
    async fb(interaction, ctx) {
      const { action, args } = parseCid(interaction.customId);
      if (action === 'submit') return submitFeedback(interaction, ctx, Number(args[0]));
      return null;
    },
  },
  events: {},
  jobs: [{ name: 'scheduler', everyMs: 60_000, run: (ctx) => runPlaytestJob(ctx) }],
  async onReady(ctx) {
    ctx.provide('createPlaytest', async (data = {}) => {
      const settings = ctx.settings();
      const parsed = parsePlaytestInput(data, { timezone: settings.game?.timezone, minAge: settings.discord?.minAge });
      const { playtest } = await createPlaytestFlow(ctx, parsed, null);
      return playtest;
    });
  },
};
