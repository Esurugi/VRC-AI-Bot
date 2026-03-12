import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnowledgeRetrievalService } from "../src/knowledge/knowledge-retrieval-service.js";
import { SqliteStore } from "../src/storage/database.js";

test("KnowledgeRetrievalService searches visible candidates by URL and metadata", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-retrieval-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const service = new KnowledgeRetrievalService(store);

  try {
    seedKnowledge(store, {
      recordId: "record-public",
      canonicalUrl: "https://example.com/public",
      title: "Open Alpha",
      summary: "public summary",
      tags: ["alpha", "public"],
      scope: "server_public",
      visibilityKey: "server_public:guild-1",
      normalizedText: "public body"
    });
    seedKnowledge(store, {
      recordId: "record-family-1",
      canonicalUrl: "https://example.com/family-one",
      title: "Family Beta",
      summary: "family one summary",
      tags: ["beta"],
      scope: "channel_family",
      visibilityKey: "channel_family:channel-1",
      normalizedText: "family one body"
    });
    seedKnowledge(store, {
      recordId: "record-family-2",
      canonicalUrl: "https://example.com/family-two",
      title: "Family Gamma",
      summary: "family two summary",
      tags: ["gamma"],
      scope: "channel_family",
      visibilityKey: "channel_family:channel-2",
      normalizedText: "family two body"
    });
    seedKnowledge(store, {
      recordId: "record-thread-1",
      canonicalUrl: "https://example.com/thread-one",
      title: "Thread Only",
      summary: "thread one summary",
      tags: ["delta"],
      scope: "conversation_only",
      visibilityKey: "conversation_only:thread-1",
      normalizedText: "thread one body"
    });

    assert.deepEqual(
      service.searchVisibleCandidates({
        query: "https://example.com/public",
        context: {
          guildId: "guild-1",
          rootChannelId: "channel-1",
          placeId: "thread-1",
          scope: "conversation_only"
        }
      }).map((candidate) => candidate.sourceId),
      ["record-public"]
    );

    assert.deepEqual(
      service.searchVisibleCandidates({
        query: "beta",
        context: {
          guildId: "guild-1",
          rootChannelId: "channel-1",
          placeId: "thread-1",
          scope: "conversation_only"
        }
      }).map((candidate) => candidate.sourceId),
      ["record-family-1"]
    );

    assert.deepEqual(
      service.searchVisibleCandidates({
        query: "gamma",
        context: {
          guildId: "guild-1",
          rootChannelId: "channel-1",
          placeId: "thread-1",
          scope: "conversation_only"
        }
      }).map((candidate) => candidate.sourceId),
      []
    );
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KnowledgeRetrievalService hydrates only visible sources and preserves request order", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-retrieval-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const service = new KnowledgeRetrievalService(store);

  try {
    seedKnowledge(store, {
      recordId: "record-public",
      canonicalUrl: "https://example.com/public",
      title: "Open Alpha",
      summary: "public summary",
      tags: ["alpha", "public"],
      scope: "server_public",
      visibilityKey: "server_public:guild-1",
      normalizedText: "public body"
    });
    seedKnowledge(store, {
      recordId: "record-family-1",
      canonicalUrl: "https://example.com/family-one",
      title: "Family Beta",
      summary: "family one summary",
      tags: ["beta"],
      scope: "channel_family",
      visibilityKey: "channel_family:channel-1",
      normalizedText: "family one body"
    });
    seedKnowledge(store, {
      recordId: "record-thread-1",
      canonicalUrl: "https://example.com/thread-one",
      title: "Thread Only",
      summary: "thread one summary",
      tags: ["delta"],
      scope: "conversation_only",
      visibilityKey: "conversation_only:thread-1",
      normalizedText: "thread one body"
    });
    seedKnowledge(store, {
      recordId: "record-thread-2",
      canonicalUrl: "https://example.com/thread-two",
      title: "Thread Other",
      summary: "thread two summary",
      tags: ["epsilon"],
      scope: "conversation_only",
      visibilityKey: "conversation_only:thread-2",
      normalizedText: "thread two body"
    });

    const hydrated = service.hydrateSources({
      sourceIds: [
        "record-thread-1",
        "record-public",
        "record-thread-1",
        "record-thread-2",
        "missing-source"
      ],
      context: {
        guildId: "guild-1",
        rootChannelId: "channel-1",
        placeId: "thread-1",
        scope: "conversation_only"
      }
    });

    assert.deepEqual(
      hydrated.map((source) => source.sourceId),
      ["record-thread-1", "record-public"]
    );
    assert.equal(hydrated[0]?.normalizedText, "thread one body");
    assert.equal(hydrated[0]?.artifact?.final_url, "https://example.com/thread-one");
    assert.equal(hydrated[1]?.normalizedText, "public body");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KnowledgeRetrievalService finds a shared OpenAI knowledge link from guild chat", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-retrieval-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const service = new KnowledgeRetrievalService(store);

  try {
    seedKnowledge(store, {
      recordId: "record-openai",
      canonicalUrl: "https://openai.com/index/harness-engineering/",
      title: "Harness Engineering",
      summary: "ハーネスエンジニアリングの共有知見。",
      tags: ["openai", "ハーネスエンジニアリング"],
      scope: "server_public",
      visibilityKey: "server_public:guild-1",
      normalizedText: "Harness Engineering article body in Japanese."
    });

    const candidates = service.searchVisibleCandidates({
      query: "ハーネスエンジニアリング",
      context: {
        guildId: "guild-1",
        rootChannelId: "channel-9",
        placeId: "channel-9:chat",
        scope: "channel_family"
      }
    });
    const hydrated = service.hydrateSources({
      sourceIds: candidates.map((candidate) => candidate.sourceId),
      context: {
        guildId: "guild-1",
        rootChannelId: "channel-9",
        placeId: "channel-9:chat",
        scope: "channel_family"
      }
    });

    assert.equal(candidates[0]?.sourceId, "record-openai");
    assert.equal(
      candidates[0]?.canonicalUrl,
      "https://openai.com/index/harness-engineering/"
    );
    assert.equal(hydrated[0]?.canonicalUrl, "https://openai.com/index/harness-engineering/");
    assert.equal(
      hydrated[0]?.artifact?.final_url,
      "https://openai.com/index/harness-engineering/"
    );
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function seedKnowledge(
  store: SqliteStore,
  input: {
    recordId: string;
    canonicalUrl: string;
    title: string;
    summary: string;
    tags: string[];
    scope: "server_public" | "channel_family" | "conversation_only";
    visibilityKey: string;
    normalizedText: string;
  }
): void {
  store.knowledgeRecords.insert({
    recordId: input.recordId,
    canonicalUrl: input.canonicalUrl,
    domain: "example.com",
    title: input.title,
    summary: input.summary,
    tags: input.tags,
    scope: input.scope,
    visibilityKey: input.visibilityKey,
    contentHash: `sha256:${input.recordId}`,
    createdAt: "2026-03-10T00:00:00.000Z"
  });
  store.knowledgeArtifacts.upsert({
    recordId: input.recordId,
    finalUrl: input.canonicalUrl,
    snapshotPath: `snapshot://${input.recordId}`,
    screenshotPath: null,
    networkLogPath: null
  });
  store.knowledgeSourceTexts.upsert({
    recordId: input.recordId,
    normalizedText: input.normalizedText,
    sourceKind: "shared_public_text",
    capturedAt: "2026-03-10T00:00:00.000Z"
  });
}


