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
import { leaderboard, rankRoles, guildConfig } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  ensureOnLeaderboard,
  setRankPositionWithDisplacement,
  swapRankPositions,
  getPlayerAtRank,
  removeFromLeaderboard,
} from "../lib/rank-ops";
import { getActiveForfeitCooldowns, adminVoidCooldown } from "../lib/forfeit";
import { refreshLeaderboard } from "../lib/leaderboard";

const triggerRefresh = async (guildId: string) => {
  const { client } = await import("../index");
  await refreshLeaderboard(client, guildId);
};

// ─── Command Definition ───

const data = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("Admin management")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommandGroup((g) =>
    g
      .setName("leaderboard")
      .setDescription("Leaderboard management")
      .addSubcommand((s) => s.setName("reset").setDescription("Wipe all rankings").addStringOption((o) => o.setName("region").setDescription("Region (default: default)").setAutocomplete(true)))
      .addSubcommand((s) =>
        s
          .setName("set")
          .setDescription("Set a player stat")
          .addUserOption((o) => o.setName("player").setDescription("Player").setRequired(true))
          .addStringOption((o) =>
            o.setName("stat").setDescription("Stat to set").setRequired(true)
              .addChoices(
                { name: "total_wins", value: "totalWins" },
                { name: "total_losses", value: "totalLosses" },
                { name: "tournaments_won", value: "tournamentsWon" },
                { name: "tournaments_played", value: "tournamentsPlayed" },
                { name: "rank_position", value: "rankPosition" },
              )
          )
          .addIntegerOption((o) => o.setName("value").setDescription("New value").setRequired(true))
          .addStringOption((o) => o.setName("region").setDescription("Region (default: default)").setAutocomplete(true))
      )
      .addSubcommand((s) =>
        s
          .setName("adjust")
          .setDescription("Add/subtract from a stat")
          .addUserOption((o) => o.setName("player").setDescription("Player").setRequired(true))
          .addStringOption((o) =>
            o.setName("stat").setDescription("Stat to adjust").setRequired(true)
              .addChoices(
                { name: "total_wins", value: "totalWins" },
                { name: "total_losses", value: "totalLosses" },
                { name: "tournaments_won", value: "tournamentsWon" },
                { name: "tournaments_played", value: "tournamentsPlayed" },
              )
          )
          .addIntegerOption((o) => o.setName("amount").setDescription("Amount (negative to subtract)").setRequired(true))
          .addStringOption((o) => o.setName("region").setDescription("Region (default: default)").setAutocomplete(true))
      )
      .addSubcommand((s) =>
        s
          .setName("remove")
          .setDescription("Remove player from leaderboard")
          .addUserOption((o) => o.setName("player").setDescription("Player").setRequired(true))
          .addStringOption((o) => o.setName("region").setDescription("Region (default: default)").setAutocomplete(true))
      )
      .addSubcommand((s) =>
        s
          .setName("view")
          .setDescription("View player stats")
          .addUserOption((o) => o.setName("player").setDescription("Player").setRequired(true))
          .addStringOption((o) => o.setName("region").setDescription("Region (default: default)").setAutocomplete(true))
      )
  )
  .addSubcommandGroup((g) =>
    g
      .setName("cooldown")
      .setDescription("Cooldown management")
      .addSubcommand((s) =>
        s
          .setName("cancel")
          .setDescription("Cancel a player's unavoidable cooldown (admin override)")
          .addUserOption((o) => o.setName("player").setDescription("Player").setRequired(true))
      )
      .addSubcommand((s) =>
        s
          .setName("list")
          .setDescription("List active cooldowns")
          .addUserOption((o) => o.setName("player").setDescription("Filter by player"))
      )
  );

// ─── Stat column mapping ───

const statColumns: Record<string, any> = {
  totalWins: leaderboard.totalWins,
  totalLosses: leaderboard.totalLosses,
  tournamentsWon: leaderboard.tournamentsWon,
  tournamentsPlayed: leaderboard.tournamentsPlayed,
  rankPosition: leaderboard.rankPosition,
};

// ─── Leaderboard Subcommands ───

const lbReset = async (i: ChatInputCommandInteraction) => {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("admin_reset_confirm").setLabel("Confirm Reset").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("admin_reset_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  await i.reply({
    embeds: [errorEmbed("⚠️ This will **wipe all rankings** in this server. Are you sure?")],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
};

const lbSet = async (i: ChatInputCommandInteraction) => {
  const player = i.options.getUser("player", true);
  const stat = i.options.getString("stat", true);
  const value = i.options.getInteger("value", true);
  const guildId = i.guildId!;
  const region = i.options.getString("region") ?? "default";

  await ensureOnLeaderboard(guildId, player.id, player.username, region);

  if (stat === "rankPosition") {
    if (value < 1) {
      return i.reply({ embeds: [errorEmbed("Rank must be a positive integer (1 or higher).")], flags: MessageFlags.Ephemeral });
    }
    const occupant = await getPlayerAtRank(guildId, value, region);
    if (occupant && occupant.userId !== player.id) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`admin_rank_displace_${player.id}_${value}_${region}`)
          .setLabel(`Move ${player.username} → #${value}, push others down`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`admin_rank_swap_${player.id}_${occupant.userId}_${region}`)
          .setLabel(`Swap ${player.username} ↔ ${occupant.username}`)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("admin_rank_cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Danger),
      );

      await i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.gold)
            .setTitle("⚠️ Rank Collision")
            .setDescription(
              `**${occupant.username}** is already at Rank #${value}.\n\nHow do you want to handle this?`
            )
            .addFields(
              { name: "Displace", value: `${player.username} takes #${value}, ${occupant.username} and everyone below shift down by 1.`, inline: false },
              { name: "Swap", value: `${player.username} and ${occupant.username} swap positions.`, inline: false },
            ),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await setRankPositionWithDisplacement(guildId, player.id, value, region);
    await i.reply({ embeds: [successEmbed(`Set **rank_position** to **#${value}** for ${player.username}.`)] });
    await triggerRefresh(guildId);
    return;
  }

  await db
    .update(leaderboard)
    .set({ [stat]: value, updatedAt: new Date() })
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, player.id), eq(leaderboard.region, region)));

  await i.reply({ embeds: [successEmbed(`Set **${stat}** to **${value}** for ${player.username}.`)] });
};

const lbAdjust = async (i: ChatInputCommandInteraction) => {
  const player = i.options.getUser("player", true);
  const stat = i.options.getString("stat", true);
  const amount = i.options.getInteger("amount", true);
  const guildId = i.guildId!;
  const region = i.options.getString("region") ?? "default";

  await ensureOnLeaderboard(guildId, player.id, player.username, region);

  const col = statColumns[stat];
  await db
    .update(leaderboard)
    .set({ [stat]: sql`${col} + ${amount}`, updatedAt: new Date() })
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, player.id), eq(leaderboard.region, region)));

  const sign = amount >= 0 ? "+" : "";
  await i.reply({ embeds: [successEmbed(`Adjusted **${stat}** by **${sign}${amount}** for ${player.username}.`)] });
};

const lbRemove = async (i: ChatInputCommandInteraction) => {
  const player = i.options.getUser("player", true);
  const region = i.options.getString("region") ?? "default";
  const guildId = i.guildId!;

  // Strip roles before removing from DB
  const guild = i.guild!;
  const member = await guild.members.fetch(player.id).catch(() => null);
  if (member) {
    const entry = await db.select().from(leaderboard)
      .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, player.id), eq(leaderboard.region, region)))
      .then((r) => r[0]);
    if (entry) {
      // Remove position rank role
      const role = await db.select().from(rankRoles)
        .where(and(eq(rankRoles.guildId, guildId), eq(rankRoles.region, region), eq(rankRoles.position, entry.rankPosition)))
        .then((r) => r[0]);
      if (role) await member.roles.remove(role.roleId).catch(() => {});

      // Remove top10 role
      const cfg = await db.select().from(guildConfig).where(eq(guildConfig.guildId, guildId)).then((r) => r[0]);
      if (cfg?.top10RoleId && entry.rankPosition <= 10) await member.roles.remove(cfg.top10RoleId).catch(() => {});
    }
  }

  await removeFromLeaderboard(guildId, player.id, region);
  await i.reply({ embeds: [successEmbed(`Removed ${player.username} from the leaderboard and stripped roles.`)] });
  await triggerRefresh(guildId);
};

const lbView = async (i: ChatInputCommandInteraction) => {
  const player = i.options.getUser("player", true);
  const region = i.options.getString("region") ?? "default";
  const entry = await db
    .select()
    .from(leaderboard)
    .where(and(eq(leaderboard.guildId, i.guildId!), eq(leaderboard.userId, player.id), eq(leaderboard.region, region)))
    .then((r) => r[0]);

  if (!entry) {
    return i.reply({ embeds: [errorEmbed(`${player.username} is not on the leaderboard.`)], flags: MessageFlags.Ephemeral });
  }

  await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`📋 ${player.username} — Full Stats`)
        .setThumbnail(player.displayAvatarURL())
        .addFields(
          { name: "Rank", value: `#${entry.rankPosition}`, inline: true },
          { name: "Wins", value: `${entry.totalWins}`, inline: true },
          { name: "Losses", value: `${entry.totalLosses}`, inline: true },
          { name: "Tournaments Won", value: `${entry.tournamentsWon}`, inline: true },
          { name: "Tournaments Played", value: `${entry.tournamentsPlayed}`, inline: true },
        ),
    ],
  });
};

// ─── Cooldown Subcommands ───

const cdCancel = async (i: ChatInputCommandInteraction) => {
  const player = i.options.getUser("player", true);
  const voided = await adminVoidCooldown(i.guildId!, player.id, i.user.id);

  if (!voided) {
    return i.reply({ embeds: [errorEmbed(`${player.username} has no active cooldown.`)], flags: MessageFlags.Ephemeral });
  }

  await i.reply({ embeds: [successEmbed(`Cancelled cooldown for ${player.username}.`)] });
};

const cdList = async (i: ChatInputCommandInteraction) => {
  const player = i.options.getUser("player");
  const entries = await getActiveForfeitCooldowns(i.guildId!, player?.id);

  if (!entries.length) {
    return i.reply({
      embeds: [new EmbedBuilder().setColor(COLORS.brand).setDescription("No active forfeit cooldowns.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = entries.map((e) => {
    const expires = `<t:${Math.floor(e.expiresAt.getTime() / 1000)}:R>`;
    return `<@${e.userId}> — **${e.type}** — expires ${expires}\n> ${e.reason}`;
  });

  await i.reply({
    embeds: [new EmbedBuilder().setColor(COLORS.brand).setTitle("⚠️ Active Forfeit Cooldowns").setDescription(lines.join("\n\n"))],
  });
};

// ─── Button Handlers ───

const handleResetConfirm = async (interaction: ButtonInteraction) => {
  await db.delete(leaderboard).where(eq(leaderboard.guildId, interaction.guildId!));
  await interaction.update({ embeds: [successEmbed("Leaderboard has been wiped.")], components: [] });
  await triggerRefresh(interaction.guildId!);
};

const handleResetCancel = async (interaction: ButtonInteraction) => {
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(COLORS.brand).setDescription("Reset cancelled.")],
    components: [],
  });
};

const handleRankDisplace = async (interaction: ButtonInteraction) => {
  // customId: admin_rank_displace_{userId}_{newRank}_{region}
  const parts = interaction.customId.split("_");
  const userId = parts[3];
  const newRank = parseInt(parts[4]);
  const region = parts[5] ?? "default";

  await setRankPositionWithDisplacement(interaction.guildId!, userId, newRank, region);
  await interaction.update({
    embeds: [successEmbed(`Moved <@${userId}> to Rank #${newRank}. Others shifted down.`)],
    components: [],
  });
  await triggerRefresh(interaction.guildId!);
};

const handleRankSwap = async (interaction: ButtonInteraction) => {
  // customId: admin_rank_swap_{userId}_{targetUserId}_{region}
  const parts = interaction.customId.split("_");
  const userId = parts[3];
  const targetUserId = parts[4];
  const region = parts[5] ?? "default";

  await swapRankPositions(interaction.guildId!, userId, targetUserId, region);
  await interaction.update({
    embeds: [successEmbed(`Swapped positions of <@${userId}> and <@${targetUserId}>.`)],
    components: [],
  });
  await triggerRefresh(interaction.guildId!);
};

const handleRankCancel = async (interaction: ButtonInteraction) => {
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(COLORS.brand).setDescription("Rank change cancelled.")],
    components: [],
  });
};

// ─── Router ───

const execute = async (interaction: ChatInputCommandInteraction) => {
  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  if (group === "leaderboard") {
    const handlers: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
      reset: lbReset, set: lbSet, adjust: lbAdjust, remove: lbRemove, view: lbView,
    };
    await handlers[sub]?.(interaction);
    return;
  }

  if (group === "cooldown") {
    const handlers: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
      cancel: cdCancel, list: cdList,
    };
    await handlers[sub]?.(interaction);
  }
};

addCommandData(data.toJSON());
registerCommand("admin", execute);
registerButton("admin_reset_confirm", handleResetConfirm);
registerButton("admin_reset_cancel", handleResetCancel);
registerButton("admin_rank_displace_", handleRankDisplace);
registerButton("admin_rank_swap_", handleRankSwap);
registerButton("admin_rank_cancel", handleRankCancel);
