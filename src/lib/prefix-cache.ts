import { db } from "../db";
import { guildConfig } from "../db/schema";
import { eq } from "drizzle-orm";

const cache = new Map<string, { prefix: string; expiresAt: number }>();
const TTL = 5 * 60 * 1000; // 5 min

export const getPrefix = async (guildId: string): Promise<string> => {
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.prefix;

  const cfg = await db
    .select({ prefix: guildConfig.prefix })
    .from(guildConfig)
    .where(eq(guildConfig.guildId, guildId))
    .then((r) => r[0]);

  const prefix = cfg?.prefix ?? "!";
  cache.set(guildId, { prefix, expiresAt: Date.now() + TTL });
  return prefix;
};

export const invalidatePrefixCache = (guildId: string) => {
  cache.delete(guildId);
};
