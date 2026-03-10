import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteStore } from "../src/storage/database.js";

test("SqliteStore migrates and persists repositories", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-db-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let store: SqliteStore | undefined;

  try {
    store = new SqliteStore(dbPath, process.cwd());
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
    store.codexSessions.upsert("place-1", "thread-1");
    store.knowledgeRecords.insert({
      recordId: "record-1",
      canonicalUrl: "https://example.com/",
      domain: "example.com",
      title: "Example",
      summary: "summary",
      tags: ["example"],
      scope: "server_public",
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
    store.sourceLinks.insert({
      linkId: "link-1",
      recordId: "record-1",
      sourceMessageId: "m-source",
      replyThreadId: "thread-discord-1",
      createdAt: new Date().toISOString()
    });
    assert.equal(store.messageProcessing.tryAcquire("m1", "c1"), true);
    assert.equal(store.messageProcessing.tryAcquire("m1", "c1"), false);
    store.messageProcessing.markCompleted("m1");
    assert.equal(store.runtimeLock.tryAcquire("instance-a", process.pid), true);
    assert.equal(store.runtimeLock.tryAcquire("instance-b", 222), false);
    assert.equal(store.runtimeLock.renew("instance-a", process.pid), true);
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
    assert.equal(store.codexSessions.get("place-1")?.codex_thread_id, "thread-1");
    assert.equal(
      store.knowledgeRecords.findByDedup("https://example.com/", "sha256:1", "server_public")?.title,
      "Example"
    );
    assert.equal(store.knowledgeArtifacts.get("record-1")?.final_url, "https://example.com/");
    assert.equal(store.sourceLinks.listForSourceMessage("m-source").length, 1);
    assert.equal(store.messageProcessing.get("m1")?.state, "completed");
    assert.equal(store.runtimeLock.get(), null);
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
    store = new SqliteStore(dbPath, process.cwd());
    store.migrate();

    store.knowledgeRecords.insert({
      recordId: "record-1",
      canonicalUrl: "https://example.com/one",
      domain: "example.com",
      title: "One",
      summary: "summary one",
      tags: ["alpha"],
      scope: "server_public",
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
