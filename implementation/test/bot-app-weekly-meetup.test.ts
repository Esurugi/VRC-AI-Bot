import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import pino from "pino";

import { BotApplication } from "../src/app/bot-app.js";
import type { AppConfig } from "../src/domain/types.js";
import { resolveNextWeeklyMeetupAnnouncementAt } from "../src/runtime/scheduling/weekly-meetup-announcement-service.js";

test("BotApplication schedules weekly meetup as a one-shot timer toward the next Monday 18:00 JST", () => {
  const scheduled: number[] = [];
  const app = createTestApplication({
    setTimeoutFn: (((handler: () => void, delay?: number) => {
      void handler;
      scheduled.push(delay ?? 0);
      return { id: `timer-${scheduled.length}` } as never;
    }) as unknown) as typeof setTimeout
  });

  const now = new Date("2026-03-16T08:59:00.000Z");
  (app as any).scheduleNextWeeklyMeetupAnnouncement(now);

  const expectedDelay =
    resolveNextWeeklyMeetupAnnouncementAt(now).getTime() - now.getTime();

  assert.deepEqual(scheduled, [expectedDelay]);

  (app as any).store.close();
  cleanupApp(app);
});

test("BotApplication reschedules weekly meetup for the following week after a scheduled send attempt", async () => {
  const pollCalls: string[] = [];
  const scheduled: number[] = [];
  const app = createTestApplication({
    weeklyMeetupAnnouncementService: {
      async poll(now: Date) {
        pollCalls.push(now.toISOString());
      }
    } as never,
    setTimeoutFn: (((handler: () => void, delay?: number) => {
      void handler;
      scheduled.push(delay ?? 0);
      return { id: `timer-${scheduled.length}` } as never;
    }) as unknown) as typeof setTimeout,
    clearTimeoutFn: (() => undefined) as typeof clearTimeout
  });

  const scheduledAt = new Date("2026-03-16T09:30:00.000Z");
  (app as any).started = true;
  await (app as any).runScheduledWeeklyMeetupAnnouncement(scheduledAt);

  assert.deepEqual(pollCalls, ["2026-03-16T09:30:00.000Z"]);
  assert.equal(scheduled.length, 1);
  assert.equal(
    scheduled[0],
    resolveNextWeeklyMeetupAnnouncementAt(scheduledAt).getTime() - scheduledAt.getTime()
  );

  (app as any).store.close();
  cleanupApp(app);
});

function createTestApplication(overrides?: {
  weeklyMeetupAnnouncementService?: {
    poll(now: Date): Promise<void>;
  };
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): BotApplication {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-weekly-botapp-"));
  const config: AppConfig = {
    discordBotToken: "token",
    discordApplicationId: "app-id",
    discordOwnerUserIds: ["owner-1"],
    botDbPath: join(tempDir, "bot.sqlite"),
    botLogLevel: "fatal",
    codexAppServerCommand: "codex app-server",
    codexHomePath: null,
    watchLocations: [
      {
        guildId: "guild-1",
        channelId: "chat-1",
        mode: "chat",
        defaultScope: "server_public"
      },
      {
        guildId: "guild-1",
        channelId: "admin-1",
        mode: "admin_control",
        defaultScope: "conversation_only"
      }
    ],
    chatRuntimeControls: null,
    weeklyMeetupAnnouncement: {
      guildId: "guild-1",
      channelId: "announce-1",
      timezone: "Asia/Tokyo",
      announceWeekday: "monday",
      announceTime: "18:00",
      eventTime: "21:00",
      embedTemplatePath: join(process.cwd(), "config", "weekly-meetup-embed.template.json")
    }
  };

  const dependencies = {
    logger: pino({ level: "silent" }),
    ...(overrides?.weeklyMeetupAnnouncementService
      ? { weeklyMeetupAnnouncementService: overrides.weeklyMeetupAnnouncementService }
      : {}),
    ...(overrides?.setTimeoutFn ? { setTimeoutFn: overrides.setTimeoutFn } : {}),
    ...(overrides?.clearTimeoutFn ? { clearTimeoutFn: overrides.clearTimeoutFn } : {})
  } as ConstructorParameters<typeof BotApplication>[1];

  const app = new BotApplication(config, dependencies);
  (app as any).__tempDir = tempDir;
  return app;
}

function cleanupApp(app: BotApplication): void {
  const tempDir = (app as any).__tempDir as string | undefined;
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
