import { db } from "../db";
import { pool } from "../db";
import { leaderboard, guildConfig } from "../db/schema";
import { eq, and, between, sql, gt, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";

export const getLeaderboardSize = async (guildId: string): Promise<number> => {
  const cfg = await db
    .select({ leaderboardSize: guildConfig.leaderboardSize })
    .from(guildConfig)
    .where(eq(guildConfig.guildId, guildId))
    .then((r) => r[0]);
  return cfg?.leaderboardSize ?? 8;
};

export const getLeaderboardCount = async (guildId: string, region = "default"): Promise<number> =>
  db
    .select({ c: sql<number>`COUNT(*)` })
    .from(leaderboard)
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region)))
    .then((r) => r[0].c);

export const getBottomPlayer = async (guildId: string, region = "default") =>
  db
    .select()
    .from(leaderboard)
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region)))
    .orderBy(sql`${leaderboard.rankPosition} DESC`)
    .limit(1)
    .then((r) => r[0] ?? null);

export const isOnLeaderboard = async (guildId: string, userId: string, region = "default") =>
  db
    .select()
    .from(leaderboard)
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId), eq(leaderboard.region, region)))
    .then((r) => r[0] ?? null);

export const getPlayerAtRank = async (guildId: string, rank: number, region = "default") =>
  db
    .select()
    .from(leaderboard)
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.rankPosition, rank), eq(leaderboard.region, region)))
    .then((r) => r[0] ?? null);

// ─── Transactional helper ───

const withTx = async <T>(fn: (txDb: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const txDb = drizzle(conn, { schema, mode: "default" });
    const result = await fn(txDb);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ─── Core operations ───

export const ensureOnLeaderboard = async (
  guildId: string,
  userId: string,
  username: string,
  region = "default"
) =>
  withTx(async (txDb) => {
    const existing = await txDb
      .select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId), eq(leaderboard.region, region)))
      .then((r) => r[0]);
    if (existing) return existing;

    const max = await txDb
      .select({ m: sql<number>`COALESCE(MAX(${leaderboard.rankPosition}), 0)` })
      .from(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region)))
      .then((r) => r[0].m);

    await txDb.insert(leaderboard).values({ guildId, userId, username, region, rankPosition: max + 1 });

    return txDb
      .select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId), eq(leaderboard.region, region)))
      .then((r) => r[0]!);
  });

export const displaceRank = async (
  guildId: string,
  winnerId: string,
  winnerUsername: string,
  loserId: string,
  loserUsername: string,
  region = "default"
) =>
  withTx(async (txDb) => {
    const winner = await txDb.select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, winnerId), eq(leaderboard.region, region)))
      .then((r) => r[0] ?? null);
    const loser = await txDb.select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, loserId), eq(leaderboard.region, region)))
      .then((r) => r[0] ?? null);

    if (!loser) return;

    const lbSize = await getLeaderboardSize(guildId);
    const loserRank = loser.rankPosition;

    if (winner) {
      if (winner.rankPosition <= loser.rankPosition) return;
      const winnerOldRank = winner.rankPosition;

      await txDb.update(leaderboard)
        .set({ rankPosition: sql`${leaderboard.rankPosition} + 1`, updatedAt: new Date() })
        .where(and(
          eq(leaderboard.guildId, guildId), eq(leaderboard.region, region),
          between(leaderboard.rankPosition, loserRank, winnerOldRank - 1)
        ));

      await txDb.update(leaderboard)
        .set({ rankPosition: loserRank, updatedAt: new Date() })
        .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, winnerId), eq(leaderboard.region, region)));
    } else {
      await txDb.update(leaderboard)
        .set({ rankPosition: sql`${leaderboard.rankPosition} + 1`, updatedAt: new Date() })
        .where(and(
          eq(leaderboard.guildId, guildId), eq(leaderboard.region, region),
          gte(leaderboard.rankPosition, loserRank)
        ));

      await txDb.insert(leaderboard).values({
        guildId, userId: winnerId, username: winnerUsername, region, rankPosition: loserRank,
      });
    }

    await txDb.delete(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region), gt(leaderboard.rankPosition, lbSize)));
  });

export const setRankPositionWithDisplacement = async (
  guildId: string,
  userId: string,
  newRank: number,
  region = "default"
) => {
  if (newRank < 1 || !Number.isInteger(newRank)) return;
  return withTx(async (txDb) => {
    const current = await txDb.select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId), eq(leaderboard.region, region)))
      .then((r) => r[0]);
    if (!current || current.rankPosition === newRank) return;

    const oldRank = current.rankPosition;

    if (newRank < oldRank) {
      await txDb.update(leaderboard)
        .set({ rankPosition: sql`${leaderboard.rankPosition} + 1`, updatedAt: new Date() })
        .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region), between(leaderboard.rankPosition, newRank, oldRank - 1)));
    } else {
      await txDb.update(leaderboard)
        .set({ rankPosition: sql`${leaderboard.rankPosition} - 1`, updatedAt: new Date() })
        .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region), between(leaderboard.rankPosition, oldRank + 1, newRank)));
    }

    await txDb.update(leaderboard)
      .set({ rankPosition: newRank, updatedAt: new Date() })
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId), eq(leaderboard.region, region)));

    const lbSize = await getLeaderboardSize(guildId);
    await txDb.delete(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region), gt(leaderboard.rankPosition, lbSize)));
  });
};

export const swapRankPositions = async (
  guildId: string,
  userId: string,
  targetUserId: string,
  region = "default"
) =>
  withTx(async (txDb) => {
    const player = await txDb.select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId), eq(leaderboard.region, region)))
      .then((r) => r[0]);
    const target = await txDb.select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, targetUserId), eq(leaderboard.region, region)))
      .then((r) => r[0]);
    if (!player || !target) return;

    await txDb.update(leaderboard)
      .set({ rankPosition: target.rankPosition, updatedAt: new Date() })
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId), eq(leaderboard.region, region)));
    await txDb.update(leaderboard)
      .set({ rankPosition: player.rankPosition, updatedAt: new Date() })
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, targetUserId), eq(leaderboard.region, region)));
  });

export const removeFromLeaderboard = async (guildId: string, userId: string, region = "default") =>
  withTx(async (txDb) => {
    const entry = await txDb.select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId), eq(leaderboard.region, region)))
      .then((r) => r[0]);
    if (!entry) return;

    await txDb.delete(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId), eq(leaderboard.region, region)));

    await txDb.update(leaderboard)
      .set({ rankPosition: sql`${leaderboard.rankPosition} - 1`, updatedAt: new Date() })
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region), gt(leaderboard.rankPosition, entry.rankPosition)));
  });

export const addTournamentStat = async (
  guildId: string,
  userId: string,
  username: string,
  won: boolean,
  played: boolean,
  region = "default"
) => {
  const entry = await isOnLeaderboard(guildId, userId, region);
  if (!entry) return;

  await db
    .update(leaderboard)
    .set({
      tournamentsWon: won ? sql`${leaderboard.tournamentsWon} + 1` : leaderboard.tournamentsWon,
      tournamentsPlayed: played ? sql`${leaderboard.tournamentsPlayed} + 1` : leaderboard.tournamentsPlayed,
      updatedAt: new Date(),
    })
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId), eq(leaderboard.region, region)));
};

// Legacy alias
export const setRankPosition = setRankPositionWithDisplacement;
