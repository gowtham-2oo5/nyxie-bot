import { type ServerWebSocket } from "bun";
import { type Client, type GuildMember, Events } from "discord.js";
import { db } from "../db";
import { leaderboard, rankRoles } from "../db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getLeaderboardSize } from "./rank-ops";

let _client: Client | null = null;

// Track which WS clients are subscribed to which guild+roles
const subscriptions = new Map<ServerWebSocket<unknown>, { guildId: string; roleIds: string[] }>();

export const setWsClient = (client: Client) => {
  _client = client;

  // Listen for presence updates and push to subscribers
  client.on(Events.PresenceUpdate, (oldPresence, newPresence) => {
    if (!newPresence?.member) return;

    const member = newPresence.member;
    const guildId = member.guild.id;

    // Push stats update
    if (statsSubscriptions.size > 0) pushStatsUpdate(guildId);

    // Push presence update to role subscribers
    if (subscriptions.size === 0) return;

    for (const [ws, sub] of subscriptions) {
      if (sub.guildId !== guildId) continue;

      const matchingRoles = sub.roleIds.filter((roleId) => member.roles.cache.has(roleId));
      if (!matchingRoles.length) continue;

      const userData = formatMember(member, guildId);

      try {
        ws.send(JSON.stringify({
          type: "presence_update",
          userId: member.user.id,
          roles: matchingRoles,
          data: userData,
        }));
      } catch {
        subscriptions.delete(ws);
      }
    }
  });

  // Also push stats on member join/leave
  client.on(Events.GuildMemberAdd, (member) => {
    if (statsSubscriptions.size > 0) pushStatsUpdate(member.guild.id);
  });
  client.on(Events.GuildMemberRemove, (member) => {
    if (statsSubscriptions.size > 0) pushStatsUpdate(member.guild.id);
  });
};

const formatMember = (m: GuildMember, guildId: string) => ({
  userId: m.user.id,
  username: m.user.username,
  displayName: m.displayName,
  avatar: m.user.displayAvatarURL({ size: 128 }),
  status: m.presence?.status ?? "offline",
  customStatus: m.presence?.activities.find((a) => a.type === 4)?.state ?? null,
  activities: m.presence?.activities
    .filter((a) => a.type !== 4)
    .map((a) => ({ type: a.type, name: a.name, details: a.details, state: a.state })) ?? [],
  joinedAt: m.joinedAt,
  roles: m.roles.cache
    .filter((r) => r.id !== guildId)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor })),
});

type WsMessage =
  | { type: "members_by_roles"; guildId: string; roleIds: string[] }
  | { type: "leaderboard"; guildId: string; region?: string }
  | { type: "subscribe"; guildId: string; roleIds: string[] }
  | { type: "unsubscribe" }
  | { type: "stats"; guildId: string };

const getMembersByRole = (guildId: string, roleId: string) => {
  const guild = _client?.guilds.cache.get(guildId);
  if (!guild) return { roleId, error: "Guild not found", members: [] };

  const members = guild.members.cache;

  const filtered = members
    .filter((m) => !m.user.bot && m.roles.cache.has(roleId))
    .map((m) => formatMember(m, guildId));

  return { roleId, members: [...filtered.values()] };
};

export const handleWsMessage = async (ws: ServerWebSocket<unknown>, raw: string) => {
  let msg: WsMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    return;
  }

  if (msg.type === "members_by_roles") {
    if (!msg.guildId || !Array.isArray(msg.roleIds) || !msg.roleIds.length) {
      ws.send(JSON.stringify({ type: "error", message: "Missing guildId or roleIds" }));
      return;
    }

    const results = msg.roleIds.map((roleId) => getMembersByRole(msg.guildId, roleId));
    const data: Record<string, any> = {};
    for (const r of results) data[r.roleId] = r.error ? { error: r.error } : r.members;

    ws.send(JSON.stringify({ type: "members_by_roles", data }));
    return;
  }

  if (msg.type === "subscribe") {
    if (!msg.guildId || !Array.isArray(msg.roleIds) || !msg.roleIds.length) {
      ws.send(JSON.stringify({ type: "error", message: "Missing guildId or roleIds" }));
      return;
    }
    subscriptions.set(ws, { guildId: msg.guildId, roleIds: msg.roleIds });

    // Send initial data immediately
    const results = msg.roleIds.map((roleId) => getMembersByRole(msg.guildId, roleId));
    const data: Record<string, any> = {};
    for (const r of results) data[r.roleId] = r.error ? { error: r.error } : r.members;

    ws.send(JSON.stringify({ type: "members_by_roles", data }));
    ws.send(JSON.stringify({ type: "subscribed", guildId: msg.guildId, roleIds: msg.roleIds }));
    return;
  }

  if (msg.type === "unsubscribe") {
    subscriptions.delete(ws);
    ws.send(JSON.stringify({ type: "unsubscribed" }));
    return;
  }

  if (msg.type === "leaderboard") {
    if (!msg.guildId) {
      ws.send(JSON.stringify({ type: "error", message: "Missing guildId" }));
      return;
    }
    const region = msg.region ?? "default";
    const guildId = msg.guildId;
    const guild = _client?.guilds.cache.get(guildId);

    const lbSize = await getLeaderboardSize(guildId);
    const entries = await db.select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region)))
      .orderBy(asc(leaderboard.rankPosition));
    const roles = await db.select().from(rankRoles)
      .where(and(eq(rankRoles.guildId, guildId), eq(rankRoles.region, region)));

    const data = [];
    for (let pos = 1; pos <= lbSize; pos++) {
      const entry = entries.find((e) => e.rankPosition === pos);
      const role = roles.find((r) => r.position === pos);

      let user = null;
      if (entry && guild) {
        const member = guild.members.cache.get(entry.userId);
        if (member) user = formatMember(member, guildId);
        else user = { userId: entry.userId, username: entry.username };
      }

      data.push({
        position: pos,
        label: role?.label ?? null,
        roleId: role?.roleId || null,
        user,
      });
    }

    ws.send(JSON.stringify({ type: "leaderboard", region, data }));
    // Subscribe for live leaderboard updates
    leaderboardSubscriptions.set(ws, { guildId, region });
    return;
  }

  if (msg.type === "stats") {
    if (!msg.guildId) {
      ws.send(JSON.stringify({ type: "error", message: "Missing guildId" }));
      return;
    }
    const stats = getGuildStats(msg.guildId);
    ws.send(JSON.stringify({ type: "stats", ...stats }));
    // Subscribe for live stats updates
    statsSubscriptions.set(ws, msg.guildId);
    return;
  }

  ws.send(JSON.stringify({ type: "error", message: `Unknown type: ${(msg as any).type}` }));
};

// ─── Stats subscriptions ───

const statsSubscriptions = new Map<ServerWebSocket<unknown>, string>();

const getGuildStats = (guildId: string) => {
  const guild = _client?.guilds.cache.get(guildId);
  if (!guild) return { error: "Guild not found" };

  const total = guild.memberCount;
  const online = guild.presences.cache.filter((p) => p.status !== "offline").size;
  const idle = guild.presences.cache.filter((p) => p.status === "idle").size;
  const dnd = guild.presences.cache.filter((p) => p.status === "dnd").size;
  const offline = total - online - idle - dnd;

  return { guildId, total, online, idle, dnd, offline };
};

const pushStatsUpdate = (guildId: string) => {
  const stats = getGuildStats(guildId);
  for (const [ws, subGuildId] of statsSubscriptions) {
    if (subGuildId !== guildId) continue;
    try {
      ws.send(JSON.stringify({ type: "stats_update", ...stats }));
    } catch {
      statsSubscriptions.delete(ws);
    }
  }
};

export const handleWsClose = (ws: ServerWebSocket<unknown>) => {
  subscriptions.delete(ws);
  statsSubscriptions.delete(ws);
  leaderboardSubscriptions.delete(ws);
};

// ─── Leaderboard subscriptions ───

const leaderboardSubscriptions = new Map<ServerWebSocket<unknown>, { guildId: string; region: string }>();

export const pushLeaderboardUpdate = async (guildId: string) => {
  if (leaderboardSubscriptions.size === 0) return;

  for (const [ws, sub] of leaderboardSubscriptions) {
    if (sub.guildId !== guildId) continue;

    try {
      const region = sub.region;
      const lbSize = await getLeaderboardSize(guildId);
      const entries = await db.select().from(leaderboard)
        .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region)))
        .orderBy(asc(leaderboard.rankPosition));
      const roles = await db.select().from(rankRoles)
        .where(and(eq(rankRoles.guildId, guildId), eq(rankRoles.region, region)));

      const guild = _client?.guilds.cache.get(guildId);
      const data = [];
      for (let pos = 1; pos <= lbSize; pos++) {
        const entry = entries.find((e) => e.rankPosition === pos);
        const role = roles.find((r) => r.position === pos);
        let user = null;
        if (entry && guild) {
          const member = guild.members.cache.get(entry.userId);
          if (member) user = formatMember(member, guildId);
          else user = { userId: entry.userId, username: entry.username };
        }
        data.push({ position: pos, label: role?.label ?? null, roleId: role?.roleId || null, user });
      }

      ws.send(JSON.stringify({ type: "leaderboard_update", region, data }));
    } catch {
      leaderboardSubscriptions.delete(ws);
    }
  }
};
