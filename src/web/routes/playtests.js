// REST: Playtests, Feedback (CSV), Bugs und Events (Bot-Teil B). Spezifikation: docs/ARCHITEKTUR.md §6
import { Router } from 'express';
import { callBot, services } from '../../core/services.js';
import { badRequest, intParam, notFound, sendCsv } from '../http.js';
import * as store from '../../bot/lib/b-store.js';
import { BUG_STATUSES, eventEnd } from '../../bot/lib/b-logic.js';

const PLAYTEST_STATUSES = ['geplant', 'laeuft', 'beendet', 'abgesagt'];
const EVENT_STATUSES = PLAYTEST_STATUSES;

function withCounts(p) {
  const c = store.playtestCounts(p.id);
  return { ...p, signups: c.active, waitlist: c.waitlist, feedback: c.feedback };
}

function idParam(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) throw badRequest('Ungültige ID.');
  return id;
}

function statusFilter(value, allowed) {
  if (value === undefined || value === '') return null;
  const list = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of list) if (!allowed.includes(s)) throw badRequest(`Unbekannter Status: ${s}`);
  return list;
}

export default function playtestsRoutes() {
  const r = Router();

  r.get('/playtests', (req, res) => {
    const statuses = statusFilter(req.query.status, PLAYTEST_STATUSES);
    const items = store.listPlaytests({ statuses, limit: intParam(req.query.limit, 200, { min: 1, max: 1000 }) }).map(withCounts);
    res.json({ items });
  });

  r.get('/playtests/:id/feedback.csv', (req, res) => {
    const id = idParam(req);
    const p = store.getPlaytest(id);
    if (!p) throw notFound('Playtest nicht gefunden.');
    const rows = store.listFeedback(id).map((f) => ({ ...f, name: store.displayNameFor(f.discord_user_id) || '' }));
    sendCsv(
      res,
      `playtest-${id}-feedback.csv`,
      [
        { key: 'created_at', label: 'Zeitpunkt' },
        { key: 'name', label: 'Name' },
        { key: 'discord_user_id', label: 'Discord-ID' },
        { key: 'fun_rating', label: 'Spaß (1-10)' },
        { key: 'liked', label: 'Gut' },
        { key: 'disliked', label: 'Nervt/verwirrt' },
        { key: 'bugs', label: 'Bugs' },
        { key: 'other', label: 'Sonstiges' },
      ],
      rows,
    );
  });

  r.get('/playtests/:id', (req, res) => {
    const id = idParam(req);
    const p = store.getPlaytest(id);
    if (!p) throw notFound('Playtest nicht gefunden.');
    const signups = store.listSignups(id).map((s) => ({
      ...s,
      name: store.displayNameFor(s.discord_user_id),
      age_group: store.getUserAgeGroup(s.discord_user_id),
    }));
    const feedback = store.listFeedback(id).map((f) => ({ ...f, name: store.displayNameFor(f.discord_user_id) }));
    const ratings = feedback.map((f) => f.fun_rating).filter((n) => Number.isFinite(n));
    res.json({
      playtest: withCounts(p),
      signups,
      feedback,
      avgFun: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    });
  });

  r.post('/playtests', async (req, res) => {
    const playtest = await callBot('createPlaytest', req.body || {});
    res.status(201).json({ playtest: withCounts(playtest) });
  });

  r.get('/bugs', (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    if (status && !BUG_STATUSES.includes(status)) throw badRequest(`Unbekannter Status: ${status}`);
    const items = store.listBugs(status, intParam(req.query.limit, 500, { min: 1, max: 2000 })).map((b) => ({
      ...b,
      reporter: store.displayNameFor(b.discord_user_id),
    }));
    res.json({ items });
  });

  r.patch('/bugs/:id', async (req, res) => {
    const id = idParam(req);
    const status = String(req.body?.status || '');
    if (!BUG_STATUSES.includes(status)) throw badRequest(`Status muss eines von ${BUG_STATUSES.join(', ')} sein.`);
    if (!store.getBug(id)) throw notFound('Bug nicht gefunden.');
    if (services.bot?.isReady?.() && typeof services.bot.updateBugStatus === 'function') {
      await services.bot.updateBugStatus(id, status, null);
    } else {
      // Bot offline: only the database is updated (Discord message stays as it is).
      store.applyBugStatus(id, status, null);
    }
    res.json({ bug: store.getBug(id) });
  });

  r.get('/events', (req, res) => {
    const statuses = statusFilter(req.query.status, EVENT_STATUSES);
    res.json({ items: store.listEvents({ statuses, limit: intParam(req.query.limit, 200, { min: 1, max: 1000 }) }) });
  });

  r.get('/events/:id', (req, res) => {
    const id = idParam(req);
    const event = store.getEvent(id);
    if (!event) throw notFound('Event nicht gefunden.');
    res.json({
      event,
      ccu: store.listCcuSamples(id),
      live: store.liveSessionsInWindow(event.starts_at, eventEnd(event).toISOString()),
    });
  });

  r.post('/events', async (req, res) => {
    const event = await callBot('createEvent', req.body || {});
    res.status(201).json({ event });
  });

  return r;
}
