import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { MessageProcessingService } from "../../src/runtime/message/message-processing-service.js";
import { SqliteStore } from "../../src/storage/database.js";
import type { AppConfig } from "../../src/domain/types.js";
import type { QueuedMessage } from "../../src/runtime/types.js";

test("AE-DB-01 pending retry duplicates do not advance the channel cursor", async () => {
  const workspace = createTempWorkspace();
  let store: SqliteStore | null = null;
  try {
    store = createMigratedStore(workspace);
    store.channelCursors.upsert("channel-1", "2000");
    assert.deepEqual(store.messageProcessing.tryAcquire("1000", "channel-1"), {
      status: "acquired"
    });
    store.messageProcessing.markPendingRetry("1000");

    const service = createMessageProcessingService(store);
    await service.process(createQueuedMessage({
      source: "live",
      messageId: "1000",
      channelId: "channel-1"
    }));

    assert.equal(
      store.channelCursors.get("channel-1")?.last_processed_message_id,
      "2000"
    );
    assert.equal(store.messageProcessing.get("1000")?.state, "pending_retry");
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("AE-DB-01 completed duplicate messages never rewind a newer snowflake cursor", async () => {
  const workspace = createTempWorkspace();
  let store: SqliteStore | null = null;
  try {
    store = createMigratedStore(workspace);
    store.channelCursors.upsert("channel-1", "2000");
    assert.deepEqual(store.messageProcessing.tryAcquire("1000", "channel-1"), {
      status: "acquired"
    });
    store.messageProcessing.markCompleted("1000");

    const service = createMessageProcessingService(store);
    await service.process(createQueuedMessage({
      source: "live",
      messageId: "1000",
      channelId: "channel-1"
    }));

    assert.equal(
      store.channelCursors.get("channel-1")?.last_processed_message_id,
      "2000",
      "a completed duplicate older than the current cursor must not roll back recovery state"
    );
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("AE-DB-01 completed duplicate messages may advance the cursor when the duplicate is newer", async () => {
  const workspace = createTempWorkspace();
  let store: SqliteStore | null = null;
  try {
    store = createMigratedStore(workspace);
    store.channelCursors.upsert("channel-1", "1000");
    assert.deepEqual(store.messageProcessing.tryAcquire("2000", "channel-1"), {
      status: "acquired"
    });
    store.messageProcessing.markCompleted("2000");

    const service = createMessageProcessingService(store);
    await service.process(createQueuedMessage({
      source: "live",
      messageId: "2000",
      channelId: "channel-1"
    }));

    assert.equal(
      store.channelCursors.get("channel-1")?.last_processed_message_id,
      "2000"
    );
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("AE-DB-01 terminal duplicate messages never rewind a newer snowflake cursor", async () => {
  const workspace = createTempWorkspace();
  let store: SqliteStore | null = null;
  try {
    store = createMigratedStore(workspace);
    store.channelCursors.upsert("channel-1", "2000");
    assert.deepEqual(store.messageProcessing.tryAcquire("1000", "channel-1"), {
      status: "acquired"
    });
    store.messageProcessing.markTerminalFailureNotified("1000");

    const notifications: string[] = [];
    const service = createMessageProcessingService(store, {
      replyDispatchService: {
        notifyFailureInTarget: async () => {
          notifications.push("failure");
        },
        notifyFailureForRetryJob: async () => {
          notifications.push("retry");
        },
        notifyPermanentFailure: async () => {
          notifications.push("permanent");
        }
      } as never
    });
    await service.process(createQueuedMessage({
      source: "live",
      messageId: "1000",
      channelId: "channel-1"
    }));

    assert.equal(
      store.channelCursors.get("channel-1")?.last_processed_message_id,
      "2000",
      "a terminal duplicate older than the current cursor must not roll back recovery state"
    );
    assert.equal(
      store.messageProcessing.get("1000")?.state,
      "terminal_failure_notified"
    );
    assert.deepEqual(
      notifications,
      [],
      "terminal duplicates must not repeat public failure notifications"
    );
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("AE-DB-01 terminal duplicate messages may advance the cursor when the duplicate is newer", async () => {
  const workspace = createTempWorkspace();
  let store: SqliteStore | null = null;
  try {
    store = createMigratedStore(workspace);
    store.channelCursors.upsert("channel-1", "1000");
    assert.deepEqual(store.messageProcessing.tryAcquire("2000", "channel-1"), {
      status: "acquired"
    });
    store.messageProcessing.markTerminalFailureNotified("2000");

    const service = createMessageProcessingService(store);
    await service.process(createQueuedMessage({
      source: "live",
      messageId: "2000",
      channelId: "channel-1"
    }));

    assert.equal(
      store.channelCursors.get("channel-1")?.last_processed_message_id,
      "2000"
    );
    assert.equal(
      store.messageProcessing.get("2000")?.state,
      "terminal_failure_notified"
    );
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createTempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "vrc-ai-bot-cursor-retry-"));
}

function createMigratedStore(workspace: string): SqliteStore {
  const store = new SqliteStore(join(workspace, "bot.sqlite"));
  store.migrate();
  return store;
}

function createMessageProcessingService(
  store: SqliteStore,
  overrides: {
    replyDispatchService?: never;
  } = {}
): MessageProcessingService {
  const retryScheduler = {
    clear: (_messageId: string) => {}
  };

  return new MessageProcessingService(
    createConfig(),
    store,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      evaluateMessage: async () => ({ decision: "pass" })
    } as never,
    {
      decide: async () => "allow_clear_explanation"
    } as never,
    {} as never,
    retryScheduler as never,
    {} as never,
    {} as never,
    overrides.replyDispatchService ?? ({} as never),
    createLogger() as never
  );
}

function createConfig(): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "app",
    discordOwnerUserIds: [],
    botDbPath: "bot.sqlite",
    botLogLevel: "info",
    runtime: {
      maxConcurrentKeys: 4,
      retryPollIntervalMs: 15_000,
      codexIdleCloseMs: 1_800_000,
      ambientSparseInterval: 5
    },
    codexAppServerCommand: "codex-app-server",
    codexHomePath: null,
    watchLocations: [],
    chatRuntimeControls: null,
    weeklyMeetupAnnouncement: null
  };
}

function createQueuedMessage(input: {
  source: QueuedMessage["source"];
  messageId: string;
  channelId: string;
}): QueuedMessage {
  return {
    messageId: input.messageId,
    orderingKey: input.channelId,
    source: input.source,
    message: {} as never,
    envelope: {
      guildId: "guild-1",
      channelId: input.channelId,
      messageId: input.messageId,
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "hello",
      urls: [],
      receivedAt: "2026-05-21T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: input.channelId,
      mode: "chat",
      defaultScope: "conversation_only",
      features: ["conversation"],
      chatBehavior: "directed_help_chat"
    },
    actorRole: "user",
    scope: "conversation_only",
    chatEngagement: null
  };
}

function createLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {}
  };
}
