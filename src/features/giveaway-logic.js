/**
 * Reine Logik für Giveaways (ohne Discord), damit sie sich leicht testen lässt.
 */
const crypto = require('node:crypto');

/**
 * Prüft, ob jemand bei einer Verlosung mitmachen darf, und wie viele Lose er bekommt.
 * final = true bei der Auslosung: Dann werden alle Bedingungen endgültig geprüft.
 */
function checkEligibility(store, giveaway, discordId, { final = false, at = Math.floor(Date.now() / 1000) } = {}) {
  const tester = store.getTester(discordId);
  if (!tester) return { ok: false, reason: 'Nur angenommene Tester können mitmachen.' };

  let pending = null;
  if (giveaway.playtest_id) {
    const pt = store.getPlaytest(giveaway.playtest_id);
    if (!pt) return { ok: false, reason: 'Der zugehörige Playtest existiert nicht mehr.' };
    const minMinutes = giveaway.min_minutes ?? pt.min_minutes;
    const start = pt.starts_at;
    const end = pt.starts_at + pt.duration_min * 60;
    const seconds = store.playtimeSeconds(tester.roblox_id, start, end);
    const reached = seconds >= minMinutes * 60;
    if (!reached) {
      if (final || at >= end) {
        return {
          ok: false,
          reason: `Du musst beim Playtest „${pt.title}“ mindestens ${minMinutes} Min. gespielt haben (du hattest ${Math.floor(seconds / 60)} Min.).`,
        };
      }
      pending = `Bedingung: mindestens ${minMinutes} Min. beim Playtest „${pt.title}“ spielen. Das wird bei der Auslosung geprüft.`;
    }
  }

  let tickets = 1;
  if (giveaway.weighted) {
    tickets += store.playtestsAttended(discordId) + store.validBugCount(discordId);
  }
  return { ok: true, tickets, pending };
}

/**
 * Zieht `count` verschiedene Gewinner. Mehr Lose = höhere Chance.
 * candidates: [{ id, tickets }]
 */
function drawWinners(candidates, count, randomInt = crypto.randomInt) {
  const pool = candidates.filter((c) => c.tickets > 0).map((c) => ({ ...c }));
  const winners = [];
  while (winners.length < count && pool.length) {
    const total = pool.reduce((sum, c) => sum + c.tickets, 0);
    let roll = randomInt(total);
    let index = 0;
    while (roll >= pool[index].tickets) {
      roll -= pool[index].tickets;
      index += 1;
    }
    winners.push(pool[index].id);
    pool.splice(index, 1);
  }
  return winners;
}

module.exports = { checkEligibility, drawWinners };
