// Command line helpers:  npm run check | npm run discover:youtube | npm run discover:twitch | npm run retention
import { loadEnv } from './core/config.js';
import { openDb, closeDb } from './core/db.js';
import { setupChecklist } from './core/checklist.js';
import { initRadar } from './radar/index.js';

const commands = {
  async check() {
    for (const item of setupChecklist()) {
      const mark = item.done ? '✅' : item.optional ? '➖' : '❌';
      console.log(`${mark} ${item.label}${item.optional && !item.done ? ' (optional)' : ''}${item.detail ? ` – ${item.detail}` : ''}`);
    }
  },
};

async function main() {
  const name = process.argv[2] || 'check';
  loadEnv();
  openDb();
  await initRadar();
  const cliModule = await import('./radar/cli-commands.js').catch(() => ({}));
  const all = { ...commands, ...(cliModule.commands || {}) };
  if (!all[name]) {
    console.log(`Unbekannter Befehl "${name}". Verfügbar: ${Object.keys(all).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  await all[name](process.argv.slice(3));
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
