import {
  mysqlTable,
  int,
  varchar,
  boolean,
  datetime,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

const now = sql`(NOW())`;

// ─── Tournaments ───

export const tournaments = mysqlTable("tournaments", {
  id: int("id").primaryKey().autoincrement(),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  currentRound: int("current_round").notNull().default(1),
  totalRounds: int("total_rounds").notNull().default(0),
  createdBy: varchar("created_by", { length: 20 }).notNull(),
  createdAt: datetime("created_at").notNull().default(now),
  updatedAt: datetime("updated_at").notNull().default(now),
});

// ─── Participants ───

export const participants = mysqlTable("participants", {
  id: int("id").primaryKey().autoincrement(),
  tournamentId: int("tournament_id")
    .notNull()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 20 }).notNull(),
  username: varchar("username", { length: 100 }).notNull(),
  seed: int("seed"),
  wins: int("wins").notNull().default(0),
  losses: int("losses").notNull().default(0),
  isEliminated: boolean("is_eliminated").notNull().default(false),
  joinedAt: datetime("joined_at").notNull().default(now),
});

// ─── Matches ───

export const matches = mysqlTable("matches", {
  id: int("id").primaryKey().autoincrement(),
  tournamentId: int("tournament_id")
    .notNull()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  round: int("round").notNull(),
  matchNumber: int("match_number").notNull(),
  player1Id: int("player1_id").references(() => participants.id),
  player2Id: int("player2_id").references(() => participants.id),
  winnerId: int("winner_id").references(() => participants.id),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  forfeitBy: int("forfeit_by").references(() => participants.id),
  forfeitReason: varchar("forfeit_reason", { length: 200 }),
  scheduledAt: datetime("scheduled_at"),
  completedAt: datetime("completed_at"),
});

// ─── Leaderboard ───

export const leaderboard = mysqlTable(
  "leaderboard",
  {
    id: int("id").primaryKey().autoincrement(),
    guildId: varchar("guild_id", { length: 20 }).notNull(),
    userId: varchar("user_id", { length: 20 }).notNull(),
    username: varchar("username", { length: 100 }).notNull(),
    region: varchar("region", { length: 50 }).notNull().default("default"),
    rankPosition: int("rank_position").notNull().default(9999),
    totalWins: int("total_wins").notNull().default(0),
    totalLosses: int("total_losses").notNull().default(0),
    tournamentsWon: int("tournaments_won").notNull().default(0),
    tournamentsPlayed: int("tournaments_played").notNull().default(0),
    updatedAt: datetime("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("leaderboard_guild_user_region_idx").on(t.guildId, t.userId, t.region)]
);

// ─── Guild Config ───

export const guildConfig = mysqlTable("guild_config", {
  id: int("id").primaryKey().autoincrement(),
  guildId: varchar("guild_id", { length: 20 }).notNull().unique(),
  leaderboardChannelId: varchar("leaderboard_channel_id", { length: 20 }),
  leaderboardMessageId: varchar("leaderboard_message_id", { length: 20 }),
  leaderboardTitle: varchar("leaderboard_title", { length: 100 }),
  top10RoleId: varchar("top10_role_id", { length: 20 }),
  prefix: varchar("prefix", { length: 5 }).notNull().default("!"),
  leaderboardSize: int("leaderboard_size").notNull().default(8),
  challengeBestOf: int("challenge_best_of").notNull().default(5),
  updatedAt: datetime("updated_at").notNull().default(now),
});

// ─── Region Channels ───

export const regionChannels = mysqlTable(
  "region_channels",
  {
    id: int("id").primaryKey().autoincrement(),
    guildId: varchar("guild_id", { length: 20 }).notNull(),
    region: varchar("region", { length: 50 }).notNull(),
    channelId: varchar("channel_id", { length: 20 }).notNull(),
    messageId: varchar("message_id", { length: 20 }),
    updatedAt: datetime("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("region_channels_guild_region_idx").on(t.guildId, t.region)]
);

// ─── Rank Roles ───

export const rankRoles = mysqlTable(
  "rank_roles",
  {
    id: int("id").primaryKey().autoincrement(),
    guildId: varchar("guild_id", { length: 20 }).notNull(),
    region: varchar("region", { length: 50 }).notNull().default("default"),
    roleId: varchar("role_id", { length: 20 }).notNull(),
    label: varchar("label", { length: 50 }).notNull(),
    position: int("position").notNull(),
    createdAt: datetime("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("rank_roles_guild_role_idx").on(t.guildId, t.roleId)]
);

// ─── Match Log ───

export const matchLog = mysqlTable("match_log", {
  id: int("id").primaryKey().autoincrement(),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  matchType: varchar("match_type", { length: 20 }).notNull(),
  resultType: varchar("result_type", { length: 20 }).notNull().default("normal"),
  winnerId: varchar("winner_id", { length: 20 }),
  winnerUsername: varchar("winner_username", { length: 100 }),
  loserId: varchar("loser_id", { length: 20 }),
  loserUsername: varchar("loser_username", { length: 100 }),
  forfeitBy: varchar("forfeit_by", { length: 20 }),
  forfeitReason: varchar("forfeit_reason", { length: 200 }),
  contextName: varchar("context_name", { length: 100 }).notNull(),
  contextDetail: varchar("context_detail", { length: 200 }),
  createdAt: datetime("created_at").notNull().default(now),
});

// ─── Cooldown Config ───

export const cooldownConfig = mysqlTable(
  "cooldown_config",
  {
    id: int("id").primaryKey().autoincrement(),
    guildId: varchar("guild_id", { length: 20 }).notNull(),
    commandName: varchar("command_name", { length: 50 }).notNull(),
    baseSeconds: int("base_seconds").notNull(),
    updatedAt: datetime("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("cooldown_config_guild_cmd_idx").on(t.guildId, t.commandName),
  ]
);

// ─── Cooldown Rank Penalty ───

export const cooldownRankPenalty = mysqlTable("cooldown_rank_penalty", {
  id: int("id").primaryKey().autoincrement(),
  guildId: varchar("guild_id", { length: 20 }).notNull().unique(),
  topRankThreshold: int("top_rank_threshold").notNull().default(10),
  multiplier: varchar("multiplier", { length: 10 }).notNull().default("2.0"),
  updatedAt: datetime("updated_at").notNull().default(now),
});

// ─── Challenges ───

export const challenges = mysqlTable("challenges", {
  id: int("id").primaryKey().autoincrement(),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  challengerId: varchar("challenger_id", { length: 20 }).notNull(),
  challengerUsername: varchar("challenger_username", { length: 100 }).notNull(),
  challengedId: varchar("challenged_id", { length: 20 }).notNull(),
  challengedUsername: varchar("challenged_username", { length: 100 }).notNull(),
  challengeMessageId: varchar("challenge_message_id", { length: 20 }),
  channelId: varchar("channel_id", { length: 20 }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  winnerId: varchar("winner_id", { length: 20 }),
  forfeitBy: varchar("forfeit_by", { length: 20 }),
  forfeitReason: varchar("forfeit_reason", { length: 200 }),
  createdAt: datetime("created_at").notNull().default(now),
  resolvedAt: datetime("resolved_at"),
  expiresAt: datetime("expires_at").notNull(),
});

// ─── Forfeit Cooldowns ───

export const forfeitCooldowns = mysqlTable("forfeit_cooldowns", {
  id: int("id").primaryKey().autoincrement(),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  userId: varchar("user_id", { length: 20 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  reason: varchar("reason", { length: 200 }).notNull(),
  expiresAt: datetime("expires_at").notNull(),
  voidedBy: varchar("voided_by", { length: 20 }),
  voidedAt: datetime("voided_at"),
  createdAt: datetime("created_at").notNull().default(now),
});
