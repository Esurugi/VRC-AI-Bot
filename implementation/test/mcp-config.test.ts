import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  buildMcpDisabledConfigOverride,
  getDefaultCodexConfigPath,
  parseConfiguredMcpServerIds
} from "../src/codex/mcp-config.js";

test("parseConfiguredMcpServerIds collects top-level MCP server ids", () => {
  const configToml = `
model = "gpt-5.4"

[mcp_servers.context7]
command = "npx"

[mcp_servers.zotero]
command = "python"

[mcp_servers.zotero.env]
ZOTERO_LOCAL = "true"
`;

  assert.deepEqual(parseConfiguredMcpServerIds(configToml), [
    "context7",
    "zotero"
  ]);
});

test("buildMcpDisabledConfigOverride disables every configured server", () => {
  assert.deepEqual(buildMcpDisabledConfigOverride(["context7", "zotero"]), {
    features: {
      skills: false
    },
    mcp_servers: {
      context7: { enabled: false },
      zotero: { enabled: false }
    }
  });
});

test("buildMcpDisabledConfigOverride still disables local skills when no MCP servers exist", () => {
  assert.deepEqual(buildMcpDisabledConfigOverride([]), {
    features: {
      skills: false
    }
  });
});

test("getDefaultCodexConfigPath prefers CODEX_HOME when provided", () => {
  assert.equal(
    getDefaultCodexConfigPath("/codex-home/.codex"),
    join("/codex-home/.codex", "config.toml")
  );
});
