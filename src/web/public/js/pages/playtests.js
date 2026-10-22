// Playtests, bugs and events (launch hour + weekly creator events).
import { get, post, patch, tryGet, ApiError } from '../api.js';
import { h, mount, loading, empty, errorBox, toast, modal, fmtNum, fmtDateTime, fmtLongDate, fmtRelative, select, field, notice, actionButton, extLink, setQuery } from '../ui.js';

const PT_STATUS = { geplant: 'Geplant', laeuft: 'Läuft', beendet: 'Beendet', abgesagt: 'Abgesagt' };
const PT_BADGE = { geplant: 'info', laeuft: 'ok', beendet: '', abgesagt: 'err' };
const BUG_STATUS = { neu: 'Neu', bestaetigt: 'Bestätigt', duplikat: 'Duplikat', kein_bug: 'Kein Bug', behoben: 'Behoben' };
const BUG_BADGE = { neu: 'info', bestaetigt: 'warn', duplikat: '', kein_bug: '', behoben: 'ok' };
const SIGNUP_STATUS = { angemeldet: 'Angemeldet', warteliste: 'Warteliste', abgemeldet: 'Abgemeldet', teilgenommen: 'Teilgenommen' };

export async function render(root, { parts, query }) {
  if (parts[0] === 'event' && parts[1]) return renderEvent(root, parts[1]);
  if (parts[0]) return renderPlaytest(root, parts[0]);
  let tab = query.get('tab') || 'playtests';
  let destroyed = false;
  const tabsEl = h('div', { class: 'tabs' });
  const content = h('div');
  mount(root, tabsEl, content);
  const status = await tryGet('/status');
  const botOnline = status?.bot?.state === 'ready';

  function renderTabs() {
    mount(tabsEl, [['playtests', '🧪 Playtests'], ['events', '🚀 Launch & Events'], ['bugs', '🐞 Bugs']].map(([k, l]) => h('button', { class: `tab ${tab === k ? 'active' : ''}`, onclick: () => { tab = k; setQuery({ tab: k === 'playtests' ? '' : k }); show(); } }, l)));
  }

  async function show() {
    renderTabs();
    mount(content, loading());
    try {
      if (tab === 'events') await showEvents();
      else if (tab === 'bugs') await showBugs();
      else await showPlaytests();
    } catch (err) {
      if (destroyed) return;
      mount(content, err instanceof ApiError && err.missing ? h('div', { class: 'card' }, empty('🛠️', 'Noch nicht verfügbar', err.message)) : errorBox(err, show));
    }
  }

  const offlineNote = !botOnline ? notice('warn', '🤖', 'Der Discord-Bot ist offline. Anlegen geht nur mit laufendem Bot (er postet den Termin im Discord). ', h('a', { href: '#/einrichtung' }, 'Zur Einrichtung')) : null;

  async function showPlaytests() {
    const res = await get('/playtests');
    if (destroyed) return;
    const items = res?.items || [];
    mount(
      content,
      h(
        'div',
        { class: 'stack' },
        offlineNote,
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Playtest-Termine'), h('button', { class: 'btn btn-primary', disabled: !botOnline, onclick: () => playtestDialog(show) }, '+ Playtest anlegen')),
          items.length
            ? h(
              'div',
              { class: 'table-wrap' },
              h(
                'table',
                { class: 'table' },
                h('thead', null, h('tr', null, h('th', null, 'Termin'), h('th', null, 'Titel'), h('th', null, 'Status'), h('th', { class: 'num' }, 'Angemeldet'), h('th', { class: 'num' }, 'Warteliste'), h('th', { class: 'num' }, 'Feedback'))),
                h(
                  'tbody',
                  null,
                  items.map((p) =>
                    h(
                      'tr',
                      { class: 'clickable', onclick: () => { location.hash = `#/playtests/${p.id}`; } },
                      h('td', { class: 'nowrap' }, fmtDateTime(p.starts_at), h('div', { class: 'help' }, fmtRelative(p.starts_at))),
                      h('td', null, h('strong', null, p.title), p.min_age >= 16 ? h('span', { class: 'badge warn', style: 'margin-left:6px' }, 'ab 16') : null),
                      h('td', null, h('span', { class: `badge ${PT_BADGE[p.status] || ''}` }, PT_STATUS[p.status] || p.status)),
                      h('td', { class: 'num' }, `${fmtNum(p.signups || 0)}${p.slots ? ` / ${p.slots}` : ''}`),
                      h('td', { class: 'num' }, fmtNum(p.waitlist || 0)),
                      h('td', { class: 'num' }, fmtNum(p.feedback || 0)),
                    ),
                  ),
                ),
              ),
            )
            : empty('🧪', 'Noch keine Playtests', 'Leg einen Termin an – der Bot postet ihn in #playtest-termine mit Anmelde-Button, erinnert die Tester und fragt danach Feedback ab.'),
        ),
        notice('info', '💡', h('div', null, h('strong', null, 'Tipp: '), 'Tester ab 16 zählen für die Roblox-Freischaltung für jüngere Spieler (Select). Belohne Tester mit exklusiven Ingame-Items, Titeln und Credits – Robux- oder Geldpreise für „die Besten“ verbieten die Roblox-Regeln.')),
      ),
    );
  }

  async function showEvents() {
    const res = await get('/events');
    if (destroyed) return;
    const items = res?.items || [];
    mount(
      content,
      h(
        'div',
        { class: 'stack' },
        offlineNote,
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Launch Hour & Creator-Events'), h('button', { class: 'btn btn-primary', disabled: !botOnline, onclick: () => eventDialog(show) }, '+ Event anlegen')),
          items.length
            ? h(
              'div',
              { class: 'table-wrap' },
              h(
                'table',
                { class: 'table' },
                h('thead', null, h('tr', null, h('th', null, 'Termin'), h('th', null, 'Titel'), h('th', null, 'Art'), h('th', null, 'Status'), h('th', { class: 'num' }, 'Spieler-Peak'))),
                h(
                  'tbody',
                  null,
                  items.map((e) =>
                    h(
                      'tr',
                      { class: 'clickable', onclick: () => { location.hash = `#/playtests/event/${e.id}`; } },
                      h('td', { class: 'nowrap' }, fmtDateTime(e.starts_at), h('div', { class: 'help' }, fmtRelative(e.starts_at))),
                      h('td', null, h('strong', null, e.title), e.repeat_weekly ? h('span', { class: 'badge info', style: 'margin-left:6px' }, 'wöchentlich') : null),
                      h('td', null, e.kind === 'launch' ? '🚀 Launch' : '🎉 Event'),
                      h('td', null, h('span', { class: `badge ${PT_BADGE[e.status] || ''}` }, PT_STATUS[e.status] || e.status)),
                      h('td', { class: 'num' }, e.ccu_peak ? fmtNum(e.ccu_peak) : '–'),
                    ),
                  ),
                ),
              ),
            )
            : empty('🚀', 'Noch keine Events', 'Leg die Launch Hour an (z. B. Samstag 19 Uhr). Der Bot erinnert alle Creator 24 h, 1 h und 10 min vorher, zeigt live die Spielerzahl und fasst danach zusammen, wer live war.'),
        ),
        notice('info', '📅', 'Roblox bewertet ein Spiel über 28 Tage. Plane nach dem Launch jede Woche zur gleichen Zeit ein Creator-Event (Option „wöchentlich“) – so kommen Spieler wieder.'),
      ),
    );
  }

  async function showBugs() {
    let bugFilter = query.get('bug') || '';
    const box = h('div');
    const load = async () => {
      mount(box, loading());
      const res = await get('/bugs', { status: bugFilter });
      if (destroyed) return;
      const items = res?.items || [];
      mount(
        box,
        items.length
          ? h(
            'div',
            { class: 'stack' },
            items.map((b) => {
              const sel = select(Object.entries(BUG_STATUS), b.status, {
                style: 'width:auto',
                onchange: async (e) => {
                  try {
                    await patch(`/bugs/${b.id}`, { status: e.target.value });
                    toast(`Bug #${b.id}: ${BUG_STATUS[e.target.value]}`, 'success');
                    load();
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              });
              return h(
                'div',
                { class: 'card flat' },
                h('div', { class: 'row between top' }, h('div', null, h('div', { class: 'row' }, h('strong', null, `#${b.id} ${b.title}`), h('span', { class: `badge ${BUG_BADGE[b.status] || ''}` }, BUG_STATUS[b.status] || b.status)), h('div', { class: 'help' }, [b.reporter || b.reporter_name || b.discord_tag || b.discord_user_id ? `von ${b.reporter || b.reporter_name || b.discord_tag || b.discord_user_id}` : null, fmtDateTime(b.created_at), b.device ? `Gerät: ${b.device}` : null].filter(Boolean).join(' · '))), sel),
                b.description ? h('p', { class: 'mt', style: 'white-space:pre-wrap' }, b.description) : null,
                b.steps ? h('div', { class: 'help', style: 'white-space:pre-wrap' }, h('strong', null, 'Schritte: '), b.steps) : null,
              );
            }),
          )
          : empty('🐞', 'Keine Bugs', bugFilter ? 'Mit diesem Status gibt es keine Meldungen.' : 'Tester melden Bugs im Discord mit /bug. Bestätigte Bugs geben Punkte.'),
      );
    };
    const filterSel = select([['', 'Alle'], ...Object.entries(BUG_STATUS)], bugFilter, { style: 'width:auto', onchange: (e) => { bugFilter = e.target.value; setQuery({ tab: 'bugs', bug: bugFilter }); load(); } });
    mount(content, h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Bug-Meldungen'), h('span', { class: 'row' }, h('span', { class: 'label' }, 'Status:'), filterSel)), box));
    await load();
  }

  await show();
  return () => {
    destroyed = true;
  };
}

// ---------------------------------------------------------------
function dateTimeInputs(defaultHour = '18:00') {
  const d = new Date(Date.now() + 2 * 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  const date = h('input', { type: 'date', value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` });
  const time = h('input', { type: 'time', value: defaultHour });
  return { date, time };
}

function playtestDialog(onDone) {
  const title = h('input', { type: 'text', value: 'Playtest', placeholder: 'z. B. Playtest #3 – neue Waffen' });
  const { date, time } = dateTimeInputs('18:00');
  const duration = h('input', { type: 'number', min: 15, max: 600, value: 60 });
  const slots = h('input', { type: 'number', min: 1, placeholder: 'leer = unbegrenzt' });
  const link = h('input', { type: 'url', placeholder: 'Roblox-Link (privater Server oder Test-Place)' });
  const desc = h('textarea', { placeholder: 'Was wird getestet? Worauf sollen die Tester achten?' });
  const minAge = select([['13', 'ab 13'], ['16', 'ab 16 (zählt für Select-Freischaltung)']], '13');
  const save = actionButton('Anlegen & im Discord posten', async () => {
    if (!title.value.trim() || !date.value || !time.value) {
      toast('Titel, Datum und Uhrzeit sind Pflicht.', 'error');
      return;
    }
    const res = await post('/playtests', { title: title.value.trim(), date: date.value, time: time.value, duration_min: Number(duration.value) || 60, slots: slots.value ? Number(slots.value) : undefined, join_link: link.value.trim() || undefined, description: desc.value.trim() || undefined, min_age: Number(minAge.value) });
    m.close();
    toast('Playtest angelegt – der Bot hat ihn gepostet.', 'success');
    if (res?.playtest?.id) location.hash = `#/playtests/${res.playtest.id}`;
    else onDone?.();
  }, { cls: 'btn btn-primary' });
  const m = modal({
    title: 'Playtest anlegen',
    body: h(
      'div',
      { class: 'form-grid' },
      field('Titel', title, null, 'wide'),
      field('Datum', date),
      field('Uhrzeit (deutsche Zeit)', time),
      field('Dauer (Minuten)', duration),
      field('Plätze', slots, 'Bei vollen Plätzen kommt man auf die Warteliste.'),
      field('Mindestalter', minAge),
      field('Spiel-Link', link, 'Wird erst zum Start per DM an die Angemeldeten geschickt.', 'wide'),
      field('Beschreibung', desc, null, 'wide'),
    ),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'), save],
  });
}

function eventDialog(onDone) {
  const title = h('input', { type: 'text', value: 'Launch Hour', placeholder: 'z. B. Launch Hour' });
  const kind = select([['launch', '🚀 Launch Hour'], ['event', '🎉 Creator-Event']], 'launch');
  const { date, time } = dateTimeInputs('19:00');
  const duration = h('input', { type: 'number', min: 15, max: 600, value: 60 });
  const weekly = h('input', { type: 'checkbox' });
  const link = h('input', { type: 'url', placeholder: 'https://www.roblox.com/games/…' });
  const desc = h('textarea', { placeholder: 'Ablauf, Hinweise für die Creator (Titel-Vorlage, Code, Kennzeichnung „Werbung“) …' });
  kind.addEventListener('change', () => {
    if (kind.value === 'event' && title.value === 'Launch Hour') title.value = 'Creator-Event';
    if (kind.value === 'event') weekly.checked = true;
  });
  const save = actionButton('Anlegen & ankündigen', async () => {
    if (!title.value.trim() || !date.value || !time.value) {
      toast('Titel, Datum und Uhrzeit sind Pflicht.', 'error');
      return;
    }
    const res = await post('/events', { title: title.value.trim(), kind: kind.value, date: date.value, time: time.value, duration_min: Number(duration.value) || 60, repeat_weekly: weekly.checked, game_link: link.value.trim() || undefined, description: desc.value.trim() || undefined });
    m.close();
    toast('Event angelegt – der Bot kündigt es im Discord an.', 'success');
    if (res?.event?.id) location.hash = `#/playtests/event/${res.event.id}`;
    else onDone?.();
  }, { cls: 'btn btn-primary' });
  const m = modal({
    title: 'Launch Hour / Creator-Event anlegen',
    body: h(
      'div',
      { class: 'form-grid' },
      field('Titel', title),
      field('Art', kind),
      field('Datum', date),
      field('Uhrzeit (deutsche Zeit)', time, 'Tipp: Samstag 19:00 = 13:00 in New York.'),
      field('Dauer (Minuten)', duration),
      h('div', { class: 'field' }, h('label', null, 'Wiederholen'), h('label', { class: 'check' }, weekly, 'jede Woche zur gleichen Zeit')),
      field('Spiel-Link', link, null, 'wide'),
      field('Beschreibung', desc, null, 'wide'),
    ),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'), save],
  });
}

// ---------------------------------------------------------------
async function renderPlaytest(root, id) {
  mount(root, loading());
  let d;
  try {
    d = await get(`/playtests/${id}`);
  } catch (err) {
    mount(root, errorBox(err, () => renderPlaytest(root, id)));
    return;
  }
  const p = d.playtest || {};
  const signups = d.signups || [];
  const feedback = d.feedback || [];
  const ratings = feedback.map((f) => Number(f.fun_rating)).filter((n) => Number.isFinite(n) && n > 0);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;
  const counts = signups.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] || 0) + 1 }), {});
  mount(
    root,
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'card' },
        h('a', { href: '#/playtests', class: 'small' }, '← Alle Playtests'),
        h('div', { class: 'row between mt' }, h('h2', { style: 'margin:0' }, p.title || 'Playtest'), h('span', { class: `badge ${PT_BADGE[p.status] || ''}` }, PT_STATUS[p.status] || p.status)),
        h('div', { class: 'muted' }, `${fmtLongDate(p.starts_at)} Uhr · ${p.duration_min || 60} Min.${p.slots ? ` · ${p.slots} Plätze` : ''}${p.min_age >= 16 ? ' · ab 16' : ''}`),
        p.description ? h('p', { class: 'mt', style: 'white-space:pre-wrap' }, p.description) : null,
        p.join_link ? h('div', { class: 'help' }, 'Spiel-Link: ', extLink(p.join_link, p.join_link)) : null,
      ),
      h('div', { class: 'grid grid-4' }, statBox(fmtNum(counts.angemeldet || 0), 'angemeldet'), statBox(fmtNum(counts.warteliste || 0), 'Warteliste'), statBox(fmtNum(counts.teilgenommen || 0), 'teilgenommen'), statBox(avg ? `${avg} / 10` : '–', `Spaß-Bewertung (${ratings.length})`)),
      h(
        'div',
        { class: 'grid grid-2' },
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', null, '👥 Anmeldungen')),
          signups.length
            ? h('ul', { class: 'list' }, signups.map((s) => h('li', null, h('span', { class: 'grow' }, s.name || s.discord_tag || s.discord_user_id), h('span', { class: 'badge' }, SIGNUP_STATUS[s.status] || s.status), h('span', { class: 'help nowrap' }, fmtRelative(s.created_at)))))
            : h('p', { class: 'muted' }, 'Noch keine Anmeldungen.'),
        ),
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', null, '💬 Feedback'), feedback.length ? h('a', { class: 'btn btn-sm', href: `/api/playtests/${id}/feedback.csv`, download: `feedback-playtest-${id}.csv` }, '⬇ CSV') : null),
          feedback.length
            ? h(
              'div',
              { class: 'stack' },
              feedback.map((f) =>
                h(
                  'div',
                  { class: 'card flat' },
                  h('div', { class: 'row between' }, h('strong', null, f.name || f.discord_tag || f.discord_user_id), f.fun_rating ? h('span', { class: 'rating' }, `${f.fun_rating}/10`) : null),
                  fbLine('👍 Gut', f.liked),
                  fbLine('👎 Nervt/verwirrt', f.disliked),
                  fbLine('🐞 Bugs', f.bugs),
                  fbLine('💡 Sonstiges', f.other),
                ),
              ),
            )
            : h('p', { class: 'muted' }, 'Feedback kommt nach dem Playtest – der Bot schickt allen Angemeldeten einen Feedback-Button.'),
        ),
      ),
    ),
  );
}

function fbLine(label, text) {
  if (!text) return null;
  return h('div', { class: 'mt small', style: 'white-space:pre-wrap' }, h('strong', null, `${label}: `), text);
}

function statBox(num, label) {
  return h('div', { class: 'card' }, h('div', { class: 'stat' }, h('span', { class: 'num' }, num), h('span', { class: 'lbl' }, label)));
}

async function renderEvent(root, id) {
  mount(root, loading());
  let d;
  try {
    d = await get(`/events/${id}`);
  } catch (err) {
    mount(root, errorBox(err, () => renderEvent(root, id)));
    return;
  }
  const e = d.event || {};
  const ccu = (d.ccu || []).map((s) => ({ at: new Date(s.at).getTime(), playing: Number(s.playing) || 0 })).filter((s) => Number.isFinite(s.at));
  const live = d.live || [];
  mount(
    root,
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'card' },
        h('a', { href: '#/playtests?tab=events', class: 'small' }, '← Alle Events'),
        h('div', { class: 'row between mt' }, h('h2', { style: 'margin:0' }, `${e.kind === 'launch' ? '🚀' : '🎉'} ${e.title || 'Event'}`), h('span', { class: `badge ${PT_BADGE[e.status] || ''}` }, PT_STATUS[e.status] || e.status)),
        h('div', { class: 'muted' }, `${fmtLongDate(e.starts_at)} Uhr · ${e.duration_min || 60} Min.${e.repeat_weekly ? ' · wöchentlich' : ''}`),
        e.description ? h('p', { class: 'mt', style: 'white-space:pre-wrap' }, e.description) : null,
        e.game_link ? h('div', { class: 'help' }, 'Spiel: ', extLink(e.game_link, e.game_link)) : null,
      ),
      h('div', { class: 'grid grid-3' }, statBox(e.ccu_peak ? fmtNum(e.ccu_peak) : '–', 'Spieler-Peak'), statBox(fmtNum(live.length), 'Creator live'), statBox(fmtNum(ccu.length), 'Messpunkte')),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, '📈 Spieler gleichzeitig')), ccu.length > 1 ? ccuChart(ccu) : h('p', { class: 'muted' }, 'Die Spielerzahl wird während des Events jede Minute gemessen (dafür das Roblox-Spiel unter Einstellungen verknüpfen).')),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', null, '🔴 Wer war live')),
        live.length
          ? h('ul', { class: 'list' }, live.map((l) => h('li', null, h('span', { class: 'grow' }, h('strong', null, l.name || l.display_name || l.discord_user_id || 'Creator'), l.title ? h('div', { class: 'help' }, l.title) : null), l.url ? extLink(l.url, 'Stream') : null, h('span', { class: 'help nowrap' }, fmtDateTime(l.started_at)))))
          : h('p', { class: 'muted' }, 'Noch keine Live-Meldungen (Creator nutzen /live, Twitch wird automatisch erkannt).'),
      ),
    ),
  );
}

function ccuChart(points) {
  const W = 720;
  const H = 200;
  const pad = 28;
  const minT = points[0].at;
  const maxT = points[points.length - 1].at;
  const maxV = Math.max(1, ...points.map((p) => p.playing));
  const x = (t) => pad + ((t - minT) / Math.max(1, maxT - minT)) * (W - pad * 2);
  const y = (v) => H - pad - (v / maxV) * (H - pad * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.playing).toFixed(1)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Spielerzahl im Verlauf');
  const mk = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  svg.append(
    mk('line', { x1: pad, y1: H - pad, x2: W - pad, y2: H - pad, stroke: 'currentColor', 'stroke-opacity': '0.2' }),
    mk('path', { d: `${path} L${x(maxT).toFixed(1)},${H - pad} L${x(minT).toFixed(1)},${H - pad} Z`, fill: 'var(--primary)', 'fill-opacity': '0.15' }),
    mk('path', { d: path, fill: 'none', stroke: 'var(--primary)', 'stroke-width': '2.5' }),
  );
  const label = (text, xx, yy, anchor = 'start') => {
    const t = mk('text', { x: xx, y: yy, 'font-size': '11', fill: 'currentColor', 'fill-opacity': '0.6', 'text-anchor': anchor });
    t.textContent = text;
    return t;
  };
  const fmtT = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  svg.append(label(fmtT(minT), pad, H - 8), label(fmtT(maxT), W - pad, H - 8, 'end'), label(`Peak ${fmtNum(maxV)}`, pad, 14));
  return h('div', { class: 'chart' }, svg);
}
