import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SqliteStore } from "../../src/storage/database.js";

test("AE-DB-02 config storage round-trip preserves place capabilities", () => {
  const workspace = createTempWorkspace();
  let store: SqliteStore | null = null;
  let reopened: SqliteStore | null = null;
  try {
    const dbPath = join(workspace, "bot.sqlite");
    store = createMigratedStore(dbPath);
    store.watchLocations.sync([
      {
        guildId: "guild-1",
        channelId: "ops-root",
        featureProfileId: "ops-override",
        mode: "admin_control",
        defaultScope: "conversation_only",
        features: ["admin_override", "conversation"],
        chatBehavior: "directed_help_chat"
      }
    ]);
    store.close();
    store = null;

    reopened = createMigratedStore(dbPath);
    assert.deepEqual(reopened.watchLocations.list(), [
      {
        guildId: "guild-1",
        channelId: "ops-root",
        featureProfileId: "ops-override",
        mode: "admin_control",
        defaultScope: "conversation_only",
        features: ["admin_override", "conversation"],
        chatBehavior: "directed_help_chat"
      }
    ]);
  } finally {
    store?.close();
    reopened?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("AE-DB-02 storage repositories round-trip public contract rows after reopen", () => {
  const workspace = createTempWorkspace();
  let store: SqliteStore | null = null;
  let reopened: SqliteStore | null = null;
  try {
    const dbPath = join(workspace, "bot.sqlite");
    store = createMigratedStore(dbPath);
    seedPublicContractRows(store);
    store.close();
    store = null;

    reopened = createMigratedStore(dbPath);

    const session = reopened.codexSessions.get("session:conversation:thread-1");
    assert.ok(session);
    assert.equal(typeof session.created_at, "string");
    assert.equal(typeof session.updated_at, "string");
    assert.deepEqual(
      {
        ...session,
        created_at: "<timestamp>",
        updated_at: "<timestamp>"
      },
      {
      session_identity: "session:conversation:thread-1",
      workload_kind: "conversation",
      binding_kind: "thread",
      binding_id: "thread-1",
      actor_id: "user-1",
      sandbox_mode: "read-only",
      model_profile: "gpt-5-mini",
      runtime_contract_version: "v1",
      lifecycle_policy: "reusable",
      codex_thread_id: "codex-thread-1",
        created_at: "<timestamp>",
        updated_at: "<timestamp>"
      }
    );

    assert.equal(
      reopened.knowledgeRecords.get("record-1")?.visibility_key,
      "server_public:guild-1"
    );
    assert.deepEqual(
      reopened.knowledgeRecords.findVisibleByCanonicalUrl(
        "https://example.com/research",
        ["server_public"],
        ["server_public:guild-1"]
      ),
      [
        {
          sourceId: "record-1",
          title: "Research Note",
          summary: "Summary that users can retrieve after restart.",
          tags: ["ai", "vrc"],
          scope: "server_public",
          recency: "2026-05-21T00:00:00.000Z",
          canonicalUrl: "https://example.com/research"
        }
      ]
    );
    assert.deepEqual(reopened.knowledgeArtifacts.get("record-1"), {
      record_id: "record-1",
      final_url: "https://example.com/research",
      snapshot_path: "artifacts/record-1.html",
      screenshot_path: "artifacts/record-1.png",
      network_log_path: null
    });
    assert.deepEqual(reopened.knowledgeSourceTexts.get("record-1"), {
      record_id: "record-1",
      normalized_text: "Normalized public source text",
      source_kind: "public_url",
      captured_at: "2026-05-21T00:01:00.000Z"
    });
    assert.deepEqual(reopened.sourceLinks.listForSourceMessage("message-1"), [
      {
        link_id: "link-1",
        record_id: "record-1",
        source_message_id: "message-1",
        reply_thread_id: "thread-1",
        created_at: "2026-05-21T00:02:00.000Z"
      }
    ]);

    assert.equal(reopened.messageProcessing.get("message-2")?.state, "pending_retry");
    assert.deepEqual(
      normalizeClearExplanationGateState(
        reopened.clearExplanationGateStates.get("clear-thread-1")
      ),
      {
        thread_id: "clear-thread-1",
        root_channel_id: "clear-root-1",
        first_message_id: "clear-message-1",
        decision: "redirect_to_general_question",
        reason: "test redirect",
        created_at: "<timestamp>",
        updated_at: "<timestamp>"
      }
    );
    assert.equal(
      reopened.messageProcessing.get("message-terminal")?.state,
      "terminal_failure_notified"
    );
    assert.equal(reopened.retryJobs.get("message-2")?.attempt_count, 2);
    const forumState = reopened.forumResearchStates.get("forum-session-1");
    assert.ok(forumState);
    assert.equal(typeof forumState.created_at, "string");
    assert.equal(typeof forumState.updated_at, "string");
    assert.deepEqual(
      {
        ...forumState,
        created_at: "<timestamp>",
        updated_at: "<timestamp>"
      },
      {
      session_identity: "forum-session-1",
      thread_id: "forum-thread-1",
      last_message_id: "forum-message-2",
      evidence_items_json: "[{\"url\":\"https://example.com/a\"}]",
      source_catalog_json: "[{\"url\":\"https://example.com/a\"}]",
      distinct_sources_json: "[\"https://example.com/a\"]",
        created_at: "<timestamp>",
        updated_at: "<timestamp>"
      }
    );
    const promptArtifact = reopened.forumResearchPromptArtifacts.get("forum-session-1");
    assert.ok(promptArtifact);
    assert.equal(typeof promptArtifact.created_at, "string");
    assert.equal(typeof promptArtifact.updated_at, "string");
    assert.deepEqual(
      {
        ...promptArtifact,
        created_at: "<timestamp>",
        updated_at: "<timestamp>"
      },
      {
        session_identity: "forum-session-1",
        thread_id: "forum-thread-1",
        last_message_id: "forum-message-2",
        refined_prompt: "Refined forum prompt",
        progress_notice: "調査を開始します。",
        prompt_rationale_summary: "Narrowed to public sources.",
        created_at: "<timestamp>",
        updated_at: "<timestamp>"
      }
    );
    assert.deepEqual(
      reopened.overrideSessions.getActive("guild-1", "override-thread-1", "admin-1"),
      {
        sessionId: "override-1",
        guildId: "guild-1",
        actorId: "admin-1",
        grantedBy: "owner-1",
        scopePlaceId: "override-thread-1",
        flags: {
          allowPlaywrightHeaded: false,
          allowPlaywrightPersistent: false,
          allowPromptInjectionTest: true,
          suspendViolationCounterForCurrentThread: true,
          allowExternalFetchInPrivateContextWithoutPrivateTerms: false
        },
        sandboxMode: "workspace-write",
        startedAt: "2026-05-21T00:03:00.000Z",
        endedAt: null,
        endedBy: null,
        cleanupReason: null
      }
    );
  } finally {
    store?.close();
    reopened?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createTempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "vrc-ai-bot-storage-roundtrip-"));
}

function createMigratedStore(dbPath: string): SqliteStore {
  const store = new SqliteStore(dbPath);
  store.migrate();
  return store;
}

function seedPublicContractRows(store: SqliteStore): void {
  store.codexSessions.upsert({
    sessionIdentity: "session:conversation:thread-1",
    workloadKind: "conversation",
    bindingKind: "thread",
    bindingId: "thread-1",
    actorId: "user-1",
    sandboxMode: "read-only",
    modelProfile: "gpt-5-mini",
    runtimeContractVersion: "v1",
    lifecyclePolicy: "reusable",
    codexThreadId: "codex-thread-1"
  });

  store.knowledgeRecords.insert({
    recordId: "record-1",
    canonicalUrl: "https://example.com/research",
    domain: "example.com",
    title: "Research Note",
    summary: "Summary that users can retrieve after restart.",
    tags: ["ai", "vrc"],
    scope: "server_public",
    visibilityKey: "server_public:guild-1",
    contentHash: "sha256:record-1",
    createdAt: "2026-05-21T00:00:00.000Z"
  });
  store.knowledgeArtifacts.upsert({
    recordId: "record-1",
    finalUrl: "https://example.com/research",
    snapshotPath: "artifacts/record-1.html",
    screenshotPath: "artifacts/record-1.png",
    networkLogPath: null
  });
  store.knowledgeSourceTexts.upsert({
    recordId: "record-1",
    normalizedText: "Normalized public source text",
    sourceKind: "public_url",
    capturedAt: "2026-05-21T00:01:00.000Z"
  });
  store.sourceLinks.insert({
    linkId: "link-1",
    recordId: "record-1",
    sourceMessageId: "message-1",
    replyThreadId: "thread-1",
    createdAt: "2026-05-21T00:02:00.000Z"
  });

  assert.deepEqual(store.messageProcessing.tryAcquire("message-2", "channel-1"), {
    status: "acquired"
  });
  store.messageProcessing.markPendingRetry("message-2");
  assert.deepEqual(
    store.messageProcessing.tryAcquire("message-terminal", "channel-1"),
    {
      status: "acquired"
    }
  );
  store.messageProcessing.markTerminalFailureNotified("message-terminal");
  store.retryJobs.upsert({
    messageId: "message-2",
    guildId: "guild-1",
    messageChannelId: "channel-1",
    watchChannelId: "watch-root-1",
    attemptCount: 2,
    nextAttemptAt: "2026-05-21T00:05:00.000Z",
    lastFailureCategory: "transient",
    replyChannelId: "channel-1",
    replyThreadId: null,
    placeMode: "chat",
    stage: "dispatch"
  });

  store.clearExplanationGateStates.mark({
    threadId: "clear-thread-1",
    rootChannelId: "clear-root-1",
    firstMessageId: "clear-message-1",
    decision: "redirect_to_general_question",
    reason: "test redirect"
  });

  store.forumResearchStates.upsert({
    sessionIdentity: "forum-session-1",
    threadId: "forum-thread-1",
    lastMessageId: "forum-message-2",
    evidenceItemsJson: "[{\"url\":\"https://example.com/a\"}]",
    sourceCatalogJson: "[{\"url\":\"https://example.com/a\"}]",
    distinctSourcesJson: "[\"https://example.com/a\"]"
  });
  store.forumResearchPromptArtifacts.upsert({
    sessionIdentity: "forum-session-1",
    threadId: "forum-thread-1",
    lastMessageId: "forum-message-2",
    refinedPrompt: "Refined forum prompt",
    progressNotice: "調査を開始します。",
    promptRationaleSummary: "Narrowed to public sources."
  });

  store.overrideSessions.start({
    sessionId: "override-1",
    guildId: "guild-1",
    actorId: "admin-1",
    grantedBy: "owner-1",
    scopePlaceId: "override-thread-1",
    flags: {
      allowPlaywrightHeaded: false,
      allowPlaywrightPersistent: false,
      allowPromptInjectionTest: true,
      suspendViolationCounterForCurrentThread: true,
      allowExternalFetchInPrivateContextWithoutPrivateTerms: false
    },
    sandboxMode: "workspace-write",
    startedAt: "2026-05-21T00:03:00.000Z"
  });
}

function normalizeClearExplanationGateState(
  row: ReturnType<SqliteStore["clearExplanationGateStates"]["get"]>
) {
  assert.ok(row);
  assert.equal(typeof row.created_at, "string");
  assert.equal(typeof row.updated_at, "string");
  return {
    ...row,
    created_at: "<timestamp>",
    updated_at: "<timestamp>"
  };
}
