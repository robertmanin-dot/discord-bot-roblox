// Shared texts and small helpers for bot part A modules.
import { getDb } from '../../core/db.js';

/** Localization map for English Discord clients. */
export const enLoc = (text) => ({ 'en-US': text, 'en-GB': text });

export const COMMON = {
  de: {
    staffOnly: '⛔ Das darf nur das Team.',
    memberOnly: 'Das ist nur für Creator im Programm. Bewirb dich in {apply}.',
    notSetup: 'Der Server ist noch nicht eingerichtet – ein Team-Mitglied muss zuerst `/setup` ausführen.',
    invalidUrl: 'Das sieht nicht nach einem gültigen Link aus (Beispiel: https://www.twitch.tv/deinname).',
    unknownUser: 'Zu dieser Person gibt es noch keinen Creator-Eintrag.',
    channelApply: '#creator-bewerbung',
  },
  en: {
    staffOnly: '⛔ Only the team can do that.',
    memberOnly: 'This is only for creators in the program. Apply in {apply}.',
    notSetup: 'This server is not set up yet – a team member needs to run `/setup` first.',
    invalidUrl: "That doesn't look like a valid link (example: https://www.twitch.tv/yourname).",
    unknownUser: 'There is no creator entry for this person yet.',
    channelApply: '#creator-bewerbung',
  },
};

/** "<#id>" for a configured channel or a readable fallback name. */
export function channelMention(ctx, key, fallback) {
  const id = ctx.channelId(key);
  return id ? `<#${id}>` : fallback || `#${key}`;
}

/** Best display name for a Discord user id: creator name, tester tag or stored tag. */
export function displayNameFor(userId) {
  const db = getDb();
  const creator = db.get('SELECT display_name, discord_tag FROM creators WHERE discord_user_id = :userId', { userId });
  if (creator?.display_name) return creator.display_name;
  const tester = db.get('SELECT discord_tag FROM testers WHERE discord_user_id = :userId', { userId });
  if (tester?.discord_tag) return tester.discord_tag;
  return creator?.discord_tag || null;
}

/** Error with an HTTP status (used when the dashboard calls bot functions). */
export function userError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
