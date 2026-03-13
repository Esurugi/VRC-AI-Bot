import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RetrySchedulerService } from "../src/app/retry-scheduler-service.js";
import { SqliteStore } from "../src/storage/database.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("RetrySchedulerService schedules pending retries and increments attempt count", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-retry-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let store: SqliteStore | undefined;

  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    const scheduler = new RetrySchedulerService(store);
    const baseInput = {
      envelope: {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-1",
        authorId: "user-1",
        placeType: "guild_text" as const,
        rawPlaceType: "GuildText",
        content: "hello",
        urls: [],
        receivedAt: "2026-03-12T00:00:00.000Z"
      },
      watchLocation: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "chat" as const,
        defaultScope: "server_public" as const
      },
      stage: "fetch_or_resolve" as const,
      replyChannelId: "channel-1",
      replyThreadId: null
    };

    store.messageProcessing.tryAcquire("message-1", "channel-1");
    scheduler.schedule({
      ...baseInput,
      decision: {
        retryable: true,
        publicCategory: "fetch_timeout",
        adminErrorPayload: "timed out",
        delayMs: 5 * 60_000,
        terminalReason: null
      },
      now: new Date("2026-03-12T00:00:00.000Z")
    });
    assert.equal(store.messageProcessing.get("message-1")?.state, "pending_retry");
    assert.equal(store.retryJobs.get("message-1")?.attempt_count, 1);

    scheduler.schedule({
      ...baseInput,
      decision: {
        retryable: true,
        publicCategory: "ai_processing_failed",
        adminErrorPayload: "503",
        delayMs: 30 * 60_000,
        terminalReason: null
      },
      now: new Date("2026-03-12T00:05:00.000Z")
    });
    assert.equal(store.retryJobs.get("message-1")?.attempt_count, 2);
    assert.deepEqual(
      scheduler
        .pollDueJobs(new Date("2026-03-12T00:20:00.000Z"))
        .map((row) => row.message_id),
      []
    );
    assert.deepEqual(
      scheduler
        .pollDueJobs(new Date("2026-03-12T00:35:00.000Z"))
        .map((row) => row.message_id),
      ["message-1"]
    );

    scheduler.clear("message-1");
    assert.equal(store.retryJobs.get("message-1"), null);
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
