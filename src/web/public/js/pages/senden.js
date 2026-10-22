// Senden: one creator at a time – prepare message, copy + open contact window, mark as sent.
import { get, post, tryGet, ApiError } from '../api.js';
import {
  h, mount, clear, loading, empty, errorBox, toast, toastError, copyText, fmtCompact, fmtRelative, fmtNum,
  platformBadge, statusBadge, channelDot, channelLabel, scoreBadge, langLabel, AGE_GROUPS, PLATFORM_LABELS,
  LANGUAGES, select, field, extLink, setQuery, notice, asArray, truncate,
} from '../ui.js';

const PLATFORM_OPTS = [['', 'Alle Plattformen'], ...['youtube', 'twitch', 'tiktok', 'instagram', 'x', 'kick'].map((p) => [p, PLATFORM_LABELS[p]])];
const CHANNEL_OPTS = [['', 'Alle Kontaktwege'], ['email', 'E-Mail'], ['dm', 'DM (eingeladen)'], ['discord', 'Eigener Discord']];
const LIMIT_LABELS = { email: 'E-Mail', dm: 'DMs', discord: 'Discord' };

const enc = encodeURIComponent;

/** Rebuilds an email compose link with edited subject/body, keeping the user's mail program. */
export function buildEmailUrl(baseUrl, to, subject, body) {
  const base = String(baseUrl || '');
  if (base.startsWith('https://mail.google.com')) return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;
  if (/^https:\/\/outlook\./.test(base)) {
    const u = new URL(base);
    return `${u.origin}${u.pathname}?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`;
  }
  const addr = String(to || '').split('@').map(enc).join('@');
  return `mailto:${addr}?subject=${enc(subject)}&body=${enc(body)}`;
}

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export async function render(root, { query }) {
  const state = {
    mode: query.get('mode') === 'followup' ? 'followup' : 'first',
    language: query.get('language') || '',
    platform: query.get('platform') || '',
    channel: query.get('channel') || '',
    items: [],
    total: 0,
    limits: null,
    idx: 0,
    prepared: new Map(), // outreach_id -> Promise<result>
    preparedResult: new Map(),
    edits: new Map(), // outreach_id -> { subject, body }
    details: new Map(),
    opened: null,
    busy: false,
    sentThisSession: 0,
  };
  let destroyed = false;
  const settings = (await tryGet('/settings'))?.settings || null;
  const languages = settings?.radar?.languages?.length ? settings.radar.languages : ['de', 'en'];

  const head = h('div');
  const body = h('div');
  mount(root, h('div', { class: 'stack' }, head, body));

  function renderHead() {
    const tabs = h(
      'div',
      { class: 'tabs' },
      [['first', '✉️ Erstkontakt'], ['followup', '🔁 Nachfassen']].map(([m, label]) =>
        h('button', { class: `tab ${state.mode === m ? 'active' : ''}`, onclick: () => { if (state.mode !== m) { state.mode = m; reload(); } } }, label, state.mode === m && state.total ? h('span', { class: 'count' }, fmtNum(state.total)) : null),
      ),
    );
    const langSel = select([['', 'Alle Sprachen'], ...languages.map((l) => [l, LANGUAGES[l] || l])], state.language, { onchange: (e) => { state.language = e.target.value; reload(); } });
    const platSel = select(PLATFORM_OPTS, state.platform, { onchange: (e) => { state.platform = e.target.value; reload(); } });
    const chanSel = select(CHANNEL_OPTS, state.channel, { onchange: (e) => { state.channel = e.target.value; reload(); } });
    const limits = state.limits
      ? h(
        'div',
        { class: 'limits-grid' },
        Object.entries(state.limits).map(([ch, l]) => {
          const pct = l.max ? Math.min(100, Math.round(((l.used || 0) / l.max) * 100)) : 0;
          return h(
            'div',
            { class: 'limit' },
            h('div', { class: 'row' }, h('span', null, LIMIT_LABELS[ch] || ch), h('span', { class: 'muted' }, `${l.used || 0} / ${l.max}`)),
            h('div', { class: `progress ${pct >= 100 ? 'full' : pct >= 80 ? 'warn' : 'ok'}` }, h('span', { style: `width:${pct}%` })),
          );
        }),
      )
      : null;
    mount(
      head,
      tabs,
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'filters' }, field('Sprache', langSel), field('Plattform', platSel), field('Kontaktweg', chanSel), limits ? h('div', { class: 'field grow', style: 'flex:2 1 360px' }, h('label', null, 'Heute gesendet (Tageslimit)'), limits) : null),
      ),
    );
  }

  async function reload() {
    setQuery({ mode: state.mode === 'followup' ? 'followup' : '', language: state.language, platform: state.platform, channel: state.channel });
    renderHead();
    mount(body, loading('Warteschlange wird geladen …'));
    try {
      const q = await get('/queue', { mode: state.mode, language: state.language, platform: state.platform, channel: state.channel, limit: 20 });
      if (destroyed) return;
      state.items = q.items || [];
      state.total = q.total || 0;
      state.limits = q.limits || null;
      state.idx = 0;
      state.opened = null;
      renderHead();
      renderBody();
    } catch (err) {
      if (destroyed) return;
      if (err instanceof ApiError && err.missing) {
        mount(body, empty('🛠️', 'Senden ist noch nicht verfügbar', err.message));
      } else {
        mount(body, errorBox(err, reload));
      }
    }
  }

  function current() {
    return state.items[state.idx] || null;
  }

  function prepare(item) {
    if (!item) return null;
    if (!state.prepared.has(item.outreach_id)) {
      const p = post(`/queue/${item.outreach_id}/prepare`, { mode: state.mode })
        .then((res) => {
          state.preparedResult.set(item.outreach_id, res);
          // Show the prepared text (e.g. with personal Discord link) unless the user already edited it.
          if (current()?.outreach_id === item.outreach_id && !state.edits.has(item.outreach_id) && !destroyed) fillEditor(res.message);
          return res;
        })
        .catch((err) => {
          state.prepared.delete(item.outreach_id);
          throw err;
        });
      p.catch(() => {});
      state.prepared.set(item.outreach_id, p);
    }
    return state.prepared.get(item.outreach_id);
  }

  let subjectInput = null;
  let bodyInput = null;
  let hintEl = null;

  function fillEditor(message) {
    if (subjectInput) subjectInput.value = message?.subject || '';
    if (bodyInput) bodyInput.value = message?.body || '';
  }

  function nextItems() {
    return state.items.slice(state.idx + 1, state.idx + 8);
  }

  function renderBody() {
    const item = current();
    if (!item) {
      const msg = state.mode === 'followup'
        ? empty('🎉', 'Keine Nachfass-Mails fällig', 'Nachgefasst wird automatisch einige Tage nach dem Erstkontakt per E-Mail – sobald welche fällig sind, tauchen sie hier auf.', h('a', { class: 'btn', href: '#/senden' }, 'Zum Erstkontakt'))
        : empty(
          '📭',
          state.language || state.platform || state.channel ? 'Keine Creator für diese Filter' : 'Die Warteschlange ist leer',
          'Hier landen gefundene Creator mit einem erlaubten Kontaktweg (Business-Mail, ausdrückliche DM-Einladung oder eigener Discord). Starte eine Suche oder importiere Profile.',
          h('a', { class: 'btn btn-primary', href: '#/finden' }, '🔎 Creator finden'),
          state.language || state.platform || state.channel ? h('button', { class: 'btn', onclick: () => { state.language = ''; state.platform = ''; state.channel = ''; reload(); } }, 'Filter zurücksetzen') : null,
        );
      mount(body, h('div', { class: 'card' }, msg, state.sentThisSession ? h('p', { class: 'center muted' }, `In dieser Sitzung gesendet: ${state.sentThisSession}`) : null));
      return;
    }
    prepare(item);
    const c = item.creator || {};
    const limit = state.limits?.[item.channel];
    const limitReached = limit && limit.max && (limit.used || 0) >= limit.max;

    // ----- left: creator card -----
    const platforms = asArray(c.platforms);
    const detailBox = h('div');
    const card = h(
      'div',
      { class: 'card creator-card' },
      h('div', { class: 'row between' }, h('span', { class: 'muted small' }, `${state.idx + 1} von ${fmtNum(state.total)} in der Warteschlange`), statusBadge(c.status)),
      h('h2', { class: 'mt' }, c.display_name || 'Unbekannt'),
      h(
        'div',
        { class: 'meta' },
        scoreBadge(c.score),
        h('span', { class: 'badge', title: 'Sprache' }, '🌐 ', langLabel(c.language)),
        c.age_group && c.age_group !== 'unbekannt' ? h('span', { class: `badge ${c.age_group === '18+' ? '' : 'warn'}` }, `Alter: ${AGE_GROUPS[c.age_group] || c.age_group}`) : null,
        asArray(c.tags).map((t) => h('span', { class: 'chip' }, t)),
      ),
      h(
        'ul',
        { class: 'list' },
        platforms.length
          ? platforms.map((p) => h('li', null, platformBadge(p.platform), h('div', { class: 'grow' }, extLink(p.url, p.handle ? `@${p.handle}` : PLATFORM_LABELS[p.platform])), h('span', { class: 'muted nowrap' }, p.followers ? `${fmtCompact(p.followers)} Follower` : '')))
          : h('li', { class: 'muted' }, 'Keine Plattform-Konten bekannt'),
      ),
      c.latest_title
        ? h('div', { class: 'mt' }, h('div', { class: 'label' }, 'Letztes Video / Stream'), h('div', { class: 'break' }, extLink(c.latest_url, c.latest_title)), c.last_active_at ? h('div', { class: 'help' }, `aktiv ${fmtRelative(c.last_active_at)}`) : null)
        : null,
      h(
        'div',
        { class: 'mt' },
        h('div', { class: 'label' }, 'Kontaktweg'),
        h('div', { class: 'row' }, channelDot(item.channel), h('span', null, channelLabel(item.channel, item.platform))),
        h('div', { class: 'help break' }, item.target || ''),
      ),
      detailBox,
      h('div', { class: 'row mt' }, h('a', { class: 'btn btn-sm', href: `#/creator/${c.id}`, target: '_blank', rel: 'noopener' }, 'Details ↗')),
    );

    const queueMini = nextItems().length
      ? h(
        'div',
        { class: 'card' },
        h('div', { class: 'label' }, 'Als Nächstes'),
        h(
          'div',
          { class: 'queue-mini' },
          nextItems().map((it, i) =>
            h('button', { onclick: () => go(state.idx + 1 + i) }, platformBadge(asArray(it.creator?.platforms)[0]?.platform || it.platform), h('span', { class: 'ellipsis' }, it.creator?.display_name || '–'), scoreBadge(it.creator?.score)),
          ),
        ),
      )
      : null;

    // ----- right: message -----
    const edit = state.edits.get(item.outreach_id);
    const prepared = state.preparedResult.get(item.outreach_id);
    const msg = edit || prepared?.message || item.message || {};
    subjectInput = item.channel === 'email' ? h('input', { type: 'text', value: msg.subject || '', 'aria-label': 'Betreff' }) : null;
    bodyInput = h('textarea', { class: 'tall', value: msg.body || '', 'aria-label': 'Nachricht' });
    const editedBadge = h('span', { class: `badge info ${edit ? '' : 'hidden'}` }, 'bearbeitet');
    const resetBtn = h('button', { class: `btn btn-ghost ${edit ? '' : 'hidden'}`, onclick: () => { state.edits.delete(item.outreach_id); renderBody(); } }, '↺ Text zurücksetzen');
    const markEdited = () => {
      state.edits.set(item.outreach_id, { subject: subjectInput?.value || '', body: bodyInput.value });
      editedBadge.classList.remove('hidden');
      resetBtn.classList.remove('hidden');
    };
    subjectInput?.addEventListener('input', markEdited);
    bodyInput.addEventListener('input', markEdited);

    const openBtn = h('button', { class: 'btn btn-primary btn-lg', onclick: openAndCopy, disabled: limitReached }, '📋 Öffnen & Kopieren', h('span', { class: 'kbd' }, '⏎'));
    const sentBtn = h('button', { class: 'btn btn-success btn-lg', onclick: markSent, disabled: limitReached }, '✓ Gesendet', h('span', { class: 'kbd' }, 'S'));
    hintEl = h('div');
    if (state.opened === item.outreach_id) showHint(item);

    const messageCard = h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, state.mode === 'followup' ? 'Nachfass-Mail' : 'Nachricht'), h('span', { class: 'muted small mono' }, item.template_key ? `${item.template_key}` : ''), editedBadge),
      asArray(item.warnings).map((w) => notice('warn', '⚠️', w)),
      limitReached ? notice('err', '⛔', `Tageslimit für ${LIMIT_LABELS[item.channel] || item.channel} erreicht (${limit.used}/${limit.max}). Morgen weitermachen oder das Limit unter Einstellungen → Radar erhöhen.`) : null,
      subjectInput ? field('Betreff', subjectInput) : null,
      field('Text', bodyInput, item.channel === 'email' ? 'Beim Öffnen wird der Text direkt in deine E-Mail übernommen.' : 'Der Text wird kopiert – im geöffneten Profil einfügen (Strg+V) und senden.'),
      h(
        'div',
        { class: 'send-actions' },
        openBtn,
        sentBtn,
        h('button', { class: 'btn', onclick: () => skip('later') }, '⏭ Später', h('span', { class: 'kbd' }, 'L')),
        h('button', { class: 'btn', onclick: () => skip('unsuitable') }, '👎 Ungeeignet', h('span', { class: 'kbd' }, 'U')),
        h('button', { class: 'btn btn-ghost', onclick: () => skip('no_contact') }, '🚫 Kein Kontaktweg', h('span', { class: 'kbd' }, 'K')),
        resetBtn,
      ),
      hintEl,
      h('div', { class: 'shortcut-help' }, 'Tastenkürzel (wenn du nicht gerade im Textfeld tippst): ⏎ Öffnen & Kopieren · S Gesendet · L Später · U Ungeeignet · K Kein Kontaktweg · ← → blättern. Im Textfeld: Strg+⏎ öffnet.'),
    );

    mount(body, h('div', { class: 'send-layout' }, h('div', { class: 'stack' }, card, queueMini), messageCard));

    // Notes + contacts from the detail endpoint (optional)
    loadDetail(c.id, detailBox);
  }

  async function loadDetail(id, box) {
    if (!id) return;
    let d = state.details.get(id);
    if (!d) {
      d = await tryGet(`/creators/${id}`);
      if (d) state.details.set(id, d);
    }
    if (!d || destroyed || current()?.creator?.id !== id) return;
    const notes = d.creator?.notes;
    const contacts = asArray(d.contacts);
    mount(
      box,
      notes ? h('div', { class: 'mt' }, h('div', { class: 'label' }, 'Notizen'), h('div', { class: 'help', style: 'white-space:pre-wrap;color:var(--text)' }, truncate(notes, 600))) : null,
      contacts.length > 1
        ? h('div', { class: 'mt' }, h('div', { class: 'label' }, 'Weitere Kontakte'), h('div', { class: 'help break' }, contacts.map((ct) => `${ct.type}: ${ct.value}${ct.is_business ? ' (Business)' : ''}`).join(' · ')))
        : null,
    );
  }

  function go(i) {
    if (!state.items.length) return;
    state.idx = Math.max(0, Math.min(state.items.length - 1, i));
    state.opened = null;
    renderBody();
  }

  function currentMessage(item) {
    const edit = state.edits.get(item.outreach_id);
    const prepared = state.preparedResult.get(item.outreach_id);
    const base = prepared?.message || item.message || {};
    return {
      subject: subjectInput ? subjectInput.value : edit?.subject ?? base.subject ?? '',
      body: bodyInput ? bodyInput.value : edit?.body ?? base.body ?? '',
    };
  }

  function showHint(item, blockedUrl) {
    if (!hintEl) return;
    const isEmail = item.channel === 'email';
    mount(
      hintEl,
      h(
        'div',
        { class: 'hint-bar' },
        h('span', null, '✅'),
        h(
          'div',
          { class: 'grow' },
          isEmail ? 'E-Mail-Entwurf ist geöffnet (Text auch kopiert) – prüfen, senden und dann hier „Gesendet“ (S) drücken.' : 'Text ist kopiert – im geöffneten Fenster einfügen (Strg+V), senden und dann hier „Gesendet“ (S) drücken.',
          blockedUrl ? h('div', { class: 'mt', style: 'font-weight:500' }, 'Das Fenster wurde vom Browser blockiert: ', extLink(blockedUrl, 'hier klicken zum Öffnen')) : null,
        ),
      ),
    );
  }

  async function openAndCopy() {
    const item = current();
    if (!item || state.busy) return;
    state.busy = true;
    try {
      let prepared = state.preparedResult.get(item.outreach_id);
      if (!prepared) {
        try {
          prepared = await prepare(item);
        } catch (err) {
          toastError(err);
          prepared = null;
        }
      }
      if (destroyed || current()?.outreach_id !== item.outreach_id) return;
      const { subject, body: text } = currentMessage(item);
      const channel = prepared?.channel || item.channel;
      const target = prepared?.target || item.target;
      let url = prepared?.open_url || item.open_url || '';
      if (channel === 'email') url = buildEmailUrl(url, target, subject, text);
      const copied = copyText(text);
      let blocked = null;
      if (url.startsWith('mailto:')) {
        window.location.href = url;
      } else if (url) {
        const w = window.open(url, '_blank');
        if (w) {
          try {
            w.opener = null;
          } catch { /* cross-origin already */ }
        } else {
          blocked = url;
        }
      }
      const ok = await copied;
      if (!ok) toast('Kopieren hat nicht geklappt – bitte den Text manuell markieren und kopieren (Strg+C).', 'error');
      state.opened = item.outreach_id;
      showHint(item, blocked);
    } finally {
      state.busy = false;
    }
  }

  function removeCurrent() {
    state.items.splice(state.idx, 1);
    state.total = Math.max(0, state.total - 1);
    if (state.idx >= state.items.length) state.idx = Math.max(0, state.items.length - 1);
    state.opened = null;
    if (!state.items.length && state.total > 0) reload();
    else {
      renderHead();
      renderBody();
    }
  }

  async function markSent() {
    const item = current();
    if (!item || state.busy) return;
    state.busy = true;
    try {
      const prepared = state.preparedResult.get(item.outreach_id);
      await post(`/queue/${item.outreach_id}/sent`, {
        mode: state.mode,
        channel: prepared?.channel || item.channel,
        target: prepared?.target || item.target,
        platform: prepared?.platform || item.platform,
        template_key: prepared?.template_key || item.template_key,
        variant: prepared?.variant || item.variant,
      });
      const ch = prepared?.channel || item.channel;
      if (state.limits?.[ch]) state.limits[ch].used = (state.limits[ch].used || 0) + 1;
      state.sentThisSession++;
      toast(`${item.creator?.display_name || 'Creator'}: als gesendet markiert.`, 'success', 2500);
      state.edits.delete(item.outreach_id);
      removeCurrent();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        toast(`${err.message} – morgen weitermachen oder das Limit unter Einstellungen erhöhen.`, 'error');
        reload();
      } else toastError(err);
    } finally {
      state.busy = false;
    }
  }

  async function skip(reason) {
    const item = current();
    if (!item || state.busy) return;
    state.busy = true;
    try {
      await post(`/queue/${item.outreach_id}/skip`, { reason });
      const text = { later: 'Kommt morgen wieder dran.', unsuitable: 'Als ungeeignet markiert.', no_contact: 'Ohne Kontaktweg markiert – wird nicht mehr vorgeschlagen.' }[reason];
      toast(`${item.creator?.display_name || 'Creator'}: ${text}`, 'info', 2500);
      removeCurrent();
    } catch (err) {
      toastError(err);
    } finally {
      state.busy = false;
    }
  }

  function onKey(e) {
    if (document.querySelector('dialog[open]')) return;
    if (!current()) return;
    const typing = isTyping(e.target);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openAndCopy();
      return;
    }
    if (typing) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.key === 'Enter') {
      if (e.target.closest?.('button, a')) return; // let focused buttons/links work normally
      e.preventDefault();
      openAndCopy();
    } else if (k === 's') { e.preventDefault(); markSent(); }
    else if (k === 'l') { e.preventDefault(); skip('later'); }
    else if (k === 'u') { e.preventDefault(); skip('unsuitable'); }
    else if (k === 'k') { e.preventDefault(); skip('no_contact'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(state.idx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(state.idx - 1); }
  }

  document.addEventListener('keydown', onKey);
  await reload();
  return () => {
    destroyed = true;
    document.removeEventListener('keydown', onKey);
    clear(root);
  };
}
