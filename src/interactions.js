/**
 * Leitet Befehle, Buttons und Formulare an die passende Funktion weiter.
 * Button-IDs haben das Format "bereich:aktion:id[:extra]", damit sie auch nach einem Neustart funktionieren.
 */
const { MessageFlags } = require('discord.js');
const admin = require('./features/admin');
const applications = require('./features/applications');
const playtests = require('./features/playtests');
const giveaways = require('./features/giveaways');
const stats = require('./features/stats');
const bugs = require('./features/bugs');

const slashHandlers = {
  'setup einstellungen': admin.settings,
  'setup bewerbungs-panel': admin.panel,
  'tester hinzufuegen': admin.addTester,
  'tester entfernen': admin.removeTester,
  'tester anzahl': admin.count,
  'playtest erstellen': playtests.create,
  'playtest liste': playtests.list,
  'playtest auswertung': playtests.report,
  'playtest absagen': playtests.cancel,
  'giveaway verlosung': giveaways.createRaffle,
  'giveaway rangliste': giveaways.createLeaderboard,
  'giveaway liste': giveaways.list,
  'giveaway beenden': giveaways.endNow,
  'giveaway neu-auslosen': giveaways.reroll,
  profil: stats.profile,
  rangliste: stats.leaderboard,
  bug: bugs.open,
};

function commandKey(interaction) {
  const sub = interaction.options.getSubcommand(false);
  return sub ? `${interaction.commandName} ${sub}` : interaction.commandName;
}

async function handleAutocomplete(interaction, ctx) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'wert') return stats.autocompleteStat(interaction, ctx);
  if (interaction.commandName === 'giveaway' && focused.name === 'id') return giveaways.autocompleteIds(interaction, ctx);
  if (focused.name === 'id' || focused.name === 'playtest') return playtests.autocomplete(interaction, ctx);
  return interaction.respond([]);
}

async function handleComponent(interaction, ctx) {
  const [area, action, rawId, extra] = interaction.customId.split(':');
  const id = Number(rawId);

  if (area === 'app') {
    if (action === 'start') return applications.handleStart(interaction, ctx);
    if (action === 'accept') return applications.handleAccept(interaction, ctx, id);
    if (action === 'reject') return applications.handleRejectButton(interaction, ctx, id);
  }
  if (area === 'pt' && action === 'join') return playtests.toggleSignup(interaction, ctx, id);
  if (area === 'ga' && action === 'enter') return giveaways.toggleEntry(interaction, ctx, id);
  if (area === 'ga' && action === 'standings') return giveaways.showStandings(interaction, ctx, id);
  if (area === 'bug' && action === 'status') return bugs.setStatus(interaction, ctx, id, extra);
  return null;
}

async function handleModal(interaction, ctx) {
  const [area, action, rawId] = interaction.customId.split(':');
  if (area === 'app' && action === 'submit') return applications.handleSubmit(interaction, ctx);
  if (area === 'app' && action === 'rejectreason') return applications.handleRejectSubmit(interaction, ctx, Number(rawId));
  if (area === 'bug' && action === 'submit') return bugs.submit(interaction, ctx);
  return null;
}

async function handleInteraction(interaction, ctx) {
  try {
    if (interaction.isAutocomplete()) return await handleAutocomplete(interaction, ctx);
    if (interaction.isChatInputCommand()) {
      const handler = slashHandlers[commandKey(interaction)];
      if (handler) return await handler(interaction, ctx);
      return null;
    }
    if (interaction.isButton()) return await handleComponent(interaction, ctx);
    if (interaction.isModalSubmit()) return await handleModal(interaction, ctx);
  } catch (err) {
    console.error('[interaction] Fehler:', interaction.customId ?? interaction.commandName, err);
    if (interaction.isAutocomplete()) return null;
    const payload = { content: '⚠️ Da ist etwas schiefgelaufen. Bitte versuch es nochmal.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch {
      // Interaktion ist abgelaufen, nichts mehr zu tun
    }
  }
  return null;
}

module.exports = { handleInteraction, slashHandlers };
