import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { KnowledgePersistenceService } from "../../src/knowledge/knowledge-persistence-service.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
import type { HarnessResponse } from "../../src/harness/contracts.js";

const logger = {
  debug: () => {},
  warn: () => {}
} as never;

test("knowledge persistence skips knowledge_writes without approved same-turn evidence", () => {
  withPersistence(({ service, store }) => {
    service.persist({
      response: knowledgeIngestResponse({
        sourceUrl: "https://unapproved.example/source"
      }),
      sourceUrls: ["https://example.com/original"],
      approvedEvidenceUrls: ["https://example.com/original"],
      guildId: "guild-1",
      rootChannelId: "root-1",
      placeId: "root-1",
      scope: "server_public",
      sourceMessageId: "message-1",
      replyThreadId: "thread-1"
    });

    assert.deepEqual(store.sourceLinks.listForSourceMessage("message-1"), []);
  });
});

test("knowledge persistence stores complete knowledge_writes with approved evidence", () => {
  withPersistence(({ service, store }) => {
    service.persist({
      response: knowledgeIngestResponse({
        sourceUrl: "https://example.com/source"
      }),
      sourceUrls: ["https://example.com/source"],
      approvedEvidenceUrls: ["https://example.com/source"],
      guildId: "guild-1",
      rootChannelId: "root-1",
      placeId: "root-1",
      scope: "server_public",
      sourceMessageId: "message-1",
      replyThreadId: "thread-1"
    });

    const links = store.sourceLinks.listForSourceMessage("message-1");
    assert.equal(links.length, 1);
    const record = store.knowledgeRecords.get(links[0]?.record_id ?? "");
    assert.equal(record?.canonical_url, "https://example.com/source");
    assert.equal(record?.title, "Approved Source");
    assert.equal(record?.summary, "Approved summary");
  });
});

function withPersistence(
  callback: (input: {
    service: KnowledgePersistenceService;
    store: SqliteStore;
  }) => void
): void {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-knowledge-persist-"));
  const store = new SqliteStore(join(tempDir, "bot.sqlite"), process.cwd());
  store.migrate();

  try {
    callback({
      service: new KnowledgePersistenceService(store, logger),
      store
    });
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function knowledgeIngestResponse(input: { sourceUrl: string }): HarnessResponse {
  return {
    outcome: "knowledge_ingest",
    repo_write_intent: false,
    public_text: "保存しました。",
    reply_mode: "create_public_thread",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [input.sourceUrl],
    knowledge_writes: [
      {
        source_url: input.sourceUrl,
        canonical_url: input.sourceUrl,
        title: "Approved Source",
        summary: "Approved summary",
        tags: ["approved"],
        content_hash: null,
        normalized_text: null,
        source_kind: "webpage"
      }
    ],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none"
  };
}
