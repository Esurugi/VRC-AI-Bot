import assert from "node:assert/strict";
import test from "node:test";

import { createBotApplicationDependencies } from "../../src/app/bot-application-dependencies.js";
import type { AppConfig } from "../../src/domain/types.js";
import { RetryJobRunner } from "../../src/runtime/scheduling/retry-job-runner.js";

test("RES.01.01 wires config maxConcurrentKeys into the ordered message queue", async () => {
  const activeKeys: string[] = [];
  const blockers = [createDeferred<void>(), createDeferred<void>(), createDeferred<void>()];
  let blockerIndex = 0;
  const dependencies = createBotApplicationDependencies(
    createConfig({
      maxConcurrentKeys: 1
    }),
    createDependencyOverrides({
      processMessage: async (item) => {
        activeKeys.push(item.orderingKey);
        const blocker = blockers[blockerIndex] ?? createDeferred<void>();
        blockerIndex += 1;
        await blocker.promise;
      }
    }),
    {
      fetchChannel: async () => null
    }
  );

  try {
    dependencies.queue.enqueue(createQueuedMessage("100", "a"));
    dependencies.queue.enqueue(createQueuedMessage("101", "b"));
    dependencies.queue.enqueue(createQueuedMessage("102", "c"));

    await waitFor(() => activeKeys.length > 0);

    assert.deepEqual(activeKeys, ["a"]);
  } finally {
    for (const blocker of blockers) {
      blocker.resolve();
    }
    await waitFor(() => dependencies.queue.size === 0);
  }
});

test("retry runner uses BOT_RETRY_POLL_INTERVAL_MS from config when interval is not explicitly injected", () => {
  const intervals: number[] = [];
  const previousSetInterval = globalThis.setInterval;
  const previousClearInterval = globalThis.clearInterval;
  globalThis.setInterval = ((callback: () => void, interval?: number) => {
    intervals.push(Number(interval));
    return { callback } as never;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;

  const runner = new RetryJobRunner(
    createConfig({
      retryPollIntervalMs: 15_000
    }),
    {} as never,
    {} as never,
    {
      pollDueJobs: () => []
    } as never,
    {
      enqueue: () => true
    } as never,
    {} as never,
    {} as never,
    {} as never,
    createNoopLogger()
  );

  try {
    runner.start();

    assert.deepEqual(intervals, [15_000]);
  } finally {
    runner.stop();
    globalThis.setInterval = previousSetInterval;
    globalThis.clearInterval = previousClearInterval;
  }
});

type RuntimeConfigOverrides = {
  maxConcurrentKeys?: number;
  retryPollIntervalMs?: number;
};

type ProcessMessage = (item: {
  messageId: string;
  orderingKey: string;
}) => Promise<void>;

function createConfig(overrides: RuntimeConfigOverrides = {}): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "application-id",
    discordOwnerUserIds: ["owner"],
    botDbPath: ":memory:",
    botLogLevel: "fatal",
    codexAppServerCommand: "codex-app-server",
    codexHomePath: null,
    watchLocations: [],
    chatRuntimeControls: null,
    weeklyMeetupAnnouncement: null,
    ...overrides
  } as AppConfig;
}

function createDependencyOverrides(input: {
  processMessage: ProcessMessage;
}): Parameters<typeof createBotApplicationDependencies>[1] {
  return {
    client: {},
    logger: createNoopLogger(),
    store: {},
    codexClient: {},
    sessionPolicyResolver: {},
    sessionManager: {},
    harnessRunner: {},
    failureClassifier: {},
    retryScheduler: {},
    moderationExecutor: {},
    moderationIntegration: {},
    replyDispatchService: {},
    messageProcessingService: {
      process: input.processMessage
    },
    messageIntakeService: {},
    startupMessageRecoveryService: {},
    retryJobRunner: {},
    adminCommandService: {},
    adminOverrideBootstrapService: {},
    overrideBootstrapPromptContextService: {},
    chatChannelCounterService: {},
    chatEngagementPolicy: {},
    chatRuntimeControlService: {},
    recentChatHistoryService: {},
    clearExplanationRoutingGate: {},
    forumFirstTurnPreprocessor: {},
    forumResearchPromptRefiner: {},
    forumResearchSupervisor: {},
    featureThreadService: {},
    plainTextAttachmentService: {},
    weeklyMeetupAnnouncementService: {}
  } as never;
}

function createQueuedMessage(messageId: string, orderingKey: string): never {
  return {
    messageId,
    orderingKey
  } as never;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  assert.equal(predicate(), true);
}

function createNoopLogger(): never {
  return {
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {}
  } as never;
}
