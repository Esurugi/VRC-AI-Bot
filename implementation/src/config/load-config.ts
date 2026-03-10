import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import {
  SCOPE_VALUES,
  WATCH_MODE_VALUES,
  type AppConfig,
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
  BOT_WATCH_LOCATIONS_PATH: z.string().min(1).default("./config/watch-locations.json")
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

export function loadConfig(cwd = process.cwd()): AppConfig {
  const env = envSchema.parse(process.env);
  const watchLocationPath = resolve(cwd, env.BOT_WATCH_LOCATIONS_PATH);
  const watchLocations = readWatchLocations(watchLocationPath);

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
    watchLocations
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
