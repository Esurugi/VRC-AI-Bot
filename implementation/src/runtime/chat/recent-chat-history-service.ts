import type { Collection, Message, Snowflake } from "discord.js";
import type { Logger } from "pino";

import type {
  RecentChatMessageFact,
  WatchLocationConfig
} from "../../domain/types.js";
import { extractUrls } from "../../discord/message-utils.js";

const HISTORY_SCAN_LIMIT = 50;
const HISTORY_CONTEXT_LIMIT = 20;

export class RecentChatHistoryService {
  constructor(private readonly logger: Pick<Logger, "warn">) {}

  async collect(input: {
    message: Message<true>;
    watchLocation: WatchLocationConfig;
  }): Promise<RecentChatMessageFact[]> {
    if (input.watchLocation.mode !== "chat") {
      return [];
    }

    try {
      const history = await input.message.channel.messages.fetch({
        limit: HISTORY_SCAN_LIMIT,
        before: input.message.id
      });
      return buildRecentHistoryFacts(history, input.message.client.user?.id ?? null);
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          channelId: input.message.channelId,
          messageId: input.message.id
        },
        "failed to fetch recent chat history"
      );
      return [];
    }
  }
}

export function buildRecentHistoryFacts(
  history: Collection<Snowflake, Message<true>>,
  botUserId: string | null
): RecentChatMessageFact[] {
  const collected: RecentChatMessageFact[] = [];

  for (const message of history.values()) {
    if (botUserId && message.author.id === botUserId) {
      break;
    }

    if (message.author.bot || message.webhookId || message.system) {
      continue;
    }

    const content = normalizeHistoryContent(message.content);
    if (!content) {
      continue;
    }

    collected.push({
      message_id: message.id,
      author_id: message.author.id,
      content,
      created_at: message.createdAt.toISOString()
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
