import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig } from "../../src/config/load-config.js";

test("loadConfig resolves feature profiles before assigning them to channels", () => {
  const workspace = createTempWorkspace();
  try {
    writeJson(join(workspace, "watch-locations.json"), {
      featureProfiles: {
        "room-chat": {
          features: ["conversation"],
          defaultScope: "server_public",
          chatBehavior: "ambient_room_chat"
        },
        "shared-knowledge": {
          features: ["knowledge_ingest", "conversation"],
          defaultScope: "server_public"
        },
        "ops-override": {
          features: ["admin_override", "conversation"],
          defaultScope: "conversation_only"
        },
        "research-forum": {
          features: ["forum_research", "conversation"],
          defaultScope: "server_public"
        },
        "clear-explanation": {
          features: ["clear_explanation", "conversation"],
          defaultScope: "server_public"
        }
      },
      assignments: [
        {
          guildId: "guild",
          channelId: "chat-root",
          featureProfile: "room-chat"
        },
        {
          guildId: "guild",
          channelId: "knowledge-root",
          featureProfile: "shared-knowledge"
        },
        {
          guildId: "guild",
          channelId: "ops-root",
          featureProfile: "ops-override"
        },
        {
          guildId: "guild",
          channelId: "forum-root",
          featureProfile: "research-forum"
        },
        {
          guildId: "guild",
          channelId: "clear-root",
          featureProfile: "clear-explanation"
        }
      ]
    });

    withEnv(workspace, () => {
      const config = loadConfig(workspace);

      assert.deepEqual(
        config.watchLocations.map((location) => ({
          channelId: location.channelId,
          featureProfileId: location.featureProfileId,
          mode: location.mode,
          features: location.features,
          defaultScope: location.defaultScope,
          chatBehavior: location.chatBehavior
        })),
        [
          {
            channelId: "chat-root",
            featureProfileId: "room-chat",
            mode: "chat",
            features: ["conversation"],
            defaultScope: "server_public",
            chatBehavior: "ambient_room_chat"
          },
          {
            channelId: "knowledge-root",
            featureProfileId: "shared-knowledge",
            mode: "url_watch",
            features: ["knowledge_ingest", "conversation"],
            defaultScope: "server_public",
            chatBehavior: null
          },
          {
            channelId: "ops-root",
            featureProfileId: "ops-override",
            mode: "admin_control",
            features: ["admin_override", "conversation"],
            defaultScope: "conversation_only",
            chatBehavior: null
          },
          {
            channelId: "forum-root",
            featureProfileId: "research-forum",
            mode: "forum_longform",
            features: ["forum_research", "conversation"],
            defaultScope: "server_public",
            chatBehavior: null
          },
          {
            channelId: "clear-root",
            featureProfileId: "clear-explanation",
            mode: "chat",
            features: ["clear_explanation", "conversation"],
            defaultScope: "server_public",
            chatBehavior: null
          }
        ]
      );
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("loadConfig keeps legacy locations as compatibility input", () => {
  const workspace = createTempWorkspace();
  try {
    writeJson(join(workspace, "watch-locations.json"), {
      locations: [
        {
          guildId: "guild",
          channelId: "legacy-chat",
          mode: "chat",
          defaultScope: "server_public"
        }
      ]
    });

    withEnv(workspace, () => {
      const config = loadConfig(workspace);

      assert.deepEqual(config.watchLocations, [
        {
          guildId: "guild",
          channelId: "legacy-chat",
          mode: "chat",
          defaultScope: "server_public",
          chatBehavior: "ambient_room_chat"
        }
      ]);
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("loadConfig rejects assignments that reference missing feature profiles", () => {
  const workspace = createTempWorkspace();
  try {
    writeJson(join(workspace, "watch-locations.json"), {
      featureProfiles: {},
      assignments: [
        {
          guildId: "guild",
          channelId: "ops-root",
          featureProfile: "missing"
        }
      ]
    });

    withEnv(workspace, () => {
      assert.throws(
        () => loadConfig(workspace),
        /Unknown feature profile for watch assignment: missing/
      );
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("loadConfig rejects feature profiles with multiple primary features", () => {
  const workspace = createTempWorkspace();
  try {
    writeJson(join(workspace, "watch-locations.json"), {
      featureProfiles: {
        mixed: {
          features: ["admin_override", "knowledge_ingest", "conversation"],
          defaultScope: "conversation_only"
        }
      },
      assignments: [
        {
          guildId: "guild",
          channelId: "mixed-root",
          featureProfile: "mixed"
        }
      ]
    });

    withEnv(workspace, () => {
      assert.throws(
        () => loadConfig(workspace),
        /feature profile: mixed declares multiple primary place features: knowledge_ingest, admin_override/
      );
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("loadConfig treats clear explanation as a primary place feature", () => {
  const workspace = createTempWorkspace();
  try {
    writeJson(join(workspace, "watch-locations.json"), {
      featureProfiles: {
        mixed: {
          features: ["clear_explanation", "forum_research", "conversation"],
          defaultScope: "conversation_only"
        }
      },
      assignments: [
        {
          guildId: "guild",
          channelId: "mixed-root",
          featureProfile: "mixed"
        }
      ]
    });

    withEnv(workspace, () => {
      assert.throws(
        () => loadConfig(workspace),
        /feature profile: mixed declares multiple primary place features: forum_research, clear_explanation/
      );
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("loadConfig rejects legacy locations whose mode and features disagree", () => {
  const workspace = createTempWorkspace();
  try {
    writeJson(join(workspace, "watch-locations.json"), {
      locations: [
        {
          guildId: "guild",
          channelId: "legacy-mismatch",
          mode: "chat",
          features: ["admin_override", "conversation"],
          defaultScope: "conversation_only"
        }
      ]
    });

    withEnv(workspace, () => {
      assert.throws(
        () => loadConfig(workspace),
        /Legacy watch location mode\/features mismatch: guild:legacy-mismatch has mode chat but features imply admin_control/
      );
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("loadConfig rejects duplicate channel assignments across new and legacy config", () => {
  const workspace = createTempWorkspace();
  try {
    writeJson(join(workspace, "watch-locations.json"), {
      featureProfiles: {
        "room-chat": {
          features: ["conversation"],
          defaultScope: "server_public"
        }
      },
      assignments: [
        {
          guildId: "guild",
          channelId: "same-root",
          featureProfile: "room-chat"
        }
      ],
      locations: [
        {
          guildId: "guild",
          channelId: "same-root",
          mode: "chat",
          defaultScope: "server_public"
        }
      ]
    });

    withEnv(workspace, () => {
      assert.throws(
        () => loadConfig(workspace),
        /Duplicate watch location: guild:same-root/
      );
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("loadConfig keeps chat runtime controls limited to conversation-root profiles", () => {
  const workspace = createTempWorkspace();
  try {
    writeJson(join(workspace, "watch-locations.json"), {
      featureProfiles: {
        "room-chat": {
          features: ["conversation"],
          defaultScope: "server_public"
        },
        "ops-override": {
          features: ["admin_override", "conversation"],
          defaultScope: "conversation_only"
        },
        "shared-knowledge": {
          features: ["knowledge_ingest", "conversation"],
          defaultScope: "server_public"
        }
      },
      assignments: [
        {
          guildId: "guild",
          channelId: "chat-root",
          featureProfile: "room-chat"
        },
        {
          guildId: "guild",
          channelId: "ops-root",
          featureProfile: "ops-override"
        },
        {
          guildId: "guild",
          channelId: "knowledge-root",
          featureProfile: "shared-knowledge"
        }
      ]
    });
    writeJson(join(workspace, "chat-runtime-controls.json"), {
      enabled: true,
      enabledChannelIds: ["chat-root"]
    });

    withEnv(
      workspace,
      () => {
        const config = loadConfig(workspace);

        assert.deepEqual(config.chatRuntimeControls, {
          enabled: true,
          enabledChannelIds: ["chat-root"]
        });
      },
      {
        chatRuntimeControlsPath: join(workspace, "chat-runtime-controls.json")
      }
    );

    writeJson(join(workspace, "chat-runtime-controls.json"), {
      enabled: true,
      enabledChannelIds: ["knowledge-root"]
    });

    withEnv(
      workspace,
      () => {
        assert.throws(
          () => loadConfig(workspace),
          /BOT_CHAT_RUNTIME_CONTROLS_PATH contains unknown or non-chat channel id: knowledge-root/
        );
      },
      {
        chatRuntimeControlsPath: join(workspace, "chat-runtime-controls.json")
      }
    );

    writeJson(join(workspace, "chat-runtime-controls.json"), {
      enabled: true,
      enabledChannelIds: ["ops-root"]
    });

    withEnv(
      workspace,
      () => {
        assert.throws(
          () => loadConfig(workspace),
          /BOT_CHAT_RUNTIME_CONTROLS_PATH contains unknown or non-chat channel id: ops-root/
        );
      },
      {
        chatRuntimeControlsPath: join(workspace, "chat-runtime-controls.json")
      }
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createTempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "vrc-ai-bot-config-"));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function withEnv(
  workspace: string,
  callback: () => void,
  options: {
    chatRuntimeControlsPath?: string;
  } = {}
): void {
  const previous = { ...process.env };
  try {
    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_APPLICATION_ID = "app";
    process.env.DISCORD_OWNER_USER_IDS = "owner";
    process.env.BOT_DB_PATH = "bot.sqlite";
    process.env.BOT_LOG_LEVEL = "info";
    process.env.BOT_WATCH_LOCATIONS_PATH = join(workspace, "watch-locations.json");
    if (options.chatRuntimeControlsPath) {
      process.env.BOT_CHAT_RUNTIME_CONTROLS_PATH = options.chatRuntimeControlsPath;
    } else {
      delete process.env.BOT_CHAT_RUNTIME_CONTROLS_PATH;
    }
    delete process.env.BOT_WEEKLY_MEETUP_ANNOUNCEMENT_PATH;
    delete process.env.CODEX_HOME;
    delete process.env.CODEX_APP_SERVER_CMD;
    callback();
  } finally {
    process.env = previous;
  }
}
