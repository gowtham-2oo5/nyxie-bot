import { type Client, type Message, Events } from "discord.js";
import { getState, updateState } from "./memory";
import { chat } from "./chat";

let _client: Client | null = null;
const channelActivity = new Map<string, { count: number; lastMsg: Message }>();

const CHIME_CHANCE = 0.03; // 3% chance per message to chime in
const MIN_MESSAGES_BEFORE_CHIME = 8; // need at least 8 msgs in channel before considering
const COOLDOWN_MS = 5 * 60 * 1000; // don't chime more than once per 5 min per channel
const lastChime = new Map<string, number>();

// Sleep schedule (IST)
const SLEEP_HOUR = 23;
const SLEEP_MIN = 30;
const WAKE_HOUR = 7;

const isSleeping = (): boolean => {
  const ist = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  if (h > SLEEP_HOUR || (h === SLEEP_HOUR && m >= SLEEP_MIN)) return true;
  if (h < WAKE_HOUR) return true;
  return false;
};

export const initBrain = (client: Client) => {
  _client = client;

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.guild) return;
    if (message.mentions.has(client.user!)) return; // already handled by chat

    const channelId = message.channelId;

    // Track activity
    const activity = channelActivity.get(channelId) ?? { count: 0, lastMsg: message };
    activity.count++;
    activity.lastMsg = message;
    channelActivity.set(channelId, activity);

    // Update messages since last active
    const state = getState();
    updateState({ messages_since_last: state.messages_since_last + 1 });

    // Should Nyxie chime in?
    if (isSleeping()) return; // she's asleep, no autonomous chiming
    if (activity.count < MIN_MESSAGES_BEFORE_CHIME) return;

    const lastChimeTime = lastChime.get(channelId) ?? 0;
    if (Date.now() - lastChimeTime < COOLDOWN_MS) return;

    // Energy check — tired Nyxie doesn't chime in
    if (state.energy < 30) return;

    if (Math.random() > CHIME_CHANCE) return;

    // She's chiming in!
    try {
      await message.channel.sendTyping();
      const reply = await chat(message);
      await message.channel.send(reply);
      lastChime.set(channelId, Date.now());
      activity.count = 0; // reset counter
      channelActivity.set(channelId, activity);
    } catch (e) {
      console.error("Brain chime error:", e);
    }
  });

  // Energy regeneration — every 30 min, gain some energy
  setInterval(() => {
    const state = getState();
    if (state.energy < 100) {
      updateState({ energy: Math.min(100, state.energy + 10) });
    }
  }, 30 * 60 * 1000);
};
