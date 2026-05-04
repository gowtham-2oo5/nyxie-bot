import { db } from "../db";
import { challenges } from "../db/schema";
import { and, eq, lt } from "drizzle-orm";

export const cleanupStaleChallenges = async () => {
  const now = new Date();

  const result = await db
    .update(challenges)
    .set({ status: "expired", resolvedAt: now })
    .where(
      and(
        eq(challenges.status, "pending"),
        lt(challenges.expiresAt, now)
      )
    );

  console.log(`🧹 Stale challenges cleaned up.`);
};
