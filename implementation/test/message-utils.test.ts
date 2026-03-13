import test from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";

import {
  resolvePlaceType,
  resolveWatchLocation
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

test("resolvePlaceType returns forum_post_thread for forum_longform watch threads", () => {
  const placeType = resolvePlaceType(
    {
      type: ChannelType.PublicThread,
      isThread: () => true
    } as never,
    "forum_longform"
  );

  assert.equal(placeType, "forum_post_thread");
});

test("resolvePlaceType keeps public_thread for non-forum watch threads", () => {
  const placeType = resolvePlaceType(
    {
      type: ChannelType.PublicThread,
      isThread: () => true
    } as never,
    "url_watch"
  );

  assert.equal(placeType, "public_thread");
});
