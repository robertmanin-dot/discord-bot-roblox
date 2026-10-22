// Recognizes creator profile links and contact data in free text.
// Shared by the radar (descriptions, imports) and the bot (applications).
import { normalizeEmail, normalizeHandle, uniq } from './util.js';

export const PLATFORMS = ['youtube', 'twitch', 'tiktok', 'instagram', 'x', 'kick'];

export const PLATFORM_LABELS = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  x: 'X',
  kick: 'Kick',
  discord: 'Discord',
};

const RESERVED = {
  instagram: new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'tv', 'about', 'legal']),
  twitch: new Set(['videos', 'directory', 'settings', 'subscriptions', 'inventory', 'wallet', 'downloads', 'jobs', 'p', 'search']),
  x: new Set(['i', 'home', 'intent', 'share', 'search', 'explore', 'settings', 'messages', 'notifications', 'hashtag']),
  tiktok: new Set(['discover', 'tag', 'music', 'foryou', 'following', 'live', 'search']),
  kick: new Set(['categories', 'browse', 'search', 'following']),
};

function toUrl(input) {
  let s = String(input ?? '').trim().replace(/[),.;!?]+$/, '');
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (!/^[\w-]+(\.[\w-]+)+\//.test(s) && !/^(www\.)?[\w-]+\.[a-z]{2,}(\/|$)/i.test(s)) return null;
    s = `https://${s}`;
  }
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/**
 * Parses a profile/channel link.
 * Returns { platform, handle?, externalId?, videoId?, inviteCode?, url } or null.
 */
export function parseProfileUrl(input) {
  const u = toUrl(input);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.|vm\.)/, '');
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const first = parts[0] || '';

  if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (first.startsWith('@')) {
      const handle = normalizeHandle(first);
      return handle ? { platform: 'youtube', handle, url: `https://www.youtube.com/@${handle}` } : null;
    }
    if (first === 'channel' && parts[1]) return { platform: 'youtube', externalId: parts[1], url: `https://www.youtube.com/channel/${parts[1]}` };
    if ((first === 'c' || first === 'user') && parts[1]) {
      return { platform: 'youtube', handle: normalizeHandle(parts[1]), legacy: first, url: `https://www.youtube.com/${first}/${parts[1]}` };
    }
    if (first === 'watch' && u.searchParams.get('v')) return { platform: 'youtube', videoId: u.searchParams.get('v'), url: u.toString() };
    if ((first === 'shorts' || first === 'live') && parts[1]) return { platform: 'youtube', videoId: parts[1], url: u.toString() };
    return null;
  }
  if (host === 'youtu.be' && first) return { platform: 'youtube', videoId: first, url: u.toString() };

  if (host === 'tiktok.com') {
    if (first.startsWith('@')) {
      const handle = normalizeHandle(first);
      if (handle && !RESERVED.tiktok.has(handle)) return { platform: 'tiktok', handle, url: `https://www.tiktok.com/@${handle}` };
    }
    return null;
  }
  if (host === 'instagram.com' || host === 'instagr.am') {
    const handle = normalizeHandle(first);
    if (handle && !RESERVED.instagram.has(handle) && /^[a-z0-9._]{1,30}$/.test(handle)) {
      return { platform: 'instagram', handle, url: `https://www.instagram.com/${handle}/` };
    }
    return null;
  }
  if (host === 'twitch.tv') {
    const handle = normalizeHandle(first);
    if (handle && !RESERVED.twitch.has(handle) && /^[a-z0-9_]{2,25}$/.test(handle)) return { platform: 'twitch', handle, url: `https://www.twitch.tv/${handle}` };
    return null;
  }
  if (host === 'x.com' || host === 'twitter.com') {
    const handle = normalizeHandle(first);
    if (handle && !RESERVED.x.has(handle) && /^[a-z0-9_]{1,15}$/.test(handle)) return { platform: 'x', handle, url: `https://x.com/${handle}` };
    return null;
  }
  if (host === 'kick.com') {
    const handle = normalizeHandle(first);
    if (handle && !RESERVED.kick.has(handle) && /^[a-z0-9_-]{2,25}$/.test(handle)) return { platform: 'kick', handle, url: `https://kick.com/${handle}` };
    return null;
  }
  if (host === 'discord.gg' && first) return { platform: 'discord', inviteCode: first, url: `https://discord.gg/${first}` };
  if ((host === 'discord.com' || host === 'discordapp.com') && first === 'invite' && parts[1]) {
    return { platform: 'discord', inviteCode: parts[1], url: `https://discord.gg/${parts[1]}` };
  }
  return null;
}

/** Profile URL for a platform + handle. */
export function profileUrl(platform, handle) {
  const h = normalizeHandle(handle);
  if (!h) return null;
  switch (platform) {
    case 'youtube': return `https://www.youtube.com/@${h}`;
    case 'tiktok': return `https://www.tiktok.com/@${h}`;
    case 'instagram': return `https://www.instagram.com/${h}/`;
    case 'twitch': return `https://www.twitch.tv/${h}`;
    case 'x': return `https://x.com/${h}`;
    case 'kick': return `https://kick.com/${h}`;
    default: return null;
  }
}

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/gi;
const OBFUSCATED_EMAIL_RE = /([a-z0-9][a-z0-9._%+-]*)\s*[[(]\s*(?:at|ät|@)\s*[\])]\s*([a-z0-9-]+(?:\s*(?:[[(]\s*(?:dot|punkt)\s*[\])]|\.)\s*[a-z0-9-]+)+)/gi;
const URL_RE = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be|tiktok\.com|vm\.tiktok\.com|instagram\.com|twitch\.tv|twitter\.com|x\.com|kick\.com|discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[^\s<>"'`)\]}]+/gi;
const LABEL_RES = [
  { platform: 'tiktok', re: /\b(?:tiktok|tik tok|tt)\s*[:\-–|]?\s*@([a-z0-9._]{2,24})/gi },
  { platform: 'instagram', re: /\b(?:instagram|insta|ig)\s*[:\-–|]?\s*@?([a-z0-9._]{2,30})\b/gi },
  { platform: 'x', re: /\b(?:twitter|x)\s*[:\-–|]\s*@?([a-z0-9_]{2,15})\b/gi },
  { platform: 'twitch', re: /\btwitch\s*[:\-–|]\s*@?([a-z0-9_]{3,25})\b/gi },
];
const LABEL_STOPWORDS = new Set(['for', 'und', 'and', 'oder', 'or', 'the', 'der', 'die', 'das', 'link', 'links', 'unten', 'below', 'profil', 'profile', 'dm', 'dms', 'me', 'mir', 'folgen', 'follow']);

/**
 * Finds emails, profile links, @handles with platform labels and Discord invites in text.
 * Returns { emails: [{ value, index }], profiles: [{ platform, handle|externalId, url }], discordInvites: [code] }.
 */
export function extractLinks(text) {
  const s = String(text ?? '');
  const emails = [];
  const seenEmails = new Set();
  const pushEmail = (value, index) => {
    const v = normalizeEmail(value).replace(/\.+$/, '');
    if (!v || seenEmails.has(v) || /\.(png|jpe?g|gif|webp)$/i.test(v) || v.endsWith('@example.com')) return;
    seenEmails.add(v);
    emails.push({ value: v, index });
  };
  for (const m of s.matchAll(EMAIL_RE)) pushEmail(m[0], m.index);
  for (const m of s.matchAll(OBFUSCATED_EMAIL_RE)) {
    const domain = m[2].replace(/\s*[[(]\s*(?:dot|punkt)\s*[\])]\s*/gi, '.').replace(/\s+/g, '');
    pushEmail(`${m[1]}@${domain}`, m.index);
  }

  const profiles = [];
  const invites = [];
  const seen = new Set();
  for (const m of s.matchAll(URL_RE)) {
    const p = parseProfileUrl(m[0]);
    if (!p) continue;
    if (p.platform === 'discord') {
      if (!invites.includes(p.inviteCode)) invites.push(p.inviteCode);
      continue;
    }
    if (p.videoId) continue;
    const key = `${p.platform}:${p.handle || p.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push(p);
  }
  for (const { platform, re } of LABEL_RES) {
    for (const m of s.matchAll(re)) {
      const handle = normalizeHandle(m[1]).replace(/\.+$/, '');
      if (!handle || LABEL_STOPWORDS.has(handle) || /^\d+$/.test(handle)) continue;
      const key = `${platform}:${handle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      profiles.push({ platform, handle, url: profileUrl(platform, handle) });
    }
  }
  return { emails, profiles, discordInvites: uniq(invites) };
}
