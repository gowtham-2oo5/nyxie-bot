# Nyxie

A Discord bot for ranked leaderboards, 1v1 challenges, tournaments, AI chatbot, and server management.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Bun |
| Language | TypeScript |
| Discord | discord.js v14 |
| Database | MySQL (MariaDB) + SQLite (chat memory) |
| ORM | Drizzle ORM |
| REST API | Hono |
| WebSocket | Bun native |
| AI | Groq (Llama 3.3 70B) |

## Features

- **AI Chatbot** — Mention Nyxie to chat. Persistent memory per channel + per user, powered by Groq LLM
- **Ranked Leaderboard** — Fixed-size ladder with role-based positions, region support, auto-updating channel messages
- **1v1 Challenges** — Challenge players above you, staff-verified results, automatic cooldowns, 24hr expiry with auto-forfeit
- **Tournaments** — Single-elimination brackets with auto-advancing rounds
- **Forfeit System** — Voidable/unavoidable cooldowns, admin overrides
- **REST API** — Leaderboard, player profiles, tournaments, server stats
- **WebSocket** — Live presence updates, leaderboard pushes, member counts
- **Interactive Help** — Multi-level dropdown menu with guides for every command

## Setup

```bash
bun install
cp .env.example .env  # fill in values
bun run db:push
bun run deploy-commands
bun run dev
```

## Environment Variables

```env
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DATABASE_URL=mysql://user:pass@localhost:3306/nyx_bot
GUILD_ID=              # optional, for instant slash command updates in dev
API_PORT=3001          # optional, default 3001
GROQ_API_KEY=          # for AI chatbot
```

## Discord Developer Portal

Enable these under **Bot → Privileged Gateway Intents**:
- ✅ Presence Intent
- ✅ Server Members Intent
- ✅ Message Content Intent

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start the bot |
| `bun run deploy-commands` | Register slash commands with Discord |
| `bun run db:push` | Push schema changes to MySQL |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run test` | Run tests |

## Commands

### Player Commands
| Command | Description |
|---------|-------------|
| `@Nyxie <anything>` | Chat with Nyxie (AI-powered) |
| `/challenge player @target` | Challenge a ranked player |
| `/challenge forfeit <reason>` | Forfeit your accepted challenge |
| `/challenge cancelcd` | Cancel your voidable cooldown |
| `/register [region]` | Join the leaderboard |
| `/leaderboard general [region]` | View the ranked ladder |
| `/rank [@player]` | View rank stats |
| `/profile [@user]` | Rich user profile |
| `/server` | Server stats |
| `/history [player]` | Match history |
| `/help` | Interactive help menu |

### Staff Commands (Manage Server)
| Command | Description |
|---------|-------------|
| `/challenge result` | Set challenge winner via dropdown |
| `/tournament create/start/end` | Tournament management |
| `/match report/forfeit/list` | Tournament match management |
| `/admin leaderboard set/adjust/remove/reset` | Leaderboard management |
| `/admin forfeit void/list` | Cooldown management |
| `/setup` | Server configuration |

### Prefix Commands
All commands available with prefix (default `!`). Aliases: `!t` `!m` `!c` `!lb` `!r` `!p` `!sv` `!h`

## AI Chatbot

Nyxie responds when mentioned. She has:
- **Channel memory** — remembers last 20 messages per channel (persists across restarts via SQLite)
- **User memory** — learns facts about users over time (preferences, hobbies, etc.)
- **Personality** — anime-coded, nonchalant, Gen Z energy, MHA/HBG clan-aware
- **Hinglish support** — responds in Hindi/English mix when users speak Hinglish

## WebSocket API

Connect to `ws://localhost:3001/ws`

### Fetch members by role
```json
{ "type": "members_by_roles", "guildId": "...", "roleIds": ["..."] }
```

### Subscribe to presence updates
```json
{ "type": "subscribe", "guildId": "...", "roleIds": ["..."] }
```
Pushes `presence_update` events on activity/status changes.

### Leaderboard (with live updates)
```json
{ "type": "leaderboard", "guildId": "...", "region": "default" }
```
Returns initial data + pushes `leaderboard_update` on rank changes.

### Live server stats
```json
{ "type": "stats", "guildId": "..." }
```
Returns counts + pushes `stats_update` on member join/leave/presence change.

## Project Structure

```
src/
├── index.ts              # Entry point, client setup, Bun.serve
├── config.ts             # Env validation
├── api.ts                # Hono REST API
├── deploy-commands.ts    # Slash command registration
├── db/
│   ├── index.ts          # Drizzle client + pool
│   └── schema.ts         # All table definitions
├── handlers/
│   ├── interaction.ts    # Slash, button, select, modal, autocomplete dispatch
│   └── message.ts        # Prefix command handler + chatbot trigger
├── commands/
│   ├── help.ts           # Interactive help menu
│   ├── challenge.ts      # Challenge system
│   ├── tournament.ts     # Tournament CRUD
│   ├── match.ts          # Tournament match reporting
│   ├── leaderboard.ts    # Leaderboard display
│   ├── rank.ts           # Individual rank stats
│   ├── profile.ts        # User profile
│   ├── server.ts         # Server stats
│   ├── history.ts        # Match history
│   ├── register.ts       # Leaderboard registration
│   ├── setup.ts          # Server config
│   └── admin.ts          # Admin operations
└── lib/
    ├── chat.ts           # AI chatbot (Groq LLM)
    ├── memory.ts         # SQLite chat/user memory
    ├── rank-ops.ts       # Transactional rank operations
    ├── leaderboard.ts    # Role sync, channel refresh
    ├── bracket.ts        # Tournament bracket generation
    ├── forfeit.ts        # Cooldown management
    ├── cleanup.ts        # Stale challenge cleanup
    ├── prefix-cache.ts   # Per-guild prefix caching
    ├── presence.ts       # Presence formatting
    ├── embeds.ts         # Shared embed builders
    └── ws.ts             # WebSocket handlers + subscriptions
```

## License

ISC
