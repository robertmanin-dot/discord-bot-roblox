/**
 * HTTP-Schnittstelle für das Roblox-Spiel.
 *
 * POST /api/v1/report   (Header: X-Api-Key)
 * {
 *   "batchId": "eindeutige-id",
 *   "recordedAt": 1761157200,          (optional, Unix-Zeit der Messung)
 *   "players": [{ "userId": 123, "name": "Spieler", "seconds": 60 }],
 *   "stats":   [{ "userId": 123, "stat": "kills", "delta": 2 }]
 * }
 *
 * GET /api/v1/health → { ok: true }
 */
const http = require('node:http');
const crypto = require('node:crypto');
const { PLAYTIME_STAT } = require('./db');

const MAX_BODY_BYTES = 512 * 1024;
const MAX_PLAYERS = 200;
const MAX_STATS = 5000;
const MAX_SECONDS_PER_REPORT = 600;
const STAT_NAME_RE = /^[a-z0-9_]{1,32}$/;

class ValidationError extends Error {}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Roblox schickt leere Tabellen je nach Fall als [] oder {}. Beides heißt „leer“. */
function asList(value) {
  if (value == null) return [];
  if (!Array.isArray(value) && typeof value === 'object' && Object.keys(value).length === 0) return [];
  return value;
}

function isUserId(v) {
  return Number.isSafeInteger(v) && v > 0;
}

const MAX_BACKDATE_SECONDS = 2 * 24 * 3600;

/** Prüft und bereinigt ein Paket vom Spiel. Wirft ValidationError bei falschen Daten. */
function validateReport(body, nowUnix = Math.floor(Date.now() / 1000)) {
  if (!body || typeof body !== 'object') throw new ValidationError('Body muss ein JSON-Objekt sein');
  const { batchId } = body;
  if (typeof batchId !== 'string' || batchId.length < 1 || batchId.length > 100) {
    throw new ValidationError('batchId fehlt oder ist ungültig');
  }
  const players = asList(body.players);
  const stats = asList(body.stats);
  if (!Array.isArray(players) || players.length > MAX_PLAYERS) throw new ValidationError('players ist ungültig');
  if (!Array.isArray(stats) || stats.length > MAX_STATS) throw new ValidationError('stats ist ungültig');

  const cleanPlayers = players.map((p, i) => {
    if (!p || !isUserId(p.userId)) throw new ValidationError(`players[${i}].userId ist ungültig`);
    const seconds = Number(p.seconds ?? 0);
    if (!Number.isFinite(seconds) || seconds < 0) throw new ValidationError(`players[${i}].seconds ist ungültig`);
    const name = typeof p.name === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(p.name) ? p.name : null;
    return { userId: p.userId, name, seconds: Math.min(Math.round(seconds), MAX_SECONDS_PER_REPORT) };
  });

  const cleanStats = stats.map((s, i) => {
    if (!s || !isUserId(s.userId)) throw new ValidationError(`stats[${i}].userId ist ungültig`);
    const stat = typeof s.stat === 'string' ? s.stat.toLowerCase() : '';
    if (!STAT_NAME_RE.test(stat) || stat === PLAYTIME_STAT) {
      throw new ValidationError(`stats[${i}].stat ist ungültig (erlaubt: a-z, 0-9, _ und nicht "${PLAYTIME_STAT}")`);
    }
    const delta = Number(s.delta);
    if (!Number.isFinite(delta) || Math.abs(delta) > 1e6) throw new ValidationError(`stats[${i}].delta ist ungültig`);
    return { userId: s.userId, stat, delta };
  });

  // Nachgereichte Pakete zählen zum Zeitpunkt der Messung, aber nie in der Zukunft
  // und höchstens zwei Tage rückwirkend.
  let receivedAt = nowUnix;
  if (Number.isFinite(body.recordedAt)) {
    receivedAt = Math.min(nowUnix, Math.max(nowUnix - MAX_BACKDATE_SECONDS, Math.floor(body.recordedAt)));
  }

  return { batchId, players: cleanPlayers, stats: cleanStats, receivedAt };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ValidationError('Body ist zu groß'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function createApiServer({ store, apiKey, logger = console }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/v1/health') {
        return send(res, 200, { ok: true });
      }
      if (url.pathname !== '/api/v1/report') return send(res, 404, { ok: false, error: 'Nicht gefunden' });
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Nur POST erlaubt' });

      const key = req.headers['x-api-key'];
      if (!key || !safeEqual(key, apiKey)) return send(res, 401, { ok: false, error: 'Falscher API-Schlüssel' });

      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        throw new ValidationError('Kein gültiges JSON');
      }
      const report = validateReport(body);
      const stored = store.recordGameBatch(report);
      return send(res, 200, { ok: true, duplicate: !stored });
    } catch (err) {
      if (err instanceof ValidationError) return send(res, 400, { ok: false, error: err.message });
      logger.error('[api] Fehler:', err);
      return send(res, 500, { ok: false, error: 'Interner Fehler' });
    }
  });
}

module.exports = { createApiServer, validateReport };
