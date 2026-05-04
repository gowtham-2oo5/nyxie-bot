import {
  Client,
  GatewayIntentBits,
  Events,
} from "discord.js";
import { config } from "./config";
import { handleInteraction } from "./handlers/interaction";
import { handleMessage } from "./handlers/message";
import { pool } from "./db";
import { cleanupExpiredForfeits } from "./lib/forfeit";
import { cleanupStaleChallenges } from "./lib/cleanup";
import { api, setClient } from "./api";
import { setWsClient, handleWsMessage, handleWsClose } from "./lib/ws";

// Load commands
import "./commands/help";
import "./commands/tournament";
import "./commands/match";
import "./commands/leaderboard";
import "./commands/rank";
import "./commands/challenge";
import "./commands/profile";
import "./commands/server";
import "./commands/history";
import "./commands/setup";
import "./commands/admin";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (c) => {
  await cleanupExpiredForfeits();
  await cleanupStaleChallenges();
  setClient(client);
  setWsClient(client);
  // Pre-fetch all guild members into cache
  for (const guild of client.guilds.cache.values()) {
    await guild.members.fetch().catch(() => {});
  }
  console.log(`✅ Logged in as ${c.user.tag}`);
});

// REST API + WebSocket
const API_PORT = parseInt(process.env.API_PORT ?? "3001");
Bun.serve({
  port: API_PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined as any;
    }
    return api.fetch(req);
  },
  websocket: {
    open(ws) {
      console.log("🔌 WebSocket client connected");
    },
    message(ws, message) {
      handleWsMessage(ws, String(message));
    },
    close(ws) {
      handleWsClose(ws);
      console.log("🔌 WebSocket client disconnected");
    },
  },
});
console.log(`🌐 API + WebSocket running on port ${API_PORT}`);

// Export for use in other modules
export { client };

client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.MessageCreate, handleMessage);

// Graceful shutdown
const shutdown = async () => {
  console.log("🔌 Shutting down...");
  client.destroy();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

client.login(config.botToken);
