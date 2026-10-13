import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readRequiredRootFile(relativePath: string): string {
  const absolutePath = join(repoRoot, relativePath);
  assert.ok(existsSync(absolutePath), `${relativePath} must exist.`);
  return readFileSync(absolutePath, "utf8");
}

test("Windows Docker start script recreates stopped containers so env-file changes take effect", () => {
  const script = readRequiredRootFile("scripts/docker/start-bot.ps1");

  assert.match(
    script,
    /docker\s+rm\s+\$ContainerName/,
    "stopped containers must be removed before create so Docker rereads the env-file"
  );
  assert.doesNotMatch(
    script,
    /docker\s+start\s+\$ContainerName/,
    "docker start reuses the old container environment and can leave weekly meetup config disabled"
  );
  assert.match(
    script,
    /--env-file[\s\S]*\$resolvedEnvFile/,
    "the recreated container must still be created from the requested env-file"
  );
});
