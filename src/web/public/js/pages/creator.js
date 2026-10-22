// Creator list (filters, bulk actions) and detail view.
import { get, post, patch, del, ApiError } from '../api.js';
import {
  h, mount, loading, empty, errorBox, toast, toastError, modal, confirmDialog, promptDialog, debounce,
  fmtNum, fmtCompact, fmtRelative, fmtDateTime, fmtDate, statusBadge, platformBadge, channelDot, channelLabel,
  scoreBadge, langLabel, select, field, extLink, setQuery, asArray, notice, actionButton,
  STATUS_ORDER, STATUS_SIDE, STATUS_LABELS, PLATFORM_LABELS, LANGUAGES, AGE_GROUPS, CHANNEL_LABELS,
  SENTIMENT_LABELS, ACTIVITY_LABELS, splitList, truncate,
} from '../ui.js';
import { setTitle } from '../app.js';

const PAGE_SIZE = 50;
const SORTS = [
  ['score', 'Passt-Wert'],
  ['followers', 'Follower'],
  ['last_active', 'Zuletzt aktiv'],
  ['updated', 'Zuletzt geändert'],
  ['created', 'Neu hinzugefügt'],
  ['name', 'Name'],
];
const ALL_STATUS = [...STATUS_ORDER, ...STATUS_SIDE];
const PLATFORMS = ['youtube', 'twitch', 'tiktok', 'instagram', 'x', 'kick'];

export async function render(root, ctx) {
  if (ctx.parts[0]) return renderDetail(root, ctx.parts[0]);
  return renderList(root, ctx);
}

// ======================================================================
// List
// ======================================================================
async function renderList(root, { query }) {
  const state = {
    status: query.get('status') || '',
    platform: query.get('platform') || '',
    language: query.get('language') || '',
    channel: query.get('channel') || '',
    minScore: query.get('minScore') || '',
    member: query.get('member') || '',
    q: query.get('q') || '',
    sort: query.get('sort') || 'score',
    dir: query.get('dir') || 'desc',
    offset: Number(query.get('offset') || 0),
    selected: new Set(),
    items: [],
    total: 0,
  };
  let destroyed = false;
  let reqId = 0;

  const filtersEl = h('div', { class: 'card' });
  const bulkEl = h('div');
  const tableEl = h('div');
  mount(root, h('div', { class: 'stack' }, filtersEl, h('div', null, bulkEl, tableEl)));

  function qParams() {
    return {
      status: state.status,
      platform: state.platform,
      language: state.language,
      channel: state.channel,
      minScore: state.minScore,
      member: state.member,
      q: state.q,
      sort: state.sort,
      dir: state.dir,
    };
  }

  function exportUrl() {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(qParams())) if (v) qs.set(k, v);
    return `/api/export/creators.csv${qs.toString() ? '?' + qs : ''}`;
  }

  function renderFilters() {
    const statusSel = select([['', 'Alle Status'], ...ALL_STATUS.map((s) => [s, STATUS_LABELS[s]]), ['kontaktiert,nachgefasst', 'Warten auf Antwort']], state.status, { onchange: (e) => update({ status: e.target.value }) });
    const platSel = select([['', 'Alle Plattformen'], ...PLATFORMS.map((p) => [p, PLATFORM_LABELS[p]])], state.platform, { onchange: (e) => update({ platform: e.target.value }) });
    const langSel = select([['', 'Alle Sprachen'], ...Object.entries(LANGUAGES)], state.language, { onchange: (e) => update({ language: e.target.value }) });
    const chanSel = select([['', 'Alle'], ...Object.entries(CHANNEL_LABELS)], state.channel, { onchange: (e) => update({ channel: e.target.value }) });
    const minScore = h('input', { type: 'number', min: 0, max: 100, value: state.minScore, placeholder: '0', onchange: (e) => update({ minScore: e.target.value }) });
    const search = h('input', { type: 'search', value: state.q, placeholder: 'Name, Handle oder E-Mail …' });
    search.addEventListener('input', debounce(() => update({ q: search.value.trim() }), 350));
    const sortSel = select(SORTS, state.sort, { onchange: (e) => update({ sort: e.target.value }) });
    const dirBtn = h('button', { class: 'btn', title: 'Reihenfolge umkehren', onclick: () => update({ dir: state.dir === 'desc' ? 'asc' : 'desc' }) }, state.dir === 'desc' ? '↓ absteigend' : '↑ aufsteigend');
    const memberChk = h('input', { type: 'checkbox', checked: state.member === '1', onchange: (e) => update({ member: e.target.checked ? '1' : '' }) });
    mount(
      filtersEl,
      h(
        'div',
        { class: 'filters' },
        field('Suche', search, null, 'grow'),
        field('Status', statusSel),
        field('Plattform', platSel),
        field('Sprache', langSel),
        field('Kontaktweg', chanSel),
        field('Mind. Passt-Wert', minScore),
        field('Sortierung', h('div', { class: 'inline-input' }, sortSel, dirBtn), null, 'sortfield'),
        h('label', { class: 'check', style: 'padding-bottom:8px' }, memberChk, 'Nur Programm-Mitglieder'),
      ),
      h(
        'div',
        { class: 'row mt' },
        h('button', { class: 'btn btn-primary', onclick: () => openCreateDialog(load) }, '+ Creator anlegen'),
        h('a', { class: 'btn', href: exportUrl(), download: 'creator.csv' }, '⬇ Als CSV exportieren'),
        h('a', { class: 'btn btn-ghost', href: '#/finden' }, '🔎 Neue Creator finden'),
        h('span', { class: 'spacer' }),
        anyFilter() ? h('button', { class: 'btn btn-ghost', onclick: resetFilters }, 'Filter zurücksetzen') : null,
      ),
    );
  }

  function anyFilter() {
    return state.status || state.platform || state.language || state.channel || state.minScore || state.member || state.q;
  }

  function resetFilters() {
    Object.assign(state, { status: '', platform: '', language: '', channel: '', minScore: '', member: '', q: '', offset: 0 });
    renderFilters();
    load();
  }

  function update(patchObj) {
    Object.assign(state, patchObj, { offset: 0 });
    state.selected.clear();
    renderFilters();
    load();
  }

  async function load() {
    const id = ++reqId;
    setQuery({ ...qParams(), sort: state.sort === 'score' ? '' : state.sort, dir: state.dir === 'desc' ? '' : state.dir, offset: state.offset || '' });
    mount(tableEl, loading());
    try {
      const res = await get('/creators', { ...qParams(), limit: PAGE_SIZE, offset: state.offset });
      if (destroyed || id !== reqId) return;
      state.items = res.items || [];
      state.total = res.total || 0;
      renderTable();
    } catch (err) {
      if (destroyed || id !== reqId) return;
      mount(tableEl, err instanceof ApiError && err.missing ? empty('🛠️', 'Creator-Liste noch nicht verfügbar', err.message) : errorBox(err, load));
    }
  }

  function renderBulk() {
    if (!state.selected.size) {
      mount(bulkEl);
      return;
    }
    const ids = [...state.selected];
    const run = (action, value, label) => actionButton(label, async () => {
      if (action === 'delete' && !(await confirmDialog({ title: `${ids.length} Creator löschen?`, text: 'Die Einträge werden endgültig gelöscht.', confirmText: 'Löschen', danger: true }))) return;
      const res = await post('/creators/bulk', { ids, action, value });
      toast(`${fmtNum(res?.changed ?? ids.length)} Creator geändert.`, 'success');
      state.selected.clear();
      load();
      renderBulk();
    }, { cls: action === 'delete' ? 'btn btn-sm btn-danger' : 'btn btn-sm' });
    const statusSel = select([['', 'Status setzen …'], ...ALL_STATUS.map((s) => [s, STATUS_LABELS[s]])], '', {
      class: 'btn-sm',
      style: 'width:auto',
      onchange: async (e) => {
        const value = e.target.value;
        if (!value) return;
        try {
          const res = await post('/creators/bulk', { ids, action: 'status', value });
          toast(`${fmtNum(res?.changed ?? ids.length)} Creator auf „${STATUS_LABELS[value]}“ gesetzt.`, 'success');
          state.selected.clear();
          load();
          renderBulk();
        } catch (err) {
          toastError(err);
        }
      },
    });
    mount(
      bulkEl,
      h(
        'div',
        { class: 'bulkbar' },
        h('strong', null, `${ids.length} ausgewählt`),
        run('qualify', null, '✓ Qualifizieren'),
        run('reject', null, '👎 Ungeeignet'),
        run('snooze', null, '⏭ Später'),
        actionButton('🏷 Tag hinzufügen', async () => {
          const tag = await promptDialog({ title: 'Tag hinzufügen', label: 'Tag (z. B. „Welle 1“)' });
          if (!tag?.trim()) return;
          const res = await post('/creators/bulk', { ids, action: 'tag', value: tag.trim() });
          toast(`Tag bei ${fmtNum(res?.changed ?? ids.length)} Creator gesetzt.`, 'success');
          load();
        }, { cls: 'btn btn-sm' }),
        actionButton('Tag entfernen', async () => {
          const tag = await promptDialog({ title: 'Tag entfernen', label: 'Welcher Tag?' });
          if (!tag?.trim()) return;
          await post('/creators/bulk', { ids, action: 'untag', value: tag.trim() });
          load();
        }, { cls: 'btn btn-sm' }),
        statusSel,
        run('delete', null, '🗑 Löschen'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { state.selected.clear(); renderTable(); renderBulk(); } }, 'Auswahl aufheben'),
      ),
    );
  }

  function renderTable() {
    renderBulk();
    if (!state.items.length) {
      mount(
        tableEl,
        h(
          'div',
          { class: 'card' },
          anyFilter()
            ? empty('🔍', 'Keine Treffer', 'Für diese Filter gibt es keine Creator.', h('button', { class: 'btn', onclick: resetFilters }, 'Filter zurücksetzen'))
            : empty('👥', 'Noch keine Creator', 'Starte eine YouTube- oder Twitch-Suche oder importiere Profil-Links.', h('a', { class: 'btn btn-primary', href: '#/finden' }, '🔎 Creator finden')),
        ),
      );
      return;
    }
    const allChecked = state.items.every((c) => state.selected.has(c.id));
    const headChk = h('input', {
      type: 'checkbox',
      checked: allChecked,
      'aria-label': 'Alle auswählen',
      onchange: (e) => {
        for (const c of state.items) e.target.checked ? state.selected.add(c.id) : state.selected.delete(c.id);
        renderTable();
      },
    });
    const rows = state.items.map((c) => {
      const chk = h('input', {
        type: 'checkbox',
        checked: state.selected.has(c.id),
        'aria-label': `${c.display_name} auswählen`,
        onclick: (e) => e.stopPropagation(),
        onchange: (e) => {
          e.target.checked ? state.selected.add(c.id) : state.selected.delete(c.id);
          tr.classList.toggle('selected', e.target.checked);
          renderBulk();
        },
      });
      const plats = asArray(c.platforms);
      const tr = h(
        'tr',
        { class: `clickable ${state.selected.has(c.id) ? 'selected' : ''}`, onclick: () => { location.hash = `#/creator/${c.id}`; } },
        h('td', { style: 'width:34px' }, chk),
        h(
          'td',
          null,
          h(
            'div',
            { class: 'name-cell' },
            h('strong', null, c.display_name || 'Unbekannt'),
            h('div', { class: 'platforms' }, plats.map((p) => platformBadge(p.platform)), c.is_member ? h('span', { class: 'badge ok' }, 'Mitglied') : null, asArray(c.tags).slice(0, 3).map((t) => h('span', { class: 'chip' }, t))),
          ),
        ),
        h('td', null, statusBadge(c.status)),
        h('td', { class: 'num' }, scoreBadge(c.score)),
        h('td', { class: 'num' }, fmtCompact(c.followers)),
        h('td', null, langLabel(c.language)),
        h('td', null, h('div', { class: 'row', style: 'flex-wrap:nowrap' }, channelDot(c.contact_channel), h('span', { class: 'small' }, channelLabel(c.contact_channel, c.contact_platform)))),
        h('td', { class: 'small muted nowrap' }, c.last_active_at ? fmtRelative(c.last_active_at) : '–'),
        h('td', { class: 'small muted nowrap' }, c.contacted_at ? fmtDate(c.contacted_at) : '–'),
      );
      return tr;
    });
    const sortTh = (key, label, cls = '') => h('th', { class: `sortable ${cls}`, onclick: () => update({ sort: key, dir: state.sort === key && state.dir === 'desc' ? 'asc' : 'desc' }) }, label, state.sort === key ? (state.dir === 'desc' ? ' ↓' : ' ↑') : '');
    const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    const page = Math.floor(state.offset / PAGE_SIZE) + 1;
    mount(
      tableEl,
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, headChk), sortTh('name', 'Creator'), h('th', null, 'Status'), sortTh('score', 'Passt', 'num'), sortTh('followers', 'Follower', 'num'), h('th', null, 'Sprache'), h('th', null, 'Kontaktweg'), sortTh('last_active', 'Aktiv'), h('th', null, 'Kontaktiert'))),
          h('tbody', null, rows),
        ),
      ),
      h(
        'div',
        { class: 'pager' },
        h('span', { class: 'muted small' }, `${fmtNum(state.total)} Creator · Seite ${page} von ${pages}`),
        h('button', { class: 'btn btn-sm', disabled: state.offset <= 0, onclick: () => { state.offset = Math.max(0, state.offset - PAGE_SIZE); load(); } }, '← Zurück'),
        h('button', { class: 'btn btn-sm', disabled: state.offset + PAGE_SIZE >= state.total, onclick: () => { state.offset += PAGE_SIZE; load(); } }, 'Weiter →'),
      ),
    );
  }

  renderFilters();
  await load();
  return () => {
    destroyed = true;
  };
}

function openCreateDialog(onDone) {
  const name = h('input', { type: 'text', placeholder: 'z. B. Lukas Plays' });
  const plat = select([['', '– Plattform –'], ...PLATFORMS.map((p) => [p, PLATFORM_LABELS[p]])], '');
  const url = h('input', { type: 'url', placeholder: 'https://www.tiktok.com/@…' });
  const email = h('input', { type: 'email', placeholder: 'business@…' });
  const followers = h('input', { type: 'text', placeholder: 'z. B. 12,3K' });
  const lang = select([['', 'automatisch'], ...Object.entries(LANGUAGES)], '');
  const notes = h('textarea', { placeholder: 'Notizen (optional)' });
  const save = actionButton('Anlegen', async () => {
    if (!name.value.trim() && !url.value.trim()) {
      toast('Bitte mindestens Name oder Profil-Link angeben.', 'error');
      return;
    }
    const res = await post('/creators', {
      display_name: name.value.trim() || undefined,
      platform: plat.value || undefined,
      url: url.value.trim() || undefined,
      email: email.value.trim() || undefined,
      followers: followers.value.trim() || undefined,
      language: lang.value || undefined,
      notes: notes.value.trim() || undefined,
    });
    m.close();
    toast('Creator angelegt.', 'success');
    if (res?.id) location.hash = `#/creator/${res.id}`;
    else onDone?.();
  }, { cls: 'btn btn-primary' });
  const m = modal({
    title: 'Creator manuell anlegen',
    body: h(
      'div',
      { class: 'form-grid' },
      field('Name', name),
      field('Plattform', plat),
      field('Profil-Link', url, 'Plattform wird aus dem Link erkannt.', 'wide'),
      field('E-Mail (öffentlich angegeben)', email),
      field('Follower', followers),
      field('Sprache', lang),
      field('Notizen', notes, null, 'wide'),
    ),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'), save],
  });
  name.focus();
}

// ======================================================================
// Detail
// ======================================================================
async function renderDetail(root, id) {
  let destroyed = false;
  async function load() {
    mount(root, loading());
    let d;
    try {
      d = await get(`/creators/${id}`);
    } catch (err) {
      if (destroyed) return;
      if (err.status === 404 && !err.missing) {
        mount(root, h('div', { class: 'card' }, empty('🤷', 'Creator nicht gefunden', 'Vielleicht wurde der Eintrag gelöscht oder hat sich abgemeldet.', h('a', { class: 'btn', href: '#/creator' }, '← Zur Liste'))));
      } else mount(root, errorBox(err, load));
      return;
    }
    if (destroyed) return;
    draw(d);
  }

  function draw(d) {
    const c = d.creator || {};
    const o = d.outreach || {};
    setTitle(c.display_name || 'Creator');
    const reload = () => load();

    // ---- header & actions ----
    const statusSel = select(ALL_STATUS.map((s) => [s, STATUS_LABELS[s]]), o.status || 'neu');
    const header = h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'row between top' },
        h(
          'div',
          null,
          h('a', { href: '#/creator', class: 'small' }, '← Alle Creator'),
          h('h2', { style: 'font-size:1.4rem;margin-top:6px' }, c.display_name || 'Unbekannt'),
          h('div', { class: 'row' }, statusBadge(o.status), scoreBadge(c.score), h('span', { class: 'badge' }, langLabel(c.language)), c.is_member ? h('span', { class: 'badge ok' }, c.founding ? '⭐ Founding Creator' : 'Programm-Mitglied') : null, c.age_group && c.age_group !== 'unbekannt' ? h('span', { class: 'badge warn' }, `Alter: ${AGE_GROUPS[c.age_group] || c.age_group}`) : null),
        ),
        h(
          'div',
          { class: 'btn-group' },
          actionButton('↻ Neu bewerten', async () => { await post(`/creators/${id}/rescore`); toast('Neu bewertet.', 'success'); reload(); }, { cls: 'btn btn-sm' }),
          actionButton('⟳ Daten aktualisieren', async () => { await post(`/creators/${id}/refresh`); toast('Daten aktualisiert.', 'success'); reload(); }, { cls: 'btn btn-sm', title: 'Lädt Follower & Co. neu (YouTube/Twitch)' }),
          actionButton('🚫 Abmelden', async () => {
            const ok = await confirmDialog({
              title: 'Creator abmelden?',
              text: 'Für „Bitte nicht mehr kontaktieren“-Wünsche: Alle Daten zu dieser Person werden gelöscht. Es bleibt nur ein anonymer Sperr-Eintrag, damit sie nicht erneut gefunden und angeschrieben wird.',
              confirmText: 'Abmelden & löschen',
              danger: true,
            });
            if (!ok) return;
            await post(`/creators/${id}/optout`);
            toast('Abgemeldet und gelöscht.', 'success');
            location.hash = '#/creator';
          }, { cls: 'btn btn-sm btn-danger' }),
          actionButton('🗑 Löschen', async () => {
            if (!(await confirmDialog({ title: 'Eintrag löschen?', text: 'Der Creator wird gelöscht (ohne Sperre – kann später wieder gefunden werden).', confirmText: 'Löschen', danger: true }))) return;
            await del(`/creators/${id}`);
            toast('Gelöscht.', 'success');
            location.hash = '#/creator';
          }, { cls: 'btn btn-sm btn-ghost' }),
        ),
      ),
      h(
        'div',
        { class: 'row mt' },
        h('span', { class: 'label' }, 'Antwort erfassen:'),
        Object.entries(SENTIMENT_LABELS).map(([s, label]) =>
          actionButton(label, async () => {
            await post(`/creators/${id}/reply`, { sentiment: s });
            toast(`Antwort erfasst: ${label}`, 'success');
            reload();
          }, { cls: `btn btn-sm ${s === 'interessiert' ? 'btn-success' : ''}` }),
        ),
        h('span', { class: 'spacer' }),
        h('span', { class: 'label' }, 'Status:'),
        h('span', { style: 'width:180px' }, statusSel),
        actionButton('Setzen', async () => {
          await post(`/creators/${id}/status`, { status: statusSel.value });
          toast(`Status: ${STATUS_LABELS[statusSel.value]}`, 'success');
          reload();
        }, { cls: 'btn btn-sm' }),
      ),
    );

    // ---- profile ----
    const nameIn = h('input', { type: 'text', value: c.display_name || '' });
    const langSel = select([['', 'Unbekannt'], ...Object.entries(LANGUAGES)], c.language || '');
    const ageSel = select(Object.entries(AGE_GROUPS), c.age_group || 'unbekannt');
    const tags = asArray(c.tags);
    const tagsIn = h('input', { type: 'text', value: tags.join(', '), placeholder: 'z. B. Welle 1, Shooter' });
    const codeIn = h('input', { type: 'text', value: c.creator_code || '', placeholder: 'z. B. LUKAS' });
    const shareIn = h('input', { type: 'url', value: c.share_link || '', placeholder: 'https://www.roblox.com/share?code=…' });
    const discordIn = h('input', { type: 'text', value: c.discord_user_id || '', placeholder: 'Discord-Nutzer-ID' });
    const paidChk = h('input', { type: 'checkbox', checked: Boolean(c.paid_ok) });
    const parentChk = h('input', { type: 'checkbox', checked: Boolean(c.parent_consent) });
    const notesIn = h('textarea', { value: c.notes || '', placeholder: 'Notizen zu diesem Creator' });
    const minor = c.age_group && !['18+', 'unbekannt'].includes(c.age_group);
    const profile = h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, '👤 Profil')),
      h(
        'div',
        { class: 'form-grid' },
        field('Name', nameIn),
        field('Sprache', langSel),
        field('Altersgruppe', ageSel, 'Unter 16: nur mit Eltern-OK. Bezahlte Deals nur ab 18.'),
        field('Tags', tagsIn, 'Mit Komma trennen'),
        field('Creator-Code', codeIn, 'Code für Zuschauer (exklusives Item, nicht kaufbar)'),
        field('Roblox Share Link', shareIn, 'Im Creator Hub pro Creator anlegen – zeigt, wie viele Spieler er bringt.'),
        field('Discord-Nutzer-ID', discordIn),
        h('div', { class: 'field' }, h('label', { class: 'check' }, paidChk, 'Bezahlte Deals erlaubt'), h('div', { class: 'help' }, minor ? '⚠️ Minderjährig – bitte keine bezahlten Deals.' : 'Nur mit schriftlicher Vereinbarung, ab 18.'), h('label', { class: 'check mt' }, parentChk, 'Eltern-Einverständnis liegt vor')),
        field('Notizen', notesIn, null, 'wide'),
      ),
      h(
        'div',
        { class: 'row mt' },
        actionButton('Speichern', async () => {
          if (paidChk.checked && minor) {
            const ok = await confirmDialog({ title: 'Wirklich bezahlte Deals?', text: 'Laut Altersgruppe ist die Person minderjährig. Bezahlte Arbeit von Minderjährigen ist in Deutschland stark eingeschränkt (Jugendarbeitsschutz, Eltern-Zustimmung). Trotzdem speichern?', confirmText: 'Trotzdem speichern', danger: true });
            if (!ok) return;
          }
          await patch(`/creators/${id}`, {
            display_name: nameIn.value.trim() || c.display_name,
            language: langSel.value || null,
            age_group: ageSel.value,
            tags: splitList(tagsIn.value),
            creator_code: codeIn.value.trim() || null,
            share_link: shareIn.value.trim() || null,
            discord_user_id: discordIn.value.trim() || null,
            paid_ok: paidChk.checked,
            parent_consent: parentChk.checked,
            notes: notesIn.value,
          });
          toast('Gespeichert.', 'success');
          reload();
        }, { cls: 'btn btn-primary' }),
      ),
    );

    // ---- contact path ----
    const chSel = select([['', 'Automatisch bestimmen'], ...Object.entries(CHANNEL_LABELS)], c.contact_locked ? c.contact_channel || '' : '');
    const targetIn = h('input', { type: 'text', value: c.contact_locked ? c.contact_target || '' : '', placeholder: 'E-Mail-Adresse oder Profil-/Einladungslink' });
    const platSel = select([['', '–'], ['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['x', 'X'], ['twitch', 'Twitch']], c.contact_locked ? c.contact_platform || '' : '');
    const contactCard = h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, '📬 Kontaktweg')),
      h('div', { class: 'row' }, channelDot(c.contact_channel), h('strong', null, channelLabel(c.contact_channel, c.contact_platform)), c.contact_locked ? h('span', { class: 'badge info' }, 'manuell') : h('span', { class: 'badge' }, 'automatisch')),
      c.contact_target ? h('div', { class: 'help break mt' }, c.contact_target) : null,
      h('p', { class: 'help mt' }, 'Erlaubt sind: öffentlich angegebene E-Mail, DM nur wenn das Profil ausdrücklich dazu einlädt („DM for collabs“), oder der eigene Discord-Server des Creators.'),
      h('details', null, h('summary', { class: 'small', style: 'cursor:pointer' }, 'Manuell festlegen'), h('div', { class: 'form-grid mt' }, field('Kontaktweg', chSel), field('Plattform (bei DM)', platSel), field('Ziel', targetIn, null, 'wide')), h('div', { class: 'row mt' }, actionButton('Übernehmen', async () => {
        const body = chSel.value ? { contact_channel: chSel.value, contact_target: targetIn.value.trim() || null, contact_platform: platSel.value || null } : { contact_channel: null };
        await patch(`/creators/${id}`, body);
        toast('Kontaktweg gespeichert.', 'success');
        reload();
      }, { cls: 'btn btn-sm btn-primary' }))),
    );

    // ---- accounts ----
    const accounts = asArray(d.accounts);
    const accountsCard = h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, '📺 Plattform-Konten')),
      accounts.length
        ? h(
          'ul',
          { class: 'list' },
          accounts.map((a) =>
            h(
              'li',
              null,
              platformBadge(a.platform),
              h(
                'div',
                { class: 'grow' },
                h('div', null, extLink(a.url, a.display_handle || (a.handle ? `@${a.handle}` : PLATFORM_LABELS[a.platform]))),
                h(
                  'div',
                  { class: 'help' },
                  [
                    a.followers != null ? `${fmtNum(a.followers)} Follower` : null,
                    a.avg_views != null ? `Ø ${fmtNum(a.avg_views)} Aufrufe` : null,
                    a.avg_live_viewers != null ? `Ø ${fmtNum(a.avg_live_viewers)} Live-Zuschauer` : null,
                    a.times_seen_live ? `${a.times_seen_live}× live gesehen` : null,
                    a.roblox_share != null ? `${Math.round(a.roblox_share * 100)} % Roblox` : null,
                    a.uploads_30d != null ? `${a.uploads_30d} Uploads/30 Tage` : null,
                    a.last_active_at ? `aktiv ${fmtRelative(a.last_active_at)}` : null,
                  ].filter(Boolean).join(' · '),
                ),
                asArray(a.genres).length ? h('div', { class: 'chips mt' }, asArray(a.genres).map((g) => h('span', { class: 'chip' }, g))) : null,
                a.latest_title ? h('div', { class: 'help mt' }, 'Zuletzt: ', extLink(a.latest_url, a.latest_title)) : null,
                a.bio ? h('details', { class: 'mt' }, h('summary', { class: 'small', style: 'cursor:pointer' }, 'Beschreibung/Bio'), h('div', { class: 'help', style: 'white-space:pre-wrap' }, truncate(a.bio, 1500))) : null,
              ),
              h('span', { class: 'help nowrap' }, a.fetched_at ? `Stand ${fmtDate(a.fetched_at)}` : ''),
            ),
          ),
        )
        : h('p', { class: 'muted' }, 'Keine Konten gespeichert.'),
    );

    // ---- contacts ----
    const contacts = asArray(d.contacts);
    const typeSel = select([['email', 'E-Mail'], ['discord', 'Discord-Einladung'], ['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['x', 'X'], ['twitch', 'Twitch'], ['youtube', 'YouTube'], ['website', 'Webseite']], 'email');
    const valueIn = h('input', { type: 'text', placeholder: 'Adresse, Handle oder Link' });
    const bizChk = h('input', { type: 'checkbox' });
    const dmChk = h('input', { type: 'checkbox' });
    const contactsCard = h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, '🔗 Kontakte')),
      contacts.length
        ? h(
          'ul',
          { class: 'list' },
          contacts.map((ct) =>
            h(
              'li',
              null,
              platformBadge(ct.type === 'email' ? 'email' : ct.type === 'website' ? '' : ct.type),
              h('div', { class: 'grow break' }, ct.type === 'email' ? h('span', { class: 'mono' }, ct.value) : extLink(ct.label && /^https?:/.test(ct.label) ? ct.label : null, ct.value), h('div', { class: 'help' }, [ct.is_business ? 'Business' : null, ct.dm_invited ? 'lädt zu DMs ein' : null, ct.source ? `Quelle: ${ct.source}` : null].filter(Boolean).join(' · '))),
              actionButton('✕', async () => {
                if (!(await confirmDialog({ title: 'Kontakt löschen?', text: ct.value, confirmText: 'Löschen', danger: true }))) return;
                await del(`/contacts/${ct.id}`);
                reload();
              }, { cls: 'btn btn-sm btn-ghost', title: 'Kontakt löschen' }),
            ),
          ),
        )
        : h('p', { class: 'muted' }, 'Keine Kontakte gefunden.'),
      h(
        'details',
        { class: 'mt' },
        h('summary', { class: 'small', style: 'cursor:pointer' }, '+ Kontakt hinzufügen'),
        h('div', { class: 'form-grid mt' }, field('Art', typeSel), field('Wert', valueIn), h('div', { class: 'field' }, h('label', { class: 'check' }, bizChk, 'Business-Kontakt'), h('label', { class: 'check' }, dmChk, 'Profil lädt zu DMs ein'))),
        h('div', { class: 'row mt' }, actionButton('Hinzufügen', async () => {
          if (!valueIn.value.trim()) return;
          await post(`/creators/${id}/contacts`, { type: typeSel.value, value: valueIn.value.trim(), is_business: bizChk.checked, dm_invited: dmChk.checked });
          toast('Kontakt hinzugefügt.', 'success');
          reload();
        }, { cls: 'btn btn-sm btn-primary' })),
      ),
    );

    // ---- outreach ----
    const outreachCard = h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, '✉️ Outreach')),
      h(
        'dl',
        { class: 'kv' },
        kv('Status', statusBadge(o.status)),
        kv('Kontaktiert', o.contacted_at ? `${fmtDateTime(o.contacted_at)} (${channelLabel(o.channel, o.channel_platform)})` : '–'),
        kv('Vorlage', o.template_key ? `${o.template_key}` : '–'),
        kv('Nachfassen fällig', o.followup_due_at ? fmtDateTime(o.followup_due_at) : '–'),
        kv('Nachgefasst', o.followups_sent ? `${o.followups_sent}× (zuletzt ${fmtDateTime(o.last_followup_at)})` : '–'),
        kv('Antwort', o.replied_at ? `${fmtDateTime(o.replied_at)} – ${SENTIMENT_LABELS[o.reply_sentiment] || o.reply_sentiment || ''}` : '–'),
        kv('Discord-Einladung', o.invite_code ? extLink(`https://discord.gg/${o.invite_code}`, `discord.gg/${o.invite_code}`) : '–'),
        kv('Im Discord seit', o.joined_discord_at ? fmtDateTime(o.joined_discord_at) : '–'),
        kv('Angenommen', o.accepted_at ? fmtDateTime(o.accepted_at) : '–'),
        kv('Live beim Launch', o.went_live_at ? fmtDateTime(o.went_live_at) : '–'),
      ),
      o.status === 'neu' || o.status === 'qualifiziert' ? h('div', { class: 'row mt' }, h('a', { class: 'btn btn-sm btn-primary', href: '#/senden' }, '✉️ Zum Senden')) : null,
    );

    // ---- application ----
    const app = d.application;
    const appCard = app
      ? h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', null, '📝 Bewerbung im Discord')),
        h(
          'dl',
          { class: 'kv' },
          kv('Status', h('span', { class: 'badge' }, app.status)),
          kv('Discord', app.discord_tag || app.discord_user_id),
          kv('Kanal', extLink(app.channel_url, app.channel_url)),
          kv('Follower', fmtNum(app.followers)),
          kv('Alter', AGE_GROUPS[app.age_group] || app.age_group || '–'),
          kv('Vorstellung', app.intro || '–'),
          kv('Eingegangen', fmtDateTime(app.created_at)),
        ),
        h('a', { class: 'btn btn-sm mt', href: '#/discord' }, 'Zu den Bewerbungen'),
      )
      : null;

    // ---- note + timeline ----
    const noteIn = h('textarea', { placeholder: 'z. B. „Hat geantwortet, will am Launch-Tag streamen“' });
    const activity = asArray(d.activity);
    const timelineCard = h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, '🕒 Verlauf')),
      h('div', { class: 'field' }, noteIn),
      h('div', { class: 'row mt mb' }, actionButton('Notiz hinzufügen', async () => {
        if (!noteIn.value.trim()) return;
        await post(`/creators/${id}/note`, { text: noteIn.value.trim() });
        reload();
      }, { cls: 'btn btn-sm' })),
      activity.length
        ? h('ul', { class: 'timeline' }, activity.map((a) => h('li', null, h('strong', null, ACTIVITY_LABELS[a.type] || a.type), ' ', h('span', { class: 'muted small' }, fmtDateTime(a.created_at)), activitySummary(a) ? h('div', { class: 'help', style: 'white-space:pre-wrap' }, activitySummary(a)) : null)))
        : h('p', { class: 'muted' }, 'Noch kein Verlauf.'),
    );

    mount(
      root,
      h(
        'div',
        { class: 'stack' },
        header,
        h('div', { class: 'grid grid-2' }, h('div', { class: 'stack' }, profile, contactCard), h('div', { class: 'stack' }, outreachCard, accountsCard, contactsCard, appCard)),
        timelineCard,
      ),
    );
  }

  await load();
  return () => {
    destroyed = true;
  };
}

function kv(label, value) {
  return [h('dt', null, label), h('dd', null, value ?? '–')];
}

function activitySummary(a) {
  const d = a.data || {};
  if (typeof d !== 'object') return String(d);
  if (a.type === 'status') return `${STATUS_LABELS[d.from] || d.from || '?'} → ${STATUS_LABELS[d.to] || d.to || '?'}${d.note ? ` – ${d.note}` : ''}`;
  if (a.type === 'sent' || a.type === 'followup_sent') return [d.channel ? channelLabel(d.channel) : null, d.template_key, d.variant ? `Variante ${d.variant}` : null].filter(Boolean).join(' · ');
  if (a.type === 'reply') return SENTIMENT_LABELS[d.sentiment] || d.sentiment || '';
  if (a.type === 'note') return d.text || '';
  if (a.type === 'discovered') return d.source ? `Quelle: ${d.source}` : '';
  if (a.type === 'skipped') return d.reason ? `Grund: ${d.reason}` : '';
  const entries = Object.entries(d).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object');
  return entries.map(([k, v]) => `${k}: ${v}`).join(' · ');
}
