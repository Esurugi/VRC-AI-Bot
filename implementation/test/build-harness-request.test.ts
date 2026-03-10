import test from "node:test";
import assert from "node:assert/strict";

import { buildHarnessRequest } from "../src/harness/build-harness-request.js";

test("buildHarnessRequest defaults to root channel context", () => {
  const request = buildHarnessRequest({
    actorRole: "user",
    scope: "channel_family",
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "chat",
      defaultScope: "channel_family"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "こんにちは",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    taskKind: "route_message"
  });

  assert.equal(request.available_context.thread_context.kind, "root_channel");
  assert.equal(request.available_context.thread_context.source_message_id, null);
  assert.equal(request.available_context.thread_context.reply_thread_id, null);
  assert.deepEqual(request.available_context.thread_context.known_source_urls, []);
  assert.deepEqual(request.available_context.fetchable_public_urls, []);
  assert.deepEqual(request.available_context.blocked_urls, []);
});

test("buildHarnessRequest includes knowledge thread facts and URL fetch boundary", () => {
  const request = buildHarnessRequest({
    actorRole: "admin",
    scope: "server_public",
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "url_watch",
      defaultScope: "server_public"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "thread-1",
      messageId: "message-2",
      authorId: "user-2",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "もっと詳しく https://example.com https://localhost/test",
      urls: ["https://example.com", "https://localhost/test"],
      receivedAt: "2026-03-10T00:00:01.000Z"
    },
    taskKind: "route_message",
    threadContext: {
      kind: "knowledge_thread",
      sourceMessageId: "source-1",
      knownSourceUrls: ["https://openai.com/index/harness-engineering/"],
      replyThreadId: "thread-1",
      rootChannelId: "channel-1"
    },
    allowExternalFetch: true,
    allowKnowledgeWrite: true
  });

  assert.equal(request.place.thread_id, "thread-1");
  assert.deepEqual(request.available_context.thread_context, {
    kind: "knowledge_thread",
    source_message_id: "source-1",
    known_source_urls: ["https://openai.com/index/harness-engineering/"],
    reply_thread_id: "thread-1",
    root_channel_id: "channel-1"
  });
  assert.deepEqual(request.available_context.fetchable_public_urls, [
    "https://example.com"
  ]);
  assert.deepEqual(request.available_context.blocked_urls, [
    "https://localhost/test"
  ]);
});
