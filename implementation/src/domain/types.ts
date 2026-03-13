export const ROLE_VALUES = ["owner", "admin", "user"] as const;
export type ActorRole = (typeof ROLE_VALUES)[number];

export const SCOPE_VALUES = [
  "server_public",
  "channel_family",
  "conversation_only"
] as const;
export type Scope = (typeof SCOPE_VALUES)[number];

export const WATCH_MODE_VALUES = [
  "url_watch",
  "chat",
  "admin_control",
  "forum_longform"
] as const;
export type WatchMode = (typeof WATCH_MODE_VALUES)[number];

export const PLACE_TYPE_VALUES = [
  "guild_text",
  "guild_announcement",
  "public_thread",
  "private_thread",
  "chat_channel",
  "admin_control_channel",
  "forum_post_thread"
] as const;
export type PlaceType = (typeof PLACE_TYPE_VALUES)[number];

export const CODEX_SANDBOX_MODE_VALUES = [
  "read-only",
  "workspace-write"
] as const;
export type CodexSandboxMode = (typeof CODEX_SANDBOX_MODE_VALUES)[number];

export type WatchLocationConfig = {
  guildId: string;
  channelId: string;
  mode: WatchMode;
  defaultScope: Scope;
};

export type AppConfig = {
  discordBotToken: string;
  discordApplicationId: string;
  discordOwnerUserIds: string[];
  botDbPath: string;
  botLogLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  codexAppServerCommand: string;
  codexHomePath: string | null;
  watchLocations: WatchLocationConfig[];
  chatRuntimeControls?: ChatRuntimeControlsConfig | null;
  weeklyMeetupAnnouncement: WeeklyMeetupAnnouncementConfig | null;
};

export type ChatRuntimeControlsConfig = {
  enabled: boolean;
  enabledChannelIds: string[];
};

export type WeeklyMeetupAnnouncementConfig = {
  guildId: string;
  channelId: string;
  timezone: "Asia/Tokyo";
  announceWeekday: "monday";
  announceTime: "18:00";
  eventTime: "21:00";
  embedTemplatePath: string;
};

export type MessageEnvelope = {
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  placeType: PlaceType;
  rawPlaceType: string;
  content: string;
  urls: string[];
  receivedAt: string;
};

export type RecentChatMessageFact = {
  message_id: string;
  author_id: string;
  content: string;
  created_at: string;
};

export type VisibleCandidate = {
  sourceId: string;
  title: string;
  summary: string;
  tags: string[];
  scope: Scope;
  recency: string;
  canonicalUrl: string;
};
