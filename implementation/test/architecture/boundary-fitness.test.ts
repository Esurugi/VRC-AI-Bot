import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import test from "node:test";

import { buildHarnessRequest } from "../../src/harness/build-harness-request.js";

const projectRoot = resolve(process.cwd(), "implementation");
const sourceRoot = resolve(projectRoot, "src");
const domainRoot = resolve(sourceRoot, "domain");
const forbiddenDomainTargets = new Set(["storage", "runtime", "codex"]);
const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;

test("architecture fitness: domain does not import storage, runtime, or codex", () => {
  const violations: string[] = [];

  for (const filePath of listTypeScriptFiles(domainRoot)) {
    const source = readFileSync(filePath, "utf8");

    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        continue;
      }

      const target = resolve(resolve(filePath, ".."), specifier);
      const relativeTarget = relative(sourceRoot, target);
      const [firstSegment] = relativeTarget.split(sep);

      if (firstSegment && forbiddenDomainTargets.has(firstSegment)) {
        violations.push(`${relative(projectRoot, filePath)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("architecture fitness: HarnessRequest keeps retry control out of available_context", () => {
  const request = buildHarnessRequest({
    actorRole: "user",
    scope: "server_public",
    watchLocation: {
      guildId: "guild-1",
      channelId: "knowledge-root",
      mode: "url_watch",
      defaultScope: "server_public"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "knowledge-root",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "共有 https://example.com/source",
      urls: ["https://example.com/source"],
      receivedAt: "2026-05-21T00:00:00.000Z"
    },
    taskKind: "route_message",
    taskPhase: "retry",
    retryContext: {
      kind: "output_safety",
      retryCount: 1,
      reason: "source url is not visible in current scope",
      allowedSources: ["https://example.com/source"],
      disallowedSources: ["https://unobserved.example/source"]
    }
  });

  assert.deepEqual(request.task.retry_context, {
    kind: "output_safety",
    retry_count: 1,
    reason: "source url is not visible in current scope",
    allowed_sources: ["https://example.com/source"],
    disallowed_sources: ["https://unobserved.example/source"]
  });
  assert.equal(request.task.phase, "retry");

  const availableContextKeys = collectObjectKeys(request.available_context);
  assert.equal(availableContextKeys.has("retry_context"), false);
  assert.equal(availableContextKeys.has("retry_count"), false);
  assert.equal(availableContextKeys.has("allowed_sources"), false);
  assert.equal(availableContextKeys.has("disallowed_sources"), false);
  assert.equal(availableContextKeys.has("reason"), false);
  assert.equal(availableContextKeys.has("phase"), false);
});

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const fullPath = resolve(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  let match: RegExpExecArray | null;

  importPattern.lastIndex = 0;
  while ((match = importPattern.exec(source)) !== null) {
    const specifier = match[1];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function collectObjectKeys(value: unknown): Set<string> {
  const keys = new Set<string>();

  visit(value);
  return keys;

  function visit(current: unknown): void {
    if (!current || typeof current !== "object") {
      return;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }

    for (const [key, child] of Object.entries(current)) {
      keys.add(key);
      visit(child);
    }
  }
}
