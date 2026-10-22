import { EventEmitter } from 'node:events';

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
export const bus = new EventEmitter();
bus.setMaxListeners(100);
