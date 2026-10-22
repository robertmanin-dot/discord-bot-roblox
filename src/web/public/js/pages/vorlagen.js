// Vorlagen: edit message templates with placeholders and live preview.
import { get, post, put, del, ApiError } from '../api.js';
import { h, mount, loading, empty, errorBox, toast, toastError, modal, confirmDialog, debounce, select, field, notice, actionButton, LANGUAGES, setQuery } from '../ui.js';

const STEP_LABELS = { first: 'Erstkontakt', followup: 'Nachfassen' };
const CHANNEL_LABELS = { email: 'E-Mail', dm: 'DM', discord: 'Discord-Server' };
const DEFAULT_PLACEHOLDERS = [
  ['name', 'Name des Creators'],
  ['video', 'Titel des letzten Videos/Streams'],
  ['game', 'Spielname'],
  ['pitch', 'Kurzbeschreibung (passende Sprache)'],
  ['date', 'Launch-Datum'],
  ['time', 'Launch-Uhrzeit'],
  ['link', 'Infoseite'],
  ['discord', 'Persönlicher Discord-Link'],
  ['sender', 'Absendername'],
  ['studio', 'Studio-Name'],
  ['privacy', 'Datenschutz-Link'],
  ['reward', 'Belohnung für den Code'],
  ['platform', 'Plattform'],
];

export async function render(root, { query }) {
  let destroyed = false;
  let data;
  mount(root, loading());
  try {
    data = await get('/templates');
  } catch (err) {
    mount(root, err instanceof ApiError && err.missing ? h('div', { class: 'card' }, empty('🛠️', 'Vorlagen noch nicht verfügbar', err.message)) : errorBox(err, () => render(root, { query })));
    return;
  }
  const items = data.items || [];
  const placeholders = (data.placeholders?.length ? data.placeholders.map((p) => [p.key, p.label]) : DEFAULT_PLACEHOLDERS);
  const filter = { step: query.get('step') || '', channel: query.get('channel') || '', language: query.get('language') || '' };
  let selectedKey = query.get('key') || items[0]?.key || null;
  let previewCreator = '';

  const listEl = h('div', { class: 'card tpl-list' });
  const editorEl = h('div', { class: 'card' });
  // API may send ['de', …] or [{ code, label }, …]
  const langLabels = { ...LANGUAGES };
  for (const l of data.languages || []) if (l && typeof l === 'object' && l.code) langLabels[l.code] = l.label || l.code;
  const languages = [...new Set([...(data.languages || []).map((l) => (typeof l === 'object' ? l?.code : l)).filter(Boolean), ...items.map((t) => t.language)])];

  function filtered() {
    return items.filter((t) => (!filter.step || t.step === filter.step) && (!filter.channel || t.channel === filter.channel) && (!filter.language || t.language === filter.language));
  }

  function renderList() {
    const groups = new Map();
    for (const t of filtered()) {
      const g = `${STEP_LABELS[t.step] || t.step} › ${CHANNEL_LABELS[t.channel] || t.channel}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(t);
    }
    const stepSel = select([['', 'Alle Schritte'], ...Object.entries(STEP_LABELS)], filter.step, { onchange: (e) => { filter.step = e.target.value; renderList(); } });
    const chanSel = select([['', 'Alle Kanäle'], ...Object.entries(CHANNEL_LABELS)], filter.channel, { onchange: (e) => { filter.channel = e.target.value; renderList(); } });
    const langSel = select([['', 'Alle Sprachen'], ...languages.map((l) => [l, langLabels[l] || l])], filter.language, { onchange: (e) => { filter.language = e.target.value; renderList(); } });
    mount(
      listEl,
      h('div', { class: 'stack', style: 'margin-bottom:12px' }, stepSel, chanSel, langSel),
      h('button', { class: 'btn btn-sm', style: 'width:100%;margin-bottom:10px', onclick: newVariantDialog }, '+ Neue Vorlage / Variante'),
      groups.size
        ? [...groups.entries()].map(([g, list]) => [
          h('div', { class: 'tpl-group' }, g),
          list
            .sort((a, b) => a.language.localeCompare(b.language) || a.variant.localeCompare(b.variant))
            .map((t) =>
              h(
                'button',
                { class: `tpl-item ${t.key === selectedKey ? 'active' : ''}`, onclick: () => { selectedKey = t.key; setQuery({ key: t.key }); renderList(); renderEditor(); } },
                h('span', { class: 'grow', style: 'flex:1' }, `${langLabels[t.language] || t.language} · Variante ${t.variant}`),
                t.is_custom ? h('span', { class: 'badge info', title: 'Von dir bearbeitet' }, '✎') : null,
                !t.active ? h('span', { class: 'badge', title: 'Deaktiviert' }, 'aus') : null,
              ),
            ),
        ])
        : h('p', { class: 'muted small' }, 'Keine Vorlagen für diese Filter.'),
    );
  }

  function renderEditor() {
    const t = items.find((x) => x.key === selectedKey);
    if (!t) {
      mount(editorEl, empty('📝', 'Keine Vorlage ausgewählt', 'Wähle links eine Vorlage aus.'));
      return;
    }
    const subject = t.channel === 'email' ? h('input', { type: 'text', value: t.subject || '' }) : null;
    const bodyIn = h('textarea', { class: 'tall', value: t.body || '', style: 'min-height:300px' });
    const active = h('input', { type: 'checkbox', checked: Boolean(t.active) });
    let lastFocused = bodyIn;
    subject?.addEventListener('focus', () => { lastFocused = subject; });
    bodyIn.addEventListener('focus', () => { lastFocused = bodyIn; });

    const chips = h(
      'div',
      { class: 'chips' },
      placeholders.map(([key, label]) =>
        h('button', {
          class: 'chip',
          type: 'button',
          title: label,
          onclick: () => insertAtCursor(lastFocused, `{${key}}`),
        }, `{${key}}`),
      ),
    );

    const previewEl = h('div', { class: 'preview' }, 'Vorschau lädt …');
    const missingEl = h('div');
    const creatorPick = h('input', { type: 'number', min: 1, placeholder: 'ID (optional)', value: previewCreator, style: 'width:140px' });
    const updatePreview = debounce(async () => {
      try {
        const res = await post('/templates/preview', { subject: subject ? subject.value : undefined, body: bodyIn.value, creatorId: creatorPick.value ? Number(creatorPick.value) : undefined, language: t.language });
        if (destroyed) return;
        mount(previewEl, res.subject ? h('div', { class: 'subject' }, res.subject) : null, res.body || '');
        mount(missingEl, res.missing?.length ? notice('warn', '⚠️', `Ohne Wert (bitte unter Einstellungen eintragen): ${res.missing.map((m) => `{${m}}`).join(', ')}`) : null);
      } catch (err) {
        mount(previewEl, err.missing ? 'Vorschau noch nicht verfügbar.' : `Vorschau-Fehler: ${err.message}`);
      }
    }, 400);
    subject?.addEventListener('input', updatePreview);
    bodyIn.addEventListener('input', updatePreview);
    creatorPick.addEventListener('change', () => { previewCreator = creatorPick.value; updatePreview(); });

    const saveBtn = actionButton('Speichern', async () => {
      const res = await put(`/templates/${encodeURIComponent(t.key)}`, { subject: subject ? subject.value : undefined, body: bodyIn.value, active: active.checked });
      Object.assign(t, res?.template || { subject: subject?.value, body: bodyIn.value, active: active.checked ? 1 : 0, is_custom: 1 });
      toast('Vorlage gespeichert.', 'success');
      renderList();
    }, { cls: 'btn btn-primary' });
    const resetBtn = actionButton(t.is_custom ? '↺ Auf Standard zurücksetzen' : '↺ Standard', async () => {
      if (!(await confirmDialog({ title: 'Auf Standard zurücksetzen?', text: 'Deine Änderungen an dieser Vorlage gehen verloren.', confirmText: 'Zurücksetzen' }))) return;
      try {
        const res = await post(`/templates/${encodeURIComponent(t.key)}/reset`);
        if (res?.template) Object.assign(t, res.template);
        toast('Zurückgesetzt.', 'success');
        renderList();
        renderEditor();
      } catch (err) {
        if (err.status === 404 || err.status === 400) {
          // custom template without default -> offer delete
          if (await confirmDialog({ title: 'Eigene Vorlage löschen?', text: 'Für diese Vorlage gibt es keinen Standard. Soll sie gelöscht werden?', confirmText: 'Löschen', danger: true })) {
            await del(`/templates/${encodeURIComponent(t.key)}`);
            items.splice(items.indexOf(t), 1);
            selectedKey = items[0]?.key || null;
            renderList();
            renderEditor();
          }
        } else throw err;
      }
    }, { cls: 'btn' });

    mount(
      editorEl,
      h('div', { class: 'card-head' }, h('h2', null, `${STEP_LABELS[t.step] || t.step} · ${CHANNEL_LABELS[t.channel] || t.channel} · ${langLabels[t.language] || t.language} · ${t.variant}`), h('span', { class: 'muted small mono' }, t.key)),
      h('div', { class: 'grid grid-2' },
        h(
          'div',
          { class: 'stack' },
          subject ? field('Betreff', subject) : null,
          field('Text', bodyIn),
          h('div', null, h('div', { class: 'label' }, 'Platzhalter einfügen (klicken)'), chips),
          h('label', { class: 'check' }, active, 'Vorlage aktiv'),
          h('div', { class: 'row' }, saveBtn, resetBtn),
        ),
        h(
          'div',
          { class: 'stack' },
          h('div', { class: 'row between' }, h('span', { class: 'label' }, 'Vorschau'), h('span', { class: 'row' }, h('span', { class: 'help' }, 'mit Creator-ID:'), creatorPick)),
          previewEl,
          missingEl,
          notice(
            'info',
            '💡',
            h('div', null, h('strong', null, 'Bedingte Teile: '), h('code', null, '[[Ich hab dein Video „{video}“ gesehen.||Ich bin auf deinen Kanal gestoßen.]]'), ' – der erste Teil erscheint nur, wenn alle Platzhalter darin einen Wert haben, sonst der Teil nach ', h('code', null, '||'), '.'),
          ),
          notice(
            'warn',
            '⚖️',
            h('div', null, h('strong', null, 'Pflicht in jeder ersten Nachricht: '), 'wer schreibt ({sender}/{studio}), woher der Kontakt stammt („aus deinem öffentlichen Kanal“), ein Satz zum Abmelden und der Link zur Datenschutzerklärung ({privacy}). Kurz bleiben (unter 120 Wörter), eine Ja/Nein-Frage am Ende.'),
          ),
        ),
      ),
    );
    updatePreview();
  }

  function newVariantDialog() {
    const cur = items.find((x) => x.key === selectedKey);
    const step = select(Object.entries(STEP_LABELS), cur?.step || 'first');
    const channel = select(Object.entries(CHANNEL_LABELS), cur?.channel || 'email');
    const language = select(Object.entries(LANGUAGES), cur?.language || 'de');
    const variant = h('input', { type: 'text', value: 'B', maxlength: 3, style: 'text-transform:uppercase' });
    const copy = h('input', { type: 'checkbox', checked: Boolean(cur) });
    const create = actionButton('Anlegen', async () => {
      const v = (variant.value || 'A').trim().toUpperCase();
      const key = `${step.value}.${channel.value}.${language.value}.${v}`;
      if (items.some((t) => t.key === key)) {
        toast('Diese Vorlage gibt es schon – sie wird ausgewählt.', 'info');
        selectedKey = key;
        m.close();
        renderList();
        renderEditor();
        return;
      }
      const res = await post('/templates', {
        step: step.value,
        channel: channel.value,
        language: language.value,
        variant: v,
        subject: copy.checked ? cur?.subject || '' : channel.value === 'email' ? 'Founding Creator für {game}?' : undefined,
        body: copy.checked ? cur?.body || '' : 'Hey {name}! …',
      });
      const tpl = res?.template || { key, step: step.value, channel: channel.value, language: language.value, variant: v, body: '', active: 1, is_custom: 1 };
      items.push(tpl);
      selectedKey = tpl.key;
      m.close();
      toast('Vorlage angelegt.', 'success');
      renderList();
      renderEditor();
    }, { cls: 'btn btn-primary' });
    const m = modal({
      title: 'Neue Vorlage / Variante',
      body: h('div', { class: 'form-grid' }, field('Schritt', step), field('Kanal', channel), field('Sprache', language), field('Variante', variant, 'A, B, C … für A/B-Tests'), h('label', { class: 'check field wide' }, copy, 'Text der aktuell gewählten Vorlage übernehmen')),
      footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'), create],
    });
  }

  mount(
    root,
    h(
      'div',
      { class: 'stack' },
      notice('info', '📝', 'Hier passt du die Nachrichten an. Das Tool wählt automatisch die Sprache des Creators (sonst Englisch) und wechselt bei A/B-Test zwischen den Varianten. In der Statistik siehst du später, welche Variante mehr Antworten bekommt.'),
      h('div', { class: 'tpl-layout' }, listEl, editorEl),
    ),
  );
  renderList();
  renderEditor();
  return () => {
    destroyed = true;
  };
}

function insertAtCursor(el, text) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  el.focus();
  el.selectionStart = el.selectionEnd = start + text.length;
  el.dispatchEvent(new Event('input'));
}
