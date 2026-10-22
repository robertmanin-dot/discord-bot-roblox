/**
 * Minimale Nachbauten von Discord-Objekten, um Abläufe ohne echte Discord-Verbindung zu testen.
 */
const { ChannelType, PermissionFlagsBits } = require('discord.js');

let nextId = 1000;
const newId = () => String(nextId++);

function toJson(payload) {
  if (typeof payload === 'string') return { content: payload };
  return {
    ...payload,
    embeds: (payload.embeds ?? []).map((e) => (typeof e.toJSON === 'function' ? e.toJSON() : e)),
    components: (payload.components ?? []).map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c)),
  };
}

function createMessage(channel, payload) {
  const message = {
    id: newId(),
    channelId: channel.id,
    channel,
    ...toJson(payload),
    thread: null,
    async edit(update) {
      Object.assign(message, toJson(update));
      message.edits.push(toJson(update));
      return message;
    },
    edits: [],
    async startThread({ name }) {
      message.thread = createChannel({ type: ChannelType.PublicThread, name });
      return message.thread;
    },
  };
  return message;
}

function createChannel({ id = newId(), type = ChannelType.GuildText, name = 'kanal', client = null } = {}) {
  const channel = {
    id,
    type,
    name,
    sent: [],
    messageMap: new Map(),
    isThread: () => type === ChannelType.PublicThread,
    async send(payload) {
      const message = createMessage(channel, payload);
      channel.sent.push(message);
      channel.messageMap.set(message.id, message);
      return message;
    },
    async setName(newName) {
      channel.name = newName;
    },
    messages: {
      fetch: async (messageId) => {
        const m = channel.messageMap.get(messageId);
        if (!m) throw new Error('Unknown Message');
        return m;
      },
    },
    threads: {
      created: [],
      create: async ({ name, message: payload }) => {
        const thread = createChannel({ type: ChannelType.PublicThread, name });
        const starter = await thread.send(payload);
        thread.fetchStarterMessage = async () => starter;
        channel.threads.created.push(thread);
        if (client) client.channelMap.set(thread.id, thread);
        return thread;
      },
    },
    toString: () => `<#${id}>`,
  };
  return channel;
}

function createClient() {
  const client = {
    user: { id: 'bot', tag: 'Bot#0001' },
    channelMap: new Map(),
    dms: [],
    blockedDms: new Set(),
    channels: {
      fetch: async (id) => {
        const c = client.channelMap.get(id);
        if (!c) throw new Error('Unknown Channel');
        return c;
      },
    },
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => {
          if (client.blockedDms.has(id)) throw new Error('Cannot send messages to this user');
          client.dms.push({ userId: id, ...toJson(payload) });
        },
      }),
    },
    addChannel(opts) {
      const c = createChannel({ ...opts, client });
      client.channelMap.set(c.id, c);
      return c;
    },
  };
  return client;
}

function createMember(id, { admin = false, roles = [] } = {}) {
  const roleSet = new Set(roles);
  return {
    id,
    permissions: { has: (perm) => admin && (perm === PermissionFlagsBits.ManageGuild || true) },
    roles: {
      cache: { has: (r) => roleSet.has(r) },
      added: [],
      removed: [],
      add: async (r) => {
        roleSet.add(r);
        return null;
      },
      remove: async (r) => {
        roleSet.delete(r);
        return null;
      },
    },
  };
}

function createGuild(members = {}) {
  return {
    id: 'guild',
    members: {
      me: null,
      fetch: async (id) => {
        if (!members[id]) throw new Error('Unknown Member');
        return members[id];
      },
    },
  };
}

/**
 * Baut eine Interaktion. kind: 'command' | 'button' | 'modal' | 'autocomplete'
 */
function createInteraction({
  kind,
  user = 'u1',
  member = null,
  guild = null,
  channel = null,
  commandName,
  subcommand = null,
  options = {},
  customId,
  fields = {},
  message = null,
  focused = null,
}) {
  const interaction = {
    kind,
    user: { id: user, tag: `${user}#0001` },
    member: member ?? createMember(user),
    guild: guild ?? createGuild(),
    guildId: 'guild',
    channel,
    commandName,
    customId,
    message,
    deferred: false,
    replied: false,
    replies: [],
    modal: null,
    responded: null,
    isAutocomplete: () => kind === 'autocomplete',
    isChatInputCommand: () => kind === 'command',
    isButton: () => kind === 'button',
    isModalSubmit: () => kind === 'modal',
    options: {
      getSubcommand: () => subcommand,
      getString: (n) => options[n] ?? null,
      getInteger: (n) => options[n] ?? null,
      getBoolean: (n) => options[n] ?? null,
      getUser: (n) => (options[n] ? { id: options[n] } : null),
      getRole: (n) => options[n] ?? null,
      getChannel: (n) => options[n] ?? null,
      getFocused: (full) => (full ? focused : focused?.value),
    },
    fields: {
      getTextInputValue: (id) => fields[id] ?? '',
      getStringSelectValues: (id) => fields[id] ?? [],
      getUploadedFiles: (id) => fields[id] ?? null,
    },
    async reply(payload) {
      if (interaction.replied || interaction.deferred) throw new Error('Interaction already acknowledged');
      interaction.replied = true;
      interaction.replies.push({ type: 'reply', ...toJson(payload) });
    },
    async deferReply() {
      if (interaction.replied || interaction.deferred) throw new Error('Interaction already acknowledged');
      interaction.deferred = true;
    },
    async deferUpdate() {
      if (interaction.replied || interaction.deferred) throw new Error('Interaction already acknowledged');
      interaction.deferred = true;
    },
    async editReply(payload) {
      if (!interaction.deferred && !interaction.replied) throw new Error('Interaction not replied');
      interaction.replies.push({ type: 'edit', ...toJson(payload) });
      if (message && kind !== 'command') Object.assign(message, toJson(typeof payload === 'string' ? { content: payload } : payload));
    },
    async followUp(payload) {
      interaction.replies.push({ type: 'followUp', ...toJson(payload) });
    },
    async showModal(modal) {
      if (interaction.replied || interaction.deferred) throw new Error('Interaction already acknowledged');
      interaction.replied = true;
      interaction.modal = modal.toJSON();
    },
    async respond(items) {
      interaction.responded = items;
    },
  };
  return interaction;
}

/** Letzter Text, den der Nutzer gesehen hat */
function lastText(interaction) {
  const last = interaction.replies[interaction.replies.length - 1];
  return last ? last.content ?? '' : '';
}

module.exports = { createClient, createChannel, createMember, createGuild, createInteraction, lastText };
