import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import {
  CHAT_BEHAVIOR_VALUES,
  PLACE_FEATURE_VALUES,
  SCOPE_VALUES,
  WATCH_MODE_VALUES,
  type AppConfig,
  type ChatRuntimeControlsConfig,
  type PlaceFeatureProfileConfig,
  type WeeklyMeetupAnnouncementConfig,
  type WatchLocationConfig
} from "../domain/types.js";
import {
  hasPlaceFeature,
  inferLegacyWatchModeFromFeatures,
  isConversationPlace,
  normalizePlaceFeatures,
  resolvePlaceChatBehavior,
  resolvePlaceFeatures
} from "../domain/place-features.js";

const PRIMARY_PLACE_FEATURES = [
  "knowledge_ingest",
  "admin_override",
  "forum_research",
  "clear_explanation",
  "question_gateway"
] as const;

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_OWNER_USER_IDS: z.string().min(1),
  BOT_DB_PATH: z.string().min(1),
  BOT_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]),
  NODE_ENV: z.string().optional(),
  CODEX_APP_SERVER_CMD: z.string().min(1).default("codex app-server"),
  CODEX_HOME: z.string().min(1).optional(),
  BOT_WATCH_LOCATIONS_PATH: z.string().min(1).default("./config/watch-locations.json"),
  BOT_CHAT_RUNTIME_CONTROLS_PATH: z.string().min(1).optional(),
  BOT_WEEKLY_MEETUP_ANNOUNCEMENT_PATH: z.string().min(1).optional(),
  BOT_MAX_CONCURRENT_KEYS: positiveIntegerEnv(
    "BOT_MAX_CONCURRENT_KEYS",
    () => (process.env.NODE_ENV === "production" ? 1 : 4)
  ),
  BOT_RETRY_POLL_INTERVAL_MS: positiveIntegerEnv(
    "BOT_RETRY_POLL_INTERVAL_MS",
    15_000
  ),
  BOT_CODEX_IDLE_CLOSE_MS: positiveIntegerEnv(
    "BOT_CODEX_IDLE_CLOSE_MS",
    1_800_000
  ),
  BOT_AMBIENT_SPARSE_INTERVAL: positiveIntegerEnv(
    "BOT_AMBIENT_SPARSE_INTERVAL",
    5
  )
});

const featureProfileSchema = z.object({
  features: z.array(z.enum(PLACE_FEATURE_VALUES)).min(1),
  defaultScope: z.enum(SCOPE_VALUES),
  chatBehavior: z.enum(CHAT_BEHAVIOR_VALUES).nullable().optional()
});

const watchLocationAssignmentSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  featureProfile: z.string().min(1)
});

const legacyWatchLocationSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  mode: z.enum(WATCH_MODE_VALUES),
  defaultScope: z.enum(SCOPE_VALUES),
  features: z.array(z.enum(PLACE_FEATURE_VALUES)).optional(),
  chatBehavior: z.enum(CHAT_BEHAVIOR_VALUES).nullable().optional()
});

const watchLocationFileSchema = z.object({
  featureProfiles: z.record(z.string().min(1), featureProfileSchema).optional(),
  assignments: z.array(watchLocationAssignmentSchema).optional(),
  locations: z.array(legacyWatchLocationSchema).optional()
}).superRefine((value, ctx) => {
  if (!value.assignments?.length && !value.locations?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["locations"],
      message: "Expected at least one assignment or legacy location"
    });
  }
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
    runtime: {
      maxConcurrentKeys: env.BOT_MAX_CONCURRENT_KEYS,
      retryPollIntervalMs: env.BOT_RETRY_POLL_INTERVAL_MS,
      codexIdleCloseMs: env.BOT_CODEX_IDLE_CLOSE_MS,
      ambientSparseInterval: env.BOT_AMBIENT_SPARSE_INTERVAL
    },
    codexAppServerCommand: env.CODEX_APP_SERVER_CMD,
    codexHomePath: env.CODEX_HOME ? resolve(cwd, env.CODEX_HOME) : null,
    watchLocations,
    chatRuntimeControls,
    weeklyMeetupAnnouncement
  };
}

function positiveIntegerEnv(name: string, defaultValue: number | (() => number)) {
  return z
    .preprocess(
      (value) =>
        value === undefined
          ? String(
              typeof defaultValue === "function" ? defaultValue() : defaultValue
            )
          : value,
      z.string().min(1)
    )
    .transform((value, ctx) => {
      if (!/^\d+$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} must be a positive integer`
        });
        return z.NEVER;
      }

      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} must be a positive integer`
        });
        return z.NEVER;
      }

      return parsed;
    });
}

function readWatchLocations(path: string): WatchLocationConfig[] {
  const parsed = watchLocationFileSchema.parse(
    JSON.parse(readFileSync(path, "utf8"))
  );
  const profiles = normalizeFeatureProfiles(parsed.featureProfiles ?? {});
  const watchLocations = [
    ...normalizeAssignedWatchLocations(parsed.assignments ?? [], profiles),
    ...normalizeLegacyWatchLocations(parsed.locations ?? [])
  ];
  const seen = new Set<string>();

  for (const location of watchLocations) {
    const key = `${location.guildId}:${location.channelId}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate watch location: ${key}`);
    }
    seen.add(key);
  }

  return watchLocations;
}

function normalizeFeatureProfiles(
  input: Record<string, z.infer<typeof featureProfileSchema>>
): Map<string, PlaceFeatureProfileConfig> {
  const profiles = new Map<string, PlaceFeatureProfileConfig>();
  for (const [id, profile] of Object.entries(input)) {
    profiles.set(id, {
      id,
      features: normalizeProfileFeatures(profile.features, `feature profile: ${id}`),
      defaultScope: profile.defaultScope,
      ...(profile.chatBehavior !== undefined
        ? { chatBehavior: profile.chatBehavior }
        : {})
    });
  }
  return profiles;
}

function normalizeAssignedWatchLocations(
  assignments: Array<z.infer<typeof watchLocationAssignmentSchema>>,
  profiles: Map<string, PlaceFeatureProfileConfig>
): WatchLocationConfig[] {
  return assignments.map((assignment) => {
    const profile = profiles.get(assignment.featureProfile);
    if (!profile) {
      throw new Error(
        `Unknown feature profile for watch assignment: ${assignment.featureProfile}`
      );
    }

    const mode = inferLegacyWatchModeFromFeatures(profile.features);
    return {
      guildId: assignment.guildId,
      channelId: assignment.channelId,
      featureProfileId: profile.id,
      mode,
      defaultScope: profile.defaultScope,
      features: profile.features,
      chatBehavior: normalizeConfiguredChatBehavior(
        profile.features,
        profile.chatBehavior
      )
    };
  });
}

function normalizeLegacyWatchLocations(
  locations: Array<z.infer<typeof legacyWatchLocationSchema>>
): WatchLocationConfig[] {
  return locations.map((location) => {
    const features = location.features
      ? normalizeProfileFeatures(
          location.features,
          `legacy watch location: ${location.guildId}:${location.channelId}`
        )
      : null;
    if (features) {
      const inferredMode = inferLegacyWatchModeFromFeatures(features);
      if (inferredMode !== location.mode) {
        throw new Error(
          `Legacy watch location mode/features mismatch: ${location.guildId}:${location.channelId} has mode ${location.mode} but features imply ${inferredMode}`
        );
      }
    }

    return {
      guildId: location.guildId,
      channelId: location.channelId,
      mode: location.mode,
      defaultScope: location.defaultScope,
      ...(features ? { features } : {}),
      chatBehavior: normalizeConfiguredChatBehavior(
        resolvePlaceFeatures({
          guildId: location.guildId,
          channelId: location.channelId,
          mode: location.mode,
          defaultScope: location.defaultScope,
          ...(features ? { features } : {})
        }),
        location.chatBehavior
      )
    };
  });
}

function normalizeProfileFeatures(
  features: Array<(typeof PLACE_FEATURE_VALUES)[number]>,
  source: string
): Array<(typeof PLACE_FEATURE_VALUES)[number]> {
  const normalized = normalizePlaceFeatures(features);
  const primaryFeatures = PRIMARY_PLACE_FEATURES.filter((feature) =>
    normalized.includes(feature)
  );
  if (primaryFeatures.length > 1) {
    throw new Error(
      `${source} declares multiple primary place features: ${primaryFeatures.join(", ")}`
    );
  }

  return normalized;
}

function readWeeklyMeetupAnnouncement(
  cwd: string,
  configPath: string | undefined
): WeeklyMeetupAnnouncementConfig | null {
  if (!configPath) {
    return null;
  }

  const resolvedPath = resolve(cwd, configPath);
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
      .filter(isChatRuntimeControlledLocation)
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

function normalizeConfiguredChatBehavior(
  features: WatchLocationConfig["features"],
  configured: WatchLocationConfig["chatBehavior"] | undefined
): Exclude<WatchLocationConfig["chatBehavior"], undefined> {
  return resolvePlaceChatBehavior({
    guildId: "config-normalization",
    channelId: "config-normalization",
    mode: inferLegacyWatchModeFromFeatures(features ?? []),
    defaultScope: "conversation_only",
    ...(features !== undefined ? { features } : {}),
    ...(configured !== undefined ? { chatBehavior: configured } : {})
  });
}

function isChatRuntimeControlledLocation(location: WatchLocationConfig): boolean {
  return (
    isConversationPlace(location) &&
    !hasPlaceFeature(location, "knowledge_ingest") &&
    !hasPlaceFeature(location, "admin_override") &&
    !hasPlaceFeature(location, "forum_research") &&
    !hasPlaceFeature(location, "clear_explanation") &&
    !hasPlaceFeature(location, "question_gateway") &&
    resolvePlaceChatBehavior(location) !== null
  );
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
