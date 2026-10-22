import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db.js';
import { resetSettingsCache } from '../src/core/settings.js';
import { BOT_PERMISSIONS, commandDefinitions } from '../src/bot/index.js';
import {
  ageDecision, canReapply, contentPoints, findRunningEvent, foundingAvailable, initialApplicationStatus, isRobloxLink,
  livePointsPlan, normalizeCode, validCreatorCode,
} from '../src/bot/lib/rules.js';
import { diffInvites, inviteOptions, pickPersonalInvite } from '../src/bot/lib/inviteDiff.js';
import { ACCESS, CHANNEL_PLAN, permissionsUsed, resolveOverwrites } from '../src/bot/lib/channelPlan.js';
import { formatLeaderboardLines } from '../src/bot/lib/leaderboard.js';
import { helpSections } from '../src/bot/modules/help.js';

beforeEach(() => {
  openDb(':memory:');
  resetSettingsCache();
});

test('age rules: under 13 never, under 16 needs parents, minors flagged', () => {
  const s = { minAge: 13, parentConsentUnder: 16 };
  assert.equal(ageDecision('u13', s).allowed, false);
  assert.equal(ageDecision('unbekannt', s).allowed, false);
  assert.deepEqual(ageDecision('13-15', s), { allowed: true, needsParentConsent: true, minor: true });
  assert.deepEqual(ageDecision('16-17', s), { allowed: true, needsParentConsent: false, minor: true });
  assert.deepEqual(ageDecision('18+', s), { allowed: true, needsParentConsent: false, minor: false });
  assert.equal(ageDecision('16-17', { minAge: 13, parentConsentUnder: 18 }).needsParentConsent, true);
  assert.equal(ageDecision('13-15', { minAge: 16, parentConsentUnder: 16 }).allowed, false);
  assert.equal(ageDecision('u13', { minAge: 0 }).allowed, false, 'never below 13, whatever the setting');
  assert.equal(initialApplicationStatus('13-15', s), 'eltern_ausstehend');
  assert.equal(initialApplicationStatus('18+', s), 'offen');
  assert.equal(initialApplicationStatus('u13', s), null);
});

test('re-apply rules and founding slots', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  assert.equal(canReapply(null, now), true);
  assert.equal(canReapply({ status: 'offen' }, now), false);
  assert.equal(canReapply({ status: 'angenommen' }, now), false);
  assert.equal(canReapply({ status: 'abgelehnt', reviewed_at: '2026-10-25T00:00:00Z' }, now), false);
  assert.equal(canReapply({ status: 'abgelehnt', reviewed_at: '2026-10-01T00:00:00Z' }, now), true);
  assert.equal(foundingAvailable(49, 50), true);
  assert.equal(foundingAvailable(50, 50), false);
  assert.equal(foundingAvailable(0, 0), false);
});

test('running event detection and live points keys', () => {
  const now = new Date('2026-11-21T18:30:00Z');
  const events = [
    { id: 1, kind: 'event', title: 'Alt', status: 'beendet', starts_at: '2026-11-21T18:00:00Z', duration_min: 60 },
    { id: 2, kind: 'event', title: 'Weekly', status: 'geplant', starts_at: '2026-11-21T18:00:00Z', duration_min: 60 },
    { id: 3, kind: 'launch', title: 'Launch Hour', status: 'geplant', starts_at: '2026-11-21T18:00:00Z', duration_min: 60 },
    { id: 4, kind: 'event', title: 'Später', status: 'geplant', starts_at: '2026-11-21T22:00:00Z', duration_min: 60 },
  ];
  assert.equal(findRunningEvent(events, now).id, 3, 'launch wins when overlapping');
  assert.equal(findRunningEvent(events, new Date('2026-11-21T17:50:00Z')).id, 3, '15 minutes early counts');
  assert.equal(findRunningEvent(events, new Date('2026-11-21T20:00:00Z')), null);
  const points = { liveDuringEvent: 30, liveOther: 10 };
  assert.deepEqual(livePointsPlan({ event: events[2], day: '2026-11-21', points }), { points: 30, ref: 'live:event:3', reason: 'Live beim Event "Launch Hour"' });
  assert.equal(livePointsPlan({ event: null, day: '2026-11-21', points }).ref, 'live:day:2026-11-21');
  assert.equal(contentPoints('short', { contentVideo: 50, contentShort: 20, contentStream: 30 }), 20);
});

test('creator codes and roblox links', () => {
  assert.equal(normalizeCode(' lukas plays '), 'LUKASPLAYS');
  assert.equal(validCreatorCode('LUKAS'), true);
  assert.equal(validCreatorCode('LU'), false);
  assert.equal(validCreatorCode('LUKAS-1'), false);
  assert.equal(isRobloxLink('https://www.roblox.com/share?code=abc&type=ExperienceDetails'), true);
  assert.equal(isRobloxLink('https://ro.blox.com/Ebh5?af_dp=x'), true);
  assert.equal(isRobloxLink('https://evilroblox.com/x'), false);
  assert.equal(isRobloxLink('http://www.roblox.com/x'), false);
});

test('invite diff finds the used personal invite (also when it vanished)', () => {
  const before = new Map([['A', 0], ['B', 3], ['P1', 0], ['P2', 4]]);
  const personal = (c) => c.startsWith('P');
  // normal case: uses increased
  let diff = diffInvites(before, new Map([['A', 0], ['B', 3], ['P1', 1], ['P2', 4]]));
  assert.deepEqual(diff.used, ['P1']);
  assert.equal(pickPersonalInvite(diff, personal), 'P1');
  // a normal invite was used -> no personal match
  diff = diffInvites(before, new Map([['A', 1], ['B', 3], ['P1', 0], ['P2', 4]]));
  assert.equal(pickPersonalInvite(diff, personal), null);
  // personal invite reached max uses and was deleted by Discord
  diff = diffInvites(before, new Map([['A', 0], ['B', 3], ['P1', 0]]));
  assert.deepEqual(diff.vanished, ['P2']);
  assert.equal(pickPersonalInvite(diff, personal), 'P2');
  // deleted event came first: only known through recentlyDeleted
  diff = diffInvites(new Map([['A', 0]]), new Map([['A', 0]]), new Map([['P9', Date.now()]]));
  assert.equal(pickPersonalInvite(diff, personal), 'P9');
  assert.deepEqual(inviteOptions({ inviteMaxAgeDays: 30, inviteMaxUses: 500 }, 'x'), { maxAge: 604800, maxUses: 100, unique: true, reason: 'x' });
  assert.deepEqual(inviteOptions({ inviteMaxAgeDays: 0, inviteMaxUses: 5 }), { maxAge: 0, maxUses: 5, unique: true, reason: '' });
});

test('channel plan only uses permissions the bot has and covers all channel keys', () => {
  for (const p of permissionsUsed()) assert.ok(BOT_PERMISSIONS.has(p), `Bot lacks permission used in overwrites: ${p}`);
  const keys = CHANNEL_PLAN.map((c) => c.key);
  for (const k of ['infos', 'apply', 'testerJoin', 'start', 'kit', 'launch', 'chat', 'live', 'leaderboard', 'playtests', 'bugs', 'testerChat', 'reviews', 'outreachLog', 'botLog', 'catPublic', 'catHq', 'catPlaytest', 'catTeam']) {
    assert.ok(keys.includes(k), `missing channel ${k}`);
  }
  for (const c of CHANNEL_PLAN) assert.ok(ACCESS[c.access], `unknown access ${c.access}`);
  for (const c of CHANNEL_PLAN.filter((x) => x.parent)) assert.ok(keys.indexOf(c.parent) < keys.indexOf(c.key), 'categories come first');
});

test('overwrites: hidden HQ, read-only for creators, team-only staff channels', () => {
  const ids = { everyoneId: 'g1', botId: 'bot1', roles: { creator: 'rc', founding: 'rf', tester: 'rt', staff: 'rs' } };
  const hq = resolveOverwrites('hqReadOnly', ids);
  const by = Object.fromEntries(hq.map((o) => [o.id, o]));
  assert.deepEqual(by.g1.deny, ['ViewChannel']);
  assert.ok(by.rc.allow.includes('ViewChannel') && by.rc.deny.includes('SendMessages'));
  assert.ok(by.bot1.allow.includes('SendMessages'));
  assert.equal(by.bot1.type, 1, 'bot overwrite is a member overwrite');
  const team = resolveOverwrites('team', ids);
  assert.deepEqual(team.map((o) => o.id).sort(), ['bot1', 'g1', 'rs']);
  // unknown role ids are skipped instead of failing
  assert.equal(resolveOverwrites('playtest', { everyoneId: 'g1', botId: 'bot1', roles: {} }).length, 2);
});

test('leaderboard lines', () => {
  const lines = formatLeaderboardLines(
    [{ discord_user_id: '1', points: 320 }, { discord_user_id: '2', points: 120 }, { discord_user_id: '3', points: 50 }, { discord_user_id: '4', points: 10 }],
    { lang: 'de', nameFor: (id) => (id === '1' ? 'Lukas' : null), tierOf: (p) => ({ name: p >= 300 ? 'Gold' : 'Bronze' }) },
  );
  assert.equal(lines[0], '🥇 <@1> (Lukas) – 320 Punkte · Gold');
  assert.equal(lines[3], '**4.** <@4> – 10 Punkte · Bronze');
});

test('help sections depend on roles', () => {
  assert.equal(helpSections('de', {}).sections.length, 1);
  assert.equal(helpSections('de', { isTester: true }).sections.length, 2);
  assert.equal(helpSections('en', { isStaff: true }).sections.length, 4);
});

test('slash commands of part A are valid, localized and team commands are restricted', () => {
  const defs = Object.fromEntries(commandDefinitions().map((c) => [c.name, c]));
  for (const name of ['setup', 'creator', 'content', 'live', 'rangliste', 'hilfe']) {
    assert.ok(defs[name], `missing /${name}`);
    assert.ok(defs[name].description_localizations?.['en-US'], `/${name} lacks English description`);
  }
  assert.equal(defs.setup.default_member_permissions, '32');
  assert.equal(defs.rangliste.name_localizations['en-US'], 'leaderboard');
  assert.equal(defs.hilfe.name_localizations['en-US'], 'help');
  const subs = defs.creator.options.map((o) => o.name);
  assert.deepEqual(subs, ['code', 'profil', 'info', 'link', 'code-setzen', 'punkte', 'entfernen']);
});
