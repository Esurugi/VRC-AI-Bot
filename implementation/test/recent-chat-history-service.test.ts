import assert from "node:assert/strict";
import test from "node:test";

import { Collection } from "discord.js";

import {
  buildRecentHistoryFacts,
  RecentChatHistoryService
} from "../src/runtime/chat/recent-chat-history-service.js";

test("buildRecentHistoryFacts stops at the latest visible bot reply", () => {
  const history = new Collection<string, ReturnType<typeof createHistoryMessage>>();
  history.set("m5", createHistoryMessage({ id: "m5", authorId: "user-3", content: "latest" }));
  history.set("m4", createHistoryMessage({ id: "m4", authorId: "bot-1", content: "bot reply" }));
  history.set("m3", createHistoryMessage({ id: "m3", authorId: "user-2", content: "older" }));

  const recent = buildRecentHistoryFacts(history as never, "bot-1");

  assert.deepEqual(recent, [
    {
      message_id: "m5",
      author_id: "user-3",
      content: "latest",
      created_at: "2026-03-10T00:00:00.000Z"
    }
  ]);
});

test("buildRecentHistoryFacts keeps the newest 20 human messages in chronological order", () => {
  const history = new Collection<string, ReturnType<typeof createHistoryMessage>>();
  for (let index = 25; index >= 1; index -= 1) {
    history.set(
      `m${index}`,
      createHistoryMessage({
        id: `m${index}`,
        authorId: `user-${index}`,
        content: `message ${index}`
      })
    );
  }

  const recent = buildRecentHistoryFacts(history as never, "bot-1");

  assert.equal(recent.length, 20);
  assert.equal(recent[0]?.message_id, "m6");
  assert.equal(recent[19]?.message_id, "m25");
});

test("RecentChatHistoryService skips non-chat watch modes", async () => {
  const service = new RecentChatHistoryService({
    warn() {
      throw new Error("warn should not be called");
    }
  });

  const recent = await service.collect({
    message: createRuntimeMessage(),
    watchLocation: {
      guildId: "guild-1",
      channelId: "forum-parent-1",
      mode: "forum_longform",
      defaultScope: "conversation_only"
    }
  });

  assert.deepEqual(recent, []);
});

function createHistoryMessage(input: {
  id: string;
  authorId: string;
  content: string;
  bot?: boolean;
  webhookId?: string | null;
  system?: boolean;
}) {
  return {
    id: input.id,
    author: {
      id: input.authorId,
      bot: input.bot ?? false
    },
    content: input.content,
    createdAt: new Date("2026-03-10T00:00:00.000Z"),
    webhookId: input.webhookId ?? null,
    system: input.system ?? false
  };
}

function createRuntimeMessage() {
  return {
    id: "message-1",
    channelId: "channel-1",
    client: {
      user: {
        id: "bot-1"
      }
    },
    channel: {
      messages: {
        fetch: async () => new Collection()
      }
    }
  } as never;
}
