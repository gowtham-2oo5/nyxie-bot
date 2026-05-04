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
import { matchLog } from "../db/schema";
import { eq, and, or, desc } from "drizzle-orm";

const PAGE_SIZE = 10;

const data = new SlashCommandBuilder()
  .setName("history")
  .setDescription("Match history")
  .addIntegerOption((o) =>
    o.setName("page").setDescription("Page number").setMinValue(1)
  )
  .addUserOption((o) =>
    o.setName("player").setDescription("Filter by player")
  );

const execute = async (interaction: ChatInputCommandInteraction) => {
  const guildId = interaction.guildId!;
  const page = interaction.options.getInteger("page") ?? 1;
  const player = interaction.options.getUser("player");
  const offset = (page - 1) * PAGE_SIZE;

  const conditions = [eq(matchLog.guildId, guildId)];

  if (player) {
    conditions.push(
      or(
        eq(matchLog.winnerId, player.id),
        eq(matchLog.loserId, player.id),
        eq(matchLog.forfeitBy, player.id)
      )!
    );
  }

  const entries = await db
    .select()
    .from(matchLog)
    .where(and(...conditions))
    .orderBy(desc(matchLog.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  if (!entries.length) {
    return interaction.reply({
      embeds: [errorEmbed(page === 1 ? "No match history." : "No entries on this page.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = entries.map((e) => {
    const ts = e.createdAt ? `<t:${Math.floor(e.createdAt.getTime() / 1000)}:R>` : "?";
    const type = e.matchType === "tournament" ? "🏆" : "⚔️";

    if (e.resultType === "forfeit") {
      return `${type} 🏳️ **FF** — ${e.contextName} ${ts}\n> ${e.forfeitReason ?? "No reason"}`;
    }

    return `${type} **${e.winnerUsername}** beat **${e.loserUsername}** ${ts}\n> ${e.contextName}${e.contextDetail ? ` — ${e.contextDetail}` : ""}`;
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`📜 Match History${player ? ` — ${player.username}` : ""}`)
        .setDescription(lines.join("\n\n"))
        .setFooter({ text: `Page ${page}` }),
    ],
  });
};

addCommandData(data.toJSON());
registerCommand("history", execute);
