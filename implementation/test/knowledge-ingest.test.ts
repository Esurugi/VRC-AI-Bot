import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";

import { KnowledgePersistenceService } from "../src/knowledge/knowledge-persistence-service.js";
import type { HarnessResponse } from "../src/harness/contracts.js";
import { SqliteStore } from "../src/storage/database.js";

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
    outcome: "knowledge_ingest",
    repo_write_intent: false,
    public_text: "要約しました。",
    reply_mode: "create_public_thread",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [],
    knowledge_writes: [],
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
      knowledge_writes: [
        createKnowledgeWrite({
          source_url: "https://example.com",
          canonical_url: "https://example.com/",
          title: "Example Domain",
          summary: "documentation examples向けのページ。",
          tags: ["example", "documentation"],
          content_hash: "sha256:example",
          normalized_text: "documentation examples向けのページ。",
          source_kind: "shared_public_text"
        })
      ]
    });

    service.persist({
      response,
      sourceUrls: ["https://example.com"],
      guildId: "guild-1",
      rootChannelId: "channel-root-1",
      placeId: "channel-root-1:url_watch",
      scope: "server_public",
      sourceMessageId: "message-1",
      replyThreadId: "thread-1"
    });
    service.persist({
      response,
      sourceUrls: ["https://example.com"],
      guildId: "guild-1",
      rootChannelId: "channel-root-1",
      placeId: "channel-root-1:url_watch",
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
    const sourceText = store.db
      .prepare("SELECT normalized_text FROM knowledge_source_text LIMIT 1")
      .get() as { normalized_text: string };

    assert.equal(record.count, 1);
    assert.equal(links.count, 2);
    assert.equal(artifact.snapshot_path, "codex://web-search");
    assert.equal(artifact.final_url, "https://example.com/");
    assert.equal(sourceText.normalized_text, "documentation examples向けのページ。");
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
        knowledge_writes: [
          createKnowledgeWrite({
            source_url: "https://openai.com/index/harness-engineering",
            canonical_url: "https://openai.com/index/harness-engineering",
            title: "Harness Engineering",
            summary: "summary",
            tags: ["openai"],
            content_hash: "sha256:harness",
            normalized_text: "summary",
            source_kind: "shared_public_text"
          })
        ]
      }),
      sourceUrls: ["https://openai.com/index/harness-engineering/"],
      guildId: "guild-1",
      rootChannelId: "channel-root-1",
      placeId: "channel-root-1:url_watch",
      scope: "server_public",
      sourceMessageId: "message-3",
      replyThreadId: "thread-2"
    });

    const row = store.db
      .prepare("SELECT canonical_url, title FROM knowledge_record LIMIT 1")
      .get() as { canonical_url: string; title: string };

    assert.equal(row.canonical_url, "https://openai.com/index/harness-engineering/");
    assert.equal(row.title, "openai.com");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KnowledgePersistenceService persists shared OpenAI knowledge with artifact and source links", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-ingest-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const service = new KnowledgePersistenceService(store, pino({ level: "silent" }));

  try {
    service.persist({
      response: createHarnessResponse({
        public_text: "Harness Engineering の共有知見です。",
        knowledge_writes: [
          createKnowledgeWrite({
            source_url: "https://openai.com/index/harness-engineering/",
            canonical_url: "https://openai.com/index/harness-engineering/",
            title: "Harness Engineering",
            summary: "ハーネスエンジニアリングの共有知見。",
            tags: ["openai", "ハーネスエンジニアリング"],
            content_hash: "sha256:harness-openai",
            normalized_text: "ハーネスエンジニアリングの共有知見。",
            source_kind: "shared_public_text"
          })
        ]
      }),
      sourceUrls: ["https://openai.com/index/harness-engineering/"],
      guildId: "guild-1",
      rootChannelId: "channel-root-1",
      placeId: "channel-root-1:url_watch",
      scope: "server_public",
      sourceMessageId: "message-openai-1",
      replyThreadId: "thread-openai-1"
    });

    const record = store.db
      .prepare("SELECT canonical_url, title, scope, visibility_key FROM knowledge_record LIMIT 1")
      .get() as { canonical_url: string; title: string; scope: string; visibility_key: string };
    const artifact = store.db
      .prepare("SELECT final_url, snapshot_path FROM knowledge_artifact LIMIT 1")
      .get() as { final_url: string; snapshot_path: string };
    const sourceText = store.db
      .prepare("SELECT normalized_text FROM knowledge_source_text LIMIT 1")
      .get() as { normalized_text: string };
    const sourceLink = store.db
      .prepare("SELECT source_message_id, reply_thread_id FROM source_link LIMIT 1")
      .get() as { source_message_id: string; reply_thread_id: string };

    assert.equal(record.canonical_url, "https://openai.com/index/harness-engineering/");
    assert.equal(record.title, "Harness Engineering");
    assert.equal(record.scope, "server_public");
    assert.equal(record.visibility_key, "server_public:guild-1");
    assert.equal(artifact.final_url, "https://openai.com/index/harness-engineering/");
    assert.equal(artifact.snapshot_path, "codex://web-search");
    assert.equal(sourceText.normalized_text, "ハーネスエンジニアリングの共有知見。");
    assert.equal(sourceLink.source_message_id, "message-openai-1");
    assert.equal(sourceLink.reply_thread_id, "thread-openai-1");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KnowledgePersistenceService synthesizes fallback knowledge when Codex omits knowledge_writes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-ingest-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const service = new KnowledgePersistenceService(store, pino({ level: "silent" }));

  try {
    service.persist({
      response: createHarnessResponse({
        public_text: "これは Harness Engineering に関する記事です。",
        knowledge_writes: []
      }),
      sourceUrls: ["https://openai.com/index/harness-engineering/"],
      guildId: "guild-1",
      rootChannelId: "channel-root-1",
      placeId: "channel-root-1:url_watch",
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

test("KnowledgePersistenceService can persist manual saves without pasted message URLs", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-ingest-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const service = new KnowledgePersistenceService(store, pino({ level: "silent" }));

  try {
    service.persist({
      response: createHarnessResponse({
        public_text: "Claude Code Hooks の知見を保存しました。",
        reply_mode: "same_place",
        knowledge_writes: [
          createKnowledgeWrite({
            source_url: "https://docs.anthropic.com/en/docs/claude-code/hooks",
            canonical_url: "https://docs.anthropic.com/en/docs/claude-code/hooks",
            title: "Claude Code hooks",
            summary: "summary",
            tags: ["claude", "hooks"],
            content_hash: "sha256:hooks",
            normalized_text: "summary",
            source_kind: "external_public_web"
          })
        ]
      }),
      sourceUrls: [],
      guildId: "guild-1",
      rootChannelId: "channel-root-2",
      placeId: "channel-root-2:chat",
      scope: "server_public",
      sourceMessageId: "message-5",
      replyThreadId: null
    });

    const row = store.db
      .prepare("SELECT canonical_url, scope, visibility_key FROM knowledge_record LIMIT 1")
      .get() as { canonical_url: string; scope: string; visibility_key: string };

    assert.equal(row.canonical_url, "https://docs.anthropic.com/en/docs/claude-code/hooks");
    assert.equal(row.scope, "server_public");
    assert.equal(row.visibility_key, "server_public:guild-1");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KnowledgePersistenceService rejects URL-less knowledge_ingest without persistable sources", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-ingest-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const service = new KnowledgePersistenceService(store, pino({ level: "silent" }));

  try {
    assert.throws(
      () =>
        service.persist({
          response: createHarnessResponse({
            public_text: "保存したいです。",
            reply_mode: "same_place",
            knowledge_writes: []
          }),
          sourceUrls: [],
          guildId: "guild-1",
          rootChannelId: "channel-root-2",
          placeId: "channel-root-2:chat",
          scope: "server_public",
          sourceMessageId: "message-6",
          replyThreadId: null
        }),
      /persistable public source/
    );
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KnowledgePersistenceService persists additional researched sources beyond pasted message URLs", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-ingest-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const service = new KnowledgePersistenceService(store, pino({ level: "silent" }));

  try {
    service.persist({
      response: createHarnessResponse({
        public_text: "関連ソースも含めて保存しました。",
        reply_mode: "same_place",
        knowledge_writes: [
          createKnowledgeWrite({
            source_url: "https://example.com/article",
            canonical_url: "https://example.com/article",
            title: "Primary",
            summary: "primary",
            tags: ["primary"],
            content_hash: "sha256:primary",
            normalized_text: "primary",
            source_kind: "external_public_web"
          }),
          createKnowledgeWrite({
            source_url: "https://docs.example.com/reference",
            canonical_url: "https://docs.example.com/reference",
            title: "Reference",
            summary: "reference",
            tags: ["reference"],
            content_hash: "sha256:reference",
            normalized_text: "reference",
            source_kind: "external_public_web"
          })
        ]
      }),
      sourceUrls: ["https://example.com/article"],
      guildId: "guild-1",
      rootChannelId: "channel-root-3",
      placeId: "channel-root-3:chat",
      scope: "server_public",
      sourceMessageId: "message-7",
      replyThreadId: null
    });

    const count = store.db
      .prepare("SELECT COUNT(*) AS count FROM knowledge_record")
      .get() as { count: number };

    assert.equal(count.count, 2);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
