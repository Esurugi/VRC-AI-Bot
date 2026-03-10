import test from "node:test";
import assert from "node:assert/strict";

import { resolveHarnessPlaceId } from "../src/harness/harness-runner.js";

test("resolveHarnessPlaceId uses thread channel id inside threads", () => {
  assert.equal(
    resolveHarnessPlaceId({
      envelope: {
        guildId: "guild-1",
        channelId: "thread-1",
        messageId: "message-1",
        authorId: "user-1",
        placeType: "public_thread",
        rawPlaceType: "PublicThread",
        content: "もっと詳しく",
        urls: [],
        receivedAt: new Date().toISOString()
      },
      watchLocation: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "url_watch",
        defaultScope: "server_public"
      },
      actorRole: "user",
      scope: "server_public"
    }),
    "thread-1"
  );
});

test("resolveHarnessPlaceId isolates URL messages by source message id", () => {
  assert.equal(
    resolveHarnessPlaceId({
      envelope: {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-1",
        authorId: "user-1",
        placeType: "guild_text",
        rawPlaceType: "GuildText",
        content: "https://example.com",
        urls: ["https://example.com"],
        receivedAt: new Date().toISOString()
      },
      watchLocation: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "url_watch",
        defaultScope: "server_public"
      },
      actorRole: "user",
      scope: "server_public"
    }),
    "channel-1:message:message-1"
  );
});

test("resolveHarnessPlaceId keeps channel-scoped chat sessions for non-URL chat", () => {
  assert.equal(
    resolveHarnessPlaceId({
      envelope: {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-1",
        authorId: "user-1",
        placeType: "chat_channel",
        rawPlaceType: "GuildText",
        content: "やあ",
        urls: [],
        receivedAt: new Date().toISOString()
      },
      watchLocation: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "chat",
        defaultScope: "channel_family"
      },
      actorRole: "user",
      scope: "channel_family"
    }),
    "channel-1:chat"
  );
});
