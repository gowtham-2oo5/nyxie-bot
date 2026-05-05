import { Database } from "bun:sqlite";

const db = new Database("nyxie-memory.db", { create: true });

// Initialize tables
db.run(`CREATE TABLE IF NOT EXISTS chat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

db.run(`CREATE TABLE IF NOT EXISTS user_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  fact TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_history_channel ON chat_history(channel_id, created_at DESC)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_memory_user ON user_memory(user_id)`);

const MAX_HISTORY = 20;

// ─── Chat History ───

export const addMessage = (channelId: string, role: string, content: string) => {
  db.run(`INSERT INTO chat_history (channel_id, role, content) VALUES (?, ?, ?)`, [channelId, role, content]);
  // Prune old messages per channel
  db.run(`DELETE FROM chat_history WHERE channel_id = ? AND id NOT IN (
    SELECT id FROM chat_history WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?
  )`, [channelId, channelId, MAX_HISTORY]);
};

export const getHistory = (channelId: string, limit = 10): { role: string; content: string }[] => {
  return db.query(`SELECT role, content FROM chat_history WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(channelId, limit)
    .reverse() as { role: string; content: string }[];
};

// ─── User Memory ───

export const addUserFact = (userId: string, fact: string) => {
  // Avoid exact duplicates
  const existing = db.query(`SELECT id FROM user_memory WHERE user_id = ? AND fact = ?`).get(userId, fact);
  if (existing) return;
  db.run(`INSERT INTO user_memory (user_id, fact) VALUES (?, ?)`, [userId, fact]);
};

export const getUserFacts = (userId: string): string[] => {
  return (db.query(`SELECT fact FROM user_memory WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`)
    .all(userId) as { fact: string }[])
    .map((r) => r.fact);
};

export const clearUserMemory = (userId: string) => {
  db.run(`DELETE FROM user_memory WHERE user_id = ?`, [userId]);
};

export const clearChannelHistory = (channelId: string) => {
  db.run(`DELETE FROM chat_history WHERE channel_id = ?`, [channelId]);
};
