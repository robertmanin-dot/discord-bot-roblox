// YouTube Data API v3: discovery of small Roblox channels, channel resolution for imports, refresh.
// Quota (since 2026-06-01): search.list has its own bucket of 100 calls/day; everything else
// shares 10,000 units/day (1 unit per call). Both are counted in api_usage and enforced here.
import { env } from '../core/config.js';
import { getDb } from '../core/db.js';
import { getSettings } from '../core/settings.js';
import {
  addContact, createCreator, findCreatorByAccount, findCreatorByEmail, getCreator, isSuppressed, updateCreator, upsertAccount,
} from '../core/creators.js';
import { chunk, normalizeHandle, truncate, uniq } from '../core/util.js';
import { daysSince, nowIso } from '../core/time.js';
import { HttpError } from '../web/http.js';
import { radarFetch } from './net.js';
import { addUsage, getUsage, setUsage, youtubeDay } from './usage.js';
import { analyzeText, applyAnalysis, matchGenres, recomputeCreator } from './enrich.js';
import { normalizeLangCode, pickLanguage } from './language.js';
import { mergeTags, findCreatorByLinkedProfiles } from './common.js';

export class QuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaError';
    this.status = 429;
  }
}

const toInt = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

function mapError(status, body) {
  const err = body?.error || {};
  const reasons = [...(err.errors || []).map((e) => e.reason), ...(err.details || []).map((d) => d.reason)].filter(Boolean);
  const message = String(err.message || '');
  if (reasons.some((r) => ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'RATE_LIMIT_EXCEEDED'].includes(r))) {
    return new QuotaError('Das YouTube-Kontingent für heute ist aufgebraucht. Gegen 9 Uhr deutscher Zeit geht es weiter.');
  }
  if (reasons.some((r) => ['API_KEY_INVALID', 'keyInvalid'].includes(r)) || /api key not valid/i.test(message)) {
    return new HttpError(400, 'Der YouTube-API-Schlüssel ist ungültig. Bitte in der Google Cloud Console prüfen und neu eintragen.');
  }
  if (reasons.some((r) => ['accessNotConfigured', 'SERVICE_DISABLED'].includes(r)) || /has not been used|is disabled/i.test(message)) {
    return new HttpError(400, 'Die „YouTube Data API v3“ ist in deinem Google-Cloud-Projekt nicht aktiviert (APIs & Dienste → Bibliothek → aktivieren).');
  }
  if (reasons.some((r) => /BLOCKED|ipRefererBlocked/i.test(r))) {
    return new HttpError(400, 'Der YouTube-API-Schlüssel ist eingeschränkt (Referrer/IP/API). Bitte die Schlüssel-Einschränkungen in der Google Cloud Console anpassen.');
  }
  if (status === 404) {
    const e = new HttpError(404, 'Bei YouTube nicht gefunden.');
    e.notFound = true;
    return e;
  }
  return new HttpError(502, `YouTube-API-Fehler ${status}${message ? `: ${message}` : ''}`);
}

/** Small API client that counts usage and stops at the daily limits. */
export function youtubeClient({ apiKey = env('YOUTUBE_API_KEY'), fetchImpl = radarFetch, settings = getSettings() } = {}) {
  if (!apiKey) throw new HttpError(400, 'Kein YouTube-API-Schlüssel hinterlegt (Dashboard → Einrichtung).');
  const yt = settings.radar.youtube;
  const stats = { searches: 0, units: 0 };

  async function call(endpoint, params, kind) {
    const day = youtubeDay();
    const api = kind === 'search' ? 'youtube_search' : 'youtube_units';
    const limit = kind === 'search' ? yt.dailySearchLimit : yt.dailyUnitLimit;
    if (getUsage(day, api) >= limit) {
      throw new QuotaError(
        kind === 'search'
          ? `Tageslimit für YouTube-Suchen erreicht (${limit}). Gegen 9 Uhr deutscher Zeit geht es weiter.`
          : `Tageskontingent der YouTube-API erreicht (${limit} Einheiten).`,
      );
    }
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    url.searchParams.set('key', apiKey);
    addUsage(day, api, 1);
    stats[kind === 'search' ? 'searches' : 'units']++;
    let res;
    try {
      res = await fetchImpl(url.toString(), { headers: { accept: 'application/json' } });
    } catch (err) {
      throw new HttpError(502, `YouTube ist nicht erreichbar (${err.message}).`);
    }
    let body = {};
    try {
      body = await res.json();
    } catch { /* empty body */ }
    if (!res.ok) {
      const e = mapError(res.status, body);
      if (e instanceof QuotaError) setUsage(day, api, limit);
      throw e;
    }
    return body;
  }

  // maxResults is not supported together with id/forHandle lookups (YouTube docs) – only send it for lists.
  const withMax = (p) => (p.id || p.forHandle || p.forUsername ? p : { maxResults: 50, ...p });

  return {
    stats,
    search: (p) => call('search', { part: 'snippet', maxResults: 50, ...p }, 'search'),
    channels: (p) => call('channels', { part: 'snippet,statistics,brandingSettings,contentDetails', ...withMax(p) }, 'units'),
    playlistItems: (p) => call('playlistItems', { part: 'snippet,contentDetails', maxResults: 50, ...p }, 'units'),
    videos: (p) => call('videos', { part: 'snippet,statistics,contentDetails,liveStreamingDetails', ...withMax(p) }, 'units'),
  };
}

function mostCommonLang(codes) {
  const counts = {};
  for (const c of codes.map(normalizeLangCode).filter(Boolean)) counts[c] = (counts[c] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

const round2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

/** Turns channels.list + videos.list items into account fields and texts for contacts/language. */
export function analyzeYoutubeChannel(ch, videos = [], settings = getSettings(), now = new Date()) {
  const sn = ch.snippet || {};
  const st = ch.statistics || {};
  const br = ch.brandingSettings?.channel || {};
  const followers = st.hiddenSubscriberCount ? null : toInt(st.subscriberCount);
  const custom = sn.customUrl ? normalizeHandle(sn.customUrl) : null;
  const vids = videos
    .filter((v) => v && v.snippet)
    .sort((a, b) => String(b.snippet.publishedAt || '').localeCompare(String(a.snippet.publishedAt || '')));
  const textOf = (v) => `${v.snippet.title || ''} ${(v.snippet.tags || []).join(' ')}`;
  const n = vids.length;
  const roblox_share = n
    ? vids.filter((v) => /roblox/i.test(textOf(v))).length / n
    : /roblox/i.test(`${sn.title || ''} ${sn.description || ''} ${br.keywords || ''}`) ? 0.5 : 0;
  const isLive = (v) => Boolean(v.liveStreamingDetails?.actualStartTime) || ['live', 'upcoming'].includes(v.snippet.liveBroadcastContent);
  const live_share = n ? vids.filter(isLive).length / n : 0;
  const viewed = vids.filter((v) => !['upcoming', 'live'].includes(v.snippet.liveBroadcastContent) && v.statistics?.viewCount !== undefined);
  const avg_views = viewed.length ? Math.round(viewed.reduce((sum, v) => sum + (toInt(v.statistics.viewCount) || 0), 0) / viewed.length) : null;
  const dates = vids.map((v) => v.liveStreamingDetails?.actualStartTime || v.snippet.publishedAt).filter(Boolean).sort();
  const latest = vids[0];
  const country = String(sn.country || br.country || '').toUpperCase() || null;
  const platformLangs = [...vids.map((v) => v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage), sn.defaultLanguage, br.defaultLanguage].filter(Boolean);

  return {
    displayName: sn.title || (custom ? `@${custom}` : ch.id),
    country,
    account: {
      platform: 'youtube',
      external_id: ch.id,
      handle: custom || undefined,
      display_handle: sn.customUrl || undefined,
      url: custom ? `https://www.youtube.com/@${custom}` : `https://www.youtube.com/channel/${ch.id}`,
      followers,
      avg_views,
      video_count: toInt(st.videoCount),
      uploads_30d: vids.filter((v) => daysSince(v.snippet.publishedAt, now) <= 30).length,
      last_active_at: dates.length ? new Date(dates[dates.length - 1]).toISOString() : null,
      roblox_share: round2(roblox_share),
      live_share: round2(live_share),
      genres: matchGenres([vids.map(textOf).join(' \n '), sn.description, br.keywords, sn.title], settings.radar.genres),
      latest_title: latest?.snippet.title || null,
      latest_url: latest ? `https://www.youtube.com/watch?v=${latest.id}` : null,
      bio: sn.description ? truncate(sn.description, 3000) : null,
      platform_language: mostCommonLang(platformLangs),
      country,
      channel_created_at: sn.publishedAt || null,
      fetched_at: nowIso(),
      source: 'youtube_api',
    },
    platformLangs,
    languageTexts: [...vids.map((v) => v.snippet.title), sn.description].filter(Boolean),
    contactTexts: [
      { text: sn.description || '', source: 'youtube_description' },
      ...vids.slice(0, 3).map((v) => ({ text: v.snippet.description || '', source: 'youtube_video' })),
    ],
  };
}

/**
 * Saves an analysed channel (create or update, merging duplicates via channel/email/linked profiles).
 * Options: tags, language (manual), notes, email (business email from an import), source.
 * Returns { status: 'added'|'updated'|'skipped', id? }.
 */
export function saveYoutubeAnalysis(a, { tags, language, notes, email, source = 'youtube', followers, age_group } = {}) {
  const db = getDb();
  const analyses = a.contactTexts.map((t) => ({ ...t, analysis: analyzeText(t.text, { sourcePlatform: 'youtube' }) }));
  const foundEmails = uniq([...analyses.flatMap((x) => x.analysis.emails.map((e) => e.value)), ...(email ? [email] : [])]);
  const accountId = { platform: 'youtube', external_id: a.account.external_id, handle: a.account.handle };
  if (isSuppressed({ emails: foundEmails, accounts: [accountId] })) return { status: 'skipped', reason: 'abgemeldet' };

  return db.tx(() => {
    let creator = findCreatorByAccount('youtube', { externalId: a.account.external_id, handle: a.account.handle });
    if (!creator) for (const e of foundEmails) if ((creator = findCreatorByEmail(e))) break;
    if (!creator) creator = findCreatorByLinkedProfiles(analyses.flatMap((x) => x.analysis.profiles), 'youtube');
    const created = !creator;
    const id = creator?.id ?? createCreator({ display_name: a.displayName, source, country: a.country || undefined });
    const account = { ...a.account };
    if (followers !== undefined && followers !== null && (account.followers === null || account.followers === undefined)) account.followers = followers;
    upsertAccount(id, account);
    for (const x of analyses) applyAnalysis(id, x.analysis, { source: x.source });
    if (email) addContact(id, { type: 'email', value: email, source: 'import', is_business: 1 });

    const cur = getCreator(id);
    const update = {};
    if (language) {
      update.language = language;
      update.language_source = 'manual';
    } else if (!['manual', 'application'].includes(cur.language_source)) {
      const pick = pickLanguage({ platformLangs: a.platformLangs, texts: a.languageTexts });
      if (pick.language) {
        update.language = pick.language;
        update.language_source = pick.source;
      }
    }
    if (!cur.country && a.country) update.country = a.country;
    if (tags?.length) update.tags = mergeTags(cur.tags, tags);
    if (notes) update.notes = cur.notes ? `${cur.notes}\n${notes}` : notes;
    if (age_group && cur.age_group === 'unbekannt') update.age_group = age_group;
    if (Object.keys(update).length) updateCreator(id, update);
    recomputeCreator(id);
    return { status: created ? 'added' : 'updated', id };
  });
}

/** Latest uploads (playlistItems + videos), [] for channels without uploads. */
export async function fetchRecentVideos(client, ch, max) {
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];
  let pl;
  try {
    pl = await client.playlistItems({ playlistId: uploads, maxResults: Math.max(1, Math.min(50, max || 12)) });
  } catch (err) {
    if (err.notFound) return [];
    throw err;
  }
  const ids = (pl.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const res = await client.videos({ id: ids.join(',') });
  return res.items || [];
}

function normalizeQueries(queries, langs, defaults) {
  const out = {};
  if (Array.isArray(queries) || typeof queries === 'string') {
    const list = (Array.isArray(queries) ? queries : queries.split(/\r?\n/)).map((q) => String(q).trim()).filter(Boolean);
    for (const l of langs) out[l] = list;
    return out;
  }
  for (const l of langs) {
    const list = queries && typeof queries === 'object' && queries[l] ? queries[l] : defaults?.[l] || [];
    out[l] = (Array.isArray(list) ? list : String(list).split(/\r?\n/)).map((q) => String(q).trim()).filter(Boolean);
  }
  return out;
}

function interleave(lists) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

// "date" first: the newest uploads come mostly from small channels; "relevance" adds established ones.
const ORDERS = ['date', 'relevance'];
const CURSOR_RESET_DAYS = 3;

/** All search streams (language × query × order) in round-robin order. */
export function searchStreams(qmap, langs) {
  const out = [];
  for (const order of ORDERS) {
    const perLang = langs.map((lang) => (qmap[lang] || []).map((q) => ({ lang, q, order, key: `${lang}|${order}|${q.toLowerCase()}` })));
    out.push(...interleave(perLang));
  }
  return out;
}

function freshCursor(key, now, windowDays) {
  return {
    source: 'youtube',
    stream: key,
    page_token: null,
    pages_done: 0,
    exhausted: 0,
    published_after: new Date(now.getTime() - windowDays * 86_400_000).toISOString(),
    new_channels: 0,
    updated_at: now.toISOString(),
  };
}

function loadCursor(key, now, windowDays) {
  const row = getDb().get("SELECT * FROM discovery_cursor WHERE source = 'youtube' AND stream = :key", { key });
  if (!row || !row.published_after || daysSince(row.updated_at, now) > CURSOR_RESET_DAYS) return freshCursor(key, now, windowDays);
  return { ...row };
}

function saveCursor(c) {
  getDb().run(
    `INSERT INTO discovery_cursor (source, stream, page_token, pages_done, exhausted, published_after, new_channels, updated_at)
     VALUES (:source, :stream, :page_token, :pages_done, :exhausted, :published_after, :new_channels, :updated_at)
     ON CONFLICT(source, stream) DO UPDATE SET page_token = excluded.page_token, pages_done = excluded.pages_done,
       exhausted = excluded.exhausted, published_after = excluded.published_after,
       new_channels = excluded.new_channels, updated_at = excluded.updated_at`,
    c,
  );
}

/**
 * Searches recent Roblox videos per language, then checks channels and saves fitting ones.
 * Returns { found, added, updated, skipped, searches, units }.
 */
export async function runYoutubeDiscovery({
  languages, queries, maxSearches, onLog = () => {}, onProgress = () => {}, signal, fetchImpl = radarFetch, now = new Date(),
} = {}) {
  const settings = getSettings();
  const yt = settings.radar.youtube;
  const client = youtubeClient({ fetchImpl, settings });
  const langs = (languages?.length ? languages : settings.radar.languages).filter(Boolean);
  const qmap = normalizeQueries(queries, langs, yt.queries);
  const streams = searchStreams(qmap, langs);
  const summary = { found: 0, added: 0, updated: 0, skipped: 0, searches: 0, units: 0 };
  if (!streams.length) throw new HttpError(400, 'Keine Suchbegriffe für die gewählten Sprachen hinterlegt.');
  const remaining = Math.max(0, yt.dailySearchLimit - getUsage(youtubeDay(now), 'youtube_search'));
  const budget = Math.min(Number(maxSearches) > 0 ? Number(maxSearches) : yt.maxSearchesPerRun, remaining);
  if (budget <= 0) {
    onLog('Das Tageslimit für YouTube-Suchen ist erreicht – gegen 9 Uhr deutscher Zeit geht es weiter.');
    return summary;
  }
  // Each run continues where the last one stopped (per language, query and sort order),
  // so several runs a day keep finding new channels instead of repeating the same searches.
  const maxPages = Math.min(10, Math.max(1, Number(yt.pagesPerQuery) || 5));
  const windowDays = Number(yt.publishedWithinDays) || 45;
  const cursors = new Map(streams.map((st) => [st.key, loadCursor(st.key, now, windowDays)]));
  const eligible = (st) => {
    const c = cursors.get(st.key);
    return !c.exhausted && c.pages_done < maxPages;
  };
  if (!streams.some(eligible)) {
    onLog('Alle Suchbegriffe sind durchsucht – es geht wieder von vorn los. Tipp: Neue Suchbegriffe (Finden → YouTube) bringen mehr neue Kanäle.');
    for (const st of streams) cursors.set(st.key, freshCursor(st.key, now, windowDays));
  }
  const pickNext = () => {
    let best = null;
    for (const st of streams) {
      if (!eligible(st)) continue;
      if (!best || cursors.get(st.key).pages_done < cursors.get(best.key).pages_done) best = st;
    }
    return best;
  };
  onLog(`Start: ${streams.length / ORDERS.length} Suchbegriffe × neueste/beliebteste (${langs.join(', ')}), bis zu ${budget} Suchaufrufe (heute noch ${remaining} frei).`);
  const hits = new Map();

  while (summary.searches < budget && !signal?.aborted) {
    const st = pickNext();
    if (!st) break;
    const c = cursors.get(st.key);
    let res;
    try {
      res = await client.search({
        q: st.q,
        type: 'video',
        order: st.order,
        publishedAfter: c.published_after,
        relevanceLanguage: st.lang,
        pageToken: c.page_token || undefined,
      });
    } catch (err) {
      if (err instanceof QuotaError) {
        onLog(err.message);
        break;
      }
      if (/page ?token/i.test(err.message)) {
        // Outdated page token: start this search again from page 1.
        summary.searches++;
        const reset = freshCursor(st.key, now, windowDays);
        cursors.set(st.key, reset);
        saveCursor(reset);
        continue;
      }
      throw err;
    }
    summary.searches++;
    let fresh = 0;
    for (const item of res.items || []) {
      const cid = item.snippet?.channelId;
      if (!cid) continue;
      if (!hits.has(cid)) {
        hits.set(cid, { lang: st.lang });
        fresh++;
      }
    }
    const next = {
      ...c,
      page_token: res.nextPageToken || null,
      pages_done: c.pages_done + 1,
      exhausted: res.nextPageToken ? 0 : 1,
      new_channels: (c.new_channels || 0) + fresh,
      updated_at: now.toISOString(),
    };
    cursors.set(st.key, next);
    saveCursor(next);
    onLog(`„${st.q}“ (${st.lang}, ${st.order === 'date' ? 'neueste' : 'beliebteste'}), Seite ${next.pages_done}: ${res.items?.length || 0} Videos, ${fresh} neue Kanäle`);
  }
  if (signal?.aborted) {
    onLog('Abgebrochen.');
    return summary;
  }

  const channels = [];
  for (const batch of chunk([...hits.keys()], 50)) {
    if (signal?.aborted) break;
    try {
      const res = await client.channels({ id: batch.join(',') });
      channels.push(...(res.items || []));
    } catch (err) {
      if (err instanceof QuotaError) {
        onLog(err.message);
        break;
      }
      throw err;
    }
  }
  const { minFollowers, maxFollowers } = settings.radar;
  const candidates = channels.filter((ch) => {
    const st = ch.statistics || {};
    if (st.hiddenSubscriberCount) return false;
    const subs = toInt(st.subscriberCount);
    return subs !== null && subs >= minFollowers && subs <= maxFollowers;
  });
  summary.found = candidates.length;
  summary.skipped += channels.length - candidates.length;
  onLog(`${channels.length} Kanäle geprüft, ${candidates.length} liegen zwischen ${minFollowers} und ${maxFollowers} Abos.`);
  onProgress({ ...summary });

  const db = getDb();
  const minShare = yt.minRobloxShare ?? 0.25;
  for (const ch of candidates) {
    if (signal?.aborted) {
      onLog('Abgebrochen.');
      break;
    }
    try {
      const known = db.get("SELECT creator_id, fetched_at FROM accounts WHERE platform = 'youtube' AND external_id = :id", { id: ch.id });
      if (known && daysSince(known.fetched_at, now) < 3) {
        // Seen recently: only refresh the numbers from channels.list (no extra quota).
        const a = analyzeYoutubeChannel(ch, [], settings, now);
        upsertAccount(known.creator_id, {
          platform: 'youtube',
          external_id: ch.id,
          followers: a.account.followers,
          video_count: a.account.video_count,
          fetched_at: nowIso(),
        });
        recomputeCreator(known.creator_id);
        summary.updated++;
      } else {
        const videos = await fetchRecentVideos(client, ch, yt.recentVideos);
        const a = analyzeYoutubeChannel(ch, videos, settings, now);
        if (videos.length >= 3 && a.account.roblox_share < minShare) {
          summary.skipped++;
        } else {
          const r = saveYoutubeAnalysis(a, { source: 'youtube' });
          summary[r.status]++;
        }
      }
    } catch (err) {
      if (err instanceof QuotaError) {
        onLog(err.message);
        break;
      }
      onLog(`Kanal „${ch.snippet?.title || ch.id}“: ${err.message}`);
      summary.skipped++;
    }
    onProgress({ ...summary });
  }
  summary.units = client.stats.units;
  onLog(`Fertig: ${summary.added} neu, ${summary.updated} aktualisiert, ${summary.skipped} übersprungen (${summary.searches} Suchen, ${summary.units} Einheiten).`);
  return summary;
}

/** Finds the channel for a parsed profile link (@handle, channel id, video link, legacy /user or /c). */
export async function resolveYoutubeChannel(parsed, client) {
  let res = null;
  if (parsed.externalId) res = await client.channels({ id: parsed.externalId });
  else if (parsed.videoId) {
    const v = await client.videos({ id: parsed.videoId, part: 'snippet' });
    const cid = v.items?.[0]?.snippet?.channelId;
    if (!cid) return null;
    res = await client.channels({ id: cid });
  } else if (parsed.legacy === 'user') res = await client.channels({ forUsername: parsed.handle });
  else if (parsed.legacy === 'c') {
    const s = await client.search({ q: parsed.handle, type: 'channel', maxResults: 1 });
    const cid = s.items?.[0]?.snippet?.channelId || s.items?.[0]?.id?.channelId;
    if (!cid) return null;
    res = await client.channels({ id: cid });
  } else if (parsed.handle) res = await client.channels({ forHandle: `@${parsed.handle}` });
  return res?.items?.[0] || null;
}

/** Import of one YouTube link with full API data. */
export async function importYoutubeChannel(parsed, { fetchImpl = radarFetch, extra = {} } = {}) {
  const settings = getSettings();
  const client = youtubeClient({ fetchImpl, settings });
  const ch = await resolveYoutubeChannel(parsed, client);
  if (!ch) throw new HttpError(404, 'YouTube-Kanal nicht gefunden.');
  const videos = await fetchRecentVideos(client, ch, settings.radar.youtube.recentVideos);
  return saveYoutubeAnalysis(analyzeYoutubeChannel(ch, videos, settings), { ...extra, source: extra.source || 'import' });
}

/**
 * Refreshes stored YouTube accounts (retention rule: refresh or delete after 30 days).
 * rows: [{ id, creator_id, external_id }]. Returns { refreshed, missing: rows }.
 */
export async function refreshYoutubeAccounts(rows, { fetchImpl = radarFetch } = {}) {
  const settings = getSettings();
  const client = youtubeClient({ fetchImpl, settings });
  let refreshed = 0;
  const missing = [];
  for (const batch of chunk(rows.filter((r) => r.external_id), 50)) {
    const res = await client.channels({ id: batch.map((r) => r.external_id).join(',') });
    const byId = new Map((res.items || []).map((i) => [i.id, i]));
    for (const row of batch) {
      const ch = byId.get(row.external_id);
      if (!ch) {
        missing.push(row);
        continue;
      }
      const videos = await fetchRecentVideos(client, ch, settings.radar.youtube.recentVideos);
      const a = analyzeYoutubeChannel(ch, videos, settings);
      upsertAccount(row.creator_id, a.account);
      recomputeCreator(row.creator_id);
      refreshed++;
    }
  }
  return { refreshed, missing };
}
