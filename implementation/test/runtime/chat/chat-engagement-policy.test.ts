import test from "node:test";
import assert from "node:assert/strict";

import {
  ChatEngagementPolicy,
  toChatEngagementFact
} from "../../../src/runtime/chat/chat-engagement-policy.js";

test("chat mode always responds to direct bot mentions", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "<@bot> みんなに自己紹介して",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({
      mentionsBot: true
    })
  });

  assert.deepEqual(decision, {
    decision: "always",
    triggerKind: "direct_mention",
    isDirectedToBot: true
  });
});

test("chat mode keeps ordinary non-question chatter sparse", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "directed_help_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "今日は人多いね",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "sparse",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("chat mode treats replies to the bot as directed", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "それってどういう意味？",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({
      replyToBot: true
    })
  });

  assert.deepEqual(decision, {
    decision: "always",
    triggerKind: "reply_to_bot",
    isDirectedToBot: true
  });
});

test("directed help chat keeps non-directed question markers sparse", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "directed_help_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "いま何使ってる？",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "sparse",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("ambient room chat keeps non-directed question markers sparse", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "それ誰に聞いてるの？",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "sparse",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("ambient room chat keeps ordinary chatter sparse", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "今日は人多いね",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "sparse",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("ambient room chat thread ignores ordinary chatter", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "今日は人多いね",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "ignore",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("ambient room chat thread ignores non-directed question markers", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "これどうする？",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "ignore",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("ambient room chat thread keeps direct mentions actionable", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "<@bot> ここだけ返して",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({
      mentionsBot: true
    })
  });

  assert.deepEqual(decision, {
    decision: "always",
    triggerKind: "direct_mention",
    isDirectedToBot: true
  });
});

test("ambient room chat thread keeps replies to the bot actionable", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "その続きは？",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({
      replyToBot: true
    })
  });

  assert.deepEqual(decision, {
    decision: "always",
    triggerKind: "reply_to_bot",
    isDirectedToBot: true
  });
});

test("directed help chat thread ignores non-directed ordinary chatter", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "directed_help_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "今日は人多いね",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "ignore",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("directed help chat thread ignores non-directed question markers", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "directed_help_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "これどうする？",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "ignore",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("url watch root ignores ordinary chatter without urls", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "server_public",
      chatBehavior: null
    },
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "なんでや！！！！",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "ignore",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("url watch root keeps url shares actionable", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "server_public",
      chatBehavior: null
    },
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "https://example.com/post",
      urls: ["https://example.com/post"],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "always",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("url watch root allows explicit bot-directed prompts without urls", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "server_public",
      chatBehavior: null
    },
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "<@bot> これ知見として整理して",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({
      mentionsBot: true
    })
  });

  assert.deepEqual(decision, {
    decision: "always",
    triggerKind: "direct_mention",
    isDirectedToBot: true
  });
});

test("knowledge ingest thread ignores non-directed follow-up without urls", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "server_public",
      chatBehavior: null
    },
    envelope: {
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "この部分を補足して",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "ignore",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("knowledge ingest thread handles direct mention follow-up", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "server_public",
      chatBehavior: null
    },
    envelope: {
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "<@bot> この部分を補足して",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({
      mentionsBot: true
    })
  });

  assert.deepEqual(decision, {
    decision: "always",
    triggerKind: "direct_mention",
    isDirectedToBot: true
  });
});

test("knowledge ingest thread handles bot reply follow-up", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "server_public",
      chatBehavior: null
    },
    envelope: {
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "この部分を補足して",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({
      replyToBot: true
    })
  });

  assert.deepEqual(decision, {
    decision: "always",
    triggerKind: "reply_to_bot",
    isDirectedToBot: true
  });
});

test("conversation feature uses chat behavior even when legacy mode says url watch", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "conversation_only",
      features: ["conversation"],
      chatBehavior: "directed_help_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "今日は人多いね",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "sparse",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("knowledge ingest feature keeps ordinary root chatter ignored when legacy mode says chat", async () => {
  const policy = new ChatEngagementPolicy();
  const decision = await policy.evaluate({
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "server_public",
      features: ["knowledge_ingest", "conversation"],
      chatBehavior: null
    },
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "なんでや！！！！",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    message: createMessageDouble({})
  });

  assert.deepEqual(decision, {
    decision: "ignore",
    triggerKind: null,
    isDirectedToBot: false
  });
});

test("sparse engagement fact carries periodic count metadata", () => {
  const fact = toChatEngagementFact({
    evaluation: {
      decision: "sparse",
      triggerKind: null,
      isDirectedToBot: false
    },
    ordinaryMessageCount: 10
  });

  assert.deepEqual(fact, {
    trigger_kind: "sparse_periodic",
    is_directed_to_bot: false,
    sparse_ordinal: 10,
    ordinary_message_count: 10
  });
});

test("question marker engagement facts are not directed to the bot", () => {
  const fact = toChatEngagementFact({
    evaluation: {
      decision: "always",
      triggerKind: "question_marker",
      isDirectedToBot: false
    }
  });

  assert.deepEqual(fact, {
    trigger_kind: "question_marker",
    is_directed_to_bot: false,
    sparse_ordinal: null,
    ordinary_message_count: null
  });
});

function createMessageDouble(input: {
  mentionsBot?: boolean;
  replyToBot?: boolean;
}) {
  const botUserId = "bot";

  return {
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
    })
  } as never;
}
