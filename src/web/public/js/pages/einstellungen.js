// Einstellungen: game & campaign, radar, discord, points, retention, maintenance.
import { get, put, post } from '../api.js';
import { h, mount, loading, errorBox, toast, toastError, field, select, notice, actionButton, LANGUAGES, fmtLongDate, modal, confirmDialog, setQuery } from '../ui.js';

const TIMEZONES = [
  ['Europe/Berlin', 'Deutschland (Europe/Berlin)'],
  ['Europe/Vienna', 'Österreich (Europe/Vienna)'],
  ['Europe/Zurich', 'Schweiz (Europe/Zurich)'],
  ['Europe/London', 'UK (Europe/London)'],
  ['America/New_York', 'USA Ost (America/New_York)'],
];

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  keys.slice(0, -1).forEach((k) => {
    if (cur[k] === undefined || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  });
  cur[keys[keys.length - 1]] = value;
}

/** Local wall-clock date/time of an ISO instant in a time zone -> { date: 'YYYY-MM-DD', time: 'HH:MM' } */
function zoned(iso, tz) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * Declarative form: specs = [{ path, label, type, help, options, wide, min, max, placeholder }]
 * Returns { el, collect() } where collect() builds a nested patch object.
 */
function buildForm(settings, specs) {
  const controls = [];
  const fields = specs.map((s) => {
    const value = getPath(settings, s.path);
    let input;
    if (s.type === 'textarea') input = h('textarea', { value: value ?? '', placeholder: s.placeholder || '' });
    else if (s.type === 'select') input = select(s.options, value ?? '');
    else if (s.type === 'checkbox') input = h('input', { type: 'checkbox', checked: Boolean(value) });
    else if (s.type === 'languages') {
      const set = new Set(value || []);
      const boxes = Object.entries(LANGUAGES).map(([code, label]) => ({ code, el: h('input', { type: 'checkbox', checked: set.has(code) }), label }));
      input = h('div', { class: 'chips' }, boxes.map((b) => h('label', { class: 'check', style: 'margin-right:10px' }, b.el, b.label)));
      controls.push({ s, get: () => boxes.filter((b) => b.el.checked).map((b) => b.code) });
      return field(s.label, input, s.help, s.wide ? 'wide' : '');
    } else input = h('input', { type: s.type || 'text', value: value ?? '', placeholder: s.placeholder || '', min: s.min, max: s.max, step: s.step });
    controls.push({
      s,
      get: () => {
        if (s.type === 'checkbox') return input.checked;
        if (s.type === 'number') return input.value === '' ? null : Number(input.value);
        if (s.type === 'select' && s.numeric) return Number(input.value);
        return input.value.trim();
      },
    });
    if (s.type === 'checkbox') return h('div', { class: `field ${s.wide ? 'wide' : ''}` }, h('label', { class: 'check' }, input, s.label), s.help ? h('div', { class: 'help' }, s.help) : null);
    return field(s.label, input, s.help, s.wide ? 'wide' : '');
  });
  return {
    el: h('div', { class: 'form-grid' }, fields),
    collect() {
      const patch = {};
      for (const c of controls) {
        const v = c.get();
        if (c.s.type === 'number' && v === null) continue;
        setPath(patch, c.s.path, v);
      }
      return patch;
    },
  };
}

function section(title, intro, form, onSave, extra) {
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, title)),
    intro ? h('p', { class: 'muted' }, intro) : null,
    form.el,
    extra || null,
    h('div', { class: 'row mt' }, actionButton('Speichern', onSave, { cls: 'btn btn-primary' })),
  );
}

export async function render(root, { query }) {
  mount(root, loading());
  let res;
  try {
    res = await get('/settings');
  } catch (err) {
    mount(root, errorBox(err, () => render(root, { query })));
    return;
  }
  const settings = res.settings;
  const tabs = [['spiel', '🎮 Spiel & Kampagne'], ['radar', '🔎 Radar & Senden'], ['discord', '💬 Discord'], ['punkte', '🏆 Punkte & Ränge'], ['daten', '🗄️ Daten & Wartung']];
  let tab = query.get('tab') || 'spiel';
  const tabsEl = h('div', { class: 'tabs' });
  const content = h('div');
  mount(root, tabsEl, content);

  const save = async (patch, msg = 'Gespeichert.') => {
    const r = await put('/settings', patch);
    Object.assign(settings, r.settings);
    toast(msg, 'success');
    return r.settings;
  };

  function show() {
    mount(tabsEl, tabs.map(([k, l]) => h('button', { class: `tab ${tab === k ? 'active' : ''}`, onclick: () => { tab = k; setQuery({ tab: k === 'spiel' ? '' : k }); show(); } }, l)));
    if (tab === 'radar') mount(content, radarTab());
    else if (tab === 'discord') mount(content, discordTab());
    else if (tab === 'punkte') mount(content, pointsTab());
    else if (tab === 'daten') mount(content, dataTab());
    else mount(content, gameTab());
  }

  // ----------------------------------------------------------------- Spiel
  function gameTab() {
    const g = settings.game || {};
    const tz = g.timezone || 'Europe/Berlin';
    const z = zoned(g.launchAt, tz);
    const launchDate = h('input', { type: 'date', value: z.date });
    const launchTime = h('input', { type: 'time', value: z.time || '19:00' });
    const tzSel = select(TIMEZONES, tz);
    const form = buildForm(settings, [
      { path: 'game.name', label: 'Spielname', placeholder: 'z. B. Tower Rush' },
      { path: 'game.url', label: 'Link zum Spiel', type: 'url', placeholder: 'https://www.roblox.com/games/…' },
      { path: 'game.pitch_de', label: 'Kurzbeschreibung (Deutsch)', type: 'textarea', wide: true, placeholder: 'Team-Shooter: In der Mitte liegen die Blöcke – ihr kämpft darum, und wer zuerst seinen Turm fertig hat, gewinnt.', help: '1–2 Sätze. Wird in Nachrichten als {pitch} eingesetzt.' },
      { path: 'game.pitch_en', label: 'Kurzbeschreibung (Englisch)', type: 'textarea', wide: true, placeholder: 'Team shooter: fight over the blocks in the middle – the first team to finish their tower wins.' },
      { path: 'game.senderName', label: 'Absendername', placeholder: 'z. B. Robert', help: '{sender} in Nachrichten' },
      { path: 'game.studioName', label: 'Studio-Name', placeholder: 'z. B. Blocky Games', help: '{studio}' },
      { path: 'game.contactEmail', label: 'Studio-E-Mail', type: 'email', placeholder: 'creators@…' },
      { path: 'game.discordInvite', label: 'Allgemeiner Discord-Link', type: 'url', placeholder: 'https://discord.gg/…', help: 'Fallback, wenn der Bot keinen persönlichen Link erstellen kann.' },
      { path: 'game.infoUrl', label: 'Infoseite „Founding Creator“', type: 'url', placeholder: 'https://…', help: '{link} – Seite mit Programm, Belohnungen, FAQ.' },
      { path: 'game.privacyUrl', label: 'Datenschutzerklärung', type: 'url', placeholder: 'https://…/datenschutz', help: '{privacy} – Pflicht in der ersten Nachricht. Vorlage: docs/DATENSCHUTZ-VORLAGE.md' },
      { path: 'game.imprintUrl', label: 'Impressum', type: 'url', placeholder: 'https://…/impressum' },
      { path: 'game.codeReward_de', label: 'Belohnung für den Creator-Code (DE)', placeholder: 'ein exklusives Item, das man nicht kaufen kann', help: '{reward} – nicht kaufbar, kein Robux-Wert (Roblox-Regeln).' },
      { path: 'game.codeReward_en', label: 'Belohnung für den Creator-Code (EN)', placeholder: 'an exclusive item you can\'t buy' },
    ]);
    const robloxBox = h('div');
    const linkGame = actionButton('🔗 Roblox-Spiel verknüpfen', async () => {
      const input = form.el.querySelector('input[type="url"]')?.value || settings.game.url || settings.game.placeId;
      if (!input) {
        toast('Bitte zuerst den Link zum Spiel eintragen.', 'error');
        return;
      }
      const r = await post('/roblox/resolve', { input });
      settings.game.placeId = r.placeId;
      settings.game.universeId = r.universeId;
      mount(robloxBox, notice('ok', '✅', `Verknüpft: ${r.name || 'Spiel'} (Universe-ID ${r.universeId}${r.playing != null ? `, gerade ${r.playing} Spieler` : ''}). Die Live-Spielerzahl beim Launch funktioniert jetzt.`));
    }, { cls: 'btn' });
    mount(robloxBox, settings.game.universeId ? notice('ok', '✅', `Roblox-Spiel verknüpft (Universe-ID ${settings.game.universeId}).`) : notice('info', 'ℹ️', 'Verknüpfe dein Spiel, damit der Bot beim Launch die Spielerzahl live zeigen kann.'));

    return h(
      'div',
      { class: 'stack' },
      section('Spiel & Kampagne', 'Diese Angaben landen in den Nachrichten an Creator und in den Discord-Ankündigungen.', form, async () => {
        const patch = form.collect();
        await save(patch);
      }, h('div', { class: 'row mt' }, linkGame, h('div', { class: 'grow', style: 'flex:1' }, robloxBox))),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, '🚀 Launch-Termin')),
        h('p', { class: 'muted' }, settings.game.launchAt ? `Aktuell: ${fmtLongDate(settings.game.launchAt, settings.game.timezone || 'Europe/Berlin')} Uhr (${settings.game.timezone || 'Europe/Berlin'}). Vorschlag: Samstag 19:00 Uhr – das ist 13:00 Uhr in New York.` : 'Noch kein Termin. Vorschlag: Samstag 19:00 Uhr – das ist 13:00 Uhr in New York.'),
        h('div', { class: 'form-grid' }, field('Datum', launchDate), field('Uhrzeit', launchTime), field('Zeitzone', tzSel)),
        h(
          'div',
          { class: 'row mt' },
          actionButton('Termin speichern', async () => {
            if (!launchDate.value) {
              toast('Bitte ein Datum wählen.', 'error');
              return;
            }
            await save({ game: { timezone: tzSel.value, launchDate: launchDate.value, launchTime: launchTime.value || '19:00' } }, 'Launch-Termin gespeichert.');
            show();
          }, { cls: 'btn btn-primary' }),
          settings.game.launchAt
            ? actionButton('Termin entfernen', async () => {
              if (!(await confirmDialog({ title: 'Launch-Termin entfernen?', confirmText: 'Entfernen' }))) return;
              await save({ game: { launchDate: '', launchTime: '' } }, 'Termin entfernt.');
              show();
            }, { cls: 'btn btn-ghost' })
            : null,
        ),
      ),
    );
  }

  // ----------------------------------------------------------------- Radar
  function radarTab() {
    const limits = buildForm(settings, [
      { path: 'radar.languages', label: 'Zielsprachen', type: 'languages', wide: true, help: 'Für Suche und Filter. Nachrichten gehen in der Sprache des Creators raus (sonst Englisch).' },
      { path: 'radar.minFollowers', label: 'Mindestens Follower/Abos', type: 'number', min: 0 },
      { path: 'radar.maxFollowers', label: 'Höchstens Follower/Abos', type: 'number', min: 1, help: 'Kleine Creator: 200–25.000 ist ein guter Bereich.' },
      { path: 'radar.minScore', label: 'Mindest-Passt-Wert für die Warteschlange', type: 'number', min: 0, max: 100 },
      { path: 'radar.dailyLimits.email', label: 'Tageslimit E-Mails', type: 'number', min: 0, help: 'Neue Absender-Adressen: mit 20–40 pro Tag anfangen.' },
      { path: 'radar.dailyLimits.dm', label: 'Tageslimit DMs', type: 'number', min: 0, help: 'Zu viele DMs an Fremde → Konto-Sperre. 15–25 pro Tag.' },
      { path: 'radar.dailyLimits.discord', label: 'Tageslimit Discord-Anfragen', type: 'number', min: 0 },
      { path: 'radar.followupAfterDays', label: 'Nachfassen nach … Tagen', type: 'number', min: 1, help: 'Nur per E-Mail.' },
      { path: 'radar.maxFollowups', label: 'Höchstens Nachfass-Mails', type: 'number', min: 0, max: 3, help: 'Empfehlung: 1 (rechtlich sicherer).' },
      { path: 'radar.noReplyAfterDays', label: '„Keine Antwort“ nach … Tagen', type: 'number', min: 1 },
      { path: 'radar.emailClient', label: 'E-Mail-Programm', type: 'select', options: [['gmail', 'Gmail (im Browser)'], ['outlook', 'Outlook.com (im Browser)'], ['mailto', 'Standard-Mailprogramm (mailto)']] },
      { path: 'radar.instagramLink', label: 'Instagram öffnen als', type: 'select', options: [['web', 'Profil im Browser'], ['app', 'ig.me-Chatlink (Handy-App)']] },
      { path: 'radar.abTest', label: 'A/B-Test: Varianten abwechselnd verwenden', type: 'checkbox' },
    ]);
    const yt = buildForm(settings, [
      { path: 'radar.youtube.publishedWithinDays', label: 'Videos der letzten … Tage', type: 'number', min: 1, max: 365 },
      { path: 'radar.youtube.pagesPerQuery', label: 'Seiten pro Suchbegriff', type: 'number', min: 1, max: 10, help: '1 Seite = 50 Videos = 1 Suche' },
      { path: 'radar.youtube.maxSearchesPerRun', label: 'Suchen pro Durchlauf', type: 'number', min: 1, max: 100 },
      { path: 'radar.youtube.recentVideos', label: 'Videos pro Kanal prüfen', type: 'number', min: 3, max: 50 },
      { path: 'radar.youtube.dailySearchLimit', label: 'YouTube-Suchen pro Tag', type: 'number', min: 1, help: 'Standard bei Google: 100' },
    ]);
    const tw = buildForm(settings, [
      { path: 'radar.twitch.minViewers', label: 'Mind. Zuschauer', type: 'number', min: 0 },
      { path: 'radar.twitch.maxViewers', label: 'Max. Zuschauer', type: 'number', min: 1 },
      { path: 'radar.twitch.maxPages', label: 'Seiten pro Sprache', type: 'number', min: 1, max: 50, help: '1 Seite = 100 Streams' },
      { path: 'radar.twitch.autoEveryMinutes', label: 'Automatisch alle … Minuten (0 = aus)', type: 'number', min: 0 },
    ]);
    return h(
      'div',
      { class: 'stack' },
      section('Radar & Senden', null, limits, () => save(limits.collect())),
      section('YouTube-Suche', 'Suchbegriffe bearbeitest du unter Finden → YouTube.', yt, () => save(yt.collect())),
      section('Twitch-Suche', null, tw, () => save(tw.collect())),
    );
  }

  // ----------------------------------------------------------------- Discord
  function discordTab() {
    const form = buildForm(settings, [
      { path: 'discord.guildId', label: 'Server-ID', placeholder: 'wird automatisch gesetzt', help: 'Nur nötig, wenn der Bot auf mehreren Servern ist (Rechtsklick auf Server → „Server-ID kopieren“, Entwicklermodus nötig).' },
      { path: 'discord.foundingLimit', label: 'Plätze „Founding Creator“', type: 'number', min: 1, help: 'Die ersten X angenommenen Creator bekommen die Founding-Rolle.' },
      { path: 'discord.parentConsentUnder', label: 'Eltern-OK nötig unter … Jahren', type: 'select', numeric: true, options: [['16', '16 (Standard)'], ['18', '18 (strenger)']] },
      { path: 'discord.serverLanguage', label: 'Sprache öffentlicher Bot-Posts', type: 'select', options: [['both', 'Deutsch + Englisch'], ['de', 'Nur Deutsch'], ['en', 'Nur Englisch']] },
      { path: 'discord.inviteMaxUses', label: 'Persönliche Einladung: max. Nutzungen', type: 'number', min: 0, help: '0 = unbegrenzt' },
      { path: 'discord.inviteMaxAgeDays', label: 'Persönliche Einladung: gültig … Tage', type: 'number', min: 0, max: 7, help: '0 = läuft nicht ab (Discord erlaubt sonst max. 7 Tage)' },
      { path: 'discord.twitchLiveCheckMinutes', label: 'Twitch-Live-Prüfung alle … Minuten', type: 'number', min: 1 },
      { path: 'discord.pingRoleOnEvents', label: 'Bei Event-Erinnerungen die Creator-Rolle erwähnen', type: 'checkbox' },
      { path: 'discord.welcomeDm', label: 'Begrüßungs-DM nach Annahme', type: 'checkbox' },
    ]);
    const ids = h(
      'details',
      { class: 'mt' },
      h('summary', { class: 'small', style: 'cursor:pointer' }, 'Von /setup angelegte Rollen & Kanäle anzeigen'),
      h('pre', { class: 'log mt' }, JSON.stringify({ roles: settings.discord.roles, channels: settings.discord.channels }, null, 2)),
    );
    return section('Discord-Bot', 'Rollen und Kanäle legt der Bot mit /setup selbst an.', form, () => save(form.collect()), ids);
  }

  // ----------------------------------------------------------------- Punkte
  function pointsTab() {
    const form = buildForm(settings, [
      { path: 'points.contentVideo', label: 'Video eingereicht & bestätigt', type: 'number', min: 0 },
      { path: 'points.contentShort', label: 'Short/Clip bestätigt', type: 'number', min: 0 },
      { path: 'points.contentStream', label: 'Stream bestätigt', type: 'number', min: 0 },
      { path: 'points.liveDuringEvent', label: 'Live während Launch/Event', type: 'number', min: 0 },
      { path: 'points.liveOther', label: 'Live außerhalb von Events', type: 'number', min: 0 },
      { path: 'points.playtestAttend', label: 'Playtest teilgenommen', type: 'number', min: 0 },
      { path: 'points.playtestFeedback', label: 'Feedback abgegeben', type: 'number', min: 0 },
      { path: 'points.bugConfirmed', label: 'Bug bestätigt', type: 'number', min: 0 },
    ]);
    const tiers = (settings.tiers || []).map((t) => ({ name: h('input', { type: 'text', value: t.name }), min: h('input', { type: 'number', min: 0, value: t.min }) }));
    const tierBox = h('div');
    const drawTiers = () => mount(tierBox, h('div', { class: 'stack' }, tiers.map((t, i) => h('div', { class: 'row' }, h('span', { style: 'flex:1' }, t.name), h('span', { style: 'width:140px' }, t.min), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { tiers.splice(i, 1); drawTiers(); } }, '✕')))), h('button', { class: 'btn btn-sm mt', onclick: () => { tiers.push({ name: h('input', { type: 'text', value: 'Neuer Rang' }), min: h('input', { type: 'number', min: 0, value: 1000 }) }); drawTiers(); } }, '+ Rang'));
    drawTiers();
    return h(
      'div',
      { class: 'stack' },
      section('Punkte', 'Punkte bringen Ränge und Status. Keine Robux-/Geldpreise für Platzierungen – das verbieten die Roblox-Regeln.', form, () => save(form.collect())),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Ränge')),
        h('p', { class: 'muted' }, 'Name und ab wie vielen Punkten der Rang gilt.'),
        tierBox,
        h('div', { class: 'row mt' }, actionButton('Ränge speichern', async () => {
          const list = tiers.map((t) => ({ name: t.name.value.trim(), min: Number(t.min.value) || 0 })).filter((t) => t.name).sort((a, b) => a.min - b.min);
          if (!list.length) {
            toast('Mindestens ein Rang ist nötig.', 'error');
            return;
          }
          await save({ tiers: list }, 'Ränge gespeichert.');
        }, { cls: 'btn btn-primary' })),
      ),
    );
  }

  // ----------------------------------------------------------------- Daten
  function dataTab() {
    const form = buildForm(settings, [
      { path: 'radar.retention.platformDataDays', label: 'Plattform-Daten aktualisieren/löschen nach … Tagen', type: 'number', min: 1, max: 30, help: 'YouTube schreibt max. 30 Tage vor.' },
      { path: 'radar.retention.uncontactedDays', label: 'Nie kontaktierte Creator löschen nach … Tagen', type: 'number', min: 1 },
      { path: 'radar.retention.noReplyDeleteDays', label: 'Nicht-Antworter löschen nach … Tagen', type: 'number', min: 30, help: 'Empfehlung: 180' },
    ]);
    const result = h('div');
    return h(
      'div',
      { class: 'stack' },
      section('Aufbewahrung (Datenschutz)', 'Das Tool löscht automatisch, was nicht mehr gebraucht wird. Wer sich abmeldet, wird sofort gelöscht – nur ein anonymer Sperr-Eintrag bleibt, damit er nicht erneut angeschrieben wird.', form, () => save(form.collect())),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Wartung')),
        h(
          'div',
          { class: 'row' },
          actionButton('🧹 Aufbewahrung jetzt ausführen', async () => {
            const r = await post('/maintenance/retention');
            mount(result, notice('ok', '✅', `Erledigt: ${r?.deleted ?? 0} gelöscht, ${r?.cleared ?? 0} Datensätze geleert, ${r?.refreshed ?? 0} aktualisiert.`));
          }),
          actionButton('↻ Alle Creator neu bewerten', async () => {
            const r = await post('/maintenance/rescore-all');
            mount(result, notice('ok', '✅', `${r?.updated ?? 0} Creator neu bewertet.`));
          }),
          actionButton('📜 Protokoll anzeigen', async () => {
            const r = await get('/logs', { level: 'info' });
            modal({ title: 'Protokoll (letzte Einträge)', wide: true, body: h('pre', { class: 'log', style: 'max-height:60vh' }, (r?.lines || []).join('\n') || 'Leer.') });
          }),
          h('a', { class: 'btn', href: '/api/export/creators.csv', download: 'creator.csv' }, '⬇ Alle Creator als CSV'),
        ),
        result,
        notice('info', '💾', 'Sicherung: Die komplette Datenbank liegt in der Datei data/radar.db im Programmordner. Zum Sichern das Tool beenden und den Ordner „data“ kopieren.'),
      ),
    );
  }

  show();
}
