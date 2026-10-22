// System endpoints: status/checklist, settings, secrets (.env), logs, Roblox game lookup.
import { Router } from 'express';
import { secretStatus, writeEnv, SECRET_KEYS } from '../../core/config.js';
import { getSettings, updateSettings } from '../../core/settings.js';
import { setupChecklist } from '../../core/checklist.js';
import { services } from '../../core/services.js';
import { recentLogs } from '../../core/log.js';
import { listJobs } from '../../core/scheduler.js';
import { getDb } from '../../core/db.js';
import { parseLocalDateTime, dayKey } from '../../core/time.js';
import { badRequest } from '../http.js';

const VERSION = '1.0.0';
const SETTINGS_KEYS = ['game', 'radar', 'discord', 'points', 'tiers', 'activeCampaignId'];

function counts() {
  const db = getDb();
  const campaignId = getSettings().activeCampaignId;
  const byStatus = Object.fromEntries(
    db.all('SELECT status, COUNT(*) AS n FROM outreach WHERE campaign_id = :campaignId GROUP BY status', { campaignId }).map((r) => [r.status, r.n]),
  );
  return {
    creators: db.value('SELECT COUNT(*) FROM creators', null, 0),
    members: db.value('SELECT COUNT(*) FROM creators WHERE is_member = 1', null, 0),
    testers: db.value("SELECT COUNT(*) FROM testers WHERE status = 'aktiv'", null, 0),
    byStatus,
  };
}

function quotaToday() {
  const db = getDb();
  const day = dayKey(new Date(), 'America/Los_Angeles'); // YouTube resets at midnight Pacific time
  const get = (api) => db.value('SELECT used FROM api_usage WHERE day = :day AND api = :api', { day, api }, 0);
  const yt = getSettings().radar.youtube;
  return {
    day,
    youtubeSearches: get('youtube_search'),
    youtubeSearchLimit: yt.dailySearchLimit,
    youtubeUnits: get('youtube_units'),
    youtubeUnitLimit: yt.dailyUnitLimit,
  };
}

/** Converts optional { launchDate, launchTime } into game.launchAt (ISO, UTC). */
function normalizeSettingsPatch(patch) {
  const out = {};
  for (const key of Object.keys(patch || {})) {
    if (!SETTINGS_KEYS.includes(key)) throw badRequest(`Unbekannte Einstellung: ${key}`);
    out[key] = patch[key];
  }
  if (out.game && (out.game.launchDate !== undefined || out.game.launchTime !== undefined)) {
    const { launchDate, launchTime, ...rest } = out.game;
    if (launchDate) {
      const tz = rest.timezone || getSettings().game.timezone || 'Europe/Berlin';
      const at = parseLocalDateTime(launchDate, launchTime || '19:00', tz);
      if (!at) throw badRequest('Launch-Datum/-Uhrzeit nicht erkannt. Beispiel: 21.11.2026 und 19:00');
      rest.launchAt = at.toISOString();
    } else {
      rest.launchAt = '';
    }
    out.game = rest;
  }
  if (out.game?.url) {
    const m = String(out.game.url).match(/roblox\.com\/(?:[a-z]{2}\/)?games\/(\d+)/i);
    if (m && !out.game.placeId) out.game.placeId = m[1];
  }
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} bei ${new URL(url).host}`);
  return res.json();
}

export default function systemRoutes() {
  const r = Router();

  r.get('/health', (req, res) => res.json({ ok: true, version: VERSION }));

  r.get('/status', (req, res) => {
    res.json({
      version: VERSION,
      node: process.version,
      setup: setupChecklist(),
      bot: services.bot.status(),
      secrets: secretStatus(),
      counts: counts(),
      quota: quotaToday(),
      game: { name: getSettings().game.name, launchAt: getSettings().game.launchAt, timezone: getSettings().game.timezone },
    });
  });

  r.get('/settings', (req, res) => res.json({ settings: getSettings(), secrets: secretStatus() }));

  r.put('/settings', (req, res) => {
    const settings = updateSettings(normalizeSettingsPatch(req.body));
    res.json({ settings, secrets: secretStatus() });
  });

  r.get('/secrets', (req, res) => res.json({ secrets: secretStatus() }));

  r.put('/secrets', (req, res) => {
    const updates = {};
    for (const [key, value] of Object.entries(req.body || {})) {
      if (!SECRET_KEYS.includes(key)) throw badRequest(`Unbekannter Schlüssel: ${key}`);
      if (typeof value !== 'string') throw badRequest(`${key} muss Text sein.`);
      updates[key] = value;
    }
    if (!Object.keys(updates).length) throw badRequest('Keine Werte übergeben.');
    res.json({ secrets: writeEnv(updates) });
  });

  r.get('/logs', (req, res) => res.json({ lines: recentLogs(300, req.query.level || 'debug') }));

  r.get('/jobs', (req, res) => res.json({ jobs: listJobs() }));

  // Resolve a Roblox game link or place id -> universe id + name (used for live player counts).
  r.post('/roblox/resolve', async (req, res) => {
    const input = String(req.body?.input || '').trim();
    const placeId = (input.match(/games\/(\d+)/) || input.match(/^(\d+)$/) || [])[1];
    if (!placeId) throw badRequest('Bitte den Spiel-Link (roblox.com/games/...) oder die Place-ID angeben.');
    let universeId;
    try {
      universeId = String((await fetchJson(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`)).universeId || '');
    } catch (err) {
      throw badRequest(`Roblox nicht erreichbar oder Place-ID falsch (${err.message}).`);
    }
    if (!universeId) throw badRequest('Zu dieser Place-ID wurde kein Spiel gefunden.');
    let info = null;
    try {
      info = (await fetchJson(`https://games.roblox.com/v1/games?universeIds=${universeId}`)).data?.[0] || null;
    } catch { /* name/players are optional */ }
    const game = { placeId, universeId };
    if (!getSettings().game.url) game.url = `https://www.roblox.com/games/${placeId}`;
    if (!getSettings().game.name && info?.name) game.name = info.name;
    updateSettings({ game });
    res.json({ placeId, universeId, name: info?.name || null, playing: info?.playing ?? null, visits: info?.visits ?? null });
  });

  return r;
}
