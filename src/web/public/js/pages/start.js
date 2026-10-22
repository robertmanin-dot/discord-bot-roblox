import { get, tryGet } from '../api.js';
import { h, mount, loading, errorBox, fmtNum, fmtLongDate, STATUS_ORDER, STATUS_SIDE, STATUS_LABELS, notice } from '../ui.js';

const WHERE_LINKS = { einstellungen: '#/einstellungen', einrichtung: '#/einrichtung', discord: '#/discord' };

function countdown(launchAt) {
  const target = new Date(launchAt).getTime();
  const units = h('div', { class: 'countdown' });
  const update = () => {
    let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
    const d = Math.floor(s / 86400);
    s -= d * 86400;
    const hh = Math.floor(s / 3600);
    s -= hh * 3600;
    const mm = Math.floor(s / 60);
    mount(
      units,
      [[d, 'Tage'], [hh, 'Stunden'], [mm, 'Minuten']].map(([n, l]) => h('div', { class: 'unit' }, h('b', null, String(n)), h('span', null, l))),
    );
  };
  update();
  return { el: units, update };
}

function checklistCard(setup) {
  const required = setup.filter((i) => !i.optional);
  const doneCount = required.filter((i) => i.done).length;
  const allDone = doneCount === required.length;
  const pct = required.length ? Math.round((doneCount / required.length) * 100) : 100;
  return h(
    'div',
    { class: `card ${allDone ? 'ok' : ''}` },
    h('div', { class: 'card-head' }, h('h2', null, allDone ? '✅ Einrichtung abgeschlossen' : '🧭 Einrichtung'), h('span', { class: 'muted small' }, `${doneCount} von ${required.length} erledigt`)),
    h('div', { class: `progress ${allDone ? 'ok' : ''}` }, h('span', { style: `width:${pct}%` })),
    h(
      'ul',
      { class: 'list checklist mt' },
      setup.map((item) =>
        h(
          'li',
          { class: item.done ? 'done' : '' },
          h('span', { class: 'mark' }, item.done ? '✅' : item.optional ? '➖' : '⬜'),
          h(
            'div',
            { class: 'grow' },
            h('div', { class: 'lbl' }, item.label, item.optional && !item.done ? h('span', { class: 'muted small' }, ' (optional)') : null),
            item.detail && !item.done ? h('div', { class: 'help', style: 'color:var(--danger)' }, item.detail) : null,
          ),
          !item.done && WHERE_LINKS[item.where] ? h('a', { class: 'btn btn-sm', href: WHERE_LINKS[item.where] }, 'Erledigen →') : null,
        ),
      ),
    ),
  );
}

function funnelCard(byStatus) {
  const max = Math.max(1, ...STATUS_ORDER.map((s) => byStatus[s] || 0));
  const side = STATUS_SIDE.filter((s) => byStatus[s]);
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, '📈 Pipeline'), h('a', { href: '#/statistik', class: 'small' }, 'Zur Statistik →')),
    h(
      'div',
      { class: 'funnel' },
      STATUS_ORDER.map((s) =>
        h(
          'a',
          { class: 'frow', href: `#/creator?status=${s}`, style: 'color:inherit;text-decoration:none' },
          h('span', null, STATUS_LABELS[s]),
          h('div', { class: 'track' }, h('div', { class: 'bar', style: `width:${barPct(byStatus[s], max)}%` })),
          h('span', { class: 'right' }, fmtNum(byStatus[s] || 0)),
        ),
      ),
    ),
    side.length
      ? h('div', { class: 'chips mt' }, side.map((s) => h('a', { class: 'chip', href: `#/creator?status=${s}` }, `${STATUS_LABELS[s]}: ${fmtNum(byStatus[s])}`)))
      : null,
  );
}

export async function render(root) {
  mount(root, loading());
  let status;
  try {
    status = await get('/status');
  } catch (err) {
    mount(root, errorBox(err, () => render(root)));
    return;
  }
  const [qFirst, qFollow, discord] = await Promise.all([
    tryGet('/queue', { mode: 'first', limit: 1 }),
    tryGet('/queue', { mode: 'followup', limit: 1 }),
    tryGet('/discord/overview'),
  ]);

  const game = status.game || {};
  const counts = status.counts || {};
  const bot = status.bot || {};
  const quota = status.quota || {};
  const apps = discord?.counts?.applications || {};
  const openApps = (apps.offen || 0) + (apps.eltern_ausstehend || 0);
  const limits = qFirst?.limits || null;
  const sentToday = limits ? Object.values(limits).reduce((a, l) => a + (l.used || 0), 0) : null;
  const maxToday = limits ? Object.values(limits).reduce((a, l) => a + (l.max || 0), 0) : null;

  let timer = null;
  let hero;
  if (game.launchAt && new Date(game.launchAt).getTime() > Date.now()) {
    const cd = countdown(game.launchAt);
    timer = setInterval(cd.update, 30000);
    hero = h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'hero' },
        h('div', { class: 'grow', style: 'flex:1;min-width:220px' }, h('h2', null, `🚀 ${game.name || 'Dein Spiel'} – Launch`), h('div', { class: 'muted' }, fmtLongDate(game.launchAt, game.timezone || 'Europe/Berlin') + ' Uhr')),
        cd.el,
      ),
    );
  } else if (game.launchAt) {
    hero = h('div', { class: 'card ok' }, h('h2', null, `🎉 ${game.name || 'Dein Spiel'} ist gelauncht`), h('div', { class: 'muted' }, `Launch war am ${fmtLongDate(game.launchAt, game.timezone || 'Europe/Berlin')} Uhr. Weiter geht's mit den wöchentlichen Creator-Events.`));
  } else {
    hero = h(
      'div',
      { class: 'card warn' },
      h('h2', null, '👋 Willkommen!'),
      h('p', null, 'Trag zuerst dein Spiel und den Launch-Termin ein – die Nachrichten an Creator nutzen diese Angaben.'),
      h('a', { class: 'btn btn-primary', href: '#/einstellungen' }, 'Spiel-Infos eintragen'),
    );
  }

  const tasks = h(
    'div',
    { class: 'grid grid-4' },
    taskCard('✉️', qFirst ? fmtNum(qFirst.total) : '–', 'Creator warten auf die erste Nachricht', '#/senden', 'Jetzt senden'),
    taskCard('🔁', qFollow ? fmtNum(qFollow.total) : '–', 'Nachfass-Mails sind fällig', '#/senden?mode=followup', 'Nachfassen'),
    taskCard('📝', discord ? fmtNum(openApps) : '–', 'Bewerbungen warten auf dich', '#/discord', 'Prüfen'),
    taskCard('📬', sentToday === null ? '–' : `${fmtNum(sentToday)} / ${fmtNum(maxToday)}`, 'Heute gesendet (Tageslimit)', '#/senden', 'Zum Senden'),
  );

  const numbers = h(
    'div',
    { class: 'grid grid-4' },
    statCard(fmtNum(counts.creators), 'Creator im Radar', '#/creator'),
    statCard(fmtNum((counts.byStatus?.kontaktiert || 0) + (counts.byStatus?.nachgefasst || 0)), 'warten auf Antwort', '#/creator?status=kontaktiert,nachgefasst'),
    statCard(fmtNum(counts.members), 'Creator im Programm', '#/creator?member=1'),
    statCard(fmtNum(counts.testers), 'aktive Tester', '#/playtests'),
  );

  const botCard = h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, '💬 Discord-Bot')),
    bot.state === 'ready'
      ? h('div', null, h('div', { class: 'row' }, h('span', { class: 'dot green pulse' }), h('strong', null, `Online als ${bot.tag || 'Bot'}`)), h('div', { class: 'muted small mt' }, bot.guild ? `Server: ${bot.guild.name} (${fmtNum(bot.guild.memberCount)} Mitglieder)` : 'Noch auf keinem Server – unter Einrichtung einladen.'))
      : h(
        'div',
        null,
        h('div', { class: 'row' }, h('span', { class: `dot ${bot.state === 'error' ? 'red' : 'grey'}` }), h('strong', null, bot.state === 'connecting' ? 'Verbindet …' : bot.state === 'error' ? 'Fehler' : 'Nicht verbunden')),
        bot.error ? h('div', { class: 'help mt', style: 'color:var(--danger)' }, bot.error) : h('div', { class: 'muted small mt' }, 'Trag den Bot-Token unter Einrichtung ein.'),
        h('a', { class: 'btn btn-sm mt', href: '#/einrichtung' }, 'Zur Einrichtung'),
      ),
  );

  const quotaCard = h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, '🔎 YouTube-Kontingent heute')),
    status.secrets?.YOUTUBE_API_KEY?.set
      ? h(
        'div',
        null,
        quotaRow('Suchen', quota.youtubeSearches, quota.youtubeSearchLimit),
        quotaRow('Einheiten', quota.youtubeUnits, quota.youtubeUnitLimit),
        h('div', { class: 'help mt' }, 'Setzt sich um 9 Uhr deutscher Zeit (Mitternacht in Kalifornien) zurück.'),
      )
      : h('div', null, h('p', { class: 'muted' }, 'Noch kein YouTube-Schlüssel hinterlegt.'), h('a', { class: 'btn btn-sm', href: '#/einrichtung' }, 'Schlüssel eintragen')),
  );

  mount(
    root,
    h(
      'div',
      { class: 'stack' },
      hero,
      tasks,
      checklistCard(status.setup || []),
      h('div', { class: 'grid grid-2' }, funnelCard(counts.byStatus || {}), h('div', { class: 'stack' }, botCard, quotaCard)),
      numbers,
      notice('info', '💡', 'Tipp: Arbeite in Wellen – erst 50 Creator mit zwei Vorlagen (A/B), nach ein paar Tagen in der Statistik schauen, welche besser ankommt, dann die nächsten 150.'),
    ),
  );
  return () => timer && clearInterval(timer);
}

function taskCard(ico, num, label, href, action) {
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, ico), h('a', { class: 'num', href }, num), h('span', { class: 'lbl' }, label)),
    h('a', { class: 'btn btn-sm mt', href }, action),
  );
}

function statCard(num, label, href) {
  return h('div', { class: 'card' }, h('div', { class: 'stat' }, h('a', { class: 'num', href }, num), h('span', { class: 'lbl' }, label)));
}

function quotaRow(label, used = 0, max = 0) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return h(
    'div',
    { class: 'limit mt' },
    h('div', { class: 'row' }, h('span', null, label), h('span', { class: 'muted' }, `${fmtNum(used)} / ${fmtNum(max)}`)),
    h('div', { class: `progress ${pct >= 100 ? 'full' : pct >= 80 ? 'warn' : ''}` }, h('span', { style: `width:${pct}%` })),
  );
}

function barPct(v, max) {
  const n = Number(v) || 0;
  return n > 0 ? Math.max(1.5, (n / max) * 100) : 0;
}
