import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../src/config/load-config.js";

test("loadConfig reads env and watch locations", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-config-"));
  try {
    const watchPath = join(tempDir, "watch-locations.json");
    writeFileSync(
      watchPath,
      JSON.stringify(
        {
          locations: [
            {
              guildId: "g1",
              channelId: "c1",
              mode: "chat",
              defaultScope: "channel_family"
            }
          ]
        },
        null,
        2
      )
    );

    const previousEnv = { ...process.env };
    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_APPLICATION_ID = "app-id";
    process.env.DISCORD_OWNER_USER_IDS = "u1,u2";
    process.env.BOT_DB_PATH = "./bot.sqlite";
    process.env.BOT_LOG_LEVEL = "info";
    process.env.CODEX_APP_SERVER_CMD = "codex app-server";
    process.env.CODEX_HOME = "./.codex-runtime";
    process.env.BOT_WATCH_LOCATIONS_PATH = "./watch-locations.json";

    const config = loadConfig(tempDir);

    assert.equal(config.discordBotToken, "token");
    assert.deepEqual(config.discordOwnerUserIds, ["u1", "u2"]);
    assert.equal(config.codexHomePath, join(tempDir, ".codex-runtime"));
    assert.equal(config.watchLocations[0]?.channelId, "c1");

    process.env = previousEnv;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig rejects duplicate watch locations", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-config-"));
  try {
    const watchPath = join(tempDir, "watch-locations.json");
    writeFileSync(
      watchPath,
      JSON.stringify(
        {
          locations: [
            {
              guildId: "g1",
              channelId: "c1",
              mode: "chat",
              defaultScope: "channel_family"
            },
            {
              guildId: "g1",
              channelId: "c1",
              mode: "url_watch",
              defaultScope: "server_public"
            }
          ]
        },
        null,
        2
      )
    );

    const previousEnv = { ...process.env };
    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_APPLICATION_ID = "app-id";
    process.env.DISCORD_OWNER_USER_IDS = "u1";
    process.env.BOT_DB_PATH = "./bot.sqlite";
    process.env.BOT_LOG_LEVEL = "info";
    process.env.CODEX_APP_SERVER_CMD = "codex app-server";
    delete process.env.CODEX_HOME;
    process.env.BOT_WATCH_LOCATIONS_PATH = "./watch-locations.json";

    assert.throws(() => loadConfig(tempDir), /Duplicate watch location/);
    process.env = previousEnv;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
