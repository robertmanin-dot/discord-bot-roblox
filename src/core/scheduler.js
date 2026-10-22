// Tiny interval scheduler with overlap protection and error logging.
import { createLogger } from './log.js';

const log = createLogger('jobs');
const jobs = new Map();

/**
 * Runs fn every `everyMs`. A run is skipped while the previous one is still busy.
 * Re-scheduling a name replaces the old job.
 */
export function schedule(name, everyMs, fn, { runImmediately = false, initialDelayMs = 2000 } = {}) {
  unschedule(name);
  const job = { name, everyMs, running: false, lastRun: null, lastError: null, timer: null, kick: null };
  const tick = async () => {
    if (job.running) return;
    job.running = true;
    try {
      await fn();
      job.lastError = null;
    } catch (err) {
      job.lastError = err.message;
      log.error(`Job "${name}" fehlgeschlagen:`, err);
    } finally {
      job.running = false;
      job.lastRun = new Date().toISOString();
    }
  };
  job.timer = setInterval(tick, everyMs);
  job.timer.unref?.();
  if (runImmediately) {
    job.kick = setTimeout(tick, initialDelayMs);
    job.kick.unref?.();
  }
  job.run = tick;
  jobs.set(name, job);
  return job;
}

export function unschedule(name) {
  const job = jobs.get(name);
  if (!job) return;
  clearInterval(job.timer);
  if (job.kick) clearTimeout(job.kick);
  jobs.delete(name);
}

/** Stops all jobs whose name starts with the prefix (or all). */
export function stopAll(prefix = '') {
  for (const name of [...jobs.keys()]) if (name.startsWith(prefix)) unschedule(name);
}

export function listJobs() {
  return [...jobs.values()].map(({ name, everyMs, running, lastRun, lastError }) => ({ name, everyMs, running, lastRun, lastError }));
}

/** Runs a job right now (if it exists). */
export async function runNow(name) {
  const job = jobs.get(name);
  if (job) await job.run();
}
