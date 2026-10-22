// Small popup opened by the bookmarklet: shows the profile data and saves it via POST /api/capture.
import { post } from './api.js';
import { h, mount, select, field, notice, LANGUAGES, PLATFORM_LABELS, fmtNum } from './ui.js';

const DM_HINTS = /\b(dm|dms|pm|message)\b.{0,25}\b(for|für|fuer|wegen)\b.{0,25}\b(collab|collabs|kooperation|business|anfragen|sponsor|werbung|partnership)|\b(collab|collabs|business|anfragen|kooperation(en)?|sponsoring)\b.{0,20}\b(per|via|über|ueber|in die|in my)?\s*(dm|dms|pm)\b|\bdms?\s*(open|offen)\b|\bmd\s+(para|pra)\s+(parceria|collab)/i;
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/i;

function detectPlatform(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('twitch.tv')) return 'twitch';
  if (u.includes('x.com') || u.includes('twitter.com')) return 'x';
  if (u.includes('kick.com')) return 'kick';
  return '';
}

/** "12,3K" -> 12300, "1.2M" -> 1200000, "12.300" -> 12300 */
export function parseCount(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim().toLowerCase().replace(/\s+/g, '').replace(/\.+$/, '');
  if (!s) return null;
  const m = s.match(/(k|m|mio|tsd|b)$/);
  if (m) {
    const mult = { k: 1e3, tsd: 1e3, m: 1e6, mio: 1e6, b: 1e9 }[m[1]];
    const n = parseFloat(s.slice(0, -m[1].length).replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * mult) : null;
  }
  s = s.replace(/[.,'](?=\d{3}(\D|$))/g, '');
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}

const params = new URLSearchParams(location.search);
const app = document.getElementById('app');
const url = params.get('url') || '';

if (!url) {
  mount(
    app,
    notice('info', 'ℹ️', 'Dieses Fenster öffnet sich, wenn du auf einem TikTok-, Instagram-, YouTube- oder Twitch-Profil auf das Lesezeichen „📌 Zum Creator Radar“ klickst. Das Lesezeichen findest du im Dashboard unter Finden → TikTok & Instagram.'),
    h('p', { class: 'mt' }, h('a', { class: 'btn', href: '/#/finden?tab=lesezeichen', target: '_blank', rel: 'noopener' }, 'Zum Dashboard')),
  );
} else {
  const bio = params.get('bio') || '';
  const platform = params.get('platform') || detectPlatform(url);
  const rawFollowers = params.get('followers') || '';
  const followersNum = parseCount(rawFollowers);
  const emailGuess = (bio.match(EMAIL_RE) || [])[0] || '';

  const platSel = select([['', '– bitte wählen –'], ...['tiktok', 'instagram', 'youtube', 'twitch', 'x', 'kick'].map((p) => [p, PLATFORM_LABELS[p]])], platform);
  const urlIn = h('input', { type: 'url', value: url });
  const handleIn = h('input', { type: 'text', value: (params.get('handle') || '').replace(/^@/, '') });
  const nameIn = h('input', { type: 'text', value: params.get('name') || params.get('title') || '' });
  const followersIn = h('input', { type: 'text', value: followersNum !== null ? String(followersNum) : rawFollowers });
  const emailIn = h('input', { type: 'email', value: emailGuess, placeholder: 'nur wenn öffentlich angegeben' });
  const langSel = select([['', 'automatisch erkennen'], ...Object.entries(LANGUAGES)], '');
  const bioIn = h('textarea', { value: bio, placeholder: 'Bio / Beschreibung' });
  const dmInvite = DM_HINTS.test(bio);
  const result = h('div');
  const saveBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, '💾 Speichern');

  const form = h(
    'form',
    {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        saveBtn.disabled = true;
        try {
          const res = await post('/capture', {
            platform: platSel.value || undefined,
            url: urlIn.value.trim(),
            handle: handleIn.value.trim() || undefined,
            name: nameIn.value.trim() || undefined,
            followers: parseCount(followersIn.value) ?? undefined,
            bio: bioIn.value || undefined,
            email: emailIn.value.trim() || undefined,
            language: langSel.value || undefined,
          });
          const id = res?.id || res?.creator?.id;
          mount(
            result,
            notice('ok', '✅', h('div', null, h('strong', null, res?.created === false ? 'Aktualisiert.' : 'Gespeichert.'), ' ', id ? h('a', { href: `/#/creator/${id}`, target: '_blank', rel: 'noopener' }, 'Im Radar öffnen ↗') : null, h('div', { class: 'help' }, 'Das Fenster schließt sich gleich.'))),
          );
          setTimeout(() => window.close(), 1600);
        } catch (err) {
          mount(result, notice('err', '⚠️', err.message));
          saveBtn.disabled = false;
        }
      },
    },
    h(
      'div',
      { class: 'form-grid', style: 'grid-template-columns:1fr 1fr' },
      field('Plattform', platSel),
      field('Handle', handleIn),
      field('Name', nameIn, null, 'wide'),
      field('Follower', followersIn, rawFollowers && followersNum !== null && String(followersNum) !== rawFollowers ? `erkannt aus „${rawFollowers}“ = ${fmtNum(followersNum)}` : null),
      field('Sprache', langSel),
      field('E-Mail', emailIn, emailGuess ? 'aus der Bio übernommen' : null, 'wide'),
      field('Profil-Link', urlIn, null, 'wide'),
      field('Bio', bioIn, null, 'wide'),
    ),
    dmInvite ? notice('ok', '✅', 'Die Bio lädt zu Anfragen per DM ein – eine DM ist hier in Ordnung.') : !emailGuess ? notice('warn', '⚠️', 'Keine E-Mail und keine DM-Einladung gefunden. Ohne erlaubten Kontaktweg wird der Creator nicht zum Anschreiben vorgeschlagen.') : null,
    h('div', { class: 'row mt' }, saveBtn, h('button', { class: 'btn', type: 'button', onclick: () => window.close() }, 'Abbrechen')),
    result,
  );
  mount(app, form);
  saveBtn.focus();
}
