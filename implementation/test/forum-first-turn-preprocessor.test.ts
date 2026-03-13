import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ForumPromptPreparationExecutor } from "../src/codex/codex-exec-prompt-preprocessor-adapter.js";
import { SessionPolicyResolver } from "../src/codex/session-policy.js";
import { ForumFirstTurnPreprocessor } from "../src/runtime/forum/forum-first-turn-preprocessor.js";
import { SqliteStore } from "../src/storage/database.js";

test("ForumFirstTurnPreprocessor prepares starter text only for the first forum session turn", async () => {
  const fixture = createFixture();
  const message = createForumMessage({
    messageId: "message-2",
    content: "follow-up",
    starterContent: "thread starter"
  });

  try {
    const result = await fixture.preprocessor.resolveEffectiveContentOverride({
      message,
      envelope: {
        guildId: "guild-1",
        channelId: "forum-thread-1",
        messageId: "message-2",
        authorId: "user-1",
        placeType: "forum_post_thread",
        rawPlaceType: "PublicThread",
        content: "follow-up",
        urls: [],
        receivedAt: "2026-03-10T00:00:00.000Z"
      },
      watchLocation: {
        guildId: "guild-1",
        channelId: "forum-parent-1",
        mode: "forum_longform",
        defaultScope: "conversation_only"
      },
      actorRole: "user",
      scope: "conversation_only"
    });

    assert.deepEqual(result, {
      preparedPrompt: "prepared::thread starter",
      progressNotice: "論点と前提を整理しながら考えています。少し待ってください。",
      wasPreprocessed: true
    });
    assert.deepEqual(fixture.executor.calls, [
      {
        threadId: "forum-thread-1",
        starterMessage: "thread starter"
      }
    ]);
  } finally {
    fixture.close();
  }
});

test("ForumFirstTurnPreprocessor reports preparation needed only before the first forum session turn", async () => {
  const fixture = createFixture();
  const input = {
    message: createForumMessage({
      messageId: "message-2",
      content: "follow-up",
      starterContent: "thread starter"
    }),
    envelope: {
      guildId: "guild-1",
      channelId: "forum-thread-1",
      messageId: "message-2",
      authorId: "user-1",
      placeType: "forum_post_thread",
      rawPlaceType: "PublicThread",
      content: "follow-up",
      urls: [] as string[],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "forum-parent-1",
      mode: "forum_longform",
      defaultScope: "conversation_only"
    },
    actorRole: "user" as const,
    scope: "conversation_only" as const
  } as const;

  try {
    assert.equal(await fixture.preprocessor.needsPreparation(input), true);

    const identity = fixture.sessionPolicyResolver.resolveForMessage({
      envelope: input.envelope,
      watchLocation: input.watchLocation,
      actorRole: input.actorRole,
      scope: input.scope,
      workspaceWriteActive: false
    });
    fixture.store.codexSessions.upsert({
      sessionIdentity: identity.sessionIdentity,
      workloadKind: identity.workloadKind,
      bindingKind: identity.bindingKind,
      bindingId: identity.bindingId,
      actorId: identity.actorId,
      sandboxMode: identity.sandboxMode,
      modelProfile: identity.modelProfile,
      runtimeContractVersion: identity.runtimeContractVersion,
      lifecyclePolicy: identity.lifecyclePolicy,
      codexThreadId: "codex-thread-1"
    });

    assert.equal(await fixture.preprocessor.needsPreparation(input), false);
  } finally {
    fixture.close();
  }
});

test("ForumFirstTurnPreprocessor skips preprocessing when a forum session binding already exists", async () => {
  const fixture = createFixture();
  const identity = fixture.sessionPolicyResolver.resolveForMessage({
    envelope: {
      guildId: "guild-1",
      channelId: "forum-thread-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "forum_post_thread",
      rawPlaceType: "PublicThread",
      content: "starter",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "forum-parent-1",
      mode: "forum_longform",
      defaultScope: "conversation_only"
    },
    actorRole: "user",
    scope: "conversation_only",
    workspaceWriteActive: false
  });
  fixture.store.codexSessions.upsert({
    sessionIdentity: identity.sessionIdentity,
    workloadKind: identity.workloadKind,
    bindingKind: identity.bindingKind,
    bindingId: identity.bindingId,
    actorId: identity.actorId,
    sandboxMode: identity.sandboxMode,
    modelProfile: identity.modelProfile,
    runtimeContractVersion: identity.runtimeContractVersion,
    lifecyclePolicy: identity.lifecyclePolicy,
    codexThreadId: "codex-thread-1"
  });

  try {
    const result = await fixture.preprocessor.resolveEffectiveContentOverride({
      message: createForumMessage({
        messageId: "message-2",
        content: "follow-up",
        starterContent: "thread starter"
      }),
      envelope: {
        guildId: "guild-1",
        channelId: "forum-thread-1",
        messageId: "message-2",
        authorId: "user-1",
        placeType: "forum_post_thread",
        rawPlaceType: "PublicThread",
        content: "follow-up",
        urls: [],
        receivedAt: "2026-03-10T00:00:00.000Z"
      },
      watchLocation: {
        guildId: "guild-1",
        channelId: "forum-parent-1",
        mode: "forum_longform",
        defaultScope: "conversation_only"
      },
      actorRole: "user",
      scope: "conversation_only"
    });

    assert.deepEqual(result, {
      preparedPrompt: null,
      progressNotice: null,
      wasPreprocessed: false
    });
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    fixture.close();
  }
});

test("ForumFirstTurnPreprocessor falls back to raw content when preprocessing fails", async () => {
  const fixture = createFixture({
    executorError: new Error("codex exec failed")
  });

  try {
    const result = await fixture.preprocessor.resolveEffectiveContentOverride({
      message: createForumMessage({
        messageId: "message-2",
        content: "follow-up",
        starterContent: "thread starter"
      }),
      envelope: {
        guildId: "guild-1",
        channelId: "forum-thread-1",
        messageId: "message-2",
        authorId: "user-1",
        placeType: "forum_post_thread",
        rawPlaceType: "PublicThread",
        content: "follow-up",
        urls: [],
        receivedAt: "2026-03-10T00:00:00.000Z"
      },
      watchLocation: {
        guildId: "guild-1",
        channelId: "forum-parent-1",
        mode: "forum_longform",
        defaultScope: "conversation_only"
      },
      actorRole: "user",
      scope: "conversation_only"
    });

    assert.deepEqual(result, {
      preparedPrompt: null,
      progressNotice: null,
      wasPreprocessed: false
    });
    assert.equal(fixture.warns.length, 1);
  } finally {
    fixture.close();
  }
});

function createFixture(input: { executorError?: Error } = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-forum-pre-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const sessionPolicyResolver = new SessionPolicyResolver();
  const executor = new FakeExecutor(input.executorError);
  const warns: Array<Record<string, unknown>> = [];
  const preprocessor = new ForumFirstTurnPreprocessor(
    store,
    sessionPolicyResolver,
    executor,
    {
      warn(context: unknown) {
        warns.push(context as Record<string, unknown>);
      }
    } as never
  );

  return {
    store,
    sessionPolicyResolver,
    executor,
    warns,
    preprocessor,
    close() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function createForumMessage(input: {
  messageId: string;
  content: string;
  starterContent: string;
}) {
  return {
    id: input.messageId,
    channel: {
      id: "forum-thread-1",
      isThread: () => true,
      fetchStarterMessage: async () => ({
        content: input.starterContent
      })
    }
  } as never;
}

class FakeExecutor implements ForumPromptPreparationExecutor {
  readonly calls: Array<{ threadId: string; starterMessage: string }> = [];

  constructor(private readonly executorError?: Error) {}

  async prepareForumFirstTurnPrompt(input: {
    threadId: string;
    starterMessage: string;
  }): Promise<{
    preparedPrompt: string;
    progressNotice: string | null;
  }> {
    this.calls.push(input);
    if (this.executorError) {
      throw this.executorError;
    }

    return {
      preparedPrompt: `prepared::${input.starterMessage}`,
      progressNotice: "論点と前提を整理しながら考えています。少し待ってください。"
    };
  }
}
