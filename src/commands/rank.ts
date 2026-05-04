import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { registerCommand } from "../handlers/interaction";
import { addCommandData } from "../deploy-commands";
import { COLORS, errorEmbed } from "../lib/embeds";
import { db } from "../db";
import { leaderboard } from "../db/schema";
import { eq, and } from "drizzle-orm";

const data = new SlashCommandBuilder()
  .setName("rank")
  .setDescription("Individual player stats")
  .addUserOption((o) =>
    o.setName("player").setDescription("Player to check (default: yourself)")
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  const target = interaction.options.getUser("player") ?? interaction.user;

  const entry = await db
    .select()
    .from(leaderboard)
    .where(
      and(
        eq(leaderboard.guildId, interaction.guildId!),
        eq(leaderboard.userId, target.id)
      )
    )
    .then((r) => r[0]);

  if (!entry) {
    return interaction.reply({
      embeds: [errorEmbed(`${target.username} is not on the leaderboard.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const medal =
    entry.rankPosition === 1
      ? "🥇"
      : entry.rankPosition === 2
        ? "🥈"
        : entry.rankPosition === 3
          ? "🥉"
          : "";

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`${medal} ${target.username}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: "Rank", value: `#${entry.rankPosition}`, inline: true },
          { name: "W / L", value: `${entry.totalWins} / ${entry.totalLosses}`, inline: true },
          { name: "Tournaments", value: `${entry.tournamentsPlayed} played, ${entry.tournamentsWon} won`, inline: true },
        ),
    ],
  });
};

addCommandData(data.toJSON());
registerCommand("rank", execute);
