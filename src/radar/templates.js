// Message templates: defaults, selection (language/variant), rendering with placeholders.
import { getDb } from '../core/db.js';
import { getSettings } from '../core/settings.js';
import { PLATFORM_LABELS } from '../core/urls.js';
import { formatDate, formatTime, nowIso, toDate, tzOffsetMinutes, zoneLabel } from '../core/time.js';
import { truncate } from '../core/util.js';
import { DEFAULT_TEMPLATES } from './default-templates.js';

export const STEPS = ['first', 'followup'];
export const CHANNELS = ['email', 'dm', 'discord'];
export const TEMPLATE_LANGUAGES = ['de', 'en', 'es', 'pt', 'fr', 'pl', 'tr', 'it', 'nl'];

export const PLACEHOLDERS = [
  { key: 'name', label: 'Name des Creators' },
  { key: 'video', label: 'Titel des letzten Videos/Streams' },
  { key: 'game', label: 'Spielname' },
  { key: 'pitch', label: 'Kurzbeschreibung des Spiels (in der Sprache des Creators)' },
  { key: 'date', label: 'Launch-Datum' },
  { key: 'time', label: 'Launch-Uhrzeit' },
  { key: 'link', label: 'Infoseite (sonst Spiel-Link)' },
  { key: 'discord', label: 'Persönlicher Discord-Einladungslink' },
  { key: 'sender', label: 'Absendername' },
  { key: 'studio', label: 'Studio-Name' },
  { key: 'privacy', label: 'Link zur Datenschutzerklärung' },
  { key: 'reward', label: 'Belohnung für Zuschauer mit Creator-Code' },
  { key: 'platform', label: 'Plattform des Creators (YouTube, TikTok …)' },
];
const KNOWN = new Set(PLACEHOLDERS.map((p) => p.key));

export const templateKey = ({ step, channel, language, variant = 'A' }) => `${step}.${channel}.${language}.${variant}`;

export function parseTemplateKey(key) {
  const [step, channel, language, variant] = String(key || '').split('.');
  if (!STEPS.includes(step) || !CHANNELS.includes(channel) || !/^[a-z]{2}$/.test(language || '') || !/^[A-Z]$/.test(variant || '')) return null;
  return { step, channel, language, variant };
}

const DEFAULT_KEYS = () => new Set(DEFAULT_TEMPLATES.map((t) => t.key || templateKey(t)));

/** Inserts/updates the default templates (user-edited ones are kept). Returns the count. */
export function ensureDefaultTemplates() {
  const db = getDb();
  let n = 0;
  db.tx(() => {
    for (const t of DEFAULT_TEMPLATES) {
      const key = t.key || templateKey(t);
      const parsed = parseTemplateKey(key);
      if (!parsed || !t.body) continue;
      db.run(
        `INSERT INTO templates (key, step, channel, language, variant, subject, body, updated_at)
         VALUES (:key, :step, :channel, :language, :variant, :subject, :body, :now)
         ON CONFLICT(key) DO UPDATE SET subject = excluded.subject, body = excluded.body, updated_at = excluded.updated_at
         WHERE templates.is_custom = 0`,
        { key, ...parsed, subject: t.subject ?? null, body: t.body, now: nowIso() },
      );
      n++;
    }
  });
  return n;
}

export function listTemplates() {
  return getDb().all('SELECT * FROM templates ORDER BY step, channel, language, variant');
}

export function getTemplate(key) {
  return getDb().get('SELECT * FROM templates WHERE key = :key', { key });
}

export function updateTemplate(key, { subject, body, active }) {
  const t = getTemplate(key);
  if (!t) return null;
  getDb().run(
    `UPDATE templates SET subject = :subject, body = :body, active = :active, is_custom = 1, updated_at = :now WHERE key = :key`,
    {
      key,
      subject: subject !== undefined ? subject : t.subject,
      body: body !== undefined ? body : t.body,
      active: active !== undefined ? (active ? 1 : 0) : t.active,
      now: nowIso(),
    },
  );
  return getTemplate(key);
}

export function createTemplate({ step, channel, language, variant = 'A', subject = null, body }) {
  const key = templateKey({ step, channel, language, variant });
  if (!parseTemplateKey(key)) throw new Error('Ungültige Vorlage (Schritt, Kanal, Sprache oder Variante).');
  if (!body || !String(body).trim()) throw new Error('Text der Vorlage fehlt.');
  if (getTemplate(key)) throw new Error(`Vorlage ${key} gibt es schon.`);
  getDb().run(
    `INSERT INTO templates (key, step, channel, language, variant, subject, body, is_custom, updated_at)
     VALUES (:key, :step, :channel, :language, :variant, :subject, :body, 1, :now)`,
    { key, step, channel, language, variant, subject, body, now: nowIso() },
  );
  return getTemplate(key);
}

/** Deletes a user-created template (defaults can only be deactivated or reset). */
export function deleteTemplate(key) {
  if (DEFAULT_KEYS().has(key)) throw new Error('Standard-Vorlagen kann man nicht löschen – nur deaktivieren oder zurücksetzen.');
  return getDb().run('DELETE FROM templates WHERE key = :key', { key }).changes > 0;
}

export function resetTemplate(key) {
  const def = DEFAULT_TEMPLATES.find((t) => (t.key || templateKey(t)) === key);
  if (!def) return null;
  getDb().run(
    `UPDATE templates SET subject = :subject, body = :body, active = 1, is_custom = 0, updated_at = :now WHERE key = :key`,
    { key, subject: def.subject ?? null, body: def.body, now: nowIso() },
  );
  return getTemplate(key);
}

/**
 * Picks the template for a step/channel in the creator's language (fallback en, then de).
 * Discord falls back to the DM templates. With A/B testing the variant alternates by outreach id.
 */
export function pickTemplate({ step, channel, language, outreachId = 0, settings = getSettings() }) {
  const db = getDb();
  const find = (ch, lang) => db.all(
    'SELECT * FROM templates WHERE step = :step AND channel = :ch AND language = :lang AND active = 1 ORDER BY variant',
    { step, ch, lang },
  );
  const channels = channel === 'discord' ? ['discord', 'dm'] : [channel];
  const langs = [...new Set([language, 'en', 'de'].filter(Boolean))];
  for (const ch of channels) {
    for (const lang of langs) {
      const list = find(ch, lang);
      if (!list.length) continue;
      if (!settings.radar.abTest || list.length === 1) return list[0];
      return list[Math.abs(Number(outreachId) || 0) % list.length];
    }
  }
  return null;
}

function berlinZone(date, lang) {
  const summer = tzOffsetMinutes(toDate(date), 'Europe/Berlin') === 120;
  if (lang === 'de') return summer ? 'MESZ' : 'MEZ';
  return summer ? 'CEST' : 'CET';
}

/** "Samstag, 21. November" / "Saturday, November 21". */
export function formatLaunchDate(at, lang = 'de', timeZone = 'Europe/Berlin') {
  if (!toDate(at)) return '';
  return formatDate(at, lang, timeZone, { year: false });
}

/** "19:00 Uhr" (de) / "7:00 PM CET (1:00 PM ET)" (en) / "19:00 CET (15:00 Brasília)" (pt) … */
export function formatLaunchTime(at, lang = 'de', timeZone = 'Europe/Berlin') {
  if (!toDate(at)) return '';
  if (lang === 'de') return `${formatTime(at, 'de', timeZone)} Uhr`;
  const zone = timeZone === 'Europe/Berlin' ? berlinZone(at, lang) : zoneLabel(at, lang, timeZone);
  const local = `${formatTime(at, lang, timeZone)} ${zone}`.trim();
  if (lang === 'en') return `${local} (${formatTime(at, 'en', 'America/New_York')} ET)`;
  if (lang === 'pt') return `${local} (${formatTime(at, 'pt', 'America/Sao_Paulo')} Brasília)`;
  if (lang === 'es') return `${local} (${formatTime(at, 'es', 'America/Mexico_City')} CDMX)`;
  return local;
}

/** Display name without emojis and "| Roblox"/"YT"-style suffixes. */
export function cleanName(name) {
  let s = String(name ?? '').replace(/\p{Extended_Pictographic}|️|‍/gu, '').trim();
  s = s.replace(/\s*[|•·\-–—]\s*(roblox|yt|youtube|ttv|twitch|tiktok|gaming|live|official)\b.*$/i, '').trim();
  s = s.replace(/^(ttv|yt)[\s_-]+/i, '').replace(/[\s_-]+(ttv|yt)$/i, '').trim();
  return s || String(name ?? '').trim();
}

/** Placeholder values for a creator. */
export function buildVars(full, { language, inviteUrl = null, settings = getSettings() } = {}) {
  const g = settings.game || {};
  const lang = language || full?.creator?.language || 'en';
  const tz = g.timezone || 'Europe/Berlin';
  const accounts = [...(full?.accounts || [])];
  const latest = accounts
    .filter((a) => a.latest_title)
    .sort((a, b) => String(b.last_active_at || '').localeCompare(String(a.last_active_at || '')))[0];
  const primary = accounts.find((a) => a.source && a.source !== 'crosslink') || accounts[0];
  return {
    name: cleanName(full?.creator?.display_name || ''),
    video: latest ? truncate(latest.latest_title, 70) : '',
    game: g.name || '',
    pitch: g[`pitch_${lang}`] || g.pitch_en || g.pitch_de || '',
    date: g.launchAt ? formatLaunchDate(g.launchAt, lang, tz) : '',
    time: g.launchAt ? formatLaunchTime(g.launchAt, lang, tz) : '',
    link: g.infoUrl || g.url || '',
    discord: inviteUrl || g.discordInvite || '',
    sender: g.senderName || '',
    studio: g.studioName || '',
    privacy: g.privacyUrl || '',
    reward: g[`codeReward_${lang}`] || g.codeReward_en || g.codeReward_de || '',
    platform: primary ? PLATFORM_LABELS[primary.platform] || primary.platform : '',
  };
}

function splitOnce(s, sep) {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + sep.length)];
}

/**
 * Renders "{name}" placeholders and conditional blocks "[[Text mit {video}||Ersatz]]".
 * Returns { text, missing: [placeholder keys without value] }.
 */
export function renderString(str, vars = {}) {
  const missing = new Set();
  const filled = (k) => vars[k] !== undefined && vars[k] !== null && String(vars[k]).trim() !== '';
  let out = String(str ?? '').replace(/\[\[([\s\S]*?)\]\]/g, (m, inner) => {
    const [a, b] = splitOnce(inner, '||');
    const keys = [...a.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).filter((k) => KNOWN.has(k));
    return keys.every(filled) ? a : b;
  });
  out = out.replace(/\{(\w+)\}/g, (m, k) => {
    if (!KNOWN.has(k)) return m;
    if (filled(k)) return String(vars[k]);
    missing.add(k);
    return '';
  });
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.])/g, '$1').replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: out, missing: [...missing] };
}

/** Renders subject + body of a template row. */
export function renderTemplate(template, vars) {
  const subject = template?.subject ? renderString(template.subject, vars) : { text: '', missing: [] };
  const body = renderString(template?.body || '', vars);
  return { subject: subject.text, body: body.text, missing: [...new Set([...subject.missing, ...body.missing])] };
}
