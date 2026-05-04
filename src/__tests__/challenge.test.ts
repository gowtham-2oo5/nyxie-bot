import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { isOnLeaderboard, getBottomPlayer } from "../lib/rank-ops";
import { cleanup, seedLeaderboard, seedGuildConfig, TEST_GUILD, USERS } from "./helpers";

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe("challenge validation logic", () => {
  test("ranked vs ranked within 3 ranks — allowed", async () => {
    await seedLeaderboard(8);
    await seedGuildConfig(8);

    const challenger = await isOnLeaderboard(TEST_GUILD, USERS.p5); // rank 5
    const target = await isOnLeaderboard(TEST_GUILD, USERS.p3); // rank 3

    expect(challenger).not.toBeNull();
    expect(target).not.toBeNull();

    const diff = challenger!.rankPosition - target!.rankPosition;
    expect(diff).toBeLessThanOrEqual(3);
    expect(target!.rankPosition).toBeLessThan(challenger!.rankPosition);
  });

  test("ranked vs ranked too far — rejected", async () => {
    await seedLeaderboard(8);
    await seedGuildConfig(8);

    const challenger = await isOnLeaderboard(TEST_GUILD, USERS.p8); // rank 8
    const target = await isOnLeaderboard(TEST_GUILD, USERS.p1); // rank 1

    const diff = challenger!.rankPosition - target!.rankPosition;
    expect(diff).toBeGreaterThan(3); // 7 ranks apart
  });

  test("unranked vs bottom player — allowed", async () => {
    await seedLeaderboard(8);
    await seedGuildConfig(8);

    const unranked = await isOnLeaderboard(TEST_GUILD, USERS.unranked);
    expect(unranked).toBeNull(); // not on board

    const bottom = await getBottomPlayer(TEST_GUILD);
    expect(bottom).not.toBeNull();
    expect(bottom!.userId).toBe(USERS.p8); // p8 is rank 8
  });

  test("unranked vs non-bottom player — rejected", async () => {
    await seedLeaderboard(8);
    await seedGuildConfig(8);

    const unranked = await isOnLeaderboard(TEST_GUILD, USERS.unranked);
    expect(unranked).toBeNull();

    const bottom = await getBottomPlayer(TEST_GUILD);
    const target = await isOnLeaderboard(TEST_GUILD, USERS.p3); // rank 3

    // Target is not the bottom player
    expect(target!.userId).not.toBe(bottom!.userId);
  });
});
