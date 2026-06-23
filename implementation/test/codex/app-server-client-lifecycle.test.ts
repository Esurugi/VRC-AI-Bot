import assert from "node:assert/strict";
import { spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  CodexAppServerClient,
  __testOnly
} from "../../src/codex/app-server-client.js";

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

test("COD.01 stdin write failure terminates the still-running app-server child", async () => {
  const harness = createFakeCodexHarness({
    holdOpen: true
  });
  try {
    await harness.client.startThread("read-only");
    const oldPid = harness.readProcessLog().spawns[0];
    assert.ok(oldPid);
    readClientProcess(harness.client).stdin.end();
    await waitFor(() => !readClientProcess(harness.client).stdin.writable);

    const nextThreadId = await harness.client.startThread("read-only");

    await waitFor(() => !isProcessAlive(oldPid));
    const log = harness.readProcessLog();
    assert.match(nextThreadId, /^fake-thread-/);
    assert.equal(log.spawns.length, 2);
    if (process.platform !== "win32") {
      assert.deepEqual(log.sigterms, [oldPid]);
    }
  } finally {
    await harness.close();
  }
});

test("COD.01 next request after write failure respawns without leaving the old child alive", async () => {
  const harness = createFakeCodexHarness({
    holdOpen: true
  });
  try {
    await harness.client.startThread("read-only");
    const oldPid = harness.readProcessLog().spawns[0];
    assert.ok(oldPid);
    readClientProcess(harness.client).stdin.end();
    await waitFor(() => !readClientProcess(harness.client).stdin.writable);

    const nextThreadId = await harness.client.startThread("read-only");
    await waitFor(() => !isProcessAlive(oldPid));
    const stableThreadId = await harness.client.startThread("read-only");
    const log = harness.readProcessLog();

    assert.match(nextThreadId, /^fake-thread-/);
    assert.match(stableThreadId, /^fake-thread-/);
    assert.equal(log.spawns.length, 2);
    if (process.platform !== "win32") {
      assert.equal(log.sigterms.length, 1);
      assert.equal(log.sigterms[0], oldPid);
    }
    assert.notEqual(log.spawns[1], log.spawns[0]);
    assert.equal(isProcessAlive(oldPid), false);
  } finally {
    await harness.close();
  }
});

test("namespace sandbox probe cache does not re-probe the same command cwd and CODEX_HOME", () => {
  const cache = __testOnly.createNamespaceSandboxProbeCache();
  const calls: Array<{
    appServerCommand: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
  }> = [];
  const probe = (input: {
    appServerCommand: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
  }) => {
    calls.push(input);
    return {
      status: "supported_or_unknown" as const,
      namespaceSandboxUnsupported: false,
      command: "codex",
      args: ["sandbox", "linux", "--full-auto", "true"]
    };
  };
  const input = {
    appServerCommand: "codex app-server",
    cwd: "/repo",
    env: {
      CODEX_HOME: "/data/codex-home/.codex",
      PATH: "/usr/bin"
    } as NodeJS.ProcessEnv
  };

  assert.equal(cache.probe(input, probe).status, "supported_or_unknown");
  assert.equal(
    cache.probe(
      {
        ...input,
        env: {
          CODEX_HOME: "/data/codex-home/.codex",
          PATH: "/different/path"
        } as NodeJS.ProcessEnv
      },
      probe
    ).status,
    "supported_or_unknown"
  );
  assert.equal(calls.length, 1);

  cache.probe(
    {
      ...input,
      env: {
        CODEX_HOME: "/other/codex-home/.codex",
        PATH: "/usr/bin"
      } as NodeJS.ProcessEnv
    },
    probe
  );

  assert.equal(calls.length, 2);
});

test("COD.01 win32 npm command invocation does not shellless-spawn the npm cmd shim directly", () => {
  const invocation = __testOnly.buildCodexAppServerInvocation(
    "npm run codex:app-server",
    {
      platform: "win32",
      env: {
        ComSpec: "C:\\Windows\\System32\\cmd.exe"
      } as NodeJS.ProcessEnv
    }
  );

  assert.match(invocation.command, /(?:^|[\\/])cmd(?:\.exe)?$/i);
  assert.deepEqual(invocation.args.slice(0, 4), [
    "/d",
    "/s",
    "/c",
    "npm"
  ]);
  assert.deepEqual(invocation.args.slice(4), ["run", "codex:app-server"]);
  assert.equal(invocation.shell ?? false, false);
});

type HarnessOptions = {
  exitAfter?: string;
  exitBeforeResponse?: string;
  closeStdinAfterResponseOnce?: string;
  holdOpen?: boolean;
  idleCloseMs?: number;
  initializeTimeoutMs?: number;
  noResponseOnce?: string;
};

function createFakeCodexHarness(options: HarnessOptions = {}): {
  client: CodexAppServerClient;
  close: () => Promise<void>;
  countLogLines: (prefix: string) => number;
  readProcessLog: () => { spawns: number[]; sigterms: number[] };
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
  if (options.closeStdinAfterResponseOnce) {
    commandParts.push(
      "--close-stdin-after-response-once",
      JSON.stringify(options.closeStdinAfterResponseOnce)
    );
  }
  if (options.holdOpen) {
    commandParts.push("--hold-open");
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
      for (const pid of readProcessLog(spawnLogPath).spawns) {
        forceKillProcess(pid);
      }
      rmSync(workspace, { recursive: true, force: true });
    },
    countLogLines: (prefix) => countLogLines(spawnLogPath, prefix),
    readProcessLog: () => readProcessLog(spawnLogPath),
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

function readClientProcess(
  client: CodexAppServerClient
): ChildProcessWithoutNullStreams {
  const child = (client as unknown as {
    process: ChildProcessWithoutNullStreams | null;
  }).process;
  assert.ok(child);
  return child;
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

function readProcessLog(path: string): { spawns: number[]; sigterms: number[] } {
  if (!existsSync(path)) {
    return {
      spawns: [],
      sigterms: []
    };
  }

  const spawns: number[] = [];
  const sigterms: number[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^(spawn|sigterm) (\d+)$/.exec(line);
    if (!match) {
      continue;
    }
    const pid = Number(match[2]);
    if (match[1] === "spawn") {
      spawns.push(pid);
    } else {
      sigterms.push(pid);
    }
  }
  return { spawns, sigterms };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKillProcess(pid: number): void {
  if (!isProcessAlive(pid)) {
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Best-effort test cleanup.
  }

  if (process.platform === "win32" && isProcessAlive(pid)) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true
    });
  }
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
