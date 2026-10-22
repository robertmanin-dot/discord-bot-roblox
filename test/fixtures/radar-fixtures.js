// Realistic fake API answers for radar tests (YouTube Data API v3, Twitch Helix).
import { openDb } from '../../src/core/db.js';
import { resetSettingsCache } from '../../src/core/settings.js';

export function freshDb() {
  openDb(':memory:');
  resetSettingsCache();
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Creates a fetch mock. `handler(url: URL, init)` returns a Response, a plain object (sent as JSON 200)
 * or undefined (-> 404). All calls are recorded in fetch.calls.
 */
export function mockFetch(handler) {
  const fn = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    fn.calls.push({ url, init });
    const out = await handler(url, init);
    if (out instanceof Response) return out;
    if (out === undefined) return json({ error: { code: 404, message: 'not found', errors: [{ reason: 'notFound' }] } }, 404);
    return json(out);
  };
  fn.calls = [];
  fn.count = (pred) => fn.calls.filter(({ url }) => pred(url)).length;
  return fn;
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

function video(id, channelId, title, { days = 2, views = 1500, lang, tags = [], description = '', live = false } = {}) {
  return {
    kind: 'youtube#video',
    id,
    snippet: {
      publishedAt: daysAgo(days),
      channelId,
      title,
      description,
      tags,
      defaultAudioLanguage: lang,
      liveBroadcastContent: 'none',
    },
    statistics: { viewCount: String(views), likeCount: '40' },
    contentDetails: { duration: 'PT12M3S' },
    ...(live ? { liveStreamingDetails: { actualStartTime: daysAgo(days), actualEndTime: daysAgo(days) } } : {}),
  };
}

/** A small YouTube "world" with channels of different kinds. */
export function youtubeWorld() {
  const channels = {
    UC_DE1: {
      kind: 'youtube#channel',
      id: 'UC_DE1',
      snippet: {
        title: 'LukasPlays 🎮 | Roblox',
        description: 'Roblox Videos jede Woche! 🔥\nBusiness & Kooperationen: lukas.business@gmail.com\nTikTok: @lukas_tt\nDiscord: discord.gg/LukasCommunity',
        customUrl: '@lukasplays',
        publishedAt: '2022-03-01T10:00:00Z',
        country: 'DE',
        defaultLanguage: 'de',
      },
      statistics: { subscriberCount: '3200', videoCount: '210', hiddenSubscriberCount: false, viewCount: '450000' },
      brandingSettings: { channel: { keywords: 'roblox deutsch rivals' } },
      contentDetails: { relatedPlaylists: { uploads: 'UU_DE1' } },
    },
    UC_EN1: {
      kind: 'youtube#channel',
      id: 'UC_EN1',
      snippet: {
        title: 'BloxReviewer',
        description: 'I review the best new Roblox games every week.\nFor collabs DM me on Instagram: instagram.com/bloxreviewer',
        customUrl: '@bloxreviewer',
        publishedAt: '2021-01-01T10:00:00Z',
      },
      statistics: { subscriberCount: '8500', videoCount: '120', hiddenSubscriberCount: false },
      brandingSettings: { channel: {} },
      contentDetails: { relatedPlaylists: { uploads: 'UU_EN1' } },
    },
    UC_BIG: {
      id: 'UC_BIG',
      snippet: { title: 'MegaRoblox', description: 'huge', customUrl: '@megaroblox' },
      statistics: { subscriberCount: '2000000', videoCount: '900', hiddenSubscriberCount: false },
      contentDetails: { relatedPlaylists: { uploads: 'UU_BIG' } },
    },
    UC_HIDDEN: {
      id: 'UC_HIDDEN',
      snippet: { title: 'Hidden', description: '', customUrl: '@hidden' },
      statistics: { hiddenSubscriberCount: true, videoCount: '50' },
      contentDetails: { relatedPlaylists: { uploads: 'UU_HIDDEN' } },
    },
    UC_COOK: {
      id: 'UC_COOK',
      snippet: { title: 'Kochen mit Anna', description: 'Rezepte und manchmal Gaming', customUrl: '@kochenmitanna' },
      statistics: { subscriberCount: '1000', videoCount: '80', hiddenSubscriberCount: false },
      contentDetails: { relatedPlaylists: { uploads: 'UU_COOK' } },
    },
  };
  const videos = {
    UU_DE1: [
      video('v_de1', 'UC_DE1', 'Ich spiele Roblox Rivals mit Zuschauern – wir gewinnen jede Runde!', { days: 1, views: 1800, lang: 'de', description: 'Business: lukas.business@gmail.com', live: true }),
      video('v_de2', 'UC_DE1', 'Die BESTEN neuen Roblox Spiele, die du kennen musst', { days: 5, views: 2500, lang: 'de' }),
      video('v_de3', 'UC_DE1', 'Roblox BedWars aber ich darf nur Bögen benutzen', { days: 9, views: 1200, lang: 'de' }),
      video('v_de4', 'UC_DE1', 'Wir bauen den größten Turm in Roblox', { days: 15, views: 900, lang: 'de' }),
    ],
    UU_EN1: [
      video('v_en1', 'UC_EN1', 'I found the BEST new Roblox games you need to play', { days: 3, views: 3000, lang: 'en' }),
      video('v_en2', 'UC_EN1', 'Underrated Roblox games that deserve more players', { days: 10, views: 2600, lang: 'en' }),
      video('v_en3', 'UC_EN1', 'Testing new Roblox shooter games with my friends', { days: 20, views: 2100, lang: 'en' }),
    ],
    UU_COOK: [
      video('v_c1', 'UC_COOK', 'Schnelle Pasta in zehn Minuten', { days: 2, lang: 'de' }),
      video('v_c2', 'UC_COOK', 'Kuchen ohne Ofen backen', { days: 6, lang: 'de' }),
      video('v_c3', 'UC_COOK', 'Mein erstes Roblox Video', { days: 8, lang: 'de' }),
      video('v_c4', 'UC_COOK', 'Gemüse richtig schneiden', { days: 12, lang: 'de' }),
      video('v_c5', 'UC_COOK', 'Brot selber machen', { days: 14, lang: 'de' }),
    ],
    UU_BIG: [video('v_b1', 'UC_BIG', 'Roblox but huge', { days: 1, views: 900000 })],
    UU_HIDDEN: [],
  };
  const searchResults = {
    'neue roblox spiele': ['UC_DE1', 'UC_BIG', 'UC_COOK'],
    'new roblox games': ['UC_EN1', 'UC_HIDDEN', 'UC_DE1'],
  };

  const handler = (url) => {
    const p = url.searchParams;
    if (!url.hostname.endsWith('googleapis.com')) return undefined;
    if (p.get('key') === 'BAD') {
      return json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }], details: [{ reason: 'API_KEY_INVALID' }] } }, 400);
    }
    const endpoint = url.pathname.split('/').pop();
    if (endpoint === 'search') {
      if (p.get('type') === 'channel') {
        return { items: [{ id: { kind: 'youtube#channel', channelId: 'UC_DE1' }, snippet: { channelId: 'UC_DE1' } }] };
      }
      const ids = searchResults[p.get('q')] || [];
      return {
        items: ids.map((cid, i) => ({ kind: 'youtube#searchResult', id: { kind: 'youtube#video', videoId: `s_${cid}_${i}` }, snippet: { channelId: cid, title: 'x' } })),
        nextPageToken: p.get('pageToken') ? undefined : 'PAGE2',
      };
    }
    if (endpoint === 'channels') {
      let ids = [];
      if (p.get('id')) ids = p.get('id').split(',');
      if (p.get('forHandle')) {
        const h = p.get('forHandle').replace(/^@/, '').toLowerCase();
        ids = Object.values(channels).filter((c) => c.snippet.customUrl === `@${h}`).map((c) => c.id);
      }
      return { items: ids.map((id) => channels[id]).filter(Boolean) };
    }
    if (endpoint === 'playlistItems') {
      const list = videos[p.get('playlistId')];
      if (!list) return json({ error: { code: 404, errors: [{ reason: 'playlistNotFound' }] } }, 404);
      return { items: list.slice(0, Number(p.get('maxResults') || 50)).map((v) => ({ contentDetails: { videoId: v.id } })) };
    }
    if (endpoint === 'videos') {
      const all = Object.values(videos).flat();
      const ids = (p.get('id') || '').split(',');
      return { items: ids.map((id) => all.find((v) => v.id === id)).filter(Boolean) };
    }
    return undefined;
  };
  return { channels, videos, searchResults, handler };
}

/** Twitch world: token, Roblox category, live streams over two pages, users. */
export function twitchWorld({ startedAt = '2026-10-22T17:00:00Z' } = {}) {
  const streams = [
    { id: 's1', user_id: '101', user_login: 'maxlive', user_name: 'MaxLive', game_id: '23020', game_name: 'Roblox', type: 'live', title: 'Roblox Rivals mit Zuschauern! !discord', viewer_count: 12, started_at: startedAt, language: 'de', tags: ['Deutsch'] },
    { id: 's2', user_id: '102', user_login: 'bigstreamer', user_name: 'BigStreamer', game_id: '23020', game_name: 'Roblox', type: 'live', title: 'huge stream', viewer_count: 5000, started_at: startedAt, language: 'de', tags: [] },
    { id: 's3', user_id: '103', user_login: 'tinyfox', user_name: 'TinyFox', game_id: '23020', game_name: 'Roblox', type: 'live', title: 'playing bedwars with viewers', viewer_count: 3, started_at: startedAt, language: 'en', tags: [] },
    { id: 's4', user_id: '104', user_login: 'zeroviews', user_name: 'ZeroViews', game_id: '23020', game_name: 'Roblox', type: 'live', title: 'first stream', viewer_count: 0, started_at: startedAt, language: 'en', tags: [] },
  ];
  const users = {
    101: { id: '101', login: 'maxlive', display_name: 'MaxLive', description: 'Roblox Streamer aus Berlin. Anfragen per DM auf Insta: instagram.com/max.live', broadcaster_type: 'affiliate' },
    102: { id: '102', login: 'bigstreamer', display_name: 'BigStreamer', description: 'big', broadcaster_type: 'partner' },
    103: { id: '103', login: 'tinyfox', display_name: 'TinyFox', description: 'business: tinyfox.gaming@outlook.com', broadcaster_type: '' },
    104: { id: '104', login: 'zeroviews', display_name: 'ZeroViews', description: '', broadcaster_type: '' },
  };
  const state = { tokens: 0, reject401Once: false };
  const handler = (url, init) => {
    if (url.hostname === 'id.twitch.tv') {
      state.tokens++;
      return { access_token: `tok${state.tokens}`, expires_in: 5000000, token_type: 'bearer' };
    }
    if (url.hostname !== 'api.twitch.tv') return undefined;
    if (state.reject401Once) {
      state.reject401Once = false;
      return json({ error: 'Unauthorized', status: 401, message: 'Invalid OAuth token' }, 401);
    }
    const auth = init?.headers?.Authorization || init?.headers?.authorization;
    if (!auth) return json({ message: 'missing auth' }, 401);
    const p = url.searchParams;
    const path = url.pathname.replace('/helix/', '');
    if (path === 'games') return { data: [{ id: '23020', name: 'Roblox' }] };
    if (path === 'streams') {
      const logins = p.getAll('user_login');
      if (logins.length) return { data: streams.filter((s) => logins.includes(s.user_login)), pagination: {} };
      const lang = p.get('language');
      const list = streams.filter((s) => s.language === lang);
      // Two pages for German.
      if (lang === 'de' && !p.get('after')) return { data: list.slice(0, 1), pagination: { cursor: 'c1' } };
      if (lang === 'de' && p.get('after') === 'c1') return { data: list.slice(1), pagination: {} };
      return { data: list, pagination: {} };
    }
    if (path === 'users') {
      const ids = p.getAll('id');
      const logins = p.getAll('login');
      const list = Object.values(users).filter((u) => ids.includes(u.id) || logins.includes(u.login));
      return { data: list };
    }
    return undefined;
  };
  return { streams, users, state, handler };
}
