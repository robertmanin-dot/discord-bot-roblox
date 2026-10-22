// App shell: navigation, hash router, status pills.
import { get } from './api.js';
import { h, mount, currentRoute, errorBox, loading } from './ui.js';

const PAGES = [
  { key: 'start', label: 'Start', ico: '🏠', module: './pages/start.js' },
  { key: 'senden', label: 'Senden', ico: '✉️', module: './pages/senden.js', countKey: 'queue' },
  { key: 'creator', label: 'Creator', ico: '👥', module: './pages/creator.js' },
  { key: 'finden', label: 'Finden', ico: '🔎', module: './pages/finden.js' },
  { key: 'vorlagen', label: 'Vorlagen', ico: '📝', module: './pages/vorlagen.js' },
  { sep: true },
  { key: 'discord', label: 'Discord', ico: '💬', module: './pages/discord.js', countKey: 'applications' },
  { key: 'playtests', label: 'Playtests & Events', ico: '🧪', module: './pages/playtests.js' },
  { key: 'statistik', label: 'Statistik', ico: '📊', module: './pages/statistik.js' },
  { sep: true },
  { key: 'einstellungen', label: 'Einstellungen', ico: '⚙️', module: './pages/einstellungen.js' },
  { key: 'einrichtung', label: 'Einrichtung', ico: '🔑', module: './pages/einrichtung.js', countKey: 'setup' },
];

const TITLES = Object.fromEntries(PAGES.filter((p) => p.key).map((p) => [p.key, p.label]));
const view = document.getElementById('view');
const nav = document.getElementById('nav');
const titleEl = document.getElementById('page-title');
const pillsEl = document.getElementById('status-pills');

let cleanup = null;
let renderToken = 0;
export const appState = { status: null, counts: {} };

function buildNav() {
  mount(
    nav,
    PAGES.map((p) => {
      if (p.sep) return h('div', { class: 'nav-sep' });
      return h(
        'a',
        { href: `#/${p.key}`, dataset: { key: p.key } },
        h('span', { class: 'ico', 'aria-hidden': 'true' }, p.ico),
        h('span', null, p.label),
        p.countKey ? h('span', { class: 'count hidden', dataset: { count: p.countKey } }) : null,
      );
    }),
  );
}

function setActiveNav(key) {
  for (const a of nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.key === key);
}

/** Sets the page title shown in the top bar (pages can refine it). */
export function setTitle(text) {
  titleEl.textContent = text;
  document.title = `${text} · Creator Launch Kit`;
}

async function route() {
  const { parts, query } = currentRoute();
  const key = parts[0] || 'start';
  const page = PAGES.find((p) => p.key === key);
  if (!page) {
    location.hash = '#/start';
    return;
  }
  document.body.classList.remove('nav-open');
  setActiveNav(key);
  setTitle(TITLES[key]);
  const token = ++renderToken;
  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch { /* ignore */ }
  }
  cleanup = null;
  mount(view, loading());
  try {
    const mod = await import(page.module);
    if (token !== renderToken) return;
    const container = h('div', { class: 'page' });
    mount(view, container);
    const result = await mod.render(container, { parts: parts.slice(1), query, refreshStatus });
    if (token !== renderToken) {
      if (typeof result === 'function') result();
      return;
    }
    cleanup = result;
    view.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    mount(view, errorBox(err, () => route()));
  }
}

function pill(cls, content, href, title) {
  return h(href ? 'a' : 'span', { class: `pill ${cls || ''}`, href, title }, content);
}

function setCount(key, n) {
  const el = nav.querySelector(`[data-count="${key}"]`);
  if (!el) return;
  el.textContent = n > 99 ? '99+' : String(n);
  el.classList.toggle('hidden', !n);
}

/** Reloads /api/status and updates the top-bar pills + nav counters. */
export async function refreshStatus() {
  try {
    const status = await get('/status');
    appState.status = status;
    const bot = status.bot || {};
    const botDot = bot.state === 'ready' ? 'green pulse' : bot.state === 'connecting' ? 'yellow' : bot.state === 'error' ? 'red' : 'grey';
    const botText = bot.state === 'ready' ? 'Bot online' : bot.state === 'connecting' ? 'Bot verbindet …' : bot.state === 'error' ? 'Bot-Fehler' : 'Bot aus';
    const yt = status.secrets?.YOUTUBE_API_KEY?.set;
    const q = status.quota || {};
    mount(
      pillsEl,
      pill('', [h('span', { class: `dot ${botDot}` }), botText], '#/einrichtung', bot.error || ''),
      pill('pill-optional', [h('span', { class: `dot ${yt ? 'green' : 'grey'}` }), yt ? `YouTube ${q.youtubeSearches ?? 0}/${q.youtubeSearchLimit ?? 100} Suchen` : 'YouTube-Schlüssel fehlt'], yt ? '#/finden' : '#/einrichtung'),
    );
    const brand = document.getElementById('brand-game');
    if (brand) brand.textContent = status.game?.name ? `für ${status.game.name}` : '';
    const openSetup = (status.setup || []).filter((i) => !i.done && !i.optional).length;
    setCount('setup', openSetup);
    return status;
  } catch {
    mount(pillsEl, pill('', [h('span', { class: 'dot red' }), 'Keine Verbindung']));
    return null;
  }
}

async function refreshCounts() {
  try {
    const q = await get('/queue', { mode: 'first', limit: 1 });
    setCount('queue', q?.total || 0);
  } catch {
    setCount('queue', 0);
  }
  try {
    const d = await get('/discord/overview');
    const a = d?.counts?.applications || {};
    setCount('applications', (a.offen || 0) + (a.eltern_ausstehend || 0));
  } catch {
    setCount('applications', 0);
  }
}

document.getElementById('menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
document.addEventListener('click', (e) => {
  if (document.body.classList.contains('nav-open') && !e.target.closest('.sidebar') && !e.target.closest('#menu-btn')) {
    document.body.classList.remove('nav-open');
  }
});

window.addEventListener('hashchange', route);
buildNav();
if (!location.hash) history.replaceState(null, '', '#/start');
route();
refreshStatus();
refreshCounts();
setInterval(refreshStatus, 15000);
setInterval(refreshCounts, 60000);
