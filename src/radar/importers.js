// Imports: list of profile links, CSV files and the bookmark "quick capture".
import { env } from '../core/config.js';
import { getDb } from '../core/db.js';
import {
  addContact, createCreator, findCreatorByAccount, findCreatorByEmail, getCreator, isSuppressed, updateCreator, upsertAccount,
} from '../core/creators.js';
import { parseProfileUrl, profileUrl, PLATFORMS } from '../core/urls.js';
import { normalizeEmail, normalizeHandle, parseCount, stripDiacritics, truncate } from '../core/util.js';
import { HttpError } from '../web/http.js';
import { analyzeText, applyAnalysis, matchGenres, recomputeCreator } from './enrich.js';
import { detectFromTexts, normalizeLangCode } from './language.js';
import { importYoutubeChannel, QuotaError } from './youtube.js';
import { importTwitchUser, twitchConfigured } from './twitch.js';
import { mergeTags, VALID_AGE_GROUPS, findCreatorByLinkedProfiles } from './common.js';
import { getListItem } from './repo.js';

const EMAIL_RE = /^[^\s@/:]+@[^\s@/:]+\.[a-z]{2,}$/i;

function normTags(tags) {
  if (!tags) return [];
  return (Array.isArray(tags) ? tags : String(tags).split(/[,|]/)).map((t) => String(t).trim()).filter(Boolean);
}

/**
 * Adds or updates one creator from a profile link or platform+handle.
 * YouTube/Twitch links are completed via the APIs when keys are configured.
 * Returns { status: 'added'|'updated'|'skipped', id?, reason? }.
 */
export async function importProfile(input, { fetchImpl } = {}) {
  const {
    url, platform: platformIn, handle: handleIn, name, followers: followersIn, email: emailIn, bio, language: langIn,
    tags: tagsIn, notes, age_group, source = 'import',
  } = input || {};
  let parsed = url ? parseProfileUrl(url) : null;
  if (!parsed && platformIn && handleIn && PLATFORMS.includes(platformIn)) {
    const handle = normalizeHandle(handleIn);
    parsed = { platform: platformIn, handle, url: profileUrl(platformIn, handle) };
  }
  if (parsed?.platform === 'discord') throw new HttpError(400, 'Discord-Einladungen bitte direkt beim Creator als Kontakt eintragen.');
  const email = emailIn && EMAIL_RE.test(String(emailIn).trim()) ? normalizeEmail(emailIn) : null;
  if (!parsed && !email) {
    throw new HttpError(400, url ? `Link nicht erkannt: ${truncate(url, 80)} (YouTube, TikTok, Instagram, Twitch, X oder Kick).` : 'Link oder E-Mail fehlt.');
  }
  const followers = parseCount(followersIn);
  const language = normalizeLangCode(langIn);
  const tags = normTags(tagsIn);
  const ageGroup = VALID_AGE_GROUPS.includes(age_group) ? age_group : null;
  const extra = { email, language, tags, notes, age_group: ageGroup, followers, source };

  const identity = parsed ? [{ platform: parsed.platform, external_id: parsed.externalId, handle: parsed.handle }] : [];
  if (isSuppressed({ emails: email ? [email] : [], accounts: identity })) return { status: 'skipped', reason: 'abgemeldet' };

  // Full API import where possible.
  if (parsed?.platform === 'youtube' && env('YOUTUBE_API_KEY')) {
    try {
      return await importYoutubeChannel(parsed, { fetchImpl, extra });
    } catch (err) {
      if (!(err instanceof QuotaError) && err.status !== 502) throw err;
      // Quota/network problem: store the link anyway, numbers come later.
    }
  }
  if (parsed?.platform === 'twitch' && parsed.handle && twitchConfigured()) {
    try {
      return await importTwitchUser(parsed.handle, { fetchImpl, extra });
    } catch (err) {
      if (err.status !== 502 && err.status !== 429) throw err;
    }
  }
  if (parsed?.platform === 'youtube' && parsed.videoId && !parsed.handle && !parsed.externalId) {
    throw new HttpError(400, 'Video-Links brauchen den YouTube-Schlüssel – bitte den Kanal-Link (youtube.com/@name) verwenden.');
  }
  return saveBasicProfile({ parsed, name, bio, ...extra });
}

/** Stores a profile without API data (TikTok, Instagram, X, Kick – or when no key is set). */
export function saveBasicProfile({ parsed, name, bio, email, language, tags, notes, age_group, followers, source }) {
  const db = getDb();
  const analysis = bio ? analyzeText(bio, { sourcePlatform: parsed?.platform }) : null;
  return db.tx(() => {
    let creator = parsed ? findCreatorByAccount(parsed.platform, { externalId: parsed.externalId, handle: parsed.handle }) : null;
    if (!creator && email) creator = findCreatorByEmail(email);
    if (!creator && analysis) for (const e of analysis.emails) if ((creator = findCreatorByEmail(e.value))) break;
    if (!creator && analysis && parsed) creator = findCreatorByLinkedProfiles(analysis.profiles, parsed.platform);
    const created = !creator;
    const displayName = String(name || '').trim() || (parsed?.handle ? `@${parsed.handle}` : null) || email;
    const id = creator?.id ?? createCreator({ display_name: displayName, source });
    if (parsed) {
      const account = {
        platform: parsed.platform,
        external_id: parsed.externalId || undefined,
        handle: parsed.handle || undefined,
        url: parsed.url,
        source,
      };
      if (followers !== null && followers !== undefined) account.followers = followers;
      if (bio) {
        account.bio = truncate(bio, 2000);
        account.genres = matchGenres([bio, name]);
      }
      upsertAccount(id, account);
    }
    if (email) addContact(id, { type: 'email', value: email, source, is_business: 1 });
    if (analysis) {
      applyAnalysis(id, analysis, { source: `${source}_bio`, sourceAccount: parsed?.handle ? { platform: parsed.platform, handle: parsed.handle } : null });
    }
    const cur = getCreator(id);
    const update = {};
    if (!created && name && cur.display_name.startsWith('@') && !String(name).startsWith('@')) update.display_name = String(name).trim();
    if (language) {
      update.language = language;
      update.language_source = 'manual';
    } else if (!cur.language && bio) {
      const lang = detectFromTexts([bio]);
      if (lang) {
        update.language = lang;
        update.language_source = 'detected';
      }
    }
    if (tags?.length) update.tags = mergeTags(cur.tags, tags);
    if (notes) update.notes = cur.notes ? `${cur.notes}\n${notes}` : notes;
    if (age_group && cur.age_group === 'unbekannt') update.age_group = age_group;
    if (Object.keys(update).length) updateCreator(id, update);
    recomputeCreator(id);
    return { status: created ? 'added' : 'updated', id };
  });
}

/**
 * One link per line, optionally "URL; Follower; E-Mail" (also tab separated).
 * Returns { added, updated, skipped, errors: [{ line, error }] }.
 */
export async function importUrls(text, { language, tags, fetchImpl } = {}) {
  const summary = { added: 0, updated: 0, skipped: 0, errors: [] };
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s*[;\t]\s*/).map((s) => s.trim()).filter(Boolean);
    const url = parts.find((p) => parseProfileUrl(p)) || parts[0];
    const email = parts.find((p) => EMAIL_RE.test(p));
    const followers = parts.find((p) => p !== url && p !== email && parseCount(p) !== null);
    try {
      const r = await importProfile({ url, email, followers, language, tags, source: 'import' }, { fetchImpl });
      summary[r.status]++;
    } catch (err) {
      summary.errors.push({ line: i + 1, error: err.message });
    }
  }
  return summary;
}

/** RFC-4180-style CSV parser; detects ";" "," or tab from the header line. */
export function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => {
    let n = 0;
    let inQ = false;
    for (const c of firstLine) {
      if (c === '"') inQ = !inQ;
      else if (c === ch && !inQ) n++;
    }
    return n;
  };
  const delim = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const HEADER_MAP = {
  name: ['name', 'anzeigename', 'creator', 'kanalname', 'channel', 'display_name', 'displayname'],
  platform: ['platform', 'plattform', 'netzwerk'],
  url: ['url', 'link', 'profil', 'profile', 'kanal', 'channel_url', 'profil_url'],
  handle: ['handle', 'username', 'nutzername', 'benutzername', 'user', 'account'],
  email: ['email', 'e_mail', 'mail', 'e-mail', 'kontakt'],
  followers: ['followers', 'follower', 'abos', 'abonnenten', 'subscribers', 'subs', 'fans'],
  language: ['language', 'sprache', 'lang'],
  notes: ['notes', 'notiz', 'notizen', 'kommentar', 'comment'],
  tags: ['tags', 'tag', 'labels'],
  age_group: ['age_group', 'alter', 'altersgruppe', 'age'],
  bio: ['bio', 'beschreibung', 'description'],
};

function mapHeader(h) {
  const key = stripDiacritics(String(h).trim().toLowerCase()).replace(/[\s-]+/g, '_');
  for (const [field, names] of Object.entries(HEADER_MAP)) {
    if (names.map((n) => n.replace(/[\s-]+/g, '_')).includes(key)) return field;
  }
  return null;
}

/** CSV import (header row required). Same summary format as importUrls. */
export async function importCsv(csv, { language, tags, fetchImpl } = {}) {
  const rows = parseCsv(csv);
  const summary = { added: 0, updated: 0, skipped: 0, errors: [] };
  if (rows.length < 2) {
    summary.errors.push({ line: 1, error: 'CSV braucht eine Kopfzeile und mindestens eine Datenzeile.' });
    return summary;
  }
  const fields = rows[0].map(mapHeader);
  if (!fields.some((f) => ['url', 'handle', 'email'].includes(f))) {
    summary.errors.push({ line: 1, error: 'Keine Spalte für Link, Handle oder E-Mail gefunden (z. B. "url", "handle", "email").' });
    return summary;
  }
  for (let i = 1; i < rows.length; i++) {
    const rec = {};
    rows[i].forEach((value, idx) => {
      if (fields[idx] && String(value).trim() !== '') rec[fields[idx]] = String(value).trim();
    });
    if (rec.platform) rec.platform = String(rec.platform).toLowerCase().replace('twitter', 'x');
    try {
      const r = await importProfile({
        ...rec,
        language: rec.language || language,
        tags: [...normTags(rec.tags), ...normTags(tags)],
        source: 'import',
      }, { fetchImpl });
      summary[r.status]++;
    } catch (err) {
      summary.errors.push({ line: i + 1, error: err.message });
    }
  }
  return summary;
}

/** POST /api/capture (bookmark popup). Returns { id, created, creator }. */
export async function capture(payload, { fetchImpl } = {}) {
  const p = payload || {};
  const r = await importProfile({
    url: p.url,
    platform: p.platform,
    handle: p.handle,
    name: p.name,
    followers: p.followers,
    email: p.email,
    bio: p.bio,
    language: p.language,
    tags: p.tags,
    notes: p.notes,
    age_group: p.age_group,
    source: 'capture',
  }, { fetchImpl });
  if (r.status === 'skipped') {
    throw new HttpError(409, 'Dieser Creator hat sich abgemeldet und wird nicht erneut gespeichert.');
  }
  return { id: r.id, created: r.status === 'added', creator: getListItem(r.id) };
}
