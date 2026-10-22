// JSON-API helper. Every changing request carries "X-CLK: 1" (CSRF protection on the server).

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
  /** True if the endpoint does not exist (yet) on the server. */
  get missing() {
    return this.status === 404 && /Unbekannter API-Endpunkt/i.test(this.data?.error || '');
  }
}

export const MISSING_TEXT = 'Diese Funktion ist in dieser Version noch nicht verfügbar.';

export async function api(path, { method = 'GET', body, query, signal } = {}) {
  let url = '/api' + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const headers = { accept: 'application/json' };
  const opts = { method, headers, signal, credentials: 'same-origin' };
  if (method !== 'GET' && method !== 'HEAD') headers['x-clk'] = '1';
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Keine Verbindung zum Tool. Läuft das Programm noch? (Das Fenster mit start.bat bzw. „npm start“ offen lassen.)');
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
  }
  if (!res.ok) {
    let message = data?.error || `Fehler ${res.status}`;
    if (res.status === 404 && /Unbekannter API-Endpunkt/i.test(data?.error || '')) message = MISSING_TEXT;
    if (res.status === 401) message = 'Passwort erforderlich – bitte die Seite neu laden und anmelden.';
    if (res.status === 503 && !data?.error) message = 'Dienst gerade nicht verfügbar.';
    throw new ApiError(res.status, message, data);
  }
  return data;
}

export const get = (path, query) => api(path, { query });
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const put = (path, body = {}) => api(path, { method: 'PUT', body });
export const patch = (path, body = {}) => api(path, { method: 'PATCH', body });
export const del = (path) => api(path, { method: 'DELETE' });

/** Like get(), but returns `fallback` instead of throwing (for optional widgets). */
export async function tryGet(path, query, fallback = null) {
  try {
    return await get(path, query);
  } catch {
    return fallback;
  }
}
