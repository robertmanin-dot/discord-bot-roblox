const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGermanDateTime, parseDuration, formatPlaytime } = require('../src/time');

const TZ = 'Europe/Berlin';

test('Datum im Sommer (MESZ, UTC+2)', () => {
  assert.equal(parseGermanDateTime('24.07.2026 18:00', TZ), Date.UTC(2026, 6, 24, 16, 0) / 1000);
});

test('Datum im Winter (MEZ, UTC+1)', () => {
  assert.equal(parseGermanDateTime('24.12.2026 18:00', TZ), Date.UTC(2026, 11, 24, 17, 0) / 1000);
});

test('Tag der Zeitumstellung', () => {
  // 25.10.2026: um 03:00 MESZ wird auf 02:00 MEZ zurückgestellt
  assert.equal(parseGermanDateTime('25.10.2026 12:00', TZ), Date.UTC(2026, 9, 25, 11, 0) / 1000);
  assert.equal(parseGermanDateTime('25.10.2026 01:00', TZ), Date.UTC(2026, 9, 24, 23, 0) / 1000);
});

test('Zweistelliges Jahr, "um" und "Uhr"', () => {
  const expected = Date.UTC(2026, 11, 24, 17, 30) / 1000;
  assert.equal(parseGermanDateTime('24.12.26 18:30', TZ), expected);
  assert.equal(parseGermanDateTime('24.12.2026 um 18.30 Uhr', TZ), expected);
});

test('Ohne Jahr: dieses oder nächstes Jahr', () => {
  const now = Date.UTC(2026, 9, 22, 10, 0); // 22.10.2026
  assert.equal(parseGermanDateTime('30.10. 18:00', TZ, now), Date.UTC(2026, 9, 30, 17, 0) / 1000);
  assert.equal(parseGermanDateTime('05.01. 18:00', TZ, now), Date.UTC(2027, 0, 5, 17, 0) / 1000);
});

test('Ungültige Eingaben', () => {
  for (const input of ['morgen', '31.02.2026 18:00', '24.13.2026 18:00', '24.10.2026 25:00', '24.10.2026']) {
    assert.equal(parseGermanDateTime(input, TZ), null, input);
  }
});

test('Dauern', () => {
  assert.equal(parseDuration('30m'), 1800);
  assert.equal(parseDuration('12h'), 43200);
  assert.equal(parseDuration('3d'), 259200);
  assert.equal(parseDuration('1d 12h'), 129600);
  assert.equal(parseDuration('2 tage'), 172800);
  assert.equal(parseDuration('1w'), 604800);
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('5'), null);
  assert.equal(parseDuration('3x'), null);
  assert.equal(parseDuration('0m'), null);
});

test('Spielzeit formatieren', () => {
  assert.equal(formatPlaytime(59), '0 Min.');
  assert.equal(formatPlaytime(15 * 60), '15 Min.');
  assert.equal(formatPlaytime(3600), '1 Std.');
  assert.equal(formatPlaytime(5100), '1 Std. 25 Min.');
});
