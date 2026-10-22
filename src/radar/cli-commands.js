// CLI commands for src/cli.js:
//   npm run discover:youtube -- --lang de,en --max 10
//   npm run discover:twitch -- --lang de --min 1 --max 200
//   npm run retention
//   node src/cli.js rescore
import { getDb } from '../core/db.js';
import { runYoutubeDiscovery } from './youtube.js';
import { runTwitchDiscovery } from './twitch.js';
import { runRetention } from './retention.js';
import { recomputeCreator } from './enrich.js';

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const [key, inline] = a.slice(2).split('=');
    const value = inline ?? (args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true');
    out[key] = value;
  }
  return out;
}

const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : undefined);
const print = (msg) => console.log(msg);

export const commands = {
  async youtube(args = []) {
    const a = parseArgs(args);
    const summary = await runYoutubeDiscovery({ languages: list(a.lang), maxSearches: a.max ? Number(a.max) : undefined, onLog: print });
    console.log(JSON.stringify(summary));
  },
  async twitch(args = []) {
    const a = parseArgs(args);
    const summary = await runTwitchDiscovery({
      languages: list(a.lang),
      minViewers: a.min !== undefined ? Number(a.min) : undefined,
      maxViewers: a.max !== undefined ? Number(a.max) : undefined,
      onLog: print,
    });
    console.log(JSON.stringify(summary));
  },
  async retention() {
    console.log(JSON.stringify(await runRetention()));
  },
  async rescore() {
    const ids = getDb().all('SELECT id FROM creators').map((r) => r.id);
    for (const id of ids) recomputeCreator(id);
    console.log(`${ids.length} Creator neu bewertet.`);
  },
};
