import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../../src/config/load-config.js";

test("RES.01.01 uses the development-compatible max concurrency default outside production", () => {
  const workspace = createWorkspace();
  try {
    withEnv(workspace, {}, () => {
      const config = readOracleRuntimeConfig(loadConfig(workspace));

      assert.equal(config.maxConcurrentKeys, 4);
      assert.equal(config.retryPollIntervalMs, 15_000);
      assert.equal(config.codexIdleCloseMs, 1_800_000);
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("RES.01.01 and retry runtime config can be overridden from env", () => {
  const workspace = createWorkspace();
  try {
    withEnv(
      workspace,
      {
        BOT_MAX_CONCURRENT_KEYS: "2",
        BOT_RETRY_POLL_INTERVAL_MS: "30000",
        BOT_CODEX_IDLE_CLOSE_MS: "900000"
      },
      () => {
        const config = readOracleRuntimeConfig(loadConfig(workspace));

        assert.equal(config.maxConcurrentKeys, 2);
        assert.equal(config.retryPollIntervalMs, 30_000);
        assert.equal(config.codexIdleCloseMs, 900_000);
      }
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("RES.01.01 rejects invalid BOT_MAX_CONCURRENT_KEYS instead of falling back", () => {
  const workspace = createWorkspace();
  try {
    for (const value of ["0", "-1", "1.5", "not-a-number"]) {
      withEnv(workspace, { BOT_MAX_CONCURRENT_KEYS: value }, () => {
        assert.throws(
          () => loadConfig(workspace),
          /BOT_MAX_CONCURRENT_KEYS/
        );
      });
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("retry and idle interval env values reject non-positive or non-numeric input", () => {
  const workspace = createWorkspace();
  try {
    withEnv(workspace, { BOT_RETRY_POLL_INTERVAL_MS: "0" }, () => {
      assert.throws(
        () => loadConfig(workspace),
        /BOT_RETRY_POLL_INTERVAL_MS/
      );
    });
    withEnv(workspace, { BOT_CODEX_IDLE_CLOSE_MS: "abc" }, () => {
      assert.throws(
        () => loadConfig(workspace),
        /BOT_CODEX_IDLE_CLOSE_MS/
      );
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("RES.01.01 uses max concurrency 1 for NODE_ENV=production", () => {
  const workspace = createWorkspace();
  try {
    withEnv(workspace, { NODE_ENV: "production" }, () => {
      const config = readOracleRuntimeConfig(loadConfig(workspace));

      assert.equal(config.maxConcurrentKeys, 1);
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("RES.01.01 keeps max concurrency 4 for NODE_ENV=development", () => {
  const workspace = createWorkspace();
  try {
    withEnv(workspace, { NODE_ENV: "development" }, () => {
      const config = readOracleRuntimeConfig(loadConfig(workspace));

      assert.equal(config.maxConcurrentKeys, 4);
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("RES.01.02 reads ambient sparse interval from env", () => {
  const workspace = createWorkspace();
  try {
    withEnv(workspace, { BOT_AMBIENT_SPARSE_INTERVAL: "10" }, () => {
      const config = readOracleRuntimeConfig(loadConfig(workspace));

      assert.equal(config.ambientSparseInterval, 10);
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("RES.01.02 rejects invalid ambient sparse interval values", () => {
  const workspace = createWorkspace();
  try {
    for (const value of ["0", "-1", "1.5", "not-a-number"]) {
      withEnv(workspace, { BOT_AMBIENT_SPARSE_INTERVAL: value }, () => {
        assert.throws(
          () => loadConfig(workspace),
          /BOT_AMBIENT_SPARSE_INTERVAL/
        );
      });
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

type OracleRuntimeConfig = {
  maxConcurrentKeys: number;
  retryPollIntervalMs: number;
  codexIdleCloseMs: number;
  ambientSparseInterval: number;
};

function readOracleRuntimeConfig(config: unknown): OracleRuntimeConfig {
  const record = config as Record<string, unknown>;
  return {
    maxConcurrentKeys: record.maxConcurrentKeys as number,
    retryPollIntervalMs: record.retryPollIntervalMs as number,
    codexIdleCloseMs: record.codexIdleCloseMs as number,
    ambientSparseInterval: record.ambientSparseInterval as number
  };
}

function createWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "vrc-ai-bot-oracle-config-"));
  writeFileSync(
    join(workspace, "watch-locations.json"),
    JSON.stringify({
      locations: [
        {
          guildId: "guild",
          channelId: "chat-root",
          mode: "chat",
          defaultScope: "server_public"
        }
      ]
    }),
    "utf8"
  );
  return workspace;
}

function withEnv(
  workspace: string,
  overrides: Record<string, string>,
  callback: () => void
): void {
  const previous = { ...process.env };
  try {
    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_APPLICATION_ID = "app";
    process.env.DISCORD_OWNER_USER_IDS = "owner";
    process.env.BOT_DB_PATH = "bot.sqlite";
    process.env.BOT_LOG_LEVEL = "info";
    process.env.BOT_WATCH_LOCATIONS_PATH = join(workspace, "watch-locations.json");
    delete process.env.CODEX_APP_SERVER_CMD;
    delete process.env.CODEX_HOME;
    delete process.env.BOT_CHAT_RUNTIME_CONTROLS_PATH;
    delete process.env.BOT_WEEKLY_MEETUP_ANNOUNCEMENT_PATH;
    delete process.env.BOT_MAX_CONCURRENT_KEYS;
    delete process.env.BOT_RETRY_POLL_INTERVAL_MS;
    delete process.env.BOT_CODEX_IDLE_CLOSE_MS;
    delete process.env.BOT_AMBIENT_SPARSE_INTERVAL;
    delete process.env.NODE_ENV;
    Object.assign(process.env, overrides);
    callback();
  } finally {
    process.env = previous;
  }
}
