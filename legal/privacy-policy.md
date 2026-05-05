# Privacy Policy

**Last updated:** May 5, 2026

Nyxie ("the Bot") is a Discord bot operated by Gowtham A ("we", "us"). This policy explains what data we collect and how we use it.

## Data We Collect

### Automatically Collected
When you interact with Nyxie in a Discord server, we collect:
- **Discord User ID and username** — to identify you on leaderboards and in match records
- **Server (Guild) ID** — to separate data between servers
- **Role information** — to display rank roles on the leaderboard
- **Presence/activity data** — temporarily cached in memory for the profile command and WebSocket API; never stored permanently
- **Chat messages (when Nyxie is mentioned)** — stored locally in SQLite for conversation context; limited to last 20 messages per channel

### User-Provided
When you use commands, we store:
- Challenge records (participants, results, scores)
- Tournament participation and results
- Leaderboard rankings and stats (wins, losses, tournaments)
- Forfeit cooldown records
- Server configuration (prefix, channels, role mappings)

### AI Chatbot Memory
When you chat with Nyxie (by mentioning her), we store:
- **Channel conversation history** — last 20 messages per channel for conversational context
- **User facts** — personal details Nyxie learns from conversations (preferences, hobbies, etc.) to provide a more personalized experience

This data is stored locally in a SQLite database on the bot's host machine. Chat messages are sent to Groq (our AI inference provider) for response generation.

## Data We Do NOT Collect
- Message content from conversations where Nyxie is not mentioned
- Direct messages
- Email addresses, IP addresses, or payment information
- Data from servers where Nyxie is not present
- Data from users who have not interacted with Nyxie

## Third-Party Services
- **Groq** — We send chat messages to Groq's API for AI response generation. Groq's privacy policy applies to data processed by their service. We only send messages where Nyxie is directly mentioned.

## How We Use Data
- Display leaderboards and player profiles
- Track challenge and tournament results
- Manage ranked positions and role assignments
- Serve data via our REST API and WebSocket for the Nyxie web dashboard
- Enforce cooldown systems
- Generate AI chatbot responses with conversational context

## Data Sharing
We do not sell, trade, or share your data with third parties. Data is accessible via:
- The Nyxie web dashboard (leaderboard, profiles — publicly visible within your server's context)
- The REST API and WebSocket endpoints (scoped to guild ID)
- Groq API (chat messages only, for AI response generation)

## Data Retention
- Leaderboard and match data is retained indefinitely unless an admin resets it
- Forfeit cooldowns expire automatically after 24 hours
- Challenge records are kept for match history purposes
- Server configuration is retained while the bot is in the server
- Chat history is limited to 20 messages per channel (older messages are automatically pruned)
- User memory facts are retained indefinitely unless manually cleared

## Data Deletion
- Server admins can wipe leaderboard data using `/admin leaderboard reset`
- Removing Nyxie from your server does not automatically delete stored data
- To request full data deletion (including chat memory), contact us (see below)

## Security
Data is stored in a private MySQL database and local SQLite file accessible only to the bot. The API does not require authentication but is scoped by guild ID and does not expose sensitive information.

## Children's Privacy
Nyxie does not knowingly collect data from users under 13. Discord's Terms of Service require users to be at least 13 years old.

## Changes
We may update this policy. Changes will be posted on this page with an updated date.

## Contact
For questions or data deletion requests:
- GitHub: [github.com/gowtham-2oo5/nyxie-bot](https://github.com/gowtham-2oo5/nyxie-bot)
- Discord: Contact the server admin where Nyxie is installed
