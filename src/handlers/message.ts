import {
  type Message,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { getPrefix } from "../lib/prefix-cache";
import { COLORS, errorEmbed, successEmbed } from "../lib/embeds";
import { db } from "../db";
import {
  tournaments, participants, matches, leaderboard, matchLog,
  challenges, guildConfig, cooldownConfig, cooldownRankPenalty, rankRoles, regionChannels,
} from "../db/schema";
import { eq, and, or, desc, asc, sql } from "drizzle-orm";
import {
  calculateTotalRounds, generateFirstRound, buildBracketDisplay, advanceRound,
} from "../lib/bracket";
import { ensureOnLeaderboard, displaceRank, setRankPosition, isOnLeaderboard, removeFromLeaderboard, getLeaderboardSize } from "../lib/rank-ops";
import { refreshLeaderboard } from "../lib/leaderboard";
import { checkForfeitCooldown, applyForfeitCooldowns, voidForfeitCooldown, getActiveForfeitCooldowns } from "../lib/forfeit";
import { getPresenceData, formatActivity, formatStatus } from "../lib/presence";
import { invalidatePrefixCache } from "../lib/prefix-cache";

import { chat } from "../lib/chat";
import { addServerContext, removeServerContext, listServerContext } from "../lib/memory";

const NYXIE_ADMINS = new Set(["979259360733696040", "750971711314329681"]); // gowtham & wen

// ─── Alias map ───

export const ALIASES: Record<string, string> = {
  t: "tournament",
  m: "match",
  c: "challenge",
  lb: "leaderboard",
  r: "rank",
  p: "profile",
  sv: "server",
  h: "history",
};

// ─── Helpers ───

const reply = (msg: Message, embed: EmbedBuilder) =>
  msg.reply({ embeds: [embed] });

const err = (msg: Message, text: string) => reply(msg, errorEmbed(text));
const ok = (msg: Message, text: string) => reply(msg, successEmbed(text));

const isAdmin = (msg: Message) =>
  msg.member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false;

export const parseMention = (str: string): string | null => {
  const match = str.match(/^<@!?(\d+)>$/);
  return match?.[1] ?? (str.match(/^\d+$/) ? str : null);
};

const getActiveTournament = (guildId: string) =>
  db.select().from(tournaments)
    .where(and(eq(tournaments.guildId, guildId), or(eq(tournaments.status, "pending"), eq(tournaments.status, "active"))))
    .then((r) => r[0] ?? null);

// ─── Command Handlers ───

const handlers: Record<string, (msg: Message, args: string[]) => Promise<void>> = {

  // ─── Tournament ───
  async tournament(msg, args) {
    const sub = args[0];
    const guildId = msg.guildId!;

    if (sub === "create") {
      const name = args.slice(1).join(" ");
      if (!name) return err(msg, "Usage: `!tournament create <name>`");
      const existing = await getActiveTournament(guildId);
      if (existing) return err(msg, `Tournament already ${existing.status}: **${existing.name}**`);
      const [result] = await db.insert(tournaments).values({ guildId, name, createdBy: msg.author.id }).$returningId();
      await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle(`🏆 Tournament Created: ${name}`).setDescription("Use `!t join` to participate!"));
    }
    else if (sub === "join") {
      const t = await getActiveTournament(guildId);
      if (!t || t.status !== "pending") return err(msg, "No pending tournament.");
      const exists = await db.select().from(participants).where(and(eq(participants.tournamentId, t.id), eq(participants.userId, msg.author.id))).then((r) => r[0]);
      if (exists) return err(msg, "Already joined.");
      await db.insert(participants).values({ tournamentId: t.id, userId: msg.author.id, username: msg.author.username });
      const count = await db.select({ c: sql<number>`COUNT(*)` }).from(participants).where(eq(participants.tournamentId, t.id)).then((r) => r[0].c);
      await ok(msg, `**${msg.author.username}** joined **${t.name}**! (${count} players)`);
    }
    else if (sub === "leave") {
      const t = await getActiveTournament(guildId);
      if (!t || t.status !== "pending") return err(msg, "No pending tournament.");
      const entry = await db.select().from(participants).where(and(eq(participants.tournamentId, t.id), eq(participants.userId, msg.author.id))).then((r) => r[0]);
      if (!entry) return err(msg, "You're not in this tournament.");
      await db.delete(participants).where(eq(participants.id, entry.id));
      await ok(msg, `**${msg.author.username}** left **${t.name}**.`);
    }
    else if (sub === "start") {
      if (!isAdmin(msg)) return err(msg, "Need **Manage Server** permission.");
      const t = await getActiveTournament(guildId);
      if (!t || t.status !== "pending") return err(msg, "No pending tournament.");
      const players = await db.select().from(participants).where(eq(participants.tournamentId, t.id));
      if (players.length < 2) return err(msg, "Need at least 2 participants.");
      const totalRounds = calculateTotalRounds(players.length);
      await db.update(tournaments).set({ status: "active", totalRounds, updatedAt: new Date() }).where(eq(tournaments.id, t.id));
      await generateFirstRound(t.id, players.map((p) => p.id));
      await reply(msg, new EmbedBuilder().setColor(COLORS.gold).setTitle(`⚔️ ${t.name} has started!`).setDescription(`**${players.length}** players • **${totalRounds}** rounds`));
    }
    else if (sub === "end") {
      if (!isAdmin(msg)) return err(msg, "Need **Manage Server** permission.");
      const t = await getActiveTournament(guildId);
      if (!t) return err(msg, "No active tournament.");
      await db.update(tournaments).set({ status: "cancelled", updatedAt: new Date() }).where(eq(tournaments.id, t.id));
      await reply(msg, new EmbedBuilder().setColor(COLORS.error).setTitle(`❌ ${t.name} cancelled.`));
    }
    else if (sub === "status") {
      const t = await getActiveTournament(guildId);
      if (!t) return err(msg, "No active tournament.");
      const players = await db.select().from(participants).where(eq(participants.tournamentId, t.id));
      await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle(`🏆 ${t.name}`)
        .addFields(
          { name: "Status", value: t.status, inline: true },
          { name: "Players", value: `${players.length}`, inline: true },
          { name: "Round", value: `${t.currentRound} / ${t.totalRounds || "—"}`, inline: true },
        ));
    }
    else if (sub === "bracket") {
      const t = await getActiveTournament(guildId);
      if (!t || t.status !== "active") return err(msg, "No active tournament with a bracket.");
      const [allMatches, players] = await Promise.all([
        db.select().from(matches).where(eq(matches.tournamentId, t.id)),
        db.select().from(participants).where(eq(participants.tournamentId, t.id)),
      ]);
      const playerMap = new Map(players.map((p) => [p.id, p.username]));
      await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle(`📊 ${t.name} — Bracket`).setDescription(buildBracketDisplay(allMatches, playerMap) || "No matches."));
    }
    else if (sub === "list") {
      const recent = await db.select().from(tournaments).where(eq(tournaments.guildId, guildId)).orderBy(desc(tournaments.createdAt)).limit(10);
      if (!recent.length) return err(msg, "No tournaments found.");
      const lines = recent.map((t) => `\`#${t.id}\` **${t.name}** — ${t.status}`);
      await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle("📋 Recent Tournaments").setDescription(lines.join("\n")));
    }
    else {
      await err(msg, "Usage: `!tournament <create|join|leave|start|end|status|bracket|list>`");
    }
  },

  // ─── Match ───
  async match(msg, args) {
    const sub = args[0];
    const guildId = msg.guildId!;

    if (sub === "list") {
      const t = await db.select().from(tournaments).where(and(eq(tournaments.guildId, guildId), eq(tournaments.status, "active"))).then((r) => r[0]);
      if (!t) return err(msg, "No active tournament.");
      const rm = await db.select().from(matches).where(and(eq(matches.tournamentId, t.id), eq(matches.round, t.currentRound)));
      const players = await db.select().from(participants).where(eq(participants.tournamentId, t.id));
      const pm = new Map(players.map((p) => [p.id, p.username]));
      const lines = rm.sort((a, b) => a.matchNumber - b.matchNumber).map((m) => {
        const p1 = m.player1Id ? pm.get(m.player1Id) ?? "???" : "BYE";
        const p2 = m.player2Id ? pm.get(m.player2Id) ?? "???" : "BYE";
        const st = m.status === "completed" ? `✅ ${m.winnerId ? pm.get(m.winnerId) : "???"}` : m.status === "forfeited" ? "🏳️ FF" : m.status === "bye" ? "⏭️ BYE" : "⏳";
        return `\`#${m.matchNumber}\` ${p1} vs ${p2} — ${st}`;
      });
      await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle(`⚔️ ${t.name} — Round ${t.currentRound}`).setDescription(lines.join("\n") || "No matches."));
    }
    else if (sub === "report" && args[1] && args[2]) {
      const matchNumber = parseInt(args[1]);
      const winnerId = parseMention(args[2]);
      if (isNaN(matchNumber) || !winnerId) return err(msg, "Usage: `!match report <number> <@winner>`");
      await err(msg, "Use `/match report` slash command — match reporting requires verified user selection.");
    }
    else if (sub === "forfeit" && args[1] && args[2]) {
      const matchNumber = parseInt(args[1]);
      const reason = args.slice(2).join(" ");
      if (isNaN(matchNumber) || !reason) return err(msg, "Usage: `!match forfeit <number> <reason>`");
      await err(msg, "Use `/match forfeit` slash command — match forfeiting requires verified participant check.");
    }
    else {
      await err(msg, "Usage: `!match <list|report|forfeit>`");
    }
  },

  // ─── Challenge ───
  async challenge(msg, args) {
    const guildId = msg.guildId!;

    if (args[0] === "cancelcd") {
      const voided = await voidForfeitCooldown(guildId, msg.author.id, msg.author.id);
      if (!voided) return err(msg, "No voidable forfeit cooldown to cancel.");
      await ok(msg, "Your forfeit cooldown has been cancelled.");
      return;
    }

    if (args[0] === "forfeit") {
      const reason = args.slice(1).join(" ");
      if (!reason) return err(msg, "Usage: `!challenge forfeit <reason>`");
      const active = await db.select().from(challenges)
        .where(and(eq(challenges.guildId, guildId), or(eq(challenges.challengerId, msg.author.id), eq(challenges.challengedId, msg.author.id)), eq(challenges.status, "accepted")))
        .then((r) => r[0]);
      if (!active) return err(msg, "No accepted challenge to forfeit.");
      const otherId = active.challengerId === msg.author.id ? active.challengedId : active.challengerId;
      await db.update(challenges).set({ status: "forfeited", forfeitBy: msg.author.id, forfeitReason: reason, resolvedAt: new Date() }).where(eq(challenges.id, active.id));
      await db.insert(matchLog).values({ guildId, matchType: "challenge", resultType: "forfeit", forfeitBy: msg.author.id, forfeitReason: reason, contextName: "Challenge Match", contextDetail: `${active.challengerUsername} vs ${active.challengedUsername}` });
      await applyForfeitCooldowns(guildId, msg.author.id, otherId, `Forfeited challenge vs ${otherId === active.challengerId ? active.challengerUsername : active.challengedUsername}`);
      await reply(msg, new EmbedBuilder().setColor(COLORS.error).setTitle("🏳️ Challenge Forfeited").setDescription(`**${msg.author.username}** forfeited.\nReason: ${reason}\n\nBoth players on 24hr cooldown.`));
      return;
    }

    // Issuing a challenge requires buttons — redirect
    await err(msg, "Use `/challenge player @target` — challenges require interactive buttons.");
  },

  // ─── Leaderboard ───
  async leaderboard(msg, args) {
    const guildId = msg.guildId!;
    // Parse: !lb [region] or !lb [page] or !lb [region] [page]
    let region = "default";
    let page = 1;
    for (const a of args) {
      const num = parseInt(a);
      if (!isNaN(num)) { page = num; } else { region = a; }
    }
    const entries = await db.select().from(leaderboard).where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.region, region))).orderBy(asc(leaderboard.rankPosition));
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
    await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle(`${msg.guild!.name}${regionLabel}`).setDescription(lines.join("\n")));
  },

  // ─── Rank ───
  async rank(msg, args) {
    const targetId = parseMention(args[0] ?? "") ?? msg.author.id;
    const entry = await db.select().from(leaderboard).where(and(eq(leaderboard.guildId, msg.guildId!), eq(leaderboard.userId, targetId))).then((r) => r[0]);
    if (!entry) return err(msg, "Not on the leaderboard.");
    const medal = entry.rankPosition <= 3 ? ["", "🥇", "🥈", "🥉"][entry.rankPosition] : "";
    await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle(`${medal} ${entry.username}`)
      .addFields(
        { name: "Rank", value: `#${entry.rankPosition}`, inline: true },
        { name: "W / L", value: `${entry.totalWins} / ${entry.totalLosses}`, inline: true },
        { name: "Tournaments", value: `${entry.tournamentsPlayed} played, ${entry.tournamentsWon} won`, inline: true },
      ));
  },

  // ─── Profile ───
  async profile(msg, args) {
    const targetId = parseMention(args[0] ?? "") ?? msg.author.id;
    const member = await msg.guild?.members.fetch(targetId).catch(() => null);
    if (!member) return err(msg, "Member not found.");
    const { status, customStatus, activities } = getPresenceData(member);
    const activityLines = activities.map(formatActivity).filter(Boolean);
    const entry = await db.select().from(leaderboard).where(and(eq(leaderboard.guildId, msg.guildId!), eq(leaderboard.userId, targetId))).then((r) => r[0] ?? null);
    const cd = await checkForfeitCooldown(msg.guildId!, targetId);
    const embed = new EmbedBuilder().setColor(COLORS.brand)
      .setAuthor({ name: member.displayName, iconURL: member.user.displayAvatarURL() })
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setDescription([formatStatus(status), customStatus ? `💬 "${customStatus}"` : null, ...activityLines].filter(Boolean).join("\n") || formatStatus(status));
    if (entry) {
      embed.addFields(
        { name: "Rank", value: `#${entry.rankPosition}`, inline: true },
        { name: "W / L", value: `${entry.totalWins} / ${entry.totalLosses}`, inline: true },
        { name: "Tournaments", value: `${entry.tournamentsPlayed} played, ${entry.tournamentsWon}W`, inline: true },
      );
    } else {
      embed.addFields({ name: "Rank", value: "Unranked", inline: true });
    }
    if (cd) embed.addFields({ name: "⚠️ Forfeit CD", value: `${cd.type} — ${Math.ceil(cd.remaining / 3600)}hr left` });
    await reply(msg, embed);
  },

  // ─── Server ───
  async server(msg) {
    const guild = msg.guild!;
    const guildId = guild.id;
    const [ts, mc, lbs, cc] = await Promise.all([
      db.select({ total: sql<number>`COUNT(*)`, active: sql<number>`SUM(CASE WHEN status IN ('pending','active') THEN 1 ELSE 0 END)` }).from(tournaments).where(eq(tournaments.guildId, guildId)).then((r) => r[0]),
      db.select({ c: sql<number>`COUNT(*)` }).from(matchLog).where(eq(matchLog.guildId, guildId)).then((r) => r[0].c),
      db.select({ c: sql<number>`COUNT(*)` }).from(leaderboard).where(eq(leaderboard.guildId, guildId)).then((r) => r[0].c),
      db.select({ c: sql<number>`COUNT(*)` }).from(challenges).where(eq(challenges.guildId, guildId)).then((r) => r[0].c),
    ]);
    const online = guild.presences.cache.filter((p) => p.status !== "offline").size;
    await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle(guild.name).setThumbnail(guild.iconURL({ size: 128 }))
      .addFields(
        { name: "Members", value: `${guild.memberCount}`, inline: true },
        { name: "Online", value: `${online}`, inline: true },
        { name: "Tournaments", value: `${ts.total} total, ${ts.active ?? 0} active`, inline: true },
        { name: "Matches", value: `${mc}`, inline: true },
        { name: "Ranked", value: `${lbs}`, inline: true },
        { name: "Challenges", value: `${cc}`, inline: true },
      ));
  },

  // ─── History ───
  async history(msg, args) {
    let page = 1;
    let playerId: string | null = null;
    for (const a of args) {
      const num = parseInt(a);
      if (!isNaN(num)) { page = num; continue; }
      const id = parseMention(a);
      if (id) { playerId = id; }
    }
    const conditions: any[] = [eq(matchLog.guildId, msg.guildId!)];
    if (playerId) conditions.push(or(eq(matchLog.winnerId, playerId), eq(matchLog.loserId, playerId), eq(matchLog.forfeitBy, playerId))!);
    const entries = await db.select().from(matchLog).where(and(...conditions)).orderBy(desc(matchLog.createdAt)).limit(10).offset((page - 1) * 10);
    if (!entries.length) return err(msg, "No match history.");
    const lines = entries.map((e) => {
      const ts = e.createdAt ? `<t:${Math.floor(e.createdAt.getTime() / 1000)}:R>` : "?";
      const type = e.matchType === "tournament" ? "🏆" : "⚔️";
      if (e.resultType === "forfeit") return `${type} 🏳️ **FF** — ${e.contextName} ${ts}`;
      return `${type} **${e.winnerUsername}** beat **${e.loserUsername}** ${ts}`;
    });
    await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle("📜 Match History").setDescription(lines.join("\n")).setFooter({ text: `Page ${page}` }));
  },

  // ─── Register ───
  async register(msg, args) {
    const guildId = msg.guildId!;
    const region = args[0] ?? "default";
    const existing = await db.select().from(leaderboard).where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, msg.author.id), eq(leaderboard.region, region))).then((r) => r[0]);
    if (existing) return err(msg, `Already on the leaderboard at Rank #${existing.rankPosition}.`);
    const entry = await ensureOnLeaderboard(guildId, msg.author.id, msg.author.username, region);
    await ok(msg, `You've joined the leaderboard at Rank #${entry.rankPosition}! Use \`/challenge\` to climb.`);
  },

  // ─── Help ───
  async help(msg, args) {
    const helpTopics: Record<string, { title: string; text: string }> = {
      tournament: {
        title: "🏆 Tournament",
        text: "`!t create <name>` — Create tournament\n`!t join` — Join\n`!t leave` — Leave\n`!t start` — Start (admin)\n`!t end` — Cancel (admin)\n`!t status` — Info\n`!t bracket` — Bracket\n`!t list` — Recent tournaments",
      },
      match: {
        title: "⚔️ Match",
        text: "`!m list` — Current round matches\n`!m report` → use `/match report`\n`!m forfeit` → use `/match forfeit`",
      },
      challenge: {
        title: "🎯 Challenge",
        text: "Issue via `/challenge player @target` (needs buttons)\n`!c forfeit <reason>` — Forfeit accepted challenge\n`!c cancelcd` — Cancel voidable forfeit CD\n\n**Rules:**\n• Ranked: challenge up to 3 above\n• Unranked: can only challenge bottom player\n• Winner takes loser's rank\n• Loser past board size gets removed",
      },
      leaderboard: {
        title: "📊 Leaderboard",
        text: "`!lb [page]` — General ranked ladder\nFixed-size (default 8). Set via `!setup leaderboard-size <n>`\n\nTournament leaderboard: use `/leaderboard tournament`",
      },
      rank: {
        title: "📊 Rank",
        text: "`!r` — Your stats\n`!r @player` — Someone's stats\nShows rank, W/L, tournaments",
      },
      profile: {
        title: "👤 Profile",
        text: "`!p` — Your profile\n`!p @player` — Someone's profile\nShows status, activity, rank, roles, forfeit CD",
      },
      server: {
        title: "🖥️ Server",
        text: "`!sv` — Server stats\nMembers, online, tournaments, matches, ranked players",
      },
      history: {
        title: "📜 History",
        text: "`!h [page]` — All match history\n`!h [page] @player` — Player's history\nShows tournament + challenge results, forfeits",
      },
      setup: {
        title: "⚙️ Setup (Admin)",
        text: "`!setup leaderboard #channel` — LB channel\n`!setup leaderboard-size <n>` — Ladder size\n`!setup prefix <prefix>` — Change prefix\n`!setup top10role @role` — Top 10 role\n`!setup role add @role <min> <max> <label>`\n`!setup role remove @role`\n`!setup role list`\n`!setup cooldown set <cmd> <sec>`\n`!setup cooldown reset <cmd|all>`\n`!setup cooldown list`\n`!setup cooldown rank-penalty <n> <mult>`\n`!setup status` — View config",
      },
      admin: {
        title: "🛡️ Admin",
        text: "`!admin leaderboard view @player`\n`!admin leaderboard set @player <stat> <value>`\n`!admin leaderboard adjust @player <stat> <amount>`\n`!admin leaderboard remove @player`\n`!admin leaderboard reset`\n`!admin cd cancel @player`\n`!admin cd list [@player]`\n\nStats: `rank_position`, `total_wins`, `total_losses`, `tournaments_won`, `tournaments_played`",
      },
      register: {
        title: "📝 Register",
        text: "`!register` — Join the general leaderboard at the bottom rank. Use challenges to climb.",
      },
      forfeit: {
        title: "🏳️ Forfeit System",
        text: "Forfeits = no contest, no rank change.\n\n**Cooldowns (24hr):**\n• Forfeiter → unavoidable\n• Other player → voidable (`!c cancelcd`)\n\n**Commands:**\n`!c forfeit <reason>` — Forfeit challenge\n`!admin cd cancel @player` — Admin cancel CD\n`!admin cd list` — View active CDs",
      },
    };

    const topic = args[0]?.toLowerCase();
    const alias = ALIASES[topic] ?? topic;

    if (alias && helpTopics[alias]) {
      const h = helpTopics[alias];
      await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle(h.title).setDescription(h.text));
      return;
    }

    if (topic) {
      await err(msg, `Unknown topic. Try: ${Object.keys(helpTopics).join(", ")}`);
      return;
    }

    await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle("Nyxie — Commands")
      .setDescription("Use `!help <topic>` for details.\n\n**Topics:**\n`tournament` `match` `challenge` `leaderboard` `rank` `profile` `server` `history` `setup` `admin` `register` `forfeit`\n\n**Aliases:**\n`!t` `!m` `!c` `!lb` `!r` `!p` `!sv` `!h`"));
  },

  // ─── Setup ───
  async setup(msg, args) {
    if (!isAdmin(msg)) return err(msg, "Need **Manage Server** permission.");
    const guildId = msg.guildId!;
    const sub = args[0];

    const ensureConfig = async () => {
      const existing = await db.select().from(guildConfig).where(eq(guildConfig.guildId, guildId)).then((r) => r[0]);
      if (existing) return existing;
      await db.insert(guildConfig).values({ guildId });
      return db.select().from(guildConfig).where(eq(guildConfig.guildId, guildId)).then((r) => r[0]!);
    };

    if (sub === "leaderboard" && args[1]) {
      const channelId = args[1].replace(/[<#>]/g, "");
      const cfg = await ensureConfig();
      await db.update(guildConfig).set({ leaderboardChannelId: channelId, updatedAt: new Date() }).where(eq(guildConfig.id, cfg.id));
      await ok(msg, `Leaderboard channel set to <#${channelId}>.`);
    }
    else if (sub === "leaderboard-size" && args[1]) {
      const size = parseInt(args[1]);
      if (isNaN(size) || size < 2 || size > 100) return err(msg, "Size must be 2–100.");
      const cfg = await ensureConfig();
      await db.update(guildConfig).set({ leaderboardSize: size, updatedAt: new Date() }).where(eq(guildConfig.id, cfg.id));
      await ok(msg, `Leaderboard size set to **${size}**.`);
    }
    else if (sub === "leaderboard-title" && args[1]) {
      const title = args.slice(1).join(" ");
      const cfg = await ensureConfig();
      await db.update(guildConfig).set({ leaderboardTitle: title, updatedAt: new Date() }).where(eq(guildConfig.id, cfg.id));
      await ok(msg, `Leaderboard title set to **${title}**.`);
    }
    else if (sub === "challenge-ft" && args[1]) {
      const ft = parseInt(args[1]);
      if (isNaN(ft) || ft < 1 || ft > 20) return err(msg, "First-to must be 1–20.");
      const cfg = await ensureConfig();
      await db.update(guildConfig).set({ challengeBestOf: ft, updatedAt: new Date() }).where(eq(guildConfig.id, cfg.id));
      await ok(msg, `Challenge format set to **First to ${ft}**.`);
    }
    else if (sub === "region-channel" && args[1] && args[2]) {
      const region = args[1];
      const channelId = args[2].replace(/[<#>]/g, "");
      const existing = await db.select().from(regionChannels).where(and(eq(regionChannels.guildId, guildId), eq(regionChannels.region, region))).then((r) => r[0]);
      if (existing) {
        await db.update(regionChannels).set({ channelId, updatedAt: new Date() }).where(eq(regionChannels.id, existing.id));
      } else {
        await db.insert(regionChannels).values({ guildId, region, channelId });
      }
      await ok(msg, `Region **${region}** leaderboard → <#${channelId}>.`);
    }
    else if (sub === "prefix" && args[1]) {
      const prefix = args[1];
      if (prefix.length > 5) return err(msg, "Prefix max 5 characters.");
      const cfg = await ensureConfig();
      await db.update(guildConfig).set({ prefix, updatedAt: new Date() }).where(eq(guildConfig.id, cfg.id));
      invalidatePrefixCache(guildId);
      await ok(msg, `Prefix set to \`${prefix}\`.`);
    }
    else if (sub === "top10role" && args[1]) {
      const roleId = args[1].replace(/[<@&>]/g, "");
      const cfg = await ensureConfig();
      await db.update(guildConfig).set({ top10RoleId: roleId, updatedAt: new Date() }).where(eq(guildConfig.id, cfg.id));
      await ok(msg, `Top 10 role set to <@&${roleId}>.`);
    }
    else if (sub === "role") {
      const action = args[1];
      if (action === "add" && args.length >= 6) {
        // !setup role add @role <position> <region> <label...>
        const roleId = args[2].replace(/[<@&>]/g, "");
        const position = parseInt(args[3]);
        const region = args[4];
        const label = args.slice(5).join(" ");
        if (isNaN(position) || position < 1) return err(msg, "Position must be a positive integer.");
        const existing = await db.select().from(rankRoles).where(and(eq(rankRoles.guildId, guildId), eq(rankRoles.roleId, roleId))).then((r) => r[0]);
        if (existing) {
          await db.update(rankRoles).set({ position, label, region }).where(eq(rankRoles.id, existing.id));
        } else {
          await db.insert(rankRoles).values({ guildId, roleId, label, position, region });
        }
        await ok(msg, `<@&${roleId}> → **${label}** (Position #${position}, Region: ${region})`);
      }
      else if (action === "remove" && args[2]) {
        const roleId = args[2].replace(/[<@&>]/g, "");
        await db.delete(rankRoles).where(and(eq(rankRoles.guildId, guildId), eq(rankRoles.roleId, roleId)));
        await ok(msg, `Rank role removed.`);
      }
      else if (action === "list") {
        const roles = await db.select().from(rankRoles).where(eq(rankRoles.guildId, guildId));
        if (!roles.length) return reply(msg, new EmbedBuilder().setColor(COLORS.brand).setDescription("No rank roles configured."));
        const lines = roles.map((r) => `\`#${r.position}\` <@&${r.roleId}> — **${r.label}**`);
        await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle("🏷️ Rank Roles").setDescription(lines.join("\n")));
      }
      else { await err(msg, "Usage: `!setup role <add|remove|list> [args]`"); }
    }
    else if (sub === "cooldown") {
      const action = args[1];
      if (action === "set" && args[2] && args[3]) {
        const cmd = args[2];
        const seconds = parseInt(args[3]);
        if (isNaN(seconds) || seconds < 1 || seconds > 600) return err(msg, "Seconds must be 1–600.");
        const existing = await db.select().from(cooldownConfig).where(and(eq(cooldownConfig.guildId, guildId), eq(cooldownConfig.commandName, cmd))).then((r) => r[0]);
        if (existing) {
          await db.update(cooldownConfig).set({ baseSeconds: seconds, updatedAt: new Date() }).where(eq(cooldownConfig.id, existing.id));
        } else {
          await db.insert(cooldownConfig).values({ guildId, commandName: cmd, baseSeconds: seconds });
        }
        await ok(msg, `Cooldown for \`${cmd}\` set to ${seconds}s.`);
      }
      else if (action === "reset" && args[2]) {
        if (args[2] === "all") {
          await db.delete(cooldownConfig).where(eq(cooldownConfig.guildId, guildId));
          await ok(msg, "All cooldowns reset to defaults.");
        } else {
          await db.delete(cooldownConfig).where(and(eq(cooldownConfig.guildId, guildId), eq(cooldownConfig.commandName, args[2])));
          await ok(msg, `Cooldown for \`${args[2]}\` reset.`);
        }
      }
      else if (action === "list") {
        const cds = await db.select().from(cooldownConfig).where(eq(cooldownConfig.guildId, guildId));
        if (!cds.length) return reply(msg, new EmbedBuilder().setColor(COLORS.brand).setDescription("All cooldowns at defaults."));
        const lines = cds.map((c) => `\`${c.commandName}\`: ${c.baseSeconds}s`);
        await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle("⏱️ Cooldowns").setDescription(lines.join("\n")));
      }
      else if (action === "rank-penalty" && args[2] && args[3]) {
        const topN = parseInt(args[2]);
        const mult = parseFloat(args[3]);
        if (isNaN(topN) || isNaN(mult)) return err(msg, "Invalid numbers.");
        const existing = await db.select().from(cooldownRankPenalty).where(eq(cooldownRankPenalty.guildId, guildId)).then((r) => r[0]);
        if (existing) {
          await db.update(cooldownRankPenalty).set({ topRankThreshold: topN, multiplier: String(mult), updatedAt: new Date() }).where(eq(cooldownRankPenalty.id, existing.id));
        } else {
          await db.insert(cooldownRankPenalty).values({ guildId, topRankThreshold: topN, multiplier: String(mult) });
        }
        await ok(msg, `Top ${topN} players get ${mult}x cooldown.`);
      }
      else { await err(msg, "Usage: `!setup cooldown <set|reset|list|rank-penalty> [args]`"); }
    }
    else if (sub === "status") {
      const cfg = await ensureConfig();
      const roles = await db.select().from(rankRoles).where(eq(rankRoles.guildId, guildId));
      const cds = await db.select().from(cooldownConfig).where(eq(cooldownConfig.guildId, guildId));
      const penalty = await db.select().from(cooldownRankPenalty).where(eq(cooldownRankPenalty.guildId, guildId)).then((r) => r[0]);
      await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle("⚙️ Server Config")
        .addFields(
          { name: "Prefix", value: `\`${cfg.prefix}\``, inline: true },
          { name: "LB Channel", value: cfg.leaderboardChannelId ? `<#${cfg.leaderboardChannelId}>` : "Not set", inline: true },
          { name: "LB Size", value: `${cfg.leaderboardSize}`, inline: true },
          { name: "Top 10 Role", value: cfg.top10RoleId ? `<@&${cfg.top10RoleId}>` : "Not set", inline: true },
          { name: "Rank Roles", value: roles.length ? roles.map((r) => `\`#${r.position}\` <@&${r.roleId}> — ${r.label}`).join("\n") : "None" },
          { name: "Cooldowns", value: cds.length ? cds.map((c) => `\`${c.commandName}\`: ${c.baseSeconds}s`).join("\n") : "All default" },
          { name: "Rank Penalty", value: penalty ? `Top ${penalty.topRankThreshold} → ${penalty.multiplier}x` : "None" },
        ));
    }
    else {
      await err(msg, "Usage: `!setup <leaderboard|leaderboard-size|prefix|top10role|role|cooldown|status> [args]`");
    }
  },

  // ─── Admin ───
  async admin(msg, args) {
    if (!isAdmin(msg)) return err(msg, "Need **Manage Server** permission.");
    const guildId = msg.guildId!;
    const group = args[0];
    const sub = args[1];

    if (group === "leaderboard") {
      if (sub === "view" && args[2]) {
        const userId = parseMention(args[2]);
        if (!userId) return err(msg, "Usage: `!admin leaderboard view <@player>`");
        const entry = await db.select().from(leaderboard).where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId))).then((r) => r[0]);
        if (!entry) return err(msg, "Player not on leaderboard.");
        await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle(`📋 ${entry.username} — Stats`)
          .addFields(
            { name: "Rank", value: `#${entry.rankPosition}`, inline: true },
            { name: "Wins", value: `${entry.totalWins}`, inline: true },
            { name: "Losses", value: `${entry.totalLosses}`, inline: true },
            { name: "Tournaments Won", value: `${entry.tournamentsWon}`, inline: true },
            { name: "Tournaments Played", value: `${entry.tournamentsPlayed}`, inline: true },
          ));
      }
      else if (sub === "set" && args[2] && args[3] && args[4]) {
        const userId = parseMention(args[2]);
        if (!userId) return err(msg, "Usage: `!admin leaderboard set <@player> <stat> <value>`");
        const stat = args[3];
        const value = parseInt(args[4]);
        if (isNaN(value)) return err(msg, "Value must be a number.");
        const validStats: Record<string, any> = { total_wins: "totalWins", total_losses: "totalLosses", tournaments_won: "tournamentsWon", tournaments_played: "tournamentsPlayed", rank_position: "rankPosition" };
        const field = validStats[stat];
        if (!field) return err(msg, `Invalid stat. Use: ${Object.keys(validStats).join(", ")}`);
        const entry = await isOnLeaderboard(guildId, userId);
        if (!entry) return err(msg, "Player not on leaderboard.");
        if (field === "rankPosition") {
          if (value < 1) return err(msg, "Rank must be a positive integer (1 or higher).");
          await setRankPosition(guildId, userId, value);
        } else {
          await db.update(leaderboard).set({ [field]: value, updatedAt: new Date() }).where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId)));
        }
        await ok(msg, `Set **${stat}** to **${value}** for ${entry.username}.`);
      }
      else if (sub === "adjust" && args[2] && args[3] && args[4]) {
        const userId = parseMention(args[2]);
        if (!userId) return err(msg, "Usage: `!admin leaderboard adjust <@player> <stat> <amount>`");
        const stat = args[3];
        const amount = parseInt(args[4]);
        if (isNaN(amount)) return err(msg, "Amount must be a number.");
        const validStats: Record<string, any> = { total_wins: leaderboard.totalWins, total_losses: leaderboard.totalLosses, tournaments_won: leaderboard.tournamentsWon, tournaments_played: leaderboard.tournamentsPlayed };
        const col = validStats[stat];
        if (!col) return err(msg, `Invalid stat. Use: ${Object.keys(validStats).join(", ")}`);
        const entry = await isOnLeaderboard(guildId, userId);
        if (!entry) return err(msg, "Player not on leaderboard.");
        await db.update(leaderboard).set({ [stat.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())]: sql`${col} + ${amount}`, updatedAt: new Date() }).where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId)));
        const sign = amount >= 0 ? "+" : "";
        await ok(msg, `Adjusted **${stat}** by **${sign}${amount}** for ${entry.username}.`);
      }
      else if (sub === "remove" && args[2]) {
        const userId = parseMention(args[2]);
        if (!userId) return err(msg, "Usage: `!admin leaderboard remove <@player>`");
        const entry = await db.select().from(leaderboard)
          .where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId)))
          .then((r) => r[0]);
        if (entry) {
          const member = await msg.guild!.members.fetch(userId).catch(() => null);
          if (member) {
            const role = await db.select().from(rankRoles)
              .where(and(eq(rankRoles.guildId, guildId), eq(rankRoles.position, entry.rankPosition)))
              .then((r) => r[0]);
            if (role) await member.roles.remove(role.roleId).catch(() => {});
            const cfg = await db.select().from(guildConfig).where(eq(guildConfig.guildId, guildId)).then((r) => r[0]);
            if (cfg?.top10RoleId && entry.rankPosition <= 10) await member.roles.remove(cfg.top10RoleId).catch(() => {});
          }
        }
        await removeFromLeaderboard(guildId, userId);
        const { client } = await import("../index");
        await refreshLeaderboard(client, guildId);
        await ok(msg, "Player removed from leaderboard and roles stripped.");
      }
      else if (sub === "reset") {
        await db.delete(leaderboard).where(eq(leaderboard.guildId, guildId));
        await ok(msg, "⚠️ Leaderboard wiped.");
      }
      else if (sub === "move" && args[2] && args[3]) {
        // !admin leaderboard move @player <new_region>
        const userId = parseMention(args[2]);
        const newRegion = args[3];
        if (!userId) return err(msg, "Usage: `!admin leaderboard move <@player> <new_region>`");
        const entry = await db.select().from(leaderboard).where(and(eq(leaderboard.guildId, guildId), eq(leaderboard.userId, userId))).then((r) => r[0]);
        if (!entry) return err(msg, "Player not on any leaderboard.");
        await removeFromLeaderboard(guildId, userId, entry.region);
        await ensureOnLeaderboard(guildId, userId, entry.username, newRegion);
        await ok(msg, `Moved **${entry.username}** from **${entry.region}** → **${newRegion}**.`);
      }
      else {
        await err(msg, "Usage: `!admin leaderboard <view|set|adjust|remove|reset|move> [args]`");
      }
    }
    else if (group === "cd" || group === "cooldown") {
      if (sub === "cancel" && args[2]) {
        const userId = parseMention(args[2]);
        if (!userId) return err(msg, "Usage: `!admin cd cancel <@player>`");
        const voided = await voidForfeitCooldown(guildId, userId, msg.author.id);
        if (!voided) return err(msg, "No active cooldown found for this player.");
        await ok(msg, "Cooldown cancelled.");
      }
      else if (sub === "list") {
        const userId = args[2] ? parseMention(args[2]) : undefined;
        const entries = await getActiveForfeitCooldowns(guildId, userId ?? undefined);
        if (!entries.length) return reply(msg, new EmbedBuilder().setColor(COLORS.brand).setDescription("No active cooldowns."));
        const lines = entries.map((e) => {
          const expires = `<t:${Math.floor(e.expiresAt.getTime() / 1000)}:R>`;
          return `<@${e.userId}> — **${e.type}** — expires ${expires}\n> ${e.reason}`;
        });
        await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle("⚠️ Active Cooldowns").setDescription(lines.join("\n\n")));
      }
      else {
        await err(msg, "Usage: `!admin cd <cancel|list> [args]`");
      }
    }
    else {
      await err(msg, "Usage: `!admin <leaderboard|cd> <subcommand> [args]`");
    }
  },

  // ─── Nyxie Context Management ───
  async nyxie(msg, args) {
    if (!NYXIE_ADMINS.has(msg.author.id))
      return err(msg, "Only authorized users can manage Nyxie's context.");

    const sub = args[0];
    const guildId = msg.guildId!;

    if (sub === "add") {
      const context = args.slice(1).join(" ");
      if (!context) return err(msg, "Usage: `!nyxie add <context>`");
      addServerContext(guildId, context, msg.author.id);
      await ok(msg, `Added context: "${context}"`);
    }
    else if (sub === "list") {
      const items = listServerContext(guildId);
      if (!items.length) return err(msg, "No server context added yet.");
      const lines = items.map((i) => `**#${i.id}** — ${i.context}`).join("\n");
      await reply(msg, new EmbedBuilder().setColor(COLORS.brand).setTitle("🧠 Nyxie Context").setDescription(lines));
    }
    else if (sub === "remove") {
      const id = parseInt(args[1]);
      if (!id) return err(msg, "Usage: `!nyxie remove <id>`");
      const removed = removeServerContext(guildId, id);
      if (!removed) return err(msg, "Context not found.");
      await ok(msg, `Removed context #${id}`);
    }
    else {
      await err(msg, "Usage: `!nyxie <add|list|remove> [args]`");
    }
  },
};

// ─── Parse Helper (exported for testing) ───

export const parseCommand = (content: string, prefix: string): { command: string; args: string[] } | null => {
  if (!content.startsWith(prefix)) return null;
  const trimmed = content.slice(prefix.length).trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  let command = parts[0].toLowerCase();
  command = ALIASES[command] ?? command;
  return { command, args: parts.slice(1) };
};

// ─── Message Handler ───

export const handleMessage = async (message: Message) => {
  if (message.author.bot || !message.guild) return;

  // Chatbot response when Nyxie is mentioned
  if (message.mentions.has(message.client.user!)) {
    await message.channel.sendTyping();
    const reply = await chat(message);
    await message.reply(reply);
    return;
  }

  const prefix = await getPrefix(message.guildId!);
  if (!message.content.startsWith(prefix)) return;

  const content = message.content.slice(prefix.length).trim();
  if (!content) return;

  const parts = content.split(/\s+/);
  let command = parts[0].toLowerCase();
  const args = parts.slice(1);

  // Resolve aliases
  command = ALIASES[command] ?? command;

  const handler = handlers[command];
  if (!handler) return;

  try {
    await handler(message, args);
  } catch (error) {
    console.error(`❌ Prefix command error (${command}):`, error);
    await err(message, "Something went wrong.").catch(() => {});
  }
};
