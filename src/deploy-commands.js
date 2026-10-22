/**
 * Meldet die Slash-Befehle bei Discord an. Einmal ausführen nach dem ersten Einrichten
 * und immer dann, wenn sich Befehle geändert haben:  npm run deploy-commands
 */
const { REST, Routes } = require('discord.js');
const { loadConfig } = require('./config');
const { commands } = require('./commands');

async function main() {
  const config = loadConfig();
  const rest = new REST().setToken(config.token);
  const body = commands.map((c) => c.toJSON());
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  console.log(`✅ ${body.length} Befehle für den Server angemeldet.`);
}

main().catch((err) => {
  console.error('Befehle konnten nicht angemeldet werden:', err.message || err);
  process.exit(1);
});
