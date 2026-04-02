import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { ChannelType } from "discord.js";

import type { AppConfig } from "../../src/domain/types.js";
import {
  WeeklyMeetupAnnouncementService
} from "../../src/runtime/scheduling/weekly-meetup-announcement-service.js";
import { SqliteStore } from "../../src/storage/database.js";

test("weekly meetup announcement sends @everyone on production delivery", async (t) => {
  const { store } = createStore(t);
  const sentPayloads: Array<Record<string, unknown>> = [];
  const service = new WeeklyMeetupAnnouncementService(
    createConfig(),
    store,
    undefined,
    {
      fetchChannel: async () => ({
        id: "announcement-channel",
        type: ChannelType.GuildText,
        send: async (payload: Record<string, unknown>) => {
          sentPayloads.push(payload);
          return { id: "message-1" };
        }
      }) as never,
      readTemplateFile: () => JSON.stringify({ title: "AI meetup" })
    }
  );

  await service.poll(new Date("2026-03-16T09:00:00.000Z"));

  const sentPayload = sentPayloads[0];
  const delivery = store.scheduledDeliveries.get("weekly_meetup", "2026-03-16");

  assert.equal(sentPayloads.length, 1);
  assert.ok(sentPayload);
  assert.equal(sentPayload.content, "@everyone");
  assert.deepEqual(sentPayload.allowedMentions, {
    parse: ["everyone"]
  });
  assert.equal(delivery?.channel_id, "announcement-channel");
});

test("weekly meetup test announcement does not send @everyone", async (t) => {
  const { store } = createStore(t);
  const sentPayloads: Array<Record<string, unknown>> = [];
  const service = new WeeklyMeetupAnnouncementService(
    createConfig(),
    store,
    undefined,
    {
      fetchChannel: async () => ({
        id: "announcement-channel",
        type: ChannelType.GuildText,
        send: async (payload: Record<string, unknown>) => {
          sentPayloads.push(payload);
          return { id: "message-2" };
        }
      }) as never,
      readTemplateFile: () => JSON.stringify({ title: "AI meetup" })
    }
  );

  const result = await service.sendTestAnnouncement(
    new Date("2026-03-16T09:00:00.000Z")
  );

  assert.equal(result.ok, true);
  assert.equal(sentPayloads.length, 1);
  const sentPayload = sentPayloads[0];
  assert.ok(sentPayload);
  assert.equal("content" in sentPayload, false);
  assert.equal("allowedMentions" in sentPayload, false);
});

function createConfig(): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "app-id",
    discordOwnerUserIds: ["owner-id"],
    botDbPath: "unused.sqlite",
    botLogLevel: "info",
    codexAppServerCommand: "codex app-server",
    codexHomePath: null,
    watchLocations: [],
    chatRuntimeControls: null,
    weeklyMeetupAnnouncement: {
      guildId: "guild-id",
      channelId: "announcement-channel",
      timezone: "Asia/Tokyo",
      announceWeekday: "monday",
      announceTime: "18:00",
      eventTime: "21:00",
      firstEventDate: "2025-09-01",
      skipDates: [],
      embedTemplatePath: "./weekly-meetup-embed.template.json"
    }
  };
}

function createStore(t: test.TestContext): { store: SqliteStore; tempDir: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "weekly-meetup-"));
  const store = new SqliteStore(join(tempDir, "bot.sqlite"), process.cwd());
  store.migrate();
  t.after(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
  return { store, tempDir };
}
