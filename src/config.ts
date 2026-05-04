import "dotenv/config";

const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

export const config = {
  botToken: required("DISCORD_BOT_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  databaseUrl: required("DATABASE_URL"),
  guildId: process.env.GUILD_ID ?? null,
} as const;
