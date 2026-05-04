import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { config } from "./config";

// Command definitions registry — each command file will add to this
const commandData: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];

export const addCommandData = (data: RESTPostAPIChatInputApplicationCommandsJSONBody) => {
  commandData.push(data);
};

// Run as standalone script
const deploy = async () => {
  // Import all command files to trigger registration
  await import("./commands/help");
  await import("./commands/tournament");
  await import("./commands/match");
  await import("./commands/leaderboard");
  await import("./commands/rank");
  await import("./commands/challenge");
  await import("./commands/profile");
  await import("./commands/server");
  await import("./commands/history");
  await import("./commands/setup");
  await import("./commands/admin");
  // await import("./commands/match");
  // await import("./commands/leaderboard");
  // await import("./commands/rank");
  // await import("./commands/challenge");
  // await import("./commands/profile");
  // await import("./commands/server");
  // await import("./commands/history");
  // await import("./commands/setup");
  // await import("./commands/admin");

  const rest = new REST({ version: "10" }).setToken(config.botToken);

  console.log(`📡 Registering ${commandData.length} commands...`);

  if (config.guildId) {
    // Guild-specific — instant updates (dev)
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commandData }
    );
    console.log(`✅ Commands registered to guild ${config.guildId}.`);
  } else {
    // Global — takes up to 1hr to propagate (prod)
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commandData,
    });
    console.log("✅ Commands registered globally.");
  }
};

deploy().catch(console.error);
