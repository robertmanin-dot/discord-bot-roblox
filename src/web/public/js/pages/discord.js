// Discord: bot status, setup guide, applications, leaderboard, content submissions.
import { get, post, tryGet, ApiError } from '../api.js';
import { h, mount, loading, empty, errorBox, toast, confirmDialog, fmtNum, fmtDateTime, fmtRelative, notice, actionButton, extLink, AGE_GROUPS, LANGUAGES, PLATFORM_LABELS, setQuery } from '../ui.js';

const APP_STATUS = { offen: 'Offen', eltern_ausstehend: 'Eltern-OK ausstehend', angenommen: 'Angenommen', abgelehnt: 'Abgelehnt', zurueckgezogen: 'Zurückgezogen' };
const APP_BADGE = { offen: 'info', eltern_ausstehend: 'warn', angenommen: 'ok', abgelehnt: 'err', zurueckgezogen: '' };
const CONTENT_STATUS = { offen: 'Offen', bestaetigt: 'Bestätigt', abgelehnt: 'Abgelehnt' };
const KIND_LABELS = { video: 'Video', short: 'Short/Clip', stream: 'Stream' };

export async function render(root, { query }) {
  let destroyed = false;
  let appFilter = query.get('apps') || 'offen';
  let lbKind = query.get('lb') || 'creator';
  mount(root, loading());

  const [status, overview] = await Promise.all([tryGet('/status'), get('/discord/overview').catch((e) => e)]);
  if (destroyed) return;
  const bot = (overview && !(overview instanceof Error) ? overview.bot : null) || status?.bot || {};
  const ov = overview instanceof Error ? null : overview;

  const appsBox = h('div');
  const lbBox = h('div');
  const contentBox = h('div');

  // ---------- Bot + setup ----------
  const online = bot.state === 'ready';
  const statusCard = h(
    'div',
    { class: `card ${online ? '' : 'warn'}` },
    h('div', { class: 'card-head' }, h('h2', null, '🤖 Creator HQ (Discord-Bot)')),
    h(
      'div',
      { class: 'row' },
      h('span', { class: `dot ${online ? 'green pulse' : bot.state === 'error' ? 'red' : 'grey'}` }),
      h('strong', null, online ? `Online als ${bot.tag || 'Bot'}` : bot.state === 'connecting' ? 'Verbindet …' : bot.state === 'error' ? 'Fehler beim Verbinden' : 'Nicht verbunden'),
      bot.guild ? h('span', { class: 'muted' }, `· Server: ${bot.guild.name} (${fmtNum(bot.guild.memberCount)} Mitglieder)`) : null,
    ),
    bot.error ? notice('err', '⚠️', bot.error) : null,
    !online ? h('p', { class: 'mt' }, 'Trag zuerst den Bot-Token unter ', h('a', { href: '#/einrichtung' }, 'Einrichtung'), ' ein.') : null,
    online
      ? h(
        'ol',
        { class: 'steps mt' },
        h('li', { class: bot.guild ? 'muted' : '' }, h('strong', null, 'Bot auf deinen Server einladen. '), bot.inviteUrl ? h('a', { class: 'btn btn-sm btn-primary', href: bot.inviteUrl, target: '_blank', rel: 'noopener' }, 'Bot einladen ↗') : 'Einladungslink erscheint, sobald der Bot online ist.', bot.guild ? ' ✅' : null),
        h('li', { class: ov?.setupDone ? 'muted' : '' }, h('strong', null, 'Im Discord „/setup“ eingeben '), '(als Admin). Der Bot legt Rollen, Kanäle und die Buttons für Bewerbung und Tester an.', ov?.setupDone ? ' ✅' : null),
        h('li', null, h('strong', null, 'Fertig: '), 'Creator bewerben sich in #creator-bewerbung, Tester melden sich in #tester-werden. Du entscheidest hier oder direkt im Kanal #bewerbungen.'),
      )
      : null,
    ov?.missing?.length ? notice('warn', '🧩', h('div', null, h('strong', null, 'Noch offen: '), h('ul', { style: 'margin:4px 0 0;padding-left:18px' }, ov.missing.map((m) => h('li', null, m))))) : null,
  );

  const counts = ov?.counts || {};
  const apps = counts.applications || {};
  const countsCard = ov
    ? h(
      'div',
      { class: 'grid grid-4' },
      statBox(fmtNum(apps.offen || 0), 'offene Bewerbungen'),
      statBox(fmtNum(apps.eltern_ausstehend || 0), 'warten auf Eltern-OK'),
      statBox(fmtNum(counts.members || 0), `Creator im Programm${counts.founding ? ` (${counts.founding} Founding)` : ''}`),
      statBox(fmtNum(counts.testers || 0), 'Tester'),
    )
    : null;

  // ---------- Applications ----------
  async function loadApps() {
    mount(appsBox, loading());
    let res;
    try {
      res = await get('/discord/applications', { status: appFilter === 'alle' ? '' : appFilter });
    } catch (err) {
      mount(appsBox, err instanceof ApiError && err.missing ? empty('🛠️', 'Bewerbungen noch nicht verfügbar', err.message) : errorBox(err, loadApps));
      return;
    }
    if (destroyed) return;
    const items = res?.items || [];
    const tabs = h(
      'div',
      { class: 'tabs' },
      [['offen', 'Offen'], ['eltern_ausstehend', 'Eltern-OK ausstehend'], ['angenommen', 'Angenommen'], ['abgelehnt', 'Abgelehnt'], ['alle', 'Alle']].map(([k, label]) =>
        h('button', { class: `tab ${appFilter === k ? 'active' : ''}`, onclick: () => { appFilter = k; setQuery({ apps: k, lb: lbKind }); loadApps(); } }, label, k === 'offen' && apps.offen ? h('span', { class: 'count' }, apps.offen) : null, k === 'eltern_ausstehend' && apps.eltern_ausstehend ? h('span', { class: 'count' }, apps.eltern_ausstehend) : null),
      ),
    );
    mount(
      appsBox,
      tabs,
      items.length
        ? h('div', { class: 'stack' }, items.map((a) => applicationCard(a, loadApps, online)))
        : empty('📭', 'Keine Bewerbungen', appFilter === 'offen' ? 'Sobald sich jemand über den Button in #creator-bewerbung bewirbt, erscheint die Bewerbung hier.' : 'In dieser Ansicht gibt es keine Einträge.'),
    );
  }

  // ---------- Leaderboard ----------
  async function loadLeaderboard() {
    mount(lbBox, loading());
    let res;
    try {
      res = await get('/discord/leaderboard', { kind: lbKind, limit: 25 });
    } catch (err) {
      mount(lbBox, err instanceof ApiError && err.missing ? empty('🛠️', 'Rangliste noch nicht verfügbar', err.message) : errorBox(err, loadLeaderboard));
      return;
    }
    if (destroyed) return;
    const items = res?.items || [];
    mount(
      lbBox,
      h('div', { class: 'tabs' }, [['creator', '🎬 Creator'], ['tester', '🧪 Tester']].map(([k, label]) => h('button', { class: `tab ${lbKind === k ? 'active' : ''}`, onclick: () => { lbKind = k; setQuery({ apps: appFilter, lb: k }); loadLeaderboard(); } }, label))),
      items.length
        ? h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'table compact' },
            h('thead', null, h('tr', null, h('th', { class: 'num' }, '#'), h('th', null, 'Name'), h('th', { class: 'num' }, 'Punkte'), h('th', null, 'Rang'))),
            h('tbody', null, items.map((r, i) => h('tr', null, h('td', { class: 'num' }, r.rank ?? i + 1), h('td', null, r.name || r.discord_user_id), h('td', { class: 'num' }, fmtNum(r.points)), h('td', null, typeof r.tier === 'object' ? r.tier?.name : r.tier || '–')))),
          ),
        )
        : empty('🏆', 'Noch keine Punkte', lbKind === 'creator' ? 'Creator sammeln Punkte für Videos, Streams und die Teilnahme an Events.' : 'Tester sammeln Punkte für Playtests, Feedback und bestätigte Bugs.'),
      h('p', { class: 'help mt' }, 'Punkte bringen Ränge und Status (z. B. exklusive Ingame-Items, Vorrang bei Kampagnen) – keine Robux- oder Geldpreise, das verbieten die Roblox-Regeln.'),
    );
  }

  // ---------- Content ----------
  async function loadContent() {
    mount(contentBox, loading());
    let res;
    try {
      res = await get('/discord/content');
    } catch (err) {
      mount(contentBox, err instanceof ApiError && err.missing ? empty('🛠️', 'Content-Liste noch nicht verfügbar', err.message) : errorBox(err, loadContent));
      return;
    }
    if (destroyed) return;
    const items = res?.items || [];
    mount(
      contentBox,
      items.length
        ? h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'table compact' },
            h('thead', null, h('tr', null, h('th', null, 'Eingereicht'), h('th', null, 'Von'), h('th', null, 'Art'), h('th', null, 'Link'), h('th', null, 'Status'))),
            h(
              'tbody',
              null,
              items.map((c) => h('tr', null, h('td', { class: 'nowrap small' }, fmtDateTime(c.created_at)), h('td', null, c.display_name || c.discord_tag || c.discord_user_id), h('td', null, KIND_LABELS[c.kind] || c.kind), h('td', { class: 'break' }, extLink(c.url, c.url)), h('td', null, h('span', { class: `badge ${c.status === 'bestaetigt' ? 'ok' : c.status === 'abgelehnt' ? 'err' : 'info'}` }, CONTENT_STATUS[c.status] || c.status)))),
            ),
          ),
        )
        : empty('🎥', 'Noch kein Content eingereicht', 'Creator reichen Videos und Streams im Discord mit /content ein. Bestätigen kannst du sie im Kanal #bewerbungen.'),
    );
  }

  mount(
    root,
    h(
      'div',
      { class: 'stack' },
      statusCard,
      countsCard,
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '📝 Bewerbungen')), appsBox),
      h('div', { class: 'grid grid-2' }, h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '🏆 Rangliste')), lbBox), h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '🎥 Content-Einreichungen')), contentBox)),
      h(
        'div',
        { class: 'card soft' },
        h('h3', null, 'Befehle im Discord'),
        h(
          'ul',
          { class: 'list' },
          cmd('/setup', 'Legt Rollen, Kanäle und Buttons an (nur Admins).'),
          cmd('/creator code', 'Creator sehen ihren Code und Share Link.'),
          cmd('/live', 'Creator melden „Ich bin live“ – erscheint in #jetzt-live.'),
          cmd('/content', 'Creator reichen Videos/Streams für Punkte ein.'),
          cmd('/rangliste', 'Zeigt die Rangliste.'),
          cmd('/playtest erstellen', 'Playtest-Termin mit Anmeldung (Team).'),
          cmd('/event erstellen', 'Launch Hour oder wöchentliches Event (Team).'),
          cmd('/bug · /feedback', 'Tester melden Bugs und geben Feedback.'),
          cmd('/hilfe', 'Alle Befehle im Überblick.'),
        ),
      ),
    ),
  );
  await Promise.all([loadApps(), loadLeaderboard(), loadContent()]);
  return () => {
    destroyed = true;
  };
}

function statBox(num, label) {
  return h('div', { class: 'card' }, h('div', { class: 'stat' }, h('span', { class: 'num' }, num), h('span', { class: 'lbl' }, label)));
}

function cmd(name, text) {
  return h('li', null, h('code', null, name), h('span', { class: 'grow' }, text));
}

function applicationCard(a, reload, online) {
  const act = (action, label, cls, confirmText) =>
    actionButton(label, async () => {
      if (confirmText && !(await confirmDialog({ title: label, text: confirmText, confirmText: label, danger: action === 'reject' }))) return;
      await post(`/discord/applications/${a.id}/${action}`);
      toast(action === 'accept' ? 'Angenommen – der Bot vergibt Rolle und Code.' : action === 'reject' ? 'Abgelehnt.' : 'Eltern-OK vermerkt.', 'success');
      reload();
    }, { cls, disabled: !online, title: online ? '' : 'Bot ist offline' });
  const minor = a.age_group && a.age_group !== '18+';
  const canAccept = a.status === 'offen';
  return h(
    'div',
    { class: 'card flat' },
    h(
      'div',
      { class: 'row between top' },
      h(
        'div',
        null,
        h('div', { class: 'row' }, h('strong', null, a.display_name || a.discord_tag || a.discord_user_id), h('span', { class: `badge ${APP_BADGE[a.status] || ''}` }, APP_STATUS[a.status] || a.status), minor ? h('span', { class: 'badge warn' }, `Alter ${AGE_GROUPS[a.age_group] || a.age_group}`) : h('span', { class: 'badge' }, AGE_GROUPS[a.age_group] || a.age_group || 'Alter ?')),
        h('div', { class: 'help mt' }, [a.discord_tag ? `Discord: ${a.discord_tag}` : null, a.platform ? PLATFORM_LABELS[a.platform] || a.platform : null, a.followers != null ? `${fmtNum(a.followers)} Follower` : null, a.language ? LANGUAGES[a.language] || a.language : null, `eingegangen ${fmtRelative(a.created_at)}`].filter(Boolean).join(' · ')),
      ),
      a.creator_id ? h('a', { class: 'btn btn-sm', href: `#/creator/${a.creator_id}` }, 'Creator-Profil') : null,
    ),
    a.channel_url ? h('div', { class: 'mt break' }, '📺 ', extLink(a.channel_url, a.channel_url)) : null,
    a.other_links ? h('div', { class: 'help break' }, a.other_links) : null,
    a.intro ? h('p', { class: 'mt', style: 'white-space:pre-wrap' }, a.intro) : null,
    a.status === 'eltern_ausstehend' ? notice('warn', '👪', 'Unter 16: Erst annehmen, wenn das unterschriebene Eltern-Einverständnis da ist (Vorlage in docs/ELTERN-EINVERSTAENDNIS.md).') : null,
    a.reject_reason ? h('div', { class: 'help mt' }, `Grund: ${a.reject_reason}`) : null,
    a.status === 'offen' || a.status === 'eltern_ausstehend'
      ? h(
        'div',
        { class: 'row mt' },
        a.status === 'eltern_ausstehend' ? act('parent-ok', '👪 Eltern-OK erhalten', 'btn btn-sm', 'Liegt das unterschriebene Einverständnis der Eltern vor?') : null,
        canAccept ? act('accept', '✓ Annehmen', 'btn btn-sm btn-success') : null,
        act('reject', '✕ Ablehnen', 'btn btn-sm btn-danger', 'Bewerbung ablehnen? Die Person bekommt eine freundliche Nachricht.'),
      )
      : null,
  );
}
