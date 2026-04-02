import type { Collection, Message, Snowflake } from "discord.js";
import type { Logger } from "pino";

import type { RecentRoomEventFact, WatchLocationConfig } from "../../domain/types.js";
import { extractUrls } from "../../discord/message-utils.js";

const HISTORY_SCAN_LIMIT = 50;
const HISTORY_CONTEXT_LIMIT = 12;

export type RecentChatRoomContext = {
  recentRoomEvents: RecentRoomEventFact[];
};

export class RecentChatHistoryService {
  constructor(private readonly logger: Pick<Logger, "warn">) {}

  async collect(input: {
    message: Message<true>;
    watchLocation: WatchLocationConfig;
  }): Promise<RecentChatRoomContext> {
    if (input.watchLocation.mode !== "chat") {
      return {
        recentRoomEvents: []
      };
    }

    try {
      const history = await input.message.channel.messages.fetch({
        limit: HISTORY_SCAN_LIMIT,
        before: input.message.id
      });
      const recentRoomEvents = buildRecentRoomEventFacts(
        history,
        input.message.client.user?.id ?? null
      );
      return {
        recentRoomEvents
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
        recentRoomEvents: []
      };
    }
  }
}

export function buildRecentRoomEventFacts(
  history: Collection<Snowflake, Message<true>>,
  botUserId: string | null
): RecentRoomEventFact[] {
  const collected: RecentRoomEventFact[] = [];

  for (const message of history.values()) {
    const isCurrentBot =
      botUserId !== null && message.author.id === botUserId;
    if (
      (!isCurrentBot && message.author.bot) ||
      message.webhookId ||
      message.system
    ) {
      continue;
    }

    const content = normalizeHistoryContent(message.content);
    if (!content) {
      continue;
    }

    collected.push({
      message_id: message.id,
      author: resolveAuthorDisplayName(message),
      is_bot: isCurrentBot,
      reply_to_message_id: message.reference?.messageId ?? null,
      mentions_bot: botUserId !== null && message.mentions.users.has(botUserId),
      content
    });
  }

  return collected.slice(0, HISTORY_CONTEXT_LIMIT).reverse();
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
