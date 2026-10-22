// Personal Discord invites per creator: created from the dashboard, joins are detected automatically
// (invite use counts before/after a join) and moved into the pipeline as "Im Discord".
import { Events } from 'discord.js';
import { getDb } from '../../core/db.js';
import { ensureOutreach, getCreator, linkDiscordUser, logActivity, setOutreachStatus, updateOutreach } from '../../core/creators.js';
import { getActiveCampaignId } from '../../core/settings.js';
import { nowIso } from '../../core/time.js';
import { COLORS, embed, tr, tryDm } from '../util.js';
import { channelMention, userError } from '../lib/common.js';
import { diffInvites, inviteOptions, pickPersonalInvite } from '../lib/inviteDiff.js';

const T = {
  de: { welcome: 'Hey, schön dass du da bist! 👋 Bewirb dich hier als Founding Creator: {apply}' },
  en: { welcome: 'Hey, great to have you here! 👋 Apply as a Founding Creator here: {apply}' },
};

// Shared state (one guild).
const state = {
  uses: new Map(), // code -> uses
  recentlyDeleted: new Map(), // code -> timestamp
  ready: false,
};

export function _resetInviteState() {
  state.uses = new Map();
  state.recentlyDeleted = new Map();
  state.ready = false;
}

function toUseMap(invites) {
  const map = new Map();
  for (const inv of invites.values()) map.set(inv.code, inv.uses ?? 0);
  return map;
}

async function refreshCache(ctx) {
  const guild = ctx.guild();
  if (!guild) return false;
  const invites = await guild.invites.fetch();
  state.uses = toUseMap(invites);
  state.ready = true;
  return true;
}

function personalInvite(code) {
  return getDb().get('SELECT * FROM invites WHERE code = :code', { code });
}

/** Creates (or reuses) the personal invite of a creator. Returns { code, url, reused }. */
export async function createPersonalInvite(ctx, creatorId) {
  const creator = getCreator(Number(creatorId));
  if (!creator) throw userError('Creator nicht gefunden.', 404);
  if (!ctx.guild()) throw userError('Der Bot ist auf keinem Server.', 409);
  const db = getDb();

  const existing = db.all('SELECT * FROM invites WHERE creator_id = :creatorId ORDER BY created_at DESC, rowid DESC', { creatorId: creator.id });
  if (existing.length) {
    let authoritative = state.ready;
    if (!authoritative) {
      try {
        authoritative = await refreshCache(ctx);
      } catch (err) {
        ctx.log.warn('Einladungen konnten nicht geladen werden:', err.message);
      }
    }
    // Without an up-to-date invite list (missing permission) reuse the newest one instead of creating more.
    const valid = authoritative ? existing.find((inv) => state.uses.has(inv.code)) : existing[0];
    if (valid) {
      const outreach = ensureOutreach(creator.id);
      if (outreach.invite_code !== valid.code) updateOutreach(outreach.id, { invite_code: valid.code });
      return { code: valid.code, url: `https://discord.gg/${valid.code}`, reused: true };
    }
  }

  const channel = await ctx.channel('apply');
  if (!channel?.createInvite) throw userError('Kanal #creator-bewerbung fehlt – bitte im Discord /setup ausführen.', 409);
  let invite;
  try {
    invite = await channel.createInvite(inviteOptions(ctx.settings().discord, `Creator Radar: ${creator.display_name}`));
  } catch (err) {
    throw userError(`Einladung konnte nicht erstellt werden (${err.message}). Der Bot braucht das Recht „Einladung erstellen“.`, 409);
  }
  db.run(
    'INSERT OR REPLACE INTO invites (code, creator_id, campaign_id, channel_id, uses) VALUES (:code, :creatorId, :campaignId, :channelId, 0)',
    { code: invite.code, creatorId: creator.id, campaignId: getActiveCampaignId(), channelId: channel.id },
  );
  const outreach = ensureOutreach(creator.id);
  updateOutreach(outreach.id, { invite_code: invite.code });
  state.uses.set(invite.code, invite.uses ?? 0);
  return { code: invite.code, url: `https://discord.gg/${invite.code}`, reused: false };
}

/** Handles a new member: finds the personal invite they used and updates the creator. */
export async function handleMemberJoin(ctx, member) {
  if (!ctx.isOurGuild(member.guild?.id)) return null;
  if (member.user?.bot) return null;
  const before = new Map(state.uses);
  let after;
  try {
    after = toUseMap(await member.guild.invites.fetch());
  } catch (err) {
    ctx.log.warn('Einladungen konnten nicht geladen werden (Recht „Server verwalten“ fehlt?):', err.message);
    return null;
  }
  state.uses = after;
  state.ready = true;
  const now = Date.now();
  for (const [code, at] of state.recentlyDeleted) if (now - at > 120_000) state.recentlyDeleted.delete(code);

  const diff = diffInvites(before, after, state.recentlyDeleted);
  const code = pickPersonalInvite(diff, (c) => Boolean(personalInvite(c)));
  if (!code) return null;
  state.recentlyDeleted.delete(code);

  const inv = personalInvite(code);
  getDb().run('UPDATE invites SET uses = :uses WHERE code = :code', { code, uses: after.get(code) ?? (inv.uses || 0) + 1 });
  const creator = inv.creator_id ? getCreator(inv.creator_id) : null;
  if (!creator) return null;

  const tag = member.user?.tag ?? member.user?.username ?? null;
  linkDiscordUser(creator.id, member.id, tag);
  setOutreachStatus(creator.id, 'im_discord', { extra: { joined_discord_at: nowIso() }, data: { invite: code } });
  logActivity(creator.id, 'joined_discord', { code, discordUserId: member.id });
  try {
    ctx.bus.emit('creator.joined', { creatorId: creator.id, discordUserId: member.id, inviteCode: code });
  } catch { /* listeners must not break the flow */ }

  await ctx.post('outreachLog', {
    embeds: [
      embed({
        title: '✅ Beitritt über persönlichen Link',
        description: `**${creator.display_name}** ist beigetreten: <@${member.id}> (${tag || '–'})\nStatus → **Im Discord**. Nächster Schritt: Bewerbung in ${channelMention(ctx, 'apply', '#creator-bewerbung')}.`,
        color: COLORS.success,
        footer: `Creator-ID ${creator.id} · Einladung ${code}`,
        timestamp: true,
      }),
    ],
    allowedMentions: { parse: [] },
  });

  if (ctx.settings().discord.welcomeDm !== false) {
    await tryDm(member, { content: tr(T, creator.language === 'de' ? 'de' : 'en', 'welcome', { apply: channelMention(ctx, 'apply', '#creator-bewerbung') }) });
  }
  return { creatorId: creator.id, code };
}

export default {
  name: 'invites',
  commands: [],
  commandHandlers: {},
  buttons: {},
  selects: {},
  modals: {},
  events: {
    [Events.InviteCreate]: async (ctx, invite) => {
      if (!ctx.isOurGuild(invite.guild?.id)) return;
      state.uses.set(invite.code, invite.uses ?? 0);
    },
    [Events.InviteDelete]: async (ctx, invite) => {
      if (!ctx.isOurGuild(invite.guild?.id)) return;
      if (state.uses.has(invite.code)) {
        state.recentlyDeleted.set(invite.code, Date.now());
        state.uses.delete(invite.code);
      }
    },
    [Events.GuildMemberAdd]: (ctx, member) => handleMemberJoin(ctx, member),
  },
  jobs: [],
  async onReady(ctx) {
    ctx.provide('createPersonalInvite', (creatorId) => createPersonalInvite(ctx, creatorId));
    try {
      await refreshCache(ctx);
      ctx.log.info(`${state.uses.size} Einladungen geladen (Beitritte über persönliche Links werden erkannt).`);
    } catch (err) {
      ctx.log.warn('Einladungen konnten nicht geladen werden – dem Bot fehlt vermutlich das Recht „Server verwalten“:', err.message);
    }
  },
};
