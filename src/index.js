// Creator Launch Kit – starts dashboard (http://localhost:3000), radar jobs and the Discord bot.
import { exec } from 'node:child_process';
import { loadEnv, env, host, port } from './core/config.js';
import { openDb, closeDb } from './core/db.js';
import { bus } from './core/bus.js';
import { createLogger } from './core/log.js';
import { stopAll } from './core/scheduler.js';
import { setupChecklist } from './core/checklist.js';
import { getSettings } from './core/settings.js';
import { createApp } from './web/server.js';
import { initRadar, registerRadarJobs } from './radar/index.js';
import { createBot } from './bot/index.js';

const log = createLogger('app');

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    console.error(`\nNode.js ${process.versions.node} ist zu alt. Bitte Node.js 22.13+ (empfohlen: aktuelle LTS) installieren: https://nodejs.org\n`);
    process.exit(1);
  }
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function main() {
  checkNode();
  loadEnv();
  openDb();
  await initRadar();

  const app = createApp();
  const url = `http://${host() === '0.0.0.0' ? 'localhost' : host()}:${port()}`;
  const server = app.listen(port(), host(), () => {
    log.info(`Dashboard läuft: ${url}`);
    const open = setupChecklist().filter((i) => !i.done && !i.optional);
    if (open.length) log.info(`Noch offen: ${open.map((i) => i.label).join(' | ')}`);
    if (env('OPEN_BROWSER') === '1') openBrowser(url);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${port()} ist belegt – läuft das Tool schon? Dann einfach ${url} öffnen.\nSonst in .env z. B. PORT=3001 setzen.\n`);
      process.exit(1);
    }
    throw err;
  });

  registerRadarJobs();

  // The Discord bot is optional (settings → Discord → "Discord-Bot verwenden").
  const bot = createBot();
  const botWanted = () => Boolean(getSettings().discord?.useBot);
  let botActive = botWanted();
  if (botActive) bot.start().catch((err) => log.error('Bot-Start fehlgeschlagen:', err));
  else log.info('Discord-Bot ist ausgeschaltet (Einstellungen → Discord). Das Outreach-Tool läuft ohne ihn.');
  bus.on('settings.changed', (settings) => {
    const wanted = Boolean(settings.discord?.useBot);
    if (wanted === botActive) return;
    botActive = wanted;
    if (wanted) {
      log.info('Discord-Bot eingeschaltet – verbinde …');
      bot.start().catch((err) => log.error('Bot-Start fehlgeschlagen:', err));
    } else {
      log.info('Discord-Bot ausgeschaltet.');
      bot.stop().then(() => { bot.state = 'disabled'; bot.error = null; }).catch((err) => log.error(err));
    }
  });
  bus.on('secrets.changed', (keys) => {
    if (keys.includes('DISCORD_TOKEN') && botActive) {
      log.info('Discord-Token geändert – Bot verbindet neu …');
      bot.restart().catch((err) => log.error(err));
    }
  });

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log.info(`Beende (${signal}) …`);
    stopAll();
    await bot.stop().catch(() => {});
    server.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error('Unbehandelter Fehler:', err));
}

main().catch((err) => {
  console.error('Start fehlgeschlagen:', err);
  process.exit(1);
});
