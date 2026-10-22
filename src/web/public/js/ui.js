// DOM helpers, formatting, toasts, dialogs. User data is always inserted as text (no innerHTML) to prevent XSS.

/**
 * h('div', { class: 'card', onclick: fn }, 'Text', child, [more])
 * Props: class, style (string|object), dataset, on<event>, attrs (raw), html: never supported on purpose.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class' || key === 'className') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
      else if (key === 'style') {
        if (typeof value === 'string') el.style.cssText = value;
        else Object.assign(el.style, value);
      } else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'value' && 'value' in el) el.value = value;
      else if (key === 'checked' || key === 'selected' || key === 'disabled' || key === 'multiple' || key === 'readOnly' || key === 'required') el[key] = Boolean(value);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// ---------- Formatting ----------
const nf = new Intl.NumberFormat('de-DE');
export const fmtNum = (n) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) ? '–' : nf.format(Math.round(Number(n))));

export function fmtCompact(n) {
  if (n === null || n === undefined || n === '') return '–';
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio.`;
  if (v >= 1e4) return `${(v / 1e3).toLocaleString('de-DE', { maximumFractionDigits: 0 })} Tsd.`;
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tsd.`;
  return nf.format(v);
}

export function fmtPct(part, total) {
  if (!total) return '–';
  return `${Math.round((Number(part) / Number(total)) * 100)} %`;
}

export function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(v, opts = {}) {
  const d = toDate(v);
  if (!d) return '–';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', ...opts });
}

export function fmtDateTime(v) {
  const d = toDate(v);
  if (!d) return '–';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtLongDate(v, timeZone) {
  const d = toDate(v);
  if (!d) return '–';
  const opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  if (timeZone) opts.timeZone = timeZone;
  try {
    return d.toLocaleString('de-DE', opts);
  } catch {
    delete opts.timeZone;
    return d.toLocaleString('de-DE', opts);
  }
}

const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });
export function fmtRelative(v) {
  const d = toDate(v);
  if (!d) return '–';
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 45) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}

export function truncate(s, n) {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

/** Splits "a, b ,c" into ['a','b','c']. */
export const splitList = (s) => String(s ?? '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

export function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return v ? [v] : [];
}

// ---------- Domain constants ----------
export const STATUS_ORDER = ['neu', 'qualifiziert', 'kontaktiert', 'nachgefasst', 'geantwortet', 'interessiert', 'im_discord', 'dabei', 'live'];
export const STATUS_SIDE = ['ungeeignet', 'kein_interesse', 'keine_antwort', 'abgemeldet'];
export const STATUS_LABELS = {
  neu: 'Neu',
  qualifiziert: 'Qualifiziert',
  kontaktiert: 'Kontaktiert',
  nachgefasst: 'Nachgefasst',
  geantwortet: 'Geantwortet',
  interessiert: 'Interessiert',
  im_discord: 'Im Discord',
  dabei: 'Dabei',
  live: 'Live beim Launch',
  ungeeignet: 'Ungeeignet',
  kein_interesse: 'Kein Interesse',
  keine_antwort: 'Keine Antwort',
  abgemeldet: 'Abgemeldet',
};
export const PLATFORM_LABELS = { youtube: 'YouTube', twitch: 'Twitch', tiktok: 'TikTok', instagram: 'Instagram', x: 'X', kick: 'Kick', discord: 'Discord', email: 'E-Mail' };
const PLATFORM_SHORT = { youtube: 'YT', twitch: 'TW', tiktok: 'TT', instagram: 'IG', x: 'X', kick: 'K', discord: 'DC', email: '@' };
export const LANGUAGES = {
  de: 'Deutsch',
  en: 'Englisch',
  es: 'Spanisch',
  pt: 'Portugiesisch',
  fr: 'Französisch',
  pl: 'Polnisch',
  tr: 'Türkisch',
  it: 'Italienisch',
  nl: 'Niederländisch',
  ru: 'Russisch',
  id: 'Indonesisch',
  vi: 'Vietnamesisch',
  tl: 'Tagalog',
  ja: 'Japanisch',
  ko: 'Koreanisch',
};
export const AGE_GROUPS = { unbekannt: 'Unbekannt', u13: 'Unter 13', '13-15': '13–15', '16-17': '16–17', '18+': '18+' };
export const CHANNEL_LABELS = { email: 'E-Mail', dm: 'DM (eingeladen)', discord: 'Eigener Discord', none: 'Kein erlaubter Weg' };
export const CHANNEL_DOT = { email: 'green', dm: 'green', discord: 'yellow', none: 'red' };
export const SENTIMENT_LABELS = { interessiert: 'Interessiert', fragen: 'Hat Fragen', kein_interesse: 'Kein Interesse' };
export const ACTIVITY_LABELS = {
  discovered: 'Gefunden',
  status: 'Status geändert',
  sent: 'Nachricht gesendet',
  followup_sent: 'Nachgefasst',
  reply: 'Antwort erfasst',
  note: 'Notiz',
  joined_discord: 'Discord beigetreten',
  application: 'Bewerbung',
  accepted: 'Angenommen',
  live: 'Live gegangen',
  content: 'Content eingereicht',
  skipped: 'Übersprungen',
};

export function statusBadge(status) {
  if (!status) return h('span', { class: 'badge' }, '–');
  return h('span', { class: `badge s-${status}` }, STATUS_LABELS[status] || status);
}

export function platformBadge(platform) {
  return h('span', { class: `plat ${platform || ''}`, title: PLATFORM_LABELS[platform] || platform }, PLATFORM_SHORT[platform] || String(platform || '?').slice(0, 2).toUpperCase());
}

export function channelDot(channel) {
  return h('span', { class: `dot ${CHANNEL_DOT[channel] || 'grey'}`, title: CHANNEL_LABELS[channel] || 'Noch nicht bestimmt' });
}

export function channelLabel(channel, platform) {
  if (!channel) return 'Noch nicht bestimmt';
  if (channel === 'dm' && platform) return `DM auf ${PLATFORM_LABELS[platform] || platform}`;
  return CHANNEL_LABELS[channel] || channel;
}

export function scoreBadge(score) {
  const s = Number(score) || 0;
  return h('span', { class: `score ${s >= 60 ? 'high' : s >= 35 ? 'mid' : 'low'}`, title: 'Passt-Wert (0–100)' }, String(s));
}

export const langLabel = (code) => (code ? LANGUAGES[code] || code.toUpperCase() : 'Unbekannt');

// ---------- Loading / empty / error ----------
export const loading = (text = 'Lädt …') => h('div', { class: 'loading' }, h('span', { class: 'spinner' }), text);

export function empty(icon, title, text, ...actions) {
  return h('div', { class: 'empty' }, h('div', { class: 'big' }, icon), h('h3', null, title), text ? h('p', null, text) : null, actions.length ? h('div', { class: 'btn-group' }, actions) : null);
}

export function errorBox(err, retry) {
  const msg = err?.message || String(err);
  return h(
    'div',
    { class: 'notice err' },
    h('span', { class: 'ico' }, '⚠️'),
    h('div', { class: 'grow' }, h('strong', null, 'Das hat nicht geklappt. '), msg),
    retry ? h('button', { class: 'btn btn-sm', onclick: retry }, 'Nochmal versuchen') : null,
  );
}

export function notice(type, icon, ...content) {
  return h('div', { class: `notice ${type}` }, h('span', { class: 'ico' }, icon), h('div', { class: 'grow' }, content));
}

// ---------- Toasts ----------
export function toast(message, type = 'info', ms = 4500) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const icon = { success: '✅', error: '⚠️', info: 'ℹ️' }[type] || 'ℹ️';
  const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, h('span', null, icon), h('div', { class: 'grow' }, message), h('button', { 'aria-label': 'Schließen', onclick: () => el.remove() }, '✕'));
  box.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? Math.max(ms, 8000) : ms);
}

export const toastError = (err) => toast(err?.message || String(err), 'error');

// ---------- Dialogs ----------
/** Opens a modal. Returns { close, dialog, body }. `onClose` runs once. */
export function modal({ title, body, footer, wide = false, onClose } = {}) {
  const dialog = h('dialog', { class: `modal${wide ? ' wide' : ''}` });
  const close = () => {
    if (dialog.open) dialog.close();
  };
  const bodyEl = h('div', { class: 'modal-body' }, body);
  dialog.append(
    h('div', { class: 'modal-head' }, h('h2', null, title || ''), h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onclick: close }, '✕')),
    bodyEl,
    footer ? h('div', { class: 'modal-foot' }, footer) : null,
  );
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  return { close, dialog, body: bodyEl };
}

/** Promise<boolean> confirmation dialog. */
export function confirmDialog({ title = 'Bist du sicher?', text = '', confirmText = 'Ja', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const yes = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { result = true; m.close(); } }, confirmText);
    const m = modal({
      title,
      body: h('p', { style: 'white-space:pre-line' }, text),
      footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'), yes],
      onClose: () => resolve(result),
    });
    yes.focus();
  });
}

/** Promise<string|null> text prompt. */
export function promptDialog({ title, label, value = '', placeholder = '', confirmText = 'OK', multiline = false } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const input = multiline ? h('textarea', { value, placeholder }) : h('input', { type: 'text', value, placeholder });
    const submit = () => {
      result = input.value;
      m.close();
    };
    if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const m = modal({
      title,
      body: h('div', { class: 'field' }, label ? h('label', null, label) : null, input),
      footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'), h('button', { class: 'btn btn-primary', onclick: submit }, confirmText)],
      onClose: () => resolve(result),
    });
    input.focus();
  });
}

// ---------- Clipboard ----------
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back */ }
  try {
    const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0;opacity:0', readonly: true });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ---------- Misc ----------
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Button that shows a spinner state while the async handler runs. */
export function actionButton(label, handler, { cls = 'btn', title, disabled } = {}) {
  const btn = h('button', { class: cls, title, disabled, type: 'button' }, label);
  btn.addEventListener('click', async (e) => {
    if (btn.disabled) return;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.dataset.busy = '1';
    try {
      await handler(e);
    } catch (err) {
      toastError(err);
    } finally {
      btn.disabled = false;
      delete btn.dataset.busy;
      if (btn.textContent === '') btn.textContent = prev;
    }
  });
  return btn;
}

/** Current hash route parts and query: '#/creator/12?x=1' -> { parts: ['creator','12'], query: URLSearchParams } */
export function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = hash.split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}

export function setQuery(params) {
  const { parts } = currentRoute();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  const s = qs.toString();
  const target = `#/${parts.join('/')}${s ? '?' + s : ''}`;
  if (location.hash !== target) history.replaceState(null, '', target);
}

/** Select element from { value: label } or [[value,label]] options. */
export function select(options, value, props = {}) {
  const entries = Array.isArray(options) ? options : Object.entries(options);
  return h(
    'select',
    props,
    entries.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, l)),
  );
}

export function field(label, control, help, cls = '') {
  return h('div', { class: `field ${cls}` }, label ? h('label', null, label) : null, control, help ? h('div', { class: 'help' }, help) : null);
}

/** Safe external link (opens in a new tab). */
export function extLink(url, text) {
  if (!url) return h('span', { class: 'muted' }, text || '–');
  let safe = null;
  try {
    const u = new URL(url, location.origin);
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) safe = u.href;
  } catch { /* invalid */ }
  if (!safe) return h('span', null, text || url);
  return h('a', { href: safe, target: '_blank', rel: 'noopener noreferrer' }, text || url);
}
