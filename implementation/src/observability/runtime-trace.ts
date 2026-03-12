import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type RuntimeTraceStream = "codex-app-server" | "knowledge-persistence";

export function getRuntimeTracePath(
  stream: RuntimeTraceStream,
  projectRoot = process.cwd()
): string {
  return resolve(projectRoot, ".tmp", "runtime-trace", `${stream}.ndjson`);
}

export function appendRuntimeTrace(
  stream: RuntimeTraceStream,
  event: string,
  payload: unknown,
  projectRoot = process.cwd()
): void {
  const path = getRuntimeTracePath(stream, projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    payload: normalizeTraceValue(payload)
  };
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
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
