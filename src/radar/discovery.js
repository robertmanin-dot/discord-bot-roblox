// Discovery runs (table discovery_runs): one run per source at a time, live log, cancel.
import { env } from '../core/config.js';
import { getDb } from '../core/db.js';
import { bus } from '../core/bus.js';
import { createLogger } from '../core/log.js';
import { safeJson } from '../core/util.js';
import { nowIso } from '../core/time.js';
import { HttpError, badRequest } from '../web/http.js';
import { runYoutubeDiscovery } from './youtube.js';
import { runTwitchDiscovery } from './twitch.js';

const log = createLogger('radar');
const running = new Map(); // source -> { runId, controller, promise }
const LABELS = { youtube: 'YouTube', twitch: 'Twitch' };

export const isRunning = (source) => running.has(source);

function parseRun(row) {
  return row ? { ...row, params: safeJson(row.params, {}) } : null;
}

/** Marks runs that were still "running" when the app stopped. */
export function markStaleRuns() {
  getDb().run("UPDATE discovery_runs SET status = 'abgebrochen', finished_at = :now, error = COALESCE(error, 'Programm wurde beendet') WHERE status = 'laeuft'", { now: nowIso() });
}

/**
 * Starts a discovery in the background. Returns { runId, promise }.
 * Throws 409 if the same source is already running, 400 if keys are missing.
 */
export function startDiscovery(source, params = {}, { fetchImpl } = {}) {
  if (!LABELS[source]) throw badRequest(`Unbekannte Quelle: ${source}`);
  if (running.has(source)) throw new HttpError(409, `Es läuft bereits eine ${LABELS[source]}-Suche.`);
  if (source === 'youtube' && !env('YOUTUBE_API_KEY')) throw new HttpError(400, 'Kein YouTube-API-Schlüssel hinterlegt (Dashboard → Einrichtung).');
  if (source === 'twitch' && (!env('TWITCH_CLIENT_ID') || !env('TWITCH_CLIENT_SECRET'))) {
    throw new HttpError(400, 'Twitch Client-ID und Client-Secret fehlen (Dashboard → Einrichtung).');
  }
  const db = getDb();
  const { lastInsertRowid: runId } = db.run('INSERT INTO discovery_runs (source, params) VALUES (:source, :params)', { source, params });
  const controller = new AbortController();
  const lines = [];
  const onLog = (msg) => {
    const time = new Date().toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' });
    lines.push(`${time}  ${msg}`);
    if (lines.length > 400) lines.shift();
    try {
      db.run('UPDATE discovery_runs SET log = :log WHERE id = :id', { log: lines.join('\n'), id: runId });
    } catch { /* db closed */ }
  };
  const onProgress = (s) => {
    try {
      db.run('UPDATE discovery_runs SET found = :found, added = :added, updated = :updated, skipped = :skipped WHERE id = :id', { ...s, id: runId });
    } catch { /* db closed */ }
  };

  const entry = { runId, controller, promise: null };
  running.set(source, entry);
  entry.promise = (async () => {
    let status = 'fertig';
    let error = null;
    let summary = { found: 0, added: 0, updated: 0, skipped: 0 };
    try {
      const opts = { ...params, onLog, onProgress, signal: controller.signal };
      if (fetchImpl) opts.fetchImpl = fetchImpl;
      summary = source === 'youtube' ? await runYoutubeDiscovery(opts) : await runTwitchDiscovery(opts);
      if (controller.signal.aborted) status = 'abgebrochen';
    } catch (err) {
      status = 'fehler';
      error = err.message;
      onLog(`Fehler: ${err.message}`);
      log.warn(`${LABELS[source]}-Suche fehlgeschlagen:`, err.message);
    } finally {
      running.delete(source);
      try {
        db.run(
          `UPDATE discovery_runs SET status = :status, error = :error, found = :found, added = :added, updated = :updated,
             skipped = :skipped, finished_at = :now WHERE id = :id`,
          { status, error, ...summary, now: nowIso(), id: runId },
        );
      } catch { /* db closed */ }
      bus.emit('discovery.finished', { runId, source, status, added: summary.added || 0, updated: summary.updated || 0 });
    }
    return { status, error, ...summary };
  })();
  return { runId, promise: entry.promise };
}

/** Cancels a running discovery (or marks a stale run as cancelled). */
export function cancelDiscovery(runId) {
  for (const entry of running.values()) {
    if (entry.runId === Number(runId)) {
      entry.controller.abort();
      return true;
    }
  }
  const r = getDb().run("UPDATE discovery_runs SET status = 'abgebrochen', finished_at = :now WHERE id = :id AND status = 'laeuft'", { id: runId, now: nowIso() });
  return r.changes > 0;
}

export function listRuns(limit = 20) {
  return getDb().all('SELECT * FROM discovery_runs ORDER BY id DESC LIMIT :limit', { limit }).map(parseRun);
}

export function getRun(id) {
  return parseRun(getDb().get('SELECT * FROM discovery_runs WHERE id = :id', { id }));
}
