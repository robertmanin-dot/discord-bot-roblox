// What /setup creates: roles, categories, channels and their permission overwrites.
// Only permissions the bot itself has (BOT_PERMISSIONS) are used, otherwise Discord rejects the overwrite.
import { ChannelType, OverwriteType } from 'discord.js';

export const ROLE_PLAN = [
  { key: 'creator', name: 'Creator', color: 0xe91e63, hoist: true },
  { key: 'founding', name: 'Founding Creator', color: 0xf1c40f, hoist: true },
  { key: 'tester', name: 'Tester', color: 0x3ba7ff, hoist: false },
  { key: 'staff', name: 'Creator-Team', nameSetting: 'staffRoleName', color: 0x5865f2, hoist: true },
];

const VIEW = ['ViewChannel', 'ReadMessageHistory'];
const TALK = ['SendMessages', 'AddReactions', 'EmbedLinks', 'AttachFiles', 'SendMessagesInThreads'];
const NO_TALK = ['SendMessages', 'CreatePublicThreads', 'SendMessagesInThreads'];
const BOT = [
  'ViewChannel', 'ReadMessageHistory', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ManageMessages',
  'AddReactions', 'CreatePublicThreads', 'SendMessagesInThreads', 'ManageThreads', 'CreateInstantInvite',
];
const MEMBERS = ['creator', 'founding'];
const PLAYERS = ['tester', 'creator', 'founding'];

const forRoles = (roles, allow, deny = []) => roles.map((r) => ({ target: r, allow, deny }));

/** Permission recipes. Targets: 'everyone', 'bot' or a role key. */
export const ACCESS = {
  public: [{ target: 'everyone', allow: VIEW }, { target: 'bot', allow: BOT }],
  publicReadOnly: [
    { target: 'everyone', allow: VIEW, deny: NO_TALK },
    { target: 'staff', allow: [...VIEW, 'SendMessages'] },
    { target: 'bot', allow: BOT },
  ],
  hq: [
    { target: 'everyone', deny: ['ViewChannel'] },
    ...forRoles(MEMBERS, VIEW),
    { target: 'staff', allow: [...VIEW, ...TALK] },
    { target: 'bot', allow: BOT },
  ],
  hqReadOnly: [
    { target: 'everyone', deny: ['ViewChannel'] },
    ...forRoles(MEMBERS, VIEW, NO_TALK),
    { target: 'staff', allow: [...VIEW, ...TALK] },
    { target: 'bot', allow: BOT },
  ],
  hqChat: [
    { target: 'everyone', deny: ['ViewChannel'] },
    ...forRoles(MEMBERS, [...VIEW, ...TALK]),
    { target: 'staff', allow: [...VIEW, ...TALK] },
    { target: 'bot', allow: BOT },
  ],
  playtest: [
    { target: 'everyone', deny: ['ViewChannel'] },
    ...forRoles(PLAYERS, VIEW),
    { target: 'staff', allow: [...VIEW, ...TALK] },
    { target: 'bot', allow: BOT },
  ],
  playtestReadOnly: [
    { target: 'everyone', deny: ['ViewChannel'] },
    ...forRoles(PLAYERS, VIEW, NO_TALK),
    { target: 'staff', allow: [...VIEW, ...TALK] },
    { target: 'bot', allow: BOT },
  ],
  playtestThreads: [
    { target: 'everyone', deny: ['ViewChannel'] },
    ...forRoles(PLAYERS, [...VIEW, 'SendMessagesInThreads'], ['SendMessages', 'CreatePublicThreads']),
    { target: 'staff', allow: [...VIEW, ...TALK] },
    { target: 'bot', allow: BOT },
  ],
  playtestChat: [
    { target: 'everyone', deny: ['ViewChannel'] },
    ...forRoles(PLAYERS, [...VIEW, ...TALK]),
    { target: 'staff', allow: [...VIEW, ...TALK] },
    { target: 'bot', allow: BOT },
  ],
  team: [
    { target: 'everyone', deny: ['ViewChannel'] },
    { target: 'staff', allow: [...VIEW, ...TALK] },
    { target: 'bot', allow: BOT },
  ],
};

export const CHANNEL_PLAN = [
  { key: 'catPublic', name: '📣 CREATOR & TESTER', category: true, access: 'public' },
  { key: 'infos', name: 'creator-infos', parent: 'catPublic', access: 'publicReadOnly', topic: 'Das Founding-Creator-Programm kurz erklärt · The Founding Creator program' },
  { key: 'apply', name: 'creator-bewerbung', parent: 'catPublic', access: 'publicReadOnly', topic: 'Hier als Creator bewerben · Apply as a creator' },
  { key: 'testerJoin', name: 'tester-werden', parent: 'catPublic', access: 'publicReadOnly', topic: 'Hier Tester werden · Become a playtester' },

  { key: 'catHq', name: '🎬 CREATOR HQ', category: true, access: 'hq' },
  { key: 'start', name: 'start-hier', parent: 'catHq', access: 'hqReadOnly', topic: 'Erste Schritte für Creator · First steps' },
  { key: 'kit', name: 'creator-kit', parent: 'catHq', access: 'hqReadOnly', topic: 'Trailer, Thumbnails, Logo, Infos · Creator kit' },
  { key: 'launch', name: 'launch-und-events', parent: 'catHq', access: 'hqReadOnly', topic: 'Launch Hour, Events, Countdown, Spielerzahl' },
  { key: 'chat', name: 'creator-chat', parent: 'catHq', access: 'hqChat', topic: 'Austausch unter Creatorn · Creator chat' },
  { key: 'live', name: 'jetzt-live', parent: 'catHq', access: 'hqReadOnly', topic: 'Wer gerade live ist · Who is live (/live)' },
  { key: 'leaderboard', name: 'rangliste', parent: 'catHq', access: 'hqReadOnly', topic: 'Punkte und Stufen · Leaderboard' },

  { key: 'catPlaytest', name: '🧪 PLAYTESTS', category: true, access: 'playtest' },
  { key: 'playtests', name: 'playtest-termine', parent: 'catPlaytest', access: 'playtestReadOnly', topic: 'Termine und Anmeldung · Playtest sessions' },
  { key: 'bugs', name: 'bug-meldungen', parent: 'catPlaytest', access: 'playtestThreads', topic: 'Bugs mit /bug melden · Report bugs with /bug' },
  { key: 'testerChat', name: 'tester-chat', parent: 'catPlaytest', access: 'playtestChat', topic: 'Austausch unter Testern · Tester chat' },

  { key: 'catTeam', name: '🔒 TEAM', category: true, access: 'team' },
  { key: 'reviews', name: 'bewerbungen', parent: 'catTeam', access: 'team', topic: 'Bewerbungen und Content prüfen' },
  { key: 'outreachLog', name: 'outreach-log', parent: 'catTeam', access: 'team', topic: 'Beitritte über persönliche Einladungslinks, Annahmen' },
  { key: 'botLog', name: 'bot-log', parent: 'catTeam', access: 'team', topic: 'Fehler und Hinweise des Bots' },
];

/** All permission names used anywhere in the plan (for checks against BOT_PERMISSIONS). */
export function permissionsUsed() {
  const set = new Set();
  for (const recipe of Object.values(ACCESS)) {
    for (const o of recipe) for (const p of [...(o.allow || []), ...(o.deny || [])]) set.add(p);
  }
  return [...set];
}

/**
 * Turns a recipe into discord.js permissionOverwrites. Targets whose role id is unknown are skipped.
 * ids: { everyoneId, botId, roles: { key: id } }
 */
export function resolveOverwrites(accessKey, { everyoneId, botId, roles = {} }) {
  const recipe = ACCESS[accessKey];
  if (!recipe) throw new Error(`Unbekanntes Rechte-Rezept: ${accessKey}`);
  const out = [];
  for (const o of recipe) {
    let id = null;
    let type = OverwriteType.Role;
    if (o.target === 'everyone') id = everyoneId;
    else if (o.target === 'bot') {
      id = botId;
      type = OverwriteType.Member;
    } else id = roles[o.target];
    if (!id) continue;
    const existing = out.find((x) => x.id === id);
    if (existing) {
      existing.allow = [...new Set([...existing.allow, ...(o.allow || [])])];
      existing.deny = [...new Set([...existing.deny, ...(o.deny || [])])].filter((p) => !existing.allow.includes(p));
    } else {
      out.push({ id, type, allow: [...(o.allow || [])], deny: [...(o.deny || [])] });
    }
  }
  return out;
}

export const channelTypeOf = (item) => (item.category ? ChannelType.GuildCategory : ChannelType.GuildText);
