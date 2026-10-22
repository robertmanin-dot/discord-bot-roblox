// /hilfe – lists the commands that fit the person (everyone, creators, testers, team).
import { SlashCommandBuilder } from 'discord.js';
import { COLORS, embed, replyEphemeral } from '../util.js';
import { enLoc } from '../lib/common.js';
import { hasRole, isStaffInteraction } from '../lib/rules.js';

const SECTIONS = {
  de: {
    title: '❓ Befehle im Überblick',
    everyone: {
      name: 'Für alle',
      lines: [
        '`/hilfe` – diese Übersicht',
        '`/bug` – einen Fehler im Spiel melden',
        '`/rangliste` – Creator- und Tester-Rangliste',
        'Bewerben: Button in **#creator-bewerbung** · Tester werden: Button in **#tester-werden**',
      ],
    },
    creator: {
      name: 'Für Creator',
      lines: [
        '`/creator code` – dein Creator-Code und Share Link',
        '`/creator profil` – Punkte, Platz und Stufe',
        '`/live link` – sag Bescheid, wenn du live bist (Punkte!)',
        '`/content link typ` – Video/Short/Stream einreichen (Punkte nach Prüfung)',
      ],
    },
    tester: {
      name: 'Für Tester',
      lines: [
        'Termine & Anmeldung in **#playtest-termine**',
        '`/feedback` – Feedback zum letzten Playtest',
        '`/bug` – Fehler melden (bestätigte Bugs geben Punkte)',
      ],
    },
    team: {
      name: 'Für das Team',
      lines: [
        '`/setup` – Rollen, Kanäle und Panels anlegen oder reparieren',
        '`/creator info|link|code-setzen|punkte|entfernen` – Creator verwalten',
        '`/playtest erstellen|liste|absagen|beenden|teilnehmer` – Playtests',
        '`/event erstellen|liste|absagen` – Launch Hour und Events',
        'Bewerbungen & Content prüfen: Buttons in **#bewerbungen**',
      ],
    },
    footer: 'Belohnungen sind Status, Ränge und Ingame-Items – keine Gewinnspiele mit Robux oder Geld.',
  },
  en: {
    title: '❓ Commands at a glance',
    everyone: {
      name: 'For everyone',
      lines: [
        '`/help` – this overview',
        '`/bug` – report a bug in the game',
        '`/leaderboard` – creator and tester leaderboards',
        'Apply: button in **#creator-bewerbung** · Become a tester: button in **#tester-werden**',
      ],
    },
    creator: {
      name: 'For creators',
      lines: [
        '`/creator code` – your creator code and share link',
        '`/creator profile` – points, rank and tier',
        "`/live link` – let everyone know you're live (points!)",
        '`/content link type` – submit a video/short/stream (points after review)',
      ],
    },
    tester: {
      name: 'For testers',
      lines: [
        'Sessions & sign-up in **#playtest-termine**',
        '`/feedback` – feedback on the last playtest',
        '`/bug` – report bugs (confirmed bugs earn points)',
      ],
    },
    team: {
      name: 'For the team',
      lines: [
        '`/setup` – create or repair roles, channels and panels',
        '`/creator info|link|set-code|points|remove` – manage creators',
        '`/playtest …` – playtests',
        '`/event …` – launch hour and events',
        'Review applications & content: buttons in **#bewerbungen**',
      ],
    },
    footer: 'Rewards are status, ranks and in-game items – no giveaways with Robux or money.',
  },
};

/** Which sections a person sees. */
export function helpSections(lang, { isCreator, isTester, isStaff }) {
  const d = SECTIONS[lang] || SECTIONS.de;
  const out = [d.everyone];
  if (isCreator || isStaff) out.push(d.creator);
  if (isTester || isCreator || isStaff) out.push(d.tester);
  if (isStaff) out.push(d.team);
  return { title: d.title, footer: d.footer, sections: out };
}

const command = new SlashCommandBuilder()
  .setName('hilfe')
  .setNameLocalizations(enLoc('help'))
  .setDescription('Alle Befehle im Überblick')
  .setDescriptionLocalizations(enLoc('All commands at a glance'));

async function onHilfe(interaction, ctx) {
  const lang = String(interaction.locale || '').startsWith('de') ? 'de' : 'en';
  const member = interaction.member;
  const { title, footer, sections } = helpSections(lang, {
    isStaff: isStaffInteraction(interaction, ctx),
    isCreator: hasRole(member, ctx.roleId('creator')) || hasRole(member, ctx.roleId('founding')),
    isTester: hasRole(member, ctx.roleId('tester')),
  });
  return replyEphemeral(interaction, {
    embeds: [embed({ title, color: COLORS.primary, fields: sections.map((s) => ({ name: s.name, value: s.lines.join('\n') })), footer })],
  });
}

export default {
  name: 'help',
  commands: [command],
  commandHandlers: { hilfe: onHilfe },
  buttons: {},
  selects: {},
  modals: {},
  events: {},
  jobs: [],
  async onReady() {},
};
