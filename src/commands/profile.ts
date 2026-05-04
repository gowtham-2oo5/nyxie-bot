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
import { leaderboard, rankRoles } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { getPresenceData, formatActivity, formatStatus } from "../lib/presence";
import { checkForfeitCooldown } from "../lib/forfeit";

const data = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("Rich user profile")
  .addUserOption((o) =>
    o.setName("user").setDescription("User to view (default: yourself)")
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  const target = interaction.options.getUser("user") ?? interaction.user;
  const guildId = interaction.guildId!;

  const member = await interaction.guild?.members.fetch(target.id).catch(() => null);
  if (!member) {
    return interaction.reply({
      embeds: [errorEmbed("Could not find that member.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Presence
  const { status, customStatus, activities } = getPresenceData(member);
  const activityLines = activities.map(formatActivity).filter(Boolean);

  // DB stats
  const entry = await db
    .select()
    .from(leaderboard)
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, target.id)))
    .then((r) => r[0] ?? null);

  // Forfeit CD
  const cd = await checkForfeitCooldown(guildId, target.id);

  // Rank role
  const roles = await db.select().from(rankRoles).where(eq(rankRoles.guildId, guildId));
  const rankRole = entry
    ? roles.find((r) => entry.rankPosition === r.position)
    : null;

  // Build embed
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setAuthor({ name: member.displayName, iconURL: target.displayAvatarURL() })
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .setDescription(
      [
        formatStatus(status),
        customStatus ? `💬 "${customStatus}"` : null,
        ...activityLines,
      ]
        .filter(Boolean)
        .join("\n") || formatStatus(status)
    );

  // Stats fields
  if (entry) {
    const medal =
      entry.rankPosition === 1 ? " 🥇" : entry.rankPosition === 2 ? " 🥈" : entry.rankPosition === 3 ? " 🥉" : "";
    embed.addFields(
      { name: "Rank", value: `#${entry.rankPosition}${medal}${rankRole ? ` • ${rankRole.label}` : ""}`, inline: true },
      { name: "W / L", value: `${entry.totalWins} / ${entry.totalLosses}`, inline: true },
      { name: "Tournaments", value: `${entry.tournamentsPlayed} played, ${entry.tournamentsWon}W`, inline: true },
    );
  } else {
    embed.addFields({ name: "Rank", value: "Unranked", inline: true });
  }

  // Server info
  const joinedTs = member.joinedAt
    ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>`
    : "Unknown";
  const memberRoles = member.roles.cache
    .filter((r) => r.id !== guildId)
    .sort((a, b) => b.position - a.position)
    .first(5)
    .map((r) => r.toString())
    .join(", ");

  embed.addFields(
    { name: "Joined", value: joinedTs, inline: true },
    { name: "Roles", value: memberRoles || "None", inline: true },
  );

  // Forfeit CD
  if (cd) {
    const hrs = Math.ceil(cd.remaining / 3600);
    embed.addFields({
      name: "⚠️ Forfeit Cooldown",
      value: `${cd.type} — ${hrs}hr left`,
    });
  }

  await interaction.reply({ embeds: [embed] });
};

addCommandData(data.toJSON());
registerCommand("profile", execute);
