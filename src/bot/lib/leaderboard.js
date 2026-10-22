// Leaderboard texts and embeds (used by /rangliste, the #rangliste panel and /setup).
import { getLeaderboard, tierFor } from '../../core/points.js';
import { COLORS, embed, fill } from '../util.js';
import { displayNameFor } from './common.js';

const MEDALS = ['🥇', '🥈', '🥉'];

const T = {
  de: {
    creatorTitle: '🏆 Creator-Rangliste',
    testerTitle: '🧪 Tester-Rangliste',
    empty: 'Noch keine Punkte – das ändert sich bald!',
    points: 'Punkte',
    footer: 'Punkte gibt es für Videos, Streams, Playtests und Feedback · Stufen: {tiers}',
  },
  en: {
    creatorTitle: '🏆 Creator leaderboard',
    testerTitle: '🧪 Tester leaderboard',
    empty: 'No points yet – that will change soon!',
    points: 'points',
    footer: 'Earn points with videos, streams, playtests and feedback · Tiers: {tiers}',
  },
};

/**
 * One line per entry: "🥇 <@id> (Name) – 320 Punkte · Gold".
 * rows: [{ discord_user_id, points }], nameFor(id) -> string|null, tierOf(points) -> { name }
 */
export function formatLeaderboardLines(rows, { lang = 'de', nameFor = () => null, tierOf = tierFor } = {}) {
  const word = T[lang]?.points || T.de.points;
  return rows.map((r, i) => {
    const rank = MEDALS[i] || `**${i + 1}.**`;
    const name = nameFor(r.discord_user_id);
    const who = `<@${r.discord_user_id}>${name ? ` (${name})` : ''}`;
    return `${rank} ${who} – ${r.points} ${word} · ${tierOf(r.points).name}`;
  });
}

function tiersText(tiers) {
  return (tiers || []).map((t) => `${t.name} ${t.min}+`).join(', ');
}

/** Embed for one leaderboard kind ('creator' | 'tester'). */
export function leaderboardEmbed(kind, { lang = 'de', limit = 15, tiers = [] } = {}) {
  const dict = T[lang] || T.de;
  const rows = getLeaderboard(kind, limit);
  const lines = formatLeaderboardLines(rows, { lang, nameFor: displayNameFor });
  return embed({
    title: kind === 'tester' ? dict.testerTitle : dict.creatorTitle,
    description: lines.length ? lines.join('\n') : dict.empty,
    color: kind === 'tester' ? COLORS.info : COLORS.gold,
    footer: fill(dict.footer, { tiers: tiersText(tiers) }),
    timestamp: true,
  });
}

/** Payload for the #rangliste panel (both leaderboards). */
export function leaderboardPanelPayload(settings) {
  const lang = settings.discord?.serverLanguage === 'en' ? 'en' : 'de';
  return {
    embeds: [
      leaderboardEmbed('creator', { lang, tiers: settings.tiers }),
      leaderboardEmbed('tester', { lang, tiers: settings.tiers }),
    ],
    allowedMentions: { parse: [] },
  };
}
