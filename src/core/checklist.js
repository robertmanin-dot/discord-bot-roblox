// "What is still missing?" — shown on the dashboard start page and by `npm run check`.
import { getSettings } from './settings.js';
import { secretStatus } from './config.js';
import { services } from './services.js';

export function setupChecklist() {
  const s = getSettings();
  const sec = secretStatus();
  const bot = services.bot.status();
  const game = s.game || {};
  const useBot = Boolean(s.discord?.useBot);
  return [
    {
      key: 'game',
      label: 'Spiel-Infos eintragen (Name, Kurzbeschreibung, Launch-Termin)',
      done: Boolean(game.name && (game.pitch_de || game.pitch_en) && game.launchAt),
      where: 'einstellungen',
    },
    { key: 'sender', label: 'Absendername und Studio-Name eintragen', done: Boolean(game.senderName), where: 'einstellungen' },
    {
      key: 'privacy',
      label: 'Link zur Datenschutzerklärung eintragen (empfohlen – ohne Link steht ein kurzer Hinweis in jeder Nachricht)',
      done: Boolean(game.privacyUrl),
      optional: true,
      where: 'einstellungen',
    },
    { key: 'infoUrl', label: 'Infoseite für Creator verlinken', done: Boolean(game.infoUrl), optional: true, where: 'einstellungen' },
    { key: 'youtube', label: 'YouTube-API-Schlüssel hinterlegen', done: sec.YOUTUBE_API_KEY.set, where: 'einrichtung' },
    {
      key: 'twitch',
      label: 'Twitch Client-ID und Client-Secret hinterlegen',
      done: sec.TWITCH_CLIENT_ID.set && sec.TWITCH_CLIENT_SECRET.set,
      optional: true,
      where: 'einrichtung',
    },
    ...(useBot
      ? [
        { key: 'discordToken', label: 'Discord-Bot-Token hinterlegen', done: sec.DISCORD_TOKEN.set, where: 'einrichtung' },
        { key: 'botOnline', label: 'Discord-Bot ist online', done: bot.state === 'ready', where: 'einrichtung', detail: bot.error || null },
        { key: 'botGuild', label: 'Bot auf deinen Discord-Server einladen', done: Boolean(bot.guild), where: 'einrichtung' },
        {
          key: 'setup',
          label: 'Im Discord einmal /setup ausführen (legt Rollen und Kanäle an)',
          done: Boolean(s.discord?.channels?.apply && s.discord?.roles?.creator),
          where: 'discord',
        },
      ]
      : []),
    { key: 'universe', label: 'Roblox-Spiel verknüpfen (Live-Spielerzahl beim Launch)', done: Boolean(game.universeId), optional: true, where: 'einstellungen' },
  ];
}
