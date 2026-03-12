import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { KnowledgeRetrievalService } from "../../../../implementation/src/knowledge/knowledge-retrieval-service.js";
import { SqliteStore } from "../../../../implementation/src/storage/database.js";

const SCOPE_VALUES = new Set([
  "server_public",
  "channel_family",
  "conversation_only"
] as const);

export type Scope = "server_public" | "channel_family" | "conversation_only";

export type VisibilityArgs = {
  guildId: string;
  rootChannelId: string;
  placeId: string;
  scope: Scope;
  dbPath: string;
  limit?: number;
  query?: string;
  sourceId?: string;
};

export function parseSearchArgs(argv = process.argv.slice(2)): VisibilityArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "guild-id": { type: "string" },
      "root-channel-id": { type: "string" },
      "place-id": { type: "string" },
      scope: { type: "string" },
      query: { type: "string" },
      limit: { type: "string" },
      "db-path": { type: "string" }
    },
    strict: true,
    allowPositionals: false
  });

  return {
    guildId: requireString(values["guild-id"], "--guild-id"),
    rootChannelId: requireString(values["root-channel-id"], "--root-channel-id"),
    placeId: requireString(values["place-id"], "--place-id"),
    scope: requireScope(values.scope),
    query: requireString(values.query, "--query"),
    limit: values.limit ? parsePositiveInteger(values.limit, "--limit") : 10,
    dbPath: resolveDbPath(values["db-path"])
  };
}

export function parseInspectArgs(argv = process.argv.slice(2)): VisibilityArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "guild-id": { type: "string" },
      "root-channel-id": { type: "string" },
      "place-id": { type: "string" },
      scope: { type: "string" },
      "source-id": { type: "string" },
      "db-path": { type: "string" }
    },
    strict: true,
    allowPositionals: false
  });

  return {
    guildId: requireString(values["guild-id"], "--guild-id"),
    rootChannelId: requireString(values["root-channel-id"], "--root-channel-id"),
    placeId: requireString(values["place-id"], "--place-id"),
    scope: requireScope(values.scope),
    sourceId: requireString(values["source-id"], "--source-id"),
    dbPath: resolveDbPath(values["db-path"])
  };
}

export function withRetrievalStore<T>(
  dbPath: string,
  run: (service: KnowledgeRetrievalService) => T
): T {
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  try {
    return run(new KnowledgeRetrievalService(store));
  } finally {
    store.close();
  }
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requireString(value: string | undefined, flagName: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required flag ${flagName}`);
  }
  return value.trim();
}

function requireScope(value: string | undefined): Scope {
  if (!value || !SCOPE_VALUES.has(value as Scope)) {
    throw new Error(
      "Invalid --scope. Expected one of: server_public, channel_family, conversation_only"
    );
  }
  return value as Scope;
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flagName}. Expected a positive integer.`);
  }
  return parsed;
}

function resolveDbPath(explicitPath: string | undefined): string {
  const candidate = explicitPath?.trim() || process.env.BOT_DB_PATH?.trim() || "bot.sqlite";
  const resolved = resolve(process.cwd(), candidate);
  if (!existsSync(resolved)) {
    throw new Error(
      `Knowledge DB not found at ${resolved}. Pass --db-path or set BOT_DB_PATH before running this script.`
    );
  }
  return resolved;
}
