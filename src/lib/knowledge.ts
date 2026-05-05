import { readFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");

const load = (path: string) => {
  try { return JSON.parse(readFileSync(join(DATA_DIR, path), "utf-8")); } catch { return null; }
};
const loadText = (path: string) => {
  try { return readFileSync(join(DATA_DIR, path), "utf-8"); } catch { return ""; }
};

// Structured data
const hbgCharacters: Record<string, any> = load("hbg/characters.json") ?? {};
const hbgMechanics: Record<string, string> = load("hbg/mechanics.json") ?? {};
const hbgTierList: string = loadText("hbg/tier-list.txt");
const animeOP: any = load("anime/onepiece.json");
const animeMHA: any = load("anime/mha.json");
const animeAoT: any = load("anime/aot.json");

console.log(`📚 Knowledge: ${Object.keys(hbgCharacters).length} HBG chars, 3 anime loaded`);

// ─── Tool definitions for ReAct agent ───

export const TOOLS = [
  {
    name: "lookup_hbg_character",
    description: "Get HBG character info: moves, damage, cooldowns, pros, cons, awakening. Use when someone asks about a specific character's moves, damage, strengths, weaknesses.",
    params: "character_name (string)",
  },
  {
    name: "lookup_hbg_mechanic",
    description: "Get HBG game mechanic info (mastery, ranked, IWO, dash, ultimate, the_prototype). Use when someone asks how a game system works.",
    params: "mechanic_name (string): one of mastery, ranked, iwo, dash, ultimate, the_prototype",
  },
  {
    name: "lookup_hbg_tier_list",
    description: "Get the current HBG tier list. Use when someone asks about best/worst characters or meta.",
    params: "none",
  },
  {
    name: "lookup_anime",
    description: "Get anime knowledge (One Piece, MHA, or AoT). Use when someone asks about anime characters, arcs, power systems, or wants your opinion on anime.",
    params: "anime_name (string): one of onepiece, mha, aot",
  },
];

// ─── Tool execution ───

const charAliases: Record<string, string> = {};
for (const name of Object.keys(hbgCharacters)) {
  const lower = name.toLowerCase();
  charAliases[lower] = name;
}
// Add common aliases
const aliasMap: Record<string, string> = {
  deku: "Green Hero", green: "Green Hero", izuku: "Green Hero", midoriya: "Green Hero",
  stain: "Hero Slayer", slayer: "Hero Slayer", "hero killer": "Hero Slayer",
  todoroki: "Split Ice", shoto: "Split Ice", "icy hot": "Split Ice",
  bakugo: "Explosion Hero", bakugou: "Explosion Hero", katsuki: "Explosion Hero", dynamight: "Explosion Hero",
  dabi: "Azure Flames", "blue flames": "Azure Flames", toya: "Azure Flames",
  kurogiri: "Warp Portal", warp: "Warp Portal",
  shigaraki: "Decaying Hatred", tomura: "Decaying Hatred", decay: "Decaying Hatred",
  iida: "Full Throttle", ingenium: "Full Throttle",
  hawks: "Winged Assassin", keigo: "Winged Assassin",
  overhaul: "Human Architect", chisaki: "Human Architect",
  gojo: "The Strongest", satoru: "The Strongest",
  "mt lady": "Huge Lady",
  nomu: "The Prototype", prototype: "The Prototype",
  "mastered deku": "Mastered Green Hero", "mastered green": "Mastered Green Hero",
  "mastered stain": "Mastered Hero Slayer", "mastered slayer": "Mastered Hero Slayer",
  "mastered todoroki": "Mastered Split Ice", "mastered split": "Mastered Split Ice",
  "mastered dabi": "Mastered Azure Flames", "mastered azure": "Mastered Azure Flames",
};

const resolveCharacter = (input: string): string | null => {
  const lower = input.toLowerCase().trim();
  if (charAliases[lower]) return charAliases[lower];
  if (aliasMap[lower]) return aliasMap[lower];
  // Fuzzy: only if input is 3+ chars
  if (lower.length >= 3) {
    for (const [alias, name] of Object.entries(aliasMap)) {
      if (lower.includes(alias) && alias.length >= 3) return name;
      if (alias.includes(lower) && lower.length >= 4) return name;
    }
    for (const name of Object.keys(hbgCharacters)) {
      if (name.toLowerCase().includes(lower) && lower.length >= 4) return name;
    }
  }
  return null;
};

export const executeTool = (toolName: string, params: string): string => {
  switch (toolName) {
    case "lookup_hbg_character": {
      const name = resolveCharacter(params);
      if (!name || !hbgCharacters[name]) return `NOT_FOUND: No character matching "${params}". Available: ${Object.keys(hbgCharacters).join(", ")}`;
      const char = hbgCharacters[name];
      return JSON.stringify({ name, ...char }, null, 1);
    }
    case "lookup_hbg_mechanic": {
      const key = params.toLowerCase().trim().replace(/\s+/g, "_");
      if (hbgMechanics[key]) return `${key}: ${hbgMechanics[key]}`;
      return `NOT_FOUND: Unknown mechanic "${params}". Available: ${Object.keys(hbgMechanics).join(", ")}`;
    }
    case "lookup_hbg_tier_list":
      return hbgTierList || "Tier list data not available.";
    case "lookup_anime": {
      const p = params.toLowerCase().trim();
      if (p.includes("one piece") || p === "onepiece" || p === "op") return JSON.stringify(animeOP, null, 1);
      if (p.includes("mha") || p.includes("my hero") || p.includes("bnha") || p.includes("hero academia")) return JSON.stringify(animeMHA, null, 1);
      if (p.includes("aot") || p.includes("attack on titan") || p.includes("snk") || p.includes("shingeki")) return JSON.stringify(animeAoT, null, 1);
      return `NOT_FOUND: Unknown anime "${params}". Available: onepiece, mha, aot`;
    }
    default:
      return `UNKNOWN_TOOL: "${toolName}"`;
  }
};

export const TOOL_DESCRIPTIONS = TOOLS.map(t => `- ${t.name}(${t.params}): ${t.description}`).join("\n");

export const ANIME_RANKINGS = "Top anime: #1 One Piece (goat no debate), #2 MHA (flawed but grew up with it, post-war is peak), #3 AoT (peak until the ending ruined Eren).";
