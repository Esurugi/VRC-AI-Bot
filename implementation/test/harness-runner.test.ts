import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import pino from "pino";

import type { CodexSandboxMode } from "../src/domain/types.js";
import { SessionManager } from "../src/codex/session-manager.js";
import {
  SessionPolicyResolver,
  resolveScopedPlaceId
} from "../src/codex/session-policy.js";
import type { HarnessRequest, HarnessResponse } from "../src/harness/contracts.js";
import { HarnessRunner } from "../src/harness/harness-runner.js";
import { SqliteStore } from "../src/storage/database.js";

type HarnessTurnSessionMetadata = {
  sessionIdentity: string;
  workloadKind: string;
  modelProfile: string;
  runtimeContractVersion: string;
};

test("resolveScopedPlaceId uses thread id inside threads", () => {
  assert.equal(
    resolveScopedPlaceId({
      envelope: {
        guildId: "guild-1",
        channelId: "thread-1",
        messageId: "message-1",
        authorId: "user-1",
        placeType: "public_thread",
        rawPlaceType: "PublicThread",
        content: "もっと詳しく",
        urls: [],
        receivedAt: "2026-03-10T00:00:00.000Z"
      },
      watchLocation: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "url_watch",
        defaultScope: "server_public"
      }
    }),
    "thread-1"
  );
});

test("resolveScopedPlaceId isolates url_watch root URL messages by source message id", () => {
  assert.equal(
    resolveScopedPlaceId({
      envelope: {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-1",
        authorId: "user-1",
        placeType: "guild_text",
        rawPlaceType: "GuildText",
        content: "https://example.com",
        urls: ["https://example.com"],
        receivedAt: "2026-03-10T00:00:00.000Z"
      },
      watchLocation: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "url_watch",
        defaultScope: "server_public"
      }
    }),
    "channel-1:message:message-1"
  );
});

test("HarnessRunner starts a read-only conversation session and passes runtime facts path", async () => {
  const fixture = createFixture([
    createHarnessResponse({
      public_text: "了解しました。"
    })
  ]);

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        discordRuntimeFactsPath: ".tmp/discord-runtime/message-1.json"
      })
    );

    assert.equal(result.response.public_text, "了解しました。");
    assert.equal(result.session.threadId, "thread-1");
    assert.equal(result.session.startedFresh, true);
    assert.deepEqual(fixture.codexClient.startCalls, [
      { sandbox: "read-only", model: "gpt-5.4" }
    ]);
    assert.equal(fixture.codexClient.runCalls.length, 1);
    assert.equal(
      fixture.codexClient.runCalls[0]?.request.available_context
        .discord_runtime_facts_path,
      ".tmp/discord-runtime/message-1.json"
    );
    assert.deepEqual(fixture.codexClient.runCalls[0]?.request.capabilities, {
      allow_external_fetch: true,
      allow_knowledge_write: true,
      allow_moderation: false
    });
    assert.deepEqual(fixture.codexClient.runCalls[0]?.sessionMetadata, {
      sessionIdentity: result.session.identity.sessionIdentity,
      workloadKind: "conversation",
      modelProfile: result.session.identity.modelProfile,
      runtimeContractVersion: result.session.identity.runtimeContractVersion
    });
    assert.equal(
      fixture.store.codexSessions.get(result.session.identity.sessionIdentity)
        ?.codex_thread_id,
      "thread-1"
    );
  } finally {
    fixture.close();
  }
});

test("HarnessRunner uses admin_override workspace-write session for active override thread turns", async () => {
  const fixture = createFixture([
    createHarnessResponse({
      public_text: "この thread では write context で会話しています。"
    })
  ]);
  fixture.store.overrideSessions.start({
    sessionId: "override-1",
    guildId: "guild-1",
    actorId: "admin-1",
    grantedBy: "admin-1",
    scopePlaceId: "thread-1",
    flags: {
      allowPlaywrightHeaded: true,
      allowPlaywrightPersistent: false,
      allowPromptInjectionTest: false,
      suspendViolationCounterForCurrentThread: false,
      allowExternalFetchInPrivateContextWithoutPrivateTerms: false
    },
    sandboxMode: "workspace-write",
    startedAt: "2026-03-10T00:00:00.000Z"
  });

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        actorRole: "admin",
        scope: "conversation_only",
        watchLocation: {
          guildId: "guild-1",
          channelId: "channel-1",
          mode: "admin_control",
          defaultScope: "server_public"
        },
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-1",
          authorId: "admin-1",
          placeType: "public_thread",
          rawPlaceType: "PublicThread",
          content: "今の実装方針を確認したい",
          urls: [],
          receivedAt: "2026-03-10T00:00:01.000Z"
        }
      })
    );

    assert.equal(
      result.response.public_text,
      "この thread では write context で会話しています。"
    );
    assert.equal(result.session.identity.workloadKind, "admin_override");
    assert.equal(result.session.identity.sandboxMode, "workspace-write");
    assert.equal(result.session.identity.actorId, "admin-1");
    assert.deepEqual(fixture.codexClient.startCalls, [
      { sandbox: "workspace-write", model: "gpt-5.4" }
    ]);
    assert.deepEqual(fixture.codexClient.runCalls[0]?.request.capabilities, {
      allow_external_fetch: true,
      allow_knowledge_write: true,
      allow_moderation: true
    });
    assert.deepEqual(fixture.codexClient.runCalls[0]?.sessionMetadata, {
      sessionIdentity: result.session.identity.sessionIdentity,
      workloadKind: "admin_override",
      modelProfile: result.session.identity.modelProfile,
      runtimeContractVersion: result.session.identity.runtimeContractVersion
    });
    assert.equal(
      fixture.store.codexSessions.get(result.session.identity.sessionIdentity)
        ?.codex_thread_id,
      "thread-1"
    );
  } finally {
    fixture.close();
  }
});

test("HarnessRunner denies repo-write intent without active override", async () => {
  const fixture = createFixture([
    createHarnessResponse({
      repo_write_intent: true,
      public_text: "このままでは変更できません。"
    })
  ]);

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        actorRole: "admin",
        scope: "conversation_only",
        watchLocation: {
          guildId: "guild-1",
          channelId: "channel-1",
          mode: "admin_control",
          defaultScope: "server_public"
        },
        envelope: {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-1",
          authorId: "admin-1",
          placeType: "admin_control_channel",
          rawPlaceType: "GuildText",
          content: "この repo を修正して",
          urls: [],
          receivedAt: "2026-03-10T00:00:01.000Z"
        }
      })
    );

    assert.match(result.response.public_text ?? "", /override-start/);
    assert.deepEqual(fixture.codexClient.startCalls, [
      { sandbox: "read-only", model: "gpt-5.4" }
    ]);
  } finally {
    fixture.close();
  }
});

test("HarnessRunner swallows knowledge persistence failures and keeps the reply path alive", () => {
  const fixture = createFixture([]);

  try {
    assert.doesNotThrow(() =>
      fixture.runner.persistKnowledgeResult({
        actorRole: "user",
        scope: "server_public",
        watchLocation: {
          guildId: "guild-1",
          channelId: "channel-1",
          mode: "chat",
          defaultScope: "channel_family"
        },
        envelope: {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-persist-1",
          authorId: "user-1",
          placeType: "chat_channel",
          rawPlaceType: "GuildText",
          content: "保存して",
          urls: [],
          receivedAt: "2026-03-10T00:00:01.000Z"
        },
        response: createHarnessResponse({
          outcome: "knowledge_ingest",
          public_text: "保存します。",
          reply_mode: "same_place",
          knowledge_writes: []
        }),
        replyThreadId: null,
        persistenceScope: "server_public"
      })
    );
  } finally {
    fixture.close();
  }
});

test("HarnessRunner uses server_public persistence scope for natural-language knowledge save", async () => {
  const fixture = createFixture([
    createHarnessResponse({
      outcome: "knowledge_ingest",
      public_text: "調査結果を共有知見として保存します。",
      reply_mode: "same_place",
      knowledge_writes: [
        createKnowledgeWrite({
          source_url: "https://example.com/article",
          canonical_url: "https://example.com/article",
          title: "Example Article",
          summary: "summary"
        })
      ]
    })
  ]);

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        envelope: {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-10",
          authorId: "user-1",
          placeType: "chat_channel",
          rawPlaceType: "GuildText",
          content: "Claude Code hooks を調べて知見として保存して",
          urls: [],
          receivedAt: "2026-03-10T00:00:10.000Z"
        }
      })
    );

    assert.equal(result.response.outcome, "knowledge_ingest");
    assert.equal(result.knowledgePersistenceScope, "server_public");
    assert.deepEqual(fixture.codexClient.runCalls[0]?.request.capabilities, {
      allow_external_fetch: true,
      allow_knowledge_write: true,
      allow_moderation: false
    });
  } finally {
    fixture.close();
  }
});

test("HarnessRunner keeps explicit admin diagnostics requests as diagnostics", async () => {
  const fixture = createFixture([
    createHarnessResponse({
      outcome: "admin_diagnostics",
      public_text: null,
      diagnostics: {
        notes: "reported routing state"
      }
    })
  ]);

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        actorRole: "admin",
        scope: "conversation_only",
        watchLocation: {
          guildId: "guild-1",
          channelId: "channel-1",
          mode: "admin_control",
          defaultScope: "server_public"
        },
        envelope: {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-1",
          authorId: "admin-1",
          placeType: "admin_control_channel",
          rawPlaceType: "GuildText",
          content: "診断 JSON を出して",
          urls: [],
          receivedAt: "2026-03-10T00:00:01.000Z"
        }
      })
    );

    assert.equal(result.response.outcome, "admin_diagnostics");
    assert.equal(result.response.diagnostics.notes, "reported routing state");
  } finally {
    fixture.close();
  }
});

function createFixture(responses: HarnessResponse[]) {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-harness-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const codexClient = new FakeCodexClient(responses);
  const sessionPolicyResolver = new SessionPolicyResolver();
  const sessionManager = new SessionManager(
    store,
    codexClient as never,
    pino({ level: "silent" })
  );
  const runner = new HarnessRunner(
    store,
    codexClient as never,
    sessionPolicyResolver,
    sessionManager,
    pino({ level: "silent" })
  );

  return {
    store,
    codexClient,
    runner,
    sessionPolicyResolver,
    sessionManager,
    close() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function createHarnessInput(
  overrides: Partial<Parameters<HarnessRunner["routeMessage"]>[0]> = {}
): Parameters<HarnessRunner["routeMessage"]>[0] {
  return {
    actorRole: "user",
    scope: "channel_family",
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "chat",
      defaultScope: "channel_family"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "こんにちは",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    ...overrides
  };
}

function createKnowledgeWrite(
  overrides: Partial<HarnessResponse["knowledge_writes"][number]> = {}
): HarnessResponse["knowledge_writes"][number] {
  return {
    source_url: null,
    canonical_url: null,
    title: null,
    summary: null,
    tags: [],
    content_hash: null,
    normalized_text: null,
    source_kind: null,
    ...overrides
  };
}

function createHarnessResponse(
  overrides: Partial<HarnessResponse> = {}
): HarnessResponse {
  return {
    outcome: "chat_reply",
    repo_write_intent: false,
    public_text: "ok",
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [],
    knowledge_writes: [],
    persist_items: [],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none",
    ...overrides
  };
}

class FakeCodexClient {
  readonly startCalls: Array<{ sandbox: CodexSandboxMode; model: string }> = [];
  readonly resumeCalls: Array<{ threadId: string; sandbox: CodexSandboxMode }> = [];
  readonly archiveCalls: string[] = [];
  readonly unsubscribeCalls: string[] = [];
  readonly runCalls: Array<{
    threadId: string;
    request: HarnessRequest;
    sessionMetadata?: HarnessTurnSessionMetadata;
  }> = [];
  private threadCount = 0;
  private sessionInvalidationGeneration = 0;

  constructor(private readonly responses: HarnessResponse[]) {}

  async startThread(
    sandbox: CodexSandboxMode,
    model = "gpt-5.4"
  ): Promise<string> {
    this.startCalls.push({ sandbox, model });
    this.threadCount += 1;
    return `thread-${this.threadCount}`;
  }

  async resumeThread(threadId: string, sandbox: CodexSandboxMode): Promise<void> {
    this.resumeCalls.push({ threadId, sandbox });
  }

  async archiveThread(threadId: string): Promise<void> {
    this.archiveCalls.push(threadId);
  }

  async unsubscribeThread(threadId: string): Promise<void> {
    this.unsubscribeCalls.push(threadId);
  }

  getSessionInvalidationGeneration(): number {
    return this.sessionInvalidationGeneration;
  }

  setSessionInvalidationGeneration(generation: number): void {
    this.sessionInvalidationGeneration = generation;
  }

  async runHarnessRequest(
    threadId: string,
    request: HarnessRequest,
    sessionMetadata?: HarnessTurnSessionMetadata
  ): Promise<HarnessResponse> {
    this.runCalls.push(
      sessionMetadata
        ? { threadId, request, sessionMetadata }
        : { threadId, request }
    );
    const response = this.responses.shift();
    if (!response) {
      throw new Error("missing fake response");
    }
    return response;
  }
}
