import test from "node:test";
import assert from "node:assert/strict";

import { ForumThreadService } from "../../../src/runtime/forum/forum-thread-service.js";
import type { WatchLocationConfig } from "../../../src/domain/types.js";

test("forum research handles the starter message without a mention", async () => {
  const service = new ForumThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "starter",
      threadId: "thread",
      starterMessageId: "starter"
    }),
    createForumWatchLocation()
  );

  assert.deepEqual(result, {
    decision: "handle",
    engagement: {
      decision: "always",
      triggerKind: null,
      isDirectedToBot: false
    }
  });
});

test("forum research ignores unmentioned follow-up messages", async () => {
  const service = new ForumThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "follow-up",
      threadId: "thread",
      starterMessageId: "starter"
    }),
    createForumWatchLocation()
  );

  assert.deepEqual(result, {
    decision: "ignore"
  });
});

test("forum research handles mentioned follow-up messages as bot-directed", async () => {
  const service = new ForumThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "follow-up",
      threadId: "thread",
      starterMessageId: "starter",
      mentionsBot: true
    }),
    createForumWatchLocation()
  );

  assert.deepEqual(result, {
    decision: "handle",
    engagement: {
      decision: "always",
      triggerKind: "direct_mention",
      isDirectedToBot: true
    }
  });
});

test("non-forum places pass through to the normal engagement policy", async () => {
  const service = new ForumThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "message",
      threadId: "thread",
      starterMessageId: "starter"
    }),
    {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "directed_help_chat"
    }
  );

  assert.deepEqual(result, {
    decision: "pass"
  });
});

function createForumWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild",
    channelId: "forum-root",
    mode: "forum_longform",
    defaultScope: "server_public",
    chatBehavior: null
  };
}

function createForumMessage(input: {
  id: string;
  threadId: string;
  starterMessageId: string;
  mentionsBot?: boolean;
}) {
  const botUserId = "bot";

  return {
    id: input.id,
    client: {
      user: {
        id: botUserId
      }
    },
    mentions: {
      users: {
        has: (userId: string) => input.mentionsBot === true && userId === botUserId
      }
    },
    channel: {
      id: input.threadId,
      isThread: () => true,
      fetchStarterMessage: async () => ({
        id: input.starterMessageId
      })
    }
  } as never;
}
