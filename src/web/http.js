// Small helpers for Express routes.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message) => new HttpError(400, message);
export const notFound = (message = 'Nicht gefunden') => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);

/** Integer from a query/body value with bounds. */
export function intParam(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Comma separated list from a query value ("a,b" -> ['a','b']). */
export function listParam(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(listParam);
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

export function requireFields(body, fields) {
  for (const f of fields) {
    if (body?.[f] === undefined || body?.[f] === null || body?.[f] === '') throw badRequest(`Feld "${f}" fehlt.`);
  }
}

/** Sends rows as a CSV download (UTF-8 with BOM so Excel shows umlauts correctly). */
export function sendCsv(res, filename, columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label ?? c.key)).join(';')];
  for (const row of rows) lines.push(columns.map((c) => esc(typeof c.get === 'function' ? c.get(row) : row[c.key])).join(';'));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + lines.join('\r\n'));
}
