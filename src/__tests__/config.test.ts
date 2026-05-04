import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { db } from "../db";
import { guildConfig, rankRoles, leaderboard } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { cleanup, seedLeaderboard, seedGuildConfig, TEST_GUILD, USERS } from "./helpers";

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe("leaderboard size config", () => {
  test("default size is 8 when no config", async () => {
    // No guild config inserted
    const cfg = await db
      .select()
      .from(guildConfig)
      .where(eq(guildConfig.guildId, TEST_GUILD))
      .then((r) => r[0]);

    expect(cfg).toBeUndefined();
    // getLeaderboardSize returns 8 as default
  });

  test("admin can set custom size", async () => {
    await db.insert(guildConfig).values({ guildId: TEST_GUILD, leaderboardSize: 12 });

    const cfg = await db
      .select()
      .from(guildConfig)
      .where(eq(guildConfig.guildId, TEST_GUILD))
      .then((r) => r[0]);

    expect(cfg?.leaderboardSize).toBe(12);
  });

  test("admin can update size", async () => {
    await db.insert(guildConfig).values({ guildId: TEST_GUILD, leaderboardSize: 8 });

    await db
      .update(guildConfig)
      .set({ leaderboardSize: 16 })
      .where(eq(guildConfig.guildId, TEST_GUILD));

    const cfg = await db
      .select()
      .from(guildConfig)
      .where(eq(guildConfig.guildId, TEST_GUILD))
      .then((r) => r[0]);

    expect(cfg?.leaderboardSize).toBe(16);
  });
});

describe("rank roles config", () => {
  test("add rank role for position", async () => {
    await db.insert(rankRoles).values({
      guildId: TEST_GUILD,
      roleId: "900000000000000001",
      label: "#1",
      minRank: 1,
      maxRank: 1,
    });

    const roles = await db
      .select()
      .from(rankRoles)
      .where(eq(rankRoles.guildId, TEST_GUILD));

    expect(roles).toHaveLength(1);
    expect(roles[0].label).toBe("#1");
    expect(roles[0].minRank).toBe(1);
    expect(roles[0].maxRank).toBe(1);
  });

  test("multiple rank roles for different positions", async () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      guildId: TEST_GUILD,
      roleId: `90000000000000000${i + 1}`,
      label: `#${i + 1}`,
      minRank: i + 1,
      maxRank: i + 1,
    }));

    await db.insert(rankRoles).values(entries);

    const roles = await db
      .select()
      .from(rankRoles)
      .where(eq(rankRoles.guildId, TEST_GUILD));

    expect(roles).toHaveLength(8);
  });

  test("rank role matches correct player position", async () => {
    await seedLeaderboard(8);

    await db.insert(rankRoles).values([
      { guildId: TEST_GUILD, roleId: "900000000000000001", label: "Champion", minRank: 1, maxRank: 1 },
      { guildId: TEST_GUILD, roleId: "900000000000000002", label: "Elite", minRank: 2, maxRank: 5 },
      { guildId: TEST_GUILD, roleId: "900000000000000003", label: "Veteran", minRank: 6, maxRank: 8 },
    ]);

    const roles = await db.select().from(rankRoles).where(eq(rankRoles.guildId, TEST_GUILD));
    const p1 = await db.select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, TEST_GUILD), eq(leaderboard.userId, USERS.p1)))
      .then((r) => r[0]);
    const p3 = await db.select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, TEST_GUILD), eq(leaderboard.userId, USERS.p3)))
      .then((r) => r[0]);
    const p7 = await db.select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, TEST_GUILD), eq(leaderboard.userId, USERS.p7)))
      .then((r) => r[0]);

    // p1 rank 1 → Champion
    const p1Role = roles.find((r) => p1!.rankPosition >= r.minRank && p1!.rankPosition <= r.maxRank);
    expect(p1Role?.label).toBe("Champion");

    // p3 rank 3 → Elite
    const p3Role = roles.find((r) => p3!.rankPosition >= r.minRank && p3!.rankPosition <= r.maxRank);
    expect(p3Role?.label).toBe("Elite");

    // p7 rank 7 → Veteran
    const p7Role = roles.find((r) => p7!.rankPosition >= r.minRank && p7!.rankPosition <= r.maxRank);
    expect(p7Role?.label).toBe("Veteran");
  });

  test("remove rank role", async () => {
    await db.insert(rankRoles).values({
      guildId: TEST_GUILD,
      roleId: "900000000000000001",
      label: "#1",
      minRank: 1,
      maxRank: 1,
    });

    await db.delete(rankRoles).where(
      and(eq(rankRoles.guildId, TEST_GUILD), eq(rankRoles.roleId, "900000000000000001"))
    );

    const roles = await db.select().from(rankRoles).where(eq(rankRoles.guildId, TEST_GUILD));
    expect(roles).toHaveLength(0);
  });
});
