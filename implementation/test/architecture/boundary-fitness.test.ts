import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import test from "node:test";

import { buildHarnessRequest } from "../../src/harness/build-harness-request.js";

const projectRoot = resolve(process.cwd(), "implementation");
const sourceRoot = resolve(projectRoot, "src");
const domainRoot = resolve(sourceRoot, "domain");
const generatedCodexRoot = resolve(sourceRoot, "codex", "generated");
const forbiddenDomainTargets = new Set(["storage", "runtime", "codex"]);
const guardedBoundaryDebtKeys = [
  "runtime -> app",
  "harness -> runtime",
  "harness -> app",
  "storage -> codex",
  "storage -> override",
  "storage -> runtime",
  "storage -> harness",
  "knowledge -> harness",
  "knowledge -> runtime",
  "knowledge -> app"
] as const;
type BoundaryDebtKey = (typeof guardedBoundaryDebtKeys)[number];
const boundaryDebtBaselines: Partial<Record<BoundaryDebtKey, number>> = {
  "runtime -> app": 0,
  "harness -> runtime": 4,
  "storage -> codex": 2,
  "storage -> override": 2,
  "knowledge -> harness": 6
} as const;
const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

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

test("architecture fitness: production source import graph has no file-level cycles outside generated Codex types", () => {
  const graph = buildImportGraph(listSourceTypeScriptFiles());
  const cycles = findImportCycles(graph).map((cycle) =>
    cycle.map(relativeToProject).join(" -> ")
  );

  assert.deepEqual(cycles, []);
});

test("architecture fitness: production boundary debt does not grow or resurrect after cleanup", () => {
  const graph = buildImportGraph(listSourceTypeScriptFiles());
  const edges = [...graph.entries()].flatMap(([from, targets]) =>
    targets.map((to) => ({
      from,
      to,
      key: `${sourceSegment(from)} -> ${sourceSegment(to)}`
    }))
  );

  // Baseline guard for known production architecture debt. Test-only imports of
  // old app shims are intentionally outside this graph; cleared production debt
  // such as runtime -> app must stay at zero.
  for (const key of guardedBoundaryDebtKeys) {
    const maxCount = boundaryDebtBaselines[key] ?? 0;
    const matches = edges.filter((edge) => edge.key === key);

    assert.equal(
      matches.length <= maxCount,
      true,
      `${key} has ${matches.length} edges, expected <= ${maxCount}:\n${matches
        .map(
          (edge) => `  ${relativeToProject(edge.from)} -> ${relativeToProject(edge.to)}`
        )
        .join("\n")}`
    );
  }
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

function listSourceTypeScriptFiles(): string[] {
  return listTypeScriptFiles(sourceRoot).filter(
    (filePath) => !isInsideDirectory(filePath, generatedCodexRoot)
  );
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  let match: RegExpExecArray | null;

  importPattern.lastIndex = 0;
  while ((match = importPattern.exec(source)) !== null) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function buildImportGraph(files: string[]): Map<string, string[]> {
  const fileSet = new Set(files);
  const graph = new Map<string, string[]>();

  for (const filePath of files) {
    const source = readFileSync(filePath, "utf8");
    const targets = new Set(
      importSpecifiers(source)
        .map((specifier) => resolveTypeScriptImport(filePath, specifier, fileSet))
        .filter((target): target is string => Boolean(target))
    );

    graph.set(filePath, [...targets]);
  }

  return graph;
}

function resolveTypeScriptImport(
  importerPath: string,
  specifier: string,
  fileSet: Set<string>
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const basePath = resolve(resolve(importerPath, ".."), specifier);
  const candidates = [
    specifier.endsWith(".js") ? basePath.slice(0, -3) + ".ts" : undefined,
    specifier.endsWith(".ts") ? basePath : undefined,
    `${basePath}.ts`,
    resolve(basePath, "index.ts")
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(
    (candidate) => existsSync(candidate) && fileSet.has(candidate)
  );
}

function findImportCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const stackIndex = new Map<string, number>();

  for (const filePath of graph.keys()) {
    if (!state.has(filePath)) {
      visit(filePath);
    }
  }

  return cycles;

  function visit(filePath: string): void {
    state.set(filePath, "visiting");
    stackIndex.set(filePath, stack.length);
    stack.push(filePath);

    for (const target of graph.get(filePath) ?? []) {
      if (state.get(target) === "visiting") {
        const startIndex = stackIndex.get(target);

        if (startIndex !== undefined) {
          cycles.push([...stack.slice(startIndex), target]);
        }
        continue;
      }

      if (!state.has(target)) {
        visit(target);
      }
    }

    stack.pop();
    stackIndex.delete(filePath);
    state.set(filePath, "visited");
  }
}

function sourceSegment(filePath: string): string {
  const [segment] = relative(sourceRoot, filePath).split(sep);
  return segment ?? "";
}

function relativeToProject(filePath: string): string {
  return relative(projectRoot, filePath);
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relativePath = relative(directoryPath, filePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
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
