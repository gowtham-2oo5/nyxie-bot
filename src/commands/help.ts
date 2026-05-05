import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { registerCommand, registerSelectMenu } from "../handlers/interaction";
import { addCommandData } from "../deploy-commands";
import { COLORS } from "../lib/embeds";

// ─── Data ───

interface Operation {
  label: string;
  value: string;
  description: string;
  guide: string;
}

interface Module {
  emoji: string;
  label: string;
  value: string;
  description: string;
  intro: string;
  operations: Operation[];
}

const modules: Module[] = [
  {
    emoji: "🏆", label: "Tournament", value: "tournament",
    description: "Create & manage single-elimination brackets",
    intro: "Tournaments are single-elimination brackets. One active tournament per server at a time. Players join, admin starts, bracket is generated with random seeding, and rounds auto-advance as matches complete.",
    operations: [
      {
        label: "Create", value: "tournament_create",
        description: "Create a new tournament",
        guide: [
          "**`/tournament create <name>`**",
          "",
          "Creates a new tournament with a Join button for players.",
          "Only one tournament can be active/pending per server.",
          "",
          "**Example:** `/tournament create Friday Night Fights`",
          "**Prefix:** `!t create <name>`",
        ].join("\n"),
      },
      {
        label: "Join / Leave", value: "tournament_join",
        description: "Join or leave a pending tournament",
        guide: [
          "**`/tournament join`** — Join the pending tournament (or click the ⚔️ button).",
          "**`/tournament leave`** — Leave before the tournament starts.",
          "",
          "You can only join while the tournament is in **pending** status.",
          "",
          "**Prefix:** `!t join` / `!t leave`",
        ].join("\n"),
      },
      {
        label: "Start", value: "tournament_start",
        description: "Start the tournament & generate bracket",
        guide: [
          "**`/tournament start`**",
          "",
          "Generates the bracket with random seeding. Odd player count → one gets a BYE (auto-advance).",
          "",
          "**Requires:** Manage Server permission",
          "**Minimum:** 2 players",
          "",
          "**Prefix:** `!t start`",
        ].join("\n"),
      },
      {
        label: "End / Cancel", value: "tournament_end",
        description: "Force-cancel the active tournament",
        guide: [
          "**`/tournament end`**",
          "",
          "Force-cancels the active or pending tournament. This cannot be undone.",
          "",
          "**Requires:** Manage Server permission",
          "**Prefix:** `!t end`",
        ].join("\n"),
      },
      {
        label: "Status / Bracket / List", value: "tournament_info",
        description: "View tournament info",
        guide: [
          "**`/tournament status`** — Current tournament info (status, player count, round).",
          "**`/tournament bracket`** — Full bracket with match results per round.",
          "**`/tournament list`** — Last 10 tournaments in the server.",
          "",
          "**Prefix:** `!t status` / `!t bracket` / `!t list`",
        ].join("\n"),
      },
    ],
  },
  {
    emoji: "⚔️", label: "Match", value: "match",
    description: "Report results & manage tournament matches",
    intro: "Match commands are used during active tournaments to report results, forfeit, and view current round matchups. Rounds auto-advance when all matches are resolved.",
    operations: [
      {
        label: "Report Result", value: "match_report",
        description: "Report who won a match",
        guide: [
          "**`/match report <match_number> <@winner>`**",
          "",
          "Reports the winner of a tournament match. Only participants in that match or admins can report.",
          "",
          "After reporting:",
          "• Winner's stats update, loser is eliminated",
          "• If all round matches done → next round auto-generates",
          "• If it's the final match → champion is announced",
          "",
          "**Prefix:** Use `/match report` (needs user selection)",
        ].join("\n"),
      },
      {
        label: "Forfeit Match", value: "match_forfeit",
        description: "Forfeit a tournament match",
        guide: [
          "**`/match forfeit <match_number> <reason>`**",
          "",
          "Forfeits a tournament match. This is a **no-contest** — no W/L change.",
          "The other player auto-advances to the next round.",
          "",
          "**Both players get 24hr cooldown:**",
          "• Forfeiter → unavoidable",
          "• Other player → voidable (cancel with `/challenge cancelcd`)",
          "",
          "**Prefix:** Use `/match forfeit` (needs verified participant check)",
        ].join("\n"),
      },
      {
        label: "List Matches", value: "match_list",
        description: "View current round matches",
        guide: [
          "**`/match list`**",
          "",
          "Shows all matches in the current round:",
          "⏳ Pending • ✅ Completed • 🏳️ Forfeited • ⏭️ BYE",
          "",
          "**Prefix:** `!m list`",
        ].join("\n"),
      },
    ],
  },
  {
    emoji: "🎯", label: "Challenge", value: "challenge",
    description: "Ranked 1v1 challenges to climb the ladder",
    intro: "Challenges are ranked 1v1 matches outside of tournaments. Win to take your opponent's rank position. The leaderboard is a fixed-size ladder — beat someone above you to climb, or beat the bottom player to enter. Results are set by staff.",
    operations: [
      {
        label: "Issue Challenge", value: "challenge_player",
        description: "Challenge a ranked player",
        guide: [
          "**`/challenge player <@target>`**",
          "",
          "**If you're on the leaderboard:** challenge up to 3 ranks above you.",
          "**If you're unranked:** can only challenge the bottom-ranked player to enter.",
          "",
          "An embed appears with **Accept**, **Decline**, and **Withdraw** buttons.",
          "• **Accept** — challenged player accepts (staff sets result later)",
          "• **Decline** — challenged player declines (must give a reason)",
          "• **Withdraw** — challenger cancels their own challenge",
          "",
          "Challenges expire after **24 hours**. If no response, the challenged player is auto-forfeited.",
        ].join("\n"),
      },
      {
        label: "Set Result (Staff)", value: "challenge_result",
        description: "Staff sets the winner of a challenge",
        guide: [
          "**`/challenge result`** *(Manage Server required)*",
          "",
          "Shows a dropdown of all active (accepted) challenges.",
          "Select one → pick the winner → ranks update automatically.",
          "",
          "**On win:** winner takes loser's rank, everyone between shifts down.",
          "**Loser pushed past board size:** removed from leaderboard.",
        ].join("\n"),
      },
      {
        label: "Forfeit Challenge", value: "challenge_forfeit",
        description: "Forfeit your accepted challenge",
        guide: [
          "**`/challenge forfeit <reason>`**",
          "",
          "Only works on **accepted** (in-progress) challenges.",
          "",
          "No rank change — it's a no-contest.",
          "Both players get 24hr cooldown (forfeiter = unavoidable, other = voidable).",
          "",
          "**Prefix:** `!c forfeit <reason>`",
        ].join("\n"),
      },
      {
        label: "Cancel Cooldown", value: "challenge_cancelcd",
        description: "Cancel your voidable forfeit cooldown",
        guide: [
          "**`/challenge cancelcd`**",
          "",
          "If you're the non-forfeiting player with a **voidable** cooldown, this clears it immediately.",
          "Unavoidable cooldowns (if you forfeited) cannot be cancelled.",
          "",
          "**Prefix:** `!c cancelcd`",
        ].join("\n"),
      },
    ],
  },
  {
    emoji: "📊", label: "Leaderboard", value: "leaderboard",
    description: "View the ranked ladder",
    intro: "The general leaderboard is a fixed-size ranked ladder (default 8 players, configurable). Players enter by registering or beating the bottom player, and climb by challenging above.",
    operations: [
      {
        label: "General Leaderboard", value: "leaderboard_general",
        description: "The persistent ranked ladder",
        guide: [
          "**`/leaderboard general [region]`**",
          "",
          "Shows the ranked ladder for a region. Each position shows the role and the player holding it (or VACANT).",
          "",
          "**Examples:**",
          "`/leaderboard general` — default region",
          "`/leaderboard general region:in` — India region",
          "",
          "**Prefix:** `!lb [region]`",
        ].join("\n"),
      },
      {
        label: "Tournament Leaderboard", value: "leaderboard_tournament",
        description: "Per-tournament standings",
        guide: [
          "**`/leaderboard tournament [id]`**",
          "",
          "Per-tournament standings sorted by wins.",
          "Defaults to the current/most recent tournament. Pass a tournament ID for a specific one.",
        ].join("\n"),
      },
    ],
  },
  {
    emoji: "📈", label: "Rank", value: "rank",
    description: "View individual rank stats",
    intro: "Quick stats card for any player — rank position, W/L record, and tournament history.",
    operations: [
      {
        label: "View Rank", value: "rank_view",
        description: "Show a player's stats card",
        guide: [
          "**`/rank [player]`**",
          "",
          "Shows rank position (medal for top 3), W/L, tournaments played/won.",
          "Defaults to yourself if no player specified.",
          "",
          "**Prefix:** `!r [@player]`",
        ].join("\n"),
      },
    ],
  },
  {
    emoji: "👤", label: "Profile", value: "profile",
    description: "Rich user profile with presence & stats",
    intro: "Full profile embed with Discord presence, activity, server rank, and forfeit cooldown status.",
    operations: [
      {
        label: "View Profile", value: "profile_view",
        description: "Show a rich user profile",
        guide: [
          "**`/profile [@user]`**",
          "",
          "Shows: online status, custom status, current activity (game/Spotify/streaming),",
          "server rank, W/L, tournaments, roles, and active forfeit cooldown if any.",
          "Defaults to yourself.",
          "",
          "**Prefix:** `!p [@player]`",
        ].join("\n"),
      },
    ],
  },
  {
    emoji: "🖥️", label: "Server", value: "server",
    description: "Server stats overview",
    intro: "Live server overview with member counts and bot statistics.",
    operations: [
      {
        label: "Server Stats", value: "server_stats",
        description: "View server overview",
        guide: [
          "**`/server`**",
          "",
          "Shows: member count, online count, total/active tournaments,",
          "matches played, ranked players, total challenges.",
          "",
          "**Prefix:** `!sv`",
        ].join("\n"),
      },
    ],
  },
  {
    emoji: "📜", label: "History", value: "history",
    description: "Match history log",
    intro: "Browse recent matches — both tournament and challenge results with timestamps and forfeit info.",
    operations: [
      {
        label: "View History", value: "history_view",
        description: "Browse match history",
        guide: [
          "**`/history [page] [player]`**",
          "",
          "Shows recent matches: 🏆 tournament / ⚔️ challenge.",
          "Forfeits shown with 🏳️ and reason. Filter by player optionally.",
          "",
          "**Prefix:** `!h [page] [@player]`",
        ].join("\n"),
      },
    ],
  },
  {
    emoji: "📝", label: "Register", value: "register",
    description: "Join the general leaderboard",
    intro: "Register to join the ranked ladder.",
    operations: [
      {
        label: "Register", value: "register_join",
        description: "Join the leaderboard",
        guide: [
          "**`/register [region]`**",
          "",
          "Places you at the bottom rank on the leaderboard for that region.",
          "Use `/challenge` to climb by beating players above you.",
          "",
          "**Examples:**",
          "`/register` — join default region",
          "`/register region:in` — join India region",
          "",
          "**Prefix:** `!register [region]`",
        ].join("\n"),
      },
    ],
  },
  {
    emoji: "⚙️", label: "Setup", value: "setup",
    description: "Server configuration (Admin)",
    intro: "Configure the bot for your server. All setup commands require **Manage Server** permission.",
    operations: [
      {
        label: "Leaderboard Channel", value: "setup_lb_channel",
        description: "Set auto-updating leaderboard channel",
        guide: [
          "**`/setup leaderboard <#channel>`**",
          "",
          "Sets a channel for the auto-updating leaderboard embed.",
          "The bot posts (or edits) a leaderboard message whenever ranks change.",
          "",
          "**Prefix:** `!setup leaderboard #channel`",
        ].join("\n"),
      },
      {
        label: "Leaderboard Size", value: "setup_lb_size",
        description: "Set max players on the ladder",
        guide: [
          "**`/setup leaderboard-size <size>`**",
          "",
          "Max players on the general leaderboard. Default: **8**. Range: 2–100.",
          "When a new player enters by beating the bottom player, the old bottom gets removed.",
          "",
          "**Prefix:** `!setup leaderboard-size <n>`",
        ].join("\n"),
      },
      {
        label: "Prefix", value: "setup_prefix",
        description: "Change text command prefix",
        guide: [
          "**`/setup prefix <prefix>`**",
          "",
          "Change the text command prefix. Default: `!`. Max 5 characters.",
          "Example: `/setup prefix .` → commands become `.t create`, `.lb`, etc.",
          "",
          "**Prefix:** `!setup prefix <prefix>`",
        ].join("\n"),
      },
      {
        label: "Rank Roles", value: "setup_roles",
        description: "Auto-assign roles based on rank position",
        guide: [
          "**`/setup role add <@role> <position> <label> [region]`** — Add a rank role.",
          "**`/setup role remove <@role>`** — Remove a rank role.",
          "**`/setup role list`** — View all configured rank roles.",
          "",
          "Each position gets one role. Roles sync automatically after every rank change.",
          "",
          "**Examples:**",
          "`/setup role add @Strongest 1 Strongest region:in`",
          "`/setup role add @2ndStrongest 2 2nd region:in`",
          "",
          "**Prefix:** `!setup role add @role <position> <region> <label>`",
        ].join("\n"),
      },
      {
        label: "Region Channels", value: "setup_region_channel",
        description: "Set leaderboard channel per region",
        guide: [
          "**`!setup region-channel <region> <#channel>`**",
          "",
          "Each region's leaderboard auto-updates in its own channel.",
          "",
          "**Examples:**",
          "`!setup region-channel in #india-leaderboard`",
          "`!setup region-channel eu #eu-leaderboard`",
          "",
          "Default region uses `!setup leaderboard #channel`.",
        ].join("\n"),
      },
      {
        label: "Top 10 Role", value: "setup_top10",
        description: "Auto-assign role to top 10 players",
        guide: [
          "**`/setup top10role <@role>`**",
          "",
          "Auto-assigns this role to the top 10 ranked players.",
          "Updated whenever ranks change.",
          "",
          "**Prefix:** `!setup top10role @role`",
        ].join("\n"),
      },
      {
        label: "Cooldowns", value: "setup_cooldowns",
        description: "Configure command cooldowns",
        guide: [
          "**`/setup cooldown set <command> <seconds>`** — Set cooldown (1–600s).",
          "**`/setup cooldown reset <command|all>`** — Reset to default.",
          "**`/setup cooldown list`** — View all overrides.",
          "**`/setup cooldown rank-penalty <top_n> <multiplier>`** — Top players get longer CDs.",
          "",
          "**Example:**",
          "`/setup cooldown set challenge 60` → 60s between challenges",
          "`/setup cooldown rank-penalty 5 2.5` → Top 5 get 2.5x cooldowns",
          "",
          "**Prefix:** `!setup cooldown set/reset/list/rank-penalty [args]`",
        ].join("\n"),
      },
      {
        label: "View Config", value: "setup_status",
        description: "View full server configuration",
        guide: [
          "**`/setup status`**",
          "",
          "Shows everything: prefix, leaderboard channel, leaderboard size,",
          "top 10 role, rank roles, cooldown overrides, and rank penalty settings.",
          "",
          "**Prefix:** `!setup status`",
        ].join("\n"),
      },
    ],
  },
  {
    emoji: "🛡️", label: "Admin", value: "admin",
    description: "Leaderboard & forfeit management (Admin)",
    intro: "Manage leaderboard stats and forfeit cooldowns. All admin commands require **Manage Server** permission.",
    operations: [
      {
        label: "View Player", value: "admin_lb_view",
        description: "Inspect a player's full stats",
        guide: [
          "**`/admin leaderboard view <@player>`**",
          "",
          "Shows rank, wins, losses, tournaments won/played.",
          "",
          "**Prefix:** `!admin leaderboard view @player`",
        ].join("\n"),
      },
      {
        label: "Set Stat", value: "admin_lb_set",
        description: "Set a player's stat to a specific value",
        guide: [
          "**`/admin leaderboard set <@player> <stat> <value> [region]`**",
          "",
          "Available stats: `total_wins`, `total_losses`, `tournaments_won`, `tournaments_played`, `rank_position`",
          "",
          "**Setting rank_position:** if someone is already at that rank, you'll be asked to **displace** (shift others down) or **swap** positions.",
          "",
          "**Examples:**",
          "`/admin leaderboard set @player rank_position 1 region:in`",
          "`/admin leaderboard set @player total_wins 10 region:eu`",
        ].join("\n"),
      },
      {
        label: "Adjust Stat", value: "admin_lb_adjust",
        description: "Add or subtract from a stat",
        guide: [
          "**`/admin leaderboard adjust <@player> <stat> <amount>`**",
          "",
          "Use negative numbers to subtract.",
          "Stats: `total_wins`, `total_losses`, `tournaments_won`, `tournaments_played`",
          "",
          "**Example:** `/admin leaderboard adjust @player total_wins 5`",
          "**Prefix:** `!admin leaderboard adjust @player <stat> <amount>`",
        ].join("\n"),
      },
      {
        label: "Remove / Reset", value: "admin_lb_remove",
        description: "Remove a player or wipe all rankings",
        guide: [
          "**`/admin leaderboard remove <@player>`** — Remove from leaderboard.",
          "**`/admin leaderboard reset`** — ⚠️ Wipe all rankings (confirmation required).",
          "",
          "**Prefix:** `!admin leaderboard remove/reset @player`",
        ].join("\n"),
      },
      {
        label: "Forfeit Cooldowns", value: "admin_forfeit",
        description: "Manage forfeit cooldowns",
        guide: [
          "**`/admin forfeit list [@player]`** — View active forfeit cooldowns.",
          "**`/admin forfeit void <@player>`** — Clear a voidable forfeit cooldown.",
          "",
          "Cannot void unavoidable cooldowns (the forfeiter's penalty).",
          "Use when the non-forfeiting player shouldn't be penalized.",
          "",
          "**Prefix:** `!admin forfeit void/list @player`",
        ].join("\n"),
      },
    ],
  },
  {
    emoji: "🏳️", label: "Forfeit System", value: "forfeit",
    description: "How forfeits and cooldowns work",
    intro: "Forfeits are **no-contest** — no winner, no loser, no rank change, no W/L change. Both players enter a 24-hour cooldown.",
    operations: [
      {
        label: "How It Works", value: "forfeit_how",
        description: "Forfeit mechanics explained",
        guide: [
          "A forfeit can happen in **tournament matches** or **challenges**.",
          "Reason is required (e.g. \"AFK\", \"disconnected\").",
          "",
          "**Both players get 24hr cooldown:**",
          "• Forfeiter → **unavoidable** (must wait full 24hrs)",
          "• Other player → **voidable** (self-cancel or admin void)",
          "",
          "**While on cooldown:** can't challenge, accept, or play tournament matches.",
        ].join("\n"),
      },
      {
        label: "Commands", value: "forfeit_commands",
        description: "All forfeit-related commands",
        guide: [
          "**Tournament:** `/match forfeit <match_number> <reason>`",
          "**Challenge:** `/challenge forfeit <reason>`",
          "**Cancel your CD:** `/challenge cancelcd`",
          "**Admin void:** `/admin forfeit void <@player>`",
          "**View active CDs:** `/admin forfeit list [@player]`",
          "",
          "Your profile (`/profile`) also shows active forfeit cooldowns.",
        ].join("\n"),
      },
    ],
  },
];

// ─── Builders ───

const moduleMap = new Map(modules.map((m) => [m.value, m]));
const operationMap = new Map<string, { op: Operation; mod: Module }>();
for (const mod of modules) {
  for (const op of mod.operations) {
    operationMap.set(op.value, { op, mod });
  }
}

const buildMainMenu = () => {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle("📖 Nyxie — Help")
    .setDescription(
      "Welcome to **Nyxie** — your tournament, ranked ladder, and server management companion.\n\n" +
      "Select a module below to learn how it works. Each module has step-by-step guides for every operation.\n\n" +
      "**Quick aliases:** `!t` `!m` `!c` `!lb` `!r` `!p` `!sv` `!h`"
    );

  const select = new StringSelectMenuBuilder()
    .setCustomId("help_module")
    .setPlaceholder("Choose a module...")
    .addOptions(
      modules.map((m) => ({
        label: m.label,
        value: m.value,
        description: m.description,
        emoji: m.emoji,
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  return { embeds: [embed], components: [row] };
};

const buildModuleView = (mod: Module) => {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(`${mod.emoji} ${mod.label}`)
    .setDescription(mod.intro);

  const select = new StringSelectMenuBuilder()
    .setCustomId("help_operation")
    .setPlaceholder("Choose an operation...")
    .addOptions([
      { label: "← Back to modules", value: "back", emoji: "◀️", description: "Return to the main menu" },
      ...mod.operations.map((op) => ({
        label: op.label,
        value: op.value,
        description: op.description,
      })),
    ]);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  return { embeds: [embed], components: [row] };
};

const buildOperationView = (mod: Module, op: Operation) => {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(`${mod.emoji} ${mod.label} — ${op.label}`)
    .setDescription(op.guide);

  const select = new StringSelectMenuBuilder()
    .setCustomId("help_operation")
    .setPlaceholder("Browse other operations...")
    .addOptions([
      { label: "← Back to modules", value: "back", emoji: "◀️", description: "Return to the main menu" },
      ...mod.operations.map((o) => ({
        label: o.label,
        value: o.value,
        description: o.description,
        default: o.value === op.value,
      })),
    ]);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  return { embeds: [embed], components: [row] };
};

// ─── Slash Command ───

const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Interactive help menu — browse all commands and guides");

const execute = async (interaction: ChatInputCommandInteraction) => {
  await interaction.reply(buildMainMenu());
};

// ─── Select Menu Handlers ───

const handleModuleSelect = async (interaction: StringSelectMenuInteraction) => {
  const value = interaction.values[0];
  const mod = moduleMap.get(value);
  if (!mod) return;
  await interaction.update(buildModuleView(mod));
};

const handleOperationSelect = async (interaction: StringSelectMenuInteraction) => {
  const value = interaction.values[0];

  if (value === "back") {
    await interaction.update(buildMainMenu());
    return;
  }

  const entry = operationMap.get(value);
  if (!entry) return;
  await interaction.update(buildOperationView(entry.mod, entry.op));
};

addCommandData(data.toJSON());
registerCommand("help", execute);
registerSelectMenu("help_module", handleModuleSelect);
registerSelectMenu("help_operation", handleOperationSelect);
