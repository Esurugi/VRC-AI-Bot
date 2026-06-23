import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { CodexAppServerClient } from "../../src/codex/app-server-client.js";

const TEST_INITIALIZE_TIMEOUT_MS = 1_000;
const TEST_PROMISE_SETTLE_TIMEOUT_MS = 5_000;

test("COD.01 public thread requests lazy-start the app-server before RPC", async () => {
  const harness = createFakeCodexHarness();
  try {
    const threadId = await harness.client.startThread("read-only");

    assert.match(threadId, /^fake-thread-/);
    assert.equal(harness.countLogLines("spawn"), 1);
  } finally {
    await harness.close();
  }
});

test("COD.01 concurrent first requests share one startingPromise", async () => {
  const harness = createFakeCodexHarness();
  try {
    await Promise.all([
      harness.client.startThread("read-only"),
      harness.client.resumeThread("existing-thread", "read-only")
    ]);

    assert.equal(harness.countLogLines("spawn"), 1);
  } finally {
    await harness.close();
  }
});

test("COD.01 app-server exit self-heals on the next AI turn", async () => {
  const harness = createFakeCodexHarness({
    exitAfter: "thread/start"
  });
  try {
    await harness.client.startThread("read-only");
    await harness.waitForLogLines("spawn", 1);

    await harness.client.startThread("read-only");

    assert.equal(harness.countLogLines("spawn"), 2);
  } finally {
    await harness.close();
  }
});

test("COD.01 stale exited process write fails current request and self-heals next turn", async () => {
  const harness = createFakeCodexHarness({
    exitAfter: "thread/start"
  });
  try {
    await harness.client.startThread("read-only");

    blockEventLoop(100);

    await assert.rejects(
      () => harness.client.startThread("read-only"),
      /EPIPE|codex app-server exited unexpectedly/
    );
    await harness.waitForLogLines("spawn", 1);
    assert.equal(
      harness.countLogLines("spawn"),
      1,
      "stale-process failure must not replay the same RPC"
    );

    const threadId = await harness.client.startThread("read-only");

    assert.match(threadId, /^fake-thread-/);
    assert.equal(harness.countLogLines("spawn"), 2);
  } finally {
    await harness.close();
  }
});

test("COD.01 pending request fails on unexpected exit and is not auto-replayed", async () => {
  const harness = createFakeCodexHarness({
    exitBeforeResponse: "thread/start"
  });
  try {
    await assert.rejects(
      () => harness.client.startThread("read-only"),
      /codex app-server exited unexpectedly/
    );

    assert.equal(
      harness.countLogLines("spawn"),
      1,
      "the failed RPC must not be replayed against a new app-server process"
    );

    const threadId = await harness.client.startThread("read-only");

    assert.match(threadId, /^fake-thread-/);
    assert.equal(
      harness.countLogLines("spawn"),
      2,
      "self-healing start belongs to the next AI turn"
    );
  } finally {
    await harness.close();
  }
});

test("COD.01 spawn failure rejects lazy start without crashing the caller process", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--eval",
      buildSpawnFailureProbeScript()
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(
    result.status,
    0,
    `spawn failure probe should handle child_process error; stderr=${result.stderr}`
  );
  assert.match(result.stdout, /lazy-start-rejected/);
});

test("COD.01 initialize without a response rejects the first lazy start within the configured initialize timeout", async () => {
  const harness = createFakeCodexHarness({
    initializeTimeoutMs: TEST_INITIALIZE_TIMEOUT_MS,
    noResponseOnce: "initialize"
  });
  const firstStart = harness.client.startThread("read-only");
  try {
    await assert.rejects(
      () => rejectOrTimeout(firstStart, TEST_PROMISE_SETTLE_TIMEOUT_MS),
      /initialize.*timed out|timed out.*initialize/i
    );
  } finally {
    firstStart.catch(() => undefined);
    await harness.close();
  }
});

test("COD.01 initialize timeout clears startingPromise so the next lazy start respawns and succeeds", async () => {
  const harness = createFakeCodexHarness({
    initializeTimeoutMs: TEST_INITIALIZE_TIMEOUT_MS,
    noResponseOnce: "initialize"
  });
  const firstStart = harness.client.startThread("read-only");
  try {
    await assert.rejects(
      () => rejectOrTimeout(firstStart, TEST_PROMISE_SETTLE_TIMEOUT_MS),
      /initialize.*timed out|timed out.*initialize/i
    );

    const threadId = await harness.client.startThread("read-only");

    assert.match(threadId, /^fake-thread-/);
    assert.equal(harness.countLogLines("spawn"), 2);
  } finally {
    firstStart.catch(() => undefined);
    await harness.close();
  }
});

test("COD.01 child close during initialize rejects the pending lazy start", async () => {
  const harness = createFakeCodexHarness({
    exitBeforeResponse: "initialize"
  });
  try {
    await assert.rejects(
      () => rejectOrTimeout(harness.client.startThread("read-only"), 750),
      /codex app-server exited unexpectedly/
    );
    assert.equal(harness.countLogLines("spawn"), 1);
  } finally {
    await harness.close();
  }
});

test("COD.01 idle close stops the app-server and the next request restarts it", async () => {
  const harness = createFakeCodexHarness({
    idleCloseMs: 50
  });
  try {
    const firstThreadId = await harness.client.startThread("read-only");

    await sleep(200);
    const secondThreadId = await harness.client.startThread("read-only");

    assert.equal(harness.countLogLines("spawn"), 2);
    assert.notEqual(secondThreadId, firstThreadId);
  } finally {
    await harness.close();
  }
});

type HarnessOptions = {
  exitAfter?: string;
  exitBeforeResponse?: string;
  idleCloseMs?: number;
  initializeTimeoutMs?: number;
  noResponseOnce?: string;
};

function createFakeCodexHarness(options: HarnessOptions = {}): {
  client: CodexAppServerClient;
  close: () => Promise<void>;
  countLogLines: (prefix: string) => number;
  waitForLogLines: (prefix: string, count: number) => Promise<void>;
} {
  const workspace = mkdtempSync(join(tmpdir(), "vrc-ai-bot-fake-codex-"));
  const spawnLogPath = join(workspace, "spawn.log");
  const scriptPath = resolve(
    process.cwd(),
    "implementation/test/support/fake-codex-app-server.mjs"
  );
  const commandParts = [
    "node",
    JSON.stringify(scriptPath),
    "--spawn-log",
    JSON.stringify(spawnLogPath)
  ];
  if (options.exitAfter) {
    commandParts.push("--exit-after", JSON.stringify(options.exitAfter));
  }
  if (options.exitBeforeResponse) {
    commandParts.push(
      "--exit-before-response",
      JSON.stringify(options.exitBeforeResponse)
    );
  }
  if (options.noResponseOnce) {
    commandParts.push("--no-response-once", JSON.stringify(options.noResponseOnce));
  }

  const client = newCodexClientWithOptions(
    commandParts.join(" "),
    process.cwd(),
    null,
    createNoopLogger(),
    {
      ...(options.idleCloseMs === undefined
        ? {}
        : { idleCloseMs: options.idleCloseMs }),
      ...(options.initializeTimeoutMs === undefined
        ? {}
        : { initializeTimeoutMs: options.initializeTimeoutMs })
    }
  );

  return {
    client,
    close: async () => {
      await client.close();
      rmSync(workspace, { recursive: true, force: true });
    },
    countLogLines: (prefix) => countLogLines(spawnLogPath, prefix),
    waitForLogLines: (prefix, count) =>
      waitFor(() => countLogLines(spawnLogPath, prefix) >= count)
  };
}

function newCodexClientWithOptions(...args: unknown[]): CodexAppServerClient {
  const Constructor = CodexAppServerClient as unknown as new (
    ...values: unknown[]
  ) => CodexAppServerClient;
  return new Constructor(...args);
}

function countLogLines(path: string, prefix: string): number {
  if (!existsSync(path)) {
    return 0;
  }

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix)).length;
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function rejectOrTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return await Promise.race([
    promise,
    sleep(timeoutMs).then(() => {
      throw new Error(`timed out waiting ${timeoutMs}ms for promise to settle`);
    })
  ]);
}

function blockEventLoop(ms: number): void {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // Keep the parent process from observing the child exit event immediately.
  }
}

function buildSpawnFailureProbeScript(): string {
  return `
    import { CodexAppServerClient } from "./implementation/src/codex/app-server-client.ts";

    const logger = {
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {}
    };
    const client = new CodexAppServerClient(
      "__vrc_ai_bot_missing_codex_app_server__",
      process.cwd(),
      null,
      logger,
      { idleCloseMs: null }
    );

    try {
      await client.startThread("read-only");
      console.error("unexpected start success");
      process.exit(1);
    } catch (error) {
      console.log("lazy-start-rejected", error instanceof Error ? error.message : String(error));
      await client.close();
      process.exit(0);
    }
  `;
}

function createNoopLogger(): never {
  return {
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {}
  } as never;
}
