import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SessionPolicyResolver } from "../src/codex/session-policy.js";
import { ForumFirstTurnPreprocessor } from "../src/runtime/forum/forum-first-turn-preprocessor.js";
import { SqliteStore } from "../src/storage/database.js";

test("ForumFirstTurnPreprocessor returns starter message facts for forum threads", async () => {
  const fixture = createFixture();

  try {
    const result = await fixture.preprocessor.resolveEffectiveContentOverride({
      message: createForumMessage({
        messageId: "message-2",
        content: "follow-up",
        starterContent: "thread starter"
      }),
      envelope: createEnvelope("message-2", "follow-up"),
      watchLocation: createWatchLocation(),
      actorRole: "user",
      scope: "conversation_only"
    });

    assert.deepEqual(result, {
      preparedPrompt: null,
      progressNotice: null,
      wasPreprocessed: false,
      starterMessage: "thread starter"
    });
  } finally {
    fixture.close();
  }
});

test("ForumFirstTurnPreprocessor returns empty preparation outside forum threads", async () => {
  const fixture = createFixture();

  try {
    const result = await fixture.preprocessor.resolveEffectiveContentOverride({
      message: {
        id: "message-2",
        content: "follow-up",
        channel: {
          id: "chat-1",
          isThread: () => false
        }
      } as never,
      envelope: {
        ...createEnvelope("message-2", "follow-up"),
        placeType: "guild_text"
      },
      watchLocation: {
        ...createWatchLocation(),
        mode: "chat"
      },
      actorRole: "user",
      scope: "conversation_only"
    });

    assert.deepEqual(result, {
      preparedPrompt: null,
      progressNotice: null,
      wasPreprocessed: false,
      starterMessage: null
    });
  } finally {
    fixture.close();
  }
});

function createFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-forum-pre-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const sessionPolicyResolver = new SessionPolicyResolver();
  const preprocessor = new ForumFirstTurnPreprocessor(
    store,
    sessionPolicyResolver,
    { warn() {} } as never
  );

  return {
    preprocessor,
    close() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function createWatchLocation() {
  return {
    guildId: "guild-1",
    channelId: "forum-parent-1",
    mode: "forum_longform" as const,
    defaultScope: "conversation_only" as const
  };
}

function createEnvelope(messageId: string, content: string) {
  return {
    guildId: "guild-1",
    channelId: "forum-thread-1",
    messageId,
    authorId: "user-1",
    placeType: "forum_post_thread" as const,
    rawPlaceType: "PublicThread",
    content,
    urls: [],
    receivedAt: "2026-03-10T00:00:00.000Z"
  };
}

function createForumMessage(input: {
  messageId: string;
  content: string;
  starterContent: string;
}) {
  return {
    id: input.messageId,
    content: input.content,
    channel: {
      id: "forum-thread-1",
      isThread: () => true,
      fetchStarterMessage: async () => ({
        content: input.starterContent
      })
    }
  } as never;
}
