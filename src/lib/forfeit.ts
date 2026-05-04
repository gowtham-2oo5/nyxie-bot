import { db } from "../db";
import { forfeitCooldowns } from "../db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";

export const applyForfeitCooldowns = async (
  guildId: string,
  forfeiterId: string,
  otherId: string,
  context: string
) => {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.insert(forfeitCooldowns).values([
    {
      guildId,
      userId: forfeiterId,
      type: "unavoidable",
      reason: context,
      expiresAt,
    },
    {
      guildId,
      userId: otherId,
      type: "voidable",
      reason: context,
      expiresAt,
    },
  ]);
};

export const checkForfeitCooldown = async (
  guildId: string,
  userId: string
): Promise<{ type: string; remaining: number; reason: string } | null> => {
  const now = new Date();

  const active = await db
    .select()
    .from(forfeitCooldowns)
    .where(
      and(
        eq(forfeitCooldowns.guildId, guildId),
        eq(forfeitCooldowns.userId, userId),
        gt(forfeitCooldowns.expiresAt, now),
        isNull(forfeitCooldowns.voidedBy)
      )
    )
    .then((r) => r[0]);

  if (!active) return null;

  return {
    type: active.type,
    remaining: Math.ceil((active.expiresAt.getTime() - now.getTime()) / 1000),
    reason: active.reason,
  };
};

export const voidForfeitCooldown = async (
  guildId: string,
  userId: string,
  voidedBy: string
): Promise<boolean> => {
  const now = new Date();

  const active = await db
    .select()
    .from(forfeitCooldowns)
    .where(
      and(
        eq(forfeitCooldowns.guildId, guildId),
        eq(forfeitCooldowns.userId, userId),
        eq(forfeitCooldowns.type, "voidable"),
        gt(forfeitCooldowns.expiresAt, now),
        isNull(forfeitCooldowns.voidedBy)
      )
    )
    .then((r) => r[0]);

  if (!active) return false;

  await db
    .update(forfeitCooldowns)
    .set({ voidedBy, voidedAt: now })
    .where(eq(forfeitCooldowns.id, active.id));

  return true;
};

/**
 * Admin force-void any cooldown type (including unavoidable).
 */
export const adminVoidCooldown = async (
  guildId: string,
  userId: string,
  voidedBy: string
): Promise<boolean> => {
  const now = new Date();

  const active = await db
    .select()
    .from(forfeitCooldowns)
    .where(
      and(
        eq(forfeitCooldowns.guildId, guildId),
        eq(forfeitCooldowns.userId, userId),
        gt(forfeitCooldowns.expiresAt, now),
        isNull(forfeitCooldowns.voidedBy)
      )
    )
    .then((r) => r[0]);

  if (!active) return false;

  await db
    .update(forfeitCooldowns)
    .set({ voidedBy, voidedAt: now })
    .where(eq(forfeitCooldowns.id, active.id));

  return true;
};

export const getActiveForfeitCooldowns = async (
  guildId: string,
  userId?: string
) => {
  const now = new Date();
  const conditions = [
    eq(forfeitCooldowns.guildId, guildId),
    gt(forfeitCooldowns.expiresAt, now),
    isNull(forfeitCooldowns.voidedBy),
  ];

  if (userId) conditions.push(eq(forfeitCooldowns.userId, userId));

  return db
    .select()
    .from(forfeitCooldowns)
    .where(and(...conditions));
};

export const cleanupExpiredForfeits = async () => {
  const now = new Date();
  await db
    .delete(forfeitCooldowns)
    .where(gt(now, forfeitCooldowns.expiresAt));
};
