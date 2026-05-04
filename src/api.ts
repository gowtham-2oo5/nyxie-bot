import { Hono } from "hono";
import { cors } from "hono/cors";
import { db } from "./db";
import {
  leaderboard, rankRoles, tournaments, participants, matches,
  matchLog, challenges, guildConfig,
} from "./db/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";

const api = new Hono().basePath("/api");

api.use("*", cors());

// ─── Leaderboard ───

api.get("/guilds/:guildId/leaderboard", async (c) => {
  const guildId = c.req.param("guildId");
  const page = parseInt(c.req.query("page") ?? "1");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "25"), 100);
  const offset = (page - 1) * limit;

  const entries = await db
    .select()
    .from(leaderboard)
    .where(eq(leaderboard.guildId, guildId))
    .orderBy(asc(leaderboard.rankPosition))
    .limit(limit)
    .offset(offset);

  const total = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(leaderboard)
    .where(eq(leaderboard.guildId, guildId))
    .then((r) => r[0].count);

  const roles = await db.select().from(rankRoles).where(eq(rankRoles.guildId, guildId));

  const data = entries.map((e) => {
    const role = roles.find((r) => e.rankPosition === r.position);
    return {
      userId: e.userId,
      username: e.username,
      rankPosition: e.rankPosition,
      totalWins: e.totalWins,
      totalLosses: e.totalLosses,
      tournamentsWon: e.tournamentsWon,
      tournamentsPlayed: e.tournamentsPlayed,
      rankRole: role ? { label: role.label, roleId: role.roleId } : null,
    };
  });

  return c.json({ data, page, limit, total });
});

// ─── Player Profile ───

api.get("/guilds/:guildId/players/:userId", async (c) => {
  const { guildId, userId } = c.req.param();

  const entry = await db
    .select()
    .from(leaderboard)
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId)))
    .then((r) => r[0] ?? null);

  if (!entry) return c.json({ error: "Player not found" }, 404);

  const roles = await db.select().from(rankRoles).where(eq(rankRoles.guildId, guildId));
  const role = roles.find((r) => entry.rankPosition === r.position);

  // Recent matches
  const recentMatches = await db
    .select()
    .from(matchLog)
    .where(
      and(
        eq(matchLog.guildId, guildId),
        sql`(${matchLog.winnerId} = ${userId} OR ${matchLog.loserId} = ${userId} OR ${matchLog.forfeitBy} = ${userId})`
      )
    )
    .orderBy(desc(matchLog.createdAt))
    .limit(10);

  return c.json({
    userId: entry.userId,
    username: entry.username,
    rankPosition: entry.rankPosition,
    totalWins: entry.totalWins,
    totalLosses: entry.totalLosses,
    tournamentsWon: entry.tournamentsWon,
    tournamentsPlayed: entry.tournamentsPlayed,
    rankRole: role ? { label: role.label, roleId: role.roleId } : null,
    recentMatches: recentMatches.map((m) => ({
      matchType: m.matchType,
      resultType: m.resultType,
      winnerId: m.winnerId,
      winnerUsername: m.winnerUsername,
      loserId: m.loserId,
      loserUsername: m.loserUsername,
      forfeitBy: m.forfeitBy,
      forfeitReason: m.forfeitReason,
      context: m.contextName,
      detail: m.contextDetail,
      createdAt: m.createdAt,
    })),
  });
});

// ─── Rank Roles ───

api.get("/guilds/:guildId/roles", async (c) => {
  const guildId = c.req.param("guildId");

  const roles = await db
    .select()
    .from(rankRoles)
    .where(eq(rankRoles.guildId, guildId));

  return c.json({
    data: roles.map((r) => ({
      roleId: r.roleId,
      label: r.label,
      position: r.position,
    })),
  });
});

// ─── Tournaments ───

api.get("/guilds/:guildId/tournaments", async (c) => {
  const guildId = c.req.param("guildId");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10"), 50);

  const data = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.guildId, guildId))
    .orderBy(desc(tournaments.createdAt))
    .limit(limit);

  return c.json({
    data: data.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      currentRound: t.currentRound,
      totalRounds: t.totalRounds,
      createdBy: t.createdBy,
      createdAt: t.createdAt,
    })),
  });
});

// ─── Tournament Detail ───

api.get("/guilds/:guildId/tournaments/:id", async (c) => {
  const { guildId, id } = c.req.param();

  const t = await db
    .select()
    .from(tournaments)
    .where(and(eq(tournaments.id, parseInt(id)), eq(tournaments.guildId, guildId)))
    .then((r) => r[0] ?? null);

  if (!t) return c.json({ error: "Tournament not found" }, 404);

  const [players, allMatches] = await Promise.all([
    db.select().from(participants).where(eq(participants.tournamentId, t.id)),
    db.select().from(matches).where(eq(matches.tournamentId, t.id)),
  ]);

  return c.json({
    id: t.id,
    name: t.name,
    status: t.status,
    currentRound: t.currentRound,
    totalRounds: t.totalRounds,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    participants: players.map((p) => ({
      id: p.id,
      userId: p.userId,
      username: p.username,
      wins: p.wins,
      losses: p.losses,
      isEliminated: p.isEliminated,
    })),
    matches: allMatches.map((m) => ({
      id: m.id,
      round: m.round,
      matchNumber: m.matchNumber,
      player1Id: m.player1Id,
      player2Id: m.player2Id,
      winnerId: m.winnerId,
      status: m.status,
      forfeitBy: m.forfeitBy,
      forfeitReason: m.forfeitReason,
    })),
  });
});

// ─── Server Stats ───

api.get("/guilds/:guildId/stats", async (c) => {
  const guildId = c.req.param("guildId");

  const [tournamentStats, matchCount, lbSize, challengeCount] = await Promise.all([
    db.select({
      total: sql<number>`COUNT(*)`,
      active: sql<number>`SUM(CASE WHEN status IN ('pending','active') THEN 1 ELSE 0 END)`,
    }).from(tournaments).where(eq(tournaments.guildId, guildId)).then((r) => r[0]),
    db.select({ c: sql<number>`COUNT(*)` }).from(matchLog).where(eq(matchLog.guildId, guildId)).then((r) => r[0].c),
    db.select({ c: sql<number>`COUNT(*)` }).from(leaderboard).where(eq(leaderboard.guildId, guildId)).then((r) => r[0].c),
    db.select({ c: sql<number>`COUNT(*)` }).from(challenges).where(eq(challenges.guildId, guildId)).then((r) => r[0].c),
  ]);

  return c.json({
    totalTournaments: tournamentStats.total,
    activeTournaments: tournamentStats.active ?? 0,
    totalMatches: matchCount,
    rankedPlayers: lbSize,
    totalChallenges: challengeCount,
  });
});

// ─── Member Discord Profile ───

api.get("/guilds/:guildId/members/:userId", async (c) => {
  const { guildId, userId } = c.req.param();

  const guild = getClient()?.guilds.cache.get(guildId);
  if (!guild) return c.json({ error: "Guild not found" }, 404);

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return c.json({ error: "Member not found" }, 404);

  const presence = member.presence;

  // Leaderboard data
  const entry = await db
    .select()
    .from(leaderboard)
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId)))
    .then((r) => r[0] ?? null);

  const roles = member.roles.cache
    .filter((r) => r.id !== guildId)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.hexColor,
      position: r.position,
    }));

  return c.json({
    userId: member.user.id,
    username: member.user.username,
    displayName: member.displayName,
    avatar: member.user.displayAvatarURL({ size: 256 }),
    banner: member.user.bannerURL({ size: 512 }) ?? null,
    joinedAt: member.joinedAt,
    createdAt: member.user.createdAt,
    status: presence?.status ?? "offline",
    customStatus: presence?.activities.find((a) => a.type === 4)?.state ?? null,
    activities: presence?.activities
      .filter((a) => a.type !== 4)
      .map((a) => ({
        type: a.type,
        name: a.name,
        details: a.details,
        state: a.state,
      })) ?? [],
    roles,
    rank: entry ? {
      position: entry.rankPosition,
      totalWins: entry.totalWins,
      totalLosses: entry.totalLosses,
      tournamentsWon: entry.tournamentsWon,
      tournamentsPlayed: entry.tournamentsPlayed,
    } : null,
  });
});

// ─── All Server Members ───

api.get("/guilds/:guildId/members", async (c) => {
  const guildId = c.req.param("guildId");

  const guild = getClient()?.guilds.cache.get(guildId);
  if (!guild) return c.json({ error: "Guild not found" }, 404);

  const members = await guild.members.fetch();

  const data = members
    .filter((m) => !m.user.bot)
    .map((m) => ({
      userId: m.user.id,
      username: m.user.username,
      displayName: m.displayName,
      avatar: m.user.displayAvatarURL({ size: 128 }),
      status: m.presence?.status ?? "offline",
      joinedAt: m.joinedAt,
      roles: m.roles.cache
        .filter((r) => r.id !== guildId)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor })),
    }));

  return c.json({ data, total: data.length });
});

import { type Client } from "discord.js";

let _client: Client;

export const setClient = (client: Client) => { _client = client; };
export const getClient = () => _client;

export { api };
