import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SessionPolicyResolver } from "../src/codex/session-policy.js";
import type { ForumResearchPlan } from "../src/forum-research/types.js";
import { ForumFirstTurnPreprocessor } from "../src/runtime/forum/forum-first-turn-preprocessor.js";
import { SqliteStore } from "../src/storage/database.js";

test("ForumFirstTurnPreprocessor uses planner output on the first forum session turn", async () => {
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
      preparedPrompt: "prepared::thread starter",
      progressNotice: "論点と前提を整理しながら考えています。少し待ってください。",
      wasPreprocessed: true,
      researchPlan: createResearchPlan()
    });
    assert.deepEqual(fixture.planner.calls, [
      {
        messageId: "forum-thread-1",
        currentMessage: "follow-up",
        starterMessage: "thread starter",
        isInitialTurn: true,
        threadId: "forum-thread-1"
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
    envelope: createEnvelope("message-2", "follow-up"),
    watchLocation: createWatchLocation(),
    actorRole: "user" as const,
    scope: "conversation_only" as const
  };

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

test("ForumFirstTurnPreprocessor skips planner when a forum session binding already exists", async () => {
  const fixture = createFixture();
  const identity = fixture.sessionPolicyResolver.resolveForMessage({
    envelope: createEnvelope("message-1", "starter"),
    watchLocation: createWatchLocation(),
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
      envelope: createEnvelope("message-2", "follow-up"),
      watchLocation: createWatchLocation(),
      actorRole: "user",
      scope: "conversation_only"
    });

    assert.deepEqual(result, {
      preparedPrompt: null,
      progressNotice: null,
      wasPreprocessed: false,
      researchPlan: null
    });
    assert.deepEqual(fixture.planner.calls, []);
  } finally {
    fixture.close();
  }
});

test("ForumFirstTurnPreprocessor falls back cleanly when planner fails", async () => {
  const fixture = createFixture({
    plannerError: new Error("forum planner failed")
  });

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
      researchPlan: null
    });
    assert.equal(fixture.warns.length, 1);
  } finally {
    fixture.close();
  }
});

function createFixture(input: { plannerError?: Error } = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-forum-pre-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const sessionPolicyResolver = new SessionPolicyResolver();
  const planner = new FakePlanner(input.plannerError);
  const warns: Array<Record<string, unknown>> = [];
  const preprocessor = new ForumFirstTurnPreprocessor(store, sessionPolicyResolver, planner as never, {
    warn(context: unknown) {
      warns.push(context as Record<string, unknown>);
    }
  } as never);

  return {
    store,
    sessionPolicyResolver,
    planner,
    warns,
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

function createResearchPlan(): ForumResearchPlan {
  return {
    progress_notice: "論点と前提を整理しながら考えています。少し待ってください。",
    effective_user_text: "prepared::thread starter",
    worker_tasks: [
      {
        worker_id: "worker-1",
        question: "subquestion",
        search_focus: "focus",
        must_cover: ["point-a"],
        min_sources: 2,
        max_sources: 3
      }
    ],
    synthesis_brief: "brief"
  };
}

class FakePlanner {
  readonly calls: Array<{
    messageId: string;
    currentMessage: string;
    starterMessage: string | null;
    isInitialTurn: boolean;
    threadId: string;
  }> = [];

  constructor(private readonly plannerError?: Error) {}

  async plan(input: {
    messageId: string;
    currentMessage: string;
    starterMessage: string | null;
    isInitialTurn: boolean;
    threadId: string;
  }): Promise<ForumResearchPlan> {
    this.calls.push(input);
    if (this.plannerError) {
      throw this.plannerError;
    }

    return createResearchPlan();
  }
}
