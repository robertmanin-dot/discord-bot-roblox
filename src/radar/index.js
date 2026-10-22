// Radar entry points used by src/index.js and src/cli.js.
import { createLogger } from '../core/log.js';
import { initLanguage } from './language.js';
import { ensureDefaultTemplates } from './templates.js';
import { markStaleRuns } from './discovery.js';

export { registerRadarJobs } from './jobs.js';

const log = createLogger('radar');

/** Loads language detection, inserts default templates, cleans up interrupted runs. */
export async function initRadar() {
  await initLanguage();
  const n = ensureDefaultTemplates();
  markStaleRuns();
  log.debug(`Radar bereit (${n} Standard-Vorlagen).`);
}
