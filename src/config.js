require('dotenv').config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Umgebungsvariable ${name} fehlt. Trage sie in die .env-Datei ein (siehe .env.example).`);
  }
  return value;
}

function loadConfig() {
  return {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: required('DISCORD_GUILD_ID'),
    apiKey: required('GAME_API_KEY'),
    apiPort: Number(process.env.API_PORT || 3000),
    databasePath: process.env.DATABASE_PATH || 'data/bot.db',
    timeZone: process.env.TIMEZONE || 'Europe/Berlin',
  };
}

module.exports = { loadConfig };
