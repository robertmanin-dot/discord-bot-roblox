// Discord endpoints for the dashboard (bot part A): overview, applications, leaderboard, content, invites.
import { Router } from 'express';
import { getDb } from '../../core/db.js';
import { getSettings } from '../../core/settings.js';
import { callBot, services } from '../../core/services.js';
import { getLeaderboard, tierFor } from '../../core/points.js';
import { badRequest, intParam } from '../http.js';
import { CHANNEL_PLAN, ROLE_PLAN } from '../../bot/lib/channelPlan.js';
import { displayNameFor } from '../../bot/lib/common.js';

const APPLICATION_STATES = ['offen', 'eltern_ausstehend', 'angenommen', 'abgelehnt', 'zurueckgezogen'];
const ACTIONS = { accept: 'accept', reject: 'reject', 'parent-ok': 'parent-ok', parent: 'parent-ok' };

/** What is missing on the Discord side (texts for the dashboard). */
export function discordMissing(settings = getSettings(), bot = services.bot.status()) {
  const missing = [];
  if (bot.state !== 'ready') missing.push(bot.state === 'disabled' ? 'Discord-Bot-Token fehlt' : `Bot nicht verbunden${bot.error ? `: ${bot.error}` : ''}`);
  else if (!bot.guild) missing.push('Bot ist auf keinem (oder nicht dem eingestellten) Server – Einladungslink nutzen');
  const roles = settings.discord.roles || {};
  const channels = settings.discord.channels || {};
  const missingRoles = ROLE_PLAN.filter((r) => !roles[r.key]).map((r) => r.name);
  const missingChannels = CHANNEL_PLAN.filter((c) => !c.category && !channels[c.key]).map((c) => `#${c.name}`);
  if (missingRoles.length || missingChannels.length) {
    missing.push(`/setup im Discord ausführen (fehlt: ${[...missingRoles, ...missingChannels].slice(0, 6).join(', ')}${missingRoles.length + missingChannels.length > 6 ? ' …' : ''})`);
  }
  return missing;
}

function upcoming(table, limit = 5) {
  const since = new Date(Date.now() - 3 * 3600_000).toISOString();
  return getDb().all(
    `SELECT * FROM ${table} WHERE status IN ('geplant','laeuft') AND starts_at >= :since ORDER BY starts_at LIMIT :limit`,
    { since, limit },
  );
}

export default function discordRoutes() {
  const r = Router();

  r.get('/discord/overview', (req, res) => {
    const db = getDb();
    const settings = getSettings();
    const bot = services.bot.status();
    const apps = Object.fromEntries(APPLICATION_STATES.map((s) => [s, 0]));
    for (const row of db.all('SELECT status, COUNT(*) AS n FROM applications GROUP BY status')) apps[row.status] = row.n;
    const missing = discordMissing(settings, bot);
    res.json({
      bot,
      setupDone: Boolean(settings.discord.channels?.apply && settings.discord.roles?.creator),
      missing,
      counts: {
        applications: apps,
        members: db.value('SELECT COUNT(*) FROM creators WHERE is_member = 1', null, 0),
        founding: db.value('SELECT COUNT(*) FROM creators WHERE founding = 1', null, 0),
        foundingLimit: settings.discord.foundingLimit,
        testers: db.value("SELECT COUNT(*) FROM testers WHERE status = 'aktiv'", null, 0),
        invites: db.value('SELECT COUNT(*) FROM invites', null, 0),
        joinedViaInvite: db.value("SELECT COUNT(*) FROM activity WHERE type = 'joined_discord'", null, 0),
      },
      upcoming: { playtests: upcoming('playtests'), events: upcoming('events') },
    });
  });

  r.get('/discord/applications', (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const items = getDb().all(
      `SELECT a.*, c.display_name, c.creator_code, c.is_member, c.founding, c.score
       FROM applications a LEFT JOIN creators c ON c.id = a.creator_id
       WHERE (:status IS NULL OR a.status = :status)
       ORDER BY a.id DESC LIMIT :limit`,
      { status, limit: intParam(req.query.limit, 200, { min: 1, max: 1000 }) },
    );
    res.json({ items });
  });

  r.post('/discord/applications/:id/:action', async (req, res) => {
    const action = ACTIONS[req.params.action];
    if (!action) throw badRequest('Aktion muss accept, reject oder parent-ok sein.');
    const id = intParam(req.params.id, null, { min: 1 });
    if (!id) throw badRequest('Ungültige Bewerbungs-ID.');
    const application = await callBot('reviewApplication', id, action, null);
    res.json({ application });
  });

  r.get('/discord/leaderboard', (req, res) => {
    const kind = req.query.kind === 'tester' ? 'tester' : 'creator';
    const rows = getLeaderboard(kind, intParam(req.query.limit, 25, { min: 1, max: 200 }));
    const items = rows.map((row, i) => ({
      discord_user_id: row.discord_user_id,
      name: displayNameFor(row.discord_user_id),
      points: row.points,
      tier: tierFor(row.points).name,
      rank: i + 1,
    }));
    res.json({ kind, items });
  });

  r.get('/discord/content', (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const items = getDb().all(
      `SELECT s.*, c.display_name FROM content_submissions s LEFT JOIN creators c ON c.id = s.creator_id
       WHERE (:status IS NULL OR s.status = :status) ORDER BY s.id DESC LIMIT :limit`,
      { status, limit: intParam(req.query.limit, 200, { min: 1, max: 1000 }) },
    );
    res.json({ items });
  });

  r.post('/discord/invite/:creatorId', async (req, res) => {
    const creatorId = intParam(req.params.creatorId, null, { min: 1 });
    if (!creatorId) throw badRequest('Ungültige Creator-ID.');
    const invite = await callBot('createPersonalInvite', creatorId);
    res.json({ code: invite.code, url: invite.url, reused: Boolean(invite.reused) });
  });

  return r;
}
