// Small shared helpers for radar modules.
import { getDb } from '../core/db.js';
import { getCreator } from '../core/creators.js';
import { normalizeHandle } from '../core/util.js';

export const VALID_AGE_GROUPS = ['unbekannt', 'u13', '13-15', '16-17', '18+'];

/** Merges tag lists (array or "a, b | c"), keeps order, no duplicates. */
export function mergeTags(existing, add) {
  const cur = Array.isArray(existing) ? existing : [];
  const list = (Array.isArray(add) ? add : String(add ?? '').split(/[,|]/)).map((t) => String(t).trim()).filter(Boolean);
  return [...new Set([...cur, ...list])];
}

/**
 * Existing creator that owns one of the linked profiles (e.g. the TikTok linked in a YouTube
 * description). Only used if that creator has no own account on `platform` yet, so two different
 * channels that link each other are not merged.
 */
export function findCreatorByLinkedProfiles(profiles, platform) {
  const db = getDb();
  for (const p of profiles || []) {
    let row = null;
    if (p.handle) {
      row = db.get('SELECT creator_id FROM accounts WHERE platform = :platform AND handle = :handle', { platform: p.platform, handle: normalizeHandle(p.handle) });
    } else if (p.externalId) {
      row = db.get('SELECT creator_id FROM accounts WHERE platform = :platform AND external_id = :id', { platform: p.platform, id: p.externalId });
    }
    if (!row) continue;
    const hasSame = db.get(
      "SELECT 1 FROM accounts WHERE creator_id = :id AND platform = :platform AND COALESCE(source, '') != 'crosslink'",
      { id: row.creator_id, platform },
    );
    if (!hasSame) return getCreator(row.creator_id);
  }
  return null;
}
