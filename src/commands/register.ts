import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { registerCommand } from "../handlers/interaction";
import { addCommandData } from "../deploy-commands";
import { errorEmbed, successEmbed } from "../lib/embeds";
import { db } from "../db";
import { leaderboard } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { ensureOnLeaderboard } from "../lib/rank-ops";

const data = new SlashCommandBuilder()
  .setName("register")
  .setDescription("Join the general leaderboard")
  .addStringOption((o) => o.setName("region").setDescription("Region (default: default)").setAutocomplete(true));

const execute = async (interaction: ChatInputCommandInteraction) => {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const region = interaction.options.getString("region") ?? "default";

  const existing = await db
    .select()
    .from(leaderboard)
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId), eq(leaderboard.region, region)))
    .then((r) => r[0]);

  if (existing) {
    return interaction.reply({
      embeds: [errorEmbed(`You're already on the leaderboard at Rank #${existing.rankPosition}.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const entry = await ensureOnLeaderboard(guildId, userId, interaction.user.username, region);

  await interaction.reply({
    embeds: [successEmbed(`You've joined the leaderboard at Rank #${entry.rankPosition}! Use \`/challenge\` to climb.`)],
  });

  const { client } = await import("../index");
  const { refreshLeaderboard } = await import("../lib/leaderboard");
  await refreshLeaderboard(client, guildId);
};

addCommandData(data.toJSON());
registerCommand("register", execute);
