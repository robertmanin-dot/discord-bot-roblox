const { Client, Events, GatewayIntentBits, ActivityType } = require('discord.js');
const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { createApiServer } = require('./api');
const { handleInteraction } = require('./interactions');
const playtests = require('./features/playtests');
const giveaways = require('./features/giveaways');

const TICK_MS = 30 * 1000;

async function main() {
  const config = loadConfig();
  const store = openDatabase(config.databasePath);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const ctx = { client, store, config };

  const api = createApiServer({ store, apiKey: config.apiKey });
  api.listen(config.apiPort, () => console.log(`[api] Schnittstelle fürs Spiel läuft auf Port ${config.apiPort}`));

  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await playtests.tick(ctx);
      await giveaways.tick(ctx);
      store.pruneApiBatches();
    } catch (err) {
      console.error('[scheduler] Fehler:', err);
    } finally {
      ticking = false;
    }
  }

  client.once(Events.ClientReady, (ready) => {
    console.log(`[bot] Eingeloggt als ${ready.user.tag}`);
    ready.user.setActivity('Wonder Wars testen', { type: ActivityType.Playing });
    tick();
    setInterval(tick, TICK_MS);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.guildId && interaction.guildId !== config.guildId) return;
    handleInteraction(interaction, ctx);
  });

  const shutdown = () => {
    console.log('[bot] Fahre herunter …');
    api.close();
    client.destroy();
    store.raw.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await client.login(config.token);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
