import test from "node:test";
import assert from "node:assert/strict";

import {
  SessionPolicyResolver,
  resolveScopedPlaceId
} from "../../src/codex/session-policy.js";

test("url watch root share resolves to knowledge ingest with message origin binding", () => {
  const resolver = new SessionPolicyResolver();
  const session = resolver.resolveForMessage({
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
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "server_public",
      chatBehavior: null
    },
    actorRole: "user",
    scope: "server_public",
    workspaceWriteActive: false
  });

  assert.equal(session.workloadKind, "knowledge_ingest");
  assert.equal(session.bindingKind, "message_origin");
  assert.equal(session.bindingId, "channel:message:message");
});

test("url watch root without evidence stays in conversation scope", () => {
  const resolver = new SessionPolicyResolver();
  const session = resolver.resolveForMessage({
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "こんにちは",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "server_public",
      chatBehavior: null
    },
    actorRole: "user",
    scope: "server_public",
    workspaceWriteActive: false
  });

  assert.equal(session.workloadKind, "conversation");
  assert.equal(session.bindingKind, "place");
  assert.equal(session.bindingId, "channel:url_watch");
});

test("resolved scoped place id keeps knowledge roots on message origin", () => {
  assert.equal(
    resolveScopedPlaceId({
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
      watchLocation: {
        guildId: "guild",
        channelId: "channel",
        mode: "url_watch",
        defaultScope: "server_public",
        chatBehavior: null
      }
    }),
    "channel:message:message"
  );

  assert.equal(
    resolveScopedPlaceId({
      envelope: {
        guildId: "guild",
        channelId: "thread",
        messageId: "message",
        authorId: "user",
        placeType: "public_thread",
        rawPlaceType: "PublicThread",
        content: "",
        urls: [],
        receivedAt: new Date().toISOString()
      },
      watchLocation: {
        guildId: "guild",
        channelId: "channel",
        mode: "url_watch",
        defaultScope: "server_public",
        chatBehavior: null
      }
    }),
    "thread"
  );
});
