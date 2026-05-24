import {
  ChannelType,
  type AnyThreadChannel,
  type Channel,
  type NewsChannel,
  type TextChannel
} from "discord.js";
import type { Logger } from "pino";

import {
  isConversationPlace,
  isForumResearchPlace,
  isKnowledgeIngestPlace,
  hasPlaceFeature,
  resolvePlaceChatBehavior
} from "../../domain/place-features.js";
import type { WatchLocationConfig } from "../../domain/types.js";
import type { SqliteStore } from "../../storage/database.js";
import type { MessageIntakeService } from "./message-intake-service.js";

type StartupMessageRecoveryDependencies = {
  watchLocations: WatchLocationConfig[];
  store: SqliteStore;
  fetchChannel: (channelId: string) => Promise<Channel | null>;
  messageIntakeService: MessageIntakeService;
  logger: Pick<Logger, "debug" | "warn">;
  batchSize?: number;
};

type RecoverableChannel = TextChannel | NewsChannel | AnyThreadChannel;
type RecoveryMode = "replay" | "cursor_only";

export class StartupMessageRecoveryService {
  private readonly batchSize: number;

  constructor(private readonly dependencies: StartupMessageRecoveryDependencies) {
    this.batchSize = dependencies.batchSize ?? 100;
  }

  async recoverPendingMessages(): Promise<void> {
    for (const watchLocation of this.dependencies.watchLocations) {
      await this.recoverWatchLocation(watchLocation);
    }
  }

  private async recoverWatchLocation(watchLocation: WatchLocationConfig): Promise<void> {
    const rootChannel = await this.fetchRecoverableRootChannel(watchLocation.channelId);
    if (!rootChannel) {
      return;
    }
    const recoveryMode = resolveRecoveryMode(watchLocation);

    const rootCursor =
      this.dependencies.store.channelCursors.get(watchLocation.channelId)
        ?.last_processed_message_id ?? null;
    if (rootCursor) {
      await this.recoverChannelMessages(rootChannel, rootCursor, recoveryMode);
    }

    const activeThreads = await this.fetchActiveThreads(rootChannel);
    for (const thread of activeThreads) {
      const threadCursor =
        this.dependencies.store.channelCursors.get(thread.id)?.last_processed_message_id ??
        null;
      if (threadCursor) {
        await this.recoverChannelMessages(thread, threadCursor, recoveryMode);
        continue;
      }

      if (rootCursor) {
        const recoveredFromRootCursor = await this.recoverChannelMessages(
          thread,
          rootCursor,
          recoveryMode
        );
        if (recoveredFromRootCursor || recoveryMode === "cursor_only") {
          continue;
        }
      }

      if (recoveryMode === "replay") {
        await this.recoverRecentChannelMessages(thread);
      }
    }
  }

  private async fetchRecoverableRootChannel(
    channelId: string
  ): Promise<TextChannel | NewsChannel | null> {
    const channel = await this.dependencies.fetchChannel(channelId);
    if (!isRecoverableRootChannel(channel)) {
      return null;
    }
    return channel;
  }

  private async fetchActiveThreads(
    channel: TextChannel | NewsChannel
  ): Promise<AnyThreadChannel[]> {
    try {
      const fetched = await channel.threads.fetchActive();
      return [...fetched.threads.values()];
    } catch (error) {
      this.dependencies.logger.warn(
        {
          channelId: channel.id,
          error: error instanceof Error ? error.message : String(error)
        },
        "failed to fetch active threads during startup recovery"
      );
      return [];
    }
  }

  private async recoverChannelMessages(
    channel: RecoverableChannel,
    afterMessageId: string,
    recoveryMode: RecoveryMode
  ): Promise<boolean> {
    let cursor = afterMessageId;
    let recoveredAny = false;

    while (true) {
      let fetched;
      try {
        fetched = await channel.messages.fetch({
          after: cursor,
          limit: this.batchSize,
          cache: false
        });
      } catch (error) {
        this.dependencies.logger.warn(
          {
            channelId: channel.id,
            afterMessageId: cursor,
            error: error instanceof Error ? error.message : String(error)
          },
          "failed to fetch startup backlog messages"
        );
        return recoveredAny;
      }

      if (fetched.size === 0) {
        return recoveredAny;
      }
      recoveredAny = true;

      const orderedMessages = [...fetched.values()].sort(compareMessagesAscending);
      this.dependencies.logger.debug(
        {
          channelId: channel.id,
          recoveredCount: orderedMessages.length,
          afterMessageId: cursor,
          recoveryMode
        },
        "replaying startup backlog messages"
      );

      if (recoveryMode === "replay") {
        for (const message of orderedMessages) {
          await this.dependencies.messageIntakeService.handle(message);
        }
      }

      const lastMessage = orderedMessages.at(-1);
      if (recoveryMode === "cursor_only" && lastMessage) {
        this.dependencies.store.channelCursors.upsert(channel.id, lastMessage.id);
      }
      if (!lastMessage || fetched.size < this.batchSize) {
        return recoveredAny;
      }

      cursor = lastMessage.id;
    }
  }

  private async recoverRecentChannelMessages(channel: RecoverableChannel): Promise<void> {
    let fetched;
    try {
      fetched = await channel.messages.fetch({
        limit: this.batchSize,
        cache: false
      });
    } catch (error) {
      this.dependencies.logger.warn(
        {
          channelId: channel.id,
          error: error instanceof Error ? error.message : String(error)
        },
        "failed to fetch recent startup backlog messages"
      );
      return;
    }

    if (fetched.size === 0) {
      return;
    }

    const orderedMessages = [...fetched.values()].sort(compareMessagesAscending);
    this.dependencies.logger.debug(
      {
        channelId: channel.id,
        recoveredCount: orderedMessages.length,
        recoveryMode: "replay",
        recoveryCursor: "recent"
      },
      "replaying recent startup backlog messages"
    );

    for (const message of orderedMessages) {
      await this.dependencies.messageIntakeService.handle(message);
    }
  }
}

function compareMessagesAscending(
  left: { createdTimestamp: number; id: string },
  right: { createdTimestamp: number; id: string }
): number {
  if (left.createdTimestamp !== right.createdTimestamp) {
    return left.createdTimestamp - right.createdTimestamp;
  }

  const leftId = BigInt(left.id);
  const rightId = BigInt(right.id);
  if (leftId === rightId) {
    return 0;
  }

  return leftId < rightId ? -1 : 1;
}

function isRecoverableRootChannel(
  channel: Channel | null
): channel is TextChannel | NewsChannel {
  if (!channel) {
    return false;
  }

  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  );
}

function resolveRecoveryMode(watchLocation: WatchLocationConfig): RecoveryMode {
  return isPlainChatRecoveryPlace(watchLocation)
    ? "cursor_only"
    : "replay";
}

function isPlainChatRecoveryPlace(watchLocation: WatchLocationConfig): boolean {
  return (
    isConversationPlace(watchLocation) &&
    !isKnowledgeIngestPlace(watchLocation) &&
    !isForumResearchPlace(watchLocation) &&
    !hasPlaceFeature(watchLocation, "admin_override") &&
    !hasPlaceFeature(watchLocation, "clear_explanation") &&
    resolvePlaceChatBehavior(watchLocation) !== null
  );
}
