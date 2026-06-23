import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";

export type RuntimeTraceStream = "codex-app-server" | "knowledge-persistence";

const RETENTION_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const nextRetentionPruneByPath = new Map<string, number>();

export function getRuntimeTracePath(
  stream: RuntimeTraceStream,
  projectRoot = process.cwd()
): string {
  const configuredDir = process.env.BOT_RUNTIME_TRACE_DIR;
  const traceDir =
    configuredDir && configuredDir.trim().length > 0
      ? resolve(projectRoot, configuredDir)
      : resolve(projectRoot, ".tmp", "runtime-trace");
  return resolve(traceDir, `${stream}.ndjson`);
}

export function appendRuntimeTrace(
  stream: RuntimeTraceStream,
  event: string,
  payload: unknown,
  projectRoot = process.cwd()
): void {
  if (isRuntimeTraceDisabled()) {
    return;
  }

  const path = getRuntimeTracePath(stream, projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const maxBytes = readRuntimeTraceMaxBytes();
  pruneRuntimeTraceByRetentionIfDue(
    path,
    readRuntimeTraceRetentionMs(),
    Date.now()
  );
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    payload: normalizeTraceValue(payload)
  };
  const line = `${JSON.stringify(entry)}\n`;

  appendFileSync(path, line, "utf8");
  trimRuntimeTraceIfOversize(path, maxBytes);
}

function isRuntimeTraceDisabled(): boolean {
  const value =
    process.env.BOT_RUNTIME_TRACE_DISABLED ??
    process.env.BOT_RUNTIME_TRACE_DISABLE;
  return value === "1" || value?.toLowerCase() === "true";
}

function readRuntimeTraceMaxBytes(): number | null {
  const value = process.env.BOT_RUNTIME_TRACE_MAX_BYTES;
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function readRuntimeTraceRetentionMs(): number | null {
  const value = process.env.BOT_RUNTIME_TRACE_RETENTION_DAYS;
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed * 24 * 60 * 60 * 1000;
}

function pruneRuntimeTraceByRetention(
  path: string,
  retentionMs: number | null,
  nowMs: number
): void {
  if (!retentionMs || !existsSync(path)) {
    return;
  }

  const cutoffMs = nowMs - retentionMs;
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
  const kept = lines.filter((line) => {
    const timestampMs = readTraceLineTimestampMs(line);
    return timestampMs === null || timestampMs >= cutoffMs;
  });

  if (kept.length !== lines.length) {
    writeFileSync(path, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf8");
  }
}

function pruneRuntimeTraceByRetentionIfDue(
  path: string,
  retentionMs: number | null,
  nowMs: number
): void {
  if (!retentionMs) {
    nextRetentionPruneByPath.delete(path);
    return;
  }

  const nextPruneAt = nextRetentionPruneByPath.get(path) ?? 0;
  if (nowMs < nextPruneAt) {
    return;
  }

  nextRetentionPruneByPath.set(path, nowMs + RETENTION_PRUNE_INTERVAL_MS);
  pruneRuntimeTraceByRetention(path, retentionMs, nowMs);
}

function readTraceLineTimestampMs(line: string): number | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("timestamp" in parsed) ||
      typeof parsed.timestamp !== "string"
    ) {
      return null;
    }

    const timestampMs = Date.parse(parsed.timestamp);
    return Number.isFinite(timestampMs) ? timestampMs : null;
  } catch {
    return null;
  }
}

function trimRuntimeTrace(path: string, maxBytes: number | null): void {
  if (!maxBytes || !existsSync(path) || statSync(path).size <= maxBytes) {
    return;
  }

  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
  const kept: string[] = [];
  let keptBytes = 0;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = `${lines[index]}\n`;
    const byteLength = Buffer.byteLength(line, "utf8");
    if (kept.length > 0 && keptBytes + byteLength > maxBytes) {
      break;
    }
    if (kept.length === 0 && byteLength > maxBytes) {
      writeFileSync(path, "", "utf8");
      return;
    }
    kept.unshift(line);
    keptBytes += byteLength;
  }

  writeFileSync(path, kept.join(""), "utf8");
}

function trimRuntimeTraceIfOversize(path: string, maxBytes: number | null): void {
  if (!maxBytes || !existsSync(path) || statSync(path).size <= maxBytes) {
    return;
  }

  trimRuntimeTrace(path, maxBytes);
}

function normalizeTraceValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? null
    };
  }

  if (value === undefined) {
    return null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeTraceValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        normalizeTraceValue(entryValue)
      ])
    );
  }

  return value;
}
