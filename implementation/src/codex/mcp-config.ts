import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type McpServerOverride = {
  enabled: false;
};

export type CodexThreadConfigOverride = {
  features: {
    skills: false;
  };
  mcp_servers?: Record<string, McpServerOverride>;
};

const MCP_SERVER_SECTION_PATTERN = /^\[mcp_servers\.([A-Za-z0-9_-]+)(?:\.[^\]]+)?\]$/;

export function getDefaultCodexConfigPath(codexHome = process.env.CODEX_HOME): string {
  if (codexHome && codexHome.length > 0) {
    return join(codexHome, "config.toml");
  }

  return join(homedir(), ".codex", "config.toml");
}

export function parseConfiguredMcpServerIds(configToml: string): string[] {
  const serverIds = new Set<string>();

  for (const rawLine of configToml.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const match = MCP_SERVER_SECTION_PATTERN.exec(line);
    if (!match) {
      continue;
    }

    const serverId = match[1];
    if (serverId) {
      serverIds.add(serverId);
    }
  }

  return [...serverIds];
}

export function buildMcpDisabledConfigOverride(
  serverIds: readonly string[]
): CodexThreadConfigOverride {
  const configOverride: CodexThreadConfigOverride = {
    features: {
      skills: false
    }
  };

  if (serverIds.length > 0) {
    configOverride.mcp_servers = Object.fromEntries(
      serverIds.map((serverId) => [serverId, { enabled: false }])
    );
  }

  return configOverride;
}

export function readMcpDisabledConfigOverride(
  configPath = getDefaultCodexConfigPath()
): CodexThreadConfigOverride {
  try {
    const configToml = readFileSync(configPath, "utf8");
    const serverIds = parseConfiguredMcpServerIds(configToml);
    return buildMcpDisabledConfigOverride(serverIds);
  } catch {
    return buildMcpDisabledConfigOverride([]);
  }
}
