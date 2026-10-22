// Background jobs of the radar.
import { bus } from '../core/bus.js';
import { getSettings } from '../core/settings.js';
import { createLogger } from '../core/log.js';
import { schedule, unschedule } from '../core/scheduler.js';
import { runRetention } from './retention.js';
import { markNoReplies } from './outreach.js';
import { isRunning, startDiscovery } from './discovery.js';
import { resetTwitchToken, twitchConfigured } from './twitch.js';

const log = createLogger('radar');
let registered = false;
let twitchEvery = null;

function configureTwitchAuto() {
  const minutes = Number(getSettings().radar.twitch.autoEveryMinutes) || 0;
  const every = minutes > 0 && twitchConfigured() ? Math.max(15, minutes) : 0;
  if (every === twitchEvery) return;
  twitchEvery = every;
  if (!every) {
    unschedule('radar:twitchAuto');
    return;
  }
  schedule(
    'radar:twitchAuto',
    every * 60_000,
    async () => {
      if (isRunning('twitch') || !twitchConfigured()) return;
      try {
        await startDiscovery('twitch', { auto: true }).promise;
      } catch (err) {
        log.warn('Automatische Twitch-Suche:', err.message);
      }
    },
    { runImmediately: true, initialDelayMs: 20_000 },
  );
  log.info(`Automatische Twitch-Suche alle ${every} Minuten aktiv.`);
}

/** Registers retention (every 12 h + at start), "no reply" (hourly) and optional Twitch auto-search. */
export function registerRadarJobs() {
  schedule('radar:retention', 12 * 3600_000, () => runRetention(), { runImmediately: true, initialDelayMs: 60_000 });
  schedule('radar:noReply', 3600_000, () => markNoReplies(), { runImmediately: true, initialDelayMs: 30_000 });
  configureTwitchAuto();
  if (!registered) {
    registered = true;
    bus.on('settings.changed', () => configureTwitchAuto());
    bus.on('secrets.changed', (keys) => {
      if (keys.some((k) => k.startsWith('TWITCH_'))) {
        resetTwitchToken();
        twitchEvery = null;
        configureTwitchAuto();
      }
    });
  }
}
