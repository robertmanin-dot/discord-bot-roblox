// Twitch Helix API: live Roblox streams by language (discovery), users for imports,
// live check for the Discord bot. Uses an app access token (client credentials).
// Whispers are never used.
import { env } from '../core/config.js';
import { getDb } from '../core/db.js';
import { getSettings, updateSettings } from '../core/settings.js';
import {
  createCreator, findCreatorByAccount, findCreatorByEmail, getCreator, isSuppressed, updateCreator, upsertAccount, addContact,
} from '../core/creators.js';
import { chunk, normalizeHandle, truncate, uniq } from '../core/util.js';
import { dayKey, nowIso } from '../core/time.js';
import { HttpError } from '../web/http.js';
import { radarFetch } from './net.js';
import { addUsage } from './usage.js';
import { analyzeText, applyAnalysis, matchGenres, recomputeCreator } from './enrich.js';
import { normalizeLangCode, detectFromTexts } from './language.js';
import { findCreatorByLinkedProfiles, mergeTags } from './common.js';

let tokenCache = null;

export function resetTwitchToken() {
  tokenCache = null;
}

export const twitchConfigured = () => Boolean(env('TWITCH_CLIENT_ID') && env('TWITCH_CLIENT_SECRET'));

/** App access token (cached until shortly before it expires). */
export async function getAppToken({ fetchImpl = radarFetch, force = false } = {}) {
  const clientId = env('TWITCH_CLIENT_ID');
  const secret = env('TWITCH_CLIENT_SECRET');
  if (!clientId || !secret) throw new HttpError(400, 'Twitch Client-ID und Client-Secret fehlen (Dashboard → Einrichtung).');
  if (!force && tokenCache && tokenCache.clientId === clientId && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  let res;
  try {
    res = await fetchImpl('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'client_credentials' }).toString(),
    });
  } catch (err) {
    throw new HttpError(502, `Twitch ist nicht erreichbar (${err.message}).`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new HttpError(400, [400, 401, 403].includes(res.status)
      ? 'Twitch lehnt Client-ID/Secret ab – bitte in der Twitch-Entwicklerkonsole prüfen und neu eintragen.'
      : `Twitch-Anmeldung fehlgeschlagen (HTTP ${res.status}).`);
  }
  tokenCache = { token: body.access_token, clientId, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

/** GET https://api.twitch.tv/helix/<path>; arrays become repeated parameters. */
export async function helix(path, params = {}, { fetchImpl = radarFetch } = {}) {
  const url = new URL(`https://api.twitch.tv/helix/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
    else if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAppToken({ fetchImpl, force: attempt > 0 });
    let res;
    try {
      res = await fetchImpl(url.toString(), { headers: { 'Client-Id': env('TWITCH_CLIENT_ID'), Authorization: `Bearer ${token}` } });
    } catch (err) {
      throw new HttpError(502, `Twitch ist nicht erreichbar (${err.message}).`);
    }
    addUsage(dayKey(), 'twitch', 1);
    if (res.status === 401 && attempt === 0) continue;
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) throw new HttpError(429, 'Twitch-Ratenlimit erreicht – bitte in einer Minute erneut versuchen.');
    if (!res.ok) throw new HttpError(502, `Twitch-API-Fehler ${res.status}${body.message ? `: ${body.message}` : ''}`);
    return body;
  }
  throw new HttpError(401, 'Twitch-Anmeldung abgelaufen.');
}

/** Twitch category id of Roblox (looked up once, then stored in the settings). */
export async function resolveGameId({ fetchImpl = radarFetch } = {}) {
  const stored = getSettings().radar.twitch.gameId;
  if (stored) return stored;
  const res = await helix('games', { name: 'Roblox' }, { fetchImpl });
  const id = res.data?.[0]?.id;
  if (!id) throw new HttpError(502, 'Twitch-Kategorie „Roblox“ nicht gefunden.');
  updateSettings({ radar: { twitch: { gameId: id } } });
  return id;
}

/** Saves one live sighting of a streamer. Returns { status, id }. */
export function saveTwitchSighting(stream, user, settings = getSettings(), now = new Date()) {
  const db = getDb();
  const login = normalizeHandle(stream.user_login || user?.login);
  const bio = user?.description || '';
  const analysis = analyzeText(bio, { sourcePlatform: 'twitch' });
  if (isSuppressed({ emails: analysis.emails.map((e) => e.value), accounts: [{ platform: 'twitch', external_id: stream.user_id, handle: login }] })) {
    return { status: 'skipped', reason: 'abgemeldet' };
  }
  return db.tx(() => {
    let creator = findCreatorByAccount('twitch', { externalId: stream.user_id, handle: login });
    if (!creator) for (const e of analysis.emails) if ((creator = findCreatorByEmail(e.value))) break;
    if (!creator) creator = findCreatorByLinkedProfiles(analysis.profiles, 'twitch');
    const created = !creator;
    const id = creator?.id ?? createCreator({ display_name: user?.display_name || stream.user_name || login, source: 'twitch' });
    const acc = db.get("SELECT * FROM accounts WHERE platform = 'twitch' AND (external_id = :uid OR handle = :login)", { uid: String(stream.user_id), login });
    const newSession = !acc || acc.last_active_at !== stream.started_at;
    const times = (acc?.times_seen_live || 0) + (newSession ? 1 : 0);
    const viewers = Number(stream.viewer_count) || 0;
    const prevAvg = acc?.avg_live_viewers;
    const avg = newSession
      ? prevAvg !== null && prevAvg !== undefined && times > 1 ? (prevAvg * (times - 1) + viewers) / times : viewers
      : prevAvg ?? viewers;
    upsertAccount(id, {
      platform: 'twitch',
      external_id: String(stream.user_id),
      handle: login,
      display_handle: stream.user_name || user?.display_name,
      url: `https://www.twitch.tv/${login}`,
      avg_live_viewers: Math.round(avg * 10) / 10,
      max_live_viewers: Math.max(acc?.max_live_viewers || 0, viewers),
      times_seen_live: times,
      last_active_at: stream.started_at || nowIso(),
      roblox_share: 1,
      live_share: 1,
      genres: matchGenres([stream.title, bio, ...(stream.tags || [])], settings.radar.genres),
      latest_title: stream.title || acc?.latest_title || null,
      latest_url: `https://www.twitch.tv/${login}`,
      bio: bio ? truncate(bio, 1000) : acc?.bio ?? null,
      platform_language: normalizeLangCode(stream.language),
      fetched_at: now.toISOString(),
      source: 'twitch_api',
    });
    applyAnalysis(id, analysis, { source: 'twitch_bio', sourceAccount: { platform: 'twitch', handle: login } });
    const cur = getCreator(id);
    const lang = normalizeLangCode(stream.language);
    if (lang && !['manual', 'application'].includes(cur.language_source)) updateCreator(id, { language: lang, language_source: 'platform' });
    recomputeCreator(id, settings);
    return { status: created ? 'added' : 'updated', id };
  });
}

/**
 * Collects live Roblox streams per language, filtered by viewer count, and saves the streamers.
 * Returns { found, added, updated, skipped, streams }.
 */
export async function runTwitchDiscovery({
  languages, minViewers, maxViewers, onLog = () => {}, onProgress = () => {}, signal, fetchImpl = radarFetch,
} = {}) {
  const settings = getSettings();
  const tw = settings.radar.twitch;
  const langs = (languages?.length ? languages : tw.languages).filter(Boolean);
  const min = Number.isFinite(Number(minViewers)) && minViewers !== null && minViewers !== '' ? Number(minViewers) : tw.minViewers;
  const max = Number.isFinite(Number(maxViewers)) && maxViewers !== null && maxViewers !== '' ? Number(maxViewers) : tw.maxViewers;
  const summary = { found: 0, added: 0, updated: 0, skipped: 0, streams: 0 };
  const gameId = await resolveGameId({ fetchImpl });
  onLog(`Suche live Roblox-Streams (${langs.join(', ')}), ${min}–${max} Zuschauer …`);

  const streams = [];
  for (const lang of langs) {
    let cursor;
    let pages = 0;
    for (; pages < Math.max(1, tw.maxPages); pages++) {
      if (signal?.aborted) break;
      const res = await helix('streams', { game_id: gameId, language: lang, first: 100, type: 'live', after: cursor }, { fetchImpl });
      const data = res.data || [];
      streams.push(...data);
      cursor = res.pagination?.cursor;
      if (!cursor || !data.length) break;
    }
    onLog(`${lang}: ${streams.filter((s) => s.language === lang).length} Streams live`);
  }
  summary.streams = streams.length;
  const candidates = streams.filter((s) => Number(s.viewer_count) >= min && Number(s.viewer_count) <= max);
  summary.found = candidates.length;
  summary.skipped += streams.length - candidates.length;
  onLog(`${candidates.length} Streamer im Zuschauerbereich.`);
  onProgress({ ...summary });

  const users = new Map();
  for (const batch of chunk(uniq(candidates.map((s) => String(s.user_id))), 100)) {
    if (signal?.aborted) break;
    const res = await helix('users', { id: batch }, { fetchImpl });
    for (const u of res.data || []) users.set(String(u.id), u);
  }
  for (const stream of candidates) {
    if (signal?.aborted) {
      onLog('Abgebrochen.');
      break;
    }
    try {
      const r = saveTwitchSighting(stream, users.get(String(stream.user_id)), settings);
      summary[r.status]++;
    } catch (err) {
      onLog(`${stream.user_login}: ${err.message}`);
      summary.skipped++;
    }
    onProgress({ ...summary });
  }
  onLog(`Fertig: ${summary.added} neu, ${summary.updated} aktualisiert, ${summary.skipped} übersprungen.`);
  return summary;
}

/**
 * Live streams of the given logins (for the bot's live feed).
 * Returns [{ user_login, user_name, title, game_name, viewer_count, started_at, url }].
 */
export async function getStreamsByLogins(logins, { fetchImpl = radarFetch } = {}) {
  const list = uniq((logins || []).map(normalizeHandle).filter(Boolean));
  const out = [];
  for (const batch of chunk(list, 100)) {
    const res = await helix('streams', { user_login: batch, type: 'live', first: 100 }, { fetchImpl });
    for (const s of res.data || []) {
      out.push({
        user_login: s.user_login,
        user_name: s.user_name,
        title: s.title,
        game_name: s.game_name,
        viewer_count: s.viewer_count,
        started_at: s.started_at,
        url: `https://www.twitch.tv/${s.user_login}`,
      });
    }
  }
  return out;
}

/** Users by login: [{ id, login, display_name, description, profile_image_url, broadcaster_type }]. */
export async function getUsersByLogins(logins, { fetchImpl = radarFetch } = {}) {
  const list = uniq((logins || []).map(normalizeHandle).filter(Boolean));
  const out = [];
  for (const batch of chunk(list, 100)) {
    const res = await helix('users', { login: batch }, { fetchImpl });
    out.push(...(res.data || []));
  }
  return out;
}

/** Import of one Twitch channel (bio, name; no live data). */
export async function importTwitchUser(login, { fetchImpl = radarFetch, extra = {} } = {}) {
  const [user] = await getUsersByLogins([login], { fetchImpl });
  if (!user) throw new HttpError(404, `Twitch-Kanal „${login}“ nicht gefunden.`);
  const db = getDb();
  const handle = normalizeHandle(user.login);
  const bio = user.description || '';
  const analysis = analyzeText(bio, { sourcePlatform: 'twitch' });
  const emails = uniq([...analysis.emails.map((e) => e.value), ...(extra.email ? [extra.email] : [])]);
  if (isSuppressed({ emails, accounts: [{ platform: 'twitch', external_id: user.id, handle }] })) return { status: 'skipped', reason: 'abgemeldet' };
  return db.tx(() => {
    let creator = findCreatorByAccount('twitch', { externalId: user.id, handle });
    if (!creator) for (const e of emails) if ((creator = findCreatorByEmail(e))) break;
    if (!creator) creator = findCreatorByLinkedProfiles(analysis.profiles, 'twitch');
    const created = !creator;
    const id = creator?.id ?? createCreator({ display_name: user.display_name || handle, source: extra.source || 'import' });
    upsertAccount(id, {
      platform: 'twitch',
      external_id: String(user.id),
      handle,
      display_handle: user.display_name,
      url: `https://www.twitch.tv/${handle}`,
      bio: bio ? truncate(bio, 1000) : null,
      genres: matchGenres([bio]),
      followers: extra.followers ?? undefined,
      fetched_at: nowIso(),
      source: 'twitch_api',
    });
    applyAnalysis(id, analysis, { source: 'twitch_bio', sourceAccount: { platform: 'twitch', handle } });
    if (extra.email) addContact(id, { type: 'email', value: extra.email, source: 'import', is_business: 1 });
    const cur = getCreator(id);
    const update = {};
    if (extra.language) {
      update.language = extra.language;
      update.language_source = 'manual';
    } else if (!cur.language && bio) {
      const lang = detectFromTexts([bio]);
      if (lang) {
        update.language = lang;
        update.language_source = 'detected';
      }
    }
    if (extra.tags?.length) update.tags = mergeTags(cur.tags, extra.tags);
    if (extra.notes) update.notes = cur.notes ? `${cur.notes}\n${extra.notes}` : extra.notes;
    if (extra.age_group && cur.age_group === 'unbekannt') update.age_group = extra.age_group;
    if (Object.keys(update).length) updateCreator(id, update);
    recomputeCreator(id);
    return { status: created ? 'added' : 'updated', id };
  });
}

/** Refresh of stored Twitch accounts (bio/name) for the retention rule. rows: [{ creator_id, external_id }]. */
export async function refreshTwitchAccounts(rows, { fetchImpl = radarFetch } = {}) {
  let refreshed = 0;
  const missing = [];
  for (const batch of chunk(rows.filter((r) => r.external_id), 100)) {
    const res = await helix('users', { id: batch.map((r) => r.external_id) }, { fetchImpl });
    const byId = new Map((res.data || []).map((u) => [String(u.id), u]));
    for (const row of batch) {
      const u = byId.get(String(row.external_id));
      if (!u) {
        missing.push(row);
        continue;
      }
      upsertAccount(row.creator_id, {
        platform: 'twitch',
        external_id: String(u.id),
        handle: normalizeHandle(u.login),
        display_handle: u.display_name,
        bio: u.description ? truncate(u.description, 1000) : null,
        fetched_at: nowIso(),
      });
      recomputeCreator(row.creator_id);
      refreshed++;
    }
  }
  return { refreshed, missing };
}
