import assert from "node:assert/strict";
import test from "node:test";

import { isKnowledgePlaceRootShare } from "../../src/domain/response-boundary.js";
import { buildHarnessRequest } from "../../src/harness/build-harness-request.js";
import type { MessageEnvelope, WatchLocationConfig } from "../../src/domain/types.js";

test("R6 supporting: knowledge_ingest feature remains canonical when legacy mode says chat", () => {
  const watchLocation = {
    guildId: "guild-1",
    channelId: "knowledge-root",
    mode: "chat",
    features: ["knowledge_ingest", "conversation"],
    defaultScope: "server_public",
    chatBehavior: "directed_help_chat"
  } satisfies WatchLocationConfig;
  const envelope = {
    guildId: "guild-1",
    channelId: "knowledge-root",
    messageId: "message-1",
    authorId: "user-1",
    placeType: "guild_text",
    rawPlaceType: "GuildText",
    content: "知見化して https://example.com/source",
    urls: ["https://example.com/source"],
    receivedAt: "2026-05-21T00:00:00.000Z"
  } satisfies MessageEnvelope;

  assert.equal(
    isKnowledgePlaceRootShare({
      watchLocation,
      envelope
    }),
    true
  );

  const request = buildHarnessRequest({
    actorRole: "user",
    scope: "server_public",
    watchLocation,
    envelope,
    taskKind: "route_message",
    allowExternalFetch: true,
    allowKnowledgeWrite: true
  });

  assert.equal(request.place.mode, "chat");
  assert.deepEqual(request.available_context.place_context, {
    features: ["knowledge_ingest", "conversation"],
    is_knowledge_place: true
  });
  assert.deepEqual(request.available_context.fetchable_public_urls, [
    "https://example.com/source"
  ]);
});

test("R6 supporting: legacy chat mode alone must not create a knowledge place", () => {
  const request = buildHarnessRequest({
    actorRole: "user",
    scope: "conversation_only",
    watchLocation: {
      guildId: "guild-1",
      channelId: "chat-root",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "chat-root",
      messageId: "message-2",
      authorId: "user-1",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "雑談 https://example.com/source",
      urls: ["https://example.com/source"],
      receivedAt: "2026-05-21T00:00:00.000Z"
    },
    taskKind: "route_message"
  });

  assert.equal(request.place.mode, "chat");
  assert.deepEqual(request.available_context.place_context, {
    features: ["conversation"],
    is_knowledge_place: false
  });
});
