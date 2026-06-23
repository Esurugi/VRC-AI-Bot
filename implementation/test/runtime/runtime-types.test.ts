import test from "node:test";
import assert from "node:assert/strict";

import { resolveRetryWatchLocation } from "../../src/runtime/types.js";
import type { AppConfig } from "../../src/domain/types.js";

test("retry watch location lookup ignores legacy mode mismatch", () => {
  const config = {
    discordBotToken: "token",
    discordApplicationId: "application",
    discordOwnerUserIds: [],
    botDbPath: ":memory:",
    botLogLevel: "info",
    runtime: {
      maxConcurrentKeys: 4,
      retryPollIntervalMs: 15_000,
      codexIdleCloseMs: 1_800_000,
      ambientSparseInterval: 5
    },
    codexAppServerCommand: "codex",
    codexHomePath: null,
    watchLocations: [
      {
        guildId: "guild",
        channelId: "forum-root",
        mode: "chat",
        features: ["forum_research", "conversation"],
        defaultScope: "server_public",
        chatBehavior: null
      }
    ],
    chatRuntimeControls: null,
    weeklyMeetupAnnouncement: null
  } satisfies AppConfig;

  const resolved = resolveRetryWatchLocation(config, {
    guildId: "guild",
    watchChannelId: "forum-root",
    mode: "forum_longform"
  });

  assert.equal(resolved.channelId, "forum-root");
  assert.deepEqual(resolved.features, ["forum_research", "conversation"]);
});
