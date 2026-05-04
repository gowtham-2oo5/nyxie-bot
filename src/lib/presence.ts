import { type GuildMember, type Activity, ActivityType } from "discord.js";

export const getPresenceData = (member: GuildMember) => {
  const presence = member.presence;
  if (!presence) return { status: "offline", customStatus: null, activities: [] };

  const customStatus = presence.activities.find((a) => a.type === ActivityType.Custom);
  const activities = presence.activities.filter((a) => a.type !== ActivityType.Custom);

  return {
    status: presence.status,
    customStatus: customStatus?.state ?? null,
    activities,
  };
};

export const formatActivity = (activity: Activity): string | null => {
  switch (activity.type) {
    case ActivityType.Playing:
      return `🎮 Playing **${activity.name}**`;
    case ActivityType.Streaming:
      return `📺 Streaming **${activity.name}**`;
    case ActivityType.Listening:
      if (activity.name === "Spotify" && activity.details) {
        return `🎵 **${activity.details}** • ${activity.state ?? ""}`;
      }
      return `🎵 Listening to **${activity.name}**`;
    case ActivityType.Watching:
      return `📽️ Watching **${activity.name}**`;
    case ActivityType.Competing:
      return `🏅 Competing in **${activity.name}**`;
    default:
      return null;
  }
};

const statusEmoji: Record<string, string> = {
  online: "🟢",
  idle: "🌙",
  dnd: "⛔",
  offline: "⚫",
};

export const formatStatus = (status: string) =>
  `${statusEmoji[status] ?? "⚫"} ${status.charAt(0).toUpperCase() + status.slice(1)}`;
