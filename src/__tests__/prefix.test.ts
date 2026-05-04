import { describe, test, expect } from "bun:test";
import { parseCommand, parseMention, ALIASES } from "../handlers/message";

describe("parseCommand", () => {
  test("parses basic command", () => {
    const result = parseCommand("!help", "!");
    expect(result).toEqual({ command: "help", args: [] });
  });

  test("parses command with args", () => {
    const result = parseCommand("!tournament create Friday Cup", "!");
    expect(result).toEqual({ command: "tournament", args: ["create", "Friday", "Cup"] });
  });

  test("resolves alias !t → tournament", () => {
    const result = parseCommand("!t create Test", "!");
    expect(result).toEqual({ command: "tournament", args: ["create", "Test"] });
  });

  test("resolves alias !m → match", () => {
    const result = parseCommand("!m list", "!");
    expect(result).toEqual({ command: "match", args: ["list"] });
  });

  test("resolves alias !c → challenge", () => {
    const result = parseCommand("!c forfeit AFK", "!");
    expect(result).toEqual({ command: "challenge", args: ["forfeit", "AFK"] });
  });

  test("resolves alias !lb → leaderboard", () => {
    const result = parseCommand("!lb 2", "!");
    expect(result).toEqual({ command: "leaderboard", args: ["2"] });
  });

  test("resolves alias !r → rank", () => {
    const result = parseCommand("!r <@123>", "!");
    expect(result).toEqual({ command: "rank", args: ["<@123>"] });
  });

  test("resolves alias !p → profile", () => {
    const result = parseCommand("!p", "!");
    expect(result).toEqual({ command: "profile", args: [] });
  });

  test("resolves alias !sv → server", () => {
    const result = parseCommand("!sv", "!");
    expect(result).toEqual({ command: "server", args: [] });
  });

  test("resolves alias !h → history", () => {
    const result = parseCommand("!h 3 <@456>", "!");
    expect(result).toEqual({ command: "history", args: ["3", "<@456>"] });
  });

  test("returns null for non-prefixed message", () => {
    expect(parseCommand("hello world", "!")).toBeNull();
  });

  test("returns null for prefix only", () => {
    expect(parseCommand("!", "!")).toBeNull();
  });

  test("works with custom prefix", () => {
    const result = parseCommand(".help", ".");
    expect(result).toEqual({ command: "help", args: [] });
  });

  test("case insensitive command", () => {
    const result = parseCommand("!HELP", "!");
    expect(result).toEqual({ command: "help", args: [] });
  });

  test("unknown command passes through", () => {
    const result = parseCommand("!unknown arg1", "!");
    expect(result).toEqual({ command: "unknown", args: ["arg1"] });
  });
});

describe("parseMention", () => {
  test("parses standard mention", () => {
    expect(parseMention("<@123456789>")).toBe("123456789");
  });

  test("parses nickname mention", () => {
    expect(parseMention("<@!123456789>")).toBe("123456789");
  });

  test("parses raw user ID", () => {
    expect(parseMention("123456789")).toBe("123456789");
  });

  test("returns null for plain text", () => {
    expect(parseMention("hello")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseMention("")).toBeNull();
  });

  test("returns null for partial mention", () => {
    expect(parseMention("<@abc>")).toBeNull();
  });
});

describe("ALIASES", () => {
  test("all aliases map to valid commands", () => {
    const validCommands = [
      "tournament", "match", "challenge", "leaderboard",
      "rank", "profile", "server", "history",
    ];
    for (const [alias, command] of Object.entries(ALIASES)) {
      expect(validCommands).toContain(command);
    }
  });

  test("has all expected aliases", () => {
    expect(ALIASES.t).toBe("tournament");
    expect(ALIASES.m).toBe("match");
    expect(ALIASES.c).toBe("challenge");
    expect(ALIASES.lb).toBe("leaderboard");
    expect(ALIASES.r).toBe("rank");
    expect(ALIASES.p).toBe("profile");
    expect(ALIASES.sv).toBe("server");
    expect(ALIASES.h).toBe("history");
  });
});

describe("prefix command routing coverage", () => {
  test("all main commands have handlers", () => {
    const commands = [
      "tournament", "match", "challenge", "leaderboard",
      "rank", "profile", "server", "history", "help",
      "setup", "admin", "register",
    ];
    for (const cmd of commands) {
      const result = parseCommand(`!${cmd}`, "!");
      expect(result).not.toBeNull();
      expect(result!.command).toBe(cmd);
    }
  });

  test("setup subcommands parse correctly", () => {
    const cases = [
      { input: "!setup leaderboard #general", args: ["leaderboard", "#general"] },
      { input: "!setup leaderboard-size 10", args: ["leaderboard-size", "10"] },
      { input: "!setup prefix .", args: ["prefix", "."] },
      { input: "!setup role add @Role 1 1 Champion", args: ["role", "add", "@Role", "1", "1", "Champion"] },
      { input: "!setup role list", args: ["role", "list"] },
      { input: "!setup cooldown set challenge 60", args: ["cooldown", "set", "challenge", "60"] },
      { input: "!setup status", args: ["status"] },
    ];
    for (const { input, args } of cases) {
      const result = parseCommand(input, "!");
      expect(result!.command).toBe("setup");
      expect(result!.args).toEqual(args);
    }
  });

  test("admin subcommands parse correctly", () => {
    const cases = [
      { input: "!admin leaderboard view <@123>", args: ["leaderboard", "view", "<@123>"] },
      { input: "!admin leaderboard set <@123> rank_position 1", args: ["leaderboard", "set", "<@123>", "rank_position", "1"] },
      { input: "!admin leaderboard reset", args: ["leaderboard", "reset"] },
      { input: "!admin forfeit void <@123>", args: ["forfeit", "void", "<@123>"] },
      { input: "!admin forfeit list", args: ["forfeit", "list"] },
    ];
    for (const { input, args } of cases) {
      const result = parseCommand(input, "!");
      expect(result!.command).toBe("admin");
      expect(result!.args).toEqual(args);
    }
  });

  test("challenge subcommands parse correctly", () => {
    const cases = [
      { input: "!c cancelcd", args: ["cancelcd"] },
      { input: "!c forfeit AFK", args: ["forfeit", "AFK"] },
    ];
    for (const { input, args } of cases) {
      const result = parseCommand(input, "!");
      expect(result!.command).toBe("challenge");
      expect(result!.args).toEqual(args);
    }
  });
});

describe("prefix command routing coverage", () => {
  test("all main commands have handlers", () => {
    const commands = [
      "tournament", "match", "challenge", "leaderboard",
      "rank", "profile", "server", "history", "help",
      "setup", "admin", "register",
    ];
    for (const cmd of commands) {
      const result = parseCommand(`!${cmd}`, "!");
      expect(result).not.toBeNull();
      expect(result!.command).toBe(cmd);
    }
  });

  test("setup subcommands parse correctly", () => {
    const cases = [
      { input: "!setup leaderboard #general", args: ["leaderboard", "#general"] },
      { input: "!setup leaderboard-size 10", args: ["leaderboard-size", "10"] },
      { input: "!setup prefix .", args: ["prefix", "."] },
      { input: "!setup role add @Role 1 1 Champion", args: ["role", "add", "@Role", "1", "1", "Champion"] },
      { input: "!setup role list", args: ["role", "list"] },
      { input: "!setup cooldown set challenge 60", args: ["cooldown", "set", "challenge", "60"] },
      { input: "!setup status", args: ["status"] },
    ];
    for (const { input, args } of cases) {
      const result = parseCommand(input, "!");
      expect(result!.command).toBe("setup");
      expect(result!.args).toEqual(args);
    }
  });

  test("admin subcommands parse correctly", () => {
    const cases = [
      { input: "!admin leaderboard view <@123>", args: ["leaderboard", "view", "<@123>"] },
      { input: "!admin leaderboard set <@123> rank_position 1", args: ["leaderboard", "set", "<@123>", "rank_position", "1"] },
      { input: "!admin leaderboard reset", args: ["leaderboard", "reset"] },
      { input: "!admin forfeit void <@123>", args: ["forfeit", "void", "<@123>"] },
      { input: "!admin forfeit list", args: ["forfeit", "list"] },
    ];
    for (const { input, args } of cases) {
      const result = parseCommand(input, "!");
      expect(result!.command).toBe("admin");
      expect(result!.args).toEqual(args);
    }
  });

  test("challenge subcommands parse correctly", () => {
    const cases = [
      { input: "!c cancelcd", args: ["cancelcd"] },
      { input: "!c forfeit AFK", args: ["forfeit", "AFK"] },
    ];
    for (const { input, args } of cases) {
      const result = parseCommand(input, "!");
      expect(result!.command).toBe("challenge");
      expect(result!.args).toEqual(args);
    }
  });
});
