import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction,
} from "discord.js";
import { registerCommand } from "../handlers/interaction";
import { addCommandData } from "../deploy-commands";
import { COLORS, errorEmbed, successEmbed } from "../lib/embeds";
import { db } from "../db";
import { guildConfig, cooldownConfig, cooldownRankPenalty, rankRoles } from "../db/schema";
import { eq, and } from "drizzle-orm";

// ─── Command Definition ───

const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Server configuration")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommandGroup((g) =>
    g
      .setName("cooldown")
      .setDescription("Manage cooldowns")
      .addSubcommand((s) =>
        s
          .setName("set")
          .setDescription("Set command cooldown")
          .addStringOption((o) => o.setName("command").setDescription("Command name").setRequired(true))
          .addIntegerOption((o) => o.setName("seconds").setDescription("Cooldown in seconds (1-600)").setRequired(true).setMinValue(1).setMaxValue(600))
      )
      .addSubcommand((s) =>
        s
          .setName("reset")
          .setDescription("Reset cooldown to default")
          .addStringOption((o) => o.setName("command").setDescription("Command name or 'all'").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("list").setDescription("Show all cooldown settings")
      )
      .addSubcommand((s) =>
        s
          .setName("rank-penalty")
          .setDescription("Set cooldown multiplier for top-ranked players")
          .addIntegerOption((o) => o.setName("top_n").setDescription("Top N ranks affected").setRequired(true).setMinValue(1))
          .addNumberOption((o) => o.setName("multiplier").setDescription("Cooldown multiplier").setRequired(true).setMinValue(1))
      )
  )
  .addSubcommandGroup((g) =>
    g
      .setName("role")
      .setDescription("Manage rank roles")
      .addSubcommand((s) =>
        s
          .setName("add")
          .setDescription("Add a rank role")
          .addIntegerOption((o) => o.setName("position").setDescription("Rank position").setRequired(true).setMinValue(1))
          .addStringOption((o) => o.setName("label").setDescription("Display label").setRequired(true))
          .addRoleOption((o) => o.setName("role").setDescription("Discord role to assign (optional)"))
          .addStringOption((o) => o.setName("region").setDescription("Region (default: default)").setAutocomplete(true))
      )
      .addSubcommand((s) =>
        s
          .setName("remove")
          .setDescription("Remove a rank role")
          .addRoleOption((o) => o.setName("role").setDescription("Role to remove").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("list").setDescription("List rank roles")
      )
  )
  .addSubcommand((s) =>
    s
      .setName("leaderboard")
      .setDescription("Set leaderboard channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel for auto-updating leaderboard").setRequired(true).addChannelTypes(ChannelType.GuildText)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("top10role")
      .setDescription("Set top 10 role")
      .addRoleOption((o) => o.setName("role").setDescription("Role for top 10").setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName("prefix")
      .setDescription("Change text command prefix")
      .addStringOption((o) => o.setName("prefix").setDescription("New prefix (max 5 chars)").setRequired(true).setMaxLength(5))
  )
  .addSubcommand((s) =>
    s.setName("status").setDescription("Show server config")
  )
  .addSubcommand((s) =>
    s
      .setName("leaderboard-size")
      .setDescription("Set max leaderboard size")
      .addIntegerOption((o) => o.setName("size").setDescription("Max players on leaderboard").setRequired(true).setMinValue(2).setMaxValue(100))
  );

// ─── Helpers ───

const ensureConfig = async (guildId: string) => {
  const existing = await db
    .select()
    .from(guildConfig)
    .where(eq(guildConfig.guildId, guildId))
    .then((r) => r[0]);

  if (existing) return existing;

  await db.insert(guildConfig).values({ guildId });
  return db.select().from(guildConfig).where(eq(guildConfig.guildId, guildId)).then((r) => r[0]!);
};

// ─── Subcommands ───

const setLeaderboard = async (i: ChatInputCommandInteraction) => {
  const channel = i.options.getChannel("channel", true);
  const cfg = await ensureConfig(i.guildId!);

  await db
    .update(guildConfig)
    .set({ leaderboardChannelId: channel.id, updatedAt: new Date() })
    .where(eq(guildConfig.id, cfg.id));

  await i.reply({ embeds: [successEmbed(`Leaderboard channel set to ${channel}.`)] });
};

const setTop10Role = async (i: ChatInputCommandInteraction) => {
  const role = i.options.getRole("role", true);
  const cfg = await ensureConfig(i.guildId!);

  await db
    .update(guildConfig)
    .set({ top10RoleId: role.id, updatedAt: new Date() })
    .where(eq(guildConfig.id, cfg.id));

  await i.reply({ embeds: [successEmbed(`Top 10 role set to ${role}.`)] });
};

const setPrefix = async (i: ChatInputCommandInteraction) => {
  const prefix = i.options.getString("prefix", true);
  const cfg = await ensureConfig(i.guildId!);

  await db
    .update(guildConfig)
    .set({ prefix, updatedAt: new Date() })
    .where(eq(guildConfig.id, cfg.id));

  await i.reply({ embeds: [successEmbed(`Prefix set to \`${prefix}\`.`)] });
};

const setLeaderboardSize = async (i: ChatInputCommandInteraction) => {
  const size = i.options.getInteger("size", true);
  const cfg = await ensureConfig(i.guildId!);

  await db
    .update(guildConfig)
    .set({ leaderboardSize: size, updatedAt: new Date() })
    .where(eq(guildConfig.id, cfg.id));

  await i.reply({ embeds: [successEmbed(`Leaderboard size set to **${size}** players.`)] });
};

const showStatus = async (i: ChatInputCommandInteraction) => {
  const cfg = await ensureConfig(i.guildId!);
  const roles = await db.select().from(rankRoles).where(eq(rankRoles.guildId, i.guildId!));
  const cds = await db.select().from(cooldownConfig).where(eq(cooldownConfig.guildId, i.guildId!));
  const penalty = await db.select().from(cooldownRankPenalty).where(eq(cooldownRankPenalty.guildId, i.guildId!)).then((r) => r[0]);

  await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle("⚙️ Server Config")
        .addFields(
          { name: "Prefix", value: `\`${cfg.prefix}\``, inline: true },
          { name: "Leaderboard Channel", value: cfg.leaderboardChannelId ? `<#${cfg.leaderboardChannelId}>` : "Not set", inline: true },
          { name: "Top 10 Role", value: cfg.top10RoleId ? `<@&${cfg.top10RoleId}>` : "Not set", inline: true },
          { name: "Rank Roles", value: roles.length ? roles.map((r) => `\`#${r.position}\` <@&${r.roleId}> — ${r.label}`).join("\n") : "None" },
          { name: "Cooldowns", value: cds.length ? cds.map((c) => `\`${c.commandName}\`: ${c.baseSeconds}s`).join("\n") : "All default" },
          { name: "Rank Penalty", value: penalty ? `Top ${penalty.topRankThreshold} → ${penalty.multiplier}x cooldown` : "None" },
        ),
    ],
  });
};

// Cooldown subcommands
const cooldownSet = async (i: ChatInputCommandInteraction) => {
  const cmd = i.options.getString("command", true);
  const seconds = i.options.getInteger("seconds", true);
  const guildId = i.guildId!;

  const existing = await db
    .select()
    .from(cooldownConfig)
    .where(and(eq(cooldownConfig.guildId, guildId), eq(cooldownConfig.commandName, cmd)))
    .then((r) => r[0]);

  if (existing) {
    await db.update(cooldownConfig).set({ baseSeconds: seconds, updatedAt: new Date() }).where(eq(cooldownConfig.id, existing.id));
  } else {
    await db.insert(cooldownConfig).values({ guildId, commandName: cmd, baseSeconds: seconds });
  }

  await i.reply({ embeds: [successEmbed(`Cooldown for \`${cmd}\` set to ${seconds}s.`)] });
};

const cooldownReset = async (i: ChatInputCommandInteraction) => {
  const cmd = i.options.getString("command", true);
  const guildId = i.guildId!;

  if (cmd === "all") {
    await db.delete(cooldownConfig).where(eq(cooldownConfig.guildId, guildId));
    await i.reply({ embeds: [successEmbed("All cooldowns reset to defaults.")] });
  } else {
    await db.delete(cooldownConfig).where(and(eq(cooldownConfig.guildId, guildId), eq(cooldownConfig.commandName, cmd)));
    await i.reply({ embeds: [successEmbed(`Cooldown for \`${cmd}\` reset to default.`)] });
  }
};

const cooldownList = async (i: ChatInputCommandInteraction) => {
  const cds = await db.select().from(cooldownConfig).where(eq(cooldownConfig.guildId, i.guildId!));

  if (!cds.length) {
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.brand).setDescription("All cooldowns are at defaults.")] });
  }

  const lines = cds.map((c) => `\`${c.commandName}\`: ${c.baseSeconds}s`);
  await i.reply({
    embeds: [new EmbedBuilder().setColor(COLORS.brand).setTitle("⏱️ Cooldown Overrides").setDescription(lines.join("\n"))],
  });
};

const cooldownRankPenaltySet = async (i: ChatInputCommandInteraction) => {
  const topN = i.options.getInteger("top_n", true);
  const mult = i.options.getNumber("multiplier", true);
  const guildId = i.guildId!;

  const existing = await db.select().from(cooldownRankPenalty).where(eq(cooldownRankPenalty.guildId, guildId)).then((r) => r[0]);

  if (existing) {
    await db.update(cooldownRankPenalty).set({ topRankThreshold: topN, multiplier: String(mult), updatedAt: new Date() }).where(eq(cooldownRankPenalty.id, existing.id));
  } else {
    await db.insert(cooldownRankPenalty).values({ guildId, topRankThreshold: topN, multiplier: String(mult) });
  }

  await i.reply({ embeds: [successEmbed(`Top ${topN} players now get ${mult}x cooldown.`)] });
};

// Role subcommands
const roleAdd = async (i: ChatInputCommandInteraction) => {
  const role = i.options.getRole("role");
  const position = i.options.getInteger("position", true);
  const label = i.options.getString("label", true);
  const region = i.options.getString("region") ?? "default";
  const guildId = i.guildId!;
  const roleId = role?.id ?? "";

  const existing = await db
    .select()
    .from(rankRoles)
    .where(and(eq(rankRoles.guildId, guildId), eq(rankRoles.position, position), eq(rankRoles.region, region)))
    .then((r) => r[0]);

  if (existing) {
    await db.update(rankRoles).set({ roleId, label, region }).where(eq(rankRoles.id, existing.id));
  } else {
    await db.insert(rankRoles).values({ guildId, roleId, label, position, region });
  }

  const regionLabel = region === "default" ? "" : ` [${region}]`;
  const roleDisplay = role ? `${role} → ` : "";
  await i.reply({ embeds: [successEmbed(`${roleDisplay}**${label}** (Position #${position})${regionLabel}`)] });
};

const roleRemove = async (i: ChatInputCommandInteraction) => {
  const role = i.options.getRole("role", true);
  await db.delete(rankRoles).where(and(eq(rankRoles.guildId, i.guildId!), eq(rankRoles.roleId, role.id)));
  await i.reply({ embeds: [successEmbed(`Rank role ${role} removed.`)] });
};

const roleList = async (i: ChatInputCommandInteraction) => {
  const roles = await db.select().from(rankRoles).where(eq(rankRoles.guildId, i.guildId!));

  if (!roles.length) {
    return i.reply({ embeds: [new EmbedBuilder().setColor(COLORS.brand).setDescription("No rank roles configured.")] });
  }

  const lines = roles.map((r) => `\`#${r.position}\` <@&${r.roleId}> — **${r.label}**`);
  await i.reply({
    embeds: [new EmbedBuilder().setColor(COLORS.brand).setTitle("🏷️ Rank Roles").setDescription(lines.join("\n"))],
  });
};

// ─── Router ───

const execute = async (interaction: ChatInputCommandInteraction) => {
  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  if (group === "cooldown") {
    const handlers: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
      set: cooldownSet,
      reset: cooldownReset,
      list: cooldownList,
      "rank-penalty": cooldownRankPenaltySet,
    };
    await handlers[sub]?.(interaction);
    return;
  }

  if (group === "role") {
    const handlers: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
      add: roleAdd,
      remove: roleRemove,
      list: roleList,
    };
    await handlers[sub]?.(interaction);
    return;
  }

  const handlers: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
    leaderboard: setLeaderboard,
    top10role: setTop10Role,
    prefix: setPrefix,
    status: showStatus,
    "leaderboard-size": setLeaderboardSize,
  };
  await handlers[sub]?.(interaction);
};

addCommandData(data.toJSON());
registerCommand("setup", execute);
