// Registry so the dashboard can call into the Discord bot (and vice versa) without import cycles.
//
// services.bot is always an object. Before the bot is connected only status()/isReady() work.
// Bot modules add functions with ctx.provide(name, fn), e.g.:
//   services.bot.createPersonalInvite(creatorId) -> Promise<{ code, url }>
//   services.bot.reviewApplication(id, action, staffUserId) -> Promise<application>
//   services.bot.createPlaytest(data) / services.bot.createEvent(data)
export const services = {
  bot: {
    status: () => ({ state: 'disabled', error: null }),
    isReady: () => false,
    inviteUrl: () => null,
  },
};

/** Calls an optional bot function; throws a friendly error if the bot is offline or lacks it. */
export async function callBot(name, ...args) {
  const fn = services.bot?.[name];
  if (!services.bot?.isReady?.() || typeof fn !== 'function') {
    const err = new Error('Der Discord-Bot ist nicht verbunden. Prüfe Token und Status unter "Einrichtung".');
    err.status = 503;
    throw err;
  }
  return fn(...args);
}
