import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../src/config/load-config.js";

test("loadConfig reads env and watch locations", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-config-"));
  const previousEnv = { ...process.env };
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

  } finally {
    process.env = previousEnv;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig rejects duplicate watch locations", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-config-"));
  const previousEnv = { ...process.env };
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

    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_APPLICATION_ID = "app-id";
    process.env.DISCORD_OWNER_USER_IDS = "u1";
    process.env.BOT_DB_PATH = "./bot.sqlite";
    process.env.BOT_LOG_LEVEL = "info";
    process.env.CODEX_APP_SERVER_CMD = "codex app-server";
    delete process.env.CODEX_HOME;
    process.env.BOT_WATCH_LOCATIONS_PATH = "./watch-locations.json";

    assert.throws(() => loadConfig(tempDir), /Duplicate watch location/);
  } finally {
    process.env = previousEnv;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig reads optional chat runtime controls", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-config-"));
  const previousEnv = { ...process.env };
  try {
    const watchPath = join(tempDir, "watch-locations.json");
    const controlsPath = join(tempDir, "chat-controls.json");
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
              channelId: "c2",
              mode: "admin_control",
              defaultScope: "server_public"
            }
          ]
        },
        null,
        2
      )
    );
    writeFileSync(
      controlsPath,
      JSON.stringify(
        {
          enabled: true,
          enabledChannelIds: ["c1"]
        },
        null,
        2
      )
    );

    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_APPLICATION_ID = "app-id";
    process.env.DISCORD_OWNER_USER_IDS = "u1";
    process.env.BOT_DB_PATH = "./bot.sqlite";
    process.env.BOT_LOG_LEVEL = "info";
    process.env.CODEX_APP_SERVER_CMD = "codex app-server";
    delete process.env.CODEX_HOME;
    process.env.BOT_WATCH_LOCATIONS_PATH = "./watch-locations.json";
    process.env.BOT_CHAT_RUNTIME_CONTROLS_PATH = "./chat-controls.json";

    const config = loadConfig(tempDir);

    assert.deepEqual(config.chatRuntimeControls, {
      enabled: true,
      enabledChannelIds: ["c1"]
    });
  } finally {
    process.env = previousEnv;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig reads default weekly meetup announcement config when present", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-config-"));
  const previousEnv = { ...process.env };
  try {
    const watchPath = join(tempDir, "watch-locations.json");
    const configDir = join(tempDir, "config");
    const weeklyPath = join(configDir, "weekly-meetup-announcement.json");
    const templatePath = join(configDir, "weekly-meetup-embed.template.json");
    mkdirSync(configDir, { recursive: true });

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
    writeFileSync(
      templatePath,
      JSON.stringify(
        {
          title: "AI集会のお知らせ"
        },
        null,
        2
      )
    );
    writeFileSync(
      weeklyPath,
      JSON.stringify(
        {
          guildId: "g1",
          channelId: "announce-1",
          timezone: "Asia/Tokyo",
          announceWeekday: "monday",
          announceTime: "18:00",
          eventTime: "21:00",
          firstEventDate: "2025-09-01",
          skipDates: [],
          embedTemplatePath: "./weekly-meetup-embed.template.json"
        },
        null,
        2
      )
    );

    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_APPLICATION_ID = "app-id";
    process.env.DISCORD_OWNER_USER_IDS = "u1";
    process.env.BOT_DB_PATH = "./bot.sqlite";
    process.env.BOT_LOG_LEVEL = "info";
    process.env.CODEX_APP_SERVER_CMD = "codex app-server";
    delete process.env.CODEX_HOME;
    process.env.BOT_WATCH_LOCATIONS_PATH = "./watch-locations.json";
    delete process.env.BOT_CHAT_RUNTIME_CONTROLS_PATH;
    delete process.env.BOT_WEEKLY_MEETUP_ANNOUNCEMENT_PATH;

    const config = loadConfig(tempDir);

    assert.deepEqual(config.weeklyMeetupAnnouncement, {
      guildId: "g1",
      channelId: "announce-1",
      timezone: "Asia/Tokyo",
      announceWeekday: "monday",
      announceTime: "18:00",
      eventTime: "21:00",
      firstEventDate: "2025-09-01",
      skipDates: [],
      embedTemplatePath: join(configDir, "weekly-meetup-embed.template.json")
    });
  } finally {
    process.env = previousEnv;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig rejects weekly meetup dates that are not Monday or are duplicated", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-config-"));
  const previousEnv = { ...process.env };
  try {
    const watchPath = join(tempDir, "watch-locations.json");
    const configDir = join(tempDir, "config");
    const weeklyPath = join(configDir, "weekly-meetup-announcement.json");
    const templatePath = join(configDir, "weekly-meetup-embed.template.json");
    mkdirSync(configDir, { recursive: true });

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
    writeFileSync(templatePath, JSON.stringify({ title: "AI集会" }, null, 2));
    writeFileSync(
      weeklyPath,
      JSON.stringify(
        {
          guildId: "g1",
          channelId: "announce-1",
          timezone: "Asia/Tokyo",
          announceWeekday: "monday",
          announceTime: "18:00",
          eventTime: "21:00",
          firstEventDate: "2025-09-02",
          skipDates: ["2025-09-08", "2025-09-08"],
          embedTemplatePath: "./weekly-meetup-embed.template.json"
        },
        null,
        2
      )
    );

    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_APPLICATION_ID = "app-id";
    process.env.DISCORD_OWNER_USER_IDS = "u1";
    process.env.BOT_DB_PATH = "./bot.sqlite";
    process.env.BOT_LOG_LEVEL = "info";
    process.env.CODEX_APP_SERVER_CMD = "codex app-server";
    delete process.env.CODEX_HOME;
    process.env.BOT_WATCH_LOCATIONS_PATH = "./watch-locations.json";
    delete process.env.BOT_CHAT_RUNTIME_CONTROLS_PATH;
    delete process.env.BOT_WEEKLY_MEETUP_ANNOUNCEMENT_PATH;

    assert.throws(() => loadConfig(tempDir), /Monday date|Duplicate skipDates entry/);
  } finally {
    process.env = previousEnv;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig rejects unknown chat runtime control channel ids", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-config-"));
  const previousEnv = { ...process.env };
  try {
    const watchPath = join(tempDir, "watch-locations.json");
    const controlsPath = join(tempDir, "chat-controls.json");
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
    writeFileSync(
      controlsPath,
      JSON.stringify(
        {
          enabled: true,
          enabledChannelIds: ["unknown"]
        },
        null,
        2
      )
    );

    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_APPLICATION_ID = "app-id";
    process.env.DISCORD_OWNER_USER_IDS = "u1";
    process.env.BOT_DB_PATH = "./bot.sqlite";
    process.env.BOT_LOG_LEVEL = "info";
    process.env.CODEX_APP_SERVER_CMD = "codex app-server";
    delete process.env.CODEX_HOME;
    process.env.BOT_WATCH_LOCATIONS_PATH = "./watch-locations.json";
    process.env.BOT_CHAT_RUNTIME_CONTROLS_PATH = "./chat-controls.json";

    assert.throws(
      () => loadConfig(tempDir),
      /unknown or non-chat channel id/
    );
  } finally {
    process.env = previousEnv;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
