import { EmbedBuilder } from "discord.js";

export const COLORS = {
  brand: 0x5865f2,
  success: 0x57f287,
  error: 0xed4245,
  gold: 0xfee75c,
  pink: 0xeb459e,
} as const;

export const errorEmbed = (message: string) =>
  new EmbedBuilder().setColor(COLORS.error).setDescription(`❌ ${message}`);

export const successEmbed = (message: string) =>
  new EmbedBuilder().setColor(COLORS.success).setDescription(`✅ ${message}`);
