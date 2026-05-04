import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import { registerCommand, registerButton } from "../handlers/interaction";
import { addCommandData } from "../deploy-commands";
import { COLORS, errorEmbed, successEmbed } from "../lib/embeds";
import { db } from "../db";
import { tournaments, participants, matches } from "../db/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import {
  calculateTotalRounds,
  generateFirstRound,
  buildBracketDisplay,
} from "../lib/bracket";

// ─── Command Definition ───

const data = new SlashCommandBuilder()
  .setName("tournament")
  .setDescription("Tournament management")
  .addSubcommand((s) =>
    s
      .setName("create")
      .setDescription("Create a new tournament")
      .addStringOption((o) =>
        o.setName("name").setDescription("Tournament name").setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s.setName("join").setDescription("Join the pending tournament")
  )
  .addSubcommand((s) =>
    s.setName("leave").setDescription("Leave before tournament starts")
  )
  .addSubcommand((s) =>
    s.setName("start").setDescription("Start tournament & generate bracket")
  )
  .addSubcommand((s) =>
    s.setName("end").setDescription("Force-cancel the tournament")
  )
  .addSubcommand((s) =>
    s.setName("status").setDescription("Show tournament info")
  )
  .addSubcommand((s) =>
    s.setName("bracket").setDescription("Display the bracket")
  )
  .addSubcommand((s) =>
    s.setName("list").setDescription("List recent tournaments")
  );

// ─── Helpers ───

const getActiveTournament = (guildId: string) =>
  db
    .select()
    .from(tournaments)
    .where(
      and(
        eq(tournaments.guildId, guildId),
        or(
          eq(tournaments.status, "pending"),
          eq(tournaments.status, "active")
        )
      )
    )
    .then((r) => r[0] ?? null);

const getParticipants = (tournamentId: number) =>
  db
    .select()
    .from(participants)
    .where(eq(participants.tournamentId, tournamentId));

// ─── Subcommand Handlers ───

const create = async (interaction: ChatInputCommandInteraction) => {
  const guildId = interaction.guildId!;
  const existing = await getActiveTournament(guildId);

  if (existing) {
    return interaction.reply({
      embeds: [errorEmbed(`A tournament is already ${existing.status}: **${existing.name}**`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const name = interaction.options.getString("name", true);

  const [result] = await db.insert(tournaments).values({
    guildId,
    name,
    createdBy: interaction.user.id,
  }).$returningId();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament_join_${result.id}`)
      .setLabel("Join Tournament")
      .setStyle(ButtonStyle.Success)
      .setEmoji("⚔️"),
    new ButtonBuilder()
      .setCustomId(`tournament_leave_${result.id}`)
      .setLabel("Leave")
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`🏆 Tournament Created: ${name}`)
        .setDescription("Click below to join!")
        .addFields({ name: "ID", value: `${result.id}`, inline: true })
        .addFields({ name: "Status", value: "Pending", inline: true })
        .addFields({ name: "Created by", value: `<@${interaction.user.id}>`, inline: true })
        .addFields({ name: "Players", value: "0", inline: true }),
    ],
    components: [row],
  });
};

const join = async (interaction: ChatInputCommandInteraction) => {
  const tournament = await getActiveTournament(interaction.guildId!);

  if (!tournament) {
    return interaction.reply({
      embeds: [errorEmbed("No active tournament to join.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (tournament.status !== "pending") {
    return interaction.reply({
      embeds: [errorEmbed("Tournament has already started.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const existing = await db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.tournamentId, tournament.id),
        eq(participants.userId, interaction.user.id)
      )
    )
    .then((r) => r[0]);

  if (existing) {
    return interaction.reply({
      embeds: [errorEmbed("You've already joined this tournament.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await db.insert(participants).values({
    tournamentId: tournament.id,
    userId: interaction.user.id,
    username: interaction.user.username,
  });

  const count = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(participants)
    .where(eq(participants.tournamentId, tournament.id))
    .then((r) => r[0].count);

  await interaction.reply({
    embeds: [
      successEmbed(
        `**${interaction.user.username}** joined **${tournament.name}**! (${count} players)`
      ),
    ],
  });
};

const leave = async (interaction: ChatInputCommandInteraction) => {
  const tournament = await getActiveTournament(interaction.guildId!);

  if (!tournament || tournament.status !== "pending") {
    return interaction.reply({
      embeds: [errorEmbed("No pending tournament to leave.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const entry = await db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.tournamentId, tournament.id),
        eq(participants.userId, interaction.user.id)
      )
    )
    .then((r) => r[0]);

  if (!entry) {
    return interaction.reply({
      embeds: [errorEmbed("You're not in this tournament.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await db.delete(participants).where(eq(participants.id, entry.id));

  await interaction.reply({
    embeds: [successEmbed(`**${interaction.user.username}** left **${tournament.name}**.`)],
  });
};

const start = async (interaction: ChatInputCommandInteraction) => {
  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return interaction.reply({
      embeds: [errorEmbed("You need **Manage Server** permission.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const tournament = await getActiveTournament(interaction.guildId!);

  if (!tournament || tournament.status !== "pending") {
    return interaction.reply({
      embeds: [errorEmbed("No pending tournament to start.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const players = await getParticipants(tournament.id);

  if (players.length < 2) {
    return interaction.reply({
      embeds: [errorEmbed("Need at least 2 participants to start.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const totalRounds = calculateTotalRounds(players.length);

  await db
    .update(tournaments)
    .set({ status: "active", totalRounds, updatedAt: new Date() })
    .where(eq(tournaments.id, tournament.id));

  await generateFirstRound(
    tournament.id,
    players.map((p) => p.id)
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.gold)
        .setTitle(`⚔️ ${tournament.name} has started!`)
        .setDescription(
          `**${players.length}** players • **${totalRounds}** rounds\nUse \`/tournament bracket\` to see matchups.`
        ),
    ],
  });
};

const end = async (interaction: ChatInputCommandInteraction) => {
  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return interaction.reply({
      embeds: [errorEmbed("You need **Manage Server** permission.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const tournament = await getActiveTournament(interaction.guildId!);

  if (!tournament) {
    return interaction.reply({
      embeds: [errorEmbed("No active tournament to cancel.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await db
    .update(tournaments)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(tournaments.id, tournament.id));

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle(`❌ ${tournament.name} has been cancelled.`),
    ],
  });
};

const status = async (interaction: ChatInputCommandInteraction) => {
  const tournament = await getActiveTournament(interaction.guildId!);

  if (!tournament) {
    return interaction.reply({
      embeds: [errorEmbed("No active tournament.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const players = await getParticipants(tournament.id);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`🏆 ${tournament.name}`)
        .addFields(
          { name: "Status", value: tournament.status, inline: true },
          { name: "Players", value: `${players.length}`, inline: true },
          { name: "Round", value: `${tournament.currentRound} / ${tournament.totalRounds || "—"}`, inline: true },
          { name: "Created by", value: `<@${tournament.createdBy}>`, inline: true },
        ),
    ],
  });
};

const bracket = async (interaction: ChatInputCommandInteraction) => {
  const tournament = await getActiveTournament(interaction.guildId!);

  if (!tournament || tournament.status !== "active") {
    return interaction.reply({
      embeds: [errorEmbed("No active tournament with a bracket.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const [allMatches, players] = await Promise.all([
    db.select().from(matches).where(eq(matches.tournamentId, tournament.id)),
    getParticipants(tournament.id),
  ]);

  const playerMap = new Map(players.map((p) => [p.id, p.username]));
  const display = buildBracketDisplay(allMatches, playerMap);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`📊 ${tournament.name} — Bracket`)
        .setDescription(display || "No matches yet."),
    ],
  });
};

const list = async (interaction: ChatInputCommandInteraction) => {
  const recent = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.guildId, interaction.guildId!))
    .orderBy(desc(tournaments.createdAt))
    .limit(10);

  if (!recent.length) {
    return interaction.reply({
      embeds: [errorEmbed("No tournaments found in this server.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = recent.map(
    (t) => `\`#${t.id}\` **${t.name}** — ${t.status} (${t.createdAt?.toLocaleDateString() ?? "?"})`
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle("📋 Recent Tournaments")
        .setDescription(lines.join("\n")),
    ],
  });
};

// ─── Router ───

const subcommands: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
  create, join, leave, start, end, status, bracket, list,
};

const execute = async (interaction: ChatInputCommandInteraction) => {
  const sub = interaction.options.getSubcommand();
  const handler = subcommands[sub];
  if (handler) await handler(interaction);
};

// ─── Button Handlers ───

const updateTournamentEmbed = async (interaction: ButtonInteraction, tournamentId: number) => {
  const tournament = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).then((r) => r[0]);
  if (!tournament) return;

  const players = await getParticipants(tournamentId);
  const playerList = players.length
    ? players.map((p) => `• ${p.username}`).join("\n")
    : "No players yet.";

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament_join_${tournamentId}`)
      .setLabel("Join Tournament")
      .setStyle(ButtonStyle.Success)
      .setEmoji("⚔️")
      .setDisabled(tournament.status !== "pending"),
    new ButtonBuilder()
      .setCustomId(`tournament_leave_${tournamentId}`)
      .setLabel("Leave")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(tournament.status !== "pending"),
  );

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`🏆 ${tournament.name}`)
        .setDescription(tournament.status === "pending" ? "Click below to join!" : "Tournament started!")
        .addFields({ name: "ID", value: `${tournament.id}`, inline: true })
        .addFields({ name: "Status", value: tournament.status, inline: true })
        .addFields({ name: "Created by", value: `<@${tournament.createdBy}>`, inline: true })
        .addFields({ name: `Players (${players.length})`, value: playerList }),
    ],
    components: tournament.status === "pending" ? [row] : [],
  });
};

const handleJoinButton = async (interaction: ButtonInteraction) => {
  const tournamentId = parseInt(interaction.customId.replace("tournament_join_", ""));

  const tournament = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).then((r) => r[0]);
  if (!tournament || tournament.status !== "pending") {
    return interaction.reply({ embeds: [errorEmbed("Tournament is no longer accepting players.")], flags: MessageFlags.Ephemeral });
  }

  const existing = await db.select().from(participants)
    .where(and(eq(participants.tournamentId, tournamentId), eq(participants.userId, interaction.user.id)))
    .then((r) => r[0]);

  if (existing) {
    return interaction.reply({ embeds: [errorEmbed("You've already joined!")], flags: MessageFlags.Ephemeral });
  }

  await db.insert(participants).values({
    tournamentId,
    userId: interaction.user.id,
    username: interaction.user.username,
  });

  await updateTournamentEmbed(interaction, tournamentId);
};

const handleLeaveButton = async (interaction: ButtonInteraction) => {
  const tournamentId = parseInt(interaction.customId.replace("tournament_leave_", ""));

  const entry = await db.select().from(participants)
    .where(and(eq(participants.tournamentId, tournamentId), eq(participants.userId, interaction.user.id)))
    .then((r) => r[0]);

  if (!entry) {
    return interaction.reply({ embeds: [errorEmbed("You're not in this tournament.")], flags: MessageFlags.Ephemeral });
  }

  await db.delete(participants).where(eq(participants.id, entry.id));
  await updateTournamentEmbed(interaction, tournamentId);
};

addCommandData(data.toJSON());
registerCommand("tournament", execute);
registerButton("tournament_join_", handleJoinButton);
registerButton("tournament_leave_", handleLeaveButton);
