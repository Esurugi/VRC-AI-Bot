import test from "node:test";
import assert from "node:assert/strict";

import { FeatureThreadService } from "../../../src/runtime/thread/feature-thread-service.js";
import type { WatchLocationConfig } from "../../../src/domain/types.js";

test("forum research handles the starter message without a mention", async () => {
  const service = new FeatureThreadService();

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

test("forum research ignores non-directed follow-up messages", async () => {
  const service = new FeatureThreadService();

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

test("forum research handles direct mention follow-up messages as bot-directed", async () => {
  const service = new FeatureThreadService();

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

test("forum research handles bot reply follow-up messages as bot-directed", async () => {
  const service = new FeatureThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "follow-up",
      threadId: "thread",
      starterMessageId: "starter",
      replyToBot: true
    }),
    createForumWatchLocation()
  );

  assert.deepEqual(result, {
    decision: "handle",
    engagement: {
      decision: "always",
      triggerKind: "reply_to_bot",
      isDirectedToBot: true
    }
  });
});

test("non-forum places pass through to the normal engagement policy", async () => {
  const service = new FeatureThreadService();

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

test("clear explanation handles the starter message without a mention", async () => {
  const service = new FeatureThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "starter",
      threadId: "thread",
      starterMessageId: "starter"
    }),
    createClearExplanationWatchLocation()
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

test("clear explanation ignores non-directed follow-up messages", async () => {
  const service = new FeatureThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "follow-up",
      threadId: "thread",
      starterMessageId: "starter"
    }),
    createClearExplanationWatchLocation()
  );

  assert.deepEqual(result, {
    decision: "ignore"
  });
});

test("clear explanation handles direct mention follow-up messages as bot-directed", async () => {
  const service = new FeatureThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "follow-up",
      threadId: "thread",
      starterMessageId: "starter",
      mentionsBot: true
    }),
    createClearExplanationWatchLocation()
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

test("clear explanation handles bot reply follow-up messages as bot-directed", async () => {
  const service = new FeatureThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "follow-up",
      threadId: "thread",
      starterMessageId: "starter",
      replyToBot: true
    }),
    createClearExplanationWatchLocation()
  );

  assert.deepEqual(result, {
    decision: "handle",
    engagement: {
      decision: "always",
      triggerKind: "reply_to_bot",
      isDirectedToBot: true
    }
  });
});

test("question gateway handles the starter message without a mention", async () => {
  const service = new FeatureThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "starter",
      threadId: "thread",
      starterMessageId: "starter"
    }),
    createQuestionGatewayWatchLocation()
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

test("question gateway ignores natural-language follow-up without command or directed engagement", async () => {
  const service = new FeatureThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "follow-up",
      threadId: "thread",
      starterMessageId: "starter"
    }),
    createQuestionGatewayWatchLocation()
  );

  assert.deepEqual(result, {
    decision: "ignore"
  });
});

test("question gateway handles direct mention follow-up as directed engagement", async () => {
  const service = new FeatureThreadService();

  const result = await service.evaluateMessage(
    createForumMessage({
      id: "follow-up",
      threadId: "thread",
      starterMessageId: "starter",
      mentionsBot: true
    }),
    createQuestionGatewayWatchLocation()
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

function createForumWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild",
    channelId: "forum-root",
    mode: "forum_longform",
    defaultScope: "server_public",
    chatBehavior: null
  };
}

function createClearExplanationWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild",
    channelId: "clear-root",
    mode: "chat",
    defaultScope: "server_public",
    features: ["clear_explanation", "conversation"],
    chatBehavior: null
  };
}

function createQuestionGatewayWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild",
    channelId: "question-gateway-root",
    mode: "chat",
    defaultScope: "server_public",
    features: ["question_gateway", "conversation"] as unknown as NonNullable<
      WatchLocationConfig["features"]
    >,
    chatBehavior: null
  };
}

function createForumMessage(input: {
  id: string;
  threadId: string;
  starterMessageId: string;
  mentionsBot?: boolean;
  replyToBot?: boolean;
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
            messageId: "reply-target"
          }
        : null,
    fetchReference: async () => ({
      author: {
        id: botUserId
      }
    }),
    channel: {
      id: input.threadId,
      isThread: () => true,
      fetchStarterMessage: async () => ({
        id: input.starterMessageId
      })
    }
  } as never;
}
