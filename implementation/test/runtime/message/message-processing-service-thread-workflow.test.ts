import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChannelType } from "discord.js";

import { MessageProcessingService } from "../../../src/runtime/message/message-processing-service.js";
import { SqliteStore } from "../../../src/storage/database.js";
import type { AppConfig, MessageEnvelope, WatchLocationConfig } from "../../../src/domain/types.js";
import type { QueuedMessage } from "../../../src/runtime/types.js";

test("question-gateway route to forum_research produces forum watch location only after route selection", async () => {
  await withHarness(
    {
      resolve: async () => ({
        decision: "route",
        workflow: "forum_research"
      })
    } as never,
    async ({ service, routedInputs }) => {
      await service.process(
        createQueuedMessage({
          messageId: "starter-message",
          threadId: "question-thread-1",
          content: "AIエージェント設計を広めに比較してください"
        })
      );

      assert.equal(routedInputs.length, 1);
      assert.equal(routedInputs[0]?.watchLocation.mode, "forum_longform");
      assert.deepEqual(routedInputs[0]?.watchLocation.features, [
        "forum_research",
        "conversation"
      ]);
      assert.equal(routedInputs[0]?.watchLocation.defaultScope, "conversation_only");
      assert.equal(routedInputs[0]?.envelope.placeType, "forum_post_thread");
      assert.equal(routedInputs[0]?.hasForumCallbacks, true);
    }
  );
});

test("bare question-gateway processing is not treated as forum_research without route selection", async () => {
  await withHarness(
    {
      resolve: async () => ({
        decision: "pass"
      })
    } as never,
    async ({ service, routedInputs }) => {
      await service.process(
        createQueuedMessage({
          messageId: "starter-message",
          threadId: "question-thread-1",
          content: "この概念を説明してください"
        })
      );

      assert.equal(routedInputs.length, 1);
      assert.deepEqual(routedInputs[0]?.watchLocation.features, [
        "question_gateway",
        "conversation"
      ]);
      assert.equal(routedInputs[0]?.watchLocation.mode, "chat");
      assert.equal(routedInputs[0]?.envelope.placeType, "public_thread");
      assert.equal(routedInputs[0]?.hasForumCallbacks, false);
    }
  );
});

async function withHarness(
  threadWorkflowGateway: never,
  run: (context: {
    service: MessageProcessingService;
    routedInputs: Array<{
      watchLocation: WatchLocationConfig;
      envelope: MessageEnvelope;
      hasForumCallbacks: boolean;
    }>;
  }) => Promise<void>
): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), "vrc-ai-bot-thread-workflow-routing-"));
  let store: SqliteStore | null = null;
  try {
    store = new SqliteStore(join(workspace, "bot.sqlite"));
    store.migrate();
    const routedInputs: Array<{
      watchLocation: WatchLocationConfig;
      envelope: MessageEnvelope;
      hasForumCallbacks: boolean;
    }> = [];
    const service = new MessageProcessingService(
      createConfig(),
      store,
      {
        routeMessage: async (input: {
          watchLocation: WatchLocationConfig;
          envelope: MessageEnvelope;
          forumRetryCallbacks?: unknown;
        }) => {
          routedInputs.push({
            watchLocation: input.watchLocation,
            envelope: input.envelope,
            hasForumCallbacks: input.forumRetryCallbacks !== undefined
          });
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
      {
        evaluate: async () => ({
          decision: "always",
          triggerKind: null,
          isDirectedToBot: false
        })
      } as never,
      {
        evaluateMessage: async () => ({
          decision: "handle",
          engagement: {
            decision: "always",
            triggerKind: null,
            isDirectedToBot: false
          }
        })
      } as never,
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
        dispatchResolvedMessage: async () => ({
          channelId: "question-thread-1",
          threadId: "question-thread-1"
        }),
        notifyFailureInTarget: async () => {},
        notifyPermanentFailure: async () => {},
        sendFollowupInSamePlace: async () => {}
      } as never,
      createLogger() as never,
      threadWorkflowGateway
    );

    await run({ service, routedInputs });
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

function createQueuedMessage(input: {
  messageId: string;
  threadId: string;
  content: string;
}): QueuedMessage {
  const message = createMessageDouble(input);
  return {
    messageId: input.messageId,
    orderingKey: input.threadId,
    source: "live",
    message: message as never,
    envelope: {
      guildId: "guild-1",
      channelId: input.threadId,
      messageId: input.messageId,
      authorId: "user-1",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: input.content,
      urls: [],
      receivedAt: "2026-05-21T00:00:00.000Z"
    },
    watchLocation: questionGatewayLocation(),
    actorRole: "user",
    scope: "conversation_only",
    chatEngagement: null
  };
}

function createMessageDouble(input: {
  messageId: string;
  threadId: string;
  content: string;
}) {
  const parent = {
    id: "question-root",
    name: "question-root",
    type: ChannelType.GuildText
  };
  const channel = {
    id: input.threadId,
    name: "question-thread",
    type: ChannelType.PublicThread,
    parentId: "question-root",
    parent,
    isThread: () => true,
    sendTyping: async () => {},
    fetchStarterMessage: async () => ({
      id: input.messageId
    })
  };

  return {
    id: input.messageId,
    url: `https://discord.com/channels/guild-1/${input.threadId}/${input.messageId}`,
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
    channelId: input.threadId,
    channel,
    client: {
      user: {
        id: "bot"
      }
    },
    mentions: {
      users: {
        has: () => false
      },
      repliedUser: null
    },
    reference: null,
    fetchReference: async () => null
  };
}

function questionGatewayLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "question-root",
    mode: "chat",
    defaultScope: "conversation_only",
    features: ["question_gateway", "conversation"],
    chatBehavior: null
  };
}

function createConfig(): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "app",
    discordOwnerUserIds: [],
    botDbPath: "bot.sqlite",
    botLogLevel: "info",
    runtime: {
      maxConcurrentKeys: 4,
      retryPollIntervalMs: 15_000,
      codexIdleCloseMs: 1_800_000,
      ambientSparseInterval: 5
    },
    codexAppServerCommand: "codex-app-server",
    codexHomePath: null,
    watchLocations: [],
    chatRuntimeControls: null,
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
