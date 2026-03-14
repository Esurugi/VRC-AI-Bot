import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import {
  SCOPE_VALUES,
  WATCH_MODE_VALUES,
  type AppConfig,
  type ChatRuntimeControlsConfig,
  type WeeklyMeetupAnnouncementConfig,
  type WatchLocationConfig
} from "../domain/types.js";

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_OWNER_USER_IDS: z.string().min(1),
  BOT_DB_PATH: z.string().min(1),
  BOT_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]),
  CODEX_APP_SERVER_CMD: z.string().min(1).default("codex app-server"),
  CODEX_HOME: z.string().min(1).optional(),
  BOT_WATCH_LOCATIONS_PATH: z.string().min(1).default("./config/watch-locations.json"),
  BOT_CHAT_RUNTIME_CONTROLS_PATH: z.string().min(1).optional(),
  BOT_WEEKLY_MEETUP_ANNOUNCEMENT_PATH: z.string().min(1).optional()
});

const watchLocationSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  mode: z.enum(WATCH_MODE_VALUES),
  defaultScope: z.enum(SCOPE_VALUES)
});

const watchLocationFileSchema = z.object({
  locations: z.array(watchLocationSchema)
});

const weeklyMeetupAnnouncementSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  timezone: z.literal("Asia/Tokyo"),
  announceWeekday: z.literal("monday"),
  announceTime: z.literal("18:00"),
  eventTime: z.literal("21:00"),
  firstEventDate: z.string().min(1),
  skipDates: z.array(z.string().min(1)).default([]),
  embedTemplatePath: z.string().min(1)
}).superRefine((value, ctx) => {
  validateWeeklyMeetupDate(value.firstEventDate, ctx, ["firstEventDate"]);

  const seen = new Set<string>();
  for (const [index, date] of value.skipDates.entries()) {
    validateWeeklyMeetupDate(date, ctx, ["skipDates", index]);
    if (seen.has(date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["skipDates", index],
        message: `Duplicate skipDates entry: ${date}`
      });
      continue;
    }
    seen.add(date);

    if (date < value.firstEventDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["skipDates", index],
        message: `skipDates entry must be on or after firstEventDate: ${date}`
      });
    }
  }
});

const chatRuntimeControlsSchema = z.object({
  enabled: z.boolean(),
  enabledChannelIds: z.array(z.string().min(1))
});

const DEFAULT_WEEKLY_MEETUP_ANNOUNCEMENT_PATH =
  "./config/weekly-meetup-announcement.json";

export function loadConfig(cwd = process.cwd()): AppConfig {
  const env = envSchema.parse(process.env);
  const watchLocationPath = resolve(cwd, env.BOT_WATCH_LOCATIONS_PATH);
  const watchLocations = readWatchLocations(watchLocationPath);
  const chatRuntimeControls = readChatRuntimeControls(
    cwd,
    env.BOT_CHAT_RUNTIME_CONTROLS_PATH,
    watchLocations
  );
  const weeklyMeetupAnnouncement = readWeeklyMeetupAnnouncement(
    cwd,
    env.BOT_WEEKLY_MEETUP_ANNOUNCEMENT_PATH
  );

  return {
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordApplicationId: env.DISCORD_APPLICATION_ID,
    discordOwnerUserIds: env.DISCORD_OWNER_USER_IDS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    botDbPath: resolve(cwd, env.BOT_DB_PATH),
    botLogLevel: env.BOT_LOG_LEVEL,
    codexAppServerCommand: env.CODEX_APP_SERVER_CMD,
    codexHomePath: env.CODEX_HOME ? resolve(cwd, env.CODEX_HOME) : null,
    watchLocations,
    chatRuntimeControls,
    weeklyMeetupAnnouncement
  };
}

function readWatchLocations(path: string): WatchLocationConfig[] {
  const parsed = watchLocationFileSchema.parse(
    JSON.parse(readFileSync(path, "utf8"))
  );
  const seen = new Set<string>();

  for (const location of parsed.locations) {
    const key = `${location.guildId}:${location.channelId}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate watch location: ${key}`);
    }
    seen.add(key);
  }

  return parsed.locations;
}

function readWeeklyMeetupAnnouncement(
  cwd: string,
  configPath: string | undefined
): WeeklyMeetupAnnouncementConfig | null {
  const resolvedPath = resolve(
    cwd,
    configPath ?? DEFAULT_WEEKLY_MEETUP_ANNOUNCEMENT_PATH
  );
  if (!configPath && !existsSync(resolvedPath)) {
    return null;
  }

  const parsed = weeklyMeetupAnnouncementSchema.parse(
    JSON.parse(readFileSync(resolvedPath, "utf8"))
  );

  return {
    ...parsed,
    embedTemplatePath: resolve(dirname(resolvedPath), parsed.embedTemplatePath)
  };
}

function readChatRuntimeControls(
  cwd: string,
  configPath: string | undefined,
  watchLocations: WatchLocationConfig[]
): ChatRuntimeControlsConfig | null {
  if (!configPath) {
    return null;
  }

  const resolvedPath = resolve(cwd, configPath);
  const parsed = chatRuntimeControlsSchema.parse(
    JSON.parse(readFileSync(resolvedPath, "utf8"))
  );
  const allowedRootChannelIds = new Set(
    watchLocations
      .filter((location) => location.mode === "chat")
      .map((location) => location.channelId)
  );

  for (const channelId of parsed.enabledChannelIds) {
    if (!allowedRootChannelIds.has(channelId)) {
      throw new Error(
        `BOT_CHAT_RUNTIME_CONTROLS_PATH contains unknown or non-chat channel id: ${channelId}`
      );
    }
  }

  return parsed;
}

function validateWeeklyMeetupDate(
  value: string,
  ctx: z.RefinementCtx,
  path: Array<string | number>
): void {
  if (!isIsoDateString(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `Expected ISO date (YYYY-MM-DD): ${value}`
    });
    return;
  }

  if (!isMondayIsoDate(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `Expected Monday date for weekly meetup schedule: ${value}`
    });
  }
}

function isIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = parseIsoDate(value);
  return formatIsoDate(parsed) === value;
}

function isMondayIsoDate(value: string): boolean {
  return parseIsoDate(value).getUTCDay() === 1;
}

function parseIsoDate(value: string): Date {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
