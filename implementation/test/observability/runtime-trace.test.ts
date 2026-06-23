import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendRuntimeTrace,
  getRuntimeTracePath
} from "../../src/observability/runtime-trace.js";

test("runtime trace writes under BOT_RUNTIME_TRACE_DIR when configured", () => {
  const workspace = createWorkspace();
  const traceDir = join(workspace, "traces");
  try {
    withTraceEnv({ BOT_RUNTIME_TRACE_DIR: traceDir }, () => {
      appendRuntimeTrace("codex-app-server", "configured_dir", { ok: true }, workspace);

      const path = getRuntimeTracePath("codex-app-server", workspace);
      assert.equal(path, join(traceDir, "codex-app-server.ndjson"));
      assert.equal(existsSync(path), true);
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime trace disable flag prevents filesystem writes", () => {
  const workspace = createWorkspace();
  const traceDir = join(workspace, "traces");
  try {
    withTraceEnv(
      {
        BOT_RUNTIME_TRACE_DIR: traceDir,
        BOT_RUNTIME_TRACE_DISABLE: "1"
      },
      () => {
        appendRuntimeTrace("codex-app-server", "disabled", { ok: true }, workspace);

        assert.equal(existsSync(traceDir), false);
        assert.equal(
          existsSync(getRuntimeTracePath("codex-app-server", workspace)),
          false
        );
      }
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime trace max bytes bounds the trace file size", () => {
  const workspace = createWorkspace();
  const traceDir = join(workspace, "traces");
  try {
    withTraceEnv(
      {
        BOT_RUNTIME_TRACE_DIR: traceDir,
        BOT_RUNTIME_TRACE_MAX_BYTES: "220"
      },
      () => {
        for (let index = 0; index < 10; index += 1) {
          appendRuntimeTrace(
            "codex-app-server",
            "bounded",
            { index, text: "x".repeat(80) },
            workspace
          );
        }

        const path = getRuntimeTracePath("codex-app-server", workspace);
        assert.ok(statSync(path).size <= 220);
        const contents = readFileSync(path, "utf8");
        assert.match(contents, /bounded/);
        assertTraceFileIsParseableNdjson(contents);
      }
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime trace max bytes smaller than one entry never writes a JSON fragment", () => {
  const workspace = createWorkspace();
  const traceDir = join(workspace, "traces");
  try {
    withTraceEnv(
      {
        BOT_RUNTIME_TRACE_DIR: traceDir,
        BOT_RUNTIME_TRACE_MAX_BYTES: "32"
      },
      () => {
        appendRuntimeTrace(
          "codex-app-server",
          "oversized_entry",
          { text: "x".repeat(120) },
          workspace
        );

        const path = getRuntimeTracePath("codex-app-server", workspace);
        if (!existsSync(path)) {
          return;
        }

        const contents = readFileSync(path, "utf8");
        assert.ok(statSync(path).size <= 32);
        assertTraceFileIsParseableNdjson(contents);
      }
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime trace retention days removes trace entries older than the configured window", () => {
  const workspace = createWorkspace();
  const traceDir = join(workspace, "traces");
  try {
    withTraceEnv(
      {
        BOT_RUNTIME_TRACE_DIR: traceDir,
        BOT_RUNTIME_TRACE_RETENTION_DAYS: "7"
      },
      () => {
        mkdirSync(traceDir, { recursive: true });
        const path = getRuntimeTracePath("codex-app-server", workspace);
        const oldTimestamp = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        const recentTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        writeFileSync(
          path,
          [
            JSON.stringify({
              timestamp: oldTimestamp,
              event: "too_old",
              payload: { marker: "drop-me" }
            }),
            JSON.stringify({
              timestamp: recentTimestamp,
              event: "recent",
              payload: { marker: "keep-me" }
            })
          ].join("\n") + "\n",
          "utf8"
        );

        appendRuntimeTrace("codex-app-server", "after_retention", { ok: true }, workspace);

        const contents = readFileSync(path, "utf8");
        assert.doesNotMatch(contents, /drop-me/);
        assert.match(contents, /keep-me/);
        assert.match(contents, /after_retention/);
        assertTraceFileIsParseableNdjson(contents);
      }
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime trace retention prunes on the first append for a trace path", () => {
  const workspace = createWorkspace();
  const traceDir = join(workspace, "traces");
  try {
    withTraceEnv(
      {
        BOT_RUNTIME_TRACE_DIR: traceDir,
        BOT_RUNTIME_TRACE_RETENTION_DAYS: "7"
      },
      () => {
        mkdirSync(traceDir, { recursive: true });
        const path = getRuntimeTracePath("codex-app-server", workspace);
        writeTraceLines(path, [
          {
            timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            event: "too_old",
            payload: { marker: "drop-on-first-append" }
          }
        ]);

        appendRuntimeTrace("codex-app-server", "first_retention_append", {}, workspace);

        const contents = readFileSync(path, "utf8");
        assert.doesNotMatch(contents, /drop-on-first-append/);
        assert.match(contents, /first_retention_append/);
        assertTraceFileIsParseableNdjson(contents);
      }
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime trace retention does not full-scan again inside the prune interval", () => {
  const workspace = createWorkspace();
  const traceDir = join(workspace, "traces");
  try {
    withTraceEnv(
      {
        BOT_RUNTIME_TRACE_DIR: traceDir,
        BOT_RUNTIME_TRACE_RETENTION_DAYS: "7"
      },
      () => {
        mkdirSync(traceDir, { recursive: true });
        const path = getRuntimeTracePath("codex-app-server", workspace);
        writeTraceLines(path, [
          {
            timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            event: "too_old",
            payload: { marker: "drop-on-first-append" }
          }
        ]);

        appendRuntimeTrace("codex-app-server", "first_retention_append", {}, workspace);
        appendFileWithOldTraceLine(path, "temporarily-kept-inside-prune-interval");
        appendRuntimeTrace("codex-app-server", "second_retention_append", {}, workspace);

        const contents = readFileSync(path, "utf8");
        assert.match(
          contents,
          /temporarily-kept-inside-prune-interval/,
          "retention pruning should be interval-gated instead of full-scanning on every append"
        );
        assert.match(contents, /second_retention_append/);
        assertTraceFileIsParseableNdjson(contents);
      }
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime trace max-byte trim still bounds files while retention pruning is interval-gated", () => {
  const workspace = createWorkspace();
  const traceDir = join(workspace, "traces");
  try {
    withTraceEnv(
      {
        BOT_RUNTIME_TRACE_DIR: traceDir,
        BOT_RUNTIME_TRACE_RETENTION_DAYS: "7",
        BOT_RUNTIME_TRACE_MAX_BYTES: "360"
      },
      () => {
        mkdirSync(traceDir, { recursive: true });
        const path = getRuntimeTracePath("codex-app-server", workspace);

        appendRuntimeTrace("codex-app-server", "first_retention_append", {}, workspace);
        appendFileWithOldTraceLine(path, "old-line-may-wait-for-retention");
        for (let index = 0; index < 6; index += 1) {
          appendRuntimeTrace(
            "codex-app-server",
            "trim_after_retention_skip",
            { index, text: "x".repeat(80) },
            workspace
          );
        }

        const contents = readFileSync(path, "utf8");
        assert.ok(statSync(path).size <= 360);
        assert.match(contents, /trim_after_retention_skip/);
        assertTraceFileIsParseableNdjson(contents);
      }
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createWorkspace(): string {
  const workspace = join(
    tmpdir(),
    `vrc-ai-bot-runtime-trace-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function withTraceEnv(
  env: Record<string, string>,
  callback: () => void
): void {
  const previous = { ...process.env };
  try {
    delete process.env.BOT_RUNTIME_TRACE_DIR;
    delete process.env.BOT_RUNTIME_TRACE_DISABLE;
    delete process.env.BOT_RUNTIME_TRACE_MAX_BYTES;
    delete process.env.BOT_RUNTIME_TRACE_RETENTION_DAYS;
    Object.assign(process.env, env);
    callback();
  } finally {
    process.env = previous;
  }
}

function writeTraceLines(path: string, entries: unknown[]): void {
  writeFileSync(
    path,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8"
  );
}

function appendFileWithOldTraceLine(path: string, marker: string): void {
  appendFileSync(
    path,
    `${JSON.stringify({
      timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      event: "too_old",
      payload: { marker }
    })}\n`,
    "utf8"
  );
}

function assertTraceFileIsParseableNdjson(contents: string): void {
  const lines = contents.split("\n").filter((line) => line.length > 0);
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line), `trace line must be valid JSON: ${line}`);
  }
}
