import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import Database from "better-sqlite3";

import {
  parseEvidenceItems,
  parseSourceCatalog
} from "../../src/harness/forum-research-pipeline.js";
import { KnowledgeRetrievalService } from "../../src/knowledge/knowledge-retrieval-service.js";
import { SqliteStore } from "../../src/storage/database.js";

test("AE-MIG-01 migration 005 preserves legacy knowledge rows instead of dropping public records", () => {
  const context = createFixtureStore("legacy-knowledge-v004.sql");
  try {
    context.store.migrate();

    // Legacy knowledge rows predate visibility_key. The fixture cannot prove the
    // exact modern selector, so the preservation oracle is non-drop plus any
    // explicit compatibility/quarantine visibility key chosen by the migration.
    const record = context.store.knowledgeRecords.get("legacy-record-1");
    assert.ok(
      record,
      "legacy knowledge rows had no visibility_key column; migration must assign a compatibility visibility key or quarantine row, but must not drop the user-visible record"
    );
    assert.equal(record.canonical_url, "https://legacy.example.com/public-note");
    assert.ok(record.visibility_key.length > 0);
    assert.deepEqual(context.store.knowledgeArtifacts.get("legacy-record-1"), {
      record_id: "legacy-record-1",
      final_url: "https://legacy.example.com/public-note",
      snapshot_path: "legacy/snapshot.html",
      screenshot_path: null,
      network_log_path: null
    });
    assert.deepEqual(context.store.sourceLinks.listForSourceMessage("legacy-message-1"), [
      {
        link_id: "legacy-link-1",
        record_id: "legacy-record-1",
        source_message_id: "legacy-message-1",
        reply_thread_id: "legacy-thread-1",
        created_at: "2026-05-20T00:03:00.000Z"
      }
    ]);
  } finally {
    context.cleanup();
  }
});

test("AE-MIG-01 legacy knowledge remains visible through repository canonical URL and search after migration", () => {
  const context = createFixtureStore("legacy-knowledge-v004.sql");
  try {
    context.store.migrate();

    const retrieval = new KnowledgeRetrievalService(context.store);
    const visibilityContext = {
      guildId: "guild-1",
      rootChannelId: "legacy-channel-1",
      placeId: "legacy-channel-1",
      scope: "server_public" as const
    };

    assert.deepEqual(
      retrieval.searchVisibleCandidates({
        query: "https://legacy.example.com/public-note",
        context: visibilityContext
      }).map((candidate) => candidate.canonicalUrl),
      ["https://legacy.example.com/public-note"]
    );
    assert.deepEqual(
      retrieval.searchVisibleCandidates({
        query: "Legacy Public Note",
        context: visibilityContext
      }).map((candidate) => candidate.sourceId),
      ["legacy-record-1"]
    );
  } finally {
    context.cleanup();
  }
});

test("AE-MIG-01 migration 010 preserves retry scheduler v1 jobs", () => {
  const context = createFixtureStore("legacy-retry-job-v009.sql");
  try {
    context.store.migrate();

    // Retry v1 had one channel_id, not message_channel_id/watch_channel_id.
    // The fixture expects a deterministic compatibility mapping instead of
    // losing the pending visible retry job.
    const job = context.store.retryJobs.get("legacy-retry-message-1");
    assert.ok(
      job,
      "retry scheduler v1 rows must survive the v2 table rebuild so pending user-visible recovery is not forgotten"
    );
    assert.equal(job.guild_id, "guild-1");
    assert.equal(job.message_channel_id, "legacy-channel-1");
    assert.equal(job.watch_channel_id, "legacy-channel-1");
    assert.equal(job.attempt_count, 3);
    assert.equal(job.reply_thread_id, "legacy-thread-1");
  } finally {
    context.cleanup();
  }
});

test("AE-MIG-01 migration 012 preserves forum research state v1 progress", () => {
  const context = createFixtureStore("legacy-forum-state-v011.sql");
  try {
    context.store.migrate();

    // Forum v1 stored planner/evidence/worker progress separately. Exact v2
    // evidence_items derivation is under-specified, so the oracle accepts any
    // non-empty compatibility payload that keeps the user's research progress.
    const state = context.store.forumResearchStates.get("forum-session-legacy");
    assert.ok(
      state,
      "forum v1 rows contain planner/evidence/worker progress; if exact v2 evidence_items cannot be derived, migration must preserve enough progress in a compatibility payload instead of dropping the row"
    );
    assert.equal(state.thread_id, "forum-thread-legacy");
    assert.equal(state.last_message_id, "forum-message-legacy");
    assert.ok(JSON.parse(state.evidence_items_json).length > 0);
    const sourceCatalog = parseSourceCatalog(state.source_catalog_json);
    const evidenceItems = parseEvidenceItems(
      state.evidence_items_json,
      sourceCatalog
    );
    assert.deepEqual(sourceCatalog, [
      {
        index: 1,
        url: "https://legacy.example.com/source",
        claims: ["Legacy planner brief"]
      }
    ]);
    assert.deepEqual(evidenceItems, [
      {
        claim: "Legacy planner brief",
        source_urls: ["https://legacy.example.com/source"]
      }
    ]);
  } finally {
    context.cleanup();
  }
});

test("AE-MIG-01 migration 015 preserves message progress rows and adds terminal state", () => {
  const context = createFixtureStore("legacy-message-processing-v014.sql");
  try {
    context.store.migrate();

    assert.equal(
      context.store.messageProcessing.get("legacy-processing-message")?.state,
      "processing"
    );
    assert.equal(
      context.store.messageProcessing.get("legacy-retry-message")?.state,
      "pending_retry"
    );
    assert.equal(
      context.store.messageProcessing.get("legacy-completed-message")?.state,
      "completed"
    );

    assert.deepEqual(
      context.store.messageProcessing.tryAcquire("terminal-message", "legacy-channel-1"),
      { status: "acquired" }
    );
    context.store.messageProcessing.markTerminalFailureNotified("terminal-message");
    assert.equal(
      context.store.messageProcessing.get("terminal-message")?.state,
      "terminal_failure_notified"
    );
    assert.deepEqual(
      context.store.messageProcessing.tryAcquire("terminal-message", "legacy-channel-1"),
      { status: "already_terminal_failure_notified" }
    );
  } finally {
    context.cleanup();
  }
});

test("AE-MIG-01 codex_session legacy rows remain isolated from new runtime bindings", () => {
  const context = createFixtureStore("legacy-knowledge-v004.sql");
  try {
    context.store.migrate();

    const legacyRow = context.store.db
      .prepare(
        "SELECT place_id, codex_thread_id FROM codex_session_legacy WHERE place_id = ?"
      )
      .get("legacy-place-1") as
      | { place_id: string; codex_thread_id: string }
      | undefined;

    assert.deepEqual(legacyRow, {
      place_id: "legacy-place-1",
      codex_thread_id: "legacy-codex-thread-1"
    });
    assert.equal(context.store.codexSessions.get("legacy-place-1"), null);
  } finally {
    context.cleanup();
  }
});

function createFixtureStore(fixtureName: string): {
  store: SqliteStore;
  cleanup: () => void;
} {
  const workspace = mkdtempSync(join(tmpdir(), "vrc-ai-bot-migration-"));
  const dbPath = join(workspace, "bot.sqlite");
  const fixturePath = join(
    process.cwd(),
    "implementation",
    "test",
    "fixtures",
    "migrations",
    fixtureName
  );
  const db = new Database(dbPath);
  db.exec(readFileSync(fixturePath, "utf8"));
  db.close();

  const store = new SqliteStore(dbPath);
  return {
    store,
    cleanup: () => {
      store.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  };
}
