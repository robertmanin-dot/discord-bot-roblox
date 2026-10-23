import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './fixtures/radar-fixtures.js';
import { getDb } from '../src/core/db.js';
import { updateSettings } from '../src/core/settings.js';
import {
  renderString, renderTemplate, formatLaunchDate, formatLaunchTime, buildVars, pickTemplate, createTemplate, updateTemplate,
  deleteTemplate, ensureDefaultTemplates, resetTemplate, cleanName, parseTemplateKey, listTemplates,
} from '../src/radar/templates.js';
import { DEFAULT_TEMPLATES } from '../src/radar/default-templates.js';

beforeEach(() => freshDb());

const LAUNCH = '2026-11-21T18:00:00.000Z';

test('placeholders, conditional blocks and missing values', () => {
  const r = renderString('Hey {name}! [[Dein Video „{video}“ ist stark.||Deine Videos sind stark.]] Spiel: {game}. {unknown} Datenschutz: {privacy}', {
    name: 'Max',
    video: '',
    game: 'Tower Rush',
  });
  assert.equal(r.text, 'Hey Max! Deine Videos sind stark. Spiel: Tower Rush. {unknown} Datenschutz:');
  assert.deepEqual(r.missing, ['privacy']);
  assert.equal(renderString('[[Video: {video}]]Ende', { video: 'Ab' }).text, 'Video: AbEnde');
  assert.equal(renderString('A [[{video}]] B', {}).text, 'A B');
  assert.equal(renderString('Hallo {name} , wie geht\'s?', { name: 'Max' }).text, "Hallo Max, wie geht's?");
  assert.equal(renderString('Zeile1\n\n\n\nZeile2', {}).text, 'Zeile1\n\nZeile2');
});

test('launch date and time per language', () => {
  assert.equal(formatLaunchDate(LAUNCH, 'de'), 'Samstag, 21. November');
  assert.equal(formatLaunchDate(LAUNCH, 'en'), 'Saturday, November 21');
  assert.equal(formatLaunchTime(LAUNCH, 'de'), '19:00 Uhr');
  assert.equal(formatLaunchTime(LAUNCH, 'en'), '7:00 PM CET (1:00 PM ET)');
  assert.equal(formatLaunchTime(LAUNCH, 'pt'), '19:00 CET (15:00 Brasília)');
  assert.equal(formatLaunchTime(LAUNCH, 'es'), '19:00 CET (12:00 CDMX)');
  assert.equal(formatLaunchTime(LAUNCH, 'fr'), '19:00 CET');
  assert.equal(formatLaunchTime('2026-07-04T17:00:00.000Z', 'en'), '7:00 PM CEST (1:00 PM ET)');
  assert.equal(formatLaunchTime('', 'de'), '');
});

test('clean display names', () => {
  assert.equal(cleanName('LukasPlays 🎮 | Roblox'), 'LukasPlays');
  assert.equal(cleanName('TTV_MaxLive'), 'MaxLive');
  assert.equal(cleanName('Max - YT'), 'Max');
  assert.equal(cleanName('🔥'), '🔥');
});

test('buildVars uses the creator language and falls back sensibly', () => {
  updateSettings({
    game: {
      name: 'Tower Rush', pitch_de: 'Shooter + Turmbau', pitch_en: 'Shooter + tower race', launchAt: LAUNCH, infoUrl: 'https://info.example',
      discordInvite: 'https://discord.gg/general', senderName: 'Robert', studioName: 'Studio X', privacyUrl: 'https://example/privacy',
    },
  });
  const full = {
    creator: { display_name: 'LukasPlays 🎮 | Roblox', language: 'de' },
    accounts: [
      { platform: 'youtube', latest_title: 'Altes Video', last_active_at: '2026-10-01T00:00:00Z', source: 'youtube_api' },
      { platform: 'youtube', latest_title: 'Neues Video über Roblox Rivals mit Zuschauern und noch viel mehr Text der abgeschnitten wird', last_active_at: '2026-10-20T00:00:00Z', source: 'youtube_api' },
    ],
  };
  const de = buildVars(full);
  assert.equal(de.name, 'LukasPlays');
  assert.equal(de.pitch, 'Shooter + Turmbau');
  assert.equal(de.date, 'Samstag, 21. November');
  assert.equal(de.time, '19:00 Uhr');
  assert.equal(de.discord, 'https://discord.gg/general');
  assert.equal(de.platform, 'YouTube');
  assert.ok(de.video.startsWith('Neues Video') && de.video.length <= 70 && de.video.endsWith('…'));
  const pt = buildVars(full, { language: 'pt', inviteUrl: 'https://discord.gg/personal' });
  assert.equal(pt.pitch, 'Shooter + tower race');
  assert.equal(pt.discord, 'https://discord.gg/personal');
  assert.equal(pt.reward, 'an exclusive in-game item');
});

test('template selection: language fallback, discord->dm, A/B variants', () => {
  createTemplate({ step: 'first', channel: 'email', language: 'de', variant: 'A', subject: 'Hallo {name}', body: 'A {name}' });
  createTemplate({ step: 'first', channel: 'email', language: 'de', variant: 'B', subject: 'Hi {name}', body: 'B {name}' });
  createTemplate({ step: 'first', channel: 'email', language: 'en', variant: 'A', subject: 'Hello', body: 'EN' });
  createTemplate({ step: 'first', channel: 'dm', language: 'en', variant: 'A', body: 'DM EN' });
  assert.equal(pickTemplate({ step: 'first', channel: 'email', language: 'de', outreachId: 2 }).variant, 'A');
  assert.equal(pickTemplate({ step: 'first', channel: 'email', language: 'de', outreachId: 3 }).variant, 'B');
  assert.equal(pickTemplate({ step: 'first', channel: 'email', language: 'fr', outreachId: 3 }).language, 'en');
  assert.equal(pickTemplate({ step: 'first', channel: 'discord', language: 'de' }).body, 'DM EN');
  assert.equal(pickTemplate({ step: 'followup', channel: 'email', language: 'de' }), null);
  updateSettings({ radar: { abTest: false } });
  assert.equal(pickTemplate({ step: 'first', channel: 'email', language: 'de', outreachId: 3 }).variant, 'A');
  const t = pickTemplate({ step: 'first', channel: 'email', language: 'de', outreachId: 2 });
  assert.deepEqual(renderTemplate(t, { name: 'Max' }), { subject: 'Hallo Max', body: 'A Max', missing: [] });
});

test('template CRUD: edit marks custom, defaults are not overwritten, delete only own', () => {
  assert.equal(parseTemplateKey('first.email.de.A').channel, 'email');
  assert.equal(parseTemplateKey('first.sms.de.A'), null);
  const own = createTemplate({ step: 'followup', channel: 'email', language: 'tr', variant: 'C', subject: 'S', body: 'B' });
  assert.equal(own.is_custom, 1);
  assert.throws(() => createTemplate({ step: 'followup', channel: 'email', language: 'tr', variant: 'C', body: 'x' }));
  assert.equal(updateTemplate(own.key, { body: 'Neu', active: false }).active, 0);
  assert.equal(deleteTemplate(own.key), true);

  const n = ensureDefaultTemplates();
  assert.equal(n, DEFAULT_TEMPLATES.filter((t) => t.body).length);
  if (DEFAULT_TEMPLATES.length) {
    const key = DEFAULT_TEMPLATES[0].key;
    updateTemplate(key, { body: 'Mein eigener Text' });
    ensureDefaultTemplates();
    assert.equal(listTemplates().find((t) => t.key === key).body, 'Mein eigener Text');
    assert.throws(() => deleteTemplate(key), /Standard-Vorlagen/);
    assert.equal(resetTemplate(key).body, DEFAULT_TEMPLATES[0].body);
    assert.equal(getDb().value('SELECT is_custom FROM templates WHERE key = :key', { key }), 0);
  }
});

test('default templates are valid for the template engine', () => {
  const known = new Set(['name', 'video', 'game', 'pitch', 'date', 'time', 'link', 'discord', 'sender', 'studio', 'privacy', 'reward', 'platform']);
  const vars = Object.fromEntries([...known].map((k) => [k, `<${k}>`]));
  const keys = new Set();
  for (const t of DEFAULT_TEMPLATES) {
    const key = t.key;
    const parsed = parseTemplateKey(key);
    assert.ok(parsed, `ungültiger Schlüssel ${key}`);
    assert.deepEqual([t.step, t.channel, t.language, t.variant], [parsed.step, parsed.channel, parsed.language, parsed.variant], `Felder passen nicht zu ${key}`);
    assert.ok(!keys.has(key), `doppelt: ${key}`);
    keys.add(key);
    assert.ok(String(t.body || '').trim(), `leerer Text: ${key}`);
    if (t.channel === 'email') assert.ok(String(t.subject || '').trim(), `Betreff fehlt: ${key}`);
    const text = `${t.subject || ''}\n${t.body}`;
    for (const m of text.matchAll(/\{(\w+)\}/g)) assert.ok(known.has(m[1]), `unbekannter Platzhalter {${m[1]}} in ${key}`);
    assert.equal((text.match(/\[\[/g) || []).length, (text.match(/\]\]/g) || []).length, `[[ ]] nicht ausgeglichen in ${key}`);
    if (t.step === 'first') assert.ok(text.includes('{privacy}'), `Datenschutz-Link fehlt in ${key}`);
    const r = renderTemplate(t, vars);
    assert.ok(!/\{(name|video|game|pitch|date|time|link|discord|sender|studio|privacy|reward|platform)\}/.test(`${r.subject} ${r.body}`), `nicht ersetzt in ${key}`);
    assert.ok(!/\[\[|\]\]/.test(r.body), `Bedingungsblock nicht aufgelöst in ${key}`);
  }
});
