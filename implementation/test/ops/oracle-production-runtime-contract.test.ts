import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../..");

function readRequiredRootFile(relativePath: string): string {
  const absolutePath = join(repoRoot, relativePath);
  assert.ok(
    existsSync(absolutePath),
    `${relativePath} must exist as a production runtime contract artifact.`
  );
  return readFileSync(absolutePath, "utf8");
}

function readOptionalRootFile(relativePath: string): string | null {
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  return readFileSync(absolutePath, "utf8");
}

function assertContainsAll(content: string, expectedFragments: string[]): void {
  for (const fragment of expectedFragments) {
    assert.ok(content.includes(fragment), `expected artifact to contain ${fragment}`);
  }
}

function assertContainsAny(content: string, expectedFragments: string[], message: string): void {
  assert.ok(
    expectedFragments.some((fragment) => content.includes(fragment)),
    message
  );
}

function readPackageJson(): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(readRequiredRootFile("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

function findProductionDockerfile(): { path: string; content: string } {
  const candidates = ["Dockerfile.prod", "Dockerfile.production", "Dockerfile"];
  for (const candidate of candidates) {
    const content = readOptionalRootFile(candidate);
    if (content === null) {
      continue;
    }
    if (content.includes("pnpm build") || content.includes("pnpm start")) {
      return { path: candidate, content };
    }
  }

  assert.fail(
    "production Dockerfile must exist and build/start the compiled artifact with pnpm build/pnpm start."
  );
}

function listFilesRecursively(rootRelativePath: string): string[] {
  const rootPath = join(repoRoot, rootRelativePath);
  if (!existsSync(rootPath)) {
    return [];
  }

  const paths: string[] = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    assert.ok(current !== undefined);
    for (const entry of readdirSync(current)) {
      const absoluteEntry = join(current, entry);
      if (statSync(absoluteEntry).isDirectory()) {
        pending.push(absoluteEntry);
      } else {
        paths.push(absoluteEntry);
      }
    }
  }
  return paths;
}

function findBackupScript(): { path: string; content: string } {
  const scripts = listFilesRecursively("scripts")
    .filter((absolutePath) => /backup/i.test(absolutePath))
    .filter((absolutePath) => /\.(ps1|sh|mjs|js|ts)$/i.test(absolutePath));

  assert.ok(
    scripts.length > 0,
    "PER.01 requires a backup script artifact under scripts/ so the recovery unit is testable."
  );

  const scriptPath = scripts[0];
  assert.ok(scriptPath !== undefined);
  return {
    path: scriptPath,
    content: readFileSync(scriptPath, "utf8")
  };
}

function dockerignoreExcludesAgents(content: string): boolean {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .some((line) => line === ".agents" || line === ".agents/" || line === ".agents/**");
}

test("OPS.01 production compose starts built artifacts instead of the dev runtime", () => {
  const compose = readRequiredRootFile("compose.prod.yaml");

  assertContainsAll(compose, [
    "image:",
    "NODE_ENV: production",
    "working_dir: /app"
  ]);
  assertContainsAny(
    compose,
    ['command: ["pnpm", "start"]', "command:\n      - pnpm\n      - start"],
    "production compose must run pnpm start."
  );

  assert.doesNotMatch(
    compose,
    /pnpm["'\s,\[\]]+dev:raw/,
    "production compose must not start pnpm dev:raw."
  );
  assert.doesNotMatch(
    compose,
    /^\s*-\s*\.:\/workspace\b/m,
    "production compose must not bind mount the repo into /workspace."
  );
});

test("OPS.01 and PER.01 production compose mount /data as the durable runtime unit", () => {
  const compose = readRequiredRootFile("compose.prod.yaml");

  assertContainsAll(compose, [
    "/data/vrc-ai-bot:/data/vrc-ai-bot",
    "/data/codex-home:/data/codex-home",
    "/data/backups:/data/backups",
    "HOME: /data/codex-home",
    "CODEX_HOME: /data/codex-home/.codex",
    "BOT_DB_PATH: /data/vrc-ai-bot/bot.sqlite",
    "BOT_WATCH_LOCATIONS_PATH: /data/vrc-ai-bot/config/watch-locations.json",
    "BOT_CHAT_RUNTIME_CONTROLS_PATH: /data/vrc-ai-bot/config/chat-runtime-controls.json",
    "BOT_WEEKLY_MEETUP_ANNOUNCEMENT_PATH: /data/vrc-ai-bot/config/weekly-meetup-announcement.json"
  ]);
});

test("OPS.01 production Dockerfile builds dist and defaults to pnpm start", () => {
  const dockerfile = findProductionDockerfile();

  assertContainsAll(dockerfile.content, ["pnpm install", "pnpm build"]);
  assert.match(
    dockerfile.content,
    /CMD\s+\[\s*["']pnpm["']\s*,\s*["']start["']\s*\]/,
    `${dockerfile.path} must default to pnpm start.`
  );
  assert.doesNotMatch(
    dockerfile.content,
    /pnpm["'\s,\[\]]+dev:raw/,
    `${dockerfile.path} must not default to the dev runtime.`
  );
  assert.ok(
    dockerfile.content.includes("dist") || dockerfile.content.includes("/app"),
    `${dockerfile.path} must make the compiled dist artifact the production runtime surface.`
  );
});

test("OPS.01 public-source-fetch command allowlist is executable in the production image", () => {
  const dockerfile = findProductionDockerfile();
  const dockerignore = readRequiredRootFile(".dockerignore");
  const packageJson = readPackageJson();
  const appServerClient = readRequiredRootFile("implementation/src/codex/app-server-client.ts");

  const allowlistedScriptPath =
    ".agents/skills/public-source-fetch/scripts/fetch-public-source.ts";
  const allowsRepoSkillScript = appServerClient.includes(allowlistedScriptPath);
  const allowsBuiltArtifact = /dist\/[^\s"'`]*public-source-fetch[^\s"'`]*\.js/.test(
    appServerClient
  );
  const generatesProductionShim =
    /RUN\s+cat\s+>\s+\.\/\.agents\/skills\/public-source-fetch\/scripts\/fetch-public-source\.ts\s+<<['"]?EOF['"]?[\s\S]*from\s+["']\.\.\/\.\.\/\.\.\/\.\.\/dist\/src\/knowledge\/public-source-fetch\.js["'][\s\S]*fetchPublicSource\(rawUrl\)/.test(
      dockerfile.content
    );

  assert.ok(
    allowsRepoSkillScript || allowsBuiltArtifact,
    "public-source-fetch observations must whitelist either a shipped repo skill script or a built JS artifact."
  );
  assert.equal(
    dockerignoreExcludesAgents(dockerignore),
    true,
    ".dockerignore must keep host .agents out of the production Docker build context."
  );
  assert.doesNotMatch(
    dockerfile.content,
    /^COPY\s+(?!.*--from=)[^\n]*\.agents\b/m,
    "production image must not copy host .agents from the Docker build context."
  );

  if (allowsRepoSkillScript) {
    assert.equal(
      generatesProductionShim,
      true,
      "production image must generate a production-safe public-source-fetch shim at the allowlisted .agents script path."
    );
    assert.match(
      dockerfile.content,
      /COPY\s+--from=build\s+\/app\/dist\s+\.\/dist/m,
      "production image must copy dist because the generated public-source-fetch shim imports the built artifact."
    );

    if (/pnpm\s+prune\s+--prod/.test(dockerfile.content)) {
      assert.ok(
        packageJson.dependencies?.tsx,
        "tsx must be a production dependency when pnpm prune --prod runs and the allowlist requires node --import tsx."
      );
    }
  }

  if (allowsBuiltArtifact) {
    assert.match(
      dockerfile.content,
      /COPY\s+--from=build\s+\/app\/dist\s+\.\/dist/m,
      "production image must copy dist when the whitelist accepts a built public-source-fetch artifact."
    );
    assert.doesNotMatch(
      appServerClient,
      /tokens\[2\]\?\.toLowerCase\(\)\s*!==\s*["']tsx["']/,
      "built artifact mode must not require node --import tsx in the production whitelist."
    );
  }
});

test("PER.01 backup script records DB, config, and CODEX_HOME as one recovery unit", () => {
  const backupScript = findBackupScript();

  assertContainsAll(backupScript.content, [
    "BOT_DB_PATH",
    "/data/vrc-ai-bot/config",
    "CODEX_HOME",
    "/data/backups",
    "manifest"
  ]);
  assert.match(
    backupScript.content,
    /VACUUM\s+INTO|\.backup|sqlite.*backup/i,
    `${backupScript.path} must use an online SQLite backup mechanism such as VACUUM INTO or sqlite backup.`
  );
  assert.match(
    backupScript.content,
    /encrypt|encrypted|codex login|re-login|relogin/i,
    `${backupScript.path} must document whether CODEX_HOME is encrypted in backup or restored by re-login.`
  );
});

test("PER.01 backup manifest records the production env secret recovery contract", () => {
  const backupScript = findBackupScript();

  assertContainsAll(backupScript.content, [
    "/data/vrc-ai-bot/.env",
    "manifest"
  ]);
  assert.match(
    backupScript.content,
    /"env"|"env_file"|"production_env"/,
    `${backupScript.path} must write an env section to the manifest.`
  );
  assert.match(
    backupScript.content,
    /env[\s\S]*(encrypted|included|excluded|restore_note)|(?:encrypted|included|excluded|restore_note)[\s\S]*env/i,
    `${backupScript.path} must record whether /data/vrc-ai-bot/.env is backed up securely or intentionally excluded with restore guidance.`
  );
});

test("trace retention design is externally configurable under the /data runtime tree", () => {
  const compose = readRequiredRootFile("compose.prod.yaml");

  assertContainsAll(compose, [
    "BOT_RUNTIME_TRACE_DIR: /data/vrc-ai-bot/traces",
    "BOT_RUNTIME_TRACE_RETENTION_DAYS",
    "BOT_RUNTIME_TRACE_MAX_BYTES"
  ]);
});
