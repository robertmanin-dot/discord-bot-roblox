// Finden: YouTube + Twitch discovery, imports, bookmarklet.
import { get, post, put, tryGet, ApiError } from '../api.js';
import {
  h, mount, loading, empty, errorBox, toast, toastError, fmtNum, fmtDateTime, fmtRelative, select, field,
  notice, actionButton, LANGUAGES, splitList, copyText, setQuery,
} from '../ui.js';

const TABS = [
  ['youtube', '▶️ YouTube'],
  ['twitch', '🟣 Twitch'],
  ['import', '📥 Import'],
  ['lesezeichen', '📌 TikTok & Instagram'],
];
const RUN_STATUS = { laeuft: 'läuft …', fertig: 'fertig', fehler: 'Fehler', abgebrochen: 'abgebrochen' };

export async function render(root, { query, refreshStatus }) {
  let tab = query.get('tab') || 'youtube';
  if (!TABS.some(([k]) => k === tab)) tab = 'youtube';
  let destroyed = false;
  let poller = null;
  const tabsEl = h('div', { class: 'tabs' });
  const content = h('div');
  mount(root, tabsEl, content);

  function stopPolling() {
    if (poller) clearInterval(poller);
    poller = null;
  }

  function renderTabs() {
    mount(tabsEl, TABS.map(([k, label]) => h('button', { class: `tab ${tab === k ? 'active' : ''}`, onclick: () => { tab = k; setQuery({ tab: k === 'youtube' ? '' : k }); show(); } }, label)));
  }

  async function show() {
    stopPolling();
    renderTabs();
    mount(content, loading());
    try {
      if (tab === 'youtube') await showYoutube();
      else if (tab === 'twitch') await showTwitch();
      else if (tab === 'import') showImport();
      else await showBookmarklet();
    } catch (err) {
      if (!destroyed) mount(content, errorBox(err, show));
    }
  }

  // ---------------- Runs (shared) ----------------
  function runView(runId, onDone) {
    const box = h('div', { class: 'card mt' }, loading('Suche startet …'));
    const tick = async () => {
      let run;
      try {
        run = (await get(`/discovery/runs/${runId}`))?.run;
      } catch (err) {
        mount(box, errorBox(err));
        stopPolling();
        return;
      }
      if (!run || destroyed) return;
      const running = run.status === 'laeuft';
      const logEl = h('pre', { class: 'log' }, run.log || '…');
      mount(
        box,
        h(
          'div',
          { class: 'card-head' },
          h('h3', null, running ? '⏳ Suche läuft' : run.status === 'fertig' ? '✅ Suche abgeschlossen' : run.status === 'fehler' ? '⚠️ Suche mit Fehler beendet' : '⏹ Suche abgebrochen'),
          running ? actionButton('Abbrechen', async () => { await post(`/discovery/${runId}/cancel`); toast('Wird abgebrochen …'); }, { cls: 'btn btn-sm btn-danger' }) : null,
        ),
        h('div', { class: 'grid grid-4 mb' }, stat(run.found, 'gefunden'), stat(run.added, 'neu angelegt'), stat(run.updated, 'aktualisiert'), stat(run.skipped, 'übersprungen')),
        run.error ? notice('err', '⚠️', run.error) : null,
        logEl,
        !running ? h('div', { class: 'row mt' }, h('a', { class: 'btn btn-primary', href: '#/creator?sort=created' }, '👥 Neue Creator ansehen'), h('a', { class: 'btn', href: '#/senden' }, '✉️ Zum Senden')) : null,
      );
      logEl.scrollTop = logEl.scrollHeight;
      if (!running) {
        stopPolling();
        onDone?.(run);
      }
    };
    stopPolling();
    tick();
    poller = setInterval(tick, 2000);
    return box;
  }

  function stat(n, label) {
    return h('div', { class: 'stat' }, h('span', { class: 'num' }, fmtNum(n || 0)), h('span', { class: 'lbl' }, label));
  }

  async function runsHistory(source) {
    const res = await tryGet('/discovery/runs', { limit: 10 });
    const items = (res?.items || []).filter((r) => !source || r.source === source);
    if (!items.length) return null;
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Letzte Suchen')),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table compact' },
          h('thead', null, h('tr', null, h('th', null, 'Start'), h('th', null, 'Quelle'), h('th', null, 'Status'), h('th', { class: 'num' }, 'Gefunden'), h('th', { class: 'num' }, 'Neu'), h('th', { class: 'num' }, 'Aktualisiert'))),
          h(
            'tbody',
            null,
            items.map((r) => h('tr', null, h('td', { class: 'nowrap' }, fmtDateTime(r.started_at)), h('td', null, r.source), h('td', null, RUN_STATUS[r.status] || r.status), h('td', { class: 'num' }, fmtNum(r.found)), h('td', { class: 'num' }, fmtNum(r.added)), h('td', { class: 'num' }, fmtNum(r.updated)))),
          ),
        ),
      ),
    );
  }

  // ---------------- YouTube ----------------
  async function showYoutube() {
    const [settingsRes, quotaRes] = await Promise.all([get('/settings'), tryGet('/discovery/quota')]);
    if (destroyed) return;
    const settings = settingsRes.settings;
    const yt = settings.radar.youtube;
    const keySet = quotaRes?.youtube?.keySet ?? settingsRes.secrets?.YOUTUBE_API_KEY?.set;
    const q = quotaRes?.youtube;
    const langs = [...new Set([...(settings.radar.languages || []), ...Object.keys(yt.queries || {})])];
    const langChecks = langs.map((l) => ({ l, el: h('input', { type: 'checkbox', checked: (settings.radar.languages || []).includes(l) }) }));
    const queryAreas = langs.map((l) => ({ l, el: h('textarea', { value: (yt.queries?.[l] || []).join('\n'), style: 'min-height:170px' }) }));
    const maxSearches = h('input', { type: 'number', min: 1, max: 100, value: yt.maxSearchesPerRun || 20 });
    const newLang = select([['', '+ Sprache hinzufügen …'], ...Object.entries(LANGUAGES).filter(([k]) => !langs.includes(k))], '');
    newLang.addEventListener('change', async () => {
      if (!newLang.value) return;
      try {
        await put('/settings', { radar: { youtube: { queries: { [newLang.value]: [`roblox ${LANGUAGES[newLang.value].toLowerCase()}`] } } } });
        toast(`${LANGUAGES[newLang.value]} hinzugefügt – Suchbegriffe anpassen und speichern.`, 'success');
        showYoutube();
      } catch (err) {
        toastError(err);
      }
    });

    const saveQueries = async (silent = false) => {
      const queries = {};
      for (const { l, el } of queryAreas) queries[l] = splitList(el.value.replace(/\n/g, ','));
      await put('/settings', { radar: { youtube: { queries, maxSearchesPerRun: Number(maxSearches.value) || 20 } } });
      if (!silent) toast('Suchbegriffe gespeichert.', 'success');
    };

    const runArea = h('div');
    const startBtn = actionButton('▶ Suche starten', async () => {
      const languages = langChecks.filter((x) => x.el.checked).map((x) => x.l);
      if (!languages.length) {
        toast('Bitte mindestens eine Sprache auswählen.', 'error');
        return;
      }
      await saveQueries(true);
      const res = await post('/discovery/youtube', { languages, maxSearches: Number(maxSearches.value) || 20 });
      mount(runArea, runView(res.runId, () => { showQuotaOnly(); refreshStatus?.(); }));
    }, { cls: 'btn btn-primary btn-lg', disabled: !keySet });

    const quotaBox = h('div');
    const showQuotaOnly = async () => {
      const qq = (await tryGet('/discovery/quota'))?.youtube;
      if (qq && !destroyed) mount(quotaBox, quotaLine(qq));
    };
    mount(quotaBox, q ? quotaLine(q) : null);

    const history = await runsHistory('youtube');
    if (destroyed) return;
    mount(
      content,
      h(
        'div',
        { class: 'stack' },
        !keySet ? notice('warn', '🔑', 'Für die YouTube-Suche brauchst du einen kostenlosen API-Schlüssel. ', h('a', { href: '#/einrichtung' }, 'Jetzt unter Einrichtung eintragen →')) : null,
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'YouTube automatisch durchsuchen')),
          h('p', { class: 'muted' }, `Sucht Roblox-Videos und -Streams der letzten ${yt.publishedWithinDays || 45} Tage, prüft die Kanäle (${fmtNum(settings.radar.minFollowers)}–${fmtNum(settings.radar.maxFollowers)} Abos), liest Kontaktwege aus den Beschreibungen und bewertet jeden Kanal. YouTube erlaubt ${fmtNum(yt.dailySearchLimit || 100)} Suchen pro Tag – für 500 gute Creator also ein paar Tage einplanen.`),
          quotaBox,
          h('div', { class: 'row mt' }, h('span', { class: 'label' }, 'Sprachen:'), langChecks.map(({ l, el }) => h('label', { class: 'check' }, el, LANGUAGES[l] || l)), h('span', { style: 'width:200px' }, newLang)),
          h('div', { class: 'grid grid-2 mt' }, queryAreas.map(({ l, el }) => field(`Suchbegriffe ${LANGUAGES[l] || l}`, el, 'Ein Suchbegriff pro Zeile.'))),
          h('div', { class: 'row mt' }, field('Suchen in diesem Durchlauf (max.)', maxSearches, 'Jeder Suchbegriff × Seite = 1 Suche.'), h('span', { class: 'spacer' }), actionButton('Suchbegriffe speichern', () => saveQueries(), { cls: 'btn' }), startBtn),
        ),
        runArea,
        history,
      ),
    );
  }

  function quotaLine(q) {
    const pct = q.searchLimit ? Math.min(100, Math.round(((q.searchesUsed || 0) / q.searchLimit) * 100)) : 0;
    return h(
      'div',
      { class: 'limit', style: 'max-width:420px' },
      h('div', { class: 'row' }, h('span', null, 'Heute verbrauchte Suchen'), h('span', { class: 'muted' }, `${fmtNum(q.searchesUsed || 0)} / ${fmtNum(q.searchLimit || 100)}`)),
      h('div', { class: `progress ${pct >= 100 ? 'full' : pct >= 80 ? 'warn' : ''}` }, h('span', { style: `width:${pct}%` })),
      h('div', { class: 'help' }, `Einheiten: ${fmtNum(q.unitsUsed || 0)} / ${fmtNum(q.unitLimit || 10000)} · Neuer Tag ab ca. 9 Uhr deutscher Zeit`),
    );
  }

  // ---------------- Twitch ----------------
  async function showTwitch() {
    const [settingsRes, quotaRes] = await Promise.all([get('/settings'), tryGet('/discovery/quota')]);
    if (destroyed) return;
    const s = settingsRes.settings;
    const tw = s.radar.twitch;
    const keySet = quotaRes?.twitch?.keySet ?? (settingsRes.secrets?.TWITCH_CLIENT_ID?.set && settingsRes.secrets?.TWITCH_CLIENT_SECRET?.set);
    const langs = [...new Set([...(tw.languages || []), 'de', 'en', 'es', 'pt', 'fr', 'pl', 'tr'])];
    const checks = langs.map((l) => ({ l, el: h('input', { type: 'checkbox', checked: (tw.languages || []).includes(l) }) }));
    const minV = h('input', { type: 'number', min: 0, value: tw.minViewers ?? 1 });
    const maxV = h('input', { type: 'number', min: 1, value: tw.maxViewers ?? 250 });
    const auto = select([['0', 'Aus'], ['30', 'alle 30 Minuten'], ['60', 'stündlich'], ['120', 'alle 2 Stunden'], ['240', 'alle 4 Stunden']], String(tw.autoEveryMinutes || 0));
    const runArea = h('div');
    const saveTwitch = async (silent) => {
      await put('/settings', { radar: { twitch: { languages: checks.filter((c) => c.el.checked).map((c) => c.l), minViewers: Number(minV.value) || 0, maxViewers: Number(maxV.value) || 250, autoEveryMinutes: Number(auto.value) || 0 } } });
      if (!silent) toast('Twitch-Einstellungen gespeichert.', 'success');
    };
    const history = await runsHistory('twitch');
    if (destroyed) return;
    mount(
      content,
      h(
        'div',
        { class: 'stack' },
        !keySet ? notice('warn', '🔑', 'Für Twitch brauchst du Client-ID und Client-Secret (kostenlos). ', h('a', { href: '#/einrichtung' }, 'Unter Einrichtung eintragen →')) : null,
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Twitch: kleine Roblox-Streamer finden')),
          h('p', { class: 'muted' }, 'Holt alle Streams, die gerade in der Kategorie „Roblox“ live sind – gefiltert nach Sprache und Zuschauerzahl. Kleine Streamer findet man nur, solange sie live sind. Deshalb lohnt sich die automatische Suche über mehrere Tage (am besten nachmittags/abends).'),
          h('div', { class: 'row' }, h('span', { class: 'label' }, 'Sprachen:'), checks.map(({ l, el }) => h('label', { class: 'check' }, el, LANGUAGES[l] || l))),
          h('div', { class: 'form-grid mt' }, field('Mind. Zuschauer', minV), field('Max. Zuschauer', maxV, 'Große Streamer ausblenden'), field('Automatisch suchen', auto, 'Läuft, solange das Tool geöffnet ist.')),
          h(
            'div',
            { class: 'row mt' },
            h('span', { class: 'spacer' }),
            actionButton('Speichern', () => saveTwitch(false)),
            actionButton('▶ Jetzt suchen', async () => {
              await saveTwitch(true);
              const res = await post('/discovery/twitch', { languages: checks.filter((c) => c.el.checked).map((c) => c.l), minViewers: Number(minV.value) || 0, maxViewers: Number(maxV.value) || 250 });
              mount(runArea, runView(res.runId));
            }, { cls: 'btn btn-primary btn-lg', disabled: !keySet }),
          ),
        ),
        runArea,
        history,
      ),
    );
  }

  // ---------------- Import ----------------
  function showImport() {
    const urlText = h('textarea', { class: 'tall', placeholder: 'https://www.tiktok.com/@name\nhttps://www.youtube.com/@kanal; 12000; business@mail.de\nhttps://www.twitch.tv/streamer' });
    const lang = select([['', 'Sprache automatisch'], ...Object.entries(LANGUAGES)], '');
    const tags = h('input', { type: 'text', placeholder: 'z. B. Welle 1' });
    const result = h('div');
    const fileIn = h('input', { type: 'file', accept: '.csv,text/csv,text/plain' });
    const csvLang = select([['', 'Sprache automatisch'], ...Object.entries(LANGUAGES)], '');
    const csvTags = h('input', { type: 'text', placeholder: 'z. B. Modash-Export' });
    const csvResult = h('div');

    const showResult = (box, res) => {
      const errors = res?.errors || [];
      mount(
        box,
        h(
          'div',
          { class: 'mt' },
          notice(errors.length ? 'warn' : 'ok', errors.length ? '⚠️' : '✅', `${fmtNum(res?.added || 0)} neu, ${fmtNum(res?.updated || 0)} aktualisiert, ${fmtNum(res?.skipped || 0)} übersprungen.`),
          errors.length ? h('ul', { class: 'list mt' }, errors.slice(0, 50).map((e) => h('li', null, h('span', { class: 'badge err' }, `Zeile ${e.line}`), h('span', { class: 'grow' }, e.error)))) : null,
          h('div', { class: 'row mt' }, h('a', { class: 'btn btn-sm', href: '#/creator?sort=created' }, 'Importierte Creator ansehen')),
        ),
      );
    };

    mount(
      content,
      h(
        'div',
        { class: 'grid grid-2' },
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Profil-Links einfügen')),
          h('p', { class: 'muted' }, 'Ein Link pro Zeile – YouTube, TikTok, Instagram, Twitch, X oder Kick. Optional mit Follower und E-Mail: „Link; Follower; E-Mail“. YouTube- und Twitch-Profile werden automatisch ergänzt (wenn die Schlüssel hinterlegt sind).'),
          field('Links', urlText),
          h('div', { class: 'form-grid mt' }, field('Sprache', lang), field('Tag', tags)),
          h('div', { class: 'row mt' }, actionButton('📥 Importieren', async () => {
            if (!urlText.value.trim()) {
              toast('Bitte mindestens einen Link einfügen.', 'error');
              return;
            }
            const res = await post('/import/urls', { text: urlText.value, language: lang.value || undefined, tags: splitList(tags.value) });
            showResult(result, res);
            if ((res?.added || 0) + (res?.updated || 0) > 0) urlText.value = '';
          }, { cls: 'btn btn-primary' })),
          result,
        ),
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'CSV-Datei importieren')),
          h('p', { class: 'muted' }, 'Z. B. ein Export aus einer Creator-Datenbank (Modash, Heepsy …) oder deine eigene Liste. Erste Zeile = Spaltennamen. Erkannt werden: name, platform, url, handle, email, followers, language, notes, tags, age_group. Trennzeichen ; oder ,'),
          field('Datei', fileIn),
          h('div', { class: 'form-grid mt' }, field('Sprache', csvLang), field('Tag', csvTags)),
          h('div', { class: 'row mt' }, actionButton('📥 CSV importieren', async () => {
            const file = fileIn.files?.[0];
            if (!file) {
              toast('Bitte zuerst eine CSV-Datei auswählen.', 'error');
              return;
            }
            const csv = await readFile(file);
            const res = await post('/import/csv', { csv, language: csvLang.value || undefined, tags: splitList(csvTags.value) });
            showResult(csvResult, res);
          }, { cls: 'btn btn-primary' })),
          csvResult,
          notice('info', 'ℹ️', 'Gekaufte Datenbanken nur nutzen, wenn ihre Lizenz das erlaubt. Auch importierte Creator bekommen nur über erlaubte Kontaktwege eine Nachricht.'),
        ),
      ),
    );
  }

  // ---------------- Bookmarklet ----------------
  async function showBookmarklet() {
    let res = null;
    let error = null;
    try {
      res = await get('/bookmarklet');
    } catch (err) {
      error = err;
    }
    if (destroyed) return;
    const code = res?.code || '';
    const link = code ? h('a', { class: 'bookmarklet', title: 'In die Lesezeichenleiste ziehen', onclick: (e) => { e.preventDefault(); toast('Nicht klicken – in die Lesezeichenleiste ziehen 🙂'); } }, '📌 Zum Creator Radar') : null;
    if (link) link.setAttribute('href', code);
    mount(
      content,
      h(
        'div',
        { class: 'grid grid-2' },
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'TikTok & Instagram mit einem Klick erfassen')),
          h('p', { class: 'muted' }, 'TikTok und Instagram lassen sich nicht automatisch durchsuchen (keine erlaubte Schnittstelle). Stattdessen scrollst du selbst – und ein Klick auf dieses Lesezeichen übernimmt das Profil, das du gerade ansiehst, ins Radar. Das ist wie Kopieren & Einfügen, nur schneller.'),
          error ? errorBox(error) : h('div', { class: 'center', style: 'padding:18px' }, link),
          h(
            'ol',
            { class: 'steps mt' },
            h('li', null, h('strong', null, 'Lesezeichenleiste einblenden: '), 'Strg+Umschalt+B (Mac: ⌘+Umschalt+B).'),
            h('li', null, h('strong', null, 'Den blauen Knopf oben in die Leiste ziehen.')),
            h('li', null, 'Auf TikTok z. B. nach „roblox deutsch“, „#robloxde“ oder „roblox rivals“ suchen und ein Profil öffnen.'),
            h('li', null, 'Auf das Lesezeichen klicken → ein kleines Fenster zeigt Name, Follower und Bio → „Speichern“.'),
            h('li', null, 'Funktioniert auch auf YouTube- und Twitch-Kanälen (dann ergänzt das Tool die Daten selbst).'),
          ),
          code ? h('div', { class: 'row mt' }, actionButton('Code kopieren (für manuelles Lesezeichen)', async () => { (await copyText(code)) ? toast('Code kopiert – als Adresse eines neuen Lesezeichens einfügen.', 'success') : toast('Kopieren fehlgeschlagen.', 'error'); }, { cls: 'btn btn-sm' })) : null,
        ),
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Worauf du achten solltest')),
          h(
            'ul',
            { class: 'list' },
            h('li', null, '✅', h('div', { class: 'grow' }, h('strong', null, 'Business-Mail in der Bio? '), 'Dann ist E-Mail der beste Weg.')),
            h('li', null, '✅', h('div', { class: 'grow' }, h('strong', null, '„DM for collabs“ / „Anfragen per DM“? '), 'Dann darf eine DM raus – das Tool erkennt das aus der Bio.')),
            h('li', null, '⚠️', h('div', { class: 'grow' }, h('strong', null, 'Nichts davon? '), 'Dann lieber nicht per DM anschreiben (rechtlich riskant, Spam-Gefahr).')),
            h('li', null, '🔞', h('div', { class: 'grow' }, h('strong', null, 'Wirkt sehr jung? '), 'TikTok-DMs gibt es erst ab 16 – Kinder nicht anschreiben.')),
            h('li', null, '🐢', h('div', { class: 'grow' }, h('strong', null, 'Langsam & persönlich: '), 'Lieber 20 gute Nachrichten am Tag als 100 gleiche – sonst sperrt die Plattform dein Konto.')),
          ),
        ),
      ),
    );
  }

  await show();
  return () => {
    destroyed = true;
    stopPolling();
  };
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsText(file, 'utf-8');
  });
}

