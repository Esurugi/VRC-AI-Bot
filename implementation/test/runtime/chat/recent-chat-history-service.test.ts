import test from "node:test";
import assert from "node:assert/strict";

import { Collection } from "discord.js";
import type { WatchLocationConfig } from "../../../src/domain/types.js";

import {
  buildRecentRoomEventFacts,
  RecentChatHistoryService,
  shouldCollectRecentRoomEvents
} from "../../../src/runtime/chat/recent-chat-history-service.js";

test("recent chat history keeps recent bot turns in a minimal room-event shape", () => {
  const botUserId = "bot";
  const history = new Collection<string, never>([
    [
      "m3",
      createHistoryMessage({
        id: "m3",
        authorId: "user-3",
        authorDisplayName: "ebi",
        content: "おおーー",
        createdAt: "2026-03-15T13:19:00.000Z",
        replyToMessageId: "m2",
        replyToAuthorId: "user-2",
        replyToAuthorDisplayName: "余暇"
      })
    ],
    [
      "m2",
      createHistoryMessage({
        id: "m2",
        authorId: "user-2",
        authorDisplayName: "余暇",
        content: "GPT5.5 fast を使っています()",
        createdAt: "2026-03-15T13:18:00.000Z",
        mentionsBot: true
      })
    ],
    [
      "bot-1",
      createHistoryMessage({
        id: "bot-1",
        authorId: botUserId,
        authorDisplayName: "ティラピコ",
        content: "今のおすすめは…",
        createdAt: "2026-03-15T13:17:00.000Z"
      })
    ],
    [
      "m0",
      createHistoryMessage({
        id: "m0",
        authorId: "user-0",
        authorDisplayName: "uhima",
        content: "@ティラピコ いまオススメのLLMモデルは何？",
        createdAt: "2026-03-15T13:16:00.000Z",
        mentionsBot: true
      })
    ]
  ]);

  const roomEvents = buildRecentRoomEventFacts(history, botUserId);

  assert.deepEqual(roomEvents, [
    {
      message_id: "m0",
      author: "uhima",
      is_bot: false,
      reply_to_message_id: null,
      mentions_bot: true,
      content: "@ティラピコ いまオススメのLLMモデルは何？"
    },
    {
      message_id: "bot-1",
      author: "ティラピコ",
      is_bot: true,
      reply_to_message_id: null,
      mentions_bot: false,
      content: "今のおすすめは…"
    },
    {
      message_id: "m2",
      author: "余暇",
      is_bot: false,
      reply_to_message_id: null,
      mentions_bot: true,
      content: "GPT5.5 fast を使っています()"
    },
    {
      message_id: "m3",
      author: "ebi",
      is_bot: false,
      reply_to_message_id: "m2",
      mentions_bot: false,
      content: "おおーー"
    }
  ]);
});

test("recent room event collection includes forum research threads", () => {
  assert.equal(
    shouldCollectRecentRoomEvents({
      watchLocation: {
        guildId: "guild",
        channelId: "forum-root",
        mode: "chat",
        defaultScope: "server_public",
        features: ["forum_research", "conversation"],
        chatBehavior: null
      },
      message: {
        channel: {
          isThread: () => true
        }
      } as never
    }),
    true
  );

  assert.equal(
    shouldCollectRecentRoomEvents({
      watchLocation: {
        guildId: "guild",
        channelId: "forum-root",
        mode: "forum_longform",
        defaultScope: "server_public",
        features: ["forum_research", "conversation"],
        chatBehavior: null
      },
      message: {
        channel: {
          isThread: () => false
        }
      } as never
    }),
    false
  );
});

test("recent room event collection uses ambient conversation policy instead of legacy mode", () => {
  assert.equal(
    shouldCollectRecentRoomEvents({
      watchLocation: {
        guildId: "guild",
        channelId: "chat-root",
        mode: "url_watch",
        defaultScope: "conversation_only",
        features: ["conversation"],
        chatBehavior: "ambient_room_chat"
      },
      message: {
        channel: {
          isThread: () => false
        }
      } as never
    }),
    true
  );

  assert.equal(
    shouldCollectRecentRoomEvents({
      watchLocation: {
        guildId: "guild",
        channelId: "knowledge-root",
        mode: "chat",
        defaultScope: "server_public",
        features: ["knowledge_ingest", "conversation"],
        chatBehavior: null
      },
      message: {
        channel: {
          isThread: () => false
        }
      } as never
    }),
    false
  );
});

test("observed Discord messages populate a per-channel room-event ring buffer before REST history fetch", async () => {
  const botUserId = "bot";
  const service = new RecentChatHistoryService(createLogger());
  const fetchCalls: Array<{ limit: number; before?: string }> = [];

  for (let index = 1; index <= 12; index += 1) {
    service.observe(
      createHistoryMessage({
        id: `a-${String(index).padStart(2, "0")}`,
        channelId: "channel-a",
        clientUserId: botUserId,
        authorId: index === 5 ? botUserId : `user-${index}`,
        authorBot: index === 5,
        authorDisplayName: index === 5 ? "ティラピコ" : `user ${index}`,
        content: `observed ${index}`,
        createdAt: `2026-03-15T13:${String(index).padStart(2, "0")}:00.000Z`,
        mentionsBot: index === 4
      })
    );
  }
  service.observe(
    createHistoryMessage({
      id: "other-channel",
      channelId: "channel-b",
      clientUserId: botUserId,
      authorId: "user-other",
      authorDisplayName: "other",
      content: "wrong channel",
      createdAt: "2026-03-15T13:30:00.000Z"
    })
  );
  service.observe(
    createHistoryMessage({
      id: "other-bot",
      channelId: "channel-a",
      clientUserId: botUserId,
      authorId: "bot-other",
      authorBot: true,
      authorDisplayName: "other bot",
      content: "must be excluded",
      createdAt: "2026-03-15T13:31:00.000Z"
    })
  );
  service.observe(
    createHistoryMessage({
      id: "webhook",
      channelId: "channel-a",
      clientUserId: botUserId,
      authorId: "webhook-author",
      authorDisplayName: "webhook",
      content: "must be excluded",
      createdAt: "2026-03-15T13:32:00.000Z",
      webhookId: "webhook-1"
    })
  );
  service.observe(
    createHistoryMessage({
      id: "system",
      channelId: "channel-a",
      clientUserId: botUserId,
      authorId: "system-author",
      authorDisplayName: "system",
      content: "must be excluded",
      createdAt: "2026-03-15T13:33:00.000Z",
      system: true
    })
  );

  const context = await service.collect({
    watchLocation: createAmbientWatchLocation("channel-a"),
    message: createCollectMessage({
      id: "current",
      channelId: "channel-a",
      clientUserId: botUserId,
      fetchCalls
    })
  });

  assert.deepEqual(
    context.recentRoomEvents.map((event) => event.message_id),
    [
      "a-01",
      "a-02",
      "a-03",
      "a-04",
      "a-05",
      "a-06",
      "a-07",
      "a-08",
      "a-09",
      "a-10",
      "a-11",
      "a-12"
    ]
  );
  assert.equal(context.recentRoomEvents[4]?.is_bot, true);
  assert.equal(context.recentRoomEvents[3]?.mentions_bot, true);
  assert.deepEqual(fetchCalls, []);
});

test("recent room event collection falls back to Discord REST only on cold start", async () => {
  const botUserId = "bot";
  const service = new RecentChatHistoryService(createLogger());
  const fetchCalls: Array<{ limit: number; before?: string }> = [];
  const fetchedHistory = new Collection<string, never>([
    [
      "older-2",
      createHistoryMessage({
        id: "older-2",
        channelId: "channel-a",
        clientUserId: botUserId,
        authorId: "user-2",
        authorDisplayName: "user 2",
        content: "older 2",
        createdAt: "2026-03-15T13:18:00.000Z"
      })
    ],
    [
      "older-1",
      createHistoryMessage({
        id: "older-1",
        channelId: "channel-a",
        clientUserId: botUserId,
        authorId: "user-1",
        authorDisplayName: "user 1",
        content: "older 1",
        createdAt: "2026-03-15T13:17:00.000Z"
      })
    ]
  ]);

  const context = await service.collect({
    watchLocation: createAmbientWatchLocation("channel-a"),
    message: createCollectMessage({
      id: "current",
      channelId: "channel-a",
      clientUserId: botUserId,
      fetchCalls,
      fetchedHistory
    })
  });

  assert.deepEqual(fetchCalls, [{ limit: 50, before: "current" }]);
  assert.deepEqual(
    context.recentRoomEvents.map((event) => event.message_id),
    ["older-1", "older-2"]
  );
});

test("observed room-event history uses Discord REST only to fill an insufficient ring buffer", async () => {
  const botUserId = "bot";
  const service = new RecentChatHistoryService(createLogger());
  const fetchCalls: Array<{ limit: number; before?: string }> = [];
  const fetchedHistory = new Collection<string, never>([
    [
      "rest-2",
      createHistoryMessage({
        id: "rest-2",
        channelId: "channel-a",
        clientUserId: botUserId,
        authorId: "user-rest-2",
        authorDisplayName: "rest 2",
        content: "rest 2",
        createdAt: "2026-03-15T13:18:00.000Z"
      })
    ],
    [
      "rest-1",
      createHistoryMessage({
        id: "rest-1",
        channelId: "channel-a",
        clientUserId: botUserId,
        authorId: "user-rest-1",
        authorDisplayName: "rest 1",
        content: "rest 1",
        createdAt: "2026-03-15T13:17:00.000Z"
      })
    ]
  ]);

  service.observe(
    createHistoryMessage({
      id: "observed-1",
      channelId: "channel-a",
      clientUserId: botUserId,
      authorId: "user-observed",
      authorDisplayName: "observed",
      content: "observed 1",
      createdAt: "2026-03-15T13:19:00.000Z"
    })
  );

  const context = await service.collect({
    watchLocation: createAmbientWatchLocation("channel-a"),
    message: createCollectMessage({
      id: "current",
      channelId: "channel-a",
      clientUserId: botUserId,
      fetchCalls,
      fetchedHistory
    })
  });

  assert.deepEqual(fetchCalls, [{ limit: 50, before: "observed-1" }]);
  assert.deepEqual(
    context.recentRoomEvents.map((event) => event.message_id),
    ["rest-1", "rest-2", "observed-1"]
  );
});

function createLogger() {
  return {
    warn: () => undefined
  };
}

function createAmbientWatchLocation(channelId: string): WatchLocationConfig {
  return {
    guildId: "guild",
    channelId,
    mode: "chat",
    defaultScope: "conversation_only",
    features: ["conversation"],
    chatBehavior: "ambient_room_chat"
  };
}

function createCollectMessage(input: {
  id: string;
  channelId: string;
  clientUserId: string;
  fetchCalls: Array<{ limit: number; before?: string }>;
  fetchedHistory?: Collection<string, never>;
}) {
  return {
    id: input.id,
    channelId: input.channelId,
    client: {
      user: {
        id: input.clientUserId
      }
    },
    channel: {
      isThread: () => false,
      messages: {
        fetch: async (options: { limit: number; before?: string }) => {
          input.fetchCalls.push(options);
          return input.fetchedHistory ?? new Collection<string, never>();
        }
      }
    }
  } as never;
}

function createHistoryMessage(input: {
  id: string;
  channelId?: string;
  clientUserId?: string;
  authorId: string;
  authorBot?: boolean;
  authorDisplayName: string;
  content: string;
  createdAt: string;
  mentionsBot?: boolean;
  webhookId?: string | null;
  system?: boolean;
  replyToMessageId?: string;
  replyToAuthorId?: string;
  replyToAuthorDisplayName?: string;
}) {
  const repliedUser =
    input.replyToAuthorId && input.replyToAuthorDisplayName
      ? {
          id: input.replyToAuthorId,
          globalName: input.replyToAuthorDisplayName,
          username: input.replyToAuthorDisplayName
        }
      : null;

  return {
    id: input.id,
    channelId: input.channelId ?? "channel",
    client: {
      user: input.clientUserId
        ? {
            id: input.clientUserId
          }
        : null
    },
    author: {
      id: input.authorId,
      bot: input.authorBot ?? false,
      globalName: input.authorDisplayName,
      username: input.authorDisplayName
    },
    member: {
      displayName: input.authorDisplayName
    },
    content: input.content,
    createdAt: new Date(input.createdAt),
    webhookId: input.webhookId ?? null,
    system: input.system ?? false,
    reference: input.replyToMessageId
      ? {
          messageId: input.replyToMessageId
        }
      : null,
    mentions: {
      repliedUser,
      users: {
        has: (userId: string) => input.mentionsBot === true && userId === "bot"
      }
    },
    guild: {
      members: {
        cache: new Collection(
          repliedUser
            ? [[input.replyToAuthorId!, { displayName: input.replyToAuthorDisplayName! }]]
            : []
        )
      }
    },
    inGuild: () => true
  } as never;
}
