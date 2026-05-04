import { db } from "../db";
import { matches } from "../db/schema";
import { eq, and } from "drizzle-orm";

export const calculateTotalRounds = (count: number) =>
  Math.ceil(Math.log2(count));

export const shuffleArray = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const generateFirstRound = async (
  tournamentId: number,
  playerIds: number[]
) => {
  const shuffled = shuffleArray(playerIds);
  const totalMatches = Math.ceil(shuffled.length / 2);
  const inserts: (typeof matches.$inferInsert)[] = [];

  for (let i = 0; i < totalMatches; i++) {
    const p1 = shuffled[i * 2];
    const p2 = shuffled[i * 2 + 1] ?? null;

    inserts.push({
      tournamentId,
      round: 1,
      matchNumber: i + 1,
      player1Id: p1,
      player2Id: p2,
      status: p2 ? "pending" : "bye",
      winnerId: p2 ? null : p1,
    });
  }

  await db.insert(matches).values(inserts);
};

export const advanceRound = async (
  tournamentId: number,
  completedRound: number
): Promise<boolean> => {
  const roundMatches = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.tournamentId, tournamentId),
        eq(matches.round, completedRound)
      )
    );

  const allDone = roundMatches.every(
    (m) =>
      m.status === "completed" || m.status === "bye" || m.status === "forfeited"
  );
  if (!allDone) return false;

  const winners = roundMatches
    .map((m) => {
      if (m.status === "forfeited") {
        return m.forfeitBy === m.player1Id ? m.player2Id : m.player1Id;
      }
      return m.winnerId;
    })
    .filter((id): id is number => id !== null);

  if (winners.length <= 1) return true;

  const nextRound = completedRound + 1;
  const inserts: (typeof matches.$inferInsert)[] = [];

  for (let i = 0; i < Math.ceil(winners.length / 2); i++) {
    const p1 = winners[i * 2];
    const p2 = winners[i * 2 + 1] ?? null;

    inserts.push({
      tournamentId,
      round: nextRound,
      matchNumber: i + 1,
      player1Id: p1,
      player2Id: p2,
      status: p2 ? "pending" : "bye",
      winnerId: p2 ? null : p1,
    });
  }

  await db.insert(matches).values(inserts);
  return false;
};

export const buildBracketDisplay = (
  matchList: (typeof matches.$inferSelect)[],
  playerMap: Map<number, string>
): string => {
  const rounds = new Map<number, (typeof matches.$inferSelect)[]>();
  for (const m of matchList) {
    const arr = rounds.get(m.round) ?? [];
    arr.push(m);
    rounds.set(m.round, arr);
  }

  const lines: string[] = [];
  const sortedRounds = [...rounds.keys()].sort((a, b) => a - b);

  for (const round of sortedRounds) {
    lines.push(`**Round ${round}**`);
    const rm = rounds.get(round)!.sort((a, b) => a.matchNumber - b.matchNumber);

    for (const m of rm) {
      const p1 = m.player1Id ? playerMap.get(m.player1Id) ?? "???" : "BYE";
      const p2 = m.player2Id ? playerMap.get(m.player2Id) ?? "???" : "BYE";
      const status =
        m.status === "completed"
          ? `✅ ${m.winnerId ? playerMap.get(m.winnerId) ?? "???" : "???"}`
          : m.status === "forfeited"
            ? `🏳️ FF`
            : m.status === "bye"
              ? `⏭️ BYE`
              : `⏳`;

      lines.push(`\`#${m.matchNumber}\` ${p1} vs ${p2} — ${status}`);
    }
    lines.push("");
  }

  return lines.join("\n");
};
