import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const args = parseArgs(process.argv.slice(2));
const spawnLogPath = args.get("spawn-log");
const exitAfter = args.get("exit-after");
const exitBeforeResponse = args.get("exit-before-response");
const plannedFailure = buildPlannedFailure();
const DEFERRED_FAILURE_EXIT_MS = 30;

if (spawnLogPath && !plannedFailure?.deferSpawnLog) {
  appendFileSync(spawnLogPath, `spawn ${process.pid}\n`, "utf8");
}

process.on("SIGTERM", () => {
  if (spawnLogPath) {
    appendFileSync(spawnLogPath, `sigterm ${process.pid}\n`, "utf8");
  }
  process.exit(0);
});

const readline = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

readline.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  const request = JSON.parse(line);
  if (typeof request.id !== "number") {
    return;
  }

  if (shouldFailOnce("exit-before-response", exitBeforeResponse, request.method)) {
    logDeferredSpawn();
    process.exit(0);
    return;
  }

  const result = buildResult(request.method);
  const responseLine = `${JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result
    })}\n`;

  if (shouldFailOnce("exit-after", exitAfter, request.method)) {
    process.stdout.end(responseLine, () => {
      exitAfterDeferredSpawn();
    });
    return;
  }

  process.stdout.write(responseLine);
});

function buildResult(method) {
  switch (method) {
    case "initialize":
      return {
        capabilities: {}
      };
    case "thread/start":
      return {
        thread: {
          id: `fake-thread-${process.pid}-${Date.now()}`
        }
      };
    case "thread/resume":
    case "thread/archive":
    case "thread/unsubscribe":
    case "thread/compact/start":
      return {};
    case "turn/start":
      return {
        turn: {
          id: `fake-turn-${process.pid}`
        }
      };
    case "thread/read":
      return {
        thread: {
          turns: [
            {
              id: `fake-turn-${process.pid}`,
              items: [
                {
                  type: "agentMessage",
                  text: "{\"ok\":true}"
                }
              ]
            }
          ]
        }
      };
    default:
      return {};
  }
}

function buildPlannedFailure() {
  const kind = exitBeforeResponse
    ? "exit-before-response"
    : exitAfter
      ? "exit-after"
      : null;
  const method = exitBeforeResponse ?? exitAfter;
  if (!kind || !method || !spawnLogPath) {
    return null;
  }

  const markerPath = buildFailureMarkerPath(kind, method);
  return {
    kind,
    method,
    markerPath,
    deferSpawnLog: !existsSync(markerPath)
  };
}

function shouldFailOnce(kind, configuredMethod, requestMethod) {
  if (
    configuredMethod !== requestMethod ||
    plannedFailure?.kind !== kind ||
    plannedFailure.method !== configuredMethod
  ) {
    return false;
  }
  if (existsSync(plannedFailure.markerPath)) {
    return false;
  }

  writeFileSync(plannedFailure.markerPath, `${process.pid}\n`, "utf8");
  return true;
}

function logDeferredSpawn() {
  if (spawnLogPath && plannedFailure?.deferSpawnLog) {
    appendFileSync(spawnLogPath, `spawn ${process.pid}\n`, "utf8");
    plannedFailure.deferSpawnLog = false;
  }
}

function exitAfterDeferredSpawn() {
  if (!plannedFailure?.deferSpawnLog) {
    process.exit(0);
    return;
  }

  spawn(
    process.execPath,
    [
      "-e",
      `setTimeout(() => require("node:fs").appendFileSync(${JSON.stringify(spawnLogPath)}, ${JSON.stringify(`spawn ${process.pid}\n`)}, "utf8"), ${DEFERRED_FAILURE_EXIT_MS})`
    ],
    {
      detached: true,
      stdio: "ignore"
    }
  ).unref();
  plannedFailure.deferSpawnLog = false;
  process.exit(0);
}

function buildFailureMarkerPath(kind, method) {
  return `${spawnLogPath}.${kind}.${method.replace(/[^A-Za-z0-9_.-]+/g, "_")}.used`;
}

function parseArgs(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    const value = values[index + 1];
    if (key?.startsWith("--") && value !== undefined) {
      parsed.set(key.slice(2), value);
      index += 1;
    }
  }
  return parsed;
}
