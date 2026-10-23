// Radar API (docs/ARCHITEKTUR.md section 6 "Radar").
import { Router } from 'express';
import { getDb } from '../../core/db.js';
import { env } from '../../core/config.js';
import { getSettings } from '../../core/settings.js';
import {
  ALL_STATUSES, AGE_GROUPS, addContact, deleteCreator, getCreator, getCreatorFull, logActivity, setOutreachStatus,
  suppressAndDeleteCreator, updateCreator, updateOutreach, getOutreach,
} from '../../core/creators.js';
import { parseProfileUrl, profileUrl } from '../../core/urls.js';
import { normalizeEmail, normalizeHandle } from '../../core/util.js';
import { addDays } from '../../core/time.js';
import { badRequest, conflict, intParam, listParam, notFound, sendCsv } from '../http.js';
import { listCreators, allTags } from '../../radar/repo.js';
import { recomputeCreator } from '../../radar/enrich.js';
import { getQueue, markSent, prepareOutreach, recordReply, skipOutreach } from '../../radar/outreach.js';
import {
  createTemplate, deleteTemplate, getTemplate, listTemplates, PLACEHOLDERS, renderString, resetTemplate, TEMPLATE_LANGUAGES,
  updateTemplate, buildVars, parseTemplateKey,
} from '../../radar/templates.js';
import { cancelDiscovery, getRun, listRuns, startDiscovery } from '../../radar/discovery.js';
import { capture, importCsv, importProfile, importUrls } from '../../radar/importers.js';
import { importYoutubeChannel } from '../../radar/youtube.js';
import { importTwitchUser, twitchConfigured } from '../../radar/twitch.js';
import { runRetention } from '../../radar/retention.js';
import { getStats } from '../../radar/stats.js';
import { bookmarkletCode } from '../../radar/bookmarklet.js';
import { getUsage, youtubeDay } from '../../radar/usage.js';
import { mergeTags } from '../../radar/common.js';
import { LANGUAGE_LABELS } from '../../radar/language.js';

const CONTACT_TYPES = ['email', 'discord', 'tiktok', 'instagram', 'x', 'twitch', 'kick', 'youtube', 'website'];

function idParam(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw badRequest('Ungültige ID.');
  return id;
}

function requireCreator(id) {
  const c = getCreator(id);
  if (!c) throw notFound('Creator nicht gefunden.');
  return c;
}

function listFilters(q) {
  return {
    status: listParam(q.status),
    platform: q.platform || undefined,
    language: q.language || undefined,
    channel: q.channel || undefined,
    minScore: q.minScore,
    q: q.q,
    tag: q.tag || undefined,
    member: q.member,
    sort: q.sort,
    dir: q.dir,
    limit: q.limit,
    offset: q.offset,
  };
}

function normalizeContactValue(type, value) {
  const v = String(value ?? '').trim();
  if (!v) throw badRequest('Wert fehlt.');
  if (type === 'email') {
    const e = normalizeEmail(v);
    if (!/^[^\s@/:]+@[^\s@/:]+\.[a-z]{2,}$/i.test(e)) throw badRequest('Ungültige E-Mail-Adresse.');
    return { value: e, label: e };
  }
  if (type === 'discord') {
    const p = parseProfileUrl(v);
    const code = p?.platform === 'discord' ? p.inviteCode : v.replace(/^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\//i, '');
    if (!/^[A-Za-z0-9-]{2,40}$/.test(code)) throw badRequest('Ungültiger Discord-Einladungslink.');
    return { value: code, label: `https://discord.gg/${code}` };
  }
  if (type === 'website') return { value: v, label: v };
  const p = parseProfileUrl(v);
  const handle = p && p.platform === type ? p.handle || p.externalId : normalizeHandle(v);
  if (!handle) throw badRequest('Ungültiges Profil.');
  return { value: normalizeHandle(handle), label: profileUrl(type, handle) || v };
}

export default function radarRoutes() {
  const r = Router();

  // ---- Creators -----------------------------------------------------------
  r.get('/creators', (req, res) => {
    res.json(listCreators(listFilters(req.query)));
  });

  r.get('/creators/tags', (req, res) => res.json({ tags: allTags() }));

  r.get('/creators/:id', (req, res) => {
    const full = getCreatorFull(idParam(req));
    if (!full) throw notFound('Creator nicht gefunden.');
    res.json(full);
  });

  r.post('/creators', async (req, res) => {
    const b = req.body || {};
    if (!b.display_name && !b.url && !b.handle && !b.email) throw badRequest('Name, Link oder E-Mail angeben.');
    let result;
    if (b.url || (b.platform && b.handle) || b.email) {
      result = await importProfile({
        url: b.url,
        platform: b.platform,
        handle: b.handle,
        name: b.display_name,
        followers: b.followers,
        email: b.email,
        language: b.language,
        notes: b.notes,
        tags: b.tags,
        age_group: b.age_group,
        source: 'manual',
      });
      if (result.status === 'skipped') throw conflict('Dieser Creator hat sich abgemeldet.');
    } else {
      throw badRequest('Bitte einen Profil-Link oder eine E-Mail angeben.');
    }
    res.json({ id: result.id, created: result.status === 'added' });
  });

  r.patch('/creators/:id', (req, res) => {
    const id = idParam(req);
    const cur = requireCreator(id);
    const b = req.body || {};
    const f = {};
    if (b.display_name !== undefined) {
      if (!String(b.display_name).trim()) throw badRequest('Name darf nicht leer sein.');
      f.display_name = String(b.display_name).trim();
    }
    if (b.language !== undefined) {
      f.language = b.language ? String(b.language).toLowerCase().slice(0, 5) : null;
      f.language_source = b.language ? 'manual' : null;
    }
    if (b.age_group !== undefined) {
      if (!AGE_GROUPS.includes(b.age_group)) throw badRequest('Ungültige Altersgruppe.');
      f.age_group = b.age_group;
      if (b.age_group !== '18+') f.paid_ok = 0;
    }
    if (b.notes !== undefined) f.notes = b.notes ? String(b.notes) : null;
    if (b.tags !== undefined) {
      if (!Array.isArray(b.tags)) throw badRequest('tags muss eine Liste sein.');
      f.tags = mergeTags([], b.tags);
    }
    if (b.creator_code !== undefined) {
      const code = b.creator_code ? String(b.creator_code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) : null;
      if (code && getDb().get('SELECT 1 FROM creators WHERE creator_code = :code AND id != :id', { code, id })) throw conflict(`Der Code ${code} ist schon vergeben.`);
      f.creator_code = code;
    }
    if (b.share_link !== undefined) {
      const link = String(b.share_link || '').trim();
      if (link && !/^https?:\/\//i.test(link)) throw badRequest('Share Link muss mit https:// beginnen.');
      f.share_link = link || null;
    }
    if (b.discord_user_id !== undefined) {
      const did = b.discord_user_id ? String(b.discord_user_id).trim() : null;
      if (did && !/^\d{15,22}$/.test(did)) throw badRequest('Discord-ID muss eine Zahl sein.');
      if (did && getDb().get('SELECT 1 FROM creators WHERE discord_user_id = :did AND id != :id', { did, id })) throw conflict('Diese Discord-ID gehört schon zu einem anderen Creator.');
      f.discord_user_id = did;
    }
    if (b.paid_ok !== undefined) {
      const age = f.age_group || cur.age_group;
      if (b.paid_ok && age !== '18+') throw badRequest('Bezahlte Deals nur mit volljährigen Creatorn (Altersgruppe 18+).');
      f.paid_ok = b.paid_ok ? 1 : 0;
    }
    if (b.parent_consent !== undefined) f.parent_consent = b.parent_consent ? 1 : 0;
    let unlock = false;
    if (b.contact_channel !== undefined) {
      if (b.contact_channel === null || b.contact_channel === '') {
        f.contact_locked = 0;
        unlock = true;
      } else {
        if (!['email', 'dm', 'discord', 'none'].includes(b.contact_channel)) throw badRequest('Ungültiger Kontaktweg.');
        f.contact_channel = b.contact_channel;
        f.contact_target = b.contact_target ?? cur.contact_target;
        f.contact_platform = b.contact_platform ?? (b.contact_channel === 'email' ? null : cur.contact_platform);
        f.contact_locked = 1;
        if (b.contact_channel !== 'none' && !f.contact_target) throw badRequest('Ziel für den Kontaktweg fehlt (E-Mail-Adresse oder Profil-Link).');
      }
    }
    updateCreator(id, f);
    if (unlock || f.age_group !== undefined || f.language !== undefined) recomputeCreator(id);
    res.json({ creator: getCreator(id) });
  });

  r.delete('/creators/:id', (req, res) => {
    const id = idParam(req);
    if (!deleteCreator(id)) throw notFound('Creator nicht gefunden.');
    res.json({ ok: true });
  });

  r.post('/creators/:id/status', (req, res) => {
    const id = idParam(req);
    requireCreator(id);
    const { status, note } = req.body || {};
    if (!ALL_STATUSES.includes(status)) throw badRequest('Unbekannter Status.');
    const outreach = setOutreachStatus(id, status, { force: true, data: { manual: true, note: note || null } });
    res.json({ outreach: outreach || getOutreach(id) });
  });

  r.post('/creators/:id/reply', (req, res) => {
    const id = idParam(req);
    requireCreator(id);
    res.json({ outreach: recordReply(id, req.body || {}) });
  });

  r.post('/creators/:id/optout', (req, res) => {
    const id = idParam(req);
    requireCreator(id);
    suppressAndDeleteCreator(id);
    res.json({ ok: true });
  });

  r.post('/creators/:id/rescore', (req, res) => {
    const id = idParam(req);
    requireCreator(id);
    res.json({ creator: recomputeCreator(id) });
  });

  r.post('/creators/:id/refresh', async (req, res) => {
    const id = idParam(req);
    const full = getCreatorFull(id);
    if (!full) throw notFound('Creator nicht gefunden.');
    const yt = full.accounts.find((a) => a.platform === 'youtube' && (a.external_id || a.handle));
    const tw = full.accounts.find((a) => a.platform === 'twitch' && a.handle);
    let done = false;
    if (yt && env('YOUTUBE_API_KEY')) {
      await importYoutubeChannel(yt.external_id ? { platform: 'youtube', externalId: yt.external_id } : { platform: 'youtube', handle: yt.handle });
      done = true;
    }
    if (tw && twitchConfigured()) {
      await importTwitchUser(tw.handle);
      done = true;
    }
    if (!done) throw badRequest('Aktualisieren geht nur für YouTube/Twitch mit hinterlegtem Schlüssel. TikTok/Instagram bitte neu erfassen.');
    res.json({ creator: recomputeCreator(id) });
  });

  r.post('/creators/:id/note', (req, res) => {
    const id = idParam(req);
    requireCreator(id);
    const text = String(req.body?.text || '').trim();
    if (!text) throw badRequest('Notiz ist leer.');
    logActivity(id, 'note', { text: text.slice(0, 4000) });
    res.json({ ok: true });
  });

  r.post('/creators/bulk', (req, res) => {
    const { ids, action, value } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) throw badRequest('Keine Creator ausgewählt.');
    let changed = 0;
    for (const raw of ids.slice(0, 5000)) {
      const id = Number(raw);
      if (!getCreator(id)) continue;
      switch (action) {
        case 'qualify':
          if (setOutreachStatus(id, 'qualifiziert')) changed++;
          break;
        case 'reject':
          if (setOutreachStatus(id, 'ungeeignet', { force: true })) changed++;
          break;
        case 'delete':
          if (deleteCreator(id)) changed++;
          break;
        case 'tag':
        case 'untag': {
          const tag = String(value || '').trim();
          if (!tag) throw badRequest('Tag fehlt.');
          const c = getCreator(id);
          const tags = action === 'tag' ? mergeTags(c.tags, [tag]) : c.tags.filter((t) => t !== tag);
          updateCreator(id, { tags });
          changed++;
          break;
        }
        case 'status':
          if (!ALL_STATUSES.includes(value)) throw badRequest('Unbekannter Status.');
          if (setOutreachStatus(id, value, { force: true, data: { manual: true, bulk: true } })) changed++;
          break;
        case 'snooze': {
          const days = Math.max(1, Math.min(60, Number(value) || 1));
          const o = getOutreach(id);
          if (o) {
            updateOutreach(o.id, { snoozed_until: addDays(new Date(), days).toISOString() });
            changed++;
          }
          break;
        }
        default:
          throw badRequest('Unbekannte Aktion.');
      }
    }
    res.json({ changed });
  });

  r.post('/creators/:id/contacts', (req, res) => {
    const id = idParam(req);
    requireCreator(id);
    const { type, value, is_business, dm_invited } = req.body || {};
    if (!CONTACT_TYPES.includes(type)) throw badRequest('Unbekannter Kontakt-Typ.');
    const norm = normalizeContactValue(type, value);
    const contact = addContact(id, { type, value: norm.value, label: norm.label, source: 'manual', is_business: is_business ? 1 : 0, dm_invited: dm_invited ? 1 : 0 });
    recomputeCreator(id);
    res.json({ contact: getDb().get('SELECT * FROM contacts WHERE id = :cid', { cid: contact.id }) });
  });

  r.delete('/contacts/:id', (req, res) => {
    const id = idParam(req);
    const contact = getDb().get('SELECT * FROM contacts WHERE id = :id', { id });
    if (!contact) throw notFound('Kontakt nicht gefunden.');
    getDb().run('DELETE FROM contacts WHERE id = :id', { id });
    recomputeCreator(contact.creator_id);
    res.json({ ok: true });
  });

  // ---- Send queue -----------------------------------------------------------
  r.get('/queue', (req, res) => {
    const q = req.query;
    res.json(getQueue({
      mode: q.mode || 'first',
      language: q.language || undefined,
      platform: q.platform || undefined,
      channel: q.channel || undefined,
      minScore: q.minScore !== undefined && q.minScore !== '' ? Number(q.minScore) : undefined,
      limit: intParam(q.limit, 20, { min: 1, max: 200 }),
    }));
  });

  r.post('/queue/:id/prepare', async (req, res) => {
    res.json(await prepareOutreach(idParam(req), { mode: req.body?.mode || 'first' }));
  });

  r.post('/queue/:id/sent', (req, res) => {
    res.json({ outreach: markSent(idParam(req), req.body || {}) });
  });

  r.post('/queue/:id/skip', (req, res) => {
    res.json({ outreach: skipOutreach(idParam(req), { reason: req.body?.reason || 'later' }) });
  });

  // ---- Templates --------------------------------------------------------------
  r.get('/templates', (req, res) => {
    res.json({
      items: listTemplates(),
      placeholders: PLACEHOLDERS,
      languages: TEMPLATE_LANGUAGES.map((code) => ({ code, label: LANGUAGE_LABELS[code] || code })),
    });
  });

  r.post('/templates/preview', (req, res) => {
    const b = req.body || {};
    let subject = b.subject;
    let body = b.body;
    let language = b.language;
    let channel = b.channel || null;
    if (b.key) {
      const t = getTemplate(b.key);
      if (!t) throw notFound('Vorlage nicht gefunden.');
      subject = subject ?? t.subject;
      body = body ?? t.body;
      language = language || t.language;
      channel = channel || t.channel;
    }
    if (body === undefined || body === null) throw badRequest('Text fehlt.');
    let full = null;
    if (b.creatorId) {
      full = getCreatorFull(Number(b.creatorId));
      if (!full) throw notFound('Creator nicht gefunden.');
    } else {
      full = {
        creator: { display_name: 'LukasPlays', language: language || 'de' },
        accounts: [{ platform: 'youtube', latest_title: 'Ich teste die BESTEN neuen Roblox Spiele!', last_active_at: new Date().toISOString(), source: 'youtube_api' }],
      };
    }
    const vars = buildVars(full, { language: language || full.creator.language || 'en', inviteUrl: b.creatorId ? null : 'https://discord.gg/beispiel', channel });
    const s = subject ? renderString(subject, vars) : { text: '', missing: [] };
    const bd = renderString(body, vars);
    res.json({ subject: s.text, body: bd.text, missing: [...new Set([...s.missing, ...bd.missing])] });
  });

  r.post('/templates', (req, res) => {
    try {
      res.json({ template: createTemplate(req.body || {}) });
    } catch (err) {
      throw badRequest(err.message);
    }
  });

  r.put('/templates/:key', (req, res) => {
    const { subject, body, active } = req.body || {};
    if (body !== undefined && !String(body).trim()) throw badRequest('Text der Vorlage darf nicht leer sein.');
    const t = updateTemplate(req.params.key, { subject, body, active });
    if (!t) throw notFound('Vorlage nicht gefunden.');
    res.json({ template: t });
  });

  r.delete('/templates/:key', (req, res) => {
    if (!getTemplate(req.params.key)) throw notFound('Vorlage nicht gefunden.');
    try {
      deleteTemplate(req.params.key);
    } catch (err) {
      throw badRequest(err.message);
    }
    res.json({ ok: true });
  });

  r.post('/templates/:key/reset', (req, res) => {
    if (!parseTemplateKey(req.params.key)) throw badRequest('Ungültiger Schlüssel.');
    const t = resetTemplate(req.params.key);
    if (!t) throw notFound('Für diese Vorlage gibt es keinen Standardtext.');
    res.json({ template: t });
  });

  // ---- Discovery ----------------------------------------------------------------
  r.post('/discovery/youtube', (req, res) => {
    const b = req.body || {};
    const params = {};
    if (Array.isArray(b.languages) && b.languages.length) params.languages = b.languages;
    if (b.queries) params.queries = b.queries;
    if (b.maxSearches) params.maxSearches = intParam(b.maxSearches, 20, { min: 1, max: 100 });
    const { runId } = startDiscovery('youtube', params);
    res.json({ runId });
  });

  r.post('/discovery/twitch', (req, res) => {
    const b = req.body || {};
    const params = {};
    if (Array.isArray(b.languages) && b.languages.length) params.languages = b.languages;
    if (b.minViewers !== undefined && b.minViewers !== '') params.minViewers = Number(b.minViewers);
    if (b.maxViewers !== undefined && b.maxViewers !== '') params.maxViewers = Number(b.maxViewers);
    const { runId } = startDiscovery('twitch', params);
    res.json({ runId });
  });

  r.post('/discovery/:id/cancel', (req, res) => {
    if (!cancelDiscovery(idParam(req))) throw notFound('Keine laufende Suche mit dieser ID.');
    res.json({ ok: true });
  });

  r.get('/discovery/runs', (req, res) => res.json({ items: listRuns(intParam(req.query.limit, 20, { min: 1, max: 100 })) }));

  r.get('/discovery/runs/:id', (req, res) => {
    const run = getRun(idParam(req));
    if (!run) throw notFound('Suchlauf nicht gefunden.');
    res.json({ run });
  });

  r.get('/discovery/quota', (req, res) => {
    const yt = getSettings().radar.youtube;
    const day = youtubeDay();
    res.json({
      youtube: {
        day,
        searchesUsed: getUsage(day, 'youtube_search'),
        searchLimit: yt.dailySearchLimit,
        unitsUsed: getUsage(day, 'youtube_units'),
        unitLimit: yt.dailyUnitLimit,
        keySet: Boolean(env('YOUTUBE_API_KEY')),
      },
      twitch: { keySet: twitchConfigured() },
    });
  });

  // ---- Import / export / capture ----------------------------------------------------
  r.post('/import/urls', async (req, res) => {
    const { text, language, tags } = req.body || {};
    if (!String(text || '').trim()) throw badRequest('Keine Links übergeben.');
    res.json(await importUrls(text, { language, tags }));
  });

  r.post('/import/csv', async (req, res) => {
    const { csv, language, tags } = req.body || {};
    if (!String(csv || '').trim()) throw badRequest('CSV ist leer.');
    res.json(await importCsv(csv, { language, tags }));
  });

  r.get('/export/creators.csv', (req, res) => {
    const filters = { ...listFilters(req.query), limit: 5000, offset: 0 };
    const { items } = listCreators(filters);
    const db = getDb();
    const emails = new Map();
    for (const row of db.all("SELECT creator_id, value FROM contacts WHERE type = 'email' ORDER BY is_business DESC")) {
      if (!emails.has(row.creator_id)) emails.set(row.creator_id, []);
      emails.get(row.creator_id).push(row.value);
    }
    sendCsv(res, 'creator.csv', [
      { key: 'id', label: 'ID' },
      { key: 'display_name', label: 'Name' },
      { key: 'status', label: 'Status' },
      { key: 'language', label: 'Sprache' },
      { key: 'age_group', label: 'Altersgruppe' },
      { key: 'score', label: 'Score' },
      { key: 'followers', label: 'Follower' },
      { label: 'Plattformen', get: (i) => i.platforms.filter((p) => !p.crosslink).map((p) => `${p.platform}:${p.handle || ''}`).join(' | ') },
      { label: 'Profil-Links', get: (i) => i.platforms.map((p) => p.url).filter(Boolean).join(' | ') },
      { key: 'contact_channel', label: 'Kontaktweg' },
      { key: 'contact_target', label: 'Kontakt' },
      { label: 'E-Mails', get: (i) => (emails.get(i.id) || []).join(' | ') },
      { key: 'creator_code', label: 'Creator-Code' },
      { key: 'share_link', label: 'Share Link' },
      { label: 'Tags', get: (i) => i.tags.join(', ') },
      { key: 'contacted_at', label: 'Kontaktiert am' },
      { key: 'replied_at', label: 'Antwort am' },
      { key: 'latest_title', label: 'Letztes Video' },
      { key: 'created_at', label: 'Erfasst am' },
    ], items);
  });

  r.post('/capture', async (req, res) => {
    const b = req.body || {};
    if (!b.url && !(b.platform && b.handle)) throw badRequest('Profil-Link fehlt.');
    res.json(await capture(b));
  });

  r.get('/bookmarklet', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({ code: bookmarkletCode(origin), origin });
  });

  // ---- Stats & maintenance ---------------------------------------------------------------
  r.get('/stats', (req, res) => res.json(getStats()));

  r.post('/maintenance/retention', async (req, res) => res.json(await runRetention()));

  r.post('/maintenance/rescore-all', (req, res) => {
    const ids = getDb().all('SELECT id FROM creators').map((x) => x.id);
    for (const id of ids) recomputeCreator(id);
    res.json({ updated: ids.length });
  });

  return r;
}
