import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveWatchLocation,
  shouldProcessMessage
} from "../src/discord/message-utils.js";

test("resolveWatchLocation inherits parent watch location for thread messages", () => {
  const resolved = resolveWatchLocation(
    {
      inGuild: () => true,
      channel: {
        id: "thread-1",
        isThread: () => true,
        parentId: "channel-1"
      }
    } as never,
    [
      {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "url_watch",
        defaultScope: "server_public"
      }
    ]
  );

  assert.deepEqual(resolved, {
    guildId: "guild-1",
    channelId: "channel-1",
    mode: "url_watch",
    defaultScope: "server_public"
  });
});

test("shouldProcessMessage no longer pre-drops non-empty url_watch root messages", () => {
  assert.equal(
    shouldProcessMessage(
      {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-1",
        authorId: "user-1",
        placeType: "guild_text",
        rawPlaceType: "GuildText",
        content: "もっと詳しく",
        urls: [],
        receivedAt: new Date().toISOString()
      },
      {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "url_watch",
        defaultScope: "server_public"
      }
    ),
    true
  );
});

test("shouldProcessMessage keeps blocked-only URL posts for LLM interpretation", () => {
  assert.equal(
    shouldProcessMessage(
      {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-4",
        authorId: "user-1",
        placeType: "guild_text",
        rawPlaceType: "GuildText",
        content: "http://localhost:3000/private",
        urls: ["http://localhost:3000/private"],
        receivedAt: new Date().toISOString()
      },
      {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "url_watch",
        defaultScope: "server_public"
      }
    ),
    true
  );
});
