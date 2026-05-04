import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { registerCommand } from "../handlers/interaction";
import { addCommandData } from "../deploy-commands";
import { COLORS, errorEmbed, successEmbed } from "../lib/embeds";
import { db } from "../db";
import { tournaments, participants, matches, matchLog, leaderboard } from "../db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { advanceRound } from "../lib/bracket";
import { refreshLeaderboard } from "../lib/leaderboard";
import { applyForfeitCooldowns } from "../lib/forfeit";

// ─── Command Definition ───

const data = new SlashCommandBuilder()
  .setName("match")
  .setDescription("Tournament match management")
  .addSubcommand((s) =>
    s
      .setName("report")
      .setDescription("Report a match result")
      .addIntegerOption((o) =>
        o.setName("match_number").setDescription("Match number").setRequired(true)
      )
      .addUserOption((o) =>
        o.setName("winner").setDescription("The winner").setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("forfeit")
      .setDescription("Forfeit a tournament match")
      .addIntegerOption((o) =>
        o.setName("match_number").setDescription("Match number").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("reason").setDescription("Reason for forfeit").setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s.setName("list").setDescription("Show current round matches")
  );

// ─── Helpers ───

const getActiveTournament = (guildId: string) =>
  db
    .select()
    .from(tournaments)
    .where(
      and(eq(tournaments.guildId, guildId), eq(tournaments.status, "active"))
    )
    .then((r) => r[0] ?? null);

const getParticipantByUserId = (tournamentId: number, userId: string) =>
  db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.tournamentId, tournamentId),
        eq(participants.userId, userId)
      )
    )
    .then((r) => r[0] ?? null);

const checkTournamentComplete = async (tournament: typeof tournaments.$inferSelect) => {
  const isOver = await advanceRound(tournament.id, tournament.currentRound);

  if (isOver) {
    // Find the final match winner
    const finalMatch = await db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.tournamentId, tournament.id),
          eq(matches.round, tournament.currentRound)
        )
      )
      .then((r) => r[0]);

    await db
      .update(tournaments)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(tournaments.id, tournament.id));

    return finalMatch?.winnerId ?? null;
  }

  // Round advanced — update current round
  await db
    .update(tournaments)
    .set({ currentRound: tournament.currentRound + 1, updatedAt: new Date() })
    .where(eq(tournaments.id, tournament.id));

  return null;
};

// ─── Subcommands ───

const report = async (interaction: ChatInputCommandInteraction) => {
  const tournament = await getActiveTournament(interaction.guildId!);
  if (!tournament) {
    return interaction.reply({
      embeds: [errorEmbed("No active tournament.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const matchNumber = interaction.options.getInteger("match_number", true);
  const winnerUser = interaction.options.getUser("winner", true);

  const match = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.tournamentId, tournament.id),
        eq(matches.round, tournament.currentRound),
        eq(matches.matchNumber, matchNumber)
      )
    )
    .then((r) => r[0]);

  if (!match) {
    return interaction.reply({
      embeds: [errorEmbed(`Match #${matchNumber} not found in current round.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (match.status !== "pending") {
    return interaction.reply({
      embeds: [errorEmbed("This match is already resolved.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Verify winner is a player in this match
  const winnerParticipant = await getParticipantByUserId(tournament.id, winnerUser.id);
  if (
    !winnerParticipant ||
    (winnerParticipant.id !== match.player1Id && winnerParticipant.id !== match.player2Id)
  ) {
    return interaction.reply({
      embeds: [errorEmbed("That user is not a player in this match.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Check permission — must be a participant in the match or have Manage Server
  const isParticipant =
    interaction.user.id === winnerUser.id ||
    (match.player1Id && match.player2Id);
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

  const callerParticipant = await getParticipantByUserId(tournament.id, interaction.user.id);
  const callerInMatch =
    callerParticipant &&
    (callerParticipant.id === match.player1Id || callerParticipant.id === match.player2Id);

  if (!callerInMatch && !isAdmin) {
    return interaction.reply({
      embeds: [errorEmbed("Only match participants or admins can report results.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Determine loser
  const loserId = winnerParticipant.id === match.player1Id ? match.player2Id : match.player1Id;
  const loserParticipant = loserId
    ? await db.select().from(participants).where(eq(participants.id, loserId)).then((r) => r[0])
    : null;

  // Update match
  await db
    .update(matches)
    .set({ winnerId: winnerParticipant.id, status: "completed", completedAt: new Date() })
    .where(eq(matches.id, match.id));

  // Update participant stats
  await db
    .update(participants)
    .set({ wins: sql`${participants.wins} + 1` })
    .where(eq(participants.id, winnerParticipant.id));

  if (loserId) {
    await db
      .update(participants)
      .set({ losses: sql`${participants.losses} + 1`, isEliminated: true })
      .where(eq(participants.id, loserId));
  }

  // Log the match
  await db.insert(matchLog).values({
    guildId: interaction.guildId!,
    matchType: "tournament",
    resultType: "normal",
    winnerId: winnerUser.id,
    winnerUsername: winnerUser.username,
    loserId: loserParticipant?.userId ?? null,
    loserUsername: loserParticipant?.username ?? null,
    contextName: tournament.name,
    contextDetail: `Round ${tournament.currentRound}, Match #${matchNumber}`,
  });

  // Check round/tournament completion
  const championId = await checkTournamentComplete(tournament);

  if (championId) {
    const champion = await db
      .select()
      .from(participants)
      .where(eq(participants.id, championId))
      .then((r) => r[0]);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.gold)
          .setTitle(`🏆 ${tournament.name} — Champion!`)
          .setDescription(
            `🎉 **${champion?.username ?? "Unknown"}** wins the tournament!\n\nMatch #${matchNumber}: **${winnerUser.username}** defeated **${loserParticipant?.username ?? "???"}**`
          ),
      ],
    });
    const { client } = await import("../index");
    await refreshLeaderboard(client, interaction.guildId!);
    return;
  }

  await interaction.reply({
    embeds: [
      successEmbed(
        `Match #${matchNumber}: **${winnerUser.username}** wins! (defeated ${loserParticipant?.username ?? "???"})`
      ),
    ],
  });

  const { client } = await import("../index");
  await refreshLeaderboard(client, interaction.guildId!);
};

const forfeit = async (interaction: ChatInputCommandInteraction) => {
  const tournament = await getActiveTournament(interaction.guildId!);
  if (!tournament) {
    return interaction.reply({
      embeds: [errorEmbed("No active tournament.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const matchNumber = interaction.options.getInteger("match_number", true);
  const reason = interaction.options.getString("reason", true);

  const match = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.tournamentId, tournament.id),
        eq(matches.round, tournament.currentRound),
        eq(matches.matchNumber, matchNumber)
      )
    )
    .then((r) => r[0]);

  if (!match) {
    return interaction.reply({
      embeds: [errorEmbed(`Match #${matchNumber} not found in current round.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (match.status !== "pending") {
    return interaction.reply({
      embeds: [errorEmbed("This match is already resolved.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Determine who is forfeiting
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  const callerParticipant = await getParticipantByUserId(tournament.id, interaction.user.id);
  const callerInMatch =
    callerParticipant &&
    (callerParticipant.id === match.player1Id || callerParticipant.id === match.player2Id);

  if (!callerInMatch && !isAdmin) {
    return interaction.reply({
      embeds: [errorEmbed("Only match participants or admins can forfeit.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  // If admin and not in match, they must specify who forfeits — for now, forfeit player1
  // If caller is in match, they forfeit themselves
  const forfeiterId = callerInMatch ? callerParticipant!.id : match.player1Id!;
  const otherId = forfeiterId === match.player1Id ? match.player2Id : match.player1Id;

  // Update match
  await db
    .update(matches)
    .set({
      status: "forfeited",
      forfeitBy: forfeiterId,
      forfeitReason: reason,
      completedAt: new Date(),
    })
    .where(eq(matches.id, match.id));

  // Get player info for logging
  const [forfeiter, other] = await Promise.all([
    db.select().from(participants).where(eq(participants.id, forfeiterId)).then((r) => r[0]),
    otherId
      ? db.select().from(participants).where(eq(participants.id, otherId)).then((r) => r[0])
      : null,
  ]);

  // Log with nulls for winner/loser (forfeit = no contest)
  await db.insert(matchLog).values({
    guildId: interaction.guildId!,
    matchType: "tournament",
    resultType: "forfeit",
    winnerId: null,
    winnerUsername: null,
    loserId: null,
    loserUsername: null,
    forfeitBy: forfeiter?.userId ?? null,
    forfeitReason: reason,
    contextName: tournament.name,
    contextDetail: `Round ${tournament.currentRound}, Match #${matchNumber}`,
  });

  // Apply forfeit cooldowns
  if (forfeiter && other) {
    await applyForfeitCooldowns(
      interaction.guildId!,
      forfeiter.userId,
      other.userId,
      `Forfeited tournament match: ${tournament.name}, Round ${tournament.currentRound} Match #${matchNumber}`
    );
  }

  // Check round/tournament completion
  const championId = await checkTournamentComplete(tournament);

  if (championId) {
    const champion = await db
      .select()
      .from(participants)
      .where(eq(participants.id, championId))
      .then((r) => r[0]);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.gold)
          .setTitle(`🏆 ${tournament.name} — Champion!`)
          .setDescription(
            `🎉 **${champion?.username ?? "Unknown"}** wins by forfeit!\n\n🏳️ **${forfeiter?.username ?? "???"}** forfeited Match #${matchNumber}\nReason: ${reason}`
          ),
      ],
    });
    return;
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle(`🏳️ Match #${matchNumber} — Forfeited`)
        .setDescription(
          `**${forfeiter?.username ?? "???"}** forfeited.\n${other ? `**${other.username}** advances.` : ""}\nReason: ${reason}`
        ),
    ],
  });
};

const listMatches = async (interaction: ChatInputCommandInteraction) => {
  const tournament = await getActiveTournament(interaction.guildId!);
  if (!tournament) {
    return interaction.reply({
      embeds: [errorEmbed("No active tournament.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const roundMatches = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.tournamentId, tournament.id),
        eq(matches.round, tournament.currentRound)
      )
    );

  const players = await db
    .select()
    .from(participants)
    .where(eq(participants.tournamentId, tournament.id));

  const playerMap = new Map(players.map((p) => [p.id, p.username]));

  const lines = roundMatches
    .sort((a, b) => a.matchNumber - b.matchNumber)
    .map((m) => {
      const p1 = m.player1Id ? playerMap.get(m.player1Id) ?? "???" : "BYE";
      const p2 = m.player2Id ? playerMap.get(m.player2Id) ?? "???" : "BYE";
      const st =
        m.status === "completed"
          ? `✅ ${m.winnerId ? playerMap.get(m.winnerId) : "???"}`
          : m.status === "forfeited"
            ? "🏳️ FF"
            : m.status === "bye"
              ? "⏭️ BYE"
              : "⏳";
      return `\`#${m.matchNumber}\` ${p1} vs ${p2} — ${st}`;
    });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`⚔️ ${tournament.name} — Round ${tournament.currentRound}`)
        .setDescription(lines.join("\n") || "No matches."),
    ],
  });
};

// ─── Router ───

const subcommands: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
  report,
  forfeit,
  list: listMatches,
};

const execute = async (interaction: ChatInputCommandInteraction) => {
  const sub = interaction.options.getSubcommand();
  const handler = subcommands[sub];
  if (handler) await handler(interaction);
};

addCommandData(data.toJSON());
registerCommand("match", execute);
