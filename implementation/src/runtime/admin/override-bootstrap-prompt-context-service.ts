import type { Channel, Collection, Message, Snowflake } from "discord.js";
import type { Logger } from "pino";

import { extractUrls } from "../../discord/message-utils.js";
import type { PlaceType, WatchLocationConfig } from "../../domain/types.js";

const HISTORY_SCAN_LIMIT = 50;
const HISTORY_CONTEXT_LIMIT = 20;

type OverrideBootstrapOriginMessage = {
  messageId: string;
  authorId: string;
  authorKind: "human" | "bot";
  content: string;
  createdAt: string;
};

type OverrideBootstrapOriginContext = {
  guildId: string;
  channelId: string;
  rootChannelId: string;
  threadId: string | null;
  mode: WatchLocationConfig["mode"];
  placeType: PlaceType;
};

export class OverrideBootstrapPromptContextService {
  constructor(private readonly logger: Pick<Logger, "warn">) {}

  async buildEffectivePrompt(input: {
    prompt: string;
    origin: OverrideBootstrapOriginContext;
    historyChannel: Channel | null;
  }): Promise<string> {
    const prompt = input.prompt.trim();
    if (prompt.length === 0) {
      return prompt;
    }

    const history = await this.collectHistory(input.historyChannel);
    return buildOverrideBootstrapPrompt({
      prompt,
      origin: input.origin,
      history
    });
  }

  private async collectHistory(
    channel: Channel | null
  ): Promise<OverrideBootstrapOriginMessage[]> {
    if (!canFetchMessageHistory(channel)) {
      return [];
    }

    try {
      const history = await channel.messages.fetch({
        limit: HISTORY_SCAN_LIMIT
      });
      return buildVisibleOriginHistoryFacts(history);
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          channelId: channel.id
        },
        "failed to fetch origin conversation history for override bootstrap"
      );
      return [];
    }
  }
}

export function buildVisibleOriginHistoryFacts(
  history: Collection<Snowflake, Message<true>>
): OverrideBootstrapOriginMessage[] {
  const collected: OverrideBootstrapOriginMessage[] = [];

  for (const message of history.values()) {
    if (message.webhookId || message.system) {
      continue;
    }

    const content = normalizeVisibleContent(message.content);
    if (!content) {
      continue;
    }

    collected.push({
      messageId: message.id,
      authorId: message.author.id,
      authorKind: message.author.bot ? "bot" : "human",
      content,
      createdAt: message.createdAt.toISOString()
    });
  }

  return collected.slice(0, HISTORY_CONTEXT_LIMIT).reverse();
}

export function buildOverrideBootstrapPrompt(input: {
  prompt: string;
  origin: OverrideBootstrapOriginContext;
  history: OverrideBootstrapOriginMessage[];
}): string {
  const historyLines =
    input.history.length > 0
      ? input.history.map(
          (message, index) =>
            `${index + 1}. [${message.createdAt}] ${message.authorKind}:${message.authorId}\n${message.content}`
        )
      : ["(no recent visible conversation context available)"];

  return [
    "Treat this as the hidden initial user input for a newly opened override thread.",
    "Resolve references in the requested task against the origin conversation context before replying.",
    "Respond directly to the work request itself.",
    "Do not mention hidden bootstrap packaging, slash commands, internal metadata, or implementation mechanics unless the user explicitly asks for them.",
    "",
    "Requested task:",
    input.prompt,
    "",
    "Origin place:",
    `- guild_id: ${input.origin.guildId}`,
    `- mode: ${input.origin.mode}`,
    `- place_type: ${input.origin.placeType}`,
    `- channel_id: ${input.origin.channelId}`,
    `- root_channel_id: ${input.origin.rootChannelId}`,
    `- thread_id: ${input.origin.threadId ?? "null"}`,
    "",
    "Recent visible conversation context (oldest first):",
    ...historyLines
  ].join("\n");
}

function canFetchMessageHistory(
  channel: Channel | null
): channel is Channel & {
  id: string;
  messages: {
    fetch(input: { limit: number }): Promise<Collection<Snowflake, Message<true>>>;
  };
} {
  return Boolean(channel && "messages" in channel);
}

function normalizeVisibleContent(raw: string): string | null {
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
