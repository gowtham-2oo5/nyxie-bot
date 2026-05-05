import { Database } from "bun:sqlite";

const db = new Database("nyxie-memory.db", { create: true });

db.run(`CREATE TABLE IF NOT EXISTS chat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
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

db.run(`CREATE TABLE IF NOT EXISTS server_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  context TEXT NOT NULL,
  added_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_history_channel ON chat_history(channel_id, created_at DESC)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_memory_user ON user_memory(user_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_server_context_guild ON server_context(guild_id)`);

// ─── Mood & Opinions ───

db.run(`CREATE TABLE IF NOT EXISTS nyxie_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mood TEXT NOT NULL DEFAULT 'chill',
  energy INTEGER NOT NULL DEFAULT 70,
  last_active INTEGER NOT NULL DEFAULT (unixepoch()),
  messages_since_last INTEGER NOT NULL DEFAULT 0
)`);

db.run(`CREATE TABLE IF NOT EXISTS user_opinions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  affinity INTEGER NOT NULL DEFAULT 50,
  vibe TEXT NOT NULL DEFAULT 'neutral',
  notes TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

// Ensure state row exists
db.run(`INSERT OR IGNORE INTO nyxie_state (id, mood, energy) VALUES (1, 'happy', 90)`);

const MAX_HISTORY = 20;

// ─── Chat History ───

export const addMessage = (channelId: string, userId: string, displayName: string, role: string, content: string) => {
  db.run(
    `INSERT INTO chat_history (channel_id, user_id, display_name, role, content) VALUES (?, ?, ?, ?, ?)`,
    [channelId, userId, displayName, role, content]
  );
  db.run(`DELETE FROM chat_history WHERE channel_id = ? AND id NOT IN (
    SELECT id FROM chat_history WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?
  )`, [channelId, channelId, MAX_HISTORY]);
};

export const getHistory = (channelId: string, limit = 15): { role: string; content: string; userId: string; displayName: string }[] => {
  return db.query(
    `SELECT role, content, user_id as userId, display_name as displayName FROM chat_history WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(channelId, limit).reverse() as any[];
};

// ─── User Memory ───

export const addUserFact = (userId: string, fact: string) => {
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

// ─── Nyxie State (Mood & Energy) ───

type NyxieState = { mood: string; energy: number; last_active: number; messages_since_last: number };

export const getState = (): NyxieState => {
  return db.query(`SELECT mood, energy, last_active, messages_since_last FROM nyxie_state WHERE id = 1`).get() as NyxieState;
};

export const updateState = (updates: Partial<{ mood: string; energy: number; last_active: number; messages_since_last: number }>) => {
  const sets: string[] = [];
  const vals: any[] = [];
  if (updates.mood !== undefined) { sets.push("mood = ?"); vals.push(updates.mood); }
  if (updates.energy !== undefined) { sets.push("energy = ?"); vals.push(Math.max(0, Math.min(100, updates.energy))); }
  if (updates.last_active !== undefined) { sets.push("last_active = ?"); vals.push(updates.last_active); }
  if (updates.messages_since_last !== undefined) { sets.push("messages_since_last = ?"); vals.push(updates.messages_since_last); }
  if (sets.length) db.run(`UPDATE nyxie_state SET ${sets.join(", ")} WHERE id = 1`, vals);
};

// ─── User Opinions ───

type UserOpinion = { user_id: string; display_name: string; affinity: number; vibe: string; notes: string | null };

export const getOpinion = (userId: string): UserOpinion | null => {
  return db.query(`SELECT user_id, display_name, affinity, vibe, notes FROM user_opinions WHERE user_id = ?`).get(userId) as UserOpinion | null;
};

export const setOpinion = (userId: string, displayName: string, affinity: number, vibe: string, notes?: string) => {
  db.run(
    `INSERT INTO user_opinions (user_id, display_name, affinity, vibe, notes, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET display_name = ?, affinity = ?, vibe = ?, notes = ?, updated_at = unixepoch()`,
    [userId, displayName, affinity, vibe, notes ?? null, displayName, affinity, vibe, notes ?? null]
  );
};

export const adjustAffinity = (userId: string, displayName: string, delta: number) => {
  const existing = getOpinion(userId);
  const newAffinity = Math.max(0, Math.min(100, (existing?.affinity ?? 50) + delta));
  const vibe = newAffinity >= 75 ? "loves" : newAffinity >= 60 ? "likes" : newAffinity <= 25 ? "annoyed by" : newAffinity <= 40 ? "meh about" : "neutral";
  setOpinion(userId, displayName, newAffinity, vibe, existing?.notes);
};

export const getAllOpinions = (): UserOpinion[] => {
  return db.query(`SELECT user_id, display_name, affinity, vibe, notes FROM user_opinions ORDER BY affinity DESC`).all() as UserOpinion[];
};


// ─── Server Context (admin-added instructions) ───

export const addServerContext = (guildId: string, context: string, addedBy: string) => {
  db.run(`INSERT INTO server_context (guild_id, context, added_by) VALUES (?, ?, ?)`, [guildId, context, addedBy]);
};

export const getServerContext = (guildId: string): string[] => {
  return (db.query(`SELECT context FROM server_context WHERE guild_id = ? ORDER BY created_at ASC`)
    .all(guildId) as { context: string }[])
    .map((r) => r.context);
};

export const removeServerContext = (guildId: string, id: number): boolean => {
  const existing = db.query(`SELECT id FROM server_context WHERE guild_id = ? AND id = ?`).get(guildId, id);
  if (!existing) return false;
  db.run(`DELETE FROM server_context WHERE id = ?`, [id]);
  return true;
};

export const listServerContext = (guildId: string): { id: number; context: string; addedBy: string }[] => {
  return db.query(`SELECT id, context, added_by as addedBy FROM server_context WHERE guild_id = ? ORDER BY created_at ASC`)
    .all(guildId) as any[];
};
