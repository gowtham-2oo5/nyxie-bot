import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import {
  ensureOnLeaderboard, displaceRank, isOnLeaderboard,
  getBottomPlayer, getLeaderboardCount, getLeaderboardSize,
} from "../lib/rank-ops";
import { db } from "../db";
import { leaderboard } from "../db/schema";
import { eq, asc } from "drizzle-orm";
import { cleanup, seedLeaderboard, seedGuildConfig, TEST_GUILD, USERS } from "./helpers";

const getRanks = async () =>
  db.select().from(leaderboard)
    .where(eq(leaderboard.guildId, TEST_GUILD))
    .orderBy(asc(leaderboard.rankPosition));

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe("ensureOnLeaderboard", () => {
  test("new player gets max+1 rank", async () => {
    await seedLeaderboard(3);
    const entry = await ensureOnLeaderboard(TEST_GUILD, USERS.p5, "p5");
    expect(entry.rankPosition).toBe(4);
  });

  test("existing player returns unchanged", async () => {
    await seedLeaderboard(3);
    const first = await ensureOnLeaderboard(TEST_GUILD, USERS.p1, "p1");
    const second = await ensureOnLeaderboard(TEST_GUILD, USERS.p1, "p1");
    expect(first.rankPosition).toBe(second.rankPosition);
  });
});

describe("standard displacement", () => {
  test("#5 beats #3 → takes #3, others shift down", async () => {
    await seedLeaderboard(5);
    await seedGuildConfig(8);

    await displaceRank(TEST_GUILD, USERS.p5, "p5", USERS.p3, "p3");

    const ranks = await getRanks();
    const p5 = ranks.find((r) => r.userId === USERS.p5);
    const p3 = ranks.find((r) => r.userId === USERS.p3);
    const p4 = ranks.find((r) => r.userId === USERS.p4);

    expect(p5?.rankPosition).toBe(3);
    expect(p3?.rankPosition).toBe(4);
    expect(p4?.rankPosition).toBe(5);
  });

  test("no displacement if winner already higher ranked", async () => {
    await seedLeaderboard(5);
    await seedGuildConfig(8);

    await displaceRank(TEST_GUILD, USERS.p2, "p2", USERS.p5, "p5");

    const p2 = await isOnLeaderboard(TEST_GUILD, USERS.p2);
    expect(p2?.rankPosition).toBe(2);
  });

  test("adjacent displacement — #2 beats #1", async () => {
    await seedLeaderboard(3);
    await seedGuildConfig(8);

    await displaceRank(TEST_GUILD, USERS.p2, "p2", USERS.p1, "p1");

    const ranks = await getRanks();
    const p2 = ranks.find((r) => r.userId === USERS.p2);
    const p1 = ranks.find((r) => r.userId === USERS.p1);

    expect(p2?.rankPosition).toBe(1);
    expect(p1?.rankPosition).toBe(2);
  });
});

describe("unranked challenger", () => {
  test("unranked beats bottom → enters board, old bottom removed", async () => {
    await seedLeaderboard(8);
    await seedGuildConfig(8);

    await displaceRank(TEST_GUILD, USERS.unranked, "unranked", USERS.p8, "p8");

    const unranked = await isOnLeaderboard(TEST_GUILD, USERS.unranked);
    const p8 = await isOnLeaderboard(TEST_GUILD, USERS.p8);

    expect(unranked).not.toBeNull();
    expect(unranked?.rankPosition).toBe(8);
    expect(p8).toBeNull(); // kicked off
  });

  test("leaderboard size stays at max after unranked entry", async () => {
    await seedLeaderboard(8);
    await seedGuildConfig(8);

    await displaceRank(TEST_GUILD, USERS.unranked, "unranked", USERS.p8, "p8");

    const count = await getLeaderboardCount(TEST_GUILD);
    expect(count).toBe(8);
  });
});

describe("leaderboard size enforcement", () => {
  test("default size is 8", async () => {
    const size = await getLeaderboardSize(TEST_GUILD);
    expect(size).toBe(8);
  });

  test("custom size respected", async () => {
    await seedGuildConfig(10);
    const size = await getLeaderboardSize(TEST_GUILD);
    expect(size).toBe(10);
  });

  test("displacement pushing past size removes overflow", async () => {
    await seedLeaderboard(8);
    await seedGuildConfig(8);

    // p8 is rank 8 (bottom). Unranked player beats p8 → p8 gets pushed to 9 → removed
    await displaceRank(TEST_GUILD, USERS.unranked, "unranked", USERS.p8, "p8");

    const p8 = await isOnLeaderboard(TEST_GUILD, USERS.p8);
    const count = await getLeaderboardCount(TEST_GUILD);

    expect(p8).toBeNull();
    expect(count).toBe(8);
  });
});
