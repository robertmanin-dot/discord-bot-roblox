import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getDb } from '../src/core/db.js';
import { getSettings, resetSettingsCache, updateSettings } from '../src/core/settings.js';
import { createCreator, getCreatorFull, updateCreator, upsertAccount } from '../src/core/creators.js';
import { getPoints } from '../src/core/points.js';
import { services } from '../src/core/services.js';
import applications, { reviewApplication } from '../src/bot/modules/applications.js';
import invites, { _resetInviteState, createPersonalInvite, handleMemberJoin } from '../src/bot/modules/invites.js';
import creatorModule, { reviewContent } from '../src/bot/modules/creator.js';
import live, { _resetTwitchTimer, checkTwitchLive } from '../src/bot/modules/live.js';
import { _resetLeaderboardHash, updateLeaderboardPanel } from '../src/bot/modules/leaderboard.js';
import { runSetup } from '../src/bot/modules/setup.js';
import { CHANNEL_PLAN } from '../src/bot/lib/channelPlan.js';
import { fakeBot, fakeChannel, fakeGuild, fakeInteraction, fakeMember, json } from './bot-a-fakes.js';

let guild;
let ctx;
let ch;

function configure() {
  ch = {
    apply: guild.addChannel(fakeChannel({ name: 'creator-bewerbung' })),
    reviews: guild.addChannel(fakeChannel({ name: 'bewerbungen' })),
    outreachLog: guild.addChannel(fakeChannel({ name: 'outreach-log' })),
    botLog: guild.addChannel(fakeChannel({ name: 'bot-log' })),
    live: guild.addChannel(fakeChannel({ name: 'jetzt-live' })),
    leaderboard: guild.addChannel(fakeChannel({ name: 'rangliste' })),
    start: guild.addChannel(fakeChannel({ name: 'start-hier' })),
    kit: guild.addChannel(fakeChannel({ name: 'creator-kit' })),
  };
  updateSettings({
    discord: {
      guildId: guild.id,
      roles: { creator: 'role-creator', founding: 'role-founding', tester: 'role-tester', staff: 'role-staff' },
      channels: Object.fromEntries(Object.entries(ch).map(([k, c]) => [k, c.id])),
    },
    game: { name: 'Tower Rush', codeReward_de: 'den Founding-Skin', contactEmail: 'eltern@studio.de' },
  });
}

beforeEach(() => {
  openDb(':memory:');
  resetSettingsCache();
  _resetInviteState();
  _resetTwitchTimer();
  _resetLeaderboardHash();
  guild = fakeGuild();
  ({ ctx } = fakeBot(guild));
  configure();
});

async function apply(member, { age = '18+', platform = 'youtube', lang = 'de', fields } = {}) {
  const start = fakeInteraction({ guild, member, customId: 'apply:start' });
  await applications.buttons.apply(start, ctx);
  assert.equal(start.log.replies.length, 1);
  assert.equal(start.log.replies[0].components.length, 4);

  let state = ['_', '_', '_'];
  for (const [field, value] of [['age', age], ['platform', platform], ['lang', lang]]) {
    const sel = fakeInteraction({ guild, member, customId: `apply:sel:${field}:${state.join(':')}`, values: [value] });
    await applications.selects.apply(sel, ctx);
    const upd = sel.log.updates[0];
    if (!upd.components.length) return { tooYoung: upd };
    state = json(upd.components[3]).components[0].custom_id.split(':').slice(2);
  }
  assert.deepEqual(state, [age, platform, lang]);
  const next = fakeInteraction({ guild, member, customId: `apply:next:${state.join(':')}` });
  await applications.buttons.apply(next, ctx);
  assert.equal(next.log.modals.length, 1);
  const modal = json(next.log.modals[0]);
  assert.equal(modal.components.length, 4);
  assert.equal(modal.components[0].component.custom_id, 'channel');

  const submit = fakeInteraction({
    guild,
    member,
    customId: modal.custom_id,
    fields: fields || { channel: 'https://www.youtube.com/@LukasPlays', followers: '1,2k', links: 'TikTok: @lukas_tt\nbusiness: lukas@plays.de', intro: 'Ich mache Roblox-Videos' },
  });
  await applications.modals.apply(submit, ctx);
  return { submit, app: getDb().get('SELECT * FROM applications ORDER BY id DESC LIMIT 1') };
}

test('application 18+: stored, creator linked, review posted, accept gives roles + code + founding', async () => {
  const member = guild.addMember(fakeMember({ id: 'u1' }));
  const { submit, app } = await apply(member);
  assert.equal(app.status, 'offen');
  assert.equal(app.followers, 1200);
  assert.match(submit.log.edits[0].content, /Danke für deine Bewerbung/);
  const full = getCreatorFull(app.creator_id);
  assert.equal(full.creator.discord_user_id, 'u1');
  assert.equal(full.creator.age_group, '18+');
  assert.equal(full.creator.language, 'de');
  assert.deepEqual(full.accounts.map((a) => `${a.platform}:${a.handle}`).sort(), ['tiktok:lukas_tt', 'youtube:lukasplays']);
  assert.equal(full.contacts.find((c) => c.type === 'email').value, 'lukas@plays.de');
  assert.equal(full.outreach.status, 'im_discord');
  assert.equal(ch.reviews.sent.length, 1);
  assert.equal(app.review_message_id, ch.reviews.sent[0].id);
  const buttons = json(ch.reviews.sent[0].payload.components[0]).components.map((b) => b.custom_id);
  assert.deepEqual(buttons, [`app:accept:${app.id}`, `app:reject:${app.id}`]);

  // second application while one is open is refused
  const again = fakeInteraction({ guild, member, customId: 'apply:start' });
  await applications.buttons.apply(again, ctx);
  assert.match(again.log.replies[0].content, /offene Bewerbung/);

  // team accepts via button
  const staff = guild.addMember(fakeMember({ id: 'staff1', staff: true }));
  const btn = fakeInteraction({ guild, member: staff, customId: `app:accept:${app.id}`, staff: true });
  await applications.buttons.app(btn, ctx);
  assert.equal(btn.log.followUps.length, 0, JSON.stringify(btn.log.followUps));
  assert.deepEqual(member.roles.added, ['role-creator', 'role-founding']);
  const after = getCreatorFull(app.creator_id);
  assert.equal(after.creator.is_member, 1);
  assert.equal(after.creator.founding, 1);
  assert.equal(after.creator.creator_code, 'LUKASPLAYS');
  assert.equal(after.outreach.status, 'dabei');
  assert.ok(after.outreach.accepted_at);
  assert.equal(getDb().get('SELECT status, reviewed_by FROM applications WHERE id = :id', { id: app.id }).status, 'angenommen');
  assert.equal(member.dms.length, 1);
  assert.match(json(member.dms[0].embeds[0]).description, /LUKASPLAYS/);
  assert.match(json(member.dms[0].embeds[0]).description, /den Founding-Skin/);
  assert.equal(ch.outreachLog.sent.length, 1);
  assert.equal(ch.reviews.sent[0].edits.length, 1, 'review message updated');
  assert.equal(ch.reviews.sent[0].edits[0].components.length, 0, 'no buttons after decision');

  // non-staff cannot review
  const sneaky = fakeInteraction({ guild, member, customId: `app:reject:${app.id}` });
  await applications.buttons.app(sneaky, ctx);
  assert.match(sneaky.log.replies[0].content, /Nur|Team/);
});

test('under 13: friendly stop, nothing stored', async () => {
  const member = guild.addMember(fakeMember({ id: 'kid' }));
  const res = await apply(member, { age: 'u13' });
  assert.match(res.tooYoung.content, /ab 13/);
  assert.equal(getDb().value('SELECT COUNT(*) FROM applications'), 0);
  assert.equal(getDb().value('SELECT COUNT(*) FROM creators'), 0);
});

test('13-15: parental consent first, then accept; never paid deals', async () => {
  const member = guild.addMember(fakeMember({ id: 'teen' }));
  const { submit, app } = await apply(member, { age: '13-15' });
  assert.equal(app.status, 'eltern_ausstehend');
  assert.match(submit.log.edits[0].content, /Einverständnis deiner Eltern/);
  assert.match(submit.log.edits[0].content, /eltern@studio\.de/);
  const buttons = json(ch.reviews.sent[0].payload.components[0]).components;
  assert.equal(buttons[0].disabled, true, 'accept disabled until parents agreed');
  await assert.rejects(() => reviewApplication(ctx, app.id, 'accept', 'staff'), /Eltern/);
  await reviewApplication(ctx, app.id, 'parent-ok', 'staff');
  assert.equal(getCreatorFull(app.creator_id).creator.parent_consent, 1);
  await reviewApplication(ctx, app.id, 'accept', 'staff');
  const c = getCreatorFull(app.creator_id).creator;
  assert.equal(c.is_member, 1);
  assert.equal(c.paid_ok, 0);
  assert.match(json(member.dms.at(-1).embeds[0]).description, /unter 18/);
});

test('founding limit and reject flow', async () => {
  updateSettings({ discord: { foundingLimit: 1 } });
  const f = createCreator({ display_name: 'Erster' });
  updateCreator(f, { founding: 1, is_member: 1 });
  const member = guild.addMember(fakeMember({ id: 'u2' }));
  const { app } = await apply(member, { fields: { channel: 'https://www.twitch.tv/maxlive', followers: '300', links: '', intro: '' } });
  await reviewApplication(ctx, app.id, 'accept', null);
  assert.deepEqual(member.roles.added, ['role-creator']);
  assert.equal(getCreatorFull(app.creator_id).creator.founding, 0);

  const other = guild.addMember(fakeMember({ id: 'u3' }));
  const res = await apply(other, { fields: { channel: 'https://www.tiktok.com/@nope', followers: '50', links: '', intro: '' } });
  const rejected = await reviewApplication(ctx, res.app.id, 'reject', null);
  assert.equal(rejected.status, 'abgelehnt');
  assert.match(other.dms[0].content, /nicht gepasst/);
  await assert.rejects(() => reviewApplication(ctx, res.app.id, 'accept', null), /bereits/);
});

test('accept fails cleanly if the member left or the role cannot be given', async () => {
  const member = guild.addMember(fakeMember({ id: 'u4' }));
  const { app } = await apply(member);
  guild.members.cache.delete('u4');
  await assert.rejects(() => reviewApplication(ctx, app.id, 'accept', null), /nicht \(mehr\) auf dem Server/);
  guild.addMember(member);
  member.roles.add = async () => {
    throw new Error('Missing Permissions');
  };
  await assert.rejects(() => reviewApplication(ctx, app.id, 'accept', null), /Bot-Rolle/);
  assert.equal(getDb().get('SELECT status FROM applications WHERE id = :id', { id: app.id }).status, 'offen', 'still open');
});

test('personal invites: create, reuse, detect join', async () => {
  const id = createCreator({ display_name: 'Max Gaming', language: 'de' });
  const first = await createPersonalInvite(ctx, id);
  assert.equal(first.reused, false);
  assert.match(first.url, /^https:\/\/discord\.gg\//);
  assert.deepEqual(ch.apply.invitesCreated[0].opts, { maxAge: 0, maxUses: 5, unique: true, reason: 'Creator Radar: Max Gaming' });
  assert.equal(getCreatorFull(id).outreach.invite_code, first.code);
  const second = await createPersonalInvite(ctx, id);
  assert.equal(second.code, first.code);
  assert.equal(second.reused, true);

  // join: the personal invite's use count went up
  guild.setInvites([{ code: 'OTHER', uses: 2 }, { code: first.code, uses: 1 }]);
  const member = guild.addMember(fakeMember({ id: 'joiner' }));
  const result = await handleMemberJoin(ctx, member);
  assert.deepEqual(result, { creatorId: id, code: first.code });
  const full = getCreatorFull(id);
  assert.equal(full.creator.discord_user_id, 'joiner');
  assert.equal(full.outreach.status, 'im_discord');
  assert.ok(full.outreach.joined_discord_at);
  assert.equal(ch.outreachLog.sent.length, 1);
  assert.match(member.dms[0].content, /Bewirb dich/);

  // a join through a normal invite changes nothing
  guild.setInvites([{ code: 'OTHER', uses: 3 }, { code: first.code, uses: 1 }]);
  assert.equal(await handleMemberJoin(ctx, guild.addMember(fakeMember({ id: 'random' }))), null);
});

test('createPersonalInvite needs /setup', async () => {
  updateSettings({ discord: { channels: { apply: '' } } });
  const id = createCreator({ display_name: 'X' });
  await assert.rejects(() => createPersonalInvite(ctx, id), /setup/);
});

test('/content: members only, review gives points once', async () => {
  const outsider = guild.addMember(fakeMember({ id: 'out' }));
  const i1 = fakeInteraction({ guild, member: outsider, options: { link: 'https://youtu.be/abc', typ: 'video' } });
  await creatorModule.commandHandlers.content(i1, ctx);
  assert.match(i1.log.replies[0].content, /nicht/);

  const cid = createCreator({ display_name: 'Lena' });
  updateCreator(cid, { is_member: 1, discord_user_id: 'lena' });
  const lena = guild.addMember(fakeMember({ id: 'lena' }));
  const i2 = fakeInteraction({ guild, member: lena, options: { link: 'youtu.be/abc', typ: 'short' } });
  await creatorModule.commandHandlers.content(i2, ctx);
  assert.match(i2.log.replies[0].content, /eingereicht/);
  const sub = getDb().get('SELECT * FROM content_submissions');
  assert.equal(sub.url, 'https://youtu.be/abc');
  assert.equal(ch.reviews.sent.length, 1);
  const dup = fakeInteraction({ guild, member: lena, options: { link: 'https://youtu.be/abc', typ: 'short' } });
  await creatorModule.commandHandlers.content(dup, ctx);
  assert.match(dup.log.replies[0].content, /schon eingereicht/);

  const staff = guild.addMember(fakeMember({ id: 'st', staff: true }));
  const ok = fakeInteraction({ guild, member: staff, staff: true, customId: `content:ok:${sub.id}` });
  await creatorModule.buttons.content(ok, ctx);
  assert.equal(getPoints('lena', 'creator'), 20);
  assert.equal(ok.log.edits.length, 1);
  await reviewContent(ctx, sub.id, 'ok', 'st');
  assert.equal(getPoints('lena', 'creator'), 20, 'no double points');
  assert.match(lena.dms[0].content, /\+20/);
});

test('/creator team tools: link, code, points, remove', async () => {
  const cid = createCreator({ display_name: 'Tom' });
  updateCreator(cid, { is_member: 1, discord_user_id: 'tom', creator_code: 'TOM' });
  const tom = guild.addMember(fakeMember({ id: 'tom', roles: ['role-creator'] }));
  const staff = guild.addMember(fakeMember({ id: 'st2', staff: true }));
  const run = async (options, who = staff, staffFlag = true) => {
    const i = fakeInteraction({ guild, member: who, staff: staffFlag, options });
    await creatorModule.commandHandlers.creator(i, ctx);
    return i.log.replies[0];
  };
  assert.match((await run({ subcommand: 'link', user: tom.user, url: 'https://example.com' })).content, /kein Roblox-Link/);
  assert.match((await run({ subcommand: 'link', user: tom.user, url: 'https://www.roblox.com/share?code=abc&type=ExperienceDetails' })).content, /gespeichert/);
  assert.equal(getCreatorFull(cid).creator.share_link, 'https://www.roblox.com/share?code=abc&type=ExperienceDetails');
  assert.match((await run({ subcommand: 'code-setzen', user: tom.user, code: 'tom rush' })).content, /TOMRUSH/);
  assert.match((await run({ subcommand: 'punkte', user: tom.user, anzahl: 40, grund: 'Collab', art: 'creator' })).content, /Neuer Stand: 40/);
  const code = await run({ subcommand: 'code' }, tom, false);
  assert.match(json(code.embeds[0]).description, /TOMRUSH/);
  const profile = await run({ subcommand: 'profil' }, tom, false);
  assert.ok(json(profile.embeds[0]).fields.some((f) => f.value === '40'));
  assert.match((await run({ subcommand: 'punkte', user: tom.user, anzahl: 5, grund: 'x' }, tom, false)).content, /Team/);
  assert.match((await run({ subcommand: 'entfernen', user: tom.user })).content, /nicht mehr/);
  assert.deepEqual(tom.roles.removed, ['role-creator', 'role-founding']);
  assert.equal(getCreatorFull(cid).creator.is_member, 0);
});

test('/live: points once per day, launch event sets status live', async () => {
  const cid = createCreator({ display_name: 'Streamer' });
  updateCreator(cid, { is_member: 1, discord_user_id: 'str' });
  const m = guild.addMember(fakeMember({ id: 'str' }));
  const go = async () => {
    const i = fakeInteraction({ guild, member: m, options: { link: 'twitch.tv/streamer' } });
    await live.commandHandlers.live(i, ctx);
    return i.log.edits[0].content;
  };
  assert.match(await go(), /\+10/);
  assert.match(await go(), /schon erhalten/);
  assert.equal(ch.live.sent.length, 2);
  assert.equal(getDb().value('SELECT COUNT(*) FROM live_sessions'), 2);

  getDb().run("INSERT INTO events (kind, title, starts_at, duration_min, status) VALUES ('launch', 'Launch Hour', :at, 60, 'laeuft')", { at: new Date().toISOString() });
  assert.match(await go(), /\+30/);
  assert.equal(getCreatorFull(cid).outreach.status, 'live');
  assert.equal(getPoints('str', 'creator'), 40);
});

test('twitch job announces and ends sessions', async () => {
  process.env.TWITCH_CLIENT_ID = 'id';
  process.env.TWITCH_CLIENT_SECRET = 'secret';
  try {
    const cid = createCreator({ display_name: 'TwitchMax' });
    updateCreator(cid, { is_member: 1, discord_user_id: 'tw' });
    upsertAccount(cid, { platform: 'twitch', handle: 'maxlive' });
    let streams = [{ user_login: 'MaxLive', game_name: 'Roblox', title: 'Tower Rush mit Zuschauern', url: 'https://www.twitch.tv/maxlive' }];
    const importTwitch = async () => ({ getStreamsByLogins: async (logins) => (logins.includes('maxlive') ? streams : []) });
    let r = await checkTwitchLive(ctx, { importTwitch, now: 1_000_000 });
    assert.deepEqual(r, { checked: 1, started: 1, ended: 0 });
    assert.equal(ch.live.sent.length, 1);
    r = await checkTwitchLive(ctx, { importTwitch, now: 1_000_000 + 60_000 });
    assert.equal(r.skipped, 'interval');
    r = await checkTwitchLive(ctx, { importTwitch, now: 1_000_000 + 4 * 60_000 });
    assert.deepEqual(r, { checked: 1, started: 0, ended: 0 }, 'still live -> nothing new');
    streams = [];
    r = await checkTwitchLive(ctx, { importTwitch, now: 1_000_000 + 8 * 60_000 });
    assert.deepEqual(r, { checked: 1, started: 0, ended: 1 });
    assert.ok(getDb().get('SELECT ended_at FROM live_sessions').ended_at);
    assert.equal((await checkTwitchLive(ctx, { importTwitch: async () => { throw new Error('missing'); }, now: 9e9 })).skipped, 'no-module');
  } finally {
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;
  }
});

test('/setup creates everything once and repairs on the second run', async () => {
  // fresh server without any of our channels
  openDb(':memory:');
  resetSettingsCache();
  guild = fakeGuild();
  ({ ctx } = fakeBot(guild));
  const invoker = guild.addMember(fakeMember({ id: 'admin', staff: true }));
  const report = await runSetup(ctx, guild, { invoker });
  assert.equal(report.roles.filter((r) => r.how === 'created').length, 4);
  assert.equal(report.channels.filter((c) => c.how === 'created').length, CHANNEL_PLAN.length);
  assert.deepEqual(report.panels.map((p) => p.how), ['posted', 'posted', 'posted', 'posted', 'posted', 'posted']);
  assert.deepEqual(report.warnings, []);
  const s = getSettings().discord;
  for (const c of CHANNEL_PLAN) assert.ok(s.channels[c.key], `channel id saved for ${c.key}`);
  for (const k of ['creator', 'founding', 'tester', 'staff']) assert.ok(s.roles[k]);
  assert.ok(invoker.roles.added.includes(s.roles.staff), 'invoker gets the team role');

  const hq = guild.channels.cache.get(s.channels.start);
  assert.equal(hq.parentId, s.channels.catHq);
  const everyoneDeny = hq.createOpts.permissionOverwrites.find((o) => o.id === guild.id);
  assert.deepEqual(everyoneDeny.deny, ['ViewChannel']);
  const applyPanel = guild.channels.cache.get(s.channels.apply).sent[0];
  assert.equal(json(applyPanel.payload.components[0]).components[0].custom_id, 'apply:start');
  const testerPanel = guild.channels.cache.get(s.channels.testerJoin).sent[0];
  assert.equal(json(testerPanel.payload.components[0]).components[0].custom_id, 'tester:join');

  const again = await runSetup(ctx, guild, { invoker });
  assert.ok(again.roles.every((r) => r.how === 'existing'));
  assert.ok(again.channels.every((c) => c.how === 'updated'));
  assert.ok(again.panels.every((p) => p.how === 'edited'));
  assert.equal(guild.created.channels.length, CHANNEL_PLAN.length, 'no duplicates');
});

test('/setup warns about missing bot permissions', async () => {
  guild.members.me.permissions.has = () => false;
  const report = await runSetup(ctx, guild, { panelsOnly: true });
  assert.match(report.warnings[0], /fehlen Rechte/);
});

test('leaderboard panel: post once, then edit only on changes', async () => {
  getDb().run("INSERT INTO points_log (discord_user_id, kind, points) VALUES ('a', 'creator', 50)");
  assert.deepEqual(await updateLeaderboardPanel(ctx), { posted: true });
  assert.equal(await updateLeaderboardPanel(ctx).then((r) => r.skipped), 'unchanged');
  getDb().run("INSERT INTO points_log (discord_user_id, kind, points) VALUES ('b', 'creator', 70)");
  assert.deepEqual(await updateLeaderboardPanel(ctx), { edited: true });
  assert.equal(ch.leaderboard.sent.length, 1);
  assert.match(json(ch.leaderboard.sent[0].edits[0].embeds[0]).description, /<@b>/);
});

test('dashboard services are provided on ready', async () => {
  await applications.onReady(ctx);
  await invites.onReady(ctx);
  assert.equal(typeof services.bot.reviewApplication, 'function');
  assert.equal(typeof services.bot.createPersonalInvite, 'function');
});
