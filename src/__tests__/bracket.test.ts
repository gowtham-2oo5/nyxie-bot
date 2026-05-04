import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { calculateTotalRounds, shuffleArray, generateFirstRound, advanceRound } from "../lib/bracket";
import { db } from "../db";
import { tournaments, participants, matches } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { cleanup, TEST_GUILD, USERS } from "./helpers";

let tournamentId: number;

const seedTournament = async (playerCount: number) => {
  const [t] = await db.insert(tournaments).values({
    guildId: TEST_GUILD,
    name: "Test Tournament",
    status: "active",
    createdBy: USERS.p1,
    totalRounds: calculateTotalRounds(playerCount),
  }).$returningId();
  tournamentId = t.id;

  const userKeys = Object.keys(USERS).filter((k) => k !== "unranked").slice(0, playerCount);
  const ids: number[] = [];
  for (const key of userKeys) {
    const [p] = await db.insert(participants).values({
      tournamentId,
      userId: USERS[key as keyof typeof USERS],
      username: key,
    }).$returningId();
    ids.push(p.id);
  }
  return ids;
};

const cleanupTournament = async () => {
  if (tournamentId) {
    await db.delete(matches).where(eq(matches.tournamentId, tournamentId));
    await db.delete(participants).where(eq(participants.tournamentId, tournamentId));
    await db.delete(tournaments).where(eq(tournaments.id, tournamentId));
  }
};

beforeEach(async () => {
  await cleanupTournament();
  await cleanup();
});

afterAll(async () => {
  await cleanupTournament();
  await cleanup();
});

describe("calculateTotalRounds", () => {
  test("8 players → 3 rounds", () => {
    expect(calculateTotalRounds(8)).toBe(3);
  });

  test("5 players → 3 rounds", () => {
    expect(calculateTotalRounds(5)).toBe(3);
  });

  test("2 players → 1 round", () => {
    expect(calculateTotalRounds(2)).toBe(1);
  });
});

describe("shuffleArray", () => {
  test("returns same length", () => {
    const arr = [1, 2, 3, 4, 5];
    expect(shuffleArray(arr)).toHaveLength(5);
  });

  test("does not mutate original", () => {
    const arr = [1, 2, 3, 4, 5];
    const copy = [...arr];
    shuffleArray(arr);
    expect(arr).toEqual(copy);
  });
});

describe("generateFirstRound", () => {
  test("even players — no BYEs", async () => {
    const ids = await seedTournament(8);
    await generateFirstRound(tournamentId, ids);

    const m = await db.select().from(matches).where(eq(matches.tournamentId, tournamentId));
    expect(m).toHaveLength(4);
    expect(m.filter((x) => x.status === "bye")).toHaveLength(0);
    expect(m.every((x) => x.player1Id !== null && x.player2Id !== null)).toBe(true);
  });

  test("odd players — 1 BYE", async () => {
    const ids = await seedTournament(7);
    await generateFirstRound(tournamentId, ids);

    const m = await db.select().from(matches).where(eq(matches.tournamentId, tournamentId));
    expect(m).toHaveLength(4);

    const byes = m.filter((x) => x.status === "bye");
    expect(byes).toHaveLength(1);
    expect(byes[0].winnerId).not.toBeNull();
    expect(byes[0].player2Id).toBeNull();
  });
});

describe("advanceRound", () => {
  test("completed round generates next round", async () => {
    const ids = await seedTournament(4);
    await generateFirstRound(tournamentId, ids);

    // Complete all round 1 matches
    const round1 = await db.select().from(matches).where(
      and(eq(matches.tournamentId, tournamentId), eq(matches.round, 1))
    );

    for (const m of round1) {
      await db.update(matches).set({
        status: "completed",
        winnerId: m.player1Id,
      }).where(eq(matches.id, m.id));
    }

    const isOver = await advanceRound(tournamentId, 1);
    expect(isOver).toBe(false);

    // Round 2 should exist
    const round2 = await db.select().from(matches).where(
      and(eq(matches.tournamentId, tournamentId), eq(matches.round, 2))
    );
    expect(round2).toHaveLength(1);
    expect(round2[0].player1Id).not.toBeNull();
    expect(round2[0].player2Id).not.toBeNull();
  });
});
