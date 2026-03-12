import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import pino from "pino";

import type { CodexSandboxMode } from "../src/domain/types.js";
import { SessionManager } from "../src/codex/session-manager.js";
import { SessionPolicyResolver } from "../src/codex/session-policy.js";
import { SqliteStore } from "../src/storage/database.js";

test("SessionManager resumes persisted binding when runtime generation is unchanged", async () => {
  const fixture = createFixture();
  const identity = fixture.resolver.resolveKnowledgeThreadConversation({
    threadId: "discord-thread-1"
  });
  fixture.store.codexSessions.upsert({
    sessionIdentity: identity.sessionIdentity,
    workloadKind: identity.workloadKind,
    bindingKind: identity.bindingKind,
    bindingId: identity.bindingId,
    actorId: identity.actorId,
    sandboxMode: identity.sandboxMode,
    modelProfile: identity.modelProfile,
    runtimeContractVersion: identity.runtimeContractVersion,
    lifecyclePolicy: identity.lifecyclePolicy,
    codexThreadId: "persisted-thread-1"
  });

  try {
    const result = await fixture.manager.getOrStartSession(identity);

    assert.deepEqual(result, {
      threadId: "persisted-thread-1",
      startedFresh: false
    });
    assert.deepEqual(fixture.codexClient.resumeCalls, [
      {
        threadId: "persisted-thread-1",
        sandbox: "read-only"
      }
    ]);
    assert.equal(fixture.codexClient.startCalls.length, 0);
  } finally {
    fixture.close();
  }
});

test("SessionManager ignores legacy table rows and starts a fresh session", async () => {
  const fixture = createFixture();
  const identity = fixture.resolver.resolveForMessage({
    envelope: {
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "こんにちは",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "chat",
      defaultScope: "channel_family"
    },
    actorRole: "user",
    scope: "channel_family",
    workspaceWriteActive: false
  });
  fixture.store.db
    .prepare(
      "INSERT INTO codex_session_legacy (place_id, codex_thread_id) VALUES (?, ?)"
    )
    .run("channel-1:chat:ro", "legacy-thread-1");

  try {
    const result = await fixture.manager.getOrStartSession(identity);

    assert.deepEqual(result, {
      threadId: "thread-1",
      startedFresh: true
    });
    assert.equal(fixture.codexClient.resumeCalls.length, 0);
    assert.deepEqual(fixture.codexClient.startCalls, [
      {
        sandbox: "read-only",
        model: "gpt-5.4"
      }
    ]);
    assert.equal(
      fixture.store.codexSessions.get(identity.sessionIdentity)?.codex_thread_id,
      "thread-1"
    );
  } finally {
    fixture.close();
  }
});

test("SessionManager invalidates reusable sessions after skills change and starts fresh", async () => {
  const fixture = createFixture();
  const identity = fixture.resolver.resolveForMessage({
    envelope: {
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "こんにちは",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "chat",
      defaultScope: "channel_family"
    },
    actorRole: "user",
    scope: "channel_family",
    workspaceWriteActive: false
  });
  fixture.store.codexSessions.upsert({
    sessionIdentity: identity.sessionIdentity,
    workloadKind: identity.workloadKind,
    bindingKind: identity.bindingKind,
    bindingId: identity.bindingId,
    actorId: identity.actorId,
    sandboxMode: identity.sandboxMode,
    modelProfile: identity.modelProfile,
    runtimeContractVersion: identity.runtimeContractVersion,
    lifecyclePolicy: identity.lifecyclePolicy,
    codexThreadId: "persisted-thread-1"
  });
  fixture.codexClient.setSessionInvalidationGeneration(1);

  try {
    const result = await fixture.manager.getOrStartSession(identity);

    assert.deepEqual(result, {
      threadId: "thread-1",
      startedFresh: true
    });
    assert.equal(fixture.codexClient.resumeCalls.length, 0);
    assert.deepEqual(fixture.codexClient.startCalls, [
      {
        sandbox: "read-only",
        model: "gpt-5.4"
      }
    ]);
    assert.equal(
      fixture.store.codexSessions.get(identity.sessionIdentity)?.codex_thread_id,
      "thread-1"
    );
  } finally {
    fixture.close();
  }
});

test("SessionManager archives override session and removes binding", async () => {
  const fixture = createFixture();
  const identity = fixture.resolver.resolveAdminOverrideThread({
    threadId: "override-thread-1",
    actorId: "admin-1"
  });
  fixture.store.codexSessions.upsert({
    sessionIdentity: identity.sessionIdentity,
    workloadKind: identity.workloadKind,
    bindingKind: identity.bindingKind,
    bindingId: identity.bindingId,
    actorId: identity.actorId,
    sandboxMode: identity.sandboxMode,
    modelProfile: identity.modelProfile,
    runtimeContractVersion: identity.runtimeContractVersion,
    lifecyclePolicy: identity.lifecyclePolicy,
    codexThreadId: "workspace-thread-1"
  });

  try {
    const result = await fixture.manager.archiveSession(identity);

    assert.deepEqual(result, {
      archived: true,
      threadId: "workspace-thread-1"
    });
    assert.deepEqual(fixture.codexClient.archiveCalls, ["workspace-thread-1"]);
    assert.deepEqual(fixture.codexClient.unsubscribeCalls, [
      "workspace-thread-1"
    ]);
    assert.equal(
      fixture.store.codexSessions.get(identity.sessionIdentity),
      null
    );
  } finally {
    fixture.close();
  }
});

function createFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-session-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const codexClient = new FakeCodexClient();
  const manager = new SessionManager(
    store,
    codexClient as never,
    pino({ level: "silent" })
  );
  const resolver = new SessionPolicyResolver();

  return {
    store,
    codexClient,
    manager,
    resolver,
    close() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

class FakeCodexClient {
  readonly startCalls: Array<{ sandbox: CodexSandboxMode; model: string }> = [];
  readonly resumeCalls: Array<{ threadId: string; sandbox: CodexSandboxMode }> = [];
  readonly archiveCalls: string[] = [];
  readonly unsubscribeCalls: string[] = [];
  private threadCount = 0;
  private sessionInvalidationGeneration = 0;

  async startThread(
    sandbox: CodexSandboxMode,
    model = "gpt-5.4"
  ): Promise<string> {
    this.startCalls.push({ sandbox, model });
    this.threadCount += 1;
    return `thread-${this.threadCount}`;
  }

  async resumeThread(threadId: string, sandbox: CodexSandboxMode): Promise<void> {
    this.resumeCalls.push({ threadId, sandbox });
  }

  async archiveThread(threadId: string): Promise<void> {
    this.archiveCalls.push(threadId);
  }

  async unsubscribeThread(threadId: string): Promise<void> {
    this.unsubscribeCalls.push(threadId);
  }

  getSessionInvalidationGeneration(): number {
    return this.sessionInvalidationGeneration;
  }

  setSessionInvalidationGeneration(generation: number): void {
    this.sessionInvalidationGeneration = generation;
  }
}
