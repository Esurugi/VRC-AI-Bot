import test from "node:test";
import assert from "node:assert/strict";
import type { Channel } from "discord.js";

import { canStartOverrideFromOrigin } from "../../src/runtime/admin/admin-command-service.js";

test("override-start cannot begin from an unconfigured origin channel", () => {
  assert.equal(
    canStartOverrideFromOrigin({} as Channel, null),
    false
  );
});

test("override-start can begin from a configured origin channel", () => {
  assert.equal(
    canStartOverrideFromOrigin({} as Channel, {
      guildId: "guild",
      channelId: "chat-root",
      mode: "chat",
      defaultScope: "server_public",
      features: ["conversation"]
    }),
    true
  );
});
