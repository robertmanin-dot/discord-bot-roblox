// App settings stored in the database (table `settings`, one JSON value per top-level key).
// Defaults below are merged with what the user saved in the dashboard.
import { getDb } from './db.js';
import { bus } from './bus.js';
import { deepMerge, getPath, safeJson } from './util.js';

export const DEFAULTS = {
  activeCampaignId: 1,

  game: {
    name: '',                 // Spielname
    pitch_de: '',             // 1–2 Sätze auf Deutsch
    pitch_en: '',             // 1–2 sentences in English
    url: '',                  // Link zum Spiel (roblox.com/games/...)
    placeId: '',
    universeId: '',           // für Live-Spielerzahl (wird aus placeId ermittelt)
    launchAt: '',             // ISO UTC
    timezone: 'Europe/Berlin',
    infoUrl: '',              // Infoseite "Founding Creator"
    privacyUrl: '',           // Datenschutzerklärung
    imprintUrl: '',           // Impressum
    discordInvite: '',        // allgemeiner Discord-Link (Fallback ohne Bot)
    senderName: '',           // Absendername in Nachrichten
    studioName: '',
    contactEmail: '',         // Studio-Mail
    parentFormUrl: '',        // Link zum Eltern-Einverständnis (z. B. Online-Formular oder PDF)
    codeReward_de: 'ein exklusives Item, das man nicht kaufen kann',
    codeReward_en: 'an exclusive item you can\'t buy',
  },

  radar: {
    languages: ['de', 'en'],
    minFollowers: 200,
    maxFollowers: 25000,
    youtube: {
      queries: {
        de: [
          'neue roblox spiele',
          'roblox spiele die du spielen musst',
          'roblox rivals deutsch',
          'roblox bedwars deutsch',
          'roblox mit zuschauern',
          'roblox live deutsch',
          'roblox shooter deutsch',
          'roblox arsenal deutsch',
          'roblox deutsch',
          'roblox tower deutsch',
        ],
        en: [
          'new roblox games',
          'best new roblox games',
          'underrated roblox games',
          'roblox games you need to play',
          'roblox rivals',
          'roblox bedwars',
          'roblox shooter games',
          'roblox arsenal',
          'playing roblox with viewers',
          'roblox live stream',
        ],
      },
      publishedWithinDays: 45,
      pagesPerQuery: 2,
      maxSearchesPerRun: 20,
      dailySearchLimit: 100,  // YouTube: 100 Suchen/Tag (seit 1.6.2026 eigenes Kontingent)
      dailyUnitLimit: 10000,
      recentVideos: 12,
    },
    twitch: {
      languages: ['de', 'en'],
      minViewers: 1,
      maxViewers: 250,
      maxPages: 10,
      autoEveryMinutes: 0,    // 0 = aus; z. B. 60 = stündlich live Roblox-Streams einsammeln
      gameId: '',             // Twitch-Kategorie Roblox (wird automatisch ermittelt)
    },
    genres: {
      shooter: ['rivals', 'arsenal', 'phantom forces', 'bad business', 'counter blox', 'frontlines', 'fps', 'shooter', 'gun', 'sniper', 'paintball', 'combat warriors', 'gunfight'],
      buildfight: ['bedwars', 'bed wars', 'skywars', 'tower', 'turm', 'build battle', 'bauen', 'build', 'bridge'],
      newgames: ['new roblox game', 'new roblox games', 'neue roblox spiele', 'neues roblox spiel', 'underrated', 'best roblox games', 'games you need to play', 'spiele die du', 'hidden gem', 'unbekannte roblox', 'testing new', 'ich teste', 'neue spiele'],
      viewers: ['with viewers', 'with fans', 'with subs', 'mit zuschauern', 'mit abonnenten', 'mit euch', 'mit abos', 'zuschauer', 'viewers', 'community'],
    },
    dailyLimits: { email: 40, dm: 20, discord: 10 },
    followupAfterDays: 6,     // Nachfass-Mail nach X Tagen ohne Antwort (nur E-Mail)
    maxFollowups: 1,
    noReplyAfterDays: 14,     // danach Status "keine Antwort"
    emailClient: 'gmail',     // gmail|outlook|mailto
    instagramLink: 'web',     // web = Profil öffnen, app = ig.me-Link (Handy)
    abTest: true,             // Varianten A/B abwechselnd verwenden
    retention: {
      platformDataDays: 30,   // YouTube-Vorgabe: Daten spätestens nach 30 Tagen aktualisieren/löschen
      uncontactedDays: 30,    // nie kontaktierte Creator nach X Tagen löschen
      noReplyDeleteDays: 180, // Nicht-Antworter nach X Tagen löschen
    },
  },

  discord: {
    guildId: '',
    roles: {},                // von /setup gesetzt: creator, founding, tester, staff
    channels: {},             // von /setup gesetzt (siehe docs/ARCHITEKTUR.md)
    messages: {},             // Panels: { key: { channelId, messageId } }
    foundingLimit: 50,
    minAge: 13,
    parentConsentUnder: 16,   // unter diesem Alter: Eltern-OK nötig (Creator + Tester)
    inviteMaxAgeDays: 0,      // 0 = persönliche Einladungen laufen nicht ab
    inviteMaxUses: 5,
    serverLanguage: 'both',   // de|en|both – Sprache öffentlicher Bot-Posts
    staffRoleName: 'Creator-Team',
    twitchLiveCheckMinutes: 3,
    pingRoleOnEvents: true,
    welcomeDm: true,
  },

  points: {
    contentVideo: 50,
    contentShort: 20,
    contentStream: 30,
    liveDuringEvent: 30,
    liveOther: 10,
    playtestAttend: 10,
    playtestFeedback: 5,
    bugConfirmed: 20,
  },

  tiers: [
    { name: 'Bronze', min: 0 },
    { name: 'Silber', min: 100 },
    { name: 'Gold', min: 300 },
    { name: 'Diamant', min: 750 },
  ],
};

let cache = null;

function load() {
  const stored = {};
  for (const row of getDb().all('SELECT key, value FROM settings')) {
    stored[row.key] = safeJson(row.value, null);
  }
  return deepMerge(DEFAULTS, stored);
}

/** Full settings object (defaults merged with saved values). */
export function getSettings() {
  if (!cache) cache = load();
  return cache;
}

export function getSetting(path, fallback) {
  return getPath(getSettings(), path, fallback);
}

export const getActiveCampaignId = () => Number(getSetting('activeCampaignId', 1)) || 1;

/**
 * Saves a partial settings object, e.g. { game: { name: 'Tower Rush' } }.
 * Objects are merged deeply; arrays are replaced.
 */
export function updateSettings(patch) {
  const db = getDb();
  db.tx(() => {
    for (const [key, value] of Object.entries(patch || {})) {
      if (value === undefined) continue;
      const row = db.get('SELECT value FROM settings WHERE key = :key', { key });
      const prev = row ? safeJson(row.value, null) : null;
      const merged = prev !== null && typeof prev === 'object' && !Array.isArray(prev) && typeof value === 'object' && !Array.isArray(value) && value !== null
        ? deepMerge(prev, value)
        : value;
      db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        { key, value: JSON.stringify(merged) },
      );
    }
  });
  cache = null;
  const settings = getSettings();
  bus.emit('settings.changed', settings);
  return settings;
}

/** Replaces a whole top-level key (no deep merge), e.g. resetting discord.channels. */
export function replaceSetting(key, value) {
  getDb().run(
    `INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { key, value: JSON.stringify(value) },
  );
  cache = null;
  const settings = getSettings();
  bus.emit('settings.changed', settings);
  return settings;
}

/** Clears the in-memory cache (tests / after external DB changes). */
export function resetSettingsCache() {
  cache = null;
}
