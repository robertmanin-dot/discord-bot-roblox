// Secrets and process-level config live in the .env file next to package.json.
// Everything else (game info, limits, Discord IDs) lives in the database (see settings.js).
import fs from 'node:fs';
import path from 'node:path';
import { ENV_PATH } from './paths.js';
import { bus } from './bus.js';

export const SECRET_KEYS = [
  'DISCORD_TOKEN',
  'YOUTUBE_API_KEY',
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'DASHBOARD_PASSWORD',
];

export const ENV_KEYS = [...SECRET_KEYS, 'PORT', 'HOST', 'OPEN_BROWSER', 'LOG_LEVEL'];

/** Minimal .env parser: KEY=value, # comments, optional single/double quotes. */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[m[1]] = value;
  }
  return out;
}

/** Loads .env into process.env without overriding variables that are already set. */
export function loadEnv(file = ENV_PATH) {
  if (!fs.existsSync(file)) return {};
  const values = parseEnv(fs.readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return values;
}

export function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null ? fallback : String(v).trim();
}

export const hasSecret = (name) => env(name) !== '';

function mask(value) {
  if (!value) return '';
  return value.length <= 8 ? '••••' : `••••${value.slice(-4)}`;
}

/** Which secrets are set (never returns the values themselves). */
export function secretStatus() {
  return Object.fromEntries(SECRET_KEYS.map((k) => [k, { set: hasSecret(k), hint: mask(env(k)) }]));
}

function quoteValue(value) {
  if (value === '') return '';
  if (/^[A-Za-z0-9_./:@+\-=]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * Writes keys into .env (keeps comments and unrelated lines) and updates process.env.
 * An empty string removes the key.
 */
export function writeEnv(updates, file = ENV_PATH) {
  const keys = Object.keys(updates);
  for (const key of keys) {
    if (!ENV_KEYS.includes(key)) throw new Error(`Unbekannter Schlüssel: ${key}`);
  }
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const seen = new Set();
  const outLines = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && keys.includes(m[1])) {
      seen.add(m[1]);
      const value = String(updates[m[1]] ?? '').trim();
      if (value !== '') outLines.push(`${m[1]}=${quoteValue(value)}`);
      continue;
    }
    outLines.push(line);
  }
  for (const key of keys) {
    const value = String(updates[key] ?? '').trim();
    if (!seen.has(key) && value !== '') outLines.push(`${key}=${quoteValue(value)}`);
  }
  while (outLines.length && outLines[outLines.length - 1] === '') outLines.pop();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, outLines.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);

  for (const key of keys) {
    const value = String(updates[key] ?? '').trim();
    if (value === '') delete process.env[key];
    else process.env[key] = value;
  }
  bus.emit('secrets.changed', keys);
  return secretStatus();
}

export const port = () => Number(env('PORT', '3000')) || 3000;
export const host = () => env('HOST', '127.0.0.1') || '127.0.0.1';
