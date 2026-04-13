import test from "node:test";
import assert from "node:assert/strict";

import {
  isExplicitBotDirectedEngagement,
  isKnowledgePlaceMode,
  isKnowledgePlaceRootShare,
  isThreadEnvelope
} from "../../src/domain/response-boundary.js";

test("knowledge place mode is limited to url watch", () => {
  assert.equal(isKnowledgePlaceMode("url_watch"), true);
  assert.equal(isKnowledgePlaceMode("chat"), false);
  assert.equal(isKnowledgePlaceMode("admin_control"), false);
  assert.equal(isKnowledgePlaceMode("forum_longform"), false);
});

test("thread envelopes are recognized by place type", () => {
  assert.equal(
    isThreadEnvelope({
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "",
      urls: [],
      receivedAt: new Date().toISOString()
    }),
    true
  );

  assert.equal(
    isThreadEnvelope({
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "",
      urls: [],
      receivedAt: new Date().toISOString()
    }),
    false
  );
});

test("knowledge place root share depends on root-place evidence only", () => {
  assert.equal(
    isKnowledgePlaceRootShare({
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
        content: "https://example.com",
        urls: ["https://example.com"],
        receivedAt: new Date().toISOString()
      }
    }),
    true
  );

  assert.equal(
    isKnowledgePlaceRootShare({
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
        placeType: "guild_text",
        rawPlaceType: "GuildText",
        content: "https://example.com",
        urls: ["https://example.com"],
        receivedAt: new Date().toISOString()
      }
    }),
    false
  );

  assert.equal(
    isKnowledgePlaceRootShare({
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
        content: "https://example.com",
        urls: ["https://example.com"],
        receivedAt: new Date().toISOString()
      }
    }),
    false
  );

  assert.equal(
    isKnowledgePlaceRootShare({
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
        placeType: "private_thread",
        rawPlaceType: "PrivateThread",
        content: "follow-up https://example.com/more",
        urls: ["https://example.com/more"],
        receivedAt: new Date().toISOString()
      }
    }),
    false
  );
});

test("explicit bot-directed engagement is limited to mentions and replies", () => {
  assert.equal(
    isExplicitBotDirectedEngagement({
      trigger_kind: "direct_mention",
      is_directed_to_bot: true,
      sparse_ordinal: null,
      ordinary_message_count: null
    }),
    true
  );

  assert.equal(
    isExplicitBotDirectedEngagement({
      trigger_kind: "reply_to_bot",
      is_directed_to_bot: true,
      sparse_ordinal: null,
      ordinary_message_count: null
    }),
    true
  );

  assert.equal(
    isExplicitBotDirectedEngagement({
      trigger_kind: "ambient_room",
      is_directed_to_bot: false,
      sparse_ordinal: null,
      ordinary_message_count: null
    }),
    false
  );
});
