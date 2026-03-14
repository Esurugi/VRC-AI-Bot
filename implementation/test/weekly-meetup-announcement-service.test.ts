import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChannelType, EmbedBuilder } from "discord.js";

import type { AppConfig } from "../src/domain/types.js";
import {
  resolveNextWeeklyMeetupAnnouncementAt,
  WeeklyMeetupAnnouncementService
} from "../src/runtime/scheduling/weekly-meetup-announcement-service.js";
import { SqliteStore } from "../src/storage/database.js";

const REPO_ROOT = process.cwd();

function createConfig(embedTemplatePath: string): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "app-id",
    discordOwnerUserIds: ["owner-1"],
    botDbPath: "./bot.sqlite",
    botLogLevel: "info",
    codexAppServerCommand: "codex app-server",
    codexHomePath: null,
    watchLocations: [],
    chatRuntimeControls: null,
    weeklyMeetupAnnouncement: {
      guildId: "guild-1",
      channelId: "announce-channel-1",
      timezone: "Asia/Tokyo",
      announceWeekday: "monday",
      announceTime: "18:00",
      eventTime: "21:00",
      embedTemplatePath
    }
  };
}

test("WeeklyMeetupAnnouncementService sends once at Monday 18:00 JST and deduplicates by scheduled_delivery", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-weekly-meetup-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const templatePath = join(tempDir, "weekly-meetup.json");
  writeFileSync(
    templatePath,
    JSON.stringify({
      title: "AI集会のお知らせ",
      description: "毎週月曜 21:00 JST"
    })
  );

  const sentPayloads: unknown[] = [];
  const fakeChannel = {
    id: "announce-channel-1",
    type: ChannelType.GuildText,
    send: async (payload: unknown) => {
      sentPayloads.push(payload);
      return { id: "message-1" };
    }
  };

  let store: SqliteStore | undefined;
  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    const service = new WeeklyMeetupAnnouncementService(
      createConfig(templatePath),
      store,
      undefined,
      {
        fetchChannel: async () => fakeChannel as never
      }
    );

    await service.poll(new Date("2026-03-16T09:00:00.000Z"));
    await service.poll(new Date("2026-03-16T09:05:00.000Z"));

    assert.equal(sentPayloads.length, 1);
    const delivery = store.scheduledDeliveries.get("weekly_meetup", "2026-03-16");
    assert.ok(delivery);
    assert.equal(delivery?.message_id, "message-1");
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("WeeklyMeetupAnnouncementService allows catch-up before 21:00 JST but not at or after 21:00 JST", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-weekly-meetup-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const templatePath = join(tempDir, "weekly-meetup.json");
  writeFileSync(templatePath, JSON.stringify({ title: "AI集会" }));

  const sentAt: string[] = [];
  const fakeChannel = {
    id: "announce-channel-1",
    type: ChannelType.GuildText,
    send: async () => {
      sentAt.push("sent");
      return { id: `message-${sentAt.length}` };
    }
  };

  let store: SqliteStore | undefined;
  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    const service = new WeeklyMeetupAnnouncementService(
      createConfig(templatePath),
      store,
      undefined,
      {
        fetchChannel: async () => fakeChannel as never
      }
    );

    await service.poll(new Date("2026-03-16T11:30:00.000Z"));
    assert.equal(sentAt.length, 1);

    await service.poll(new Date("2026-03-16T12:00:00.000Z"));
    assert.equal(sentAt.length, 1);
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("WeeklyMeetupAnnouncementService sends test announcement without delivery dedupe and appends a TEST footer marker", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-weekly-meetup-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const templatePath = join(tempDir, "weekly-meetup.json");
  writeFileSync(
    templatePath,
    JSON.stringify({
      title: "AI集会のお知らせ",
      footer: {
        text: "LT 登壇〆切は毎週日曜 23:59 JST"
      }
    })
  );

  const sentPayloads: Array<{ embeds: EmbedBuilder[] }> = [];
  const fakeChannel = {
    id: "announce-channel-1",
    type: ChannelType.GuildText,
    send: async (payload: { embeds: EmbedBuilder[] }) => {
      sentPayloads.push(payload);
      return { id: `message-${sentPayloads.length}` };
    }
  };

  let store: SqliteStore | undefined;
  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    const service = new WeeklyMeetupAnnouncementService(
      createConfig(templatePath),
      store,
      undefined,
      {
        fetchChannel: async () => fakeChannel as never
      }
    );

    const first = await service.sendTestAnnouncement(new Date("2026-03-16T09:00:00.000Z"));
    const second = await service.sendTestAnnouncement(new Date("2026-03-16T09:01:00.000Z"));

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(sentPayloads.length, 2);
    assert.equal(store.scheduledDeliveries.get("weekly_meetup", "2026-03-16"), null);

    const embedJson = sentPayloads[0]?.embeds[0]?.toJSON();
    assert.equal(
      embedJson?.footer?.text,
      "LT 登壇〆切は毎週日曜 23:59 JST [TEST]"
    );
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("WeeklyMeetupAnnouncementService sends to GuildAnnouncement without auto publish", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-weekly-meetup-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const templatePath = join(tempDir, "weekly-meetup.json");
  writeFileSync(templatePath, JSON.stringify({ title: "AI集会" }));

  let publishCalled = false;
  let sendCount = 0;
  const fakeChannel = {
    id: "announce-channel-1",
    type: ChannelType.GuildAnnouncement,
    send: async () => {
      sendCount += 1;
      return { id: "message-1" };
    },
    crosspost: async () => {
      publishCalled = true;
    }
  };

  let store: SqliteStore | undefined;
  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    const service = new WeeklyMeetupAnnouncementService(
      createConfig(templatePath),
      store,
      undefined,
      {
        fetchChannel: async () => fakeChannel as never
      }
    );

    await service.poll(new Date("2026-03-16T09:00:00.000Z"));

    assert.equal(sendCount, 1);
    assert.equal(publishCalled, false);
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("WeeklyMeetupAnnouncementService skips invalid channel types and invalid template files", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-weekly-meetup-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const templatePath = join(tempDir, "broken-weekly-meetup.json");
  writeFileSync(templatePath, "{broken json");

  let store: SqliteStore | undefined;
  try {
    store = new SqliteStore(dbPath, REPO_ROOT);
    store.migrate();

    const invalidChannelService = new WeeklyMeetupAnnouncementService(
      createConfig(templatePath),
      store,
      undefined,
      {
        fetchChannel: async () =>
          ({
            id: "voice-1",
            type: ChannelType.GuildVoice
          }) as never
      }
    );

    await invalidChannelService.poll(new Date("2026-03-16T09:00:00.000Z"));
    assert.equal(store.scheduledDeliveries.get("weekly_meetup", "2026-03-16"), null);

    const validChannelBrokenTemplateService = new WeeklyMeetupAnnouncementService(
      createConfig(templatePath),
      store,
      undefined,
      {
        fetchChannel: async () =>
          ({
            id: "announce-channel-1",
            type: ChannelType.GuildText,
            send: async () => ({ id: "message-1" })
          }) as never
      }
    );

    await validChannelBrokenTemplateService.poll(new Date("2026-03-16T09:00:00.000Z"));
    const testSend = await validChannelBrokenTemplateService.sendTestAnnouncement(
      new Date("2026-03-16T09:00:00.000Z")
    );
    assert.equal(testSend.ok, false);
    assert.equal(testSend.reason, "template_read_failed");
    assert.equal(store.scheduledDeliveries.get("weekly_meetup", "2026-03-16"), null);
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveNextWeeklyMeetupAnnouncementAt uses the same Monday before 18:00 JST and next week after 18:00 JST", () => {
  assert.equal(
    resolveNextWeeklyMeetupAnnouncementAt(
      new Date("2026-03-16T08:59:00.000Z")
    ).toISOString(),
    "2026-03-16T09:00:00.000Z"
  );
  assert.equal(
    resolveNextWeeklyMeetupAnnouncementAt(
      new Date("2026-03-16T09:00:00.000Z")
    ).toISOString(),
    "2026-03-23T09:00:00.000Z"
  );
  assert.equal(
    resolveNextWeeklyMeetupAnnouncementAt(
      new Date("2026-03-16T09:30:00.000Z")
    ).toISOString(),
    "2026-03-23T09:00:00.000Z"
  );
});
