import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { KnowledgePersistenceService } from "../../src/knowledge/knowledge-persistence-service.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
import type {
  HarnessResponse,
  PublicSourceFact
} from "../../src/harness/contracts.js";

const logger = {
  debug: () => {},
  warn: () => {}
} as never;

test("knowledge persistence skips knowledge_writes without approved same-turn evidence", () => {
  withPersistence(({ service, store }) => {
    service.persist({
      response: knowledgeIngestResponse({
        sourceUrl: "https://unapproved.example/source",
        evidenceFactIds: ["fact:unapproved"]
      }),
      sourceUrls: ["https://example.com/original"],
      approvedEvidenceUrls: ["https://example.com/original"],
      publicSourceFacts: [
        publicSourceFact({
          factId: "fact:unapproved",
          canonicalItemUrl: "https://unapproved.example/source",
          retrievalUrl: "https://unapproved.example/source",
          text: "Unapproved source text."
        })
      ],
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
        sourceUrl: "https://example.com/source",
        evidenceFactIds: ["fact:approved"]
      }),
      sourceUrls: ["https://example.com/source"],
      approvedEvidenceUrls: ["https://example.com/source"],
      publicSourceFacts: [
        publicSourceFact({
          factId: "fact:approved",
          canonicalItemUrl: "https://example.com/source",
          retrievalUrl: "https://example.com/source",
          text: "Approved public source text."
        })
      ],
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

test("knowledge persistence rejects knowledge_writes whose evidence_fact_ids are missing from public_source_facts", () => {
  withPersistence(({ service, store }) => {
    service.persist({
      response: knowledgeIngestResponse({
        sourceUrl:
          "https://r.jina.ai/https://x.com/openaidevs/status/2033636701848174967",
        canonicalUrl: "https://x.com/openaidevs/status/2033636701848174967",
        evidenceFactIds: ["public-source:x-status:2033636701848174967"],
        normalizedText: "This should not persist without a fetched fact."
      }),
      sourceUrls: ["https://x.com/openaidevs/status/2033636701848174967"],
      approvedEvidenceUrls: [
        "https://x.com/openaidevs/status/2033636701848174967",
        "https://r.jina.ai/https://x.com/openaidevs/status/2033636701848174967"
      ],
      publicSourceFacts: [],
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

test("knowledge persistence rejects knowledge_writes when referenced public_source_facts have empty text", () => {
  withPersistence(({ service, store }) => {
    service.persist({
      response: knowledgeIngestResponse({
        sourceUrl:
          "https://r.jina.ai/https://x.com/openaidevs/status/2033636701848174967",
        canonicalUrl: "https://x.com/openaidevs/status/2033636701848174967",
        evidenceFactIds: ["public-source:x-status:2033636701848174967"],
        normalizedText: "This should not persist from an empty fetched body."
      }),
      sourceUrls: ["https://x.com/openaidevs/status/2033636701848174967"],
      approvedEvidenceUrls: [
        "https://x.com/openaidevs/status/2033636701848174967",
        "https://r.jina.ai/https://x.com/openaidevs/status/2033636701848174967"
      ],
      publicSourceFacts: [
        publicSourceFact({
          factId: "public-source:x-status:2033636701848174967",
          canonicalItemUrl: "https://x.com/openaidevs/status/2033636701848174967",
          retrievalUrl:
            "https://r.jina.ai/https://x.com/openaidevs/status/2033636701848174967",
          text: ""
        })
      ],
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

test("knowledge persistence stores knowledge_writes whose evidence_fact_ids resolve to non-empty public_source_facts", () => {
  withPersistence(({ service, store }) => {
    service.persist({
      response: knowledgeIngestResponse({
        sourceUrl:
          "https://r.jina.ai/https://x.com/openaidevs/status/2033636701848174967",
        canonicalUrl: "https://x.com/openaidevs/status/2033636701848174967",
        evidenceFactIds: ["public-source:x-status:2033636701848174967"],
        normalizedText: "OpenAI Developers: fetched status body."
      }),
      sourceUrls: ["https://x.com/openaidevs/status/2033636701848174967"],
      approvedEvidenceUrls: [
        "https://x.com/openaidevs/status/2033636701848174967",
        "https://r.jina.ai/https://x.com/openaidevs/status/2033636701848174967"
      ],
      publicSourceFacts: [
        publicSourceFact({
          factId: "public-source:x-status:2033636701848174967",
          canonicalItemUrl: "https://x.com/openaidevs/status/2033636701848174967",
          retrievalUrl:
            "https://r.jina.ai/https://x.com/openaidevs/status/2033636701848174967",
          text: "OpenAI Developers: fetched status body."
        })
      ],
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
    assert.equal(
      record?.canonical_url,
      "https://x.com/openaidevs/status/2033636701848174967"
    );
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

function knowledgeIngestResponse(input: {
  sourceUrl: string;
  canonicalUrl?: string;
  evidenceFactIds?: string[];
  normalizedText?: string | null;
}): HarnessResponse {
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
        canonical_url: input.canonicalUrl ?? input.sourceUrl,
        title: "Approved Source",
        summary: "Approved summary",
        tags: ["approved"],
        content_hash: null,
        normalized_text: input.normalizedText ?? null,
        source_kind: "webpage",
        evidence_fact_ids: input.evidenceFactIds ?? []
      }
    ],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none"
  };
}

function publicSourceFact(input: {
  factId: string;
  canonicalItemUrl: string;
  retrievalUrl: string;
  text: string;
}): PublicSourceFact {
  return {
    fact_id: input.factId,
    resource_id: `resource:${input.canonicalItemUrl}`,
    candidate_id: `candidate:${input.retrievalUrl}`,
    provider: input.retrievalUrl.includes("r.jina.ai")
      ? "x_twitter_jina"
      : "generic_web",
    original_url: input.canonicalItemUrl,
    canonical_item_url: input.canonicalItemUrl,
    retrieval_url: input.retrievalUrl,
    observed_url: input.retrievalUrl,
    status: 200,
    content_type: "text/markdown",
    title: "Fetched Source",
    text: input.text
  };
}
