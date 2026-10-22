// Minimal fakes for discord.js objects used by bot part A tests (not a test file itself).
import { createCtx } from '../src/bot/context.js';

let idCounter = 1000;
export const nextId = () => String(++idCounter);

class Coll extends Map {
  find(fn) {
    for (const v of this.values()) if (fn(v)) return v;
    return undefined;
  }
  filter(fn) {
    const out = new Coll();
    for (const [k, v] of this) if (fn(v)) out.set(k, v);
    return out;
  }
  first() {
    return this.values().next().value;
  }
}
export { Coll };

export function fakeMessage(channel, payload) {
  const msg = {
    id: nextId(),
    channelId: channel.id,
    payload,
    edits: [],
    async edit(p) {
      msg.edits.push(p);
      msg.payload = p;
      return msg;
    },
  };
  return msg;
}

export function fakeChannel({ id = nextId(), name = 'chan', type = 0, parentId = null } = {}) {
  const messages = new Coll();
  const channel = {
    id,
    name,
    type,
    parentId,
    sent: [],
    invitesCreated: [],
    overwritesSet: [],
    isTextBased: () => type === 0,
    async send(payload) {
      const msg = fakeMessage(channel, payload);
      messages.set(msg.id, msg);
      channel.sent.push(msg);
      return msg;
    },
    messages: {
      async fetch(mid) {
        const m = messages.get(mid);
        if (!m) throw new Error('Unknown Message');
        return m;
      },
    },
    async createInvite(opts) {
      const code = `INV${channel.invitesCreated.length + 1}${id.slice(-2)}`;
      channel.invitesCreated.push({ code, opts });
      const invite = { code, uses: 0 };
      channel.onInvite?.(invite);
      return invite;
    },
    permissionOverwrites: {
      async set(list) {
        channel.overwritesSet.push(list);
      },
    },
    async setParent(pid) {
      channel.parentId = pid;
    },
  };
  return channel;
}

export function fakeMember({ id = nextId(), staff = false, roles = [] } = {}) {
  const cache = new Coll(roles.map((r) => [r, { id: r }]));
  const member = {
    id,
    displayName: `User${id}`,
    user: { id, tag: `user${id}`, username: `user${id}`, bot: false, dms: [], async send(p) { member.user.dms.push(p); } },
    dms: null,
    roles: {
      cache,
      added: [],
      removed: [],
      async add(r) {
        for (const x of [].concat(r)) {
          cache.set(x, { id: x });
          member.roles.added.push(x);
        }
      },
      async remove(r) {
        for (const x of [].concat(r)) {
          cache.delete(x);
          member.roles.removed.push(x);
        }
      },
    },
    permissions: { has: () => staff },
    async send(p) {
      member.user.dms.push(p);
    },
  };
  member.dms = member.user.dms;
  return member;
}

/** Fake guild with roles/channels/members/invites managers. */
export function fakeGuild({ id = 'g1', name = 'Testserver' } = {}) {
  const roles = new Coll();
  const channels = new Coll();
  const members = new Coll();
  let invites = new Coll();
  const everyone = { id, name: '@everyone', editable: false };
  roles.set(id, everyone);
  const me = fakeMember({ id: 'bot1', staff: true });
  const guild = {
    id,
    name,
    memberCount: 3,
    created: { roles: [], channels: [] },
    roles: {
      cache: roles,
      everyone,
      async fetch() {
        return roles;
      },
      async create(opts) {
        const role = { id: nextId(), name: opts.name, editable: true, opts };
        roles.set(role.id, role);
        guild.created.roles.push(role);
        return role;
      },
    },
    channels: {
      cache: channels,
      async fetch() {
        return channels;
      },
      async create(opts) {
        const ch = fakeChannel({ name: opts.name, type: opts.type, parentId: opts.parent || null });
        ch.onInvite = (inv) => invites.set(inv.code, inv);
        ch.createOpts = opts;
        channels.set(ch.id, ch);
        guild.created.channels.push(ch);
        return ch;
      },
    },
    members: {
      cache: members,
      me,
      async fetch(mid) {
        const m = members.get(mid);
        if (!m) throw new Error('Unknown Member');
        return m;
      },
      async fetchMe() {
        return me;
      },
    },
    invites: {
      async fetch() {
        return invites;
      },
    },
    setInvites(list) {
      invites = new Coll(list.map((i) => [i.code, i]));
    },
    addMember(m) {
      m.guild = guild;
      members.set(m.id, m);
      return m;
    },
    addChannel(ch) {
      ch.onInvite = (inv) => invites.set(inv.code, inv);
      channels.set(ch.id, ch);
      return ch;
    },
  };
  return guild;
}

/** Fake client + real ctx (createCtx) bound to the fake guild. */
export function fakeBot(guild) {
  const users = new Coll();
  const client = {
    user: { id: 'bot1', tag: 'Bot#0001' },
    guilds: { cache: new Coll([[guild.id, guild]]) },
    channels: {
      async fetch(cid) {
        const ch = guild.channels.cache.get(cid);
        if (!ch) throw new Error('Unknown Channel');
        return ch;
      },
    },
    users: {
      cache: users,
      async fetch(uid) {
        const m = guild.members.cache.get(uid);
        if (m) return m.user;
        throw new Error('Unknown User');
      },
    },
    isReady: () => true,
  };
  const bot = { client, guildId: guild.id };
  const ctx = createCtx(bot);
  return { bot, client, ctx };
}

/** Fake interaction. Records replies/updates/modals. */
export function fakeInteraction({ guild, member, locale = 'de', customId = '', values = [], staff = false, options = {}, fields = {}, fromMessage = true } = {}) {
  const log = { replies: [], updates: [], edits: [], followUps: [], modals: [], deferred: 0 };
  const i = {
    locale,
    guild,
    guildId: guild?.id,
    member,
    user: member?.user,
    customId,
    values,
    memberPermissions: { has: () => staff },
    replied: false,
    deferred: false,
    log,
    options: {
      getSubcommand: () => options.subcommand,
      getString: (n) => options[n] ?? null,
      getInteger: (n) => options[n] ?? null,
      getBoolean: (n) => options[n] ?? null,
      getUser: (n) => options[n] ?? null,
    },
    fields: {
      getTextInputValue: (id) => {
        if (!(id in fields)) throw new Error(`no field ${id}`);
        return fields[id];
      },
    },
    isFromMessage: () => fromMessage,
    async reply(p) {
      i.replied = true;
      log.replies.push(p);
    },
    async update(p) {
      i.replied = true;
      log.updates.push(p);
    },
    async deferReply() {
      i.deferred = true;
      log.deferred++;
    },
    async deferUpdate() {
      i.deferred = true;
      log.deferred++;
    },
    async editReply(p) {
      log.edits.push(p);
    },
    async followUp(p) {
      log.followUps.push(p);
    },
    async showModal(m) {
      log.modals.push(m);
    },
  };
  return i;
}

/** JSON of discord.js builders (components/embeds) for assertions. */
export const json = (x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x);
