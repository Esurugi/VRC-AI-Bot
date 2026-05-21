import test from "node:test";
import assert from "node:assert/strict";

import { SessionPolicyResolver } from "../../../src/codex/session-policy.js";
import { ForumFirstTurnPreprocessor } from "../../../src/runtime/forum/forum-first-turn-preprocessor.js";

const logger = {
  warn: () => {}
};

test("forum first turn starter message follows forum feature instead of legacy mode", async () => {
  const preprocessor = new ForumFirstTurnPreprocessor(
    {} as never,
    new SessionPolicyResolver(),
    logger
  );

  const preparation = await preprocessor.resolveEffectiveContentOverride({
    message: {
      channel: {
        isThread: () => true,
        fetchStarterMessage: async () => ({
          content: "スレッドの最初の依頼"
        })
      }
    } as never,
    envelope: {
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "forum_post_thread",
      rawPlaceType: "PublicThread",
      content: "追加です",
      urls: [],
      receivedAt: "2026-05-21T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild",
      channelId: "forum-root",
      mode: "chat",
      defaultScope: "server_public",
      features: ["forum_research", "conversation"],
      chatBehavior: null
    },
    actorRole: "user",
    scope: "server_public"
  });

  assert.equal(preparation.starterMessage, "スレッドの最初の依頼");
});
