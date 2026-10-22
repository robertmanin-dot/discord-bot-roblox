// Discord bot core: login, slash-command registration, interaction routing, jobs.
// Features live in ./modules/*.js (see docs/ARCHITEKTUR.md for the module interface).
import { Client, Events, GatewayIntentBits, OAuth2Scopes, PermissionsBitField } from 'discord.js';
import { env } from '../core/config.js';
import { createLogger } from '../core/log.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { services } from '../core/services.js';
import { schedule, stopAll } from '../core/scheduler.js';
import { createCtx } from './context.js';
import { EPHEMERAL, parseCid, safeReply, tr } from './util.js';
import { MODULES } from './modules/index.js';

const log = createLogger('bot');

export const BOT_PERMISSIONS = new PermissionsBitField([
  'CreateInstantInvite',
  'ManageChannels',
  'ManageGuild',
  'ManageRoles',
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'ManageThreads',
  'EmbedLinks',
  'AttachFiles',
  'ReadMessageHistory',
  'ManageMessages',
  'MentionEveryone',
  'AddReactions',
  'UseExternalEmojis',
  'ManageEvents',
]);

const T = {
  de: { error: '⚠️ Da ist etwas schiefgelaufen. Bitte versuch es gleich nochmal – das Team wurde informiert.' },
  en: { error: '⚠️ Something went wrong. Please try again in a moment – the team has been notified.' },
};

/** Collects handlers from all modules and fails loudly on duplicate names/prefixes. */
export function buildHandlers(modules = MODULES) {
  const maps = { commands: new Map(), autocomplete: new Map(), buttons: new Map(), selects: new Map(), modals: new Map() };
  for (const mod of modules) {
    for (const kind of Object.keys(maps)) {
      const key = kind === 'commands' ? 'commandHandlers' : kind;
      for (const [name, fn] of Object.entries(mod[key] || {})) {
        if (maps[kind].has(name)) throw new Error(`Doppelter Handler "${name}" (${kind}) in Modul ${mod.name}`);
        maps[kind].set(name, fn);
      }
    }
  }
  return maps;
}

/** All slash-command definitions as JSON (validated by discord.js builders). */
export function commandDefinitions(modules = MODULES) {
  const body = modules.flatMap((m) => m.commands || []).map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c));
  const names = new Set();
  for (const c of body) {
    if (names.has(c.name)) throw new Error(`Doppelter Slash-Befehl /${c.name}`);
    names.add(c.name);
  }
  return body;
}

function friendlyLoginError(err) {
  const msg = String(err?.message || err);
  if (/disallowed intents/i.test(msg)) {
    return 'Im Discord Developer Portal fehlt "Server Members Intent" (Bot → Privileged Gateway Intents → einschalten und speichern).';
  }
  if (/invalid token|TokenInvalid/i.test(msg) || err?.code === 'TokenInvalid') {
    return 'Der Bot-Token ist ungültig. Im Developer Portal unter Bot → "Reset Token" einen neuen erzeugen und hier eintragen.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(msg)) {
    return 'Discord ist nicht erreichbar (Internetverbindung/Firewall prüfen).';
  }
  return msg;
}

export class Bot {
  constructor(modules = MODULES) {
    this.modules = modules;
    this.client = null;
    this.state = 'disabled'; // disabled|connecting|ready|error
    this.error = null;
    this.guildId = null;
    this.commandsRegistered = 0;
    this.handlers = buildHandlers(modules);
    this.ctx = createCtx(this);
    this.readyModules = false;
  }

  isReady() {
    return this.state === 'ready' && Boolean(this.client?.isReady?.());
  }

  inviteUrl() {
    const appId = this.client?.application?.id || this.client?.user?.id;
    if (!appId) return null;
    const scopes = [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join('%20');
    return `https://discord.com/oauth2/authorize?client_id=${appId}&scope=${scopes}&permissions=${BOT_PERMISSIONS.bitfield}`;
  }

  status() {
    const guild = this.ctx.guild();
    return {
      state: this.state,
      error: this.error,
      tag: this.client?.user?.tag || null,
      appId: this.client?.application?.id || this.client?.user?.id || null,
      guild: guild ? { id: guild.id, name: guild.name, memberCount: guild.memberCount } : null,
      guilds: this.client ? [...this.client.guilds.cache.values()].map((g) => ({ id: g.id, name: g.name })) : [],
      inviteUrl: this.inviteUrl(),
      commandsRegistered: this.commandsRegistered,
      modules: this.modules.map((m) => m.name),
    };
  }

  async start() {
    const token = env('DISCORD_TOKEN');
    if (!token) {
      this.state = 'disabled';
      this.error = null;
      return false;
    }
    if (this.client) await this.stop();
    this.state = 'connecting';
    this.error = null;
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites],
      allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
    });
    this.client = client;

    client.once(Events.ClientReady, () => this.onReady().catch((err) => log.error('Fehler beim Start:', err)));
    client.on(Events.GuildCreate, (guild) => this.onGuildCreate(guild).catch((err) => log.error(err)));
    client.on(Events.InteractionCreate, (interaction) => this.handleInteraction(interaction));
    client.on(Events.Error, (err) => log.error('Discord-Fehler:', err));
    client.on(Events.ShardDisconnect, () => log.warn('Verbindung zu Discord getrennt – verbinde neu …'));

    for (const mod of this.modules) {
      for (const [event, fn] of Object.entries(mod.events || {})) {
        client.on(event, (...args) => {
          if (!this.isReady()) return;
          Promise.resolve()
            .then(() => fn(this.ctx, ...args))
            .catch((err) => log.error(`Event ${event} (${mod.name}):`, err));
        });
      }
    }

    try {
      await client.login(token);
      return true;
    } catch (err) {
      this.state = 'error';
      this.error = friendlyLoginError(err);
      log.error('Discord-Login fehlgeschlagen:', this.error);
      try {
        await client.destroy();
      } catch { /* ignore */ }
      this.client = null;
      return false;
    }
  }

  async stop() {
    stopAll('bot:');
    if (this.client) {
      try {
        await this.client.destroy();
      } catch { /* ignore */ }
    }
    this.client = null;
    this.guildId = null;
    this.readyModules = false;
    this.state = env('DISCORD_TOKEN') ? 'error' : 'disabled';
    if (this.state === 'error') this.error = 'Bot gestoppt.';
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  resolveGuild() {
    const client = this.client;
    const configured = getSettings().discord.guildId;
    if (configured && client.guilds.cache.has(configured)) {
      this.guildId = configured;
      return;
    }
    if (configured) log.warn(`Bot ist nicht auf dem eingestellten Server (${configured}).`);
    if (client.guilds.cache.size === 1) {
      const only = client.guilds.cache.first();
      this.guildId = only.id;
      updateSettings({ discord: { guildId: only.id } });
      log.info(`Server automatisch gewählt: ${only.name}`);
      return;
    }
    this.guildId = null;
    if (client.guilds.cache.size > 1) {
      log.warn('Bot ist auf mehreren Servern – bitte die Server-ID in den Einstellungen festlegen.');
    } else {
      log.warn('Bot ist noch auf keinem Server. Einladungslink: ' + (this.inviteUrl() || '(nach dem Start verfügbar)'));
    }
  }

  async registerCommands() {
    const guild = this.ctx.guild();
    if (!guild) return;
    const body = commandDefinitions(this.modules);
    await guild.commands.set(body);
    this.commandsRegistered = body.length;
    log.info(`${body.length} Slash-Befehle auf "${guild.name}" registriert.`);
  }

  async onReady() {
    try {
      await this.client.application?.fetch();
    } catch { /* not critical */ }
    this.state = 'ready';
    this.error = null;
    log.info(`Discord-Bot online als ${this.client.user.tag}`);
    this.resolveGuild();
    await this.activateGuild();
  }

  async activateGuild() {
    if (!this.guildId) return;
    try {
      await this.registerCommands();
    } catch (err) {
      log.error('Slash-Befehle konnten nicht registriert werden:', err);
    }
    for (const mod of this.modules) {
      if (typeof mod.onReady === 'function') {
        try {
          await mod.onReady(this.ctx);
        } catch (err) {
          log.error(`onReady (${mod.name}):`, err);
        }
      }
    }
    this.startJobs();
    this.readyModules = true;
  }

  async onGuildCreate(guild) {
    log.info(`Bot wurde zu "${guild.name}" hinzugefügt.`);
    if (!this.guildId) {
      this.guildId = guild.id;
      updateSettings({ discord: { guildId: guild.id } });
      await this.activateGuild();
    }
  }

  startJobs() {
    stopAll('bot:');
    for (const mod of this.modules) {
      for (const job of mod.jobs || []) {
        schedule(
          `bot:${mod.name}:${job.name}`,
          job.everyMs,
          async () => {
            if (this.isReady() && this.guildId) await job.run(this.ctx);
          },
          { runImmediately: job.runImmediately ?? true, initialDelayMs: job.initialDelayMs ?? 5000 },
        );
      }
    }
  }

  async handleInteraction(interaction) {
    if (interaction.guildId && this.guildId && interaction.guildId !== this.guildId) return;
    const h = this.handlers;
    let fn = null;
    if (interaction.isChatInputCommand()) fn = h.commands.get(interaction.commandName);
    else if (interaction.isAutocomplete()) fn = h.autocomplete.get(interaction.commandName);
    else if (interaction.isButton()) fn = h.buttons.get(parseCid(interaction.customId).prefix);
    else if (interaction.isAnySelectMenu()) fn = h.selects.get(parseCid(interaction.customId).prefix);
    else if (interaction.isModalSubmit()) fn = h.modals.get(parseCid(interaction.customId).prefix);
    if (!fn) return;
    try {
      await fn(interaction, this.ctx);
    } catch (err) {
      const what = interaction.commandName ? `/${interaction.commandName}` : interaction.customId;
      log.error(`Fehler bei ${what}:`, err);
      if (!interaction.isAutocomplete()) {
        await safeReply(interaction, { content: tr(T, interaction.locale, 'error'), flags: EPHEMERAL });
      }
      this.ctx.postLog(`⚠️ Fehler bei \`${what}\`: ${String(err.message).slice(0, 1500)}`).catch(() => {});
    }
  }
}

/** Creates the bot and registers it as services.bot for the dashboard. */
export function createBot(modules = MODULES) {
  const bot = new Bot(modules);
  Object.assign(services.bot, {
    status: () => bot.status(),
    isReady: () => bot.isReady(),
    inviteUrl: () => bot.inviteUrl(),
    restart: () => bot.restart(),
  });
  return bot;
}
