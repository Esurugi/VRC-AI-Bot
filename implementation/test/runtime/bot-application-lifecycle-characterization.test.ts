import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { BotApplication } from "../../src/app/bot-app.js";
import type { AppConfig } from "../../src/domain/types.js";

test("OCV.01 BotApplication starts Discord lifecycle without eager-starting Codex", async () => {
  const harness = createBotApplicationHarness({
    failCodexStart: new Error("Codex must lazy-start from AI turn requests")
  });

  try {
    await harness.app.start();
    const startSteps = [...harness.steps];

    assertSubsequence(startSteps, [
      "store.migrate",
      "watchLocations.sync",
      "runtimeLock.acquire",
      "chatCounter.resetAll",
      "discord.login",
      "discord.ready",
      "admin.registerCommands",
      "recovery.recoverPendingMessages",
      "retry.drainDueJobs",
      "weekly.poll",
      "retry.start"
    ]);
    assert.equal(harness.steps.includes("codex.start"), false);
  } finally {
    await harness.app.stop();
  }
});

test("OCV.01 start failure cleanup does not require Codex eager start", async () => {
  const harness = createBotApplicationHarness({
    failRecovery: new Error("startup recovery failed"),
    failCodexStart: new Error("Codex must lazy-start from AI turn requests")
  });

  await assert.rejects(() => harness.app.start(), /startup recovery failed/);

  assertSubsequence(harness.steps, [
    "store.migrate",
    "watchLocations.sync",
    "runtimeLock.acquire",
    "chatCounter.resetAll",
    "discord.login",
    "discord.ready",
    "admin.registerCommands",
    "recovery.recoverPendingMessages",
    "retry.stop",
    "runtimeLock.release",
    "codex.close",
    "discord.destroy",
    "store.close"
  ]);
  assert.equal(harness.steps.includes("codex.start"), false);
  assert.equal(harness.steps.includes("retry.start"), false);
});

test("OCV.01 full dependency override does not fall back to default runtime instances", async () => {
  const harness = createBotApplicationHarness({
    config: createPoisonDefaultConfig(),
    failCodexStart: new Error("Codex must lazy-start from AI turn requests")
  });

  assert.equal(harness.app.store, harness.store);

  try {
    await harness.app.start();

    assertSubsequence(harness.steps, [
      "store.migrate",
      "watchLocations.sync",
      "runtimeLock.acquire",
      "chatCounter.resetAll",
      "discord.login",
      "discord.ready",
      "admin.registerCommands",
      "recovery.recoverPendingMessages",
      "retry.drainDueJobs",
      "weekly.poll",
      "retry.start"
    ]);
    assert.equal(harness.steps.includes("codex.start"), false);
  } finally {
    await harness.app.stop();
  }
});

type HarnessOptions = {
  config?: AppConfig;
  failCodexStart?: Error;
  failRecovery?: Error;
};

function createBotApplicationHarness(options: HarnessOptions = {}): {
  app: BotApplication;
  store: unknown;
  steps: string[];
} {
  const steps: string[] = [];
  const config = options.config ?? createConfig();
  const client = new FakeDiscordClient(steps, config.discordBotToken);
  const store = createFakeStore(steps);
  const codexClient = {
    start: async () => {
      steps.push("codex.start");
      if (options.failCodexStart) {
        throw options.failCodexStart;
      }
    },
    close: async () => {
      steps.push("codex.close");
    }
  };
  const startupMessageRecoveryService = {
    recoverPendingMessages: async () => {
      steps.push("recovery.recoverPendingMessages");
      if (options.failRecovery) {
        throw options.failRecovery;
      }
    }
  };
  const retryJobRunner = {
    drainDueJobs: async () => {
      steps.push("retry.drainDueJobs");
    },
    start: () => {
      steps.push("retry.start");
    },
    stop: () => {
      steps.push("retry.stop");
    }
  };
  const weeklyMeetupAnnouncementService = {
    poll: async () => {
      steps.push("weekly.poll");
    }
  };

  const app = new BotApplication(config, {
    client,
    logger: createNoopLogger(),
    store,
    codexClient,
    sessionPolicyResolver: {},
    sessionManager: {},
    harnessRunner: {},
    failureClassifier: {},
    retryScheduler: {},
    moderationExecutor: {},
    moderationIntegration: {},
    replyDispatchService: {},
    messageProcessingService: {},
    messageIntakeService: {},
    startupMessageRecoveryService,
    retryJobRunner,
    adminCommandService: {
      registerCommands: async () => {
        steps.push("admin.registerCommands");
      },
      handle: async () => {}
    },
    adminOverrideBootstrapService: {},
    overrideBootstrapPromptContextService: {},
    chatChannelCounterService: {
      resetAll: () => {
        steps.push("chatCounter.resetAll");
      }
    },
    chatEngagementPolicy: {},
    chatRuntimeControlService: {},
    recentChatHistoryService: {},
    forumFirstTurnPreprocessor: {},
    forumResearchPromptRefiner: {},
    forumResearchSupervisor: {},
    featureThreadService: {},
    plainTextAttachmentService: {},
    weeklyMeetupAnnouncementService,
    queue: {}
  } as unknown as ConstructorParameters<typeof BotApplication>[1]);

  return { app, store, steps };
}

class FakeDiscordClient extends EventEmitter {
  readonly channels = {
    fetch: async () => null
  };

  private ready = false;

  constructor(
    private readonly steps: string[],
    private readonly expectedToken: string
  ) {
    super();
  }

  async login(token: string): Promise<string> {
    assert.equal(token, this.expectedToken);
    this.steps.push("discord.login");
    this.ready = true;
    return "logged-in";
  }

  isReady(): boolean {
    if (this.ready) {
      this.steps.push("discord.ready");
    }
    return this.ready;
  }

  destroy(): void {
    this.steps.push("discord.destroy");
  }
}

function createFakeStore(steps: string[]): unknown {
  return {
    migrate: () => {
      steps.push("store.migrate");
    },
    watchLocations: {
      sync: () => {
        steps.push("watchLocations.sync");
      }
    },
    runtimeLock: {
      tryAcquire: () => {
        steps.push("runtimeLock.acquire");
        return true;
      },
      renew: () => {
        steps.push("runtimeLock.renew");
      },
      release: () => {
        steps.push("runtimeLock.release");
      }
    },
    channelCursors: {
      get: () => null,
      upsert: () => {}
    },
    close: () => {
      steps.push("store.close");
    }
  };
}

function createConfig(): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "application-id",
    discordOwnerUserIds: ["owner-1"],
    botDbPath: ":memory:",
    botLogLevel: "fatal",
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

function createPoisonDefaultConfig(): AppConfig {
  return {
    ...createConfig(),
    discordBotToken: "poison-token-that-must-only-reach-fake-discord",
    botDbPath: "\0poison-default-sqlite-store-must-not-be-created.sqlite",
    codexAppServerCommand: "\0poison-default-codex-command-must-not-be-started",
    codexHomePath: "\0poison-default-codex-home-must-not-be-used"
  };
}

function createNoopLogger(): unknown {
  return {
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {}
  };
}

function assertSubsequence(actual: string[], expected: string[]): void {
  let cursor = -1;

  for (const step of expected) {
    const index = actual.indexOf(step, cursor + 1);
    assert.notEqual(
      index,
      -1,
      `expected ${step} after ${cursor >= 0 ? actual[cursor] : "start"} in ${JSON.stringify(actual)}`
    );
    cursor = index;
  }
}
