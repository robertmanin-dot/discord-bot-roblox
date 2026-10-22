// Test doubles for Discord objects used by the Bot part B tests (no network).
import { getDb } from '../src/core/db.js';
import { getSettings, updateSettings } from '../src/core/settings.js';

let nextId = 1000;
const newId = () => String(nextId++);

export function fakeMessage(channel, payload) {
  const msg = {
    id: newId(),
    channelId: channel.id,
    url: `https://discord.com/channels/g1/${channel.id}/x`,
    payload,
    edits: [],
    thread: null,
    async edit(p) {
      this.edits.push(p);
      this.payload = p;
      return this;
    },
    async startThread(opts) {
      const t = fakeChannel(`thread-${this.id}`);
      t.name = opts.name;
      this.thread = t;
      channel.registry?.set(t.id, t);
      return t;
    },
  };
  return msg;
}

export function fakeChannel(id, registry = null) {
  const ch = {
    id,
    registry,
    sent: [],
    byId: new Map(),
    isTextBased: () => true,
    async send(p) {
      const msg = fakeMessage(ch, typeof p === 'string' ? { content: p } : p);
      ch.sent.push(msg);
      ch.byId.set(msg.id, msg);
      return msg;
    },
    messages: {
      fetch: async (mid) => {
        const m = ch.byId.get(mid);
        if (!m) throw new Error('Unknown Message');
        return m;
      },
    },
  };
  registry?.set(id, ch);
  return ch;
}

export function fakeUser(id) {
  return {
    id,
    tag: `user${id}`,
    username: `user${id}`,
    dms: [],
    dmClosed: false,
    async send(p) {
      if (this.dmClosed) throw new Error('Cannot send messages to this user');
      this.dms.push(typeof p === 'string' ? { content: p } : p);
      return {};
    },
  };
}

export function fakeMember(user, roleIds = [], { staff = false } = {}) {
  const roles = new Set(roleIds);
  return {
    id: user.id,
    user,
    roleSet: roles,
    roles: {
      cache: { has: (r) => roles.has(r) },
      add: async (r) => {
        roles.add(r);
      },
      remove: async (r) => {
        roles.delete(r);
      },
    },
    permissions: { has: () => staff },
  };
}

/**
 * Fake bot ctx with channels for the standard keys, users, members and a fake guild.
 * Role/channel IDs are written into the settings like /setup would.
 */
export function fakeCtx({ fetchImpl } = {}) {
  const registry = new Map();
  const keys = ['playtests', 'bugs', 'launch', 'reviews', 'botLog', 'testerJoin'];
  const channelIds = {};
  for (const k of keys) channelIds[k] = `ch-${k}`;
  updateSettings({ discord: { roles: { tester: 'role-tester', creator: 'role-creator', staff: 'role-staff' }, channels: channelIds } });
  for (const k of keys) fakeChannel(channelIds[k], registry);

  const users = new Map();
  const members = new Map();
  const scheduled = [];
  const provided = {};
  const logs = [];
  const getUser = (id) => {
    if (!users.has(id)) users.set(id, fakeUser(id));
    return users.get(id);
  };
  const guild = {
    id: 'g1',
    scheduledEvents: {
      async create(opts) {
        const ev = { id: `se-${scheduled.length + 1}`, ...opts, status: 1 };
        scheduled.push(ev);
        return ev;
      },
      async edit(id, opts) {
        const ev = scheduled.find((e) => e.id === id);
        if (!ev) throw new Error('Unknown Event');
        Object.assign(ev, opts);
        return ev;
      },
      async delete(id) {
        const i = scheduled.findIndex((e) => e.id === id);
        if (i < 0) throw new Error('Unknown Event');
        scheduled.splice(i, 1);
      },
    },
  };
  const ctx = {
    client: {
      users: { fetch: async (id) => getUser(id) },
      channels: {
        fetch: async (id) => {
          const ch = registry.get(id);
          if (!ch) throw new Error('Unknown Channel');
          return ch;
        },
      },
    },
    log: { debug: () => {}, info: () => {}, warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    db: () => getDb(),
    settings: () => getSettings(),
    updateSettings,
    guildId: () => 'g1',
    guild: () => guild,
    isOurGuild: (id) => id === 'g1',
    roleId: (key) => getSettings().discord.roles?.[key] || null,
    channelId: (key) => getSettings().discord.channels?.[key] || null,
    async channel(key) {
      const id = ctx.channelId(key);
      return id ? registry.get(id) || null : null;
    },
    async member(userId) {
      return members.get(userId) || null;
    },
    isStaff: (m) => Boolean(m?.permissions?.has?.()),
    provide: (name, fn) => {
      provided[name] = fn;
    },
    async post(key, payload) {
      const ch = await ctx.channel(key);
      return ch ? ch.send(payload) : null;
    },
    async postLog(payload) {
      logs.push(typeof payload === 'string' ? payload : JSON.stringify(payload));
      return null;
    },
    fetchImpl,
  };
  return {
    ctx,
    registry,
    channel: (key) => registry.get(channelIds[key]),
    user: getUser,
    users,
    members,
    scheduled,
    provided,
    logs,
    addMember(id, roleKeys = [], opts = {}) {
      const m = fakeMember(getUser(id), roleKeys.map((k) => getSettings().discord.roles[k]), opts);
      members.set(id, m);
      return m;
    },
  };
}

/** Fake interaction; type: command|button|select|modal|autocomplete. */
export function fakeInteraction({
  type,
  user,
  member = null,
  locale = 'de',
  commandName,
  subcommand,
  options = {},
  focused = '',
  customId,
  values,
  fields = {},
  message,
}) {
  const i = {
    user,
    member,
    locale,
    guildId: member ? 'g1' : null,
    commandName,
    customId,
    values,
    message,
    deferred: false,
    replied: false,
    replies: [],
    updates: [],
    modals: [],
    responded: null,
    options: {
      getSubcommand: () => subcommand,
      getString: (n) => (options[n] === undefined ? null : options[n]),
      getInteger: (n) => (options[n] === undefined ? null : options[n]),
      getBoolean: (n) => (options[n] === undefined ? null : options[n]),
      getFocused: () => focused,
    },
    fields: {
      getTextInputValue: (id) => {
        if (!(id in fields)) throw new Error(`no field ${id}`);
        return fields[id];
      },
    },
    async reply(p) {
      this.replied = true;
      this.replies.push(typeof p === 'string' ? { content: p } : p);
      return p;
    },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(p) {
      this.replies.push(typeof p === 'string' ? { content: p } : p);
      return p;
    },
    async followUp(p) {
      this.replies.push(typeof p === 'string' ? { content: p } : p);
      return p;
    },
    async update(p) {
      this.replied = true;
      this.updates.push(p);
      return p;
    },
    async deferUpdate() {
      this.deferred = true;
    },
    async showModal(m) {
      this.replied = true;
      this.modals.push(m);
    },
    async respond(choices) {
      this.responded = choices;
    },
    isChatInputCommand: () => type === 'command',
    isAutocomplete: () => type === 'autocomplete',
    isButton: () => type === 'button',
    isAnySelectMenu: () => type === 'select',
    isModalSubmit: () => type === 'modal',
  };
  return i;
}

/** Text of the last reply/edit. */
export const lastReply = (i) => {
  const r = i.replies[i.replies.length - 1];
  return typeof r === 'string' ? r : r?.content ?? '';
};
