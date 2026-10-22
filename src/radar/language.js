// Language detection: platform metadata first, then text detection with "eld".
import { createLogger } from '../core/log.js';

const log = createLogger('radar');

export const LANGUAGE_SUBSET = ['de', 'en', 'es', 'pt', 'fr', 'pl', 'tr', 'it', 'nl', 'ru', 'id', 'vi', 'tl', 'ja', 'ko'];

export const LANGUAGE_LABELS = {
  de: 'Deutsch',
  en: 'Englisch',
  es: 'Spanisch',
  pt: 'Portugiesisch',
  fr: 'Französisch',
  pl: 'Polnisch',
  tr: 'Türkisch',
  it: 'Italienisch',
  nl: 'Niederländisch',
  ru: 'Russisch',
  id: 'Indonesisch',
  vi: 'Vietnamesisch',
  tl: 'Tagalog',
  ja: 'Japanisch',
  ko: 'Koreanisch',
};

let detector = null;
let loading = null;

/** Loads the detector once (≈1 s). Safe to call many times. */
export async function initLanguage() {
  if (detector) return detector;
  if (!loading) {
    loading = (async () => {
      try {
        const { eld } = await import('eld');
        await eld.load('medium');
        eld.setLanguageSubset(LANGUAGE_SUBSET);
        detector = eld;
      } catch (err) {
        log.warn('Spracherkennung konnte nicht geladen werden:', err.message);
        detector = null;
      }
      return detector;
    })();
  }
  return loading;
}

export const isLanguageReady = () => Boolean(detector);

// Words that are the same in every language on gaming channels.
const NOISE = /(^|[^\p{L}\p{N}])(roblox|rblx|rivals|bedwars|bed\s*wars|arsenal|phantom\s*forces|bad\s*business|counter\s*blox|blox\s*fruits?|da\s*hood|brookhaven|adopt\s*me|doors|pet\s*sim(ulator)?|mm2|murder\s*mystery|tower\s*of\s*hell|toh|obby|tycoon|simulator|fps|pvp|1v1|2v2|op|noob|pro|gg|ez|vs|lol|xd|update|codes?|shorts?|live|stream(ing)?|gameplay|montage|edit|clutch|ranked|youtube|yt|tiktok|twitch|ttv|discord|insta(gram)?|robux|admin|abuse|event|ft|feat)(?=$|[^\p{L}\p{N}])/giu;

/** Removes URLs, handles, numbers, emojis and game jargon before detection. */
export function cleanText(text) {
  return String(text ?? '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/[#@][\p{L}\p{N}_.]+/gu, ' ')
    .replace(NOISE, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[\p{N}]+/gu, ' ')
    .replace(/[^\p{L}\s']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "en-US" -> "en", "fil" -> "tl", "zxx"/"other" -> null. */
export function normalizeLangCode(code) {
  const c = String(code ?? '').toLowerCase().trim();
  if (!c || ['zxx', 'und', 'mul', 'other', 'asl'].includes(c)) return null;
  const base = c.split(/[-_]/)[0];
  if (base === 'fil') return 'tl';
  if (base === 'iw') return 'he';
  if (base === 'in') return 'id';
  return /^[a-z]{2}$/.test(base) ? base : null;
}

/** Detects the language of one text; null if too short or unreliable. */
export function detectLanguage(text, { minLength = 20 } = {}) {
  if (!detector) return null;
  const cleaned = cleanText(text);
  if (cleaned.length < minLength) return null;
  try {
    const r = detector.detect(cleaned);
    if (!r?.language || (typeof r.isReliable === 'function' && !r.isReliable())) return null;
    return r.language;
  } catch {
    return null;
  }
}

/** Detects over several texts: joined first, otherwise a majority vote of the single texts. */
export function detectFromTexts(texts) {
  const list = (texts || []).map((t) => String(t ?? '')).filter((t) => t.trim());
  if (!list.length) return null;
  const joined = detectLanguage(list.join('. '));
  if (joined) return joined;
  const votes = {};
  let total = 0;
  for (const t of list) {
    const lang = detectLanguage(t, { minLength: 15 });
    if (!lang) continue;
    votes[lang] = (votes[lang] || 0) + 1;
    total++;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return best && total >= 2 && best[1] / total >= 0.5 ? best[0] : null;
}

function majority(codes) {
  const counts = {};
  let total = 0;
  for (const c of codes.map(normalizeLangCode).filter(Boolean)) {
    counts[c] = (counts[c] || 0) + 1;
    total++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] / total >= 0.5 ? best[0] : null;
}

/**
 * Picks a creator language from platform metadata and texts.
 * preferPlatform=true (Twitch): the platform language wins. Otherwise (YouTube) a reliable
 * text detection wins when it disagrees with the metadata (metadata is often a default value).
 * Returns { language, source: 'platform'|'detected' } or { language: null }.
 */
export function pickLanguage({ platformLangs = [], texts = [], preferPlatform = false } = {}) {
  const platform = majority(platformLangs);
  if (platform && preferPlatform) return { language: platform, source: 'platform' };
  const detected = detectFromTexts(texts);
  if (detected && platform && detected !== platform) return { language: detected, source: 'detected' };
  if (platform) return { language: platform, source: 'platform' };
  if (detected) return { language: detected, source: 'detected' };
  return { language: null, source: null };
}
