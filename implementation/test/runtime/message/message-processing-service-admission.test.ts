import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChannelType } from "discord.js";

import { ChatEngagementPolicy } from "../../../src/runtime/chat/chat-engagement-policy.js";
import { FeatureThreadService } from "../../../src/runtime/thread/feature-thread-service.js";
import { MessageProcessingService } from "../../../src/runtime/message/message-processing-service.js";
import { SqliteStore } from "../../../src/storage/database.js";
import type {
  AppConfig,
  MessageEnvelope,
  WatchLocationConfig
} from "../../../src/domain/types.js";
import type { QueuedMessage } from "../../../src/runtime/types.js";

test("processing ignores queued forum follow-up without directed engagement", async () => {
  await withHarness(async ({ service, store, routedInputs, dispatchedCount }) => {
    const item = createQueuedMessage({
      messageId: "1001",
      source: "retry",
      watchLocation: forumWatchLocation(),
      thread: true,
      content: "追加で気になった点です"
    });

    await service.process(item);

    assert.equal(routedInputs.length, 0);
    assert.equal(dispatchedCount(), 0);
    assert.equal(store.messageProcessing.get("1001")?.state, "completed");
  });
});

test("processing ignores queued clear explanation follow-up without directed engagement", async () => {
  await withHarness(async ({ service, store, routedInputs, dispatchedCount }) => {
    const item = createQueuedMessage({
      messageId: "1002",
      source: "retry",
      watchLocation: clearExplanationWatchLocation(),
      thread: true,
      content: "横から補足します"
    });

    await service.process(item);

    assert.equal(routedInputs.length, 0);
    assert.equal(dispatchedCount(), 0);
    assert.equal(store.messageProcessing.get("1002")?.state, "completed");
  });
});

test("processing ignores queued knowledge thread follow-up without directed engagement", async () => {
  await withHarness(async ({ service, store, routedInputs, dispatchedCount }) => {
    const item = createQueuedMessage({
      messageId: "1003",
      source: "retry",
      watchLocation: knowledgeWatchLocation(),
      thread: true,
      content: "この話も関係しそうです"
    });

    await service.process(item);

    assert.equal(routedInputs.length, 0);
    assert.equal(dispatchedCount(), 0);
    assert.equal(store.messageProcessing.get("1003")?.state, "completed");
  });
});

test("processing ignores queued plain thread question without directed engagement", async () => {
  await withHarness(async ({ service, store, routedInputs, dispatchedCount }) => {
    const item = createQueuedMessage({
      messageId: "1004",
      source: "retry",
      watchLocation: plainChatWatchLocation(),
      thread: true,
      content: "これはどうします？"
    });

    await service.process(item);

    assert.equal(routedInputs.length, 0);
    assert.equal(dispatchedCount(), 0);
    assert.equal(store.messageProcessing.get("1004")?.state, "completed");
  });
});

test("processing keeps queued direct mention follow-up actionable", async () => {
  await withHarness(async ({ service, routedInputs }) => {
    const item = createQueuedMessage({
      messageId: "1005",
      source: "retry",
      watchLocation: forumWatchLocation(),
      thread: true,
      content: "<@bot> この続きを調べてください",
      mentionsBot: true
    });

    await service.process(item);

    assert.equal(routedInputs.length, 1);
    assert.equal(
      routedInputs[0]?.chatEngagement?.trigger_kind,
      "direct_mention"
    );
  });
});

test("processing keeps queued reply-to-bot follow-up actionable", async () => {
  await withHarness(async ({ service, routedInputs }) => {
    const item = createQueuedMessage({
      messageId: "1006",
      source: "retry",
      watchLocation: plainChatWatchLocation(),
      thread: true,
      content: "この続きもお願いします",
      replyToBot: true
    });

    await service.process(item);

    assert.equal(routedInputs.length, 1);
    assert.equal(
      routedInputs[0]?.chatEngagement?.trigger_kind,
      "reply_to_bot"
    );
  });
});

test("processing keeps queued feature thread starter actionable", async () => {
  await withHarness(async ({ service, routedInputs }) => {
    const item = createQueuedMessage({
      messageId: "forum-thread",
      source: "retry",
      watchLocation: forumWatchLocation(),
      thread: true,
      threadId: "forum-thread",
      content: "この内容を調べてください"
    });

    await service.process(item);

    assert.equal(routedInputs.length, 1);
    assert.equal(routedInputs[0]?.chatEngagement, null);
  });
});

test("processing keeps queued root URL ingest actionable", async () => {
  await withHarness(async ({ service, routedInputs }) => {
    const item = createQueuedMessage({
      messageId: "1008",
      source: "retry",
      watchLocation: knowledgeWatchLocation(),
      thread: false,
      content: "https://example.com/article を保存して",
      urls: ["https://example.com/article"]
    });

    await service.process(item);

    assert.equal(routedInputs.length, 1);
    assert.equal(routedInputs[0]?.chatEngagement, null);
  });
});

async function withHarness(
  run: (context: {
    service: MessageProcessingService;
    store: SqliteStore;
    routedInputs: Array<{ chatEngagement: QueuedMessage["chatEngagement"] }>;
    dispatchedCount: () => number;
  }) => Promise<void>
): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), "vrc-ai-bot-processing-admission-"));
  let store: SqliteStore | null = null;
  try {
    store = new SqliteStore(join(workspace, "bot.sqlite"));
    store.migrate();

    const routedInputs: Array<{ chatEngagement: QueuedMessage["chatEngagement"] }> = [];
    let dispatched = 0;
    const service = new MessageProcessingService(
      createConfig(),
      store,
      {
        routeMessage: async (input: { chatEngagement: QueuedMessage["chatEngagement"] }) => {
          routedInputs.push(input);
          return null;
        }
      } as never,
      {
        resolveEffectiveContentOverride: async () => ({
          preparedPrompt: null,
          progressNotice: null,
          wasPreprocessed: false,
          starterMessage: null
        })
      } as never,
      {
        collect: async () => ({ recentRoomEvents: [] })
      } as never,
      new ChatEngagementPolicy(),
      new FeatureThreadService(),
      {
        decide: async () => "allow_clear_explanation"
      } as never,
      {} as never,
      {
        clear: () => {},
        schedule: () => {}
      } as never,
      {
        checkSoftBlock: async () => ({ blocked: false })
      } as never,
      {} as never,
      {
        dispatchResolvedMessage: async () => {
          dispatched += 1;
          return {
            channelId: "reply-channel",
            threadId: null
          };
        },
        notifyFailureInTarget: async () => {},
        notifyPermanentFailure: async () => {},
        sendFollowupInSamePlace: async () => {}
      } as never,
      createLogger() as never
    );

    await run({
      service,
      store,
      routedInputs,
      dispatchedCount: () => dispatched
    });
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

function createQueuedMessage(input: {
  messageId: string;
  source: QueuedMessage["source"];
  watchLocation: WatchLocationConfig;
  thread: boolean;
  content: string;
  urls?: string[];
  threadId?: string;
  mentionsBot?: boolean;
  replyToBot?: boolean;
}): QueuedMessage {
  const threadId = input.threadId ?? "thread-1";
  const channelId = input.thread ? threadId : input.watchLocation.channelId;
  const message = createMessageDouble({
    id: input.messageId,
    channelId,
    rootChannelId: input.watchLocation.channelId,
    content: input.content,
    thread: input.thread,
    mentionsBot: input.mentionsBot,
    replyToBot: input.replyToBot,
    isForum: input.watchLocation.features?.includes("forum_research") === true
  });
  const envelope: MessageEnvelope = {
    guildId: input.watchLocation.guildId,
    channelId,
    messageId: input.messageId,
    authorId: "user-1",
    placeType: input.thread ? "public_thread" : "guild_text",
    rawPlaceType: input.thread ? "PublicThread" : "GuildText",
    content: input.content,
    urls: input.urls ?? [],
    receivedAt: "2026-05-21T00:00:00.000Z"
  };

  return {
    messageId: input.messageId,
    orderingKey: channelId,
    source: input.source,
    message: message as never,
    envelope,
    watchLocation: input.watchLocation,
    actorRole: "user",
    scope: input.watchLocation.defaultScope,
    chatEngagement: null
  };
}

function createMessageDouble(input: {
  id: string;
  channelId: string;
  rootChannelId: string;
  content: string;
  thread: boolean;
  isForum: boolean;
  mentionsBot?: boolean;
  replyToBot?: boolean;
}) {
  const botUserId = "bot";
  const parent = {
    id: input.rootChannelId,
    name: "root",
    type: input.isForum ? ChannelType.GuildForum : ChannelType.GuildText
  };
  const channel = {
    id: input.channelId,
    name: input.thread ? "thread" : "root",
    type: input.thread ? ChannelType.PublicThread : parent.type,
    parentId: input.thread ? input.rootChannelId : null,
    parent: input.thread ? parent : null,
    archived: false,
    locked: false,
    autoArchiveDuration: 1440,
    isThread: () => input.thread,
    sendTyping: async () => {},
    fetchStarterMessage: async () => ({ id: "starter-message" })
  };

  return {
    id: input.id,
    url: `https://discord.com/channels/guild-1/${input.channelId}/${input.id}`,
    content: input.content,
    author: {
      id: "user-1",
      username: "user",
      bot: false
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
    channelId: input.channelId,
    channel,
    client: {
      user: {
        id: botUserId
      }
    },
    mentions: {
      users: {
        has: (userId: string) => input.mentionsBot === true && userId === botUserId
      },
      repliedUser:
        input.replyToBot === true
          ? {
              id: botUserId
            }
          : null
    },
    reference:
      input.replyToBot === true
        ? {
            messageId: "bot-message"
          }
        : null,
    fetchReference: async () => ({
      author: {
        id: botUserId
      }
    })
  };
}

function forumWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "forum-root",
    mode: "chat",
    defaultScope: "server_public",
    features: ["forum_research", "conversation"],
    chatBehavior: null
  };
}

function clearExplanationWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "clear-root",
    mode: "chat",
    defaultScope: "conversation_only",
    features: ["clear_explanation", "conversation"],
    chatBehavior: null
  };
}

function knowledgeWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "knowledge-root",
    mode: "url_watch",
    defaultScope: "server_public",
    features: ["knowledge_ingest", "conversation"],
    chatBehavior: null
  };
}

function plainChatWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "chat-root",
    mode: "chat",
    defaultScope: "conversation_only",
    features: ["conversation"],
    chatBehavior: "directed_help_chat"
  };
}

function createConfig(): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "app",
    discordOwnerUserIds: [],
    botDbPath: "bot.sqlite",
    botLogLevel: "info",
    codexAppServerCommand: "codex-app-server",
    codexHomePath: null,
    watchLocations: [],
    weeklyMeetupAnnouncement: null
  };
}

function createLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {}
  };
}
