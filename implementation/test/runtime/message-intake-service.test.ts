import test from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";

import type { AppConfig } from "../../src/domain/types.js";
import { MessageIntakeService } from "../../src/runtime/message/message-intake-service.js";
import {
  shouldShowProcessingReaction,
  shouldShowProcessingUi
} from "../../src/runtime/message/processing-visibility.js";

test("ambient room chat trigger does not add a processing reaction", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "server_public",
        chatBehavior: "ambient_room_chat"
      },
      chatEngagement: {
        trigger_kind: "ambient_room",
        is_directed_to_bot: false,
        sparse_ordinal: null,
        ordinary_message_count: null
      }
    }),
    false
  );
});

test("question marker trigger does not add a processing reaction", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "server_public",
        chatBehavior: "directed_help_chat"
      },
      chatEngagement: {
        trigger_kind: "question_marker",
        is_directed_to_bot: false,
        sparse_ordinal: null,
        ordinary_message_count: null
      }
    }),
    false
  );
});

test("sparse chat does not add a processing reaction", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "server_public",
        chatBehavior: "directed_help_chat"
      },
      chatEngagement: {
        trigger_kind: "sparse_periodic",
        is_directed_to_bot: false,
        sparse_ordinal: 5,
        ordinary_message_count: 5
      }
    }),
    false
  );
});

test("directed chat adds a processing reaction", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "server_public",
        chatBehavior: "ambient_room_chat"
      },
      chatEngagement: {
        trigger_kind: "reply_to_bot",
        is_directed_to_bot: true,
        sparse_ordinal: null,
        ordinary_message_count: null
      }
    }),
    true
  );
});

test("forum feature keeps the processing reaction even when legacy mode says chat", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "server_public",
        features: ["forum_research", "conversation"],
        chatBehavior: null
      },
      chatEngagement: null
    }),
    true
  );
});

test("clear explanation feature keeps the processing reaction in dedicated threads", () => {
  assert.equal(
    shouldShowProcessingReaction({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "server_public",
        features: ["clear_explanation", "conversation"],
        chatBehavior: null
      },
      chatEngagement: null
    }),
    true
  );
});

test("conversation feature uses chat visibility even when legacy mode says url watch", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "url_watch",
        defaultScope: "conversation_only",
        features: ["conversation"],
        chatBehavior: "ambient_room_chat"
      },
      chatEngagement: {
        trigger_kind: "sparse_periodic",
        is_directed_to_bot: false,
        sparse_ordinal: 5,
        ordinary_message_count: 5
      }
    }),
    false
  );
});

test("RES.01.02 ambient sparse interval is configurable instead of fixed at five messages", async () => {
  const enqueued: unknown[] = [];
  const service = new MessageIntakeService(
    createConfig({ runtime: { ambientSparseInterval: 10 } }),
    {
      enqueue: (item: unknown) => {
        enqueued.push(item);
        return true;
      }
    } as never,
    {
      increment: () => ({ ordinary_message_count: 5 })
    } as never,
    {
      evaluate: async () => ({
        decision: "sparse",
        triggerKind: null,
        isDirectedToBot: false
      })
    } as never,
    {
      isEnabled: () => true
    } as never,
    {
      observe: () => {}
    } as never,
    {
      evaluateMessage: async () => ({ decision: "pass" })
    } as never,
    {
      buildEffectiveContent: async (message: { content: string }) => message.content
    } as never,
    createNoopLogger()
  );

  await service.handle(createMessageDouble());

  assert.equal(
    enqueued.length,
    0,
    "count 5 must remain sparse when BOT_AMBIENT_SPARSE_INTERVAL is configured to 10"
  );
});

function createConfig(input: {
  runtime?: Partial<AppConfig["runtime"]>;
} = {}): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "application",
    discordOwnerUserIds: ["owner"],
    botDbPath: ":memory:",
    botLogLevel: "fatal",
    codexAppServerCommand: "codex app-server",
    codexHomePath: null,
    watchLocations: [
      {
        guildId: "guild",
        channelId: "chat-root",
        mode: "chat",
        defaultScope: "server_public",
        features: ["conversation"],
        chatBehavior: "ambient_room_chat"
      }
    ],
    chatRuntimeControls: null,
    weeklyMeetupAnnouncement: null,
    runtime: {
      maxConcurrentKeys: 4,
      retryPollIntervalMs: 15_000,
      codexIdleCloseMs: 1_800_000,
      ambientSparseInterval: 5,
      ...input.runtime
    }
  };
}

function createMessageDouble() {
  return {
    id: "message-1",
    guildId: "guild",
    channelId: "chat-root",
    content: "今日は人が多いね",
    createdAt: new Date("2026-06-23T00:00:00.000Z"),
    webhookId: null,
    author: {
      id: "user",
      bot: false
    },
    attachments: new Map(),
    channel: {
      id: "chat-root",
      type: ChannelType.GuildText,
      isThread: () => false
    },
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
    inGuild: () => true,
    react: async () => {}
  } as never;
}

function createNoopLogger(): never {
  return {
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {}
  } as never;
}
