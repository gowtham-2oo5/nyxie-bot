# Privacy Policy

**Last updated:** May 4, 2026

Nyxie ("the Bot") is a Discord bot operated by Gowtham A ("we", "us"). This policy explains what data we collect and how we use it.

## Data We Collect

### Automatically Collected
When you interact with Nyxie in a Discord server, we collect:
- **Discord User ID and username** — to identify you on leaderboards and in match records
- **Server (Guild) ID** — to separate data between servers
- **Role information** — to display rank roles on the leaderboard
- **Presence/activity data** — temporarily cached in memory for the profile command and WebSocket API; never stored permanently

### User-Provided
When you use commands, we store:
- Challenge records (participants, results, scores)
- Tournament participation and results
- Leaderboard rankings and stats (wins, losses, tournaments)
- Forfeit cooldown records
- Server configuration (prefix, channels, role mappings)

## Data We Do NOT Collect
- Message content (read only for prefix command parsing, never stored)
- Direct messages
- Email addresses, IP addresses, or payment information
- Data from servers where Nyxie is not present
- Data from users who have not interacted with Nyxie

## How We Use Data
- Display leaderboards and player profiles
- Track challenge and tournament results
- Manage ranked positions and role assignments
- Serve data via our REST API and WebSocket for the Nyxie web dashboard
- Enforce cooldown systems

## Data Sharing
We do not sell, trade, or share your data with third parties. Data is accessible via:
- The Nyxie web dashboard (leaderboard, profiles — publicly visible within your server's context)
- The REST API and WebSocket endpoints (scoped to guild ID)

## Data Retention
- Leaderboard and match data is retained indefinitely unless an admin resets it
- Forfeit cooldowns expire automatically after 24 hours
- Challenge records are kept for match history purposes
- Server configuration is retained while the bot is in the server

## Data Deletion
- Server admins can wipe leaderboard data using `/admin leaderboard reset`
- Removing Nyxie from your server does not automatically delete stored data
- To request full data deletion, contact us (see below)

## Security
Data is stored in a private MySQL database accessible only to the bot. The API does not require authentication but is scoped by guild ID and does not expose sensitive information.

## Children's Privacy
Nyxie does not knowingly collect data from users under 13. Discord's Terms of Service require users to be at least 13 years old.

## Changes
We may update this policy. Changes will be posted on this page with an updated date.

## Contact
For questions or data deletion requests:
- GitHub: [github.com/gowtham-2oo5/nyx-bot](https://github.com/gowtham-2oo5/nyx-bot)
- Discord: Contact the server admin where Nyxie is installed
