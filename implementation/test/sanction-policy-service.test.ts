import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ModerationExecutor } from "../src/discord/moderation-executor.js";
import type { MessageEnvelope, WatchLocationConfig } from "../src/domain/types.js";
import {
  SanctionPolicyService,
  createBotModerationIntegration
} from "../src/app/sanction-policy-service.js";
import type {
  PostResponseModerationInput,
  SanctionNotificationPayload,
  SoftBlockPreflightInput
} from "../src/app/moderation-integration.js";
import type { HarnessResolvedSession } from "../src/harness/harness-runner.js";
import type { HarnessResponse } from "../src/harness/contracts.js";
import { SqliteStore } from "../src/storage/database.js";

test("SanctionPolicyService ignores moderation_signal=none", async () => {
  const fixture = createFixture();

  try {
    await fixture.service.recordAndEvaluate(
      fixture.createInput({
        moderation_signal: {
          violation_category: "none",
          control_request_class: null,
          notes: null
        }
      }),
      fixture.now
    );

    assert.equal(fixture.store.violationEvents.countForActorSince(fixture.countQuery), 0);
    assert.deepEqual(fixture.notifications, []);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    fixture.close();
  }
});

test("SanctionPolicyService applies timeout on the fifth countable violation in 30 days", async () => {
  const fixture = createFixture();

  try {
    seedViolations(fixture.store, 4, fixture.now);

    await fixture.service.recordAndEvaluate(
      fixture.createInput(),
      fixture.now
    );

    const events = fixture.store.violationEvents.listForActorSince(fixture.countQuery);
    const sanctions = fixture.store.sanctionStates.listRecentForActor({
      guildId: "guild-1",
      userId: "user-1",
      startedAtGte: "2026-01-01T00:00:00.000Z"
    });

    assert.equal(events.length, 5);
    assert.equal(sanctions.length, 1);
    assert.equal(sanctions[0]?.action, "timeout");
    assert.equal(sanctions[0]?.delivery_status, "applied");
    assert.equal(sanctions[0]?.state, "active");
    assert.equal(fixture.executor.calls.length, 1);
    assert.deepEqual(fixture.executor.calls[0], {
      kind: "timeout",
      guildId: "guild-1",
      userId: "user-1",
      durationMs: 24 * 60 * 60 * 1000,
      reason: "t12-threshold-reached"
    });
    assert.equal(fixture.notifications.length, 1);
    assert.equal(fixture.notifications[0]?.action, "timeout");
    assert.equal(fixture.notifications[0]?.delivery_status, "applied");
  } finally {
    fixture.close();
  }
});

test("SanctionPolicyService falls back to soft-block when timeout fails", async () => {
  const fixture = createFixture({
    executor: {
      timeoutResult: {
        ok: false,
        action: "timeout",
        deliveryStatus: "failed",
        failureReason: "missing_permission",
        message: "missing MODERATE_MEMBERS permission"
      }
    }
  });

  try {
    seedViolations(fixture.store, 4, fixture.now);

    await fixture.service.recordAndEvaluate(
      fixture.createInput(),
      fixture.now
    );

    const sanctions = fixture.store.sanctionStates.listRecentForActor({
      guildId: "guild-1",
      userId: "user-1",
      startedAtGte: "2026-01-01T00:00:00.000Z"
    });

    assert.equal(sanctions.length, 1);
    assert.equal(sanctions[0]?.action, "soft_block");
    assert.equal(sanctions[0]?.delivery_status, "fallback");
    assert.equal(sanctions[0]?.reason, "timeout-failed");
    assert.equal(fixture.notifications[0]?.action, "soft_block");
    assert.equal(fixture.notifications[0]?.duration, "24h");
  } finally {
    fixture.close();
  }
});

test("SanctionPolicyService escalates to kick after recent timeout or soft-block", async () => {
  const fixture = createFixture();

  try {
    fixture.store.sanctionStates.insert({
      sanctionId: "existing-timeout",
      guildId: "guild-1",
      userId: "user-1",
      state: "active",
      action: "timeout",
      deliveryStatus: "applied",
      triggerEventId: "event-prior",
      startedAt: "2026-03-01T00:00:00.000Z",
      endsAt: "2026-03-02T00:00:00.000Z",
      reason: "t12-threshold-reached"
    });

    await fixture.service.recordAndEvaluate(
      fixture.createInput(),
      fixture.now
    );

    const sanctions = fixture.store.sanctionStates.listRecentForActor({
      guildId: "guild-1",
      userId: "user-1",
      startedAtGte: "2026-01-01T00:00:00.000Z"
    });

    assert.equal(sanctions.length, 2);
    assert.equal(sanctions[0]?.action, "kick");
    assert.equal(sanctions[0]?.delivery_status, "applied");
    assert.equal(sanctions[0]?.state, "completed");
    assert.deepEqual(fixture.executor.calls[0], {
      kind: "kick",
      guildId: "guild-1",
      userId: "user-1",
      reason: "repeat-after-timeout"
    });
    assert.equal(fixture.notifications[0]?.action, "kick");
  } finally {
    fixture.close();
  }
});

test("SanctionPolicyService falls back to 30d soft-block when kick fails", async () => {
  const fixture = createFixture({
    executor: {
      kickResult: {
        ok: false,
        action: "kick",
        deliveryStatus: "failed",
        failureReason: "hierarchy_blocked",
        message: "target member is not kickable"
      }
    }
  });

  try {
    fixture.store.sanctionStates.insert({
      sanctionId: "existing-soft-block",
      guildId: "guild-1",
      userId: "user-1",
      state: "active",
      action: "soft_block",
      deliveryStatus: "fallback",
      triggerEventId: "event-prior",
      startedAt: "2026-03-01T00:00:00.000Z",
      endsAt: "2026-03-02T00:00:00.000Z",
      reason: "timeout-failed"
    });

    await fixture.service.recordAndEvaluate(
      fixture.createInput(),
      fixture.now
    );

    const sanctions = fixture.store.sanctionStates.listRecentForActor({
      guildId: "guild-1",
      userId: "user-1",
      startedAtGte: "2026-01-01T00:00:00.000Z"
    });

    assert.equal(sanctions[0]?.action, "soft_block");
    assert.equal(sanctions[0]?.delivery_status, "fallback");
    assert.equal(sanctions[0]?.reason, "kick-failed");
    assert.equal(fixture.notifications[0]?.action, "soft_block");
    assert.equal(fixture.notifications[0]?.duration, "30d");
  } finally {
    fixture.close();
  }
});

test("SanctionPolicyService records audit-only rows for admin actors", async () => {
  const fixture = createFixture();

  try {
    await fixture.service.recordAndEvaluate(
      fixture.createInput({
        actorRole: "admin"
      }),
      fixture.now
    );

    const events = fixture.store.violationEvents.listForActorSince(fixture.countQuery);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.handled_as, "admin_exempt");
    assert.equal(events[0]?.counts_toward_threshold, 0);
    assert.deepEqual(fixture.executor.calls, []);
    assert.deepEqual(fixture.notifications, []);
  } finally {
    fixture.close();
  }
});

test("SanctionPolicyService records audit-only rows when override suspends the violation counter", async () => {
  const fixture = createFixture();

  try {
    await fixture.service.recordAndEvaluate(
      fixture.createInput({
        violation_counter_suspended: true
      }),
      fixture.now
    );

    const events = fixture.store.violationEvents.listForActorSince(fixture.countQuery);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.handled_as, "suspended_override");
    assert.equal(events[0]?.counts_toward_threshold, 0);
    assert.deepEqual(fixture.executor.calls, []);
    assert.deepEqual(fixture.notifications, []);
  } finally {
    fixture.close();
  }
});

test("createBotModerationIntegration suppresses repeated soft-block notices in the same channel for 12 hours", async () => {
  const fixture = createFixture();
  const integration = createBotModerationIntegration(fixture.store);

  try {
    fixture.store.sanctionStates.insert({
      sanctionId: "soft-block-active",
      guildId: "guild-1",
      userId: "user-1",
      state: "active",
      action: "soft_block",
      deliveryStatus: "fallback",
      triggerEventId: "event-1",
      startedAt: "2026-03-11T00:00:00.000Z",
      endsAt: "2026-03-13T00:00:00.000Z",
      reason: "timeout-failed"
    });

    const first = await integration.checkSoftBlock(createSoftBlockInput());
    const second = await integration.checkSoftBlock(createSoftBlockInput());
    const otherChannel = await integration.checkSoftBlock(
      createSoftBlockInput({
        envelope: {
          ...createEnvelope(),
          channelId: "chat-2"
        }
      })
    );

    assert.equal(first.blocked, true);
    assert.equal(first.notice_text, "現在このサーバーでは一定期間 bot を利用できません。");
    assert.equal(second.blocked, true);
    assert.equal(second.notice_text, null);
    assert.equal(otherChannel.blocked, true);
    assert.equal(
      otherChannel.notice_text,
      "現在このサーバーでは一定期間 bot を利用できません。"
    );
  } finally {
    fixture.close();
  }
});

type ExecutorCall =
  | { kind: "timeout"; guildId: string; userId: string; durationMs: number; reason: string }
  | { kind: "kick"; guildId: string; userId: string; reason: string };

function createFixture(input?: {
  executor?: {
    timeoutResult?: Awaited<ReturnType<ModerationExecutor["timeoutMember"]>>;
    kickResult?: Awaited<ReturnType<ModerationExecutor["kickMember"]>>;
  };
}): {
  store: SqliteStore;
  service: SanctionPolicyService;
  executor: ModerationExecutor & { calls: ExecutorCall[] };
  notifications: SanctionNotificationPayload[];
  createInput: (overrides?: Partial<PostResponseModerationInput>) => PostResponseModerationInput;
  now: Date;
  countQuery: {
    guildId: string;
    userId: string;
    occurredAtGte: string;
  };
  close: () => void;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-t12-"));
  const store = new SqliteStore(join(tempDir, "bot.sqlite"), process.cwd());
  store.migrate();
  const now = new Date("2026-03-12T12:00:00.000Z");
  const notifications: SanctionNotificationPayload[] = [];
  const calls: ExecutorCall[] = [];
  const timeoutResult =
    input?.executor?.timeoutResult ??
    ({
      ok: true,
      action: "timeout",
      deliveryStatus: "applied"
    } as const);
  const kickResult =
    input?.executor?.kickResult ??
    ({
      ok: true,
      action: "kick",
      deliveryStatus: "applied"
    } as const);

  const executor: ModerationExecutor & { calls: ExecutorCall[] } = {
    calls,
    async timeoutMember(guildId, userId, durationMs, reason) {
      calls.push({ kind: "timeout", guildId, userId, durationMs, reason });
      return timeoutResult;
    },
    async kickMember(guildId, userId, reason) {
      calls.push({ kind: "kick", guildId, userId, reason });
      return kickResult;
    }
  };

  return {
    store,
    service: new SanctionPolicyService(store),
    executor,
    notifications,
    createInput(overrides = {}) {
      return createPostResponseInput({
        executeModeration: executor,
        notifySanctionStateChange: async (payload) => {
          notifications.push(payload);
        },
        ...overrides
      });
    },
    now,
    countQuery: {
      guildId: "guild-1",
      userId: "user-1",
      occurredAtGte: "2026-01-01T00:00:00.000Z"
    },
    close() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function seedViolations(store: SqliteStore, count: number, now: Date): void {
  for (let index = 0; index < count; index += 1) {
    store.violationEvents.append({
      eventId: `event-${index + 1}`,
      guildId: "guild-1",
      userId: "user-1",
      messageId: `message-${index + 1}`,
      placeId: "chat-1",
      violationCategory: "dangerous",
      controlRequestClass: "dangerous-advice",
      handledAs: "countable",
      countsTowardThreshold: true,
      actorRole: "user",
      occurredAt: new Date(now.getTime() - (index + 1) * 60_000).toISOString()
    });
  }
}

function createPostResponseInput(
  overrides: Partial<PostResponseModerationInput> = {}
): PostResponseModerationInput {
  return {
    envelope: createEnvelope(),
    watchLocation: createWatchLocation(),
    actorRole: "user",
    scope: "server_public",
    response: createHarnessResponse(),
    session: createSession(),
    moderation_signal: {
      violation_category: "dangerous",
      control_request_class: "dangerous-advice",
      notes: null
    },
    violation_counter_suspended: false,
    executeModeration: overrides.executeModeration ?? {
      async timeoutMember() {
        throw new Error("unexpected timeoutMember call");
      },
      async kickMember() {
        throw new Error("unexpected kickMember call");
      }
    },
    notifySanctionStateChange: overrides.notifySanctionStateChange ?? (async () => undefined),
    ...overrides
  };
}

function createSoftBlockInput(
  overrides: Partial<SoftBlockPreflightInput> = {}
): SoftBlockPreflightInput {
  return {
    envelope: createEnvelope(),
    watchLocation: createWatchLocation(),
    actorRole: "user",
    scope: "server_public",
    ...overrides
  };
}

function createEnvelope(): MessageEnvelope {
  return {
    guildId: "guild-1",
    channelId: "chat-1",
    messageId: "message-1",
    authorId: "user-1",
    placeType: "chat_channel",
    rawPlaceType: "GuildText",
    content: "do the bad thing",
    urls: [],
    receivedAt: "2026-03-12T12:00:00.000Z"
  };
}

function createWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "chat-1",
    mode: "chat",
    defaultScope: "server_public"
  };
}

function createHarnessResponse(): HarnessResponse {
  return {
    outcome: "chat_reply",
    repo_write_intent: false,
    public_text: "通常応答",
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [],
    knowledge_writes: [],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none"
  };
}

function createSession(): HarnessResolvedSession {
  return {
    threadId: "thread-1",
    startedFresh: true,
    identity: {
      sessionIdentity:
        "workload=conversation|binding_kind=place|binding_id=chat-1|actor_id=-|sandbox=read-only|model=default:gpt-5.4|contract=2026-03-12.session-policy.v1|lifecycle=reusable",
      workloadKind: "conversation",
      bindingKind: "place",
      bindingId: "chat-1",
      actorId: null,
      sandboxMode: "read-only",
      modelProfile: "default:gpt-5.4",
      runtimeContractVersion: "2026-03-12.session-policy.v1",
      lifecyclePolicy: "reusable"
    }
  };
}
