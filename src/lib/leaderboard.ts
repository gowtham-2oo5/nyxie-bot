import { type Client, EmbedBuilder } from "discord.js";
import { db } from "../db";
import { leaderboard, guildConfig, rankRoles, regionChannels } from "../db/schema";
import { eq, and, asc } from "drizzle-orm";
import { COLORS } from "./embeds";
import { pushLeaderboardUpdate } from "./ws";

export const syncRankRoles = async (client: Client, guildId: string) => {
  const roles = await db.select().from(rankRoles).where(eq(rankRoles.guildId, guildId));
  if (!roles.length) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const entries = await db
    .select()
    .from(leaderboard)
    .where(eq(leaderboard.guildId, guildId))
    .orderBy(asc(leaderboard.rankPosition));

  for (const entry of entries) {
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!member) continue;

    for (const role of roles) {
      const shouldHave = entry.rankPosition === role.position && entry.region === role.region;
      const hasRole = member.roles.cache.has(role.roleId);

      if (shouldHave && !hasRole) {
        await member.roles.add(role.roleId).catch(() => {});
      } else if (!shouldHave && hasRole) {
        await member.roles.remove(role.roleId).catch(() => {});
      }
    }
  }
};

export const syncTop10Role = async (client: Client, guildId: string) => {
  const cfg = await db
    .select()
    .from(guildConfig)
    .where(eq(guildConfig.guildId, guildId))
    .then((r) => r[0]);

  if (!cfg?.top10RoleId) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const entries = await db
    .select()
    .from(leaderboard)
    .where(eq(leaderboard.guildId, guildId))
    .orderBy(asc(leaderboard.rankPosition));

  const top10Ids = new Set(entries.filter((e) => e.rankPosition <= 10).map((e) => e.userId));

  for (const entry of entries) {
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!member) continue;

    const shouldHave = top10Ids.has(entry.userId);
    const hasRole = member.roles.cache.has(cfg.top10RoleId);

    if (shouldHave && !hasRole) {
      await member.roles.add(cfg.top10RoleId).catch(() => {});
    } else if (!shouldHave && hasRole) {
      await member.roles.remove(cfg.top10RoleId).catch(() => {});
    }
  }
};

// ─── Leaderboard Display ───

const buildLeaderboardEmbed = (
  guildName: string,
  region: string,
  entries: (typeof leaderboard.$inferSelect)[],
  roles: (typeof rankRoles.$inferSelect)[],
  lbSize: number
) => {
  const regionLabel = region === "default" ? "" : ` - ${region.toUpperCase()} Region`;
  const title = `${guildName}${regionLabel}`;

  const lines: string[] = [];

  for (let pos = 1; pos <= lbSize; pos++) {
    const entry = entries.find((e) => e.rankPosition === pos);
    const role = roles.find((r) => r.position === pos);
    const roleMention = role ? (role.roleId ? `<@&${role.roleId}>` : `**${role.label}**`) : `#${pos}`;
    const userMention = entry ? `<@${entry.userId}>` : "VACANT";
    lines.push(`**${pos}.** ${roleMention} : ${userMention}`);
  }

  return new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .setTimestamp();
};

// ─── Refresh ───

export const refreshLeaderboard = async (client: Client, guildId: string) => {
  await syncRankRoles(client, guildId);
  await syncTop10Role(client, guildId);

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const cfg = await db.select().from(guildConfig).where(eq(guildConfig.guildId, guildId)).then((r) => r[0]);
  const lbSize = cfg?.leaderboardSize ?? 8;

  const allEntries = await db.select().from(leaderboard)
    .where(eq(leaderboard.guildId, guildId))
    .orderBy(asc(leaderboard.rankPosition));
  const allRoles = await db.select().from(rankRoles).where(eq(rankRoles.guildId, guildId));
  const allRegionChannels = await db.select().from(regionChannels).where(eq(regionChannels.guildId, guildId));

  // Get all regions (from entries + region_channels)
  const regions = [...new Set([
    ...allEntries.map((e) => e.region),
    ...allRegionChannels.map((rc) => rc.region),
  ])];

  for (const region of regions) {
    const rc = allRegionChannels.find((r) => r.region === region);
    // Fall back to guild_config channel for "default" region
    const channelId = rc?.channelId ?? (region === "default" ? cfg?.leaderboardChannelId : null);
    if (!channelId) continue;

    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) continue;

    const entries = allEntries.filter((e) => e.region === region);
    const roles = allRoles.filter((r) => r.region === region);
    const title = cfg?.leaderboardTitle ?? guild.name;
    const embed = buildLeaderboardEmbed(title, region, entries, roles, lbSize);

    const messageId = rc?.messageId ?? (region === "default" ? cfg?.leaderboardMessageId : null);

    try {
      if (messageId) {
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (msg) { await msg.edit({ embeds: [embed] }); continue; }
      }

      const sent = await channel.send({ embeds: [embed] });

      // Save message ID
      if (rc) {
        await db.update(regionChannels).set({ messageId: sent.id, updatedAt: new Date() }).where(eq(regionChannels.id, rc.id));
      } else if (region === "default" && cfg) {
        await db.update(guildConfig).set({ leaderboardMessageId: sent.id, updatedAt: new Date() }).where(eq(guildConfig.id, cfg.id));
      }
    } catch (e) { console.error("❌ Leaderboard refresh error:", e); }
  }

  // Push to WS subscribers
  await pushLeaderboardUpdate(guildId);
};
