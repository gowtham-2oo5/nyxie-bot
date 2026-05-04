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
import { leaderboard, rankRoles, tournaments, participants } from "../db/schema";
import { eq, and, or, asc, desc } from "drizzle-orm";
import { getLeaderboardSize } from "../lib/rank-ops";

const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Server rankings")
  .addSubcommand((s) =>
    s
      .setName("general")
      .setDescription("General server leaderboard")
      .addStringOption((o) => o.setName("region").setDescription("Region (default: default)").setAutocomplete(true))
  )
  .addSubcommand((s) =>
    s
      .setName("tournament")
      .setDescription("Current/recent tournament leaderboard")
      .addIntegerOption((o) => o.setName("id").setDescription("Tournament ID (default: current)"))
  );

const general = async (interaction: ChatInputCommandInteraction) => {
  const guildId = interaction.guildId!;
  const region = interaction.options.getString("region") ?? "default";

  const entries = await db
    .select()
    .from(leaderboard)
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region)))
    .orderBy(asc(leaderboard.rankPosition));

  const roles = await db.select().from(rankRoles).where(and(eq(rankRoles.guildId, guildId), eq(rankRoles.region, region)));
  const lbSize = await getLeaderboardSize(guildId);

  const regionLabel = region === "default" ? "" : ` - ${region.toUpperCase()} Region`;
  const lines: string[] = [];
  for (let pos = 1; pos <= lbSize; pos++) {
    const entry = entries.find((e) => e.rankPosition === pos);
    const role = roles.find((r) => r.position === pos);
    const roleMention = role ? (role.roleId ? `<@&${role.roleId}>` : `**${role.label}**`) : `#${pos}`;
    const userMention = entry ? `<@${entry.userId}>` : "VACANT";
    lines.push(`**${pos}.** ${roleMention} : ${userMention}`);
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`${interaction.guild?.name ?? "Server"}${regionLabel}`)
        .setDescription(lines.join("\n")),
    ],
  });
};

const tournament = async (interaction: ChatInputCommandInteraction) => {
  const guildId = interaction.guildId!;
  const tournamentId = interaction.options.getInteger("id");

  let t;
  if (tournamentId) {
    t = await db.select().from(tournaments).where(and(eq(tournaments.id, tournamentId), eq(tournaments.guildId, guildId))).then((r) => r[0]);
  } else {
    // Get current or most recent tournament
    t = await db
      .select()
      .from(tournaments)
      .where(
        and(
          eq(tournaments.guildId, guildId),
          or(eq(tournaments.status, "active"), eq(tournaments.status, "completed"), eq(tournaments.status, "pending"))
        )
      )
      .orderBy(desc(tournaments.createdAt))
      .limit(1)
      .then((r) => r[0]);
  }

  if (!t) {
    return interaction.reply({
      embeds: [errorEmbed("No tournament found.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const players = await db
    .select()
    .from(participants)
    .where(eq(participants.tournamentId, t.id));

  if (!players.length) {
    return interaction.reply({
      embeds: [errorEmbed("No participants in this tournament.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Sort by wins desc, then losses asc
  const sorted = players.sort((a, b) => b.wins - a.wins || a.losses - b.losses);

  const medal = (i: number) =>
    i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `\`#${i + 1}\``;

  const lines = sorted.map((p, i) => {
    const eliminated = p.isEliminated ? " ❌" : "";
    return `${medal(i)} **${p.username}** — ${p.wins}W/${p.losses}L${eliminated}`;
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`🏆 ${t.name} — Standings`)
        .setDescription(lines.join("\n"))
        .addFields(
          { name: "Status", value: t.status, inline: true },
          { name: "Round", value: `${t.currentRound} / ${t.totalRounds || "—"}`, inline: true },
          { name: "Players", value: `${players.length}`, inline: true },
        ),
    ],
  });
};

const execute = async (interaction: ChatInputCommandInteraction) => {
  const sub = interaction.options.getSubcommand();
  if (sub === "general") await general(interaction);
  else if (sub === "tournament") await tournament(interaction);
};

addCommandData(data.toJSON());
registerCommand("leaderboard", execute);
