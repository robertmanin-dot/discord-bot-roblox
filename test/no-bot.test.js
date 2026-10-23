// Behaviour without a Discord bot and without a privacy-policy link.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db.js';
import { getSettings, resetSettingsCache, updateSettings } from '../src/core/settings.js';
import { setupChecklist } from '../src/core/checklist.js';
import { buildVars, PRIVACY_NOTE, renderTemplate } from '../src/radar/templates.js';
import { DEFAULT_TEMPLATES } from '../src/radar/default-templates.js';

beforeEach(() => {
  openDb(':memory:');
  resetSettingsCache();
});

const full = {
  creator: { display_name: 'Lukas Plays', language: 'de' },
  accounts: [{ platform: 'tiktok', handle: 'lukas', source: 'import' }],
};

test('bot is off by default and the checklist does not ask for it', () => {
  assert.equal(getSettings().discord.useBot, false);
  const keys = setupChecklist().map((i) => i.key);
  for (const k of ['discordToken', 'botOnline', 'botGuild', 'setup']) assert.ok(!keys.includes(k), `${k} should be hidden`);
  updateSettings({ discord: { useBot: true } });
  const keysOn = setupChecklist().map((i) => i.key);
  for (const k of ['discordToken', 'botOnline', 'botGuild', 'setup']) assert.ok(keysOn.includes(k), `${k} should be shown`);
});

test('privacy link is optional in the checklist', () => {
  const item = setupChecklist().find((i) => i.key === 'privacy');
  assert.equal(item.optional, true);
});

test('fast-campaign defaults: follow-up after 3 days', () => {
  assert.equal(getSettings().radar.followupAfterDays, 3);
  assert.equal(getSettings().radar.noReplyAfterDays, 7);
});

test('{privacy} falls back to a short note: long for e-mail, short for DMs', () => {
  const email = buildVars(full, { language: 'de', channel: 'email' });
  const dm = buildVars(full, { language: 'de', channel: 'dm' });
  assert.equal(email.privacy, PRIVACY_NOTE.de.long);
  assert.equal(dm.privacy, PRIVACY_NOTE.de.short);
  assert.equal(buildVars(full, { language: 'it', channel: 'email' }).privacy, PRIVACY_NOTE.en.long);
  updateSettings({ game: { privacyUrl: 'https://example.org/ds' } });
  assert.equal(buildVars(full, { language: 'de', channel: 'dm' }, ).privacy, 'https://example.org/ds');
});

test('every default template renders without empty "Datenschutz:" when no link is set', () => {
  updateSettings({ game: { name: 'Tower Rush', senderName: 'Robert', studioName: 'Blocky Games', url: 'https://www.roblox.com/games/1/x', launchAt: '2026-10-31T18:00:00.000Z' } });
  for (const t of DEFAULT_TEMPLATES) {
    const vars = buildVars(full, { language: t.language, channel: t.channel });
    const { body, missing } = renderTemplate(t, vars);
    assert.ok(!missing.includes('privacy'), `${t.key}: privacy missing`);
    assert.ok(!/(Datenschutz|Privacy|Privacidad|Privacidade|Confidentialité|Prywatność|Gizlilik)\s*:\s*$/im.test(body), `${t.key} ends with an empty privacy label`);
    if (t.channel === 'dm') assert.ok(body.length < 1000, `${t.key}: DM too long for Instagram (${body.length} chars)`);
  }
});
