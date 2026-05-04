import {
  type Interaction,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type AutocompleteInteraction,
  type ModalSubmitInteraction,
  MessageFlags,
} from "discord.js";
import { db } from "../db";
import { regionChannels, rankRoles } from "../db/schema";
import { eq } from "drizzle-orm";

// Command handler registry
const commands = new Map<
  string,
  (interaction: ChatInputCommandInteraction) => Promise<void>
>();

// Button handler registry
const buttons = new Map<
  string,
  (interaction: ButtonInteraction) => Promise<void>
>();

// Select menu handler registry
const selectMenus = new Map<
  string,
  (interaction: StringSelectMenuInteraction) => Promise<void>
>();

export const registerCommand = (
  name: string,
  handler: (interaction: ChatInputCommandInteraction) => Promise<void>
) => {
  commands.set(name, handler);
};

export const registerButton = (
  prefix: string,
  handler: (interaction: ButtonInteraction) => Promise<void>
) => {
  buttons.set(prefix, handler);
};

export const registerSelectMenu = (
  prefix: string,
  handler: (interaction: StringSelectMenuInteraction) => Promise<void>
) => {
  selectMenus.set(prefix, handler);
};

// Modal handler registry
const modals = new Map<
  string,
  (interaction: ModalSubmitInteraction) => Promise<void>
>();

export const registerModal = (
  prefix: string,
  handler: (interaction: ModalSubmitInteraction) => Promise<void>
) => {
  modals.set(prefix, handler);
};

export const handleInteraction = async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const handler = commands.get(interaction.commandName);
      if (handler) await handler(interaction);
      return;
    }

    if (interaction.isButton()) {
      for (const [prefix, handler] of buttons) {
        if (interaction.customId.startsWith(prefix)) {
          await handler(interaction);
          return;
        }
      }
    }

    if (interaction.isStringSelectMenu()) {
      for (const [prefix, handler] of selectMenus) {
        if (interaction.customId.startsWith(prefix)) {
          await handler(interaction);
          return;
        }
      }
    }

    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      for (const [prefix, handler] of modals) {
        if (interaction.customId.startsWith(prefix)) {
          await handler(interaction);
          return;
        }
      }
    }
  } catch (err) {
    console.error(`❌ Interaction error:`, err);
    const reply = {
      content: "Something went wrong. Please try again.",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  }
};

const handleAutocomplete = async (interaction: AutocompleteInteraction) => {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "region") return interaction.respond([]);

  const guildId = interaction.guildId!;
  const [channels, roles] = await Promise.all([
    db.select({ region: regionChannels.region }).from(regionChannels).where(eq(regionChannels.guildId, guildId)),
    db.select({ region: rankRoles.region }).from(rankRoles).where(eq(rankRoles.guildId, guildId)),
  ]);

  const regions = [...new Set([...channels.map((c) => c.region), ...roles.map((r) => r.region)])];
  const filtered = regions.filter((r) => r.toLowerCase().includes(focused.value.toLowerCase()));

  await interaction.respond(
    filtered.slice(0, 25).map((r) => ({ name: r, value: r }))
  );
};
