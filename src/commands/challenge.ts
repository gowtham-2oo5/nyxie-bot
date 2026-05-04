import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { registerCommand, registerButton, registerModal, registerSelectMenu } from "../handlers/interaction";
import { addCommandData } from "../deploy-commands";
import { COLORS, errorEmbed, successEmbed } from "../lib/embeds";
import { db } from "../db";
import { challenges, leaderboard, matchLog, forfeitCooldowns } from "../db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { displaceRank } from "../lib/rank-ops";
import { checkForfeitCooldown, applyForfeitCooldowns, voidForfeitCooldown } from "../lib/forfeit";
import { refreshLeaderboard } from "../lib/leaderboard";
import { isOnLeaderboard, getBottomPlayer } from "../lib/rank-ops";

// ─── Command Definition ───

const data = new SlashCommandBuilder()
  .setName("challenge")
  .setDescription("Ranked 1v1 challenges")
  .addSubcommand((s) =>
    s.setName("player").setDescription("Challenge a ranked player")
      .addUserOption((o) => o.setName("target").setDescription("Player to challenge").setRequired(true))
  )
  .addSubcommand((s) =>
    s.setName("forfeit").setDescription("Forfeit your accepted challenge")
      .addStringOption((o) => o.setName("reason").setDescription("Reason for forfeit").setRequired(true))
  )
  .addSubcommand((s) =>
    s.setName("cancelcd").setDescription("Cancel your voidable forfeit cooldown")
  )
  .addSubcommand((s) =>
    s.setName("result").setDescription("Set challenge winner (Staff only)")
  );

// ─── Helpers ───

const getEntry = (guildId: string, userId: string) =>
  db.select().from(leaderboard)
    .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId)))
    .then((r) => r[0] ?? null);

const getPendingChallenge = (guildId: string, userId: string) =>
  db.select().from(challenges)
    .where(and(
      eq(challenges.guildId, guildId),
      or(eq(challenges.challengerId, userId), eq(challenges.challengedId, userId)),
      or(eq(challenges.status, "pending"), eq(challenges.status, "accepted"))
    ))
    .then((r) => r[0] ?? null);

const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Subcommands ───

const challengePlayer = async (interaction: ChatInputCommandInteraction) => {
  const guildId = interaction.guildId!;
  const target = interaction.options.getUser("target", true);

  if (target.id === interaction.user.id)
    return interaction.reply({ embeds: [errorEmbed("You can't challenge yourself.")], flags: MessageFlags.Ephemeral });

  const cd = await checkForfeitCooldown(guildId, interaction.user.id);
  if (cd && cd.type === "unavoidable")
    return interaction.reply({ embeds: [errorEmbed(`You're on an unavoidable cooldown (${Math.ceil(cd.remaining / 3600)}hr left). Reason: ${cd.reason}`)], flags: MessageFlags.Ephemeral });

  const targetCd = await checkForfeitCooldown(guildId, target.id);
  if (targetCd && targetCd.type === "unavoidable") {
    const hrs = Math.floor(targetCd.remaining / 3600);
    const mins = Math.ceil((targetCd.remaining % 3600) / 60);
    return interaction.reply({ embeds: [errorEmbed(`**${target.username}** is on a **${targetCd.type}** cooldown. Try again in **${hrs}h ${mins}m**.\nReason: ${targetCd.reason}`)], flags: MessageFlags.Ephemeral });
  }

  const challenger = await getEntry(guildId, interaction.user.id);
  const challenged = await getEntry(guildId, target.id);

  if (!challenged)
    return interaction.reply({ embeds: [errorEmbed(`${target.username} is not on the leaderboard.`)], flags: MessageFlags.Ephemeral });

  if (challenger) {
    if (challenged.rankPosition >= challenger.rankPosition)
      return interaction.reply({ embeds: [errorEmbed("You can only challenge players ranked higher than you.")], flags: MessageFlags.Ephemeral });
    if (challenger.rankPosition - challenged.rankPosition > 3)
      return interaction.reply({ embeds: [errorEmbed("You can only challenge players within 3 ranks above you.")], flags: MessageFlags.Ephemeral });
  } else {
    const bottom = await getBottomPlayer(guildId);
    if (!bottom || bottom.userId !== target.id)
      return interaction.reply({ embeds: [errorEmbed("You're not on the leaderboard. You can only challenge the bottom-ranked player to enter.")], flags: MessageFlags.Ephemeral });
  }

  const existing = await getPendingChallenge(guildId, interaction.user.id);
  if (existing)
    return interaction.reply({ embeds: [errorEmbed("You already have an active challenge.")], flags: MessageFlags.Ephemeral });

  const expiresAt = new Date(Date.now() + EXPIRY_MS);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("challenge_accept").setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("challenge_decline").setLabel("Decline").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("challenge_withdraw").setLabel("Withdraw").setStyle(ButtonStyle.Secondary),
  );

  const msg = await interaction.reply({
    embeds: [
      new EmbedBuilder().setColor(COLORS.brand).setTitle("⚔️ Challenge!")
        .setDescription(`<@${interaction.user.id}> (${challenger ? `Rank #${challenger.rankPosition}` : "Unranked"}) challenges <@${target.id}> (Rank #${challenged.rankPosition})!\n\nExpires <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`),
    ],
    components: [row],
    fetchReply: true,
  });

  await db.insert(challenges).values({
    guildId,
    challengerId: interaction.user.id,
    challengerUsername: interaction.user.username,
    challengedId: target.id,
    challengedUsername: target.username,
    challengeMessageId: msg.id,
    channelId: interaction.channelId,
    expiresAt,
  });

  // Expiry — forfeit the challenged player
  setTimeout(async () => {
    const c = await db.select().from(challenges)
      .where(and(eq(challenges.challengeMessageId, msg.id), eq(challenges.status, "pending")))
      .then((r) => r[0]);
    if (!c) return;

    await db.update(challenges).set({
      status: "forfeited",
      forfeitBy: c.challengedId,
      forfeitReason: "No response / Unavailable",
      resolvedAt: new Date(),
    }).where(eq(challenges.id, c.id));

    await applyForfeitCooldowns(c.guildId, c.challengedId, c.challengerId, "No response to challenge (24hr expiry)");

    await db.insert(matchLog).values({
      guildId: c.guildId,
      matchType: "challenge",
      resultType: "forfeit",
      forfeitBy: c.challengedId,
      forfeitReason: "No response / Unavailable",
      contextName: "Challenge Expired",
      contextDetail: `${c.challengerUsername} vs ${c.challengedUsername}`,
    });
  }, EXPIRY_MS);
};

const forfeitChallenge = async (interaction: ChatInputCommandInteraction) => {
  const guildId = interaction.guildId!;
  const reason = interaction.options.getString("reason", true);

  const active = await db.select().from(challenges)
    .where(and(eq(challenges.guildId, guildId), or(eq(challenges.challengerId, interaction.user.id), eq(challenges.challengedId, interaction.user.id)), eq(challenges.status, "accepted")))
    .then((r) => r[0]);

  if (!active)
    return interaction.reply({ embeds: [errorEmbed("You don't have an accepted challenge to forfeit.")], flags: MessageFlags.Ephemeral });

  const otherId = active.challengerId === interaction.user.id ? active.challengedId : active.challengerId;

  await db.update(challenges).set({ status: "forfeited", forfeitBy: interaction.user.id, forfeitReason: reason, resolvedAt: new Date() }).where(eq(challenges.id, active.id));
  await db.insert(matchLog).values({ guildId, matchType: "challenge", resultType: "forfeit", forfeitBy: interaction.user.id, forfeitReason: reason, contextName: "Challenge Match", contextDetail: `${active.challengerUsername} vs ${active.challengedUsername}` });
  await applyForfeitCooldowns(guildId, interaction.user.id, otherId, `Forfeited challenge vs ${otherId === active.challengerId ? active.challengerUsername : active.challengedUsername}`);

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle("🏳️ Challenge Forfeited").setDescription(`**${interaction.user.username}** forfeited.\nReason: ${reason}\n\nBoth players are on 24hr cooldown.`)],
  });
};

const cancelCd = async (interaction: ChatInputCommandInteraction) => {
  const voided = await voidForfeitCooldown(interaction.guildId!, interaction.user.id, interaction.user.id);
  if (!voided)
    return interaction.reply({ embeds: [errorEmbed("No voidable forfeit cooldown to cancel.")], flags: MessageFlags.Ephemeral });
  await interaction.reply({ embeds: [successEmbed("Your forfeit cooldown has been cancelled.")], flags: MessageFlags.Ephemeral });
};

// ─── Result (Staff only) ───

const challengeResult = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return interaction.reply({ embeds: [errorEmbed("Need **Manage Server** permission.")], flags: MessageFlags.Ephemeral });

  const guildId = interaction.guildId!;
  const activeChallenges = await db.select().from(challenges)
    .where(and(eq(challenges.guildId, guildId), eq(challenges.status, "accepted")));

  if (!activeChallenges.length)
    return interaction.reply({ embeds: [errorEmbed("No active (accepted) challenges to resolve.")], flags: MessageFlags.Ephemeral });

  const select = new StringSelectMenuBuilder()
    .setCustomId("challenge_result_select")
    .setPlaceholder("Select a challenge...")
    .addOptions(activeChallenges.slice(0, 25).map((c) => ({
      label: `${c.challengerUsername} vs ${c.challengedUsername}`,
      value: String(c.id),
      description: `ID: ${c.id}`,
    })));

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COLORS.brand).setTitle("⚔️ Set Challenge Result").setDescription("Select the challenge to resolve:")],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
};

// ─── Select Menu: pick challenge → show winner buttons ───

const handleResultSelect = async (interaction: StringSelectMenuInteraction) => {
  const challengeId = parseInt(interaction.values[0]);
  const challenge = await db.select().from(challenges).where(eq(challenges.id, challengeId)).then((r) => r[0]);

  if (!challenge || challenge.status !== "accepted") {
    return interaction.update({ embeds: [errorEmbed("Challenge no longer active.")], components: [] });
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`challenge_result_win_${challenge.id}_${challenge.challengerId}`).setLabel(challenge.challengerUsername).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`challenge_result_win_${challenge.id}_${challenge.challengedId}`).setLabel(challenge.challengedUsername).setStyle(ButtonStyle.Primary),
  );

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(COLORS.gold).setTitle("⚔️ Who won?").setDescription(`**${challenge.challengerUsername}** vs **${challenge.challengedUsername}**`)],
    components: [row],
  });
};

// ─── Button: staff picks winner ───

// ─── Button: staff picks winner → show score modal ───

const handleResultWin = async (interaction: ButtonInteraction) => {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return interaction.reply({ embeds: [errorEmbed("Need **Manage Server** permission.")], flags: MessageFlags.Ephemeral });

  // customId: challenge_result_win_{challengeId}_{winnerId}
  const modal = new ModalBuilder()
    .setCustomId(`challenge_result_modal_${interaction.customId.replace("challenge_result_win_", "")}`)
    .setTitle("Challenge Result")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("winner_score").setLabel("Winner's score (e.g. 5)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("loser_score").setLabel("Loser's score (e.g. 3)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("winner_cd").setLabel("Winner CD (none/v/u)").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("v")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("loser_cd").setLabel("Loser CD (none/v/u)").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("u")
      ),
    );

  await interaction.showModal(modal);
};

// ─── Modal: process result with score + cooldowns ───

const handleResultModal = async (interaction: ModalSubmitInteraction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // customId: challenge_result_modal_{challengeId}_{winnerId}
  const payload = interaction.customId.replace("challenge_result_modal_", "");
  const [challengeIdStr, winnerId] = payload.split("_");
  const challengeId = parseInt(challengeIdStr);

  const winnerScore = interaction.fields.getTextInputValue("winner_score");
  const loserScore = interaction.fields.getTextInputValue("loser_score");
  const winnerCdRaw = interaction.fields.getTextInputValue("winner_cd")?.toLowerCase().trim() || "v";
  const loserCdRaw = interaction.fields.getTextInputValue("loser_cd")?.toLowerCase().trim() || "u";

  // Normalize: accept shortcuts
  const normalizeCd = (v: string) => {
    if (v === "v" || v.startsWith("void")) return "voidable";
    if (v === "u" || v.startsWith("unavoid")) return "unavoidable";
    return "none";
  };
  const winnerCd = normalizeCd(winnerCdRaw);
  const loserCd = normalizeCd(loserCdRaw);

  const challenge = await db.select().from(challenges).where(eq(challenges.id, challengeId)).then((r) => r[0]);
  if (!challenge || challenge.status !== "accepted")
    return interaction.editReply({ embeds: [errorEmbed("Challenge no longer active.")] });

  const loserId = winnerId === challenge.challengerId ? challenge.challengedId : challenge.challengerId;
  const winnerName = winnerId === challenge.challengerId ? challenge.challengerUsername : challenge.challengedUsername;
  const loserName = winnerId === challenge.challengerId ? challenge.challengedUsername : challenge.challengerUsername;

  await db.update(challenges).set({ status: "completed", winnerId, resolvedAt: new Date() }).where(eq(challenges.id, challenge.id));

  await displaceRank(challenge.guildId, winnerId, winnerName, loserId, loserName);

  await db.update(leaderboard)
    .set({ totalWins: sql`${leaderboard.totalWins} + 1`, updatedAt: new Date() })
    .where(and(eq(leaderboard.guildId, challenge.guildId), eq(leaderboard.userId, winnerId)));
  await db.update(leaderboard)
    .set({ totalLosses: sql`${leaderboard.totalLosses} + 1`, updatedAt: new Date() })
    .where(and(eq(leaderboard.guildId, challenge.guildId), eq(leaderboard.userId, loserId)));

  // Apply cooldowns based on staff input
  const applyCd = async (userId: string, type: string) => {
    if (type === "none") return;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(forfeitCooldowns).values({
      guildId: challenge.guildId, userId, type, reason: `Set by staff after challenge: ${challenge.challengerUsername} vs ${challenge.challengedUsername}`, expiresAt,
    });
  };
  await applyCd(winnerId, winnerCd);
  await applyCd(loserId, loserCd);

  await db.insert(matchLog).values({
    guildId: challenge.guildId, matchType: "challenge", resultType: "normal",
    winnerId, winnerUsername: winnerName, loserId, loserUsername: loserName,
    contextName: "Challenge Match", contextDetail: `${winnerName} ${winnerScore} - ${loserScore} ${loserName}`,
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(COLORS.success).setTitle("⚔️ Challenge Complete!")
      .setDescription(`🏆 **${winnerName}** defeated **${loserName}** (${winnerScore}-${loserScore})\n\nRanks updated.${winnerCd !== "none" ? `\n${winnerName}: ${winnerCd} CD` : ""}${loserCd !== "none" ? `\n${loserName}: ${loserCd} CD` : ""}`)],
  });

  const { client } = await import("../index");
  await refreshLeaderboard(client, challenge.guildId);
};

// ─── Button Handlers ───

const handleAccept = async (interaction: ButtonInteraction) => {
  const challenge = await db.select().from(challenges)
    .where(and(eq(challenges.challengeMessageId, interaction.message.id), eq(challenges.status, "pending")))
    .then((r) => r[0]);

  if (!challenge)
    return interaction.reply({ embeds: [errorEmbed("This challenge is no longer active.")], flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== challenge.challengedId)
    return interaction.reply({ embeds: [errorEmbed("Only the challenged player can accept.")], flags: MessageFlags.Ephemeral });

  const cd = await checkForfeitCooldown(challenge.guildId, interaction.user.id);
  if (cd && cd.type === "unavoidable")
    return interaction.reply({ embeds: [errorEmbed(`You're on an unavoidable cooldown (${Math.ceil(cd.remaining / 3600)}hr left).`)], flags: MessageFlags.Ephemeral });

  await db.update(challenges).set({ status: "accepted" }).where(eq(challenges.id, challenge.id));

  await interaction.update({
    embeds: [
      new EmbedBuilder().setColor(COLORS.gold).setTitle("⚔️ Challenge Accepted!")
        .setDescription(`**${challenge.challengerUsername}** vs **${challenge.challengedUsername}**\n\nA staff member will set the result using \`/challenge result\`.`),
    ],
    components: [],
  });
};

const handleDecline = async (interaction: ButtonInteraction) => {
  const challenge = await db.select().from(challenges)
    .where(and(eq(challenges.challengeMessageId, interaction.message.id), eq(challenges.status, "pending")))
    .then((r) => r[0]);

  if (!challenge)
    return interaction.reply({ embeds: [errorEmbed("This challenge is no longer active.")], flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== challenge.challengedId)
    return interaction.reply({ embeds: [errorEmbed("Only the challenged player can decline.")], flags: MessageFlags.Ephemeral });

  const modal = new ModalBuilder()
    .setCustomId(`challenge_decline_modal_${interaction.message.id}`)
    .setTitle("Decline Challenge")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("reason").setLabel("Reason for declining").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)
      )
    );
  await interaction.showModal(modal);
};

const handleWithdraw = async (interaction: ButtonInteraction) => {
  const challenge = await db.select().from(challenges)
    .where(and(eq(challenges.challengeMessageId, interaction.message.id), eq(challenges.status, "pending")))
    .then((r) => r[0]);

  if (!challenge)
    return interaction.reply({ embeds: [errorEmbed("This challenge is no longer active.")], flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== challenge.challengerId)
    return interaction.reply({ embeds: [errorEmbed("Only the challenger can withdraw.")], flags: MessageFlags.Ephemeral });

  await db.update(challenges).set({ status: "declined", resolvedAt: new Date() }).where(eq(challenges.id, challenge.id));

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(COLORS.error).setDescription(`${challenge.challengerUsername} withdrew the challenge.`)],
    components: [],
  });
};

// ─── Modal: decline reason ───

const handleDeclineModal = async (interaction: ModalSubmitInteraction) => {
  const messageId = interaction.customId.replace("challenge_decline_modal_", "");
  const reason = interaction.fields.getTextInputValue("reason");

  const challenge = await db.select().from(challenges)
    .where(and(eq(challenges.challengeMessageId, messageId), eq(challenges.status, "pending")))
    .then((r) => r[0]);

  if (!challenge)
    return interaction.reply({ embeds: [errorEmbed("This challenge is no longer active.")], flags: MessageFlags.Ephemeral });

  await db.update(challenges).set({ status: "declined", resolvedAt: new Date() }).where(eq(challenges.id, challenge.id));

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(COLORS.error).setDescription(`${challenge.challengedUsername} declined the challenge.\n**Reason:** ${reason}`)],
    components: [],
  });
};

// ─── Router ───

const subcommands: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
  player: challengePlayer,
  forfeit: forfeitChallenge,
  cancelcd: cancelCd,
  result: challengeResult,
};

const execute = async (interaction: ChatInputCommandInteraction) => {
  const sub = interaction.options.getSubcommand();
  await subcommands[sub]?.(interaction);
};

addCommandData(data.toJSON());
registerCommand("challenge", execute);
registerButton("challenge_accept", handleAccept);
registerButton("challenge_decline", handleDecline);
registerButton("challenge_withdraw", handleWithdraw);
registerButton("challenge_result_win_", handleResultWin);
registerSelectMenu("challenge_result_select", handleResultSelect);
registerModal("challenge_decline_modal_", handleDeclineModal);
registerModal("challenge_result_modal_", handleResultModal);
