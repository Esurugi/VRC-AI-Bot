import {
  ChannelType,
  type Attachment,
  type GuildBasedChannel,
  type Message,
  type ThreadChannel
} from "discord.js";

import type {
  MessageEnvelope,
  PlaceType,
  WatchLocationConfig
} from "../domain/types.js";

const URL_PATTERN = /https?:\/\/[^\s<>()]+/giu;

export function extractUrls(content: string): string[] {
  return [...content.matchAll(URL_PATTERN)].map((match) => match[0]);
}

export function isEligibleMessage(message: Message): boolean {
  if (!message.inGuild()) {
    return false;
  }

  if (message.author.bot || message.webhookId) {
    return false;
  }

  const content = message.content.trim();
  return (
    content.length > 0 ||
    extractUrls(content).length > 0 ||
    hasReadableTextAttachment(message)
  );
}

export function hasReadableTextAttachment(input: {
  attachments: ReadonlyMap<string, Attachment>;
}): boolean {
  for (const attachment of input.attachments.values()) {
    if (isReadableTextAttachment(attachment)) {
      return true;
    }
  }

  return false;
}

export function isReadableTextAttachment(input: {
  name: string | null;
  contentType: string | null;
}): boolean {
  const normalizedName = input.name?.trim().toLowerCase() ?? "";
  const normalizedContentType = input.contentType?.trim().toLowerCase() ?? "";

  return (
    normalizedName.endsWith(".txt") ||
    normalizedContentType === "text/plain" ||
    normalizedContentType.startsWith("text/plain;")
  );
}

export function resolveWatchLocation(
  message: Message,
  watchLocations: WatchLocationConfig[]
): WatchLocationConfig | null {
  if (!message.inGuild()) {
    return null;
  }

  const channel = message.channel;
  const direct = watchLocations.find((location) => location.channelId === channel.id);
  if (direct) {
    return direct;
  }

  if (channel.isThread()) {
    return (
      watchLocations.find((location) => location.channelId === channel.parentId) ?? null
    );
  }

  return null;
}

export function resolvePlaceType(
  channel: GuildBasedChannel,
  mode: WatchLocationConfig["mode"]
): PlaceType {
  if (channel.isThread()) {
    return resolveThreadPlaceType(channel, mode);
  }

  if (channel.type === ChannelType.GuildAnnouncement) {
    return "guild_announcement";
  }

  if (mode === "chat") {
    return "chat_channel";
  }

  if (mode === "admin_control") {
    return "admin_control_channel";
  }

  return "guild_text";
}

export function buildMessageEnvelope(
  message: Message<true>,
  watchLocation: WatchLocationConfig,
  contentOverride?: string | null
): MessageEnvelope {
  const content = (contentOverride ?? message.content).trim();

  return {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    authorId: message.author.id,
    placeType: resolvePlaceType(message.channel, watchLocation.mode),
    rawPlaceType: ChannelType[message.channel.type] ?? String(message.channel.type),
    content,
    urls: extractUrls(content),
    receivedAt: message.createdAt.toISOString()
  };
}

function resolveThreadPlaceType(
  channel: ThreadChannel,
  mode: WatchLocationConfig["mode"]
): PlaceType {
  if (mode === "forum_longform") {
    return "forum_post_thread";
  }

  if (channel.type === ChannelType.PrivateThread) {
    return "private_thread";
  }

  return "public_thread";
}
