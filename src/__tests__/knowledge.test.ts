import { describe, test, expect } from "bun:test";
import { executeTool, TOOL_DESCRIPTIONS, ANIME_RANKINGS } from "../lib/knowledge";

describe("knowledge module", () => {
  describe("executeTool — lookup_hbg_character", () => {
    test("resolves exact character name", () => {
      const result = executeTool("lookup_hbg_character", "Green Hero");
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("Green Hero");
      expect(parsed.based_on).toBe("Izuku Midoriya (Deku)");
      expect(parsed.moves).toBeArray();
      expect(parsed.moves.length).toBeGreaterThan(0);
    });

    test("resolves alias 'deku' to Green Hero", () => {
      const result = executeTool("lookup_hbg_character", "deku");
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("Green Hero");
    });

    test("resolves alias 'bakugo' to Explosion Hero", () => {
      const result = executeTool("lookup_hbg_character", "bakugo");
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("Explosion Hero");
      expect(parsed.based_on).toContain("Bakugo");
    });

    test("resolves alias 'stain' to Hero Slayer", () => {
      const result = executeTool("lookup_hbg_character", "stain");
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("Hero Slayer");
    });

    test("resolves alias 'todoroki' to Split Ice", () => {
      const result = executeTool("lookup_hbg_character", "todoroki");
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("Split Ice");
    });

    test("resolves alias 'gojo' to The Strongest", () => {
      const result = executeTool("lookup_hbg_character", "gojo");
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("The Strongest");
    });

    test("resolves alias 'shigaraki' to Decaying Hatred", () => {
      const result = executeTool("lookup_hbg_character", "shigaraki");
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("Decaying Hatred");
    });

    test("resolves mastered variants", () => {
      const result = executeTool("lookup_hbg_character", "mastered deku");
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("Mastered Green Hero");
    });

    test("returns NOT_FOUND for unknown character", () => {
      const result = executeTool("lookup_hbg_character", "naruto");
      expect(result).toContain("NOT_FOUND");
      expect(result).toContain("Available:");
    });

    test("character data has moves with damage values", () => {
      const result = executeTool("lookup_hbg_character", "explosion hero");
      const parsed = JSON.parse(result);
      expect(parsed.moves.length).toBeGreaterThan(5);
      // At least some moves should have damage
      const movesWithDamage = parsed.moves.filter((m: any) => m.damage);
      expect(movesWithDamage.length).toBeGreaterThan(0);
    });

    test("character data has pros and cons", () => {
      const result = executeTool("lookup_hbg_character", "split ice");
      const parsed = JSON.parse(result);
      expect(parsed.pros.length).toBeGreaterThan(0);
      expect(parsed.cons.length).toBeGreaterThan(0);
    });

    test("character has awakening name", () => {
      const result = executeTool("lookup_hbg_character", "hero slayer");
      const parsed = JSON.parse(result);
      expect(parsed.awakening).toBeTruthy();
    });

    test("case insensitive lookup", () => {
      const result = executeTool("lookup_hbg_character", "DABI");
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("Azure Flames");
    });
  });

  describe("executeTool — lookup_hbg_mechanic", () => {
    test("returns mastery info", () => {
      const result = executeTool("lookup_hbg_mechanic", "mastery");
      expect(result).toContain("mastery");
      expect(result).not.toContain("NOT_FOUND");
    });

    test("returns IWO info", () => {
      const result = executeTool("lookup_hbg_mechanic", "iwo");
      expect(result).toContain("iwo");
      expect(result).toContain("Unblockable");
    });

    test("returns dash info", () => {
      const result = executeTool("lookup_hbg_mechanic", "dash");
      expect(result).toContain("dash");
    });

    test("returns ultimate info", () => {
      const result = executeTool("lookup_hbg_mechanic", "ultimate");
      expect(result).toContain("ultimate");
    });

    test("returns the_prototype info", () => {
      const result = executeTool("lookup_hbg_mechanic", "the_prototype");
      expect(result).toContain("500 HP");
    });

    test("handles spaces in mechanic name", () => {
      const result = executeTool("lookup_hbg_mechanic", "the prototype");
      expect(result).toContain("500 HP");
    });

    test("returns NOT_FOUND for unknown mechanic", () => {
      const result = executeTool("lookup_hbg_mechanic", "flying");
      expect(result).toContain("NOT_FOUND");
      expect(result).toContain("Available:");
    });
  });

  describe("executeTool — lookup_hbg_tier_list", () => {
    test("returns tier list content", () => {
      const result = executeTool("lookup_hbg_tier_list", "");
      expect(result.length).toBeGreaterThan(100);
    });
  });

  describe("executeTool — lookup_anime", () => {
    test("returns One Piece data for 'onepiece'", () => {
      const result = executeTool("lookup_anime", "onepiece");
      const parsed = JSON.parse(result);
      expect(parsed.title).toBe("One Piece");
      expect(parsed.rank).toBe(1);
      expect(parsed.crew).toBeDefined();
      expect(parsed.crew.Luffy).toContain("Pirate King");
    });

    test("returns One Piece data for 'op'", () => {
      const result = executeTool("lookup_anime", "op");
      const parsed = JSON.parse(result);
      expect(parsed.title).toBe("One Piece");
    });

    test("returns One Piece data for 'one piece'", () => {
      const result = executeTool("lookup_anime", "one piece");
      const parsed = JSON.parse(result);
      expect(parsed.title).toBe("One Piece");
    });

    test("returns MHA data", () => {
      const result = executeTool("lookup_anime", "mha");
      const parsed = JSON.parse(result);
      expect(parsed.title).toBe("My Hero Academia");
      expect(parsed.rank).toBe(2);
      expect(parsed.power_system.quirks).toBeDefined();
      expect(parsed.villains).toBeDefined();
    });

    test("returns MHA for 'my hero academia'", () => {
      const result = executeTool("lookup_anime", "my hero academia");
      const parsed = JSON.parse(result);
      expect(parsed.title).toBe("My Hero Academia");
    });

    test("returns AoT data", () => {
      const result = executeTool("lookup_anime", "aot");
      const parsed = JSON.parse(result);
      expect(parsed.title).toBe("Attack on Titan");
      expect(parsed.rank).toBe(3);
      expect(parsed.nine_titans).toBeDefined();
      expect(parsed.nine_titans.Founding).toContain("Eren");
    });

    test("returns AoT for 'attack on titan'", () => {
      const result = executeTool("lookup_anime", "attack on titan");
      const parsed = JSON.parse(result);
      expect(parsed.title).toBe("Attack on Titan");
    });

    test("returns NOT_FOUND for unknown anime", () => {
      const result = executeTool("lookup_anime", "naruto");
      expect(result).toContain("NOT_FOUND");
    });

    test("anime rankings are correct order", () => {
      const op = JSON.parse(executeTool("lookup_anime", "op"));
      const mha = JSON.parse(executeTool("lookup_anime", "mha"));
      const aot = JSON.parse(executeTool("lookup_anime", "aot"));
      expect(op.rank).toBe(1);
      expect(mha.rank).toBe(2);
      expect(aot.rank).toBe(3);
    });
  });

  describe("executeTool — unknown tool", () => {
    test("returns UNKNOWN_TOOL for invalid tool name", () => {
      const result = executeTool("fake_tool", "test");
      expect(result).toContain("UNKNOWN_TOOL");
    });
  });

  describe("TOOL_DESCRIPTIONS", () => {
    test("contains all 4 tools", () => {
      expect(TOOL_DESCRIPTIONS).toContain("lookup_hbg_character");
      expect(TOOL_DESCRIPTIONS).toContain("lookup_hbg_mechanic");
      expect(TOOL_DESCRIPTIONS).toContain("lookup_hbg_tier_list");
      expect(TOOL_DESCRIPTIONS).toContain("lookup_anime");
    });
  });

  describe("ANIME_RANKINGS", () => {
    test("mentions all 3 anime in order", () => {
      const opIdx = ANIME_RANKINGS.indexOf("One Piece");
      const mhaIdx = ANIME_RANKINGS.indexOf("MHA");
      const aotIdx = ANIME_RANKINGS.indexOf("AoT");
      expect(opIdx).toBeGreaterThan(-1);
      expect(mhaIdx).toBeGreaterThan(-1);
      expect(aotIdx).toBeGreaterThan(-1);
      expect(opIdx).toBeLessThan(mhaIdx);
      expect(mhaIdx).toBeLessThan(aotIdx);
    });
  });
});

describe("ReAct integration — regex parsing", () => {
  const actionRegex = /ACTION:\s*(\w+)\(([^)]*)\)/g;

  test("parses single ACTION line", () => {
    const text = "THOUGHT: need to check deku\nACTION: lookup_hbg_character(green hero)";
    const matches = [...text.matchAll(actionRegex)];
    expect(matches.length).toBe(1);
    expect(matches[0][1]).toBe("lookup_hbg_character");
    expect(matches[0][2]).toBe("green hero");
  });

  test("parses multiple ACTION lines", () => {
    const text = `THOUGHT: need character info
ACTION: lookup_hbg_character(bakugo)

THOUGHT: also need tier list
ACTION: lookup_hbg_tier_list()`;
    const matches = [...text.matchAll(actionRegex)];
    expect(matches.length).toBe(2);
    expect(matches[0][1]).toBe("lookup_hbg_character");
    expect(matches[0][2]).toBe("bakugo");
    expect(matches[1][1]).toBe("lookup_hbg_tier_list");
    expect(matches[1][2]).toBe("");
  });

  test("parses ACTION with anime param", () => {
    const text = "THOUGHT: they asked about one piece\nACTION: lookup_anime(onepiece)";
    const matches = [...text.matchAll(actionRegex)];
    expect(matches.length).toBe(1);
    expect(matches[0][1]).toBe("lookup_anime");
    expect(matches[0][2]).toBe("onepiece");
  });

  test("no match on casual reply without ACTION", () => {
    const text = "nah that's just wrong, deku is mid tier at best";
    const matches = [...text.matchAll(actionRegex)];
    expect(matches.length).toBe(0);
  });
});

describe("isGameOrAnime detection regex", () => {
  const isGameOrAnime = (msg: string) =>
    /\b(hbg|heroes battlegrounds|quirk|m1|combo|ragdoll|iwo|awakening|mastery|ranked|tier|finisher|cooldown|deku|bakugo|todoroki|stain|dabi|shigaraki|hawks|overhaul|gojo|one piece|luffy|zoro|mha|aot|titan|eren|levi)\b/i.test(msg);

  test("detects HBG keywords", () => {
    expect(isGameOrAnime("what's the best combo for deku")).toBe(true);
    expect(isGameOrAnime("how does mastery work")).toBe(true);
    expect(isGameOrAnime("is bakugo good in ranked")).toBe(true);
    expect(isGameOrAnime("what tier is todoroki")).toBe(true);
    expect(isGameOrAnime("how to extend ragdoll")).toBe(true);
  });

  test("detects anime keywords", () => {
    expect(isGameOrAnime("who is luffy")).toBe(true);
    expect(isGameOrAnime("best arc in mha")).toBe(true);
    expect(isGameOrAnime("did eren die")).toBe(true);
    expect(isGameOrAnime("one piece is goated")).toBe(true);
    expect(isGameOrAnime("levi vs beast titan")).toBe(true);
  });

  test("does NOT trigger on casual chat", () => {
    expect(isGameOrAnime("hey what's up")).toBe(false);
    expect(isGameOrAnime("i'm bored")).toBe(false);
    expect(isGameOrAnime("what time is it")).toBe(false);
    expect(isGameOrAnime("you're funny lol")).toBe(false);
  });
});
