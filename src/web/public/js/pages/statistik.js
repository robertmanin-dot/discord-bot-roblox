// Statistik: pipeline, reply rates by language/channel/template, daily activity chart.
import { get, ApiError } from '../api.js';
import { h, mount, loading, empty, errorBox, fmtNum, fmtPct, STATUS_ORDER, STATUS_SIDE, STATUS_LABELS, LANGUAGES, PLATFORM_LABELS, CHANNEL_LABELS, notice } from '../ui.js';

export async function render(root) {
  mount(root, loading());
  let s;
  try {
    s = await get('/stats');
  } catch (err) {
    mount(root, err instanceof ApiError && err.missing ? h('div', { class: 'card' }, empty('🛠️', 'Statistik noch nicht verfügbar', err.message)) : errorBox(err, () => render(root)));
    return;
  }
  const t = s.totals || {};
  const funnel = s.funnel || {};
  const max = Math.max(1, ...STATUS_ORDER.map((k) => funnel[k] || 0));
  const byTemplate = [...(s.byTemplate || [])].sort((a, b) => (b.sent || 0) - (a.sent || 0));
  const bestRate = Math.max(0, ...byTemplate.filter((r) => (r.sent || 0) >= 10).map(rateOf));

  mount(
    root,
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'grid grid-4' },
        stat(fmtNum(t.creators), 'Creator gesamt'),
        stat(fmtNum(t.contacted), 'kontaktiert'),
        stat(`${fmtNum(t.replied)} (${fmtPct(t.replied, t.contacted)})`, 'Antworten (Quote)'),
        stat(fmtNum(t.interested), 'interessiert'),
        stat(fmtNum(t.joined), 'im Discord'),
        stat(fmtNum(t.members), 'im Programm'),
        stat(fmtNum(t.live), 'live beim Launch'),
        stat(fmtPct(t.members, t.contacted), 'Zusage-Quote'),
      ),
      h(
        'div',
        { class: 'grid grid-2' },
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Pipeline')),
          h(
            'div',
            { class: 'funnel' },
            STATUS_ORDER.map((k) =>
              h('a', { class: 'frow', href: `#/creator?status=${k}`, style: 'color:inherit;text-decoration:none' }, h('span', null, STATUS_LABELS[k]), h('div', { class: 'track' }, h('div', { class: 'bar', style: `width:${barPct(funnel[k], max)}%` })), h('span', { class: 'right' }, fmtNum(funnel[k] || 0))),
            ),
          ),
          h('div', { class: 'chips mt' }, STATUS_SIDE.map((k) => h('a', { class: 'chip', href: `#/creator?status=${k}` }, `${STATUS_LABELS[k]}: ${fmtNum(funnel[k] || 0)}`))),
        ),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Letzte Tage')), dailyChart(s.daily || [])),
      ),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Welche Vorlage funktioniert?')),
        byTemplate.length
          ? table(
            ['Vorlage', 'Variante', 'Gesendet', 'Antworten', 'Quote'],
            byTemplate.map((r) => {
              const rate = rateOf(r);
              const best = (r.sent || 0) >= 10 && rate === bestRate && bestRate > 0;
              return [h('span', { class: 'mono small' }, r.template_key || '–'), r.variant || '–', fmtNum(r.sent), fmtNum(r.replied), h('span', null, `${Math.round(rate * 100)} %`, best ? h('span', { class: 'badge ok', style: 'margin-left:6px' }, 'beste') : null)];
            }),
            [false, false, true, true, true],
          )
          : h('p', { class: 'muted' }, 'Noch keine gesendeten Nachrichten.'),
        notice('info', '💡', 'Aussagekräftig wird der Vergleich ab ca. 20–30 Nachrichten pro Variante.'),
      ),
      h(
        'div',
        { class: 'grid grid-2' },
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Nach Sprache')),
          (s.byLanguage || []).length
            ? table(['Sprache', 'Kontaktiert', 'Antworten', 'Quote', 'Interessiert', 'Im Discord'], (s.byLanguage || []).map((r) => [langName(r.language), fmtNum(r.contacted), fmtNum(r.replied), fmtPct(r.replied, r.contacted), fmtNum(r.interested), fmtNum(r.joined)]), [false, true, true, true, true, true])
            : h('p', { class: 'muted' }, 'Noch keine Daten.'),
        ),
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Nach Kontaktweg')),
          (s.byChannel || []).length
            ? table(['Kontaktweg', 'Gesendet', 'Antworten', 'Quote'], (s.byChannel || []).map((r) => [CHANNEL_LABELS[r.channel] || r.channel || '–', fmtNum(r.sent), fmtNum(r.replied), fmtPct(r.replied, r.sent)]), [false, true, true, true])
            : h('p', { class: 'muted' }, 'Noch keine Daten.'),
        ),
      ),
      h(
        'div',
        { class: 'grid grid-2' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Gefunden nach Plattform')), bars((s.discovery?.byPlatform || []).map((r) => [PLATFORM_LABELS[r.platform] || r.platform, r.n]))),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Gefunden nach Sprache')), bars((s.discovery?.byLanguage || []).map((r) => [langName(r.language), r.n]))),
      ),
    ),
  );
}

/** Reply rate as fraction 0..1 (accepts fraction or percent from the API). */
function rateOf(r) {
  const raw = Number(r.rate);
  if (Number.isFinite(raw) && raw > 0) return raw > 1 ? raw / 100 : raw;
  return r.sent ? (r.replied || 0) / r.sent : 0;
}

function stat(num, label) {
  return h('div', { class: 'card' }, h('div', { class: 'stat' }, h('span', { class: 'num' }, num), h('span', { class: 'lbl' }, label)));
}

function table(head, rows, numeric = []) {
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'table compact' },
      h('thead', null, h('tr', null, head.map((c, i) => h('th', { class: numeric[i] ? 'num' : '' }, c)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: numeric[i] ? 'num' : '' }, c))))),
    ),
  );
}

function bars(rows) {
  if (!rows.length) return h('p', { class: 'muted' }, 'Noch keine Daten.');
  const max = Math.max(1, ...rows.map((r) => r[1] || 0));
  return h('div', { class: 'funnel' }, rows.sort((a, b) => b[1] - a[1]).map(([label, n]) => h('div', { class: 'frow' }, h('span', null, label), h('div', { class: 'track' }, h('div', { class: 'bar', style: `width:${barPct(n, max)}%` })), h('span', { class: 'right' }, fmtNum(n)))));
}

function dailyChart(daily) {
  const days = [...daily].sort((a, b) => String(a.day).localeCompare(String(b.day))).slice(-21);
  if (!days.length) return h('p', { class: 'muted' }, 'Noch keine Aktivität.');
  const W = 640;
  const H = 220;
  const padL = 30;
  const padB = 28;
  const series = [
    ['sent', 'Erstkontakte', 'var(--primary)'],
    ['followups', 'Nachgefasst', '#a78bfa'],
    ['replies', 'Antworten', 'var(--success)'],
  ];
  const max = Math.max(1, ...days.flatMap((d) => series.map(([k]) => Number(d[k]) || 0)));
  const groupW = (W - padL - 6) / days.length;
  const barW = Math.max(2, Math.min(14, (groupW - 4) / series.length));
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Aktivität pro Tag' });
  const plotH = H - padB - 10;
  for (const frac of [0, 0.5, 1]) {
    const y = 10 + plotH * (1 - frac);
    const showLabel = frac !== 0.5 || max >= 4;
    svg.append(mk('line', { x1: padL, y1: y, x2: W, y2: y, stroke: 'currentColor', 'stroke-opacity': '0.12' }));
    if (showLabel) svg.append(mk('text', { x: padL - 6, y: y + 4, 'font-size': '10', 'text-anchor': 'end', fill: 'currentColor', 'fill-opacity': '0.55' }, String(Math.round(max * frac))));
  }
  days.forEach((d, i) => {
    const x0 = padL + i * groupW + (groupW - barW * series.length) / 2;
    series.forEach(([k, label, color], j) => {
      const v = Number(d[k]) || 0;
      const bh = (v / max) * plotH;
      const rect = mk('rect', { x: (x0 + j * barW).toFixed(1), y: (10 + plotH - bh).toFixed(1), width: (barW - 1).toFixed(1), height: bh.toFixed(1), rx: 2, fill: color });
      rect.append(mk('title', {}, `${d.day}: ${v} ${label}`));
      svg.append(rect);
    });
    if (days.length <= 14 || i % 2 === 0) {
      const [, m, dd] = String(d.day).split('-');
      svg.append(mk('text', { x: (padL + i * groupW + groupW / 2).toFixed(1), y: H - 10, 'font-size': '10', 'text-anchor': 'middle', fill: 'currentColor', 'fill-opacity': '0.6' }, `${dd}.${m}.`));
    }
  });
  return h('div', { class: 'chart' }, svg, h('div', { class: 'legend' }, series.map(([, label, color]) => h('span', null, h('i', { style: `background:${color}` }), label))));
}

function barPct(v, max) {
  const n = Number(v) || 0;
  return n > 0 ? Math.max(1.5, (n / max) * 100) : 0;
}

function langName(code) {
  if (!code || code === '?' || code === 'unknown') return 'Unbekannt';
  return LANGUAGES[code] || code;
}
