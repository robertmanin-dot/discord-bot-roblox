// Einrichtung: secrets (.env) step by step + bot status. Secret values are never shown.
import { get, put } from '../api.js';
import { h, mount, loading, errorBox, toast, notice, actionButton, extLink, confirmDialog, modal } from '../ui.js';

const STEPS = [
  {
    key: 'discord',
    title: 'Discord-Bot verbinden',
    secrets: [{ name: 'DISCORD_TOKEN', label: 'Bot-Token', placeholder: 'Token aus dem Developer Portal einfügen' }],
    intro: 'Der Bot betreut deine Creator und Tester im Discord: Bewerbungen, Rollen, Codes, Playtests, Erinnerungen und die Launch Hour.',
    steps: [
      ['Öffne das ', ['Discord Developer Portal', 'https://discord.com/developers/applications'], ' und klicke auf „New Application“. Name z. B. „Creator HQ“.'],
      ['Links auf „Bot“ → „Reset Token“ → Token kopieren und unten einfügen.'],
      ['Auf derselben Seite unter „Privileged Gateway Intents“ den Schalter „Server Members Intent“ einschalten → „Save Changes“.'],
      ['Speichern – der Bot verbindet sich automatisch. Danach erscheint hier ein Button „Bot einladen“.'],
      ['Nach dem Einladen im Discord „/setup“ eingeben – fertig.'],
    ],
  },
  {
    key: 'youtube',
    title: 'YouTube-Suche freischalten',
    secrets: [{ name: 'YOUTUBE_API_KEY', label: 'YouTube-API-Schlüssel', placeholder: 'AIza…' }],
    intro: 'Kostenlos. Damit sucht das Tool automatisch nach kleinen Roblox-Kanälen (100 Suchen pro Tag).',
    steps: [
      ['Öffne die ', ['Google Cloud Console', 'https://console.cloud.google.com/'], ' und lege oben ein neues Projekt an (z. B. „Creator Radar“).'],
      ['Gehe zu ', ['„YouTube Data API v3“', 'https://console.cloud.google.com/apis/library/youtube.googleapis.com'], ' und klicke „Aktivieren“.'],
      ['Dann ', ['„Anmeldedaten“', 'https://console.cloud.google.com/apis/credentials'], ' → „Anmeldedaten erstellen“ → „API-Schlüssel“.'],
      ['Empfohlen: Schlüssel bearbeiten → „API-Einschränkungen“ → nur „YouTube Data API v3“ erlauben.'],
      ['Schlüssel unten einfügen und speichern.'],
    ],
  },
  {
    key: 'twitch',
    title: 'Twitch-Suche freischalten (optional)',
    secrets: [
      { name: 'TWITCH_CLIENT_ID', label: 'Client-ID', placeholder: 'Client-ID' },
      { name: 'TWITCH_CLIENT_SECRET', label: 'Client-Secret', placeholder: 'Client-Secret' },
    ],
    intro: 'Kostenlos. Findet kleine Streamer, die gerade Roblox streamen – und meldet im Discord automatisch, wenn deine Creator auf Twitch live gehen.',
    steps: [
      ['Öffne die ', ['Twitch Developer Console', 'https://dev.twitch.tv/console/apps'], ' (mit deinem Twitch-Konto anmelden, 2FA muss aktiv sein).'],
      ['„Register Your Application“: Name z. B. „Creator Radar“, OAuth Redirect URL „http://localhost“, Kategorie „Website Integration“, Client-Typ „Confidential“.'],
      ['Nach dem Anlegen „Manage“ → Client-ID kopieren, „New Secret“ → Secret kopieren.'],
      ['Beides unten einfügen und speichern.'],
    ],
  },
  {
    key: 'password',
    title: 'Dashboard-Passwort (optional)',
    secrets: [{ name: 'DASHBOARD_PASSWORD', label: 'Passwort', placeholder: 'nur nötig für Zugriff von anderen Geräten' }],
    intro: 'Nur nötig, wenn das Tool auf einem Server läuft oder du von anderen Geräten zugreifen willst. Der Browser fragt dann nach dem Passwort (Benutzername egal).',
    steps: [],
  },
];

export async function render(root, { refreshStatus }) {
  let destroyed = false;
  let poll = null;
  async function load() {
    mount(root, loading());
    let status;
    try {
      status = await get('/status');
    } catch (err) {
      mount(root, errorBox(err, load));
      return;
    }
    if (destroyed) return;
    draw(status);
  }

  function draw(status) {
    const secrets = status.secrets || {};
    const bot = status.bot || {};
    const cards = STEPS.map((step, i) => stepCard(step, i + 1, secrets, bot, status));
    const gameOk = (status.setup || []).find((s) => s.key === 'game')?.done;
    mount(
      root,
      h(
        'div',
        { class: 'stack' },
        notice('info', '🔒', 'Zugangsdaten werden nur lokal in der Datei .env im Programmordner gespeichert und hier nie wieder angezeigt (nur „gesetzt ••••1234“). Nicht in Chats oder Screenshots teilen.'),
        cards,
        h(
          'div',
          { class: `card setup-step ${gameOk ? 'done' : ''}` },
          h('div', { class: 'card-head' }, h('span', { class: 'num' }, gameOk ? '✓' : String(STEPS.length + 1)), h('h2', null, 'Spiel-Infos & Launch-Termin')),
          h('p', { class: 'muted' }, 'Name, Kurzbeschreibung, Links (Infoseite, Datenschutz) und Launch-Termin – das steht später in jeder Nachricht.'),
          h('a', { class: 'btn btn-primary', href: '#/einstellungen' }, 'Zu den Einstellungen →'),
        ),
        h(
          'div',
          { class: 'card soft' },
          h('div', { class: 'row between' }, h('h3', { style: 'margin:0' }, 'Probleme?'), actionButton('📜 Protokoll anzeigen', async () => {
            const r = await get('/logs', { level: 'info' });
            modal({ title: 'Protokoll (letzte Einträge)', wide: true, body: h('pre', { class: 'log', style: 'max-height:60vh' }, (r?.lines || []).join('\n') || 'Leer.') });
          }, { cls: 'btn btn-sm' })),
          h('p', { class: 'help mt' }, 'Das Protokoll zeigt Fehlermeldungen vom Bot und von den Suchen. Es enthält keine Zugangsdaten.'),
        ),
      ),
    );
  }

  function stepCard(step, num, secrets, bot) {
    const allSet = step.secrets.every((s) => secrets[s.name]?.set);
    const inputs = step.secrets.map((s) => ({ ...s, el: h('input', { type: 'password', placeholder: secrets[s.name]?.set ? `gesetzt ${secrets[s.name].hint || '••••'} – zum Ändern neu eingeben` : s.placeholder, autocomplete: 'off', spellcheck: 'false' }) }));
    const showToggle = h('label', { class: 'check small' }, h('input', { type: 'checkbox', onchange: (e) => inputs.forEach((i) => { i.el.type = e.target.checked ? 'text' : 'password'; }) }), 'Eingabe anzeigen');
    const save = actionButton('Speichern', async () => {
      const body = {};
      for (const i of inputs) if (i.el.value.trim()) body[i.name] = i.el.value.trim();
      if (!Object.keys(body).length) {
        toast('Bitte zuerst einen Wert eingeben.', 'error');
        return;
      }
      if (body.DISCORD_TOKEN && !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(body.DISCORD_TOKEN)) {
        const ok = await confirmDialog({ title: 'Sieht nicht wie ein Bot-Token aus', text: 'Ein Discord-Bot-Token besteht aus drei Teilen mit Punkten dazwischen. Hast du vielleicht die Client-ID oder das Client-Secret kopiert? Trotzdem speichern?', confirmText: 'Trotzdem speichern' });
        if (!ok) return;
      }
      await put('/secrets', body);
      toast('Gespeichert.', 'success');
      refreshStatus?.();
      if (body.DISCORD_TOKEN) waitForBot();
      else load();
    }, { cls: 'btn btn-primary' });
    const remove = step.secrets.some((s) => secrets[s.name]?.set)
      ? actionButton('Entfernen', async () => {
        if (!(await confirmDialog({ title: `${step.title}: Zugangsdaten entfernen?`, text: 'Die gespeicherten Werte werden aus der .env-Datei gelöscht.', confirmText: 'Entfernen', danger: true }))) return;
        const body = Object.fromEntries(step.secrets.map((s) => [s.name, '']));
        await put('/secrets', body);
        toast('Entfernt.', 'success');
        refreshStatus?.();
        load();
      }, { cls: 'btn btn-ghost' })
      : null;

    let botBox = null;
    if (step.key === 'discord') {
      const online = bot.state === 'ready';
      botBox = h(
        'div',
        { class: 'mt' },
        online
          ? notice('ok', '✅', h('div', null, h('strong', null, `Bot online als ${bot.tag || 'Bot'}. `), bot.guild ? `Auf Server „${bot.guild.name}“.` : 'Jetzt auf deinen Server einladen:'), bot.inviteUrl && !bot.guild ? h('div', { class: 'mt' }, h('a', { class: 'btn btn-primary', href: bot.inviteUrl, target: '_blank', rel: 'noopener' }, '➕ Bot einladen ↗')) : null, bot.guild ? h('div', { class: 'help mt' }, 'Nächster Schritt: Im Discord „/setup“ eingeben. ', bot.inviteUrl ? extLink(bot.inviteUrl, 'Einladungslink (für einen anderen Server)') : null) : null)
          : bot.state === 'connecting'
            ? notice('info', '⏳', 'Bot verbindet sich …')
            : bot.state === 'error'
              ? notice('err', '⚠️', h('div', null, h('strong', null, 'Verbindung fehlgeschlagen: '), bot.error || 'Unbekannter Fehler'))
              : secrets.DISCORD_TOKEN?.set ? notice('warn', '⏸', 'Token gespeichert, Bot ist aber nicht verbunden. Programm neu starten oder Token neu speichern.') : null,
      );
    }

    return h(
      'div',
      { class: `card setup-step ${allSet && (step.key !== 'discord' || bot.state === 'ready') ? 'done' : ''}` },
      h('div', { class: 'card-head' }, h('span', { class: 'num' }, allSet ? '✓' : String(num)), h('h2', null, step.title), allSet ? h('span', { class: 'badge ok' }, 'eingerichtet') : step.key === 'twitch' || step.key === 'password' ? h('span', { class: 'badge' }, 'optional') : h('span', { class: 'badge warn' }, 'fehlt')),
      h('p', { class: 'muted' }, step.intro),
      step.steps.length
        ? h(
          'details',
          { open: !allSet },
          h('summary', { style: 'cursor:pointer;font-weight:600' }, 'Schritt für Schritt'),
          h('ol', { class: 'steps mt' }, step.steps.map((parts) => h('li', null, parts.map((p) => (Array.isArray(p) ? extLink(p[1], p[0]) : p))))),
        )
        : null,
      h(
        'div',
        { class: 'form-grid mt' },
        inputs.map((i) => h('div', { class: 'field' }, h('label', null, i.label), i.el, h('div', { class: 'help secret-status' }, secrets[i.name]?.set ? `✅ gesetzt ${secrets[i.name].hint || ''}` : '— noch nicht gesetzt'))),
      ),
      h('div', { class: 'row mt' }, save, remove, h('span', { class: 'spacer' }), showToggle),
      botBox,
    );
  }

  function waitForBot() {
    let tries = 0;
    if (poll) clearInterval(poll);
    load();
    poll = setInterval(async () => {
      tries++;
      const s = await get('/status').catch(() => null);
      if (destroyed) return;
      if (s && (s.bot?.state === 'ready' || s.bot?.state === 'error' || tries > 15)) {
        clearInterval(poll);
        poll = null;
        refreshStatus?.();
        draw(s);
        if (s.bot?.state === 'ready') toast('Bot ist online! 🎉', 'success');
      }
    }, 2000);
  }

  await load();
  return () => {
    destroyed = true;
    if (poll) clearInterval(poll);
  };
}
