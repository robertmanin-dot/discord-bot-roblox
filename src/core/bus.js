import { EventEmitter } from 'node:events';
import { createLogger } from './log.js';

const log = createLogger('bus');

/**
 * EventEmitter whose listeners can never break the code that emits:
 * errors (also rejected promises of async listeners) are logged, the other listeners still run.
 */
class SafeEmitter extends EventEmitter {
  emit(event, ...args) {
    const listeners = this.rawListeners(event);
    if (!listeners.length) return false;
    for (const fn of listeners) {
      try {
        const result = fn.apply(this, args);
        if (result && typeof result.catch === 'function') {
          result.catch((err) => log.error(`Listener für "${String(event)}" fehlgeschlagen:`, err));
        }
      } catch (err) {
        log.error(`Listener für "${String(event)}" fehlgeschlagen:`, err);
      }
    }
    return true;
  }
}

/**
 * App-wide event bus between dashboard, radar and Discord bot.
 *
 * Events:
 *  'settings.changed'  (settings)
 *  'secrets.changed'   (changedKeys: string[])
 *  'outreach.status'   ({ creatorId, outreachId, campaignId, from, to })
 *  'creator.joined'    ({ creatorId, discordUserId, inviteCode })
 *  'creator.accepted'  ({ creatorId, discordUserId })
 *  'discovery.finished'({ runId, source, status, added, updated })
 */
export const bus = new SafeEmitter();
bus.setMaxListeners(100);
