import { db } from "../db";
import { leaderboard, guildConfig, forfeitCooldowns, tournaments, participants, matches, rankRoles } from "../db/schema";
import { eq } from "drizzle-orm";

// Dummy IDs
export const TEST_GUILD = "999000000000000001";
export const USERS = {
  p1: "100000000000000001",
  p2: "100000000000000002",
  p3: "100000000000000003",
  p4: "100000000000000004",
  p5: "100000000000000005",
  p6: "100000000000000006",
  p7: "100000000000000007",
  p8: "100000000000000008",
  unranked: "100000000000000099",
};

export const cleanup = async () => {
  const testTournaments = await db.select().from(tournaments).where(eq(tournaments.guildId, TEST_GUILD));
  for (const t of testTournaments) {
    await db.delete(matches).where(eq(matches.tournamentId, t.id));
    await db.delete(participants).where(eq(participants.tournamentId, t.id));
  }
  await db.delete(tournaments).where(eq(tournaments.guildId, TEST_GUILD));
  await db.delete(forfeitCooldowns).where(eq(forfeitCooldowns.guildId, TEST_GUILD));
  await db.delete(rankRoles).where(eq(rankRoles.guildId, TEST_GUILD));
  await db.delete(leaderboard).where(eq(leaderboard.guildId, TEST_GUILD));
  await db.delete(guildConfig).where(eq(guildConfig.guildId, TEST_GUILD));
};

export const seedLeaderboard = async (count: number = 8) => {
  const userKeys = Object.keys(USERS).filter((k) => k !== "unranked").slice(0, count);
  for (let i = 0; i < userKeys.length; i++) {
    const key = userKeys[i] as keyof typeof USERS;
    await db.insert(leaderboard).values({
      guildId: TEST_GUILD,
      userId: USERS[key],
      username: key,
      rankPosition: i + 1,
    });
  }
};

export const seedGuildConfig = async (size: number = 8) => {
  await db.insert(guildConfig).values({
    guildId: TEST_GUILD,
    leaderboardSize: size,
  });
};
