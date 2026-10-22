import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, mockFetch, youtubeWorld } from './fixtures/radar-fixtures.js';
import { getDb } from '../src/core/db.js';
import { createCreator, upsertAccount, addContact, setOutreachStatus, getCreatorFull, updateCreator, updateOutreach, getOutreach } from '../src/core/creators.js';
import { runRetention } from '../src/radar/retention.js';

const old = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

function aged(name, { createdDaysAgo = 40, fetchedDaysAgo = 40, status, contacted = false, member = false, discord = null, platform = 'youtube', ext } = {}) {
  const id = createCreator({ display_name: name });
  getDb().run('UPDATE creators SET created_at = :at WHERE id = :id', { at: old(createdDaysAgo), id });
  upsertAccount(id, {
    platform,
    external_id: ext || `${platform}_${name}`,
    handle: name.toLowerCase(),
    followers: 1234,
    bio: 'bio',
    latest_title: 'Titel',
    fetched_at: old(fetchedDaysAgo),
    source: `${platform}_api`,
  });
  addContact(id, { type: 'email', value: `${name.toLowerCase()}@x.de` });
  if (member) updateCreator(id, { is_member: 1 });
  if (discord) updateCreator(id, { discord_user_id: discord });
  if (contacted) updateOutreach(getOutreach(id).id, { contacted_at: old(createdDaysAgo - 1) });
  if (status) setOutreachStatus(id, status, { force: true });
  return id;
}

beforeEach(() => {
  freshDb();
  delete process.env.YOUTUBE_API_KEY;
});
afterEach(() => {
  delete process.env.YOUTUBE_API_KEY;
});

test('deletes old uncontacted creators but keeps members and Discord-linked ones', async () => {
  const gone = aged('Gone');
  const fresh = aged('Fresh', { createdDaysAgo: 5, fetchedDaysAgo: 5 });
  const member = aged('Member', { member: true });
  const linked = aged('Linked', { discord: '123456789012345678' });
  const r = await runRetention();
  assert.equal(r.deleted, 1);
  assert.equal(getCreatorFull(gone), null);
  assert.ok(getCreatorFull(fresh));
  assert.ok(getCreatorFull(member));
  assert.ok(getCreatorFull(linked));
});

test('deletes long-time no-reply creators', async () => {
  const id = aged('Silent', { createdDaysAgo: 400, fetchedDaysAgo: 5, contacted: true, status: 'keine_antwort' });
  getDb().run("UPDATE outreach SET status_changed_at = :at WHERE creator_id = :id", { at: old(200), id });
  const keep = aged('Recent', { createdDaysAgo: 400, fetchedDaysAgo: 5, contacted: true, status: 'keine_antwort' });
  const r = await runRetention();
  assert.equal(r.deleted, 1);
  assert.equal(getCreatorFull(id), null);
  assert.ok(getCreatorFull(keep));
});

test('clears old API data without key, refreshes it with key', async () => {
  const contacted = aged('Contacted', { contacted: true, status: 'kontaktiert', ext: 'UC_DE1' });
  const member = aged('MemberTw', { member: true, platform: 'twitch' });
  let r = await runRetention();
  assert.equal(r.cleared, 2);
  let acc = getCreatorFull(contacted).accounts[0];
  assert.equal(acc.followers, null);
  assert.equal(acc.bio, null);
  assert.equal(acc.fetched_at, null);
  assert.equal(acc.handle, 'contacted', 'identity stays');
  assert.equal(getCreatorFull(member).accounts[0].followers, null);

  // With key: refreshed from the API instead.
  getDb().run("UPDATE accounts SET fetched_at = :at, followers = 1 WHERE creator_id = :id", { at: old(45), id: contacted });
  process.env.YOUTUBE_API_KEY = 'test-key';
  const fetchImpl = mockFetch(youtubeWorld().handler);
  r = await runRetention({ fetchImpl });
  assert.equal(r.refreshed, 1);
  acc = getCreatorFull(contacted).accounts[0];
  assert.equal(acc.followers, 3200);
  assert.ok(Date.now() - Date.parse(acc.fetched_at) < 60_000);
});

test('captured profiles (no API data) are never cleared', async () => {
  const id = createCreator({ display_name: 'Captured' });
  upsertAccount(id, { platform: 'tiktok', handle: 'cap', followers: 5000, bio: 'DM for collabs', fetched_at: old(90), source: 'capture' });
  updateOutreach(getOutreach(id).id, { contacted_at: old(80) });
  const r = await runRetention();
  assert.equal(r.cleared, 0);
  assert.equal(getCreatorFull(id).accounts[0].followers, 5000);
});
