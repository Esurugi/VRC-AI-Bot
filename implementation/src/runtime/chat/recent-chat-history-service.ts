import type { Collection, Message, Snowflake } from "discord.js";
import type { Logger } from "pino";

import type { RecentRoomEventFact, WatchLocationConfig } from "../../domain/types.js";
import {
  isAmbientConversationPlace,
  isForumResearchPlace
} from "../../domain/place-features.js";
import { extractUrls } from "../../discord/message-utils.js";

const HISTORY_SCAN_LIMIT = 50;
const HISTORY_CONTEXT_LIMIT = 12;

export type RecentChatRoomContext = {
  recentRoomEvents: RecentRoomEventFact[];
};

type ObservedRoomEvent = {
  messageId: string;
  channelId: string;
  createdAtMs: number;
  fact: RecentRoomEventFact;
};

export class RecentChatHistoryService {
  private readonly observedByChannel = new Map<string, ObservedRoomEvent[]>();

  constructor(private readonly logger: Pick<Logger, "warn">) {}

  observe(message: Message): void {
    if (!message.inGuild()) {
      return;
    }

    const observed = buildObservedRoomEvent(
      message,
      message.client.user?.id ?? null
    );
    if (!observed) {
      return;
    }

    const buffer = this.observedByChannel.get(message.channelId) ?? [];
    const existingIndex = buffer.findIndex(
      (entry) => entry.messageId === observed.messageId
    );
    if (existingIndex >= 0) {
      buffer.splice(existingIndex, 1);
    }
    buffer.push(observed);
    buffer.sort(compareObservedRoomEvents);
    if (buffer.length > HISTORY_CONTEXT_LIMIT) {
      buffer.splice(0, buffer.length - HISTORY_CONTEXT_LIMIT);
    }
    this.observedByChannel.set(message.channelId, buffer);
  }

  async collect(input: {
    message: Message<true>;
    watchLocation: WatchLocationConfig;
  }): Promise<RecentChatRoomContext> {
    if (!shouldCollectRecentRoomEvents(input)) {
      return {
        recentRoomEvents: []
      };
    }

    const observed = this.readObservedEventsUpToMessage(input.message);
    if (observed.length >= HISTORY_CONTEXT_LIMIT) {
      return {
        recentRoomEvents: observed.map((entry) => entry.fact)
      };
    }

    const beforeMessageId =
      observed.at(-1)?.messageId ?? input.message.id;
    try {
      const history = await input.message.channel.messages.fetch({
        limit: HISTORY_SCAN_LIMIT,
        before: beforeMessageId
      });
      const fetchedEvents = buildRecentRoomEventFacts(
        history,
        input.message.client.user?.id ?? null
      );
      const observedFacts = observed.map((entry) => entry.fact);
      return {
        recentRoomEvents: mergeRecentRoomEvents(
          fetchedEvents,
          observedFacts,
          input.message
        )
      };
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          channelId: input.message.channelId,
          messageId: input.message.id
        },
        "failed to fetch recent chat history"
      );
      return {
        recentRoomEvents: observed.map((entry) => entry.fact)
      };
    }
  }

  private readObservedEvents(channelId: string): ObservedRoomEvent[] {
    return [...(this.observedByChannel.get(channelId) ?? [])].sort(
      compareObservedRoomEvents
    );
  }

  private readObservedEventsUpToMessage(
    message: Message<true>
  ): ObservedRoomEvent[] {
    return this.readObservedEvents(message.channelId).filter(
      (event) => compareObservedRoomEventToMessage(event, message) <= 0
    );
  }
}

export function shouldCollectRecentRoomEvents(input: {
  message: Message<true>;
  watchLocation: WatchLocationConfig;
}): boolean {
  if (isAmbientConversationPlace(input.watchLocation)) {
    return true;
  }

  return (
    isForumResearchPlace(input.watchLocation) &&
    input.message.channel.isThread()
  );
}

export function buildRecentRoomEventFacts(
  history: Collection<Snowflake, Message<true>>,
  botUserId: string | null
): RecentRoomEventFact[] {
  const collected: RecentRoomEventFact[] = [];

  for (const message of history.values()) {
    const fact = buildRecentRoomEventFact(message, botUserId);
    if (!fact) {
      continue;
    }

    collected.push(fact);
  }

  return collected.slice(0, HISTORY_CONTEXT_LIMIT).reverse();
}

function buildObservedRoomEvent(
  message: Message<true>,
  botUserId: string | null
): ObservedRoomEvent | null {
  const fact = buildRecentRoomEventFact(message, botUserId);
  if (!fact) {
    return null;
  }

  return {
    messageId: message.id,
    channelId: message.channelId,
    createdAtMs: message.createdAt.getTime(),
    fact
  };
}

function buildRecentRoomEventFact(
  message: Message<true>,
  botUserId: string | null
): RecentRoomEventFact | null {
  const isCurrentBot = botUserId !== null && message.author.id === botUserId;
  if (
    (!isCurrentBot && message.author.bot) ||
    message.webhookId ||
    message.system
  ) {
    return null;
  }

  const content = normalizeHistoryContent(message.content);
  if (!content) {
    return null;
  }

  return {
    message_id: message.id,
    author: resolveAuthorDisplayName(message),
    is_bot: isCurrentBot,
    reply_to_message_id: message.reference?.messageId ?? null,
    mentions_bot: botUserId !== null && message.mentions.users.has(botUserId),
    content
  };
}

function mergeRecentRoomEvents(
  fetchedEvents: RecentRoomEventFact[],
  observedEvents: RecentRoomEventFact[],
  currentMessage: Message<true>
): RecentRoomEventFact[] {
  const byId = new Map<string, RecentRoomEventFact>();
  for (const event of [...fetchedEvents, ...observedEvents]) {
    if (compareMessageIdToMessage(event.message_id, currentMessage) > 0) {
      continue;
    }
    byId.set(event.message_id, event);
  }
  return [...byId.values()].slice(-HISTORY_CONTEXT_LIMIT);
}

function compareObservedRoomEvents(
  left: ObservedRoomEvent,
  right: ObservedRoomEvent
): number {
  const snowflakeOrder = compareSnowflakeIds(left.messageId, right.messageId);
  if (snowflakeOrder !== null && snowflakeOrder !== 0) {
    return snowflakeOrder;
  }

  return (
    left.createdAtMs - right.createdAtMs ||
    left.messageId.localeCompare(right.messageId)
  );
}

function compareObservedRoomEventToMessage(
  event: ObservedRoomEvent,
  message: Message<true>
): number {
  const snowflakeOrder = compareSnowflakeIds(event.messageId, message.id);
  if (snowflakeOrder !== null && snowflakeOrder !== 0) {
    return snowflakeOrder;
  }

  return event.createdAtMs - message.createdAt.getTime();
}

function compareMessageIdToMessage(
  messageId: string,
  message: Message<true>
): number {
  return compareSnowflakeIds(messageId, message.id) ?? 0;
}

function compareSnowflakeIds(left: string, right: string): number | null {
  if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) {
    return null;
  }

  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function normalizeHistoryContent(raw: string): string | null {
  const content = raw.trim();
  if (content.length > 0) {
    return content;
  }

  const urls = extractUrls(raw);
  if (urls.length > 0) {
    return urls.join("\n");
  }

  return null;
}

function resolveAuthorDisplayName(message: Message<true>): string {
  return (
    message.member?.displayName ??
    message.author.globalName ??
    message.author.displayName ??
    message.author.username
  );
}
