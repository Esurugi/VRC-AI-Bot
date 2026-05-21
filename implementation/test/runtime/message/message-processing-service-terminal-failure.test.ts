import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChannelType } from "discord.js";

import { MessageProcessingService } from "../../../src/runtime/message/message-processing-service.js";
import { SqliteStore } from "../../../src/storage/database.js";
import type { AppConfig } from "../../../src/domain/types.js";
import type { QueuedMessage } from "../../../src/runtime/types.js";
import type { RetryJobRow } from "../../../src/storage/database.js";

test("forum feature terminal failure is durable even when legacy mode says chat", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "vrc-ai-bot-terminal-failure-"));
  let store: SqliteStore | null = null;
  try {
    store = new SqliteStore(join(workspace, "bot.sqlite"));
    store.migrate();

    let notificationCount = 0;
    const service = createService(store, {
      forumFirstTurnPreprocessor: {
        resolveEffectiveContentOverride: async () => {
          throw new Error("forum preparation failed");
        }
      } as never,
      replyDispatchService: {
        notifyFailureInTarget: async () => {
          notificationCount += 1;
        }
      } as never
    });

    const message = createForumQueuedMessage("3000", "forum-thread-1", {
      mode: "chat",
      features: ["forum_research", "conversation"]
    });
    await service.process(message);

    assert.equal(
      store.messageProcessing.get("3000")?.state,
      "terminal_failure_notified"
    );
    assert.equal(
      store.channelCursors.get("forum-thread-1")?.last_processed_message_id,
      "3000"
    );
    assert.equal(notificationCount, 1);

    await service.process(message);

    assert.equal(
      store.messageProcessing.get("3000")?.state,
      "terminal_failure_notified"
    );
    assert.equal(notificationCount, 1);
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("forum feature wires forum callbacks even when legacy mode says chat", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "vrc-ai-bot-forum-callbacks-"));
  let store: SqliteStore | null = null;
  try {
    store = new SqliteStore(join(workspace, "bot.sqlite"));
    store.migrate();

    let hasForumCallbacks = false;
    const followups: string[] = [];
    const service = createService(store, {
      harnessRunner: {
        routeMessage: async (input: { forumRetryCallbacks?: { onProgressNotice: (content: string) => Promise<void> } }) => {
          hasForumCallbacks = input.forumRetryCallbacks !== undefined;
          await input.forumRetryCallbacks?.onProgressNotice("調査を継続しています");
          return null;
        }
      } as never,
      replyDispatchService: {
        dispatchResolvedMessage: async () => ({
          channelId: "forum-thread-1",
          threadId: "forum-thread-1"
        }),
        sendFollowupInSamePlace: async (_item: QueuedMessage, content: string) => {
          followups.push(content);
        }
      } as never
    });

    await service.process(
      createForumQueuedMessage("3100", "forum-thread-1", {
        mode: "chat",
        features: ["forum_research", "conversation"]
      })
    );

    assert.equal(hasForumCallbacks, true);
    assert.deepEqual(followups, ["調査を継続しています"]);
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("retry job failure resolves current watch location feature before legacy place mode", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "vrc-ai-bot-retry-forum-failure-"));
  let store: SqliteStore | null = null;
  try {
    store = new SqliteStore(join(workspace, "bot.sqlite"));
    store.migrate();
    store.messageProcessing.tryAcquire("4000", "forum-thread-1");
    store.messageProcessing.markPendingRetry("4000");

    let notificationCount = 0;
    const service = createService(store, {
      config: createConfig([
        {
          guildId: "guild-1",
          channelId: "forum-root",
          mode: "chat",
          defaultScope: "server_public",
          features: ["forum_research", "conversation"],
          chatBehavior: null
        }
      ]),
      retryScheduler: {
        clear: (_messageId: string) => {},
        schedule: () => {
          throw new Error("forum retry job failure must not schedule retry");
        }
      } as never,
      replyDispatchService: {
        notifyFailureForRetryJob: async () => {
          notificationCount += 1;
        }
      } as never
    });

    await service.handleRetryJobFailure(
      createRetryJobRow({
        place_mode: "chat"
      }),
      Object.assign(new Error("operation timed out"), { code: "ETIMEDOUT" })
    );

    assert.equal(notificationCount, 1);
    assert.equal(
      store.messageProcessing.get("4000")?.state,
      "terminal_failure_notified"
    );
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("retry job failure keeps forum_longform fallback only for unresolved old retry rows", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "vrc-ai-bot-old-retry-forum-failure-"));
  let store: SqliteStore | null = null;
  try {
    store = new SqliteStore(join(workspace, "bot.sqlite"));
    store.migrate();
    store.messageProcessing.tryAcquire("4000", "forum-thread-1");
    store.messageProcessing.markPendingRetry("4000");

    let notificationCount = 0;
    const service = createService(store, {
      replyDispatchService: {
        notifyFailureForRetryJob: async () => {
          notificationCount += 1;
        }
      } as never
    });

    await service.handleRetryJobFailure(
      createRetryJobRow({
        place_mode: "forum_longform"
      }),
      new Error("old retry row failed")
    );

    assert.equal(notificationCount, 1);
    assert.equal(
      store.messageProcessing.get("4000")?.state,
      "terminal_failure_notified"
    );
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createService(
  store: SqliteStore,
  overrides: {
    config?: AppConfig;
    harnessRunner?: never;
    forumFirstTurnPreprocessor?: never;
    recentChatHistoryService?: never;
    chatEngagementPolicy?: never;
    failureClassifier?: never;
    retryScheduler?: never;
    replyDispatchService?: never;
  } = {}
): MessageProcessingService {
  const retryScheduler = overrides.retryScheduler ?? {
    clear: (_messageId: string) => {},
    schedule: () => {
      throw new Error("forum terminal failure must not schedule retry");
    }
  };

  return new MessageProcessingService(
    overrides.config ?? createConfig(),
    store,
    overrides.harnessRunner ?? ({} as never),
    overrides.forumFirstTurnPreprocessor ??
      ({
        resolveEffectiveContentOverride: async () => ({
          preparedPrompt: null,
          progressNotice: null,
          wasPreprocessed: false,
          starterMessage: null
        })
      } as never),
    overrides.recentChatHistoryService ??
      ({
        collect: async () => ({ recentRoomEvents: [] })
      } as never),
    overrides.chatEngagementPolicy ??
      ({
        evaluate: async () => ({
          decision: "always",
          triggerKind: null,
          isDirectedToBot: false
        })
      } as never),
    overrides.failureClassifier ?? ({} as never),
    retryScheduler as never,
    {
      checkSoftBlock: async () => ({ blocked: false })
    } as never,
    {} as never,
    overrides.replyDispatchService ??
      ({
        dispatchResolvedMessage: async () => ({
          channelId: "forum-thread-1",
          threadId: "forum-thread-1"
        }),
        notifyFailureInTarget: async () => {},
        notifyFailureForRetryJob: async () => {},
        notifyPermanentFailure: async () => {},
        sendFollowupInSamePlace: async () => {}
      } as never),
    createLogger() as never
  );
}

function createForumQueuedMessage(
  messageId: string,
  channelId: string,
  watchLocationOverrides: Partial<QueuedMessage["watchLocation"]> = {}
): QueuedMessage {
  const parent = {
    id: "forum-root",
    name: "forum-root",
    type: ChannelType.GuildForum
  };
  const channel = {
    id: channelId,
    name: "forum-thread",
    type: ChannelType.PublicThread,
    parentId: "forum-root",
    parent,
    archived: false,
    locked: false,
    autoArchiveDuration: 1440,
    isThread: () => true,
    sendTyping: async () => {},
    fetchStarterMessage: async () => null
  };

  return {
    messageId,
    orderingKey: channelId,
    source: "live",
    message: {
      id: messageId,
      url: `https://discord.com/channels/guild-1/forum-root/${channelId}/${messageId}`,
      author: {
        id: "user-1",
        username: "user"
      },
      member: {
        displayName: "User"
      },
      guildId: "guild-1",
      guild: {
        id: "guild-1",
        name: "Guild"
      },
      createdAt: new Date("2026-05-21T00:00:00.000Z"),
      channelId,
      channel
    } as never,
    envelope: {
      guildId: "guild-1",
      channelId,
      messageId,
      authorId: "user-1",
      placeType: "forum_post_thread",
      rawPlaceType: "PublicThread",
      content: "調べてください",
      urls: [],
      receivedAt: "2026-05-21T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "forum-root",
      mode: "forum_longform",
      defaultScope: "server_public",
      features: ["forum_research", "conversation"],
      ...watchLocationOverrides
    },
    actorRole: "user",
    scope: "server_public",
    chatEngagement: null
  };
}

function createConfig(watchLocations: AppConfig["watchLocations"] = []): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "app",
    discordOwnerUserIds: [],
    botDbPath: "bot.sqlite",
    botLogLevel: "info",
    codexAppServerCommand: "codex-app-server",
    codexHomePath: null,
    watchLocations,
    weeklyMeetupAnnouncement: null
  };
}

function createRetryJobRow(
  overrides: Partial<RetryJobRow> = {}
): RetryJobRow {
  return {
    message_id: "4000",
    guild_id: "guild-1",
    message_channel_id: "forum-thread-1",
    watch_channel_id: "forum-root",
    attempt_count: 0,
    next_attempt_at: "2026-05-21T00:00:00.000Z",
    last_failure_category: "fetch_timeout",
    reply_channel_id: "forum-thread-1",
    reply_thread_id: "forum-thread-1",
    place_mode: "forum_longform",
    stage: "fetch_or_resolve",
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    ...overrides
  };
}

function createLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {}
  };
}
