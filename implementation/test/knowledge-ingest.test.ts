import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";

import { KnowledgePersistenceService } from "../src/knowledge/knowledge-persistence-service.js";
import type { HarnessResponse } from "../src/harness/contracts.js";
import { SqliteStore } from "../src/storage/database.js";

function createHarnessResponse(
  overrides: Partial<HarnessResponse> = {}
): HarnessResponse {
  return {
    outcome: "knowledge_ingest",
    public_text: "要約しました。",
    reply_mode: "create_public_thread",
    target_thread_id: null,
    persist_items: [],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none",
    ...overrides
  };
}

test("KnowledgePersistenceService persists knowledge records and deduplicates repeated ingests", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-ingest-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const service = new KnowledgePersistenceService(store, pino({ level: "silent" }));

  try {
    const response = createHarnessResponse({
      public_text: "Example Domain の要約です。",
      persist_items: [
        {
          source_url: "https://example.com",
          canonical_url: "https://example.com/",
          title: "Example Domain",
          summary: "documentation examples向けのページ。",
          tags: ["example", "documentation"],
          content_hash: "sha256:example"
        }
      ]
    });

    service.persist({
      response,
      sourceUrls: ["https://example.com"],
      scope: "server_public",
      sourceMessageId: "message-1",
      replyThreadId: "thread-1"
    });
    service.persist({
      response,
      sourceUrls: ["https://example.com"],
      scope: "server_public",
      sourceMessageId: "message-2",
      replyThreadId: "thread-1"
    });

    const record = store.db
      .prepare("SELECT COUNT(*) AS count FROM knowledge_record")
      .get() as { count: number };
    const links = store.db
      .prepare("SELECT COUNT(*) AS count FROM source_link")
      .get() as { count: number };
    const artifact = store.db
      .prepare("SELECT snapshot_path, final_url FROM knowledge_artifact LIMIT 1")
      .get() as { snapshot_path: string; final_url: string };

    assert.equal(record.count, 1);
    assert.equal(links.count, 2);
    assert.equal(artifact.snapshot_path, "codex://web-search");
    assert.equal(artifact.final_url, "https://example.com/");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KnowledgePersistenceService tolerates URL drift and keeps canonical artifact URL as source of truth", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-ingest-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const service = new KnowledgePersistenceService(store, pino({ level: "silent" }));

  try {
    service.persist({
      response: createHarnessResponse({
        public_text: "Harness Engineering の要約です。",
        persist_items: [
          {
            source_url: "https://openai.com/index/harness-engineering",
            canonical_url: "https://openai.com/index/harness-engineering",
            title: "Harness Engineering",
            summary: "summary",
            tags: ["openai"],
            content_hash: "sha256:harness"
          }
        ]
      }),
      sourceUrls: ["https://openai.com/index/harness-engineering/"],
      scope: "server_public",
      sourceMessageId: "message-3",
      replyThreadId: "thread-2"
    });

    const row = store.db
      .prepare("SELECT canonical_url, title FROM knowledge_record LIMIT 1")
      .get() as { canonical_url: string; title: string };

    assert.equal(row.canonical_url, "https://openai.com/index/harness-engineering");
    assert.equal(row.title, "Harness Engineering");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KnowledgePersistenceService synthesizes fallback knowledge when Codex omits persist_items", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-ingest-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const service = new KnowledgePersistenceService(store, pino({ level: "silent" }));

  try {
    service.persist({
      response: createHarnessResponse({
        public_text: "これは Harness Engineering に関する記事です。",
        persist_items: []
      }),
      sourceUrls: ["https://openai.com/index/harness-engineering/"],
      scope: "server_public",
      sourceMessageId: "message-4",
      replyThreadId: "thread-3"
    });

    const row = store.db
      .prepare("SELECT canonical_url, title, summary FROM knowledge_record LIMIT 1")
      .get() as { canonical_url: string; title: string; summary: string };

    assert.equal(row.canonical_url, "https://openai.com/index/harness-engineering/");
    assert.equal(row.title, "openai.com");
    assert.match(row.summary, /Harness Engineering|記事/);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
