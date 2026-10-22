// Which invite did a new member use? Compare invite use counts before and after the join.

/**
 * before/after: Map<code, uses>. recentlyDeleted: Map<code, timestamp> (invites that vanished,
 * e.g. because they hit their max uses right with this join).
 */
export function diffInvites(before, after, recentlyDeleted = new Map()) {
  const used = [];
  for (const [code, uses] of after) {
    const prev = before.get(code);
    if (prev === undefined ? uses > 0 : uses > prev) used.push(code);
  }
  const vanished = [];
  for (const code of before.keys()) if (!after.has(code)) vanished.push(code);
  for (const code of recentlyDeleted.keys()) if (!after.has(code) && !vanished.includes(code)) vanished.push(code);
  return { used, vanished };
}

/** Picks the personal invite (isPersonal(code) === true) that was most likely used, or null. */
export function pickPersonalInvite({ used, vanished }, isPersonal) {
  const usedPersonal = used.filter((c) => isPersonal(c));
  if (usedPersonal.length >= 1) return usedPersonal[0];
  if (used.length > 0) return null; // a normal invite was used
  const vanishedPersonal = vanished.filter((c) => isPersonal(c));
  return vanishedPersonal.length === 1 ? vanishedPersonal[0] : null;
}

/** Discord limits: max_age 0..604800 s (7 days), max_uses 0..100. */
export function inviteOptions(discordSettings = {}, reason = '') {
  const days = Number(discordSettings.inviteMaxAgeDays) || 0;
  const maxAge = Math.min(604800, Math.max(0, Math.round(days * 86400)));
  const maxUses = Math.min(100, Math.max(0, Math.round(Number(discordSettings.inviteMaxUses) || 0)));
  return { maxAge, maxUses, unique: true, reason: String(reason).slice(0, 500) };
}
