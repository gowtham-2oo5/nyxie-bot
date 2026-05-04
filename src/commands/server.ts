import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { registerCommand } from "../handlers/interaction";
import { addCommandData } from "../deploy-commands";
import { COLORS } from "../lib/embeds";
import { db } from "../db";
import { tournaments, matchLog, leaderboard, challenges } from "../db/schema";
import { eq, sql } from "drizzle-orm";

const startTime = Date.now();

const data = new SlashCommandBuilder()
  .setName("server")
  .setDescription("Live server & bot stats");

const execute = async (interaction: ChatInputCommandInteraction) => {
  const guild = interaction.guild!;
  const guildId = guild.id;

  const [tournamentStats, matchCount, lbSize, challengeCount] = await Promise.all([
    db
      .select({
        total: sql<number>`COUNT(*)`,
        active: sql<number>`SUM(CASE WHEN status IN ('pending','active') THEN 1 ELSE 0 END)`,
      })
      .from(tournaments)
      .where(eq(tournaments.guildId, guildId))
      .then((r) => r[0]),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(matchLog)
      .where(eq(matchLog.guildId, guildId))
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(leaderboard)
      .where(eq(leaderboard.guildId, guildId))
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(challenges)
      .where(eq(challenges.guildId, guildId))
      .then((r) => r[0].count),
  ]);

  const uptimeMs = Date.now() - startTime;
  const hrs = Math.floor(uptimeMs / 3600000);
  const mins = Math.floor((uptimeMs % 3600000) / 60000);
  const uptime = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

  const onlineCount = guild.presences.cache.filter(
    (p) => p.status !== "offline"
  ).size;

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(guild.name)
        .setThumbnail(guild.iconURL({ size: 128 }))
        .addFields(
          { name: "Members", value: `${guild.memberCount}`, inline: true },
          { name: "Online", value: `${onlineCount}`, inline: true },
          { name: "Bot Uptime", value: uptime, inline: true },
          { name: "Tournaments", value: `${tournamentStats.total} total, ${tournamentStats.active ?? 0} active`, inline: true },
          { name: "Matches Played", value: `${matchCount}`, inline: true },
          { name: "Ranked Players", value: `${lbSize}`, inline: true },
          { name: "Challenges", value: `${challengeCount}`, inline: true },
        ),
    ],
  });
};

addCommandData(data.toJSON());
registerCommand("server", execute);
