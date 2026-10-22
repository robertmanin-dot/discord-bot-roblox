import crypto from 'node:crypto';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function truncate(str, max) {
  const s = String(str ?? '');
  return s.length > max ? s.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : s;
}

export function safeJson(text, fallback = null) {
  if (text === null || text === undefined || text === '') return fallback;
  if (typeof text !== 'string') return text;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function normalizeHandle(handle) {
  return String(handle ?? '').trim().replace(/^@+/, '').toLowerCase();
}

/** Removes accents: "Bögen" -> "Bogen". */
export function stripDiacritics(str) {
  return String(str ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Creator code from a display name, e.g. "Lukas Plays 🎮" -> "LUKASPLAYS". */
export function makeCode(name, maxLen = 12) {
  const base = stripDiacritics(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (base || 'CREATOR').slice(0, maxLen);
}

export function isPlainObject(x) {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === null || proto === Object.prototype;
}

/** Deep merge for plain objects. Arrays and primitives in `source` replace those in `target`. */
export function deepMerge(target, source) {
  if (!isPlainObject(source)) return source === undefined ? target : source;
  const out = isPlainObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

export function getPath(obj, path, fallback = undefined) {
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur === null || cur === undefined) return fallback;
    cur = cur[part];
  }
  return cur === undefined ? fallback : cur;
}

/** Parses an integer from user input like "12.300", "12,3k", "1.2M", "12 300". */
export function parseCount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  let s = String(value).trim().toLowerCase().replace(/\s+/g, '').replace(/\.+$/, '');
  if (!s) return null;
  let mult = 1;
  const suffix = s.match(/(k|m|mio|tsd|b)$/);
  if (suffix) {
    mult = { k: 1e3, tsd: 1e3, m: 1e6, mio: 1e6, b: 1e9 }[suffix[1]];
    s = s.slice(0, -suffix[1].length);
    s = s.replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.round(n * mult) : null;
  }
  // Without suffix, "." and "," are thousands separators ("12.300" / "12,300").
  s = s.replace(/[.,'](?=\d{3}(\D|$))/g, '');
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}
