import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { RUNTIME_CONTRACT_VERSION } from "../src/codex/session-policy.js";
import { SqliteStore } from "../src/storage/database.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("SqliteStore migrates and persists repositories", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-db-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let store: SqliteStore | undefined;

  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();
    store.watchLocations.sync([
      {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "channel_family"
      }
    ]);
    store.channelCursors.upsert("c1", "100");
    store.codexSessions.upsert({
      sessionIdentity:
        "workload=conversation|binding_kind=place|binding_id=place-1|actor_id=-|sandbox=read-only|model=default:gpt-5.4|contract=2026-03-12.session-policy.v1|lifecycle=reusable",
      workloadKind: "conversation",
      bindingKind: "place",
      bindingId: "place-1",
      actorId: null,
      sandboxMode: "read-only",
      modelProfile: "default:gpt-5.4",
      runtimeContractVersion: RUNTIME_CONTRACT_VERSION,
      lifecyclePolicy: "reusable",
      codexThreadId: "thread-1"
    });
    store.knowledgeRecords.insert({
      recordId: "record-1",
      canonicalUrl: "https://example.com/",
      domain: "example.com",
      title: "Example",
      summary: "summary",
      tags: ["example"],
      scope: "server_public",
      visibilityKey: "server_public:g1",
      contentHash: "sha256:1",
      createdAt: new Date().toISOString()
    });
    store.knowledgeArtifacts.upsert({
      recordId: "record-1",
      finalUrl: "https://example.com/",
      snapshotPath: "/tmp/example.yml",
      screenshotPath: null,
      networkLogPath: "/tmp/example.log"
    });
    store.knowledgeSourceTexts.upsert({
      recordId: "record-1",
      normalizedText: "summary",
      sourceKind: "shared_public_text",
      capturedAt: new Date().toISOString()
    });
    store.sourceLinks.insert({
      linkId: "link-1",
      recordId: "record-1",
      sourceMessageId: "m-source",
      replyThreadId: "thread-discord-1",
      createdAt: new Date().toISOString()
    });
    store.violationEvents.append({
      eventId: "event-1",
      guildId: "g1",
      userId: "user-1",
      messageId: "m-violation",
      placeId: "c1",
      violationCategory: "dangerous",
      controlRequestClass: "unsafe_control",
      handledAs: "recorded",
      countsTowardThreshold: true,
      actorRole: "user",
      occurredAt: "2026-03-12T00:00:00.000Z"
    });
    store.sanctionStates.insert({
      sanctionId: "sanction-1",
      guildId: "g1",
      userId: "user-1",
      state: "active",
      action: "soft_block",
      deliveryStatus: "fallback",
      triggerEventId: "event-1",
      startedAt: "2026-03-12T00:00:30.000Z",
      endsAt: "2026-03-13T00:00:30.000Z",
      reason: "fallback_soft_block"
    });
    store.softBlockNotices.upsert({
      guildId: "g1",
      userId: "user-1",
      channelId: "c1",
      lastNotifiedAt: "2026-03-12T00:01:00.000Z"
    });
    assert.equal(store.messageProcessing.tryAcquire("m1", "c1").status, "acquired");
    assert.equal(store.messageProcessing.tryAcquire("m1", "c1").status, "in_flight");
    store.messageProcessing.markCompleted("m1");
    store.overrideSessions.start({
      sessionId: "override-1",
      guildId: "g1",
      actorId: "admin-1",
      grantedBy: "admin-1",
      scopePlaceId: "c1:admin_control",
      flags: {
        allowPlaywrightHeaded: true,
        allowPlaywrightPersistent: false,
        allowPromptInjectionTest: false,
        suspendViolationCounterForCurrentThread: false,
        allowExternalFetchInPrivateContextWithoutPrivateTerms: false
      },
      sandboxMode: "workspace-write",
      startedAt: "2026-03-10T00:00:05.000Z"
    });
    assert.equal(store.runtimeLock.tryAcquire("instance-a", process.pid), true);
    assert.equal(store.runtimeLock.tryAcquire("instance-b", 222), false);
    assert.equal(store.runtimeLock.renew("instance-a", process.pid), true);
    assert.equal(store.runtimeLock.tryAcquire("instance-c", process.pid), true);
    store.runtimeLock.release("instance-c");
    assert.equal(store.runtimeLock.get(), null);
    assert.equal(store.runtimeLock.tryAcquire("instance-a", process.pid), true);
    store.runtimeLock.release("instance-a");
    assert.equal(store.runtimeLock.tryAcquire("stale-instance", 999999), true);
    assert.equal(store.runtimeLock.tryAcquire("fresh-instance", process.pid), true);
    store.runtimeLock.release("fresh-instance");

    assert.deepEqual(store.watchLocations.findForChannel("c1"), {
      guildId: "g1",
      channelId: "c1",
      mode: "chat",
      defaultScope: "channel_family"
    });
    assert.equal(store.channelCursors.get("c1")?.last_processed_message_id, "100");
    assert.equal(
      store.codexSessions.get(
        "workload=conversation|binding_kind=place|binding_id=place-1|actor_id=-|sandbox=read-only|model=default:gpt-5.4|contract=2026-03-12.session-policy.v1|lifecycle=reusable"
      )?.codex_thread_id,
      "thread-1"
    );
    assert.equal(
      store.knowledgeRecords.findByDedup(
        "https://example.com/",
        "sha256:1",
        "server_public",
        "server_public:g1"
      )?.title,
      "Example"
    );
    assert.equal(store.knowledgeArtifacts.get("record-1")?.final_url, "https://example.com/");
    assert.equal(
      store.knowledgeSourceTexts.get("record-1")?.normalized_text,
      "summary"
    );
    assert.equal(store.sourceLinks.listForSourceMessage("m-source").length, 1);
    assert.equal(store.violationEvents.get("event-1")?.counts_toward_threshold, 1);
    assert.equal(
      store.sanctionStates.getActiveSoftBlock("g1", "user-1", "2026-03-12T12:00:00.000Z")
        ?.sanction_id,
      "sanction-1"
    );
    assert.equal(
      store.softBlockNotices.get("g1", "user-1", "c1")?.last_notified_at,
      "2026-03-12T00:01:00.000Z"
    );
    assert.equal(store.messageProcessing.get("m1")?.state, "completed");
    assert.equal(
      store.overrideSessions.getActive("g1", "c1:admin_control", "admin-1")?.sandboxMode,
      "workspace-write"
    );
    assert.equal(store.runtimeLock.get(), null);
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("migration 006 retires codex_session into codex_session_legacy and creates codex_session_binding", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-db-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let bootstrapDb: Database.Database | undefined;
  let store: SqliteStore | undefined;

  try {
    bootstrapDb = new Database(dbPath);
    bootstrapDb.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    );
    const migrationDir = resolve(REPO_ROOT, "migrations");
    const bootstrapMigrations = readdirSync(migrationDir)
      .filter((file) => file.endsWith(".sql") && file < "006_codex_session_binding_v1.sql")
      .sort();

    for (const file of bootstrapMigrations) {
      bootstrapDb.exec(readFileSync(resolve(migrationDir, file), "utf8"));
      bootstrapDb
        .prepare("INSERT INTO schema_migrations (name) VALUES (?)")
        .run(file);
    }

    bootstrapDb
      .prepare(
        "INSERT INTO codex_session (place_id, codex_thread_id) VALUES (?, ?)"
      )
      .run("legacy-place", "legacy-thread");
    bootstrapDb.close();
    bootstrapDb = undefined;

    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    const tables = store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('codex_session', 'codex_session_legacy', 'codex_session_binding') ORDER BY name"
      )
      .all() as Array<{ name: string }>;

    assert.deepEqual(tables, [
      { name: "codex_session_binding" },
      { name: "codex_session_legacy" }
    ]);
    const legacyRows = store.db
      .prepare(
        "SELECT place_id, codex_thread_id FROM codex_session_legacy WHERE place_id = ?"
      )
      .all("legacy-place") as Array<{
      place_id: string;
      codex_thread_id: string;
    }>;
    assert.deepEqual(legacyRows, [
      {
        place_id: "legacy-place",
        codex_thread_id: "legacy-thread"
      }
    ]);
    const bindingCount = store.db
      .prepare("SELECT COUNT(*) AS count FROM codex_session_binding")
      .get() as { count: number };
    assert.equal(bindingCount.count, 0);
  } finally {
    bootstrapDb?.close();
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("migration 007 extends sanction tables and creates soft_block_notice", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-db-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let bootstrapDb: Database.Database | undefined;
  let store: SqliteStore | undefined;

  try {
    bootstrapDb = new Database(dbPath);
    bootstrapDb.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    );
    const migrationDir = resolve(REPO_ROOT, "migrations");
    const bootstrapMigrations = readdirSync(migrationDir)
      .filter((file) => file.endsWith(".sql") && file < "007_sanction_v1.sql")
      .sort();

    for (const file of bootstrapMigrations) {
      bootstrapDb.exec(readFileSync(resolve(migrationDir, file), "utf8"));
      bootstrapDb
        .prepare("INSERT INTO schema_migrations (name) VALUES (?)")
        .run(file);
    }

    bootstrapDb
      .prepare(
        `
          INSERT INTO violation_event (
            event_id,
            guild_id,
            user_id,
            message_id,
            place_id,
            violation_category,
            control_request_class,
            handled_as,
            occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        "legacy-event",
        "guild-1",
        "user-1",
        "message-1",
        "place-1",
        "dangerous",
        "legacy_control",
        "recorded",
        "2026-03-10T00:00:00.000Z"
      );
    bootstrapDb
      .prepare(
        `
          INSERT INTO sanction_state (
            sanction_id,
            guild_id,
            user_id,
            state,
            started_at,
            ends_at,
            reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        "legacy-sanction",
        "guild-1",
        "user-1",
        "active",
        "2026-03-10T00:10:00.000Z",
        null,
        "legacy_reason"
      );
    bootstrapDb.close();
    bootstrapDb = undefined;

    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    const eventRow = store.violationEvents.get("legacy-event");
    assert.equal(eventRow?.counts_toward_threshold, 1);
    assert.equal(eventRow?.actor_role, "user");

    const sanctions = store.sanctionStates.listRecentForActor({
      guildId: "guild-1",
      userId: "user-1",
      startedAtGte: "2026-03-01T00:00:00.000Z"
    });
    assert.deepEqual(sanctions, [
      {
        sanction_id: "legacy-sanction",
        guild_id: "guild-1",
        user_id: "user-1",
        state: "active",
        action: "soft_block",
        delivery_status: "applied",
        trigger_event_id: null,
        started_at: "2026-03-10T00:10:00.000Z",
        ends_at: null,
        reason: "legacy_reason"
      }
    ]);

    const tables = store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('soft_block_notice')"
      )
      .all() as Array<{ name: string }>;
    assert.deepEqual(tables, [{ name: "soft_block_notice" }]);
  } finally {
    bootstrapDb?.close();
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("migration 008 adds retry_job and pending_retry processing state", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-db-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let bootstrapDb: Database.Database | undefined;
  let store: SqliteStore | undefined;

  try {
    bootstrapDb = new Database(dbPath);
    bootstrapDb.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    );
    const migrationDir = resolve(REPO_ROOT, "migrations");
    const bootstrapMigrations = readdirSync(migrationDir)
      .filter((file) => file.endsWith(".sql") && file < "008_retry_scheduler_v1.sql")
      .sort();

    for (const file of bootstrapMigrations) {
      bootstrapDb.exec(readFileSync(resolve(migrationDir, file), "utf8"));
      bootstrapDb
        .prepare("INSERT INTO schema_migrations (name) VALUES (?)")
        .run(file);
    }

    bootstrapDb
      .prepare(
        `
          INSERT INTO message_processing (
            message_id,
            channel_id,
            state,
            lease_expires_at,
            created_at,
            updated_at,
            completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        "legacy-message",
        "channel-1",
        "processing",
        "2026-03-12T00:00:00.000Z",
        "2026-03-12T00:00:00.000Z",
        "2026-03-12T00:00:00.000Z",
        null
      );
    bootstrapDb.close();
    bootstrapDb = undefined;

    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    const processingState = store.messageProcessing.get("legacy-message");
    assert.equal(processingState?.state, "processing");

    const tables = store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('retry_job') ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    assert.deepEqual(tables, [{ name: "retry_job" }]);
  } finally {
    bootstrapDb?.close();
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("sanction repositories append violations, query recent sanctions, and upsert notices", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-db-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let store: SqliteStore | undefined;

  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    store.violationEvents.append({
      eventId: "event-a",
      guildId: "guild-1",
      userId: "user-1",
      messageId: "message-a",
      placeId: "channel-a",
      violationCategory: "dangerous",
      controlRequestClass: null,
      handledAs: "recorded",
      countsTowardThreshold: true,
      actorRole: "user",
      occurredAt: "2026-03-11T00:00:00.000Z"
    });
    store.violationEvents.append({
      eventId: "event-b",
      guildId: "guild-1",
      userId: "user-1",
      messageId: "message-b",
      placeId: "channel-a",
      violationCategory: "prohibited",
      controlRequestClass: "override_blocked",
      handledAs: "admin_exempt",
      countsTowardThreshold: false,
      actorRole: "admin",
      occurredAt: "2026-03-12T00:00:00.000Z"
    });

    assert.equal(
      store.violationEvents.countForActorSince({
        guildId: "guild-1",
        userId: "user-1",
        occurredAtGte: "2026-03-01T00:00:00.000Z",
        countableOnly: true
      }),
      1
    );
    assert.deepEqual(
      store.violationEvents.listForActorSince({
        guildId: "guild-1",
        userId: "user-1",
        occurredAtGte: "2026-03-01T00:00:00.000Z"
      }).map((row) => row.event_id),
      ["event-b", "event-a"]
    );

    store.sanctionStates.insert({
      sanctionId: "sanction-timeout",
      guildId: "guild-1",
      userId: "user-1",
      state: "completed",
      action: "timeout",
      deliveryStatus: "applied",
      triggerEventId: "event-a",
      startedAt: "2026-03-12T00:05:00.000Z",
      endsAt: "2026-03-13T00:05:00.000Z",
      reason: "threshold_reached"
    });
    store.sanctionStates.insert({
      sanctionId: "sanction-soft-block",
      guildId: "guild-1",
      userId: "user-1",
      state: "active",
      action: "soft_block",
      deliveryStatus: "fallback",
      triggerEventId: "event-b",
      startedAt: "2026-03-12T00:10:00.000Z",
      endsAt: "2026-03-13T00:10:00.000Z",
      reason: "timeout_failed"
    });

    assert.deepEqual(
      store
        .sanctionStates.listRecentForActor({
          guildId: "guild-1",
          userId: "user-1",
          startedAtGte: "2026-03-01T00:00:00.000Z",
          actions: ["timeout", "soft_block"]
        })
        .map((row) => row.sanction_id),
      ["sanction-soft-block", "sanction-timeout"]
    );
    assert.equal(
      store.sanctionStates.getActiveSoftBlock(
        "guild-1",
        "user-1",
        "2026-03-12T12:00:00.000Z"
      )?.sanction_id,
      "sanction-soft-block"
    );

    store.softBlockNotices.upsert({
      guildId: "guild-1",
      userId: "user-1",
      channelId: "channel-a",
      lastNotifiedAt: "2026-03-12T00:10:30.000Z"
    });
    store.softBlockNotices.upsert({
      guildId: "guild-1",
      userId: "user-1",
      channelId: "channel-a",
      lastNotifiedAt: "2026-03-12T06:10:30.000Z"
    });

    assert.deepEqual(store.softBlockNotices.get("guild-1", "user-1", "channel-a"), {
      guild_id: "guild-1",
      user_id: "user-1",
      channel_id: "channel-a",
      last_notified_at: "2026-03-12T06:10:30.000Z"
    });
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("message processing pending_retry requires explicit reacquire and retry jobs support CRUD", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-db-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let store: SqliteStore | undefined;

  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    assert.equal(store.messageProcessing.tryAcquire("message-1", "channel-1").status, "acquired");
    store.messageProcessing.markPendingRetry("message-1");
    assert.equal(store.messageProcessing.get("message-1")?.state, "pending_retry");
    assert.equal(store.messageProcessing.tryAcquire("message-1", "channel-1").status, "pending_retry");
    assert.equal(
      store.messageProcessing.tryAcquire("message-1", "channel-1", {
        allowPendingRetryAcquire: true
      }).status,
      "acquired"
    );

    store.retryJobs.upsert({
      messageId: "message-1",
      guildId: "guild-1",
      messageChannelId: "channel-1",
      watchChannelId: "channel-1",
      attemptCount: 1,
      nextAttemptAt: "2026-03-12T00:05:00.000Z",
      lastFailureCategory: "fetch_timeout",
      replyChannelId: "channel-1",
      replyThreadId: null,
      placeMode: "chat",
      stage: "fetch_or_resolve"
    });
    store.retryJobs.upsert({
      messageId: "message-2",
      guildId: "guild-1",
      messageChannelId: "channel-2",
      watchChannelId: "channel-2",
      attemptCount: 2,
      nextAttemptAt: "2026-03-12T01:00:00.000Z",
      lastFailureCategory: "ai_processing_failed",
      replyChannelId: "thread-1",
      replyThreadId: "thread-1",
      placeMode: "url_watch",
      stage: "dispatch"
    });

    assert.equal(store.retryJobs.get("message-1")?.attempt_count, 1);
    assert.deepEqual(
      store
        .retryJobs.listDue("2026-03-12T00:30:00.000Z")
        .map((row) => row.message_id),
      ["message-1"]
    );
    store.retryJobs.delete("message-1");
    assert.equal(store.retryJobs.get("message-1"), null);
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("OverrideSessionRepository starts, ends, and fail-closes place-local sessions", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-db-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let store: SqliteStore | undefined;

  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    store.overrideSessions.start({
      sessionId: "override-1",
      guildId: "guild-1",
      actorId: "admin-1",
      grantedBy: "admin-1",
      scopePlaceId: "thread-1",
      flags: {
        allowPlaywrightHeaded: false,
        allowPlaywrightPersistent: false,
        allowPromptInjectionTest: false,
        suspendViolationCounterForCurrentThread: true,
        allowExternalFetchInPrivateContextWithoutPrivateTerms: false
      },
      sandboxMode: "workspace-write",
      startedAt: "2026-03-10T00:00:00.000Z"
    });

    assert.equal(
      store.overrideSessions.getActive("guild-1", "thread-1", "admin-1")?.flags
        .suspendViolationCounterForCurrentThread,
      true
    );

    assert.equal(
      store.overrideSessions.endActive({
        guildId: "guild-1",
        scopePlaceId: "thread-1",
        actorId: "admin-1",
        endedAt: "2026-03-10T00:10:00.000Z",
        endedBy: "admin-1",
        cleanupReason: null
      }),
      true
    );
    assert.equal(store.overrideSessions.getActive("guild-1", "thread-1", "admin-1"), null);

    store.overrideSessions.start({
      sessionId: "override-2",
      guildId: "guild-1",
      actorId: "admin-1",
      grantedBy: "admin-1",
      scopePlaceId: "thread-1",
      flags: {
        allowPlaywrightHeaded: false,
        allowPlaywrightPersistent: true,
        allowPromptInjectionTest: false,
        suspendViolationCounterForCurrentThread: false,
        allowExternalFetchInPrivateContextWithoutPrivateTerms: false
      },
      sandboxMode: "workspace-write",
      startedAt: "2026-03-10T01:00:00.000Z"
    });
    store.overrideSessions.start({
      sessionId: "override-3",
      guildId: "guild-1",
      actorId: "admin-2",
      grantedBy: "admin-2",
      scopePlaceId: "channel-1:admin_control",
      flags: {
        allowPlaywrightHeaded: false,
        allowPlaywrightPersistent: false,
        allowPromptInjectionTest: true,
        suspendViolationCounterForCurrentThread: false,
        allowExternalFetchInPrivateContextWithoutPrivateTerms: false
      },
      sandboxMode: "workspace-write",
      startedAt: "2026-03-10T01:05:00.000Z"
    });

    assert.equal(
      store.overrideSessions.failClosedAllActive({
        endedAt: "2026-03-10T02:00:00.000Z",
        endedBy: "system",
        cleanupReason: "startup_cleanup"
      }),
      2
    );
    assert.equal(store.overrideSessions.getActive("guild-1", "thread-1", "admin-1"), null);
    assert.equal(
      store.overrideSessions.getActive(
        "guild-1",
        "channel-1:admin_control",
        "admin-2"
      ),
      null
    );
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("SourceLinkRepository lists deduplicated knowledge context for reply thread", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-db-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let store: SqliteStore | undefined;

  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    store.knowledgeRecords.insert({
      recordId: "record-1",
      canonicalUrl: "https://example.com/one",
      domain: "example.com",
      title: "One",
      summary: "summary one",
      tags: ["alpha"],
      scope: "server_public",
      visibilityKey: "server_public:guild-1",
      contentHash: "sha256:one",
      createdAt: "2026-03-10T00:00:00.000Z"
    });
    store.knowledgeRecords.insert({
      recordId: "record-2",
      canonicalUrl: "https://example.com/two",
      domain: "example.com",
      title: "Two",
      summary: "summary two",
      tags: ["beta"],
      scope: "server_public",
      visibilityKey: "server_public:guild-1",
      contentHash: "sha256:two",
      createdAt: "2026-03-10T00:00:01.000Z"
    });

    store.sourceLinks.insert({
      linkId: "link-1",
      recordId: "record-1",
      sourceMessageId: "source-1",
      replyThreadId: "thread-1",
      createdAt: "2026-03-10T00:00:02.000Z"
    });
    store.sourceLinks.insert({
      linkId: "link-2",
      recordId: "record-1",
      sourceMessageId: "source-1",
      replyThreadId: "thread-1",
      createdAt: "2026-03-10T00:00:03.000Z"
    });
    store.sourceLinks.insert({
      linkId: "link-3",
      recordId: "record-2",
      sourceMessageId: "source-2",
      replyThreadId: "thread-1",
      createdAt: "2026-03-10T00:00:04.000Z"
    });

    assert.deepEqual(store.sourceLinks.listKnowledgeContextForReplyThread("thread-1"), [
      {
        sourceId: "record-1",
        sourceMessageId: "source-1",
        title: "One",
        summary: "summary one",
        tags: ["alpha"],
        scope: "server_public",
        recency: "2026-03-10T00:00:00.000Z",
        canonicalUrl: "https://example.com/one"
      },
      {
        sourceId: "record-2",
        sourceMessageId: "source-2",
        title: "Two",
        summary: "summary two",
        tags: ["beta"],
        scope: "server_public",
        recency: "2026-03-10T00:00:01.000Z",
        canonicalUrl: "https://example.com/two"
      }
    ]);
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KnowledgeRecordRepository dedupes by visibility key", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-db-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let store: SqliteStore | undefined;

  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    store.knowledgeRecords.insert({
      recordId: "record-1",
      canonicalUrl: "https://example.com/shared",
      domain: "example.com",
      title: "Shared",
      summary: "summary",
      tags: ["shared"],
      scope: "channel_family",
      visibilityKey: "channel_family:channel-1",
      contentHash: "sha256:shared",
      createdAt: "2026-03-10T00:00:00.000Z"
    });
    store.knowledgeRecords.insert({
      recordId: "record-2",
      canonicalUrl: "https://example.com/shared",
      domain: "example.com",
      title: "Shared",
      summary: "summary",
      tags: ["shared"],
      scope: "channel_family",
      visibilityKey: "channel_family:channel-2",
      contentHash: "sha256:shared",
      createdAt: "2026-03-10T00:00:01.000Z"
    });

    const count = store.db
      .prepare("SELECT COUNT(*) AS count FROM knowledge_record")
      .get() as { count: number };

    assert.equal(count.count, 2);
    assert.equal(
      store.knowledgeRecords.findByDedup(
        "https://example.com/shared",
        "sha256:shared",
        "channel_family",
        "channel_family:channel-1"
      )?.record_id,
      "record-1"
    );
    assert.equal(
      store.knowledgeRecords.findByDedup(
        "https://example.com/shared",
        "sha256:shared",
        "channel_family",
        "channel_family:channel-2"
      )?.record_id,
      "record-2"
    );
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
